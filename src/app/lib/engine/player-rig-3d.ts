import * as T from 'three';
import type { Actor3D } from './world-3d';
import { HUMANOID_BONES, type HumanoidRig } from './humanoid-rig';
import { BipedGait, PLAYER_GAIT } from './gait';

/**
 * Animateur procédural du joueur en 3D.
 *
 * Chaque articulation suit sa cible à travers un ressort amorti : les poses
 * clés (anticipation, impact, récupération…) ne donnent que des cibles, et les
 * ressorts fournissent gratuitement le fondu entre états, le dépassement
 * (follow-through) et l'inertie. Le bras de la lance et le poignet sont un peu
 * plus mous que le buste : l'arme « traîne » derrière le corps puis fouette.
 *
 * Découpage d'une attaque (pose.state) : 'windup' → 'attacking' → 'recover',
 * avec pose.phase de 0 à 1 dans chaque morceau. Pendant un gel d'impact
 * (pose.hitstop) les ressorts sont figés et le corps tremble légèrement.
 */

/** Le joueur utilise le squelette humanoïde partagé (humanoid-rig.ts). */
type Rig = HumanoidRig;

const CHANNELS = [
  'tY', 'tF', 'rX', 'rY', 'rZ',
  'aLx', 'aLy', 'aLz', 'aRx', 'aRy', 'aRz', 'wr',
  'lLx', 'lLz', 'lRx', 'lRz',
] as const;
type Channel = typeof CHANNELS[number];
type Pose = Partial<Record<Channel, number>>;
const N = CHANNELS.length;
const I = Object.fromEntries(CHANNELS.map((c, i) => [c, i])) as Record<Channel, number>;

const TAU = Math.PI * 2;
const LEG = 13.45;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeInCubic = (t: number) => t * t * t;
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Hors combat : bras relâchés, lance tenue basse. */
const REST: Pose = { aRz: -0.14, aLz: -0.06 };

/** En combat : genoux fléchis, buste de trois-quarts, lance pointée, main libre devant. */
const GUARD: Pose = {
  rX: 0.1, rY: 0.28,
  aRx: -0.5, aRz: 0.05, wr: 0.42,
  aLx: -0.55, aLy: 0.3, aLz: -0.35,
  lLx: -0.3, lLz: -0.08, lRx: 0.24, lRz: 0.08,
};

/** Poses clés : a = anticipation (fin du windup), s = fin de l'impact. */
const ATTACKS: Record<string, { a: Pose; s: Pose; tint: [number, number, number] }> = {
  // 1. Fauche horizontale : le buste s'arme côté lance puis balaie en travers.
  light0: {
    a: { rY: 0.95, rX: -0.05, rZ: 0.08, aRx: -0.9, aRy: -0.4, aRz: 0.75, wr: 0.7,
      aLx: -0.7, aLz: -0.5, lLx: -0.35, lRx: 0.3 },
    s: { rY: -0.85, rX: 0.22, rZ: -0.1, aRx: -1.15, aRy: 0.5, aRz: 0.25, wr: 0.75,
      aLx: 0.35, aLz: -0.15, lLx: -0.55, lRx: 0.4, tF: 2.5 },
    tint: [1, 0.9, 0.68],
  },
  // 2. Revers montant : repart de l'autre côté et remonte la lance.
  light1: {
    a: { rY: -0.9, rX: 0.25, aRx: -0.3, aRy: 0.4, aRz: -0.35, wr: 1.0,
      aLx: 0.2, lLx: 0.35, lRx: -0.4 },
    s: { rY: 0.75, rX: -0.12, rZ: 0.12, aRx: -1.7, aRy: -0.3, aRz: 0.45, wr: 1.15,
      aLx: -0.6, aLz: -0.6, lLx: -0.3, lRx: 0.35, tY: 0.8, tF: 1.5 },
    tint: [1, 0.9, 0.68],
  },
  // 3. Estoc fendu : recul de la lance, poids sur l'arrière, puis détente.
  light2: {
    a: { rY: 0.75, rX: -0.18, tF: -3, aRx: 0.55, aRz: 0.2, wr: -0.35,
      aLx: -0.9, aLz: -0.4, lLx: -0.4, lRx: 0.55 },
    s: { rY: -0.35, rX: 0.42, tF: 6, aRx: -1.25, aRz: 0.05, wr: 1.25,
      aLx: 0.7, aLz: -0.2, lLx: -0.85, lRx: 0.75 },
    tint: [1, 0.84, 0.55],
  },
  // Lourde : la lance monte au-dessus de la tête, le corps se grandit, puis s'abat.
  heavy: {
    a: { rY: 0.2, rX: -0.32, tY: 1.6, aRx: -2.75, aRz: 0.15, wr: -0.2,
      aLx: -2.3, aLz: -0.25, lLx: -0.2, lRx: 0.25 },
    s: { rY: -0.15, rX: 0.62, tF: 4, aRx: -0.55, aRz: 0.05, wr: 0.6,
      aLx: -0.3, aLz: -0.2, lLx: -0.8, lRx: 0.7 },
    tint: [1, 0.68, 0.4],
  },
  // Riposte : estoc tournoyant (la vrille est ajoutée à part, sur la racine).
  counter: {
    a: { rY: 0.5, rX: -0.1, tF: -1.5, aRx: 0.3, wr: -0.2, aLx: -0.7, lLx: -0.3, lRx: 0.45 },
    s: { rY: -0.3, rX: 0.45, tF: 6, aRx: -1.3, wr: 1.3, aLx: 0.7, aLz: -0.3, lLx: -0.9, lRx: 0.8 },
    tint: [0.75, 0.95, 0.92],
  },
};

/** Raideur (ω) et amortissement (ζ) des ressorts selon l'état. */
function springFor(state: string, attack: string): [number, number] {
  switch (state) {
    case 'windup': return attack === 'heavy' ? [15, 1] : [21, 1];
    case 'attacking': return [46, 0.72];
    case 'recover': return attack === 'heavy' ? [10, 0.68] : attack === 'light' ? [13, 0.66] : [11, 0.66];
    case 'rolling': return [30, 0.9];
    case 'hurt': return [22, 0.48];
    case 'exhausted': return [6, 1];
    case 'dead': return [11, 0.75];
    default: return [13, 1];
  }
}

/** Le bras de la lance et le poignet traînent un peu : effet de fouet. */
const OMEGA_SCALE = new Float32Array(N).fill(1);
const ZETA_SCALE = new Float32Array(N).fill(1);
for (const c of ['aRx', 'aRy', 'aRz'] as Channel[]) { OMEGA_SCALE[I[c]] = 0.9; ZETA_SCALE[I[c]] = 0.88; }
OMEGA_SCALE[I.wr] = 0.8; ZETA_SCALE[I.wr] = 0.85;
for (const c of ['lLx', 'lLz', 'lRx', 'lRz'] as Channel[]) OMEGA_SCALE[I[c]] = 1.1;

/**
 * Masque du bas du corps (blending haut/bas) : quand le joueur marche en
 * buvant, en visant ou en armant un coup, les jambes jouent la marche et le
 * torse garde son action. 1 = canal pris à la locomotion, 0 = à l'action.
 */
const LOWER_MASK = new Float32Array(N);
for (const c of ['lLx', 'lLz', 'lRx', 'lRz', 'tY'] as Channel[]) LOWER_MASK[I[c]] = 1;
LOWER_MASK[I.rZ] = 0.35; // balancement des hanches
LOWER_MASK[I.rX] = 0.2; // légère inclinaison dans la marche
/** États dont seul le haut du corps est animé : les jambes peuvent marcher dessous. */
const UPPER_BODY_STATES = new Set(['drinking', 'aiming', 'release', 'windup', 'blocking']);

const TRAIL = 11;
const SPEAR_TRAIL_TIP_Y = 22;
const SPEAR_TRAIL_INNER_Y = 9;
const SPEAR_TRAIL_TINT: [number, number, number] = [1, 0.74, 0.34];
const TRAIL_MATERIAL = new T.MeshBasicMaterial({
  vertexColors: true, transparent: true, depthWrite: false,
  side: T.DoubleSide, blending: T.AdditiveBlending,
});

/** Traînée lumineuse derrière la pointe de la lance pendant les coups. */
export class WeaponTrail {
  readonly mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly strength: Float32Array;
  private readonly tint: Float32Array;
  private readonly tip = new T.Vector3();
  private readonly inner = new T.Vector3();
  private primed = false;

  constructor(scene: T.Scene, private readonly samples = TRAIL,
    private readonly tipLocal = new T.Vector3(0, 18, 0),
    private readonly innerLocal = new T.Vector3(0, 8, 0)) {
    this.positions = new Float32Array(samples * 2 * 3);
    this.colors = new Float32Array(samples * 2 * 4);
    this.strength = new Float32Array(samples);
    this.tint = new Float32Array(samples * 3);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage));
    geometry.setAttribute('color', new T.BufferAttribute(this.colors, 4).setUsage(T.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < samples - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    this.mesh = new T.Mesh(geometry, TRAIL_MATERIAL);
    // Toujours « visible » pour être compilé au préchargement ; vide hors coups.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  /** Ajoute un échantillon (pointe et milieu de la lance, en coords monde). */
  push(weapon: T.Object3D, intensity: number, tint: [number, number, number]) {
    weapon.localToWorld(this.tip.copy(this.tipLocal));
    weapon.localToWorld(this.inner.copy(this.innerLocal));
    if (!this.primed) {
      for (let i = 0; i < this.samples; i++) this.write(i);
      this.primed = true;
    }
    this.positions.copyWithin(6, 0, (this.samples - 1) * 6);
    this.strength.copyWithin(1, 0, this.samples - 1);
    // Les anciens échantillons s'éteignent aussi avec le temps : la traînée
    // disparaît vite quand la lance s'arrête.
    for (let i = 1; i < this.samples; i++) this.strength[i] *= 0.8;
    this.tint.copyWithin(3, 0, (this.samples - 1) * 3);
    this.write(0);
    this.strength[0] = intensity;
    this.tint.set(tint, 0);

    let any = false;
    for (let i = 0; i < this.samples; i++) {
      const fade = 1 - i / (this.samples - 1);
      const alpha = this.strength[i] * fade * 0.55;
      if (alpha > 0.01) any = true;
      for (let side = 0; side < 2; side++) {
        const o = (i * 2 + side) * 4;
        this.colors[o] = this.tint[i * 3];
        this.colors[o + 1] = this.tint[i * 3 + 1];
        this.colors[o + 2] = this.tint[i * 3 + 2];
        this.colors[o + 3] = side === 0 ? alpha : alpha * 0.15;
      }
    }
    const geometry = this.mesh.geometry;
    geometry.attributes['position'].needsUpdate = true;
    geometry.attributes['color'].needsUpdate = true;
    geometry.setDrawRange(0, any ? (this.samples - 1) * 6 : 0);
  }

  private write(i: number) {
    this.positions.set([this.tip.x, this.tip.y, this.tip.z, this.inner.x, this.inner.y, this.inner.z], i * 6);
  }
}

export class PlayerAnimator {
  private readonly x = new Float32Array(N);
  private readonly v = new Float32Array(N);
  private readonly target = new Float32Array(N);
  private readonly wrist = new T.Group();
  private readonly trail: WeaponTrail;
  private readonly flashMaterials: T.MeshStandardMaterial[] = [];
  private heading: number | undefined;
  private speed = 0;
  private forward = 0;
  private side = 0;
  private turn = 0;
  private lean = 0;
  private run = 0;
  private lastX = 0;
  private lastY = 0;
  private lastState = '';
  private wasFrozen = false;
  private flash = 0;
  private knockForward = 0;
  private knockSide = 0;
  private placed = false;
  private shadow?: T.Object3D;
  private readonly upper = new Float32Array(N);
  /** Squash & stretch : > 0 étire vers l'avant, < 0 tasse verticalement. */
  private squash = 0;
  private squashV = 0;
  /**
   * Démarche calée sur la distance (gait.ts). Les jambes la suivent sans
   * ressort (un ressort lisserait l'appui linéaire et ferait glisser le pied) ;
   * gaitWeight fond l'entrée et la sortie de marche.
   */
  private readonly gait = new BipedGait(PLAYER_GAIT);
  private gaitWeight = 0;
  /** Hanches tournées vers le déplacement, buste vers l'ennemi (pas chassé). */
  private hip = 0;
  private backpedal = false;
  /** Part latérale restante une fois les hanches tournées (écart des jambes). */
  private lateral = 0;
  /** Contre-rotation du buste appliquée à la dernière image (relue par capture()). */
  private torsoTwist = 0;

  constructor(scene: T.Scene, private readonly rig: Rig, private readonly spear: T.Object3D) {
    // Lacet puis tangage local : nécessaire pour la roulade avant.
    rig.root.rotation.order = 'YXZ';
    // Poignet : la lance pivote autour de la main, plus autour de son milieu.
    const arm = spear.parent ?? rig.arms[1];
    this.wrist.name = HUMANOID_BONES.wrist;
    this.wrist.position.set(0, -8.5, 0.5);
    arm.add(this.wrist);
    this.wrist.add(spear);
    spear.position.set(0, 0, 9.5);
    this.trail = new WeaponTrail(scene, TRAIL,
      new T.Vector3(0, SPEAR_TRAIL_TIP_Y, 0), new T.Vector3(0, SPEAR_TRAIL_INNER_Y, 0));
    // L'ombre ne doit pas tourner avec le corps pendant la roulade.
    this.shadow = rig.root.children.find((c) => c instanceof T.Mesh && c.geometry instanceof T.CircleGeometry);
    if (this.shadow) scene.add(this.shadow);

    const parts: T.Object3D[] = [...rig.torso.children, ...rig.arms.flatMap((a) => a.children),
      ...rig.legs.flatMap((l) => l.children), spear];
    for (const part of parts) {
      if (part instanceof T.Mesh && part.material instanceof T.MeshStandardMaterial &&
          !this.flashMaterials.includes(part.material)) {
        this.flashMaterials.push(part.material);
      }
    }
    this.fill(REST);
    this.x.set(this.target);
  }

  update(pose: Actor3D, dt: number, now: number, engaged: boolean) {
    const frozen = !!pose.hitstop;
    const state = pose.state;
    const attack = pose.attack ?? 'none';
    const k = clamp01(pose.phase);
    const step = Math.max(0, (pose.step ?? 1) - 1);

    if (!this.placed) {
      this.lastX = pose.x;
      this.lastY = pose.y;
      this.placed = true;
    }

    // --- Mesure du déplacement réel (pour la marche, le pas chassé, l'inclinaison).
    const dx = pose.x - this.lastX;
    const dy = pose.y - this.lastY;
    this.lastX = pose.x;
    this.lastY = pose.y;
    const fLen = Math.hypot(pose.facingX, pose.facingY) || 1;
    const fx = pose.facingX / fLen;
    const fy = pose.facingY / fLen;
    if (!frozen && dt > 0) {
      const travel = Math.min(Math.hypot(dx, dy), 18);
      const speed = travel / dt;
      const blend = 1 - Math.exp(-14 * dt);
      const prevForward = this.forward;
      this.speed += (speed - this.speed) * blend;
      const unit = travel > 0.001 ? 1 / Math.hypot(dx, dy) : 0;
      this.forward += ((dx * fx + dy * fy) * unit - this.forward) * blend;
      this.side += ((dx * fy - dy * fx) * unit - this.side) * blend;
      this.lean += ((this.forward - prevForward) * 8 - this.lean) * (1 - Math.exp(-6 * dt));
      const runGoal = state === 'moving' || UPPER_BODY_STATES.has(state) ? smooth(175, 255, this.speed) : 0;
      this.run += (runGoal - this.run) * (1 - Math.exp(-(runGoal > this.run ? 12 : 7) * dt));
      this.stepGait(state, travel, dt);
    }

    // --- Entrées dans un état : impulsions de réaction et de recul.
    if (state !== this.lastState) {
      // Squash & stretch : impulsions sur un ressort mou, qui rebondit tout seul.
      if (state === 'attacking') this.squashV += attack === 'heavy' ? 16 : 11;
      else if (state === 'hurt') this.squashV -= 14;
      else if (this.lastState === 'rolling') this.squashV -= 9; // réception de la roulade
      if (this.lastState === 'moving' && state === 'idle') {
        // Arrêt : le buste part en arrière (freinage) et le bassin se pose.
        this.v[I.rX] -= 2.4 * this.gait.pace;
        this.v[I.tY] -= 5 * this.gait.pace;
      } else if (state === 'moving' && this.lastState === 'idle') {
        this.v[I.rX] += 1.4; // départ : on s'élance vers l'avant
      }
      if (state === 'hurt') {
        const kx = pose.knockX ?? 0;
        const ky = pose.knockY ?? 0;
        const kLen = Math.hypot(kx, ky) || 1;
        this.knockForward = (kx * fx + ky * fy) / kLen;
        this.knockSide = (kx * fy - ky * fx) / kLen;
        this.v[I.rX] += 9 * this.knockForward;
        this.v[I.rZ] += 7 * this.knockSide;
        this.v[I.tF] += 50 * this.knockForward;
        this.v[I.aLx] += 6;
        this.v[I.aRz] += 5;
        this.flash = 1;
      } else if (state === 'attacking') {
        // Départ de l'impact : petit coup de reins vers l'avant.
        this.v[I.rX] += attack === 'heavy' ? 2.5 : 1.2;
      }
      this.lastState = state;
    }
    if (frozen && !this.wasFrozen && (state === 'attacking' || state === 'recover')) {
      // Le coup porte : l'arme rebondit légèrement contre la cible.
      this.v[I.aRx] += attack === 'heavy' ? 6 : 4;
      this.v[I.wr] -= 5;
      this.squashV -= 8; // le choc tasse le corps
    }
    this.wasFrozen = frozen;

    // --- Cibles de la pose.
    const base = engaged ? GUARD : REST;
    this.fill(base);
    let spin = 0;
    let pitch = 0;
    let lift = 0;
    let ground = 1;
    const key = attack === 'light' ? `light${Math.min(step, 2)}` : attack;
    const moves = ATTACKS[key];
    const isAttack = (state === 'windup' || state === 'attacking' || state === 'recover') && !!moves;

    if (isAttack) {
      const { a, s } = moves;
      if (state === 'windup') {
        const coil = easeOutCubic(clamp01(k / 0.85));
        this.blend(GUARD, a, coil);
        // Tient l'anticipation en tremblant légèrement (coup lourd surtout).
        if (k > 0.75) this.target[I.rX] += Math.sin(now * 0.09) * (attack === 'heavy' ? 0.03 : 0.012);
      } else if (state === 'attacking') {
        this.blend(a, s, easeOutExpo(k));
        if (attack === 'counter') spin = -TAU * easeInOut(k);
      } else {
        // Suivi : le mouvement continue un peu au-delà de l'impact, se tient,
        // puis le corps revient en garde avec le poids de l'arme.
        const carry = 0.12 * Math.sin(Math.PI * clamp01(k / 0.4));
        for (let i = 0; i < N; i++) {
          const c = CHANNELS[i];
          const sv = s[c] ?? GUARD[c] ?? 0;
          const av = a[c] ?? GUARD[c] ?? 0;
          const follow = sv + (sv - av) * carry;
          this.target[i] = follow + ((base[c] ?? 0) - follow) * smooth(0.3, 1, k);
        }
        if (attack === 'counter') spin = -TAU;
      }
    } else {
      switch (state) {
        case 'idle': {
          const breath = Math.sin(now * 0.0026);
          this.target[I.tY] += breath * 0.25;
          this.target[I.rX] += 0.03 + breath * 0.015;
          this.target[I.aLx] += breath * 0.03;
          this.target[I.aRx] -= breath * 0.025;
          break;
        }
        case 'moving':
          this.locomotion(engaged && !pose.sprint, !!pose.sprint);
          ground = 0.55;
          break;
        case 'rolling': {
          if (pose.dodge === 'backstep') {
            // Pas arrière : petit bond, buste qui recule, lance gardée devant.
            const hop = Math.sin(Math.PI * k);
            this.blend(base, { rX: -0.22, tY: 0.4, aRx: -0.65, wr: 0.55, aLx: -0.2, aLz: -0.6,
              lLx: 0.45, lRx: -0.15 }, smooth(0, 0.25, k) * (1 - smooth(0.7, 1, k)));
            lift = hop * 3.2;
            this.target[I.tF] = -2.5 * hop;
            ground = 0.4;
            break;
          }
          // Roulade avant : plongeon, corps groupé, réception amortie.
          const tuck = smooth(0, 0.18, k) * (1 - smooth(0.75, 1, k));
          this.blend(base, { rX: 0.9, aLx: -1.3, aLz: -0.3, aRx: -1.0, wr: 0.9, lLx: -1.25, lRx: -1.0 }, tuck);
          pitch = TAU * easeInOut(smooth(0.06, 0.88, k));
          lift = Math.sin(Math.PI * k) * 2.5;
          ground = 0;
          break;
        }
        case 'hurt': {
          // Recul : le buste part dans le sens du coup, un pied recule pour se rattraper.
          const b = 1 - easeOutCubic(k);
          this.target[I.rX] += (0.4 * this.knockForward - 0.1) * b;
          this.target[I.rZ] += 0.3 * this.knockSide * b;
          this.target[I.aLx] += 0.7 * b;
          this.target[I.aLz] -= 0.6 * b;
          this.target[I.aRz] += 0.45 * b;
          this.target[I.lLx] += 0.5 * b;
          this.target[I.lRx] -= 0.35 * b;
          break;
        }
        case 'blocking': {
          // Garde haute : lance ramenée devant, bras gauche en appui, buste de profil.
          this.blend(base, { rX: -0.08, rY: -0.2, rZ: -0.04, tY: -0.2,
            aLx: -0.95, aLz: -0.55, aRx: -1.15, aRz: -0.1, wr: 0.7,
            lLx: 0.1, lRx: -0.08 }, 1);
          break;
        }
        case 'exhausted': {
          // À bout de souffle : plié en avant, respiration lourde.
          const pant = Math.sin(now * 0.011);
          this.blend(base, { rX: 0.55, tY: -1.5, aLx: -0.35, aLz: -0.1, aRx: -0.3, wr: 0.5,
            lLx: -0.25, lRx: 0.25 }, 1);
          this.target[I.tY] += pant * 0.5;
          this.target[I.rX] += pant * 0.05;
          break;
        }
        case 'dead': {
          // Mort : les genoux lâchent, il tombe à genoux, l'arme pèse, puis il
          // bascule face contre terre avec un léger rebond (pose.phase : 0 → 1).
          const buckle = easeOutCubic(smooth(0, 0.28, k));
          const fall = easeInCubic(smooth(0.4, 0.66, k));
          const settle = smooth(0.66, 0.8, k);
          this.blend(base, {
            rX: 0.3 + 0.45 * buckle, tY: -6 * buckle, aLx: 0.3 + 0.5 * fall, aLz: 0.25, aRx: 0.45 + 0.6 * fall,
            aRz: -0.2, wr: 0, lLx: -1.25 * buckle * (1 - fall * 0.6), lRx: 0.45 * buckle,
          }, 1);
          pitch = 1.42 * fall - 0.07 * Math.sin(settle * Math.PI);
          lift = -7.5 * fall;
          ground = 0;
          break;
        }
      }
    }

    // --- Bas du corps : la marche se superpose à une action du haut du corps.
    const walking = clamp01((this.speed - 8) / 45);
    if (walking > 0 && UPPER_BODY_STATES.has(state)) {
      this.upper.set(this.target);
      this.fill(base);
      this.locomotion(engaged, false);
      for (let i = 0; i < N; i++) {
        const m = LOWER_MASK[i] * walking;
        this.target[i] = this.upper[i] + (this.target[i] - this.upper[i]) * m;
      }
      ground = Math.min(ground, 1 - 0.45 * walking);
    }

    // --- Ressorts (figés pendant le gel d'impact).
    if (!frozen && dt > 0) {
      const [omega, zeta] = springFor(state, attack);
      let remaining = dt;
      while (remaining > 1e-5) {
        const h = Math.min(remaining, 1 / 120);
        remaining -= h;
        for (let i = 0; i < N; i++) {
          const w = omega * OMEGA_SCALE[i];
          const z = zeta * ZETA_SCALE[i];
          this.v[i] += (w * w * (this.target[i] - this.x[i]) - 2 * z * w * this.v[i]) * h;
          this.x[i] += this.v[i] * h;
        }
      }
      this.flash = Math.max(0, this.flash - dt * 6);
      // Ressort du squash & stretch (ω 26, ζ 0,45 : un rebond visible).
      this.squashV += (-26 * 26 * this.squash - 2 * 0.45 * 26 * this.squashV) * dt;
      this.squash = T.MathUtils.clamp(this.squash + this.squashV * dt, -0.35, 0.35);
    }

    // --- Orientation : rapide en combat, plus souple en marche.
    const desired = Math.atan2(fx, fy);
    const prevHeading = this.heading ?? desired;
    if (!frozen) {
      const rate = state === 'rolling' ? 40 : isAttack ? 26 : state === 'moving' ? 18 : 14;
      const gap = Math.atan2(Math.sin(desired - prevHeading), Math.cos(desired - prevHeading));
      this.heading = prevHeading + gap * (1 - Math.exp(-rate * dt));
      if (dt > 0) {
        const yawRate = Math.atan2(Math.sin(this.heading - prevHeading), Math.cos(this.heading - prevHeading)) / dt;
        this.turn += (yawRate - this.turn) * (1 - Math.exp(-10 * dt));
      }
    } else if (this.heading === undefined) {
      this.heading = desired;
    }
    this.apply(pose, spin, pitch, lift, ground, frozen, state, now);

    // --- Traînée de la lance.
    const swing = isAttack && (state === 'attacking' || (state === 'windup' && k > 0.8 && attack !== 'heavy') ||
      (state === 'recover' && k < 0.18));
    if (!frozen) {
      this.rig.root.updateMatrixWorld(true);
      this.trail.push(this.spear, swing && this.spear.visible ? 1 : 0, SPEAR_TRAIL_TINT);
    }
  }

  /** Recopie la pose réelle (posée par l'équipement) dans les ressorts. */
  capture() {
    const { torso, arms } = this.rig;
    const actual: [Channel, number][] = [
      ['rX', torso.rotation.x], ['rY', torso.rotation.y + this.torsoTwist], ['rZ', torso.rotation.z],
      ['aLx', arms[0].rotation.x], ['aLy', arms[0].rotation.y], ['aLz', arms[0].rotation.z],
      ['aRx', arms[1].rotation.x], ['aRy', arms[1].rotation.y], ['aRz', arms[1].rotation.z],
    ];
    for (const [c, value] of actual) {
      const i = I[c];
      if (Math.abs(this.x[i] - value) > 1e-4) {
        this.x[i] = value;
        this.v[i] = 0;
      }
    }
  }

  /** Avance la démarche : hanches, phase calée sur la distance, contacts des pieds. */
  private stepGait(state: string, travel: number, dt: number) {
    const walkingState = state === 'moving' || UPPER_BODY_STATES.has(state);
    const moving = walkingState && this.speed > 8;
    // Direction du déplacement dans le repère du regard (0 = devant, > 0 = à droite).
    const move = Math.atan2(this.side, this.forward);
    // Marche arrière au-delà de ~100°, avec hystérésis pour ne pas clignoter.
    if (Math.abs(move) > (this.backpedal ? 1.4 : 1.75)) this.backpedal = true;
    else if (Math.abs(move) < 1.4) this.backpedal = false;
    let hipGoal = 0;
    if (moving) {
      const aim = this.backpedal ? Math.atan2(Math.sin(move - Math.PI), Math.cos(move - Math.PI)) : move;
      hipGoal = T.MathUtils.clamp(aim, -0.6, 0.6);
    }
    this.hip += (hipGoal - this.hip) * (1 - Math.exp(-10 * dt));
    const rel = move - this.hip;
    this.lateral = moving ? Math.sin(rel) : 0;
    this.gait.update(moving ? travel * Math.cos(rel) : 0, moving ? this.speed : 0, dt);
    const goal = walkingState ? clamp01((this.speed - 6) / 30) : 0;
    this.gaitWeight += (goal - this.gaitWeight) * (1 - Math.exp(-(goal > this.gaitWeight ? 16 : 10) * dt));
    // Poids du pas : chaque pied qui se pose tasse le corps d'un rien.
    const pace = this.gait.pace * this.gaitWeight;
    for (let i = 0; i < 2; i++) {
      if (!this.gait.contact[i]) continue;
      this.v[I.tY] -= 7 * pace;
      this.v[I.rX] += 0.7 * pace;
      this.squashV -= 2.2 * pace;
    }
  }

  private locomotion(engaged: boolean, sprint: boolean) {
    const g = this.gait;
    const pace = g.pace;
    const [left, right] = g.swing;
    const f = this.forward;
    const s = this.side;
    const t = this.target;
    const lateral = Math.abs(this.lateral);
    const run = this.run;
    const stance = 0.05 + 0.07 * pace;
    // Jambes : rotation x > 0 envoie le pied en arrière, d'où le signe.
    t[I.lLx] = -left;
    t[I.lRx] = -right;
    // Écart permanent : moins de jambes qui se croisent en strafe.
    t[I.lLz] = -stance - 0.08 * +engaged - 0.36 * lateral * g.fold[0];
    t[I.lRz] = stance + 0.08 * +engaged + 0.36 * lateral * g.fold[1];
    // Bras en opposition des jambes ; le bras armé reste en garde au combat.
    t[I.aLx] += -right * (engaged ? 0.35 : 0.9);
    t[I.aRx] += -left * (engaged ? 0.25 : 0.75);
    // Penché avant continu (vitesse) + lean d'accélération, roulis lisible en strafe.
    t[I.rX] += 0.1 * pace * f + 0.16 * run * Math.max(0, f) + T.MathUtils.clamp(this.lean, -0.16, 0.16);
    t[I.rY] += (left - right) * (0.07 + 0.05 * run);
    t[I.rZ] += T.MathUtils.clamp(-this.turn * (0.015 + 0.05 * pace), -0.18, 0.18)
      + s * (0.035 + 0.06 * run) * (0.35 + 0.65 * pace);
    if (sprint || run > 0.25) {
      const k = sprint ? Math.max(0.5, run) : smooth(0.25, 0.9, run);
      t[I.rX] += 0.2 * k;
      t[I.aLx] = T.MathUtils.lerp(t[I.aLx], -right * 1.5 - 0.2, k);
      t[I.aLz] = T.MathUtils.lerp(t[I.aLz], -0.15, k);
      t[I.aRx] = T.MathUtils.lerp(t[I.aRx], -left * 0.7 + 0.25, k);
      t[I.wr] = T.MathUtils.lerp(t[I.wr], -0.25, k);
      t[I.aRz] = T.MathUtils.lerp(t[I.aRz], -0.1, k);
    }
  }

  private fill(pose: Pose) {
    for (let i = 0; i < N; i++) this.target[i] = pose[CHANNELS[i]] ?? 0;
  }

  private blend(from: Pose, to: Pose, amount: number) {
    for (let i = 0; i < N; i++) {
      const c = CHANNELS[i];
      const a = from[c] ?? GUARD[c] ?? 0;
      const b = to[c] ?? GUARD[c] ?? 0;
      this.target[i] = a + (b - a) * amount;
    }
  }

  private apply(pose: Actor3D, spin: number, pitch: number, lift: number, ground: number,
    frozen: boolean, state: string, now: number) {
    const { root, torso, arms, legs } = this.rig;
    const x = this.x;
    const w = this.gaitWeight;
    const yaw = (this.heading ?? 0) + spin + this.hip * w;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);

    // Les jambes écartées abaissent le bassin pour garder les pieds au sol.
    // En marche, seule la jambe d'appui porte le bassin (la jambe en l'air est pliée).
    const legL = x[I.lLx] + (-this.gait.swing[0] - x[I.lLx]) * w;
    const legR = x[I.lRx] + (-this.gait.swing[1] - x[I.lRx]) * w;
    const springReach = Math.max(Math.cos(x[I.lLx]) * Math.cos(x[I.lLz]), Math.cos(x[I.lRx]) * Math.cos(x[I.lRz]));
    const reach = springReach + (this.gait.reach - springReach) * w;
    const drop = -LEG * (1 - reach) * (ground + (1 - ground) * w);
    // Pivot de la roulade à mi-hauteur du corps.
    const pivot = 9;
    const pivotUp = pivot - pivot * Math.cos(pitch);
    const pivotBack = -pivot * Math.sin(pitch);
    const forward = x[I.tF] + pivotBack;
    let shakeX = 0;
    let shakeZ = 0;
    if (frozen) {
      const amp = state === 'hurt' ? 0.9 : 0.45;
      shakeX = Math.sin(now * 0.93) * amp;
      shakeZ = Math.cos(now * 1.37) * amp;
    }
    const groundZ = pose.groundZ ?? 0;
    root.position.set(pose.x + sin * forward + shakeX, groundZ + drop + lift + pivotUp, pose.y + cos * forward + shakeZ);
    root.rotation.set(pitch, yaw, 0);
    // Volume conservé : étiré vers l'avant (z local) ou tassé vers le sol (y).
    const sq = this.squash;
    if (sq >= 0) {
      const side = 1 / Math.sqrt(1 + 0.35 * sq);
      root.scale.set(side, side, 1 + 0.35 * sq);
    } else {
      const up = 1 + 0.4 * sq;
      const side = 1 / Math.sqrt(up);
      root.scale.set(side, up, side);
    }
    if (this.shadow) {
      this.shadow.position.set(root.position.x, groundZ + 0.15, root.position.z);
      const squash = 1 - 0.25 * Math.min(1, lift / 2.5);
      this.shadow.scale.setScalar(squash);
    }

    torso.position.y = 16 + x[I.tY];
    // Le buste annule la rotation des hanches : il reste tourné vers l'ennemi.
    this.torsoTwist = this.hip * w * 0.85;
    torso.rotation.set(x[I.rX], x[I.rY] - this.torsoTwist, x[I.rZ]);
    arms[0].rotation.set(x[I.aLx], x[I.aLy], x[I.aLz]);
    arms[1].rotation.set(x[I.aRx], x[I.aRy], x[I.aRz]);
    this.wrist.rotation.x = x[I.wr];
    legs[0].rotation.set(legL, 0, x[I.lLz]);
    legs[1].rotation.set(legR, 0, x[I.lRz]);
    // Faux genou : la jambe en l'air se raccourcit au milieu de son retour.
    legs[0].scale.y = 1 - 0.16 * this.gait.fold[0] * w;
    legs[1].scale.y = 1 - 0.16 * this.gait.fold[1] * w;

    const glow = this.flash * this.flash;
    // Clignotement pâle pendant l'invincibilité qui suit un coup reçu.
    const blink = pose.guarded && Math.sin(now * 0.075) > 0 ? 0.22 : 0;
    for (const material of this.flashMaterials) {
      material.emissive.setRGB(glow * 0.55 + blink, glow * 0.12 + blink * 0.9, glow * 0.06 + blink * 0.75);
    }
  }
}
