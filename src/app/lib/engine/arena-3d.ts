import * as T from 'three';
import { sceneryRandom } from '../constants/scenery';
import { FORD_DUEL, SLUICE_DUEL, type DuelArena } from './duel-fog';
import { applyWind } from './wind';

/**
 * Habillage 3D des deux arènes de duel (gué de l'Ouest, ancienne retenue).
 *
 * Tout est construit une seule fois au démarrage puis simplement affiché ou
 * masqué : aucune allocation, aucun shader compilé pendant un combat. Chaque
 * arène ne coûte qu'une dizaine de draw calls (instancing partout), et une
 * seule lumière ponctuelle partagée reste en permanence dans la scène pour
 * que le nombre de lumières (donc les shaders) ne change jamais.
 */

interface Mood {
  fog: T.Color;
  fogDensity: number;
  background: T.Color;
  hemi: number;
  sun: number;
  sunColor: T.Color;
  glow: T.Color;
  glowIntensity: number;
}

/** Ambiance d'une carte hors arène (prologue), en couleurs CSS. */
export interface RegionMood {
  fog: string; fogDensity: number; background: string; hemi: number; sun: number; sunColor: string;
  /** Direction d'où vient le soleil (lumière rasante), et couleurs du ciel/sol de l'hémisphère. */
  sunPosition?: [number, number, number];
  hemiSky?: string;
  hemiGround?: string;
}

interface Flicker { index: number; base: T.Matrix4; phase: number }

interface Dressing {
  arena: DuelArena;
  group: T.Group;
  mood: Mood;
  wall: T.Mesh<T.CylinderGeometry, T.MeshBasicMaterial>;
  seal: T.Mesh<T.RingGeometry, T.MeshBasicMaterial>;
  flames: T.InstancedMesh;
  flickers: Flicker[];
  glows: T.Points<T.BufferGeometry, T.PointsMaterial>;
  motes: T.Points<T.BufferGeometry, T.PointsMaterial>;
  moteSeeds: Float32Array;
  moteRise: number;
  banners?: T.InstancedMesh;
  bannerBase: T.Matrix4[];
}

const MOTES = 150;

export class ArenaDressing {
  readonly root = new T.Group();
  private readonly dressings: Dressing[];
  private readonly glowLight = new T.PointLight('#ff9a4a', 0, 1, 0);
  private readonly hemi?: T.HemisphereLight;
  private readonly sun?: T.DirectionalLight;
  private readonly base: Mood;
  private readonly current: Mood;
  private readonly textures: T.Texture[] = [];
  private readonly matrix = new T.Matrix4();
  private readonly rotation = new T.Matrix4();
  private active?: Dressing;
  /** Ambiance de la carte en cours hors arène (setRegionMood). */
  private region: Mood | null = null;

  constructor(private readonly scene: T.Scene, renderer: T.WebGLRenderer, camera: T.Camera) {
    this.hemi = scene.children.find((o): o is T.HemisphereLight => o instanceof T.HemisphereLight);
    this.sun = scene.children.find((o): o is T.DirectionalLight => o instanceof T.DirectionalLight);
    const fog = scene.fog as T.FogExp2;
    const clear = renderer.getClearColor(new T.Color());
    this.base = {
      fog: fog.color.clone(), fogDensity: fog.density, background: clear,
      hemi: this.hemi?.intensity ?? 2, sun: this.sun?.intensity ?? 2.6,
      sunColor: this.sun?.color.clone() ?? new T.Color('#ffd3a0'),
      glow: new T.Color('#ff9a4a'), glowIntensity: 0,
    };
    this.current = { ...this.base, fog: this.base.fog.clone(), background: clear.clone(),
      sunColor: this.base.sunColor.clone(), glow: this.base.glow.clone() };
    scene.background = this.current.background;

    this.glowLight.position.set(0, 70, 0);
    this.root.add(this.glowLight);
    const glowTexture = this.track(this.softDot());
    this.dressings = [
      this.buildFord(glowTexture),
      this.buildSluice(glowTexture),
    ];
    for (const dressing of this.dressings) this.root.add(dressing.group);
    scene.add(this.root);
    // Compile les shaders de l'habillage dès maintenant (sans tenir compte du
    // cadrage) : l'apparition de la seconde arène ne provoque aucun à-coup.
    renderer.compile(this.root, camera, scene);
    for (const dressing of this.dressings) dressing.group.visible = false;
  }

  /** Objets masqués à rendre visibles le temps de compiler les shaders. */
  get warmObjects(): T.Object3D[] {
    return this.dressings.map((dressing) => dressing.group);
  }

  update(arena: DuelArena | undefined, now: number, dt: number) {
    const next = arena ? this.dressings.find((d) => d.arena === arena || (
      d.arena.x === arena.x && d.arena.y === arena.y)) : undefined;
    if (next !== this.active) {
      if (this.active) this.active.group.visible = false;
      this.active = next;
      if (next) {
        next.group.visible = true;
        this.glowLight.position.set(next.arena.x, 70, next.arena.y);
        this.glowLight.distance = next.arena.radius * 1.9;
        this.glowLight.color.copy(next.mood.glow);
      }
    }
    this.blendMood(this.active?.mood ?? this.region ?? this.base, dt);
    if (!this.active) return;

    const d = this.active;
    const t = now / 1000;
    const pulse = 0.5 + Math.sin(t * 1.7) * 0.5;
    d.wall.material.map!.offset.x = t * 0.012;
    d.wall.material.opacity = 0.08 + pulse * 0.05;
    d.seal.material.opacity = 0.32 + pulse * 0.22;
    this.glowLight.intensity = this.current.glowIntensity * (0.92 + Math.sin(t * 13.1) * 0.05 + Math.sin(t * 7.3) * 0.04);

    for (const flicker of d.flickers) {
      const s = 0.85 + Math.sin(t * 17 + flicker.phase) * 0.12 + Math.sin(t * 9.3 + flicker.phase * 2) * 0.08;
      this.matrix.makeScale(1, s, 1).premultiply(flicker.base);
      d.flames.setMatrixAt(flicker.index, this.matrix);
    }
    d.flames.instanceMatrix.needsUpdate = true;

    if (d.banners) {
      d.bannerBase.forEach((base, i) => {
        this.rotation.makeRotationX(Math.sin(t * 2.1 + i * 1.7) * 0.22);
        this.matrix.multiplyMatrices(base, this.rotation);
        d.banners!.setMatrixAt(i, this.matrix);
      });
      d.banners.instanceMatrix.needsUpdate = true;
    }

    // Particules : positions recalculées à partir de graines fixes (pas d'état).
    const positions = d.motes.geometry.attributes['position'] as T.BufferAttribute;
    const array = positions.array as Float32Array;
    const radius = d.arena.radius;
    for (let i = 0; i < MOTES; i++) {
      const angle = d.moteSeeds[i * 4] + t * 0.05 * (i % 2 ? 1 : -1);
      const distance = d.moteSeeds[i * 4 + 1] * radius;
      const speed = d.moteSeeds[i * 4 + 2];
      const wobble = d.moteSeeds[i * 4 + 3];
      const climb = (wobble * 90 + t * speed * Math.abs(d.moteRise)) % 90;
      array[i * 3] = Math.cos(angle) * distance + Math.sin(t * 0.8 + wobble * 9) * 4;
      array[i * 3 + 1] = d.moteRise > 0 ? 2 + climb : 92 - climb;
      array[i * 3 + 2] = Math.sin(angle) * distance + Math.cos(t * 0.7 + wobble * 7) * 4;
    }
    positions.needsUpdate = true;
  }

  dispose() {
    this.root.traverse((object) => {
      if (object instanceof T.Mesh || object instanceof T.Points) {
        object.geometry.dispose();
        (object.material as T.Material).dispose();
      }
    });
    this.textures.forEach((texture) => texture.dispose());
    this.scene.remove(this.root);
    this.scene.background = null;
  }

  // ─── Ambiance ────────────────────────────────────────────────────────────

  private basePose?: { sun: T.Vector3; sky: T.Color; ground: T.Color };

  setRegionMood(mood: RegionMood | null) {
    // Direction du soleil et teintes de l'hémisphère : propres à la carte, rendues à sa sortie.
    this.basePose ??= {
      sun: this.sun?.position.clone() ?? new T.Vector3(),
      sky: this.hemi?.color.clone() ?? new T.Color(),
      ground: this.hemi?.groundColor.clone() ?? new T.Color(),
    };
    if (this.sun) this.sun.position.copy(mood?.sunPosition ? new T.Vector3(...mood.sunPosition) : this.basePose.sun);
    if (this.hemi) {
      this.hemi.color.copy(mood?.hemiSky ? new T.Color(mood.hemiSky) : this.basePose.sky);
      this.hemi.groundColor.copy(mood?.hemiGround ? new T.Color(mood.hemiGround) : this.basePose.ground);
    }
    this.region = mood && {
      fog: new T.Color(mood.fog), fogDensity: mood.fogDensity, background: new T.Color(mood.background),
      hemi: mood.hemi, sun: mood.sun, sunColor: new T.Color(mood.sunColor),
      glow: this.base.glow, glowIntensity: 0,
    };
  }

  private blendMood(target: Mood, dt: number) {
    const k = 1 - Math.exp(-1.6 * dt);
    const c = this.current;
    c.fog.lerp(target.fog, k);
    c.background.lerp(target.background, k);
    c.sunColor.lerp(target.sunColor, k);
    c.fogDensity += (target.fogDensity - c.fogDensity) * k;
    c.hemi += (target.hemi - c.hemi) * k;
    c.sun += (target.sun - c.sun) * k;
    c.glowIntensity += (target.glowIntensity - c.glowIntensity) * k;
    const fog = this.scene.fog as T.FogExp2;
    fog.color.copy(c.fog);
    fog.density = c.fogDensity;
    if (this.hemi) this.hemi.intensity = c.hemi;
    if (this.sun) {
      this.sun.intensity = c.sun;
      this.sun.color.copy(c.sunColor);
    }
    if (!this.active) this.glowLight.intensity = c.glowIntensity;
  }

  // ─── Gué du Pra : duel contre Kofi Brempong ────────────────────────────────

  private buildFord(glowTexture: T.Texture): Dressing {
    const arena = FORD_DUEL;
    const random = sceneryRandom(911);
    const group = new T.Group();
    group.position.set(arena.x, 0, arena.y);
    const r = arena.radius;

    group.add(this.floor(r, 'ford', random));
    const wall = this.wall(r, '#ffc98a');
    const seal = this.seal(r, '#ffb56b');
    group.add(wall, seal);

    // Pieux de bois plantés en cercle, reliés par la corde du gué.
    const stakes = 30;
    const posts = new T.InstancedMesh(new T.CylinderGeometry(1.3, 2.1, 1, 6),
      this.flat('#5d4330'), stakes);
    const tops: T.Vector3[] = [];
    const o = new T.Object3D();
    for (let i = 0; i < stakes; i++) {
      const a = i / stakes * Math.PI * 2 + random() * 0.05;
      const height = 20 + random() * 12;
      const distance = r + 16;
      o.position.set(Math.cos(a) * distance, height / 2 - 1, Math.sin(a) * distance);
      o.rotation.set(Math.sin(a) * 0.12 * (random() - 0.2), 0, -Math.cos(a) * 0.12 * (random() - 0.2));
      o.scale.set(1, height, 1);
      o.updateMatrix();
      posts.setMatrixAt(i, o.matrix);
      tops.push(new T.Vector3(Math.cos(a) * distance, height * 0.78, Math.sin(a) * distance));
    }
    group.add(posts);

    const path: T.Vector3[] = [];
    tops.forEach((top, i) => {
      const next = tops[(i + 1) % tops.length];
      path.push(top, top.clone().lerp(next, 0.5).setY(Math.min(top.y, next.y) - 5));
    });
    const rope = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(path, true), path.length * 4, 0.5, 4, true),
      this.flat('#b08a55'));
    group.add(rope);

    // Bandes d'étoffe nouées à quelques pieux (couleurs de pagne).
    const bannerCount = 10;
    // Subdivisée en hauteur pour que le vent (vertex shader) la fasse onduler.
    const banners = new T.InstancedMesh(new T.PlaneGeometry(4.5, 13, 1, 6).translate(0, -6.5, 0),
      applyWind(new T.MeshStandardMaterial({ roughness: 0.9, side: T.DoubleSide }),
        { anchor: 0, tip: -13, amplitude: 1.3, sway: [0.25, 1], ripple: 0.8, speed: 1.6 }), bannerCount);
    const bannerBase: T.Matrix4[] = [];
    const cloth = ['#b0372a', '#d8a23a', '#2f6b4a', '#1f3f66'];
    for (let i = 0; i < bannerCount; i++) {
      const top = tops[i * 3];
      o.position.set(top.x, top.y + 2, top.z);
      o.rotation.set(0, -Math.atan2(top.z, top.x) + Math.PI / 2, 0);
      o.scale.set(1, 1, 1);
      o.updateMatrix();
      bannerBase.push(o.matrix.clone());
      banners.setMatrixAt(i, o.matrix);
      banners.setColorAt(i, new T.Color(cloth[i % cloth.length]));
    }
    group.add(banners);

    // Bois flotté et galets au bord, côté rivière surtout.
    const drift = new T.InstancedMesh(new T.CylinderGeometry(1.6, 2.2, 1, 6), this.flat('#7b6650'), 9);
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + (random() - 0.5) * 2.4;
      const distance = r + 4 + random() * 22;
      o.position.set(Math.cos(a) * distance, 1.4, Math.sin(a) * distance);
      o.rotation.set(Math.PI / 2, random() * Math.PI, 0);
      o.scale.set(1, 18 + random() * 22, 1);
      o.updateMatrix();
      drift.setMatrixAt(i, o.matrix);
    }
    const pebbles = this.scatterStones(r, random, 26, '#8b8169', 2.5, 5);
    group.add(drift, pebbles);

    // Quatre torches sur perche, en diagonale pour ne pas masquer l'axe de visée.
    const torchAngles = [0.25, 0.75, 1.25, 1.75].map((k) => k * Math.PI);
    const torches = torchAngles.map((a) => new T.Vector3(Math.cos(a) * (r + 26), 34, Math.sin(a) * (r + 26)));
    const poles = new T.InstancedMesh(new T.CylinderGeometry(0.9, 1.3, 34, 5).translate(0, 17, 0),
      this.flat('#4a3424'), torches.length);
    const heads = new T.InstancedMesh(new T.CylinderGeometry(2.6, 1.6, 4, 6), this.flat('#2c211a'), torches.length);
    torches.forEach((p, i) => {
      o.position.set(p.x, 0, p.z); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.updateMatrix();
      poles.setMatrixAt(i, o.matrix);
      o.position.set(p.x, 34, p.z); o.updateMatrix();
      heads.setMatrixAt(i, o.matrix);
    });
    group.add(poles, heads);
    const fire = this.flames(torches.map((p) => p.clone().setY(p.y + 2)), '#ffb04a', 5, 2.6);
    group.add(fire.mesh);
    const glows = this.glowPoints(torches.map((p) => p.clone().setY(p.y + 6)), glowTexture, '#ff9a4a', 46);
    group.add(glows);

    const motes = this.motes(glowTexture, '#ffc070', 2.4);
    group.add(motes.points);

    return {
      arena, group, wall, seal, flames: fire.mesh, flickers: fire.flickers, glows,
      motes: motes.points, moteSeeds: motes.seeds, moteRise: 1, banners, bannerBase,
      mood: {
        fog: new T.Color('#86705a'), fogDensity: 0.0020, background: new T.Color('#6f5b49'),
        hemi: 1.55, sun: 2.1, sunColor: new T.Color('#ffae70'),
        glow: new T.Color('#ff9a4a'), glowIntensity: 0.45,
      },
    };
  }

  // ─── Ancienne retenue : combat contre le Gardien noyé ─────────────────────────

  private buildSluice(glowTexture: T.Texture): Dressing {
    const arena = SLUICE_DUEL;
    const random = sceneryRandom(4127);
    const group = new T.Group();
    group.position.set(arena.x, 0, arena.y);
    const r = arena.radius;

    group.add(this.floor(r, 'sluice', random));
    const wall = this.wall(r, '#8fe8d2');
    const seal = this.seal(r, '#6fe0c4');
    group.add(wall, seal);

    // Pierres levées de l'ancienne digue, irrégulières.
    const count = 18;
    const menhirs = new T.InstancedMesh(new T.DodecahedronGeometry(1, 0), this.flat('#5b6258'), count);
    const o = new T.Object3D();
    for (let i = 0; i < count; i++) {
      const a = i / count * Math.PI * 2 + (random() - 0.5) * 0.12;
      const distance = r + 18 + random() * 10;
      const height = 14 + random() * 20;
      o.position.set(Math.cos(a) * distance, height * 0.42, Math.sin(a) * distance);
      o.rotation.set((random() - 0.5) * 0.3, random() * Math.PI, (random() - 0.5) * 0.3);
      o.scale.set(6 + random() * 4, height, 5 + random() * 3);
      o.updateMatrix();
      menhirs.setMatrixAt(i, o.matrix);
    }
    group.add(menhirs);

    // Blocs effondrés de la digue, à moitié enfouis.
    const blocks = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), this.flat('#6f6a58'), 16);
    for (let i = 0; i < 16; i++) {
      const a = random() * Math.PI * 2;
      const distance = r + 2 + random() * 34;
      const size = 7 + random() * 9;
      o.position.set(Math.cos(a) * distance, size * 0.2, Math.sin(a) * distance);
      o.rotation.set((random() - 0.5) * 0.8, random() * Math.PI, (random() - 0.5) * 0.8);
      o.scale.set(size * 1.4, size * 0.7, size);
      o.updateMatrix();
      blocks.setMatrixAt(i, o.matrix);
    }
    const shards = this.scatterStones(r, random, 30, '#4d5a55', 2, 6);
    group.add(blocks, shards);

    // Braseros de pierre : feux pâles, de la couleur du cœur du Gardien.
    const angles = [0.15, 0.65, 1.15, 1.65].map((k) => k * Math.PI);
    const spots = angles.map((a) => new T.Vector3(Math.cos(a) * (r + 30), 0, Math.sin(a) * (r + 30)));
    const bowls = new T.InstancedMesh(new T.CylinderGeometry(6, 3.5, 9, 7).translate(0, 4.5, 0),
      this.flat('#474c45'), spots.length);
    spots.forEach((p, i) => {
      o.position.copy(p); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.updateMatrix();
      bowls.setMatrixAt(i, o.matrix);
    });
    group.add(bowls);
    const fire = this.flames(spots.map((p) => p.clone().setY(9)), '#9ff5df', 7, 4);
    group.add(fire.mesh);
    const glows = this.glowPoints(spots.map((p) => p.clone().setY(16)), glowTexture, '#5fd6bb', 56);
    group.add(glows);

    const motes = this.motes(glowTexture, '#8af0d6', 2.8);
    group.add(motes.points);

    return {
      arena, group, wall, seal, flames: fire.mesh, flickers: fire.flickers, glows,
      motes: motes.points, moteSeeds: motes.seeds, moteRise: -0.6, bannerBase: [],
      mood: {
        fog: new T.Color('#5f6d68'), fogDensity: 0.0022, background: new T.Color('#4a5652'),
        hemi: 1.3, sun: 1.45, sunColor: new T.Color('#c4d9de'),
        glow: new T.Color('#6fe0c4'), glowIntensity: 0.4,
      },
    };
  }

  // ─── Briques communes ───────────────────────────────────────────────────

  private flat(color: string) {
    return new T.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true });
  }

  private track<X extends T.Texture>(texture: X) {
    this.textures.push(texture);
    return texture;
  }

  /** Sol de l'arène : terre piétinée, cercle rituel et détails selon le lieu. */
  private floor(radius: number, kind: 'ford' | 'sluice', random: () => number) {
    const size = 512;
    const extent = radius * 1.12;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const c = size / 2;
    const px = (world: number) => world / extent * c;

    const earth = ctx.createRadialGradient(c, c, 0, c, c, c);
    if (kind === 'ford') {
      earth.addColorStop(0, '#5a432fb0');
      earth.addColorStop(0.62, '#6b503888');
      earth.addColorStop(0.86, '#4a382a55');
    } else {
      earth.addColorStop(0, '#3c3a32b8');
      earth.addColorStop(0.62, '#4a473c90');
      earth.addColorStop(0.86, '#33372f55');
    }
    earth.addColorStop(1, '#00000000');
    ctx.fillStyle = earth;
    ctx.fillRect(0, 0, size, size);

    // Traces de pas et de glissades en arcs.
    ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const a = random() * Math.PI * 2;
      const d = random() * px(radius) * 0.85;
      ctx.strokeStyle = random() < 0.6 ? '#2a1d1240' : '#c9a57a26';
      ctx.lineWidth = 1 + random() * 3;
      ctx.beginPath();
      ctx.arc(c, c, d, a, a + 0.2 + random() * 0.6);
      ctx.stroke();
    }

    if (kind === 'ford') {
      // Flaques laissées par la rivière, côté ouest.
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + (random() - 0.5) * 1.8;
        const d = px(radius) * (0.45 + random() * 0.45);
        this.blob(ctx, c + Math.cos(a) * d, c + Math.sin(a) * d, 6 + random() * 12, '#2f4a4a55');
      }
    } else {
      // Eau couleur de fer et fissures qui partent du centre.
      for (let i = 0; i < 11; i++) {
        const a = random() * Math.PI * 2;
        const d = px(radius) * random() * 0.8;
        this.blob(ctx, c + Math.cos(a) * d, c + Math.sin(a) * d, 6 + random() * 13, '#7a3f2277');
      }
      for (let i = 0; i < 14; i++) {
        let a = random() * Math.PI * 2;
        let d = px(radius) * 0.08;
        ctx.strokeStyle = '#161a16a0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * d, c + Math.sin(a) * d);
        while (d < px(radius) * 0.75) {
          d += 8 + random() * 14;
          a += (random() - 0.5) * 0.35;
          ctx.lineTo(c + Math.cos(a) * d, c + Math.sin(a) * d);
        }
        ctx.stroke();
      }
    }

    // Cercle rituel tracé au bord : double trait et marques régulières.
    const ring = px(radius) * 0.95;
    ctx.strokeStyle = kind === 'ford' ? '#e2c08c70' : '#b6e4d470';
    ctx.lineWidth = 2;
    for (const k of [1, 0.955]) {
      ctx.beginPath();
      ctx.arc(c, c, ring * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = ctx.strokeStyle;
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      const x = c + Math.cos(a) * ring * 0.977;
      const y = c + Math.sin(a) * ring * 0.977;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      if (i % 3 === 0) ctx.fillRect(-1.5, -5, 3, 10);
      else ctx.fillRect(-1.5, -1.5, 3, 3);
      ctx.restore();
    }

    const texture = this.track(new T.CanvasTexture(canvas));
    texture.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(new T.CircleGeometry(extent, 64), new T.MeshStandardMaterial({
      map: texture, transparent: true, depthWrite: false, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.3;
    mesh.renderOrder = 1;
    return mesh;
  }

  /** Voile lumineux vertical qui matérialise la limite du duel. */
  private wall(radius: number, color: string) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const fade = ctx.createLinearGradient(0, 64, 0, 0);
    fade.addColorStop(0, '#ffffffff');
    fade.addColorStop(0.35, '#ffffff70');
    fade.addColorStop(1, '#ffffff00');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 128, 64);
    ctx.globalCompositeOperation = 'destination-out';
    const random = sceneryRandom(77);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.3 + random() * 0.5})`;
      ctx.fillRect(random() * 128, 0, 2 + random() * 8, 64);
    }
    const texture = this.track(new T.CanvasTexture(canvas));
    texture.wrapS = T.RepeatWrapping;
    texture.repeat.set(10, 1);
    const mesh = new T.Mesh(new T.CylinderGeometry(radius + 2, radius + 2, 30, 96, 1, true), new T.MeshBasicMaterial({
      color, map: texture, transparent: true, opacity: 0.24, depthWrite: false,
      side: T.DoubleSide, blending: T.AdditiveBlending, fog: false,
    }));
    mesh.position.y = 15;
    mesh.renderOrder = 3;
    return mesh;
  }

  /** Anneau lumineux posé au sol, à la limite exacte du terrain jouable. */
  private seal(radius: number, color: string) {
    const mesh = new T.Mesh(new T.RingGeometry(radius - 2.5, radius + 1.5, 128), new T.MeshBasicMaterial({
      color, transparent: true, opacity: 0.4, depthWrite: false, blending: T.AdditiveBlending,
    }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.6;
    mesh.renderOrder = 2;
    return mesh;
  }

  private flames(spots: T.Vector3[], color: string, height: number, width: number) {
    const mesh = new T.InstancedMesh(new T.ConeGeometry(width, height, 6).translate(0, height / 2, 0),
      new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, fog: false }), spots.length);
    mesh.userData['bloom'] = true; // flammes : halo du post-traitement
    const o = new T.Object3D();
    const flickers = spots.map((p, index) => {
      o.position.copy(p);
      o.updateMatrix();
      mesh.setMatrixAt(index, o.matrix);
      return { index, base: o.matrix.clone(), phase: index * 2.4 };
    });
    return { mesh, flickers };
  }

  private glowPoints(spots: T.Vector3[], map: T.Texture, color: string, size: number) {
    const geometry = new T.BufferGeometry().setFromPoints(spots);
    return new T.Points(geometry, new T.PointsMaterial({
      map, color, size, sizeAttenuation: true, transparent: true, opacity: 0.85,
      depthWrite: false, blending: T.AdditiveBlending,
    }));
  }

  private motes(map: T.Texture, color: string, size: number) {
    const random = sceneryRandom(color.length * 131 + size * 17);
    const seeds = new Float32Array(MOTES * 4);
    for (let i = 0; i < MOTES; i++) {
      seeds[i * 4] = random() * Math.PI * 2;
      seeds[i * 4 + 1] = Math.sqrt(random()) * 0.97;
      seeds[i * 4 + 2] = 3 + random() * 7;
      seeds[i * 4 + 3] = random();
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(MOTES * 3), 3));
    geometry.boundingSphere = new T.Sphere(new T.Vector3(0, 45, 0), 320);
    const points = new T.Points(geometry, new T.PointsMaterial({
      map, color, size, sizeAttenuation: true, transparent: true, opacity: 0.8,
      depthWrite: false, blending: T.AdditiveBlending,
    }));
    return { points, seeds };
  }

  private scatterStones(radius: number, random: () => number, count: number, color: string, min: number, max: number) {
    const stones = new T.InstancedMesh(new T.DodecahedronGeometry(1, 0), this.flat(color), count);
    const o = new T.Object3D();
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const d = radius + (random() - 0.3) * 30;
      const s = min + random() * (max - min);
      o.position.set(Math.cos(a) * d, s * 0.3, Math.sin(a) * d);
      o.rotation.set(random() * 3, random() * 3, random() * 3);
      o.scale.set(s * 1.3, s * 0.6, s);
      o.updateMatrix();
      stones.setMatrixAt(i, o.matrix);
    }
    return stones;
  }

  private softDot() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, '#ffffffff');
    g.addColorStop(0.25, '#ffffffa0');
    g.addColorStop(1, '#ffffff00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    return texture;
  }

  private blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.65, x * 0.01, 0, Math.PI * 2);
    ctx.fill();
  }
}
