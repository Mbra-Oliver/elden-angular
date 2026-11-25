import * as T from 'three';

/**
 * Bras à deux segments et cinématique inverse (IK) pour tenir une arme
 * comme un pratiquant : les mains se posent sur le fût, l'arme n'est plus un
 * bâton vissé au poignet.
 *
 * Le squelette partagé (humanoid-rig.ts) n'a qu'un os par bras. Pour le
 * joueur seulement, `splitArm` coupe ce bras en bras + avant-bras (os
 * Mixamo `LeftForeArm` / `RightForeArm`), sans toucher au duelliste ni aux
 * villageois. Tout ce qui pendait au bout du bras (main, arc, feuilles…) passe
 * dans l'avant-bras à la même place : bras tendu, rien ne bouge.
 */

/** Longueurs (épaule → coude, coude → centre de la main). Somme = 8,1 comme le bras d'origine. */
export const UPPER = 4.2;
export const FORE = 3.9;
/** Allonge utile : on garde un rien de pli pour que le coude reste lisible. */
export const REACH = (UPPER + FORE) * 0.985;

export interface Limb {
  shoulder: T.Group;
  elbow: T.Group;
  /** -1 : bras du côté x < 0 (LeftArm), +1 : côté x > 0 (RightArm). */
  side: -1 | 1;
}

/** Coupe un bras d'une pièce en bras + avant-bras ; `keep` reste attaché à l'épaule. */
export function splitArm(arm: T.Group, side: -1 | 1, keep: readonly T.Object3D[] = []): Limb {
  const elbow = new T.Group();
  elbow.name = side < 0 ? 'LeftForeArm' : 'RightForeArm';
  elbow.position.set(0, -UPPER, 0);
  let upper: T.Mesh | undefined;
  let hand: T.Mesh | undefined;
  for (const child of [...arm.children]) {
    if (keep.includes(child)) continue;
    if (!upper && child instanceof T.Mesh && child.geometry instanceof T.CylinderGeometry) {
      upper = child;
      continue;
    }
    if (child.position.y < -UPPER + 0.5) {
      if (!hand && child instanceof T.Mesh && child.geometry instanceof T.SphereGeometry) hand = child;
      child.position.y += UPPER;
      elbow.add(child);
    }
  }
  if (upper) {
    // Le cylindre d'origine (8 de long) devient le bras ; une copie plus fine devient l'avant-bras.
    upper.scale.y = (UPPER + 0.5) / 8;
    upper.position.y = -(UPPER + 0.5) / 2 + 0.2;
    const fore = new T.Mesh(upper.geometry, upper.material);
    fore.scale.set(0.9, (FORE + 0.2) / 8, 0.9);
    fore.position.y = -(FORE + 0.2) / 2;
    // Même visibilité que le bras d'origine (os invisible sous un corps skinné).
    fore.layers.mask = upper.layers.mask;
    Object.assign(fore.userData, upper.userData);
    elbow.add(fore);
  }
  if (hand) {
    // Rotule du coude : cache la jointure quand le bras plie.
    const cap = new T.Mesh(hand.geometry, hand.material);
    cap.scale.setScalar(0.92);
    cap.layers.mask = hand.layers.mask;
    Object.assign(cap.userData, hand.userData);
    elbow.add(cap);
  }
  arm.add(elbow);
  return { shoulder: arm, elbow, side };
}

const _d = new T.Vector3();
const _n = new T.Vector3();
const _m = new T.Vector3();
const _u = new T.Vector3();
const _e = new T.Vector3();
const _f = new T.Vector3();
const _x = new T.Vector3();
const _y = new T.Vector3();
const _z = new T.Vector3();
const _basis = new T.Matrix4();
const _fallback = new T.Vector3(1, 0, 0);

export interface ArmSolution {
  /** Orientation de l'épaule (dans l'espace du parent de l'épaule, ici le buste). */
  shoulder: T.Quaternion;
  /** Pli du coude (rotation x de l'avant-bras). */
  elbow: number;
  /** Position réellement atteinte par la main (même espace que la cible). */
  reached: T.Vector3;
}

/**
 * IK analytique à deux os. `target` et `pole` sont dans l'espace du buste ;
 * `pole` est une direction (depuis l'épaule) vers laquelle pointe le coude.
 * Une cible hors d'allonge est ramenée sur la sphère d'allonge.
 */
export function solveArm(shoulderPos: T.Vector3, target: T.Vector3, pole: T.Vector3, out: ArmSolution): ArmSolution {
  const a = UPPER;
  const b = FORE;
  _d.subVectors(target, shoulderPos);
  let d = _d.length();
  if (d < 1e-4) _d.set(0, -1, 0), d = 1;
  _d.divideScalar(d);
  d = T.MathUtils.clamp(d, Math.abs(a - b) + 0.6, REACH);
  out.reached.copy(shoulderPos).addScaledVector(_d, d);

  // Plan du bras : contient l'épaule, la main et la direction du coude.
  _n.crossVectors(_d, pole);
  if (_n.lengthSq() < 1e-6) _n.crossVectors(_d, _fallback);
  _n.normalize();
  _m.crossVectors(_n, _d); // ⟂ à la ligne épaule→main, côté coude

  const cosA = T.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _u.copy(_d).multiplyScalar(cosA).addScaledVector(_m, sinA); // direction du bras
  _e.copy(shoulderPos).addScaledVector(_u, a); // coude
  _f.subVectors(out.reached, _e).normalize(); // direction de l'avant-bras

  // Repère de l'épaule : l'os pend selon -y, le coude plie autour de x.
  _y.copy(_u).negate();
  _x.copy(_n);
  _z.crossVectors(_x, _y);
  _basis.makeBasis(_x, _y, _z);
  out.shoulder.setFromRotationMatrix(_basis);
  // Rx(β)·(0,-1,0) = (0, -cos β, -sin β) dans le repère de l'épaule.
  out.elbow = Math.atan2(-_f.dot(_z), -_f.dot(_y));
  return out;
}

/**
 * Coordonnée de fût `u` la plus proche de `want` que la main peut atteindre
 * depuis l'épaule `s`, sur la ligne `o + dir·u`, bornée à [lo, hi]. C'est ce
 * qui fait « glisser » les mains : si la prise voulue est trop loin, la main
 * coulisse le long du fût jusqu'au point atteignable.
 */
export function reachOnLine(o: T.Vector3, dir: T.Vector3, s: T.Vector3, want: number, lo: number, hi: number): number {
  const wx = o.x - s.x;
  const wy = o.y - s.y;
  const wz = o.z - s.z;
  const b = wx * dir.x + wy * dir.y + wz * dir.z;
  const c = wx * wx + wy * wy + wz * wz - REACH * REACH;
  const disc = b * b - c;
  const closest = T.MathUtils.clamp(-b, lo, hi);
  if (disc < 0 || lo > hi) return closest;
  const r = Math.sqrt(disc);
  const from = Math.max(lo, -b - r);
  const to = Math.min(hi, -b + r);
  if (from > to) return closest;
  return T.MathUtils.clamp(want, from, to);
}
