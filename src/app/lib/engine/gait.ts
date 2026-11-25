import * as T from 'three';

/**
 * Démarches procédurales partagées (joueur, capitaine, Gardien).
 *
 * Principe retenu des recherches (foot planting, stride warping) : la phase
 * du pas avance avec la distance parcourue, jamais avec le temps, et la jambe
 * d'appui balaie l'arrière de façon linéaire (vitesse de pied constante au
 * sol) au lieu d'un sin() qui ralentit aux extrémités et fait glisser le pied.
 * La jambe en l'air revient vite, en douceur, et se « plie » (raccourcie) pour
 * simuler un genou. Chaque pose de pied émet un contact : petite impulsion de
 * poids dans le corps, utile aussi pour la poussière ou le bruit de pas.
 *
 * À la vitesse du jeu (220 px/s pour des jambes de 13 px) un ancrage parfait
 * donnerait 14 pas par seconde : `slip` accepte un léger glissement pour
 * garder une cadence lisible. Valeurs devinées, à régler à l'œil.
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

export interface BipedGaitOptions {
  /** Longueur de jambe (pivot de hanche → sol). */
  leg: number;
  /** Vitesse qui donne l'amplitude maximale. */
  runSpeed: number;
  /** Amplitude angulaire (rad) au pas lent et à pleine vitesse. */
  minAmp: number;
  maxAmp: number;
  /** > 1 : le pied glisse un peu pour une cadence plus posée. */
  slip: number;
  /** Fraction du cycle où le pied est au sol, au pas et à la course. */
  walkDuty: number;
  runDuty: number;
}

export const PLAYER_GAIT: BipedGaitOptions = {
  leg: 13.45, runSpeed: 340, minAmp: 0.34, maxAmp: 0.78, slip: 1.55, walkDuty: 0.6, runDuty: 0.42,
};
/** Le capitaine : pas plus longs, plus lents, plus lourds. */
export const DUELIST_GAIT: BipedGaitOptions = {
  leg: 13.45, runSpeed: 260, minAmp: 0.38, maxAmp: 0.7, slip: 1.85, walkDuty: 0.64, runDuty: 0.5,
};

export class BipedGait {
  /** Phase en cycles (un cycle = deux pas). */
  private phase = 0;
  private amp = 0;
  private duty = 0.6;
  private readonly prev = [1, 1];
  /** Angle avant (rad, > 0 = pied devant) et pliure (0..1) de chaque jambe. */
  readonly swing = [0, 0];
  readonly fold = [0, 0];
  /** Jambe d'appui la plus verticale : cos de son angle, pour poser le bassin. */
  reach = 1;
  /** Jambes qui viennent de toucher le sol à cette image. */
  readonly contact = [false, false];
  /** 0..1 : intensité de la marche (0 = immobile). */
  pace = 0;

  constructor(private readonly o: BipedGaitOptions) {}

  /**
   * @param distance distance parcourue cette image, signée (> 0 = vers l'avant de la jambe)
   * @param speed vitesse lissée (unités/s)
   */
  update(distance: number, speed: number, dt: number) {
    const o = this.o;
    const t = clamp01(speed / o.runSpeed);
    const targetAmp = speed < 8 ? 0 : o.minAmp + (o.maxAmp - o.minAmp) * t;
    // Démarrage franc, arrêt un peu plus lent : le dernier pas se pose.
    this.amp += (targetAmp - this.amp) * (1 - Math.exp(-(targetAmp > this.amp ? 14 : 9) * dt));
    this.pace = clamp01(this.amp / o.maxAmp);
    this.duty = o.walkDuty + (o.runDuty - o.walkDuty) * t;
    const stride = 2 * o.leg * Math.sin(Math.max(this.amp, o.minAmp));
    this.phase += distance / (2 * stride * o.slip);
    this.phase -= Math.floor(this.phase);

    let reach = 0;
    for (let i = 0; i < 2; i++) {
      const p = (this.phase + i * 0.5) % 1;
      let a: number;
      let fold = 0;
      const stance = p < this.duty;
      if (stance) {
        // Appui : balayage linéaire de l'avant vers l'arrière.
        a = this.amp * (1 - 2 * p / this.duty);
        reach = Math.max(reach, Math.cos(a));
      } else {
        const s = (p - this.duty) / (1 - this.duty);
        a = -this.amp + 2 * this.amp * smooth(s);
        fold = Math.sin(Math.PI * s) * this.pace;
      }
      this.swing[i] = a;
      this.fold[i] = fold;
      // Contact : la jambe repasse en appui (sens de marche indifférent).
      this.contact[i] = this.amp > 0.05 && stance && this.prev[i] >= this.duty && dt > 0;
      this.prev[i] = p;
    }
    this.reach = reach || 1;
  }

  reset() {
    this.amp = 0;
    this.pace = 0;
    this.swing[0] = this.swing[1] = 0;
    this.fold[0] = this.fold[1] = 0;
    this.reach = 1;
  }
}

interface Foot {
  x: number;
  z: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  t: number;
  stepping: boolean;
}

/**
 * Marche à six pattes en trépied alterné (Gardien noyé). Chaque patte garde
 * son pied planté dans le monde ; quand il s'éloigne trop de sa position de
 * repos (calculée depuis le corps, donc aussi en tournant sur place), tout
 * son groupe fait un pas en arc vers une cible prise un peu en avant du
 * mouvement. Les deux groupes ne lèvent jamais leurs pattes en même temps.
 *
 * Groupe A : avant gauche, milieu droit, arrière gauche ; groupe B : l'inverse.
 * Les pattes sont rangées comme dans GuardianRig : 0-2 à gauche, 3-5 à droite.
 */
export class TripodGait {
  private readonly feet: Foot[];
  private readonly group = [0, 1, 0, 1, 0, 1];
  private active = -1;
  private idle = 0;
  private lastX = 0;
  private lastZ = 0;
  private vx = 0;
  private vz = 0;
  private placed = false;
  /** Lacet local de chaque patte (rotation.y) et levée 0..1. */
  readonly yaw = new Float32Array(6);
  readonly lift = new Float32Array(6);
  /** Balancement du corps : roulis vers le groupe en appui, rebond à la pose. */
  bob = 0;
  roll = 0;
  /** Vrai à l'image où un groupe se pose (secousse, poussière). */
  landed = false;

  constructor(
    private readonly pivots: readonly { x: number; z: number; side: number }[],
    private readonly reach = 12,
  ) {
    this.feet = pivots.map(() => ({ x: 0, z: 0, fromX: 0, fromZ: 0, toX: 0, toZ: 0, t: 0, stepping: false }));
  }

  /**
   * @param x,z position du corps ; yaw son lacet (rotation.y de la racine)
   * @param freeze vrai pendant les poses où les pattes ne doivent pas marcher
   */
  update(x: number, z: number, yaw: number, dt: number, freeze = false) {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    if (!this.placed) {
      this.feet.forEach((f, i) => {
        this.home(i, x, z, sin, cos, 0, 0, f);
        f.x = f.toX;
        f.z = f.toZ;
      });
      this.lastX = x;
      this.lastZ = z;
      this.placed = true;
    }
    if (dt > 0) {
      const k = 1 - Math.exp(-10 * dt);
      this.vx += ((x - this.lastX) / dt - this.vx) * k;
      this.vz += ((z - this.lastZ) / dt - this.vz) * k;
    }
    this.lastX = x;
    this.lastZ = z;
    const speed = Math.hypot(this.vx, this.vz);
    const stepDur = T.MathUtils.clamp(0.3 - speed * 0.0009, 0.11, 0.3);
    this.landed = false;

    // Pas en cours : arc parabolique, puis le pied se plante.
    if (this.active >= 0) {
      let done = true;
      this.feet.forEach((f, i) => {
        if (this.group[i] !== this.active || !f.stepping) return;
        f.t = Math.min(1, f.t + dt / stepDur);
        const s = f.t < 0.5 ? 2 * f.t * f.t : 1 - 2 * (1 - f.t) * (1 - f.t);
        f.x = f.fromX + (f.toX - f.fromX) * s;
        f.z = f.fromZ + (f.toZ - f.fromZ) * s;
        if (f.t < 1) done = false;
        else f.stepping = false;
      });
      if (done) {
        this.active = -1;
        this.landed = true;
      }
    }

    // Déclenchement : le groupe dont un pied traîne le plus loin part en entier.
    const moving = speed > 6;
    this.idle = moving ? 0 : this.idle + dt;
    if (this.active < 0 && !freeze) {
      const threshold = moving ? this.reach * 0.45 : this.idle > 0.3 ? 1.2 : Infinity;
      let worst = -1;
      let worstGroup = -1;
      this.feet.forEach((f, i) => {
        this.home(i, x, z, sin, cos, 0, 0, f);
        const d = Math.hypot(f.x - f.toX, f.z - f.toZ);
        if (d > threshold && d > worst) { worst = d; worstGroup = this.group[i]; }
      });
      if (worstGroup >= 0) {
        this.active = worstGroup;
        const lead = stepDur * 0.55;
        this.feet.forEach((f, i) => {
          if (this.group[i] !== worstGroup) return;
          f.fromX = f.x;
          f.fromZ = f.z;
          this.home(i, x, z, sin, cos, this.vx * lead, this.vz * lead, f);
          f.t = 0;
          f.stepping = true;
        });
      }
    }

    // Angles des pattes vers leurs pieds, dans le repère du corps.
    let airborne = 0;
    this.feet.forEach((f, i) => {
      const { x: px, z: pz, side } = this.pivots[i];
      const wx = f.x - x;
      const wz = f.z - z;
      // Monde → local (inverse de la rotation y).
      const lx = wx * cos - wz * sin - px;
      const lz = wx * sin + wz * cos - pz;
      const a = Math.atan2(-side * lz, side * lx);
      this.yaw[i] = T.MathUtils.clamp(a, -0.75, 0.75);
      const up = f.stepping ? Math.sin(Math.PI * f.t) : 0;
      this.lift[i] = up;
      airborne += up * side;
    });
    // Le corps penche du côté qui porte (moins de pattes au sol de l'autre).
    this.roll = -airborne * 0.025;
    this.bob = this.landed ? -1 : this.bob * Math.exp(-12 * dt);
  }

  reset() {
    this.placed = false;
    this.active = -1;
    this.vx = this.vz = 0;
  }

  /** Position de repos d'un pied (monde), décalée de (ox, oz). */
  private home(i: number, x: number, z: number, sin: number, cos: number, ox: number, oz: number, f: Foot) {
    const { x: px, z: pz, side } = this.pivots[i];
    const lx = px + side * this.reach;
    // Local → monde (rotation y).
    f.toX = x + lx * cos + pz * sin + ox;
    f.toZ = z - lx * sin + pz * cos + oz;
  }
}
