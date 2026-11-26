import * as T from 'three';
import type { Actor3D } from './world-3d';
import { HUMANOID_BONES, type HumanoidRig } from './humanoid-rig';
import { type Limb, splitArm, solveArm, reachOnLine, type ArmSolution } from './arm-ik';
import {
  ART_CHANNELS, AFENA_ART, SPEAR_ART,
  type ArtChannel, type ArtPose, type WeaponArt,
} from '../combat/martial-arts';
import { buildSpear, WEAPON_DIMENSIONS } from './equipment-3d';

/**
 * Couche « arts martiaux » du joueur, appliquée APRÈS l'animateur de base
 * (player-rig-3d.ts), l'équipement et capture() :
 *
 * - l'arme n'est plus vissée au poignet : elle vit dans son propre repère,
 *   posée par les techniques (combat/martial-arts.ts), et les deux bras la
 *   saisissent par IK (arm-ik.ts). Les mains glissent le long du fût ;
 * - pendant la garde et les attaques, le buste, les hanches (garde de profil)
 *   et les jambes (fente, pas, changement de garde) sont repris à
 *   l'animateur ; la marche, les esquives, le recul restent les siens.
 *
 * La chronologie des coups ne change pas : la couche lit pose.state
 * ('windup' | 'attacking' | 'recover') et pose.phase, calculés depuis
 * combat/attack-timeline.ts comme la hitbox.
 */

const N = ART_CHANNELS.length;
const I = Object.fromEntries(ART_CHANNELS.map((c, i) => [c, i])) as Record<ArtChannel, number>;
const TAU = Math.PI * 2;
const LEG = 13.45;
/** Lance du joueur : la hampe partagée (36) est allongée à 45, proportions d'une lance de guerre. */
const SPEAR_STRETCH = 1.25;
const SPEAR_UNSTRETCH = 1 / SPEAR_STRETCH;
/** États où l'équipement (arc, feuilles de mixture) pose les bras lui-même. */
const GEAR_STATES = new Set(['aiming', 'release', 'drinking']);

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Raideur (ω) et amortissement (ζ) selon l'état, comme l'animateur de base. */
function springFor(state: string, attack: string): [number, number] {
  switch (state) {
    case 'windup': return attack === 'heavy' ? [16, 1] : [24, 1];
    case 'attacking': return [46, 0.75];
    case 'recover': return attack === 'heavy' ? [10, 0.7] : [13, 0.7];
    case 'rolling': return [30, 0.9];
    case 'hurt': return [22, 0.55];
    case 'dead': case 'exhausted': return [6, 1];
    default: return [14, 1];
  }
}

const _q = new T.Quaternion();
const _qFk = new T.Quaternion();
const _qMine = new T.Quaternion();
const _qa = new T.Quaternion();
const _axisX = new T.Vector3(1, 0, 0);
const _axisY = new T.Vector3(0, 1, 0);
const _euler = new T.Euler();
const _toTorso = new T.Matrix4();
const _toFrame = new T.Matrix4();
const _o = new T.Vector3();
const _dir = new T.Vector3();
const _target = new T.Vector3();
const _shift = new T.Vector3();
const _pole = new T.Vector3();
const _wo = new T.Vector3();
const _wd = new T.Vector3();
const _wp = new T.Vector3();

/** Pas d'échantillonnage le long de l'arme pour le test d'enfoncement (unités du monde). */
const PROBE_STEP = 1.5;
/** Bouts de l'arme le long de son axe (coordonnée du fût), pour ne pas les enfoncer dans le décor. */
const WEAPON_ENDS = {
  spear: { tip: WEAPON_DIMENSIONS.spear.stretchedTipY, heel: WEAPON_DIMENSIONS.spear.heelY * SPEAR_STRETCH },
  afena: { tip: WEAPON_DIMENSIONS.afena.tipY, heel: -3.5 },
} as const;

/** Le point (x, y du plan de jeu, hauteur au-dessus du sol) est-il dans un obstacle dur ? */
export type WeaponProbe = (x: number, y: number, height: number) => boolean;

export class MartialArts3D {
  private readonly x = new Float32Array(N);
  private readonly v = new Float32Array(N);
  private readonly target = new Float32Array(N);
  private readonly main: Limb;
  private readonly off: Limb;
  /** Repère du regard (enfant de la racine, annule la rotation des hanches). */
  private readonly frame = new T.Group();
  /** L'arme : +y le long du fût vers la pointe, origine à la coordonnée 0 du fût. */
  private readonly weapon = new T.Group();
  private readonly afena?: T.Object3D;
  private heading: number | undefined;
  private walk = 0;
  private lastX = 0;
  private lastY = 0;
  private speed = 0;
  private placed = false;
  private art: WeaponArt = SPEAR_ART;
  /**
   * Test du décor (cases, troncs, murs) : la lance recule le long de son axe
   * au lieu de s'y enfoncer. Branché par le jeu ; null = pas de test.
   */
  probe: WeaponProbe | null = null;
  /** Recul actuel le long du fût (positif = vers la pointe, négatif = recul). */
  private retract = 0;
  private ground = 0;
  private stepDt = 0;
  private readonly solM: ArmSolution = { shoulder: new T.Quaternion(), elbow: 0, reached: new T.Vector3() };
  private readonly solO: ArmSolution = { shoulder: new T.Quaternion(), elbow: 0, reached: new T.Vector3() };

  constructor(private readonly rig: HumanoidRig, private readonly spear: T.Object3D) {
    const weaponArm = rig.arms[1];
    // L'afena (ajoutée par Equipment3D) est l'autre groupe accroché au bras d'arme.
    this.afena = weaponArm.children.find((c) => c instanceof T.Group && c !== spear &&
      c.name !== HUMANOID_BONES.wrist && c.children.some((m) => m instanceof T.Mesh));
    rig.root.add(this.frame);
    this.frame.add(this.weapon);
    for (const blade of [spear, this.afena]) {
      if (!blade) continue;
      this.weapon.add(blade); // retire l'arme du poignet
      blade.position.set(0, 0, 0);
      blade.rotation.set(0, 0, 0);
    }
    spear.scale.set(1, SPEAR_STRETCH, 1);
    this.addSpearhead(spear);
    this.off = splitArm(rig.arms[0], -1);
    this.main = splitArm(rig.arms[1], 1);
    this.fill(SPEAR_ART.rest);
    this.x.set(this.target);
  }

  /** Fer de lance en feuille (fer forgé) et talon : la lame se lit, le sens de la prise aussi. */
  private addSpearhead(spear: T.Object3D) {
    const parts = buildSpear(SPEAR_UNSTRETCH);
    if (spear instanceof T.Mesh) {
      spear.geometry = (parts.children[0] as T.Mesh).geometry;
      const wood = spear.material as T.MeshStandardMaterial;
      wood.color.set('#5b3a22');
      wood.roughness = 0.86;
    }
    for (const part of parts.children.slice(1)) spear.add(part);
  }

  update(pose: Actor3D, dt: number, now: number, engaged: boolean) {
    const frozen = !!pose.hitstop;
    this.ground = pose.groundZ ?? 0;
    this.stepDt = frozen ? 0 : dt;
    const state = pose.state;
    const attack = pose.attack ?? 'none';
    const k = clamp01(pose.phase);
    const step = Math.max(0, (pose.step ?? 1) - 1);
    const melee = this.spear.visible ? 'spear' : this.afena?.visible ? 'afena' : null;
    if (melee) this.art = melee === 'afena' ? AFENA_ART : SPEAR_ART;
    const art = this.art;

    // --- Vitesse réelle (la garde se relâche quand on se déplace).
    if (!this.placed) {
      this.lastX = pose.x;
      this.lastY = pose.y;
      this.placed = true;
    }
    const travel = Math.min(Math.hypot(pose.x - this.lastX, pose.y - this.lastY), 14);
    this.lastX = pose.x;
    this.lastY = pose.y;
    if (!frozen && dt > 0) {
      this.speed += (travel / dt - this.speed) * (1 - Math.exp(-14 * dt));
      this.walk += travel * 0.14;
    }

    // --- Cibles.
    const key = attack === 'light' ? `light${Math.min(step, 2)}` : attack;
    const tech = art.techniques[key];
    const isAttack = !!tech && (state === 'windup' || state === 'attacking' || state === 'recover');
    const base = engaged ? art.guard : art.rest;
    this.fill(base);
    let spin = 0;
    let circle = 0;
    if (isAttack) {
      const { a, s } = tech;
      if (state === 'windup') {
        this.blend(art.guard, a, easeOutCubic(clamp01(k / 0.85)));
        circle = tech.circle ?? 0;
      } else if (state === 'attacking') {
        this.blend(a, s, easeOutExpo(k));
        if (attack === 'counter') spin = -TAU * easeInOut(k);
      } else {
        // Suivi puis retour en garde, avec le poids de l'arme.
        const carry = 0.1 * Math.sin(Math.PI * clamp01(k / 0.4));
        for (let i = 0; i < N; i++) {
          const c = ART_CHANNELS[i];
          const sv = s[c] ?? art.guard[c] ?? 0;
          const av = a[c] ?? art.guard[c] ?? 0;
          const follow = sv + (sv - av) * carry;
          this.target[i] = follow + ((art.guard[c] ?? 0) - follow) * smooth(0.3, 1, k);
        }
      }
    } else if (pose.sprint && state === 'moving') {
      this.fill(art.sprint, base);
      this.target[I.hz] += Math.sin(this.walk) * 1.6;
      this.target[I.hy] += Math.abs(Math.cos(this.walk)) * 0.6;
    } else {
      switch (state) {
        case 'idle': {
          if (!engaged) break;
          const breath = Math.sin(now * 0.0026);
          this.target[I.tY] += breath * 0.25;
          this.target[I.rX] += breath * 0.015;
          break;
        }
        case 'moving': {
          // Garde gardée en se déplaçant, mais la marche décide des jambes.
          this.target[I.wL] = 0;
          this.target[I.wT] *= 0.5;
          this.target[I.hY] *= 0.5;
          // L'arme vit avec le pas : elle monte et descend deux fois par
          // foulée et la pointe se balance un peu, au lieu de flotter figée.
          if (melee && !isAttack) {
            const pace = clamp01(this.speed / 150);
            this.target[I.hy] += 0.35 * Math.cos(2 * this.walk) * pace;
            this.target[I.yw] += 0.05 * Math.sin(this.walk) * pace;
            this.target[I.pt] += 0.03 * Math.cos(2 * this.walk) * pace;
          }
          break;
        }
        case 'rolling':
          if (pose.dodge !== 'backstep') this.fill(art.roll, base);
          else { this.target[I.wT] = 0; this.target[I.wL] = 0; }
          break;
        case 'hurt': {
          const b = 1 - easeOutCubic(k);
          this.target[I.wT] = 0;
          this.target[I.wL] = 0;
          this.target[I.pt] += 0.3 * b;
          this.target[I.hz] -= 2 * b;
          break;
        }
        case 'exhausted': this.fill(art.exhausted, base); break;
        case 'dead': this.fill(art.dead, base); break;
      }
    }
    const gear = GEAR_STATES.has(state);
    if (!melee || gear) {
      this.target[I.kM] = 0;
      this.target[I.kO] = 0;
      this.target[I.wT] = 0;
      this.target[I.wL] = 0;
      this.target[I.wF] = 0;
      this.target[I.hY] = 0;
    }

    // --- Ressorts (figés pendant le gel d'impact).
    if (!frozen && dt > 0) {
      const [omega, zeta] = springFor(state, attack);
      let remaining = dt;
      while (remaining > 1e-5) {
        const h = Math.min(remaining, 1 / 120);
        remaining -= h;
        for (let i = 0; i < N; i++) {
          this.v[i] += (omega * omega * (this.target[i] - this.x[i]) - 2 * zeta * omega * this.v[i]) * h;
          this.x[i] += this.v[i] * h;
        }
      }
    }

    // --- Cap du regard (même lissage que l'animateur de base).
    const fl = Math.hypot(pose.facingX, pose.facingY) || 1;
    const desired = Math.atan2(pose.facingX / fl, pose.facingY / fl);
    if (this.heading === undefined) this.heading = desired;
    else if (!frozen) {
      const rate = state === 'rolling' ? 40 : isAttack ? 26 : state === 'moving' ? 18 : 14;
      this.heading += wrap(desired - this.heading) * (1 - Math.exp(-rate * dt));
    }
    if (attack === 'counter' && state === 'recover') spin = 0;

    // Petit cercle de pointe (lan / na) et pointe « vivante » en garde, hors ressort.
    let yawOffset = 0;
    let pitchOffset = 0;
    if (circle) {
      const turn = TAU * clamp01(k / 0.9);
      yawOffset = circle * Math.sin(turn);
      pitchOffset = circle * 0.8 * (1 - Math.cos(turn)) * 0.5;
    } else if (engaged && (state === 'idle' || state === 'moving')) {
      yawOffset = 0.02 * Math.sin(now * 0.0017);
      pitchOffset = 0.015 * Math.sin(now * 0.0023);
    }
    this.apply(spin, yawOffset, pitchOffset, gear);
  }

  private apply(spin: number, yawOffset: number, pitchOffset: number, gear: boolean) {
    const { root, torso, legs } = this.rig;
    const x = this.x;
    const art = this.art;
    const wT = clamp01(x[I.wT]);
    const wL = clamp01(x[I.wL]);
    const wF = clamp01(x[I.wF]);
    const kM = clamp01(x[I.kM]);
    const kO = clamp01(x[I.kO]);

    // --- Hanches de profil : toute la silhouette tourne, le repère du regard compense.
    root.rotation.y += x[I.hY];
    const facing = (this.heading ?? 0) + spin;
    this.frame.rotation.y = wrap(facing - root.rotation.y);

    // --- Buste : rY est relatif au regard.
    const torsoYaw = x[I.rY] - wrap(root.rotation.y - facing);
    torso.rotation.set(
      T.MathUtils.lerp(torso.rotation.x, x[I.rX], wT),
      T.MathUtils.lerp(torso.rotation.y, torsoYaw, wT),
      T.MathUtils.lerp(torso.rotation.z, x[I.rZ], wT));
    torso.position.y = T.MathUtils.lerp(torso.position.y, 16 + x[I.tY], wT);

    // --- Jambes : fente, pas, changement de garde ; le bassin descend d'autant.
    if (wL > 0.001) {
      const before = this.legReach();
      legs[0].rotation.x = T.MathUtils.lerp(legs[0].rotation.x, x[I.lLx], wL);
      legs[0].rotation.z = T.MathUtils.lerp(legs[0].rotation.z, x[I.lLz], wL);
      legs[1].rotation.x = T.MathUtils.lerp(legs[1].rotation.x, x[I.lRx], wL);
      legs[1].rotation.z = T.MathUtils.lerp(legs[1].rotation.z, x[I.lRz], wL);
      root.position.y += LEG * (this.legReach() - before);
    }

    // --- Arme : repère du regard → buste, pour l'IK.
    root.updateMatrixWorld(true);
    _toTorso.copy(torso.matrixWorld).invert().multiply(this.frame.matrixWorld);
    const yaw = x[I.yw] + yawOffset;
    const pitch = x[I.pt] + pitchOffset;
    _dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    _target.set(x[I.hx], x[I.hy], x[I.hz]);
    const gm = T.MathUtils.clamp(x[I.gm], art.gripMin, art.gripMax);
    // Origine du fût (u = 0) dans le repère du buste.
    _o.copy(_target).addScaledVector(_dir, -gm).applyMatrix4(_toTorso);
    _dir.transformDirection(_toTorso);
    // Pointe ou talon dans un mur : l'arme glisse en arrière (les mains suivent le fût).
    const pull = this.clearance(gm, gear);
    if (pull) _o.addScaledVector(_dir, pull);

    const mainS = this.main.shoulder.position;
    const offS = this.off.shoulder.position;
    // Main d'arme : prise voulue, ou le point atteignable le plus proche du fût.
    const uM = reachOnLine(_o, _dir, mainS, gm, art.gripMin, art.gripMax);
    _target.copy(_o).addScaledVector(_dir, uM);
    solveArm(mainS, _target, this.pole(mainS, _target, 1), this.solM);
    // Si même ainsi la main n'y est pas, c'est l'arme qui suit la main.
    _shift.subVectors(this.solM.reached, _target).multiplyScalar(kM);
    _o.add(_shift);
    // Main libre : glisse sur le fût, du bon côté de la main d'arme.
    const lo = art.order > 0 ? uM + art.minGap : art.gripMin;
    const hi = art.order > 0 ? art.gripMax : uM - art.minGap;
    const uO = reachOnLine(_o, _dir, offS, x[I.go], lo, hi);
    _target.copy(_o).addScaledVector(_dir, uO);
    solveArm(offS, _target, this.pole(offS, _target, -1), this.solO);

    // Place l'arme (retour dans le repère du regard).
    _toFrame.copy(_toTorso).invert();
    this.weapon.position.copy(_o).applyMatrix4(_toFrame);
    this.weapon.quaternion.setFromAxisAngle(_axisY, yaw)
      .multiply(_qa.setFromAxisAngle(_axisX, Math.PI / 2 - pitch))
      .multiply(_q.setFromAxisAngle(_axisY, x[I.ro]));

    // --- Bras : FK de l'animateur ↔ IK sur l'arme.
    const fkBend = gear ? 0 : -0.22;
    const mainArm = this.main.shoulder;
    _qFk.copy(mainArm.quaternion);
    mainArm.quaternion.slerpQuaternions(_qFk, this.solM.shoulder, kM);
    this.main.elbow.rotation.x = T.MathUtils.lerp(fkBend, this.solM.elbow, kM);

    const offArm = this.off.shoulder;
    _qFk.copy(offArm.quaternion);
    _qMine.setFromEuler(_euler.set(x[I.oX], x[I.oY], x[I.oZ]));
    _qFk.slerp(_qMine, wF);
    offArm.quaternion.slerpQuaternions(_qFk, this.solO.shoulder, kO);
    const offFk = T.MathUtils.lerp(fkBend, x[I.oE], wF);
    this.off.elbow.rotation.x = T.MathUtils.lerp(offFk, this.solO.elbow, kO);
  }

  /**
   * Décalage le long du fût pour que ni la pointe ni le talon n'entrent dans
   * le décor. On part de la main (toujours libre) vers chaque bout ; le recul
   * est immédiat quand il grandit, puis se relâche en douceur.
   */
  private clearance(grip: number, gear: boolean): number {
    let target = 0;
    const ends = this.art === AFENA_ART ? WEAPON_ENDS.afena : WEAPON_ENDS.spear;
    if (this.probe && !gear && (this.spear.visible || this.afena?.visible)) {
      const torso = this.rig.torso.matrixWorld;
      _wo.copy(_o).applyMatrix4(torso);
      _wd.copy(_dir).transformDirection(torso);
      let tipPen = 0;
      for (let u = grip + PROBE_STEP; u <= ends.tip; u += PROBE_STEP) {
        if (this.inside(u)) { tipPen = ends.tip - u + PROBE_STEP; break; }
      }
      let heelPen = 0;
      for (let u = grip - PROBE_STEP; u >= ends.heel; u -= PROBE_STEP) {
        if (this.inside(u)) { heelPen = u - ends.heel + PROBE_STEP; break; }
      }
      target = heelPen - tipPen;
    }
    const grows = Math.abs(target) > Math.abs(this.retract) && Math.sign(target) === Math.sign(this.retract || target);
    if (grows) this.retract = target;
    else if (this.stepDt > 0) this.retract += (target - this.retract) * (1 - Math.exp(-14 * this.stepDt));
    if (Math.abs(this.retract) < 0.01) this.retract = 0;
    return this.retract;
  }

  private inside(u: number) {
    _wp.copy(_wo).addScaledVector(_wd, u);
    return this.probe!(_wp.x, _wp.z, _wp.y - this.ground);
  }

  /** Le coude pointe vers le bas et l'arrière ; vers l'extérieur quand la main passe au-dessus de l'épaule. */
  private pole(shoulder: T.Vector3, hand: T.Vector3, side: number) {
    const up = clamp01((hand.y - shoulder.y + 1) / 5);
    return _pole.set(side * (0.7 + 0.5 * up), -1 + 0.9 * up, -0.6);
  }

  private legReach() {
    const [l, r] = this.rig.legs;
    return Math.max(Math.cos(l.rotation.x) * Math.cos(l.rotation.z), Math.cos(r.rotation.x) * Math.cos(r.rotation.z));
  }

  private fill(pose: ArtPose, fallback?: ArtPose) {
    for (let i = 0; i < N; i++) {
      const c = ART_CHANNELS[i];
      this.target[i] = pose[c] ?? fallback?.[c] ?? 0;
    }
  }

  private blend(from: ArtPose, to: ArtPose, amount: number) {
    const guard = this.art.guard;
    for (let i = 0; i < N; i++) {
      const c = ART_CHANNELS[i];
      const a = from[c] ?? guard[c] ?? 0;
      const b = to[c] ?? guard[c] ?? 0;
      this.target[i] = a + (b - a) * amount;
    }
  }
}
