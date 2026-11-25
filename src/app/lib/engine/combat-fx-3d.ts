import * as T from 'three';
import type { FxEvent } from '../services/combat-fx.service';

/**
 * Effets d'impact génériques en 3D (coups du joueur et coups reçus).
 *
 * - Éclats géométriques : trois InstancedMesh (étincelles additives, éclats
 *   pleins pour le sang stylisé et les gravats, poussière translucide), soit
 *   trois draw calls pour quelques centaines d'éclats.
 * - Décalques au sol (fissure, brûlure, flaque) qui s'effacent lentement.
 * - Deux lumières ponctuelles en pool, TOUJOURS présentes dans la scène :
 *   seule leur intensité varie. Ajouter, retirer ou masquer une lumière
 *   changerait le nombre de lumières et forcerait la recompilation de tous les
 *   matériaux (gel de l'image).
 * - Secousse de caméra directionnelle à amortissement rapide.
 *
 * Les ondes de choc, traînées et auras propres aux boss vivent dans
 * boss-fx-3d.ts ; ce fichier ne s'occupe que de la sensation d'impact.
 * Aucune allocation par image : tout est créé au démarrage.
 */

const UP = new T.Vector3(0, 1, 0);
const tmpMatrix = new T.Matrix4();
const tmpQuat = new T.Quaternion();
const tmpEuler = new T.Euler();
const tmpPos = new T.Vector3();
const tmpScale = new T.Vector3();
const tmpDir = new T.Vector3();
const tmpColor = new T.Color();
const ZERO = new T.Matrix4().makeScale(0, 0, 0);

interface PoolOptions {
  gravity: number;
  drag: number;
  /** 'bounce' : rebond mou ; 'splat' : s'écrase et reste au sol ; 'float' : traverse. */
  floor: 'bounce' | 'splat' | 'float';
  /** Étincelles : étirées dans le sens de la vitesse au lieu de tourner. */
  stretch: boolean;
  /** Poussière : grossit en vieillissant au lieu de rapetisser. */
  grow: boolean;
}

/** Pool circulaire d'éclats, un seul InstancedMesh. */
class ShardPool {
  readonly mesh: T.InstancedMesh;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private readonly size: Float32Array;
  private readonly landed: Uint8Array;
  private head = 0;
  private live = 0;

  constructor(private readonly count: number, geometry: T.BufferGeometry, material: T.Material,
    private readonly options: PoolOptions) {
    this.mesh = new T.InstancedMesh(geometry, material, count);
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.rot = new Float32Array(count * 3);
    this.spin = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count).fill(1);
    this.size = new Float32Array(count);
    this.landed = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      this.mesh.setMatrixAt(i, ZERO);
      this.mesh.setColorAt(i, tmpColor.set(0xffffff));
    }
  }

  /**
   * Gerbe de `n` éclats autour de `dir` (cône d'ouverture `spread`, 0 = droit,
   * 1 = toutes directions), avec un supplément vers le haut `lift`.
   */
  emit(x: number, y: number, z: number, dir: T.Vector3, n: number, speed: number, spread: number,
    lift: number, color: T.ColorRepresentation, life: number, size: number, variance = 0.25) {
    const base = tmpColor.set(color);
    const r = base.r, g = base.g, b = base.b;
    for (let k = 0; k < n; k++) {
      const i = this.head;
      this.head = (this.head + 1) % this.count;
      if (this.life[i] <= 0) this.live++;
      const p = i * 3;
      tmpDir.randomDirection().multiplyScalar(spread).add(dir).normalize();
      const v = speed * (0.45 + Math.random() * 0.9);
      this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
      this.vel[p] = tmpDir.x * v;
      this.vel[p + 1] = tmpDir.y * v + lift * (0.5 + Math.random());
      this.vel[p + 2] = tmpDir.z * v;
      for (let a = 0; a < 3; a++) {
        this.rot[p + a] = Math.random() * 6.3;
        this.spin[p + a] = (Math.random() - 0.5) * 22;
      }
      this.life[i] = this.max[i] = life * (0.65 + Math.random() * 0.7);
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.landed[i] = 0;
      const shade = 1 - variance + Math.random() * variance * 2;
      this.mesh.setColorAt(i, tmpColor.setRGB(r * shade, g * shade, b * shade));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    if (this.live === 0) return;
    const { gravity, drag, floor, stretch, grow } = this.options;
    const damping = Math.exp(-drag * dt);
    let live = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.mesh.setMatrixAt(i, ZERO);
        continue;
      }
      live++;
      const p = i * 3;
      const k = this.life[i] / this.max[i];
      if (!this.landed[i]) {
        this.vel[p] *= damping; this.vel[p + 1] *= damping; this.vel[p + 2] *= damping;
        this.vel[p + 1] -= gravity * dt;
        this.pos[p] += this.vel[p] * dt;
        this.pos[p + 1] += this.vel[p + 1] * dt;
        this.pos[p + 2] += this.vel[p + 2] * dt;
        for (let a = 0; a < 3; a++) this.rot[p + a] += this.spin[p + a] * dt;
        if (floor !== 'float' && this.pos[p + 1] < 0.4) {
          this.pos[p + 1] = 0.4;
          if (floor === 'splat') {
            // Le sang s'écrase : il reste à plat au sol jusqu'à s'effacer.
            this.landed[i] = 1;
            this.rot[p] = 0; this.rot[p + 2] = 0;
            this.life[i] = Math.max(this.life[i], 1.2);
            this.max[i] = Math.max(this.max[i], this.life[i]);
          } else {
            this.vel[p + 1] *= -0.3;
            this.vel[p] *= 0.5;
            this.vel[p + 2] *= 0.5;
          }
        }
      }
      const s = this.size[i];
      tmpPos.set(this.pos[p], this.pos[p + 1], this.pos[p + 2]);
      if (stretch) {
        // Étincelle : fine aiguille alignée sur sa vitesse, qui raccourcit en ralentissant.
        tmpDir.set(this.vel[p], this.vel[p + 1], this.vel[p + 2]);
        const speed = tmpDir.length();
        tmpQuat.setFromUnitVectors(UP, speed > 0.01 ? tmpDir.multiplyScalar(1 / speed) : UP);
        const fade = Math.min(1, k * 1.6);
        tmpScale.set(s * 0.35 * fade, s * (0.6 + Math.min(speed, 260) * 0.018) * fade, s * 0.35 * fade);
      } else {
        tmpQuat.setFromEuler(tmpEuler.set(this.rot[p], this.rot[p + 1], this.rot[p + 2]));
        if (grow) {
          const g = s * (0.5 + (1 - k) * 1.3) * Math.min(1, k * 2.5);
          tmpScale.set(g, g, g);
        } else if (this.landed[i]) {
          const f = Math.min(1, k * 3) * s;
          tmpScale.set(f * 1.5, f * 0.18, f * 1.5);
        } else {
          const f = Math.min(1, k * 3) * s;
          tmpScale.set(f, f, f);
        }
      }
      this.mesh.setMatrixAt(i, tmpMatrix.compose(tmpPos, tmpQuat, tmpScale));
    }
    this.live = live;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    for (let i = 0; i < this.count; i++) this.mesh.setMatrixAt(i, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.live = 0;
  }
}

const DECALS = 8;
type DecalKind = 'crack' | 'scorch' | 'wet';

/** Trace au sol : apparaît d'un coup, tient, puis s'efface en quelques secondes. */
interface Decal {
  mesh: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>;
  age: number;
  hold: number;
  fade: number;
  peak: number;
}

/** Une lumière flash : même objet pour toute la partie, seule l'intensité bouge. */
interface Flash {
  light: T.PointLight;
  t: number;
  duration: number;
  peak: number;
}

/** Secousse amortie le long d'un axe (en repère caméra). */
interface Shake {
  axis: 'horizontal' | 'vertical';
  amp: number;
  t: number;
  phase: number;
  sign: number;
}

const SHAKE_DECAY = 20;
const SHAKE_FREQ = 17;
const SHAKE_PIXELS = 2.6;

export class CombatFx3D {
  readonly root = new T.Group();
  private readonly sparks: ShardPool;
  private readonly chunks: ShardPool;
  private readonly dust: ShardPool;
  private readonly decals: Decal[] = [];
  private readonly flashes: Flash[] = [];
  private readonly shakes: Shake[] = [];
  private readonly textures: Record<DecalKind, T.CanvasTexture>;
  private nextDecal = 0;
  private nextFlash = 0;
  private readonly dir = new T.Vector3();
  private readonly right = new T.Vector3();
  private readonly up = new T.Vector3();
  readonly shakeOffset = new T.Vector3();

  constructor(private readonly scene: T.Scene) {
    this.sparks = new ShardPool(220, new T.OctahedronGeometry(1, 0), new T.MeshBasicMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false,
    }), { gravity: 220, drag: 3.2, floor: 'bounce', stretch: true, grow: false });
    this.chunks = new ShardPool(260, new T.TetrahedronGeometry(1, 0), new T.MeshBasicMaterial(),
      { gravity: 300, drag: 1.4, floor: 'splat', stretch: false, grow: false });
    this.dust = new ShardPool(160, new T.IcosahedronGeometry(1, 0), new T.MeshBasicMaterial({
      transparent: true, opacity: 0.42, depthWrite: false,
    }), { gravity: -8, drag: 3.6, floor: 'float', stretch: false, grow: true });
    this.root.add(this.sparks.mesh, this.chunks.mesh, this.dust.mesh);

    this.textures = { crack: this.crackTexture(), scorch: this.scorchTexture(), wet: this.wetTexture() };
    const plane = new T.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    for (let i = 0; i < DECALS; i++) {
      const mesh = new T.Mesh(plane, new T.MeshBasicMaterial({
        map: this.textures.crack, transparent: true, opacity: 0, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      }));
      mesh.renderOrder = 1;
      mesh.visible = false;
      this.decals.push({ mesh, age: 0, hold: 0, fade: 1, peak: 0 });
      this.root.add(mesh);
    }

    for (let i = 0; i < 2; i++) {
      // decay 0 : portée nette fixée par `distance`, indépendante de l'échelle de la scène.
      const light = new T.PointLight('#ffffff', 0, 150, 0);
      light.position.set(0, -500, 0);
      this.flashes.push({ light, t: 1, duration: 0.1, peak: 0 });
      this.root.add(light);
    }
    scene.add(this.root);
  }

  /** Objets masqués à rendre visibles pendant le pré-chauffage des shaders. */
  get warmables(): T.Object3D[] {
    return this.decals.map((decal) => decal.mesh);
  }

  handle(event: FxEvent) {
    switch (event.type) {
      case 'hit': this.hit(event); break;
      case 'dust': this.puff(event.x, event.y, event.dirX, event.dirY, event.amount); break;
      case 'decal': this.decal(event.x, event.y, event.radius, event.kind); break;
      case 'flash': this.flash(event.x, event.y, event.height, event.color, event.intensity, event.duration); break;
      case 'shake': this.shake(event.axis, event.strength); break;
    }
  }

  update(dt: number, camera: T.Camera) {
    this.sparks.update(dt);
    this.chunks.update(dt);
    this.dust.update(dt);

    for (const decal of this.decals) {
      if (!decal.mesh.visible) continue;
      decal.age += dt;
      const out = Math.max(0, decal.age - decal.hold) / decal.fade;
      const pop = Math.min(1, decal.age / 0.06);
      decal.mesh.material.opacity = decal.peak * pop * (1 - out);
      if (out >= 1) decal.mesh.visible = false;
    }

    for (const flash of this.flashes) {
      if (flash.t >= 1) continue;
      flash.t = Math.min(1, flash.t + dt / flash.duration);
      // Allumage instantané, extinction rapide (courbe quadratique).
      flash.light.intensity = flash.peak * (1 - flash.t) * (1 - flash.t);
    }

    // Secousse : somme de sinusoïdes amorties, projetée sur les axes caméra.
    this.shakeOffset.set(0, 0, 0);
    if (this.shakes.length) {
      camera.matrixWorld.extractBasis(this.right, this.up, tmpDir);
      for (let i = this.shakes.length - 1; i >= 0; i--) {
        const s = this.shakes[i];
        s.t += dt;
        const envelope = s.amp * Math.exp(-SHAKE_DECAY * s.t);
        if (envelope < 0.02) {
          this.shakes.splice(i, 1);
          continue;
        }
        const wave = Math.sin(s.t * SHAKE_FREQ * Math.PI * 2 + s.phase) * envelope * s.sign;
        // Un soupçon de l'autre axe pour que la secousse ne paraisse pas mécanique.
        const cross = Math.cos(s.t * SHAKE_FREQ * 1.7 * Math.PI * 2 + s.phase) * envelope * 0.25;
        if (s.axis === 'horizontal') {
          this.shakeOffset.addScaledVector(this.right, wave).addScaledVector(this.up, cross);
        } else {
          this.shakeOffset.addScaledVector(this.up, wave).addScaledVector(this.right, cross);
        }
      }
    }
  }

  reset() {
    this.sparks.clear();
    this.chunks.clear();
    this.dust.clear();
    for (const decal of this.decals) decal.mesh.visible = false;
    for (const flash of this.flashes) { flash.t = 1; flash.light.intensity = 0; }
    this.shakes.length = 0;
    this.shakeOffset.set(0, 0, 0);
  }

  dispose() {
    this.scene.remove(this.root);
    for (const mesh of [this.sparks.mesh, this.chunks.mesh, this.dust.mesh]) {
      mesh.geometry.dispose();
      (mesh.material as T.Material).dispose();
      mesh.dispose();
    }
    this.decals[0]?.mesh.geometry.dispose();
    for (const decal of this.decals) decal.mesh.material.dispose();
    Object.values(this.textures).forEach((texture) => texture.dispose());
    for (const flash of this.flashes) flash.light.dispose();
  }

  // ─── Événements ────────────────────────────────────────────────────────

  private hit(e: Extract<FxEvent, { type: 'hit' }>) {
    const len = Math.hypot(e.dirX, e.dirY) || 1;
    // Les éclats partent dans le sens du coup, un peu vers le haut.
    this.dir.set(e.dirX / len, 0.35, e.dirY / len).normalize();
    const s = e.strength;
    const n = (base: number) => Math.round(base * Math.min(1.6, 0.6 + s * 0.5));
    const { x, y, height: h } = e;
    switch (e.material) {
      case 'guard':
        // Lame contre lame : gerbe d'étincelles vives, petit éclair.
        this.sparks.emit(x, h, y, this.dir, n(16), 190, 0.8, 30, '#ffd88a', 0.32, 1.3);
        this.flash(x, y, h, '#ffcf80', 2.2, 0.08);
        break;
      case 'shell':
        this.sparks.emit(x, h, y, this.dir, n(10), 160, 0.7, 30, '#e6fff6', 0.28, 1.1);
        this.chunks.emit(x, h, y, this.dir, n(7), 90, 0.6, 70, '#5d6a62', 1.1, 1.6);
        break;
      case 'spirit':
        // Le Gardien est un esprit d'eau : gouttes pâles et éclat cyan.
        this.chunks.emit(x, h, y, this.dir, n(12), 120, 0.55, 80, '#8fe9da', 1, 1.5);
        this.sparks.emit(x, h, y, this.dir, n(8), 150, 0.6, 20, '#a8fff2', 0.3, 1.2);
        break;
      default:
        // Sang stylisé : éclats plats rouge sombre qui s'écrasent au sol, et
        // quelques étincelles blanches pour le contact.
        this.chunks.emit(x, h, y, this.dir, n(12), 115, 0.5, 70, e.target === 'player' ? '#9b2320' : '#8a1c1a', 1.3, 1.4);
        this.sparks.emit(x, h, y, this.dir, n(6), 150, 0.6, 10, '#fff2d8', 0.2, 1.1);
        break;
    }
    if (e.style === 'slam' && s > 1) this.puff(x, y, 0, 0, 0.8);
  }

  private puff(x: number, y: number, dirX: number, dirY: number, amount: number) {
    const len = Math.hypot(dirX, dirY);
    if (len > 0.01) this.dir.set(-dirX / len, 0.15, -dirY / len).normalize();
    else this.dir.set(0, 0.1, 0);
    // Petits nuages qui partent à l'opposé du mouvement et s'étalent au ras du sol.
    this.dust.emit(x, 2, y, this.dir, Math.round(9 * amount), 46, len > 0.01 ? 0.8 : 1, 6, '#b39d7c', 0.7, 2.2, 0.12);
  }

  private decal(x: number, y: number, radius: number, kind: DecalKind) {
    const decal = this.decals[this.nextDecal];
    this.nextDecal = (this.nextDecal + 1) % DECALS;
    const { mesh } = decal;
    mesh.material.map = this.textures[kind];
    mesh.material.color.set(kind === 'scorch' ? '#2a1a12' : kind === 'wet' ? '#1f3436' : '#140e0a');
    mesh.position.set(x, 0.35 + this.nextDecal * 0.02, y);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.scale.setScalar(radius);
    decal.age = 0;
    decal.hold = kind === 'wet' ? 2.2 : 3.2;
    decal.fade = 2.5;
    decal.peak = kind === 'wet' ? 0.55 : 0.8;
    mesh.material.opacity = 0;
    mesh.visible = true;
  }

  private flash(x: number, y: number, height: number, color: string, intensity: number, duration: number) {
    const flash = this.flashes[this.nextFlash];
    this.nextFlash = (this.nextFlash + 1) % this.flashes.length;
    flash.light.position.set(x, height, y);
    flash.light.color.set(color);
    flash.peak = intensity;
    flash.duration = duration;
    flash.t = 0;
    flash.light.intensity = intensity;
  }

  private shake(axis: 'horizontal' | 'vertical', strength: number) {
    if (this.shakes.length >= 4) this.shakes.shift();
    this.shakes.push({ axis, amp: strength * SHAKE_PIXELS, t: 0, phase: Math.random() * 0.6,
      sign: Math.random() < 0.5 ? -1 : 1 });
  }

  // ─── Textures des décalques (générées une fois) ────────────────────────

  private canvas(draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    draw(ctx, 128);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    return texture;
  }

  /** Fissures noires qui rayonnent depuis le point d'impact. */
  private crackTexture() {
    return this.canvas((ctx, size) => {
      const c = size / 2;
      const glow = ctx.createRadialGradient(c, c, 0, c, c, c * 0.5);
      glow.addColorStop(0, '#ffffffb0');
      glow.addColorStop(1, '#ffffff00');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        let a = i / 9 * Math.PI * 2 + Math.random() * 0.4;
        let d = 4;
        let w = 3.2;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * d, c + Math.sin(a) * d);
        while (d < c * (0.7 + Math.random() * 0.3)) {
          d += 5 + Math.random() * 8;
          a += (Math.random() - 0.5) * 0.5;
          ctx.lineWidth = w;
          ctx.lineTo(c + Math.cos(a) * d, c + Math.sin(a) * d);
          w = Math.max(0.8, w * 0.82);
        }
        ctx.stroke();
      }
    });
  }

  private scorchTexture() {
    return this.canvas((ctx, size) => {
      const c = size / 2;
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * c * 0.35;
        const r = c * (0.25 + Math.random() * 0.35);
        const g = ctx.createRadialGradient(c + Math.cos(a) * d, c + Math.sin(a) * d, 0,
          c + Math.cos(a) * d, c + Math.sin(a) * d, r);
        g.addColorStop(0, '#ffffff50');
        g.addColorStop(1, '#ffffff00');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      }
    });
  }

  private wetTexture() {
    return this.canvas((ctx, size) => {
      const c = size / 2;
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 11; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = i === 0 ? 0 : c * (0.2 + Math.random() * 0.55);
        const r = i === 0 ? c * 0.42 : c * (0.06 + Math.random() * 0.12);
        ctx.beginPath();
        ctx.ellipse(c + Math.cos(a) * d, c + Math.sin(a) * d, r, r * 0.75, a, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}

/**
 * Flash d'impact sur un modèle : pousse l'émissif de tous ses matériaux
 * standards vers une couleur vive, puis le rend.
 *
 * Certains rigs réécrivent leur émissif à chaque image (cœur du Gardien) et
 * d'autres jamais : on restaure donc avant la mise à jour du rig la valeur
 * mémorisée juste avant le flash, puis on réapplique après. Ça marche dans
 * les deux cas sans connaître le rig.
 */
export class HitFlash {
  private readonly materials: T.MeshStandardMaterial[] = [];
  private readonly saved: T.Color[] = [];
  private readonly color = new T.Color('#ffffff');
  private level = 0;
  private applied = false;

  constructor(root: T.Object3D) {
    root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (material instanceof T.MeshStandardMaterial && !this.materials.includes(material)) {
          this.materials.push(material);
          this.saved.push(material.emissive.clone());
        }
      }
    });
  }

  trigger(color: T.ColorRepresentation, strength = 1) {
    this.color.set(color);
    this.level = Math.max(this.level, Math.min(1, strength));
  }

  /** À appeler avant la mise à jour du rig. */
  restore() {
    if (!this.applied) return;
    this.materials.forEach((material, i) => material.emissive.copy(this.saved[i]));
    this.applied = false;
  }

  /** À appeler après la mise à jour du rig. Le flash ne s'éteint pas pendant le gel. */
  apply(dt: number, frozen: boolean) {
    if (this.level <= 0) return;
    const k = this.level * this.level;
    this.materials.forEach((material, i) => {
      this.saved[i].copy(material.emissive);
      material.emissive.lerp(this.color, k);
    });
    this.applied = true;
    if (!frozen) this.level = Math.max(0, this.level - dt * 9);
  }

  clear() {
    this.restore();
    this.level = 0;
  }
}
