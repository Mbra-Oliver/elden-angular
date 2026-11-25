import * as T from 'three';
import type { Actor3D } from './world-3d';

/**
 * Effets de combat des boss : aura, trainée d'arme, étincelles, poussière,
 * ondes de choc et éclat de télégraphe.
 *
 * Règles de performance (voir recherche) : tout est créé une seule fois et
 * pré-compilé par World3D.warmUp ; en combat on ne fait que bouger, cacher
 * ou changer des uniforms. Aucune allocation dans la boucle de rendu.
 */

const FOG_PARS_V = 'varying float vFogDepth;';
const FOG_PARS_F = `
  uniform float fogDensity;
  varying float vFogDepth;`;
/** Brouillard « vers le noir » : avec un mélange additif, le gris du brouillard s'ajouterait. */
const FOG_F = `
  float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  gl_FragColor.rgb *= 1.0 - fogFactor;`;

/**
 * Couleurs d'aura par boss et par phase, tirées de palettes akan (choix de
 * sens, pas de valeurs officielles) : or de kente → rouge asafo pour Kofi,
 * écume → bleu kente pour le Gardien. À faire relire par une personne
 * qui connaît la culture akan avant la version finale.
 */
const BOSS_COLORS = {
  duelist: [new T.Color('#D4A017'), new T.Color('#E0661C'), new T.Color('#B3261E')],
  guardian: [new T.Color('#CFE3DC'), new T.Color('#5FA8C8'), new T.Color('#2F5D8A')],
};
/** Au-delà de 1 : la passe de bloom existante fait briller l'aura sans second composer. */
const HDR = 1.8;
/** Laiton des poids à or : liseré du Gardien (corde et nœuds). */
const BRASS = new T.Color('#9C7A3C');

/** Uniforms du liseré (fresnel) partagés par tous les matériaux d'un boss. */
interface RimUniforms {
  uRim: { value: number };
  uRimPow: { value: number };
  uRimColor: { value: T.Color };
}

/**
 * Liseré lumineux sur la silhouette du boss, injecté dans son
 * MeshStandardMaterial (aucun appel de dessin en plus).
 */
function addRim(root: T.Object3D, uniforms: RimUniforms) {
  root.traverse((object) => {
    if (!(object instanceof T.Mesh) || !(object.material instanceof T.MeshStandardMaterial)) return;
    const material = object.material;
    if (material.userData['rim']) return;
    material.userData['rim'] = true;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = 'uniform float uRim;\nuniform float uRimPow;\nuniform vec3 uRimColor;\n' +
        shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uRimColor * uRim * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), uRimPow);`);
    };
    material.customProgramCacheKey = () => 'boss-rim';
    material.needsUpdate = true;
  });
}

const EMBERS = 140;

/** Attaques à esquiver (pas de garde possible) : même liste que les sons d'éclat. */
const PERILOUS: Record<'duelist' | 'guardian', string[]> = {
  duelist: ['charge', 'sweep'],
  guardian: ['tide', 'surge'],
};

/** Braises qui montent autour du boss + halo au sol. Intensité selon la phase. */
class Aura {
  readonly group = new T.Group();
  private readonly material: T.ShaderMaterial;
  private readonly glow: T.Mesh<T.CircleGeometry, T.MeshBasicMaterial>;
  /** Anneau « akoben » (cor de guerre) : pulse lentement, vite pendant l'armement. */
  private readonly horn: T.Mesh<T.RingGeometry, T.MeshBasicMaterial>;
  private strength = 0;
  private hornPhase = 0;
  private lastPhase = 1;
  private hornFlash = 0;

  constructor() {
    const geometry = new T.BufferGeometry();
    const seeds = new Float32Array(EMBERS * 4);
    for (let i = 0; i < EMBERS; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.35 + Math.random() * 0.65;
      seeds.set([Math.cos(angle) * radius, Math.sin(angle) * radius, Math.random(), 0.5 + Math.random()], i * 4);
    }
    geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(EMBERS * 3), 3));
    geometry.setAttribute('aSeed', new T.BufferAttribute(seeds, 4));
    this.material = new T.ShaderMaterial({
      uniforms: {
        ...T.UniformsLib.fog,
        uTime: { value: 0 }, uRadius: { value: 26 }, uHeight: { value: 40 },
        uSize: { value: 340 }, uColor: { value: new T.Color('#ffb347') }, uStrength: { value: 0 },
      },
      vertexShader: `
        attribute vec4 aSeed;
        uniform float uTime, uRadius, uHeight, uSize;
        varying float vLife;
        ${FOG_PARS_V}
        void main() {
          float t = fract(aSeed.z + uTime * 0.32 * aSeed.w);
          vLife = t;
          vec3 p = vec3(aSeed.x * uRadius * (1.0 + t * 0.4) + sin(t * 6.28 + aSeed.z * 20.0) * 2.5,
                        t * uHeight, aSeed.y * uRadius * (1.0 + t * 0.4));
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = uSize * (1.0 - t * 0.7) / -mvPosition.z;
          vFogDepth = -mvPosition.z;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uStrength;
        varying float vLife;
        ${FOG_PARS_F}
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(uColor * (1.0 - d * 2.0) * sin(vLife * 3.1416) * uStrength, 1.0);
          ${FOG_F}
        }`,
      blending: T.AdditiveBlending, transparent: true, depthWrite: false, fog: true,
    });
    const embers = new T.Points(geometry, this.material);
    embers.frustumCulled = false;
    this.group.add(embers);

    this.glow = new T.Mesh(new T.CircleGeometry(1, 40), new T.MeshBasicMaterial({
      map: radialTexture(), color: '#ffb347', transparent: true, depthWrite: false,
      blending: T.AdditiveBlending, opacity: 0, fog: false,
    }));
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.4;
    this.glow.scale.setScalar(34);
    this.group.add(this.glow);
    this.horn = new T.Mesh(new T.RingGeometry(0.9, 1, 72), new T.MeshBasicMaterial({
      color: '#D4A017', transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0, fog: false,
    }));
    this.horn.rotation.x = -Math.PI / 2;
    this.horn.position.y = 0.6;
    this.group.add(this.horn);
    this.group.visible = false;
  }

  update(pose: Actor3D | null, boss: 'duelist' | 'guardian', now: number, dt: number) {
    this.group.visible = !!pose;
    if (!pose) return;
    const phase = Math.max(1, Math.min(3, pose.bossPhase ?? 1));
    const color = BOSS_COLORS[boss][phase - 1];
    // L'aura baisse pendant l'armement : les effets ne doivent jamais masquer le télégraphe.
    const shift = pose.state === 'shift' ? 1.6 * Math.sin(pose.phase * Math.PI) : 0;
    const target = (0.25 + phase * 0.22) * (pose.state === 'windup' ? 0.55 : 1) + shift;
    this.strength += (target - this.strength) * (1 - Math.exp(-6 * dt));
    this.group.position.set(pose.x, 0, pose.y);
    const u = this.material.uniforms;
    u['uTime'].value = now / 1000;
    u['uColor'].value.copy(color).multiplyScalar(HDR);
    u['uStrength'].value = this.strength;
    u['uHeight'].value = 34 + phase * 8 + shift * 20;
    const flicker = 0.85 + 0.15 * Math.sin(now * 0.011) * Math.sin(now * 0.0037);
    this.glow.material.color.copy(color);
    this.glow.material.opacity = Math.min(0.75, 0.18 * this.strength * flicker);
    this.glow.scale.setScalar(30 + phase * 5 + shift * 18);

    // Akoben : un battement par seconde au repos, quatre pendant l'armement,
    // et un grand appel à chaque changement de phase.
    if (phase !== this.lastPhase) { this.hornFlash = 1; this.lastPhase = phase; }
    this.hornFlash = Math.max(0, this.hornFlash - dt * 0.9);
    this.hornPhase = (this.hornPhase + dt * (pose.state === 'windup' ? 4 : 1)) % 1;
    const beat = Math.pow(1 - this.hornPhase, 3);
    this.horn.material.color.copy(color).multiplyScalar(HDR);
    this.horn.material.opacity = Math.min(1, 0.12 + beat * 0.35 * this.strength + this.hornFlash * 0.6);
    this.horn.scale.setScalar(26 + phase * 4 + (1 - beat) * 6 + this.hornFlash * 60);
  }
}

/** Ruban de trainée derrière la pointe de l'arme, nourri de deux points par image. */
class SlashTrail {
  readonly mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
  private readonly positions: Float32Array;
  private live = 0;

  constructor(private readonly segments = 18) {
    this.positions = new Float32Array(segments * 6);
    const geometry = new T.BufferGeometry();
    const along = new Float32Array(segments * 2);
    const index: number[] = [];
    for (let i = 0; i < segments; i++) {
      along[i * 2] = along[i * 2 + 1] = i / (segments - 1);
      if (i < segments - 1) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geometry.setAttribute('position', new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage));
    geometry.setAttribute('aT', new T.BufferAttribute(along, 1));
    geometry.setIndex(index);
    this.mesh = new T.Mesh(geometry, new T.ShaderMaterial({
      uniforms: { uColor: { value: new T.Color('#ffe2a8') }, uLive: { value: 0 } },
      vertexShader: `attribute float aT; varying float vT;
        void main() { vT = aT; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uLive; varying float vT;
        void main() { float a = (1.0 - vT) * (1.0 - vT) * step(vT, uLive); if (a < 0.01) discard;
          gl_FragColor = vec4(uColor * a * 0.85, a); }`,
      transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending,
    }));
    this.mesh.frustumCulled = false;
  }

  push(base: T.Vector3, tip: T.Vector3, color: T.Color) {
    this.positions.copyWithin(6, 0, this.positions.length - 6);
    base.toArray(this.positions, 0);
    tip.toArray(this.positions, 3);
    this.live = Math.min(this.live + 1, this.segments);
    this.sync(color);
  }

  decay() {
    if (this.live === 0) return;
    this.live = Math.max(0, this.live - 2);
    this.sync();
  }

  private sync(color?: T.Color) {
    const u = this.mesh.material.uniforms;
    u['uLive'].value = this.live <= 1 ? 0 : (this.live - 1) / (this.segments - 1);
    if (color) u['uColor'].value.copy(color);
    this.mesh.geometry.attributes['position'].needsUpdate = true;
    this.mesh.visible = this.live > 1;
  }
}

/** Particules en anneau tampon (étincelles additives ou poussière). */
class Burst {
  readonly mesh: T.InstancedMesh;
  private readonly pos: T.Vector3[] = [];
  private readonly vel: T.Vector3[] = [];
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private readonly size: Float32Array;
  private head = 0;
  private readonly matrix = new T.Matrix4();
  private readonly rotation = new T.Quaternion();
  private readonly scale = new T.Vector3();
  private readonly color = new T.Color();

  constructor(count: number, additive: boolean, private readonly gravity: number, private readonly drag: number,
    geometry: T.BufferGeometry) {
    this.mesh = new T.InstancedMesh(geometry, new T.MeshBasicMaterial({
      transparent: true, depthWrite: false, opacity: additive ? 1 : 0.55,
      blending: additive ? T.AdditiveBlending : T.NormalBlending,
    }), count);
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.life = new Float32Array(count);
    this.max = new Float32Array(count).fill(1);
    this.size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.pos.push(new T.Vector3());
      this.vel.push(new T.Vector3());
      this.mesh.setColorAt(i, this.color.set(0));
      this.mesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
    }
  }

  emit(x: number, y: number, z: number, n: number, speed: number, color: T.ColorRepresentation,
    life = 0.5, size = 1, upBias = 0.5, flat = false) {
    for (let k = 0; k < n; k++) {
      const i = this.head;
      this.head = (this.head + 1) % this.life.length;
      this.pos[i].set(x, y, z);
      this.vel[i].randomDirection();
      if (flat) this.vel[i].y = Math.abs(this.vel[i].y) * 0.3;
      this.vel[i].multiplyScalar(speed * (0.5 + Math.random()));
      this.vel[i].y += speed * upBias;
      this.life[i] = this.max[i] = life * (0.6 + Math.random() * 0.8);
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.mesh.setColorAt(i, this.color.set(color));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    for (let i = 0; i < this.life.length; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = Math.max(this.life[i] / this.max[i], 0);
      this.vel[i].multiplyScalar(Math.exp(-this.drag * dt));
      this.vel[i].y += this.gravity * dt;
      this.pos[i].addScaledVector(this.vel[i], dt);
      if (this.pos[i].y < 0) { this.pos[i].y = 0; this.vel[i].y *= -0.3; }
      this.scale.setScalar(this.size[i] * k);
      this.mesh.setMatrixAt(i, this.matrix.compose(this.pos[i], this.rotation, this.scale));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Onde de choc au sol (anneau qui s'élargit en easing sortant). */
class Shockwave {
  readonly mesh: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
  private t = 1;
  private duration = 0.5;

  constructor() {
    const geometry = new T.PlaneGeometry(2, 2);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new T.Mesh(geometry, new T.ShaderMaterial({
      uniforms: { uP: { value: 1 }, uColor: { value: new T.Color('#ffe0a0') } },
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2,
      vertexShader: `varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uP; uniform vec3 uColor; varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y); }
        void main() { float d = length(vUv); float r = uP; float w = mix(0.25, 0.04, uP);
          float band = smoothstep(r - w, r, d) * (1.0 - smoothstep(r, r + w * 0.3, d));
          // Érosion : le bruit défile vers l'extérieur et ronge l'anneau avec l'âge.
          float ang = atan(vUv.y, vUv.x);
          float n = noise(vec2(ang * 6.0, d * 8.0 - uP * 6.0));
          float erode = smoothstep(uP * 0.9 - 0.1, uP * 0.9 + 0.1, n);
          float a = band * erode * (1.0 - uP * 0.6); if (a < 0.01) discard;
          // Bord chaud presque blanc au début, couleur du boss ensuite.
          vec3 hot = mix(vec3(1.6), uColor * 1.8, smoothstep(0.0, 0.35, uP));
          gl_FragColor = vec4(hot * a, a); }`,
    }));
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  get idle() { return this.t >= 1; }

  /** delay (s) : départ retardé, pour les vagues d'eau décalées du Gardien. */
  fire(x: number, z: number, radius: number, color: T.Color, duration = 0.5, delay = 0) {
    this.mesh.position.set(x, 0.5, z);
    this.mesh.scale.setScalar(radius);
    this.mesh.material.uniforms['uColor'].value.copy(color);
    this.duration = duration;
    this.t = -delay / duration;
    this.mesh.visible = delay <= 0;
  }

  update(dt: number) {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / this.duration);
    if (this.t < 0) return;
    this.mesh.visible = true;
    this.mesh.material.uniforms['uP'].value = 1 - Math.pow(1 - this.t, 3);
    if (this.t >= 1) this.mesh.visible = false;
  }
}

/** Petite étoile qui brille juste avant le coup : « c'est maintenant qu'il faut esquiver ». */
class Glint {
  readonly sprite: T.Sprite;
  constructor() {
    this.sprite = new T.Sprite(new T.SpriteMaterial({
      map: starTexture(), color: '#fff4d0', transparent: true, depthWrite: false,
      depthTest: false, blending: T.AdditiveBlending, fog: false,
    }));
    this.sprite.visible = false;
    this.sprite.renderOrder = 10;
  }
  /** perilous : attaque à esquiver absolument (éclat rouge et plus grand). */
  show(at: T.Vector3, k: number, now: number, perilous = false) {
    this.sprite.visible = k > 0;
    if (k <= 0) return;
    this.sprite.position.copy(at);
    const pulse = Math.sin(k * Math.PI);
    this.sprite.material.color.set(perilous ? '#ff4a32' : '#fff4d0');
    this.sprite.scale.setScalar((perilous ? 8 : 4) + pulse * (perilous ? 22 : 13));
    this.sprite.material.rotation = now * 0.004;
    this.sprite.material.opacity = pulse;
  }
}

export class BossFx {
  readonly root = new T.Group();
  private readonly aura = new Aura();
  private readonly trail = new SlashTrail();
  private readonly sparks = new Burst(160, true, -160, 1.6, new T.OctahedronGeometry(0.8, 0));
  private readonly dust = new Burst(120, false, 14, 3.2, new T.IcosahedronGeometry(2.2, 0));
  private readonly waves = [new Shockwave(), new Shockwave(), new Shockwave(), new Shockwave(), new Shockwave()];
  private readonly rims: Record<'duelist' | 'guardian', RimUniforms> = {
    duelist: { uRim: { value: 0 }, uRimPow: { value: 2.4 }, uRimColor: { value: new T.Color('#D4A017') } },
    guardian: { uRim: { value: 0 }, uRimPow: { value: 2.0 }, uRimColor: { value: new T.Color('#CFE3DC') } },
  };
  private rimFlash = 0;
  private readonly glint = new Glint();
  private lastState = '';
  private lastAttack = '';
  private lastStep = -1;
  private readonly base = new T.Vector3();
  private readonly tip = new T.Vector3();
  private readonly color = new T.Color();

  constructor() {
    this.root.add(this.aura.group, this.trail.mesh, this.sparks.mesh, this.dust.mesh, this.glint.sprite,
      ...this.waves.map((wave) => wave.mesh));
  }

  /** Objets à rendre visibles pendant le pré-chauffage des shaders. */
  get warmables(): T.Object3D[] {
    return [this.aura.group, this.trail.mesh, this.glint.sprite, ...this.waves.map((wave) => wave.mesh)];
  }

  /** Pose le liseré fresnel sur tous les matériaux du boss (à faire avant warmUp). */
  attachRim(root: T.Object3D, boss: 'duelist' | 'guardian') {
    addRim(root, this.rims[boss]);
  }

  private wave(x: number, z: number, radius: number, color: T.Color, duration?: number, delay = 0) {
    const free = this.waves.find((wave) => wave.idle) ?? this.waves[0];
    free.fire(x, z, radius, color, duration, delay);
  }

  /**
   * @param weapon pointe/base de l'arme en monde (duelliste) ou null
   * @param glintAt point où briller pendant le télégraphe
   */
  update(pose: Actor3D | null, boss: 'duelist' | 'guardian', weapon: { base: T.Vector3; tip: T.Vector3 } | null,
    glintAt: T.Vector3 | null, now: number, dt: number) {
    this.aura.update(pose, boss, now, dt);
    this.sparks.update(dt);
    this.dust.update(dt);
    this.waves.forEach((wave) => wave.update(dt));
    if (!pose) {
      this.trail.decay();
      this.glint.show(this.tip, 0, now);
      this.lastState = '';
      return;
    }
    const phase = Math.max(1, Math.min(3, pose.bossPhase ?? 1));
    const color = this.color.copy(BOSS_COLORS[boss][phase - 1]);
    const attack = pose.attack ?? 'none';
    const started = pose.state !== this.lastState;

    // Liseré : plus vif à chaque phase, monte pendant l'armement, éclate au changement de phase.
    if (started && pose.state === 'shift') this.rimFlash = 1;
    this.rimFlash = Math.max(0, this.rimFlash - dt * 1.2);
    const rim = this.rims[boss];
    rim.uRimColor.value.copy(boss === 'guardian' && phase === 1 ? BRASS : color).multiplyScalar(HDR);
    rim.uRim.value = 0.25 + phase * 0.2 + (pose.state === 'windup' ? pose.phase * 0.5 : 0) + this.rimFlash * 2;

    // Trainée d'arme pendant la phase active (et le moulinet).
    if (weapon && pose.state === 'attacking' && attack !== 'charge') this.trail.push(weapon.base, weapon.tip, color);
    else this.trail.decay();

    // Éclat sur les 25 % finaux de l'armement.
    const glintK = pose.state === 'windup' && pose.phase > 0.75 ? (pose.phase - 0.75) / 0.25 : 0;
    this.glint.show(glintAt ?? this.tip.set(pose.x, 30, pose.y), glintK, now, PERILOUS[boss].includes(attack));

    if (started && pose.state === 'attacking') {
      const heavy = attack === 'slam' || attack === 'surge' || attack === 'tide';
      if (heavy) {
        this.wave(pose.x, pose.y, attack === 'slam' ? 70 : 90, color, 0.55);
        if (boss === 'guardian' && attack !== 'slam') {
          // Eau : deux anneaux de plus, décalés, comme une houle.
          this.wave(pose.x, pose.y, 80, color, 0.6, 0.12);
          this.wave(pose.x, pose.y, 70, color, 0.65, 0.24);
        }
        this.dust.emit(pose.x + pose.facingX * 18, 2, pose.y + pose.facingY * 18, 28, 60, '#a08a68', 0.9, 1.1, 0.7);
        this.sparks.emit(pose.x + pose.facingX * 18, 4, pose.y + pose.facingY * 18, 18, 90, color, 0.4, 1, 0.8);
      } else if (attack === 'sweep') {
        this.wave(pose.x, pose.y, 55, color, 0.45);
        this.dust.emit(pose.x, 2, pose.y, 18, 70, '#a08a68', 0.7, 0.9, 0.2, true);
      } else if (attack === 'charge') {
        this.dust.emit(pose.x - pose.facingX * 10, 2, pose.y - pose.facingY * 10, 16, 40, '#a08a68', 0.8, 1, 0.5);
      }
    }
    // Poussière de course pendant la charge.
    if (pose.state === 'attacking' && attack === 'charge' && Math.random() < dt * 30) {
      this.dust.emit(pose.x, 1, pose.y, 1, 18, '#9c8564', 0.7, 0.9, 0.6);
    }
    // Chaque coup du combo fait jaillir des étincelles à la pointe.
    if (pose.state === 'attacking' && attack === 'combo' && pose.step !== this.lastStep && weapon) {
      this.sparks.emit(weapon.tip.x, weapon.tip.y, weapon.tip.z, 8, 70, color, 0.3, 0.8, 0.3);
    }
    // Changement de phase : grande onde, gerbe d'étincelles, soulèvement de poussière.
    if (started && pose.state === 'shift') {
      this.wave(pose.x, pose.y, 150, color, 0.9);
      this.wave(pose.x, pose.y, 95, color, 0.6);
      this.sparks.emit(pose.x, 14, pose.y, 60, 120, color, 0.9, 1.3, 0.9);
      this.dust.emit(pose.x, 2, pose.y, 40, 90, '#a08a68', 1.1, 1.3, 0.3, true);
    }
    this.lastState = pose.state;
    this.lastAttack = attack;
    this.lastStep = pose.step ?? -1;
  }
}

function radialTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.45, '#ffffff55');
  gradient.addColorStop(1, '#ffffff00');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

function starTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.2, '#ffffffaa');
  gradient.addColorStop(1, '#ffffff00');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#ffffff';
  for (const [w, h] of [[2, 30], [30, 2]]) ctx.fillRect(32 - w, 32 - h, w * 2, h * 2);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}
