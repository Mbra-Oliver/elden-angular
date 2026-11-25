import * as T from 'three';
import { PALETTE } from '../constants/landscape';

/**
 * Corps humain low poly skinné, commun à tous les humains du jeu (héros,
 * Badu, soldats, villageois).
 *
 * Le maillage est généré en code (anneaux de sections reliés en tubes, rendu
 * à facettes plates) et lié par skinning aux articulations du rig existant
 * (humanoid-rig.ts / slice-3d.ts) : hanches, buste, tête, bras, avant-bras,
 * jambes. Les animateurs, l'IK des mains et les poses de mort continuent de
 * tourner les mêmes os : rien à adapter de leur côté. Les jointures
 * (épaules, coudes, hanches, cou) se plient sans trou grâce aux poids mêlés.
 *
 * Les anciennes primitives du rig restent en place comme « os » (index,
 * noms et types attendus par le reste du code) mais ne sont plus dessinées
 * (hideProxy).
 *
 * Repère de repos (coordonnées du rig, pieds à y = 0) : avant = +Z, le côté
 * du bras de l'arme (RightArm) est en +X. Proportions d'un homme athlétique
 * d'environ 29,5 unités, épaules à 23, hanches à 14.
 * [SUPPOSITION] Toutes les cotes sont réglées à l'œil sur la référence.
 */

/** Écart des articulations par rapport à l'axe du corps (à utiliser pour bâtir le rig). */
export const SHOULDER_X = 3.3;
export const HIP_X = 1.7;

export interface BodyBones {
  /** Hanches (racine du rig). */
  root: T.Object3D;
  torso: T.Object3D;
  head: T.Object3D;
  /** [gauche (x < 0), droite (x > 0)] */
  arms: readonly T.Object3D[];
  /** Avant-bras : un objet qui suit le coude (main du rig), ou le bras lui-même. */
  fore: readonly T.Object3D[];
  legs: readonly T.Object3D[];
}

/** Tenue posée sur le corps. Chaque pièce est facultative. */
export interface Outfit {
  /** Pagne noué à la taille (couleur ou matériau). */
  wrap?: { material: T.Material; hem?: number; flap?: boolean; band?: T.Material };
  /** Bandoulière de cuir : épaule droite (+X) → hanche gauche. */
  strap?: T.Material;
  /** Brassards de cuir aux poignets. */
  cuffs?: T.Material;
  /** Bracelets au-dessus du coude. */
  armbands?: T.Material;
  /** Sandales de cuir. */
  sandals?: T.Material;
  /** Ceinture de cuir (sous la poire à poudre, les gourdes…). */
  belt?: T.Material;
  /** Cheveux ras (crâne rasé court). */
  hair?: T.Material;
  /** Scarifications claires sur la poitrine et les bras. */
  scars?: T.Material;
}

export interface HumanBody {
  /** Pièces de la tenue (cachées ensemble quand un vêtement les recouvre). */
  outfit: T.Group;
  meshes: T.SkinnedMesh[];
  skeleton: T.Skeleton;
  bones: BodyBones;
  /** Matrice de la racine au repos (liaison des maillages skinnés). */
  bind: T.Matrix4;
  /** Positions de repos des os : les détails rigides s'y rattachent même rig en mouvement. */
  rest: Map<T.Object3D, T.Matrix4>;
}

type Weights = [number, number][];
type WeightFn = (x: number, y: number, z: number) => Weights;

const ROOT = 0;
const TORSO = 1;
const HEAD = 2;
const ARM = [3, 4];
const FORE = [5, 6];
const LEG = [7, 8];

/** Anneau d'un tube. Axe 'y' : (x, z) = ellipse ; axe 'z' : (x, y) = ellipse. */
interface Ring {
  y: number; rx: number; rz: number;
  cx?: number; cz?: number;
  /** Pectoraux (avant, nul au sternum). */
  pec?: number;
  /** Omoplates / fessiers (arrière, nul sur la colonne). */
  back?: number;
  /** Avancée du milieu de face (menton, nez). */
  face?: number;
  w: Weights | WeightFn;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function ringPoint(r: Ring, a: number, grow = 0): [number, number] {
  const s = Math.sin(a);
  const c = Math.cos(a);
  const side = Math.min(1, Math.abs(s) * 2.2);
  let x = (r.cx ?? 0) + s * (r.rx + grow);
  let z = (r.cz ?? 0) + c * (r.rz + grow);
  if (c > 0) z += (r.pec ?? 0) * c * side + (r.face ?? 0) * Math.pow(c, 8);
  else z += (r.back ?? 0) * c * side;
  return [x, z];
}

class SkinBuilder {
  private readonly position: number[] = [];
  private readonly index: number[] = [];
  private readonly skinIndex: number[] = [];
  private readonly skinWeight: number[] = [];

  vertex(x: number, y: number, z: number, weights: Weights | WeightFn) {
    const list = (typeof weights === 'function' ? weights(x, y, z) : weights)
      .filter(([, w]) => w > 1e-4).sort((p, q) => q[1] - p[1]).slice(0, 4);
    const total = list.reduce((sum, [, w]) => sum + w, 0) || 1;
    this.position.push(x, y, z);
    for (let i = 0; i < 4; i++) {
      this.skinIndex.push(list[i]?.[0] ?? 0);
      this.skinWeight.push((list[i]?.[1] ?? 0) / total);
    }
    return this.position.length / 3 - 1;
  }

  tri(a: number, b: number, c: number) {
    this.index.push(a, b, c);
  }

  /**
   * Tube d'anneaux, du premier au dernier (vers le bas pour l'axe y, vers
   * l'avant pour l'axe z), fermé aux deux bouts.
   */
  tube(rings: Ring[], segments: number, axis: 'y' | 'z' = 'y', caps: [boolean, boolean] = [true, true], grow = 0) {
    const ids: number[][] = [];
    for (const r of rings) {
      const row: number[] = [];
      for (let j = 0; j < segments; j++) {
        const [u, v] = ringPoint(r, (j / segments) * Math.PI * 2, grow);
        row.push(axis === 'y' ? this.vertex(u, r.y, v, r.w) : this.vertex(u, v, r.y, r.w));
      }
      ids.push(row);
    }
    for (let i = 0; i + 1 < ids.length; i++) {
      for (let j = 0; j < segments; j++) {
        const k = (j + 1) % segments;
        const a = ids[i][j];
        const b = ids[i][k];
        const c = ids[i + 1][j];
        const d = ids[i + 1][k];
        this.tri(a, c, b);
        this.tri(b, c, d);
      }
    }
    const cap = (ring: Ring, row: number[], start: boolean) => {
      const [u, v] = [ring.cx ?? 0, ring.cz ?? 0];
      const center = axis === 'y' ? this.vertex(u, ring.y, v, ring.w) : this.vertex(u, v, ring.y, ring.w);
      for (let j = 0; j < segments; j++) {
        const k = (j + 1) % segments;
        if (start) this.tri(center, row[j], row[k]);
        else this.tri(center, row[k], row[j]);
      }
    };
    if (caps[0]) cap(rings[0], ids[0], true);
    if (caps[1]) cap(rings.at(-1)!, ids.at(-1)!, false);
  }

  /**
   * Bande fermée à section rectangulaire suivant une boucle (bandoulière,
   * ceinture) : `path` donne le centre et la normale sortante de chaque point.
   */
  band(path: { p: T.Vector3; n: T.Vector3; up: T.Vector3 }[], width: number, thickness: number, weights: Weights | WeightFn,
    closed = true) {
    const rows = path.map(({ p, n, up }) => {
      const corner = (s: number, t: number) => {
        const q = p.clone().addScaledVector(up, s * width / 2).addScaledVector(n, t);
        return this.vertex(q.x, q.y, q.z, weights);
      };
      // Haut-extérieur, bas-extérieur, bas-intérieur, haut-intérieur.
      return [corner(1, thickness), corner(-1, thickness), corner(-1, 0), corner(1, 0)];
    });
    const count = closed ? rows.length : rows.length - 1;
    for (let i = 0; i < count; i++) {
      const a = rows[i];
      const b = rows[(i + 1) % rows.length];
      for (let e = 0; e < 4; e++) {
        const f = (e + 1) % 4;
        this.tri(a[e], b[e], a[f]);
        this.tri(a[f], b[e], b[f]);
      }
    }
  }

  /** Petit pavé (entaille, insigne) en coordonnées de repos. */
  box(center: T.Vector3, size: T.Vector3, rotation: T.Euler, weights: Weights) {
    const m = new T.Matrix4().compose(center, new T.Quaternion().setFromEuler(rotation), size);
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) {
      const p = new T.Vector3(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5).applyMatrix4(m);
      ids.push(this.vertex(p.x, p.y, p.z, weights));
    }
    // Faces (sommets partagés : ombrage plat au rendu).
    for (const [a, b, c, d] of [[0, 2, 6, 4], [1, 5, 7, 3], [0, 4, 5, 1], [2, 3, 7, 6], [0, 1, 3, 2], [4, 6, 7, 5]]) {
      this.tri(ids[a], ids[c], ids[b]);
      this.tri(ids[a], ids[d], ids[c]);
    }
  }

  get empty() {
    return this.index.length === 0;
  }

  geometry() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.position, 3));
    g.setAttribute('skinIndex', new T.Uint16BufferAttribute(this.skinIndex, 4));
    g.setAttribute('skinWeight', new T.Float32BufferAttribute(this.skinWeight, 4));
    g.setIndex(this.index);
    g.computeVertexNormals();
    return g;
  }
}

// ---------------------------------------------------------------- anatomie

const torsoW: Weights = [[TORSO, 1]];
/** Bas du bassin : un peu entraîné par la cuisse du même côté. */
const pelvisW = (share: number): WeightFn => (x) => {
  const side = x < 0 ? 0 : 1;
  const k = share * smooth(Math.abs(x) / 1.4);
  return [[TORSO, 1 - k], [LEG[side], k]];
};

const TORSO_RINGS: Ring[] = [
  { y: 24.6, rx: 1.0, rz: 1.0, cz: -0.15, w: torsoW },
  { y: 24.1, rx: 2.3, rz: 1.55, cz: -0.25, w: torsoW },
  { y: 23.5, rx: 3.15, rz: 1.85, cz: -0.15, back: 0.1, w: torsoW },
  { y: 22.6, rx: 3.45, rz: 2.0, pec: 0.3, back: 0.3, w: torsoW },
  { y: 21.6, rx: 3.35, rz: 2.1, cz: 0.05, pec: 0.45, back: 0.25, w: torsoW },
  { y: 20.5, rx: 3.1, rz: 2.05, cz: 0.05, pec: 0.25, back: 0.15, w: torsoW },
  { y: 19.3, rx: 2.85, rz: 1.9, back: 0.05, w: torsoW },
  { y: 18.0, rx: 2.6, rz: 1.75, w: torsoW },
  { y: 16.8, rx: 2.55, rz: 1.7, w: torsoW },
  { y: 15.6, rx: 2.85, rz: 1.75, back: 0.15, w: torsoW },
  { y: 14.4, rx: 3.05, rz: 1.85, back: 0.45, w: pelvisW(0.25) },
  { y: 13.5, rx: 2.5, rz: 1.6, back: 0.35, w: pelvisW(0.45) },
  { y: 13.0, rx: 1.1, rz: 0.9, w: pelvisW(0.5) },
];

function headRings(): Ring[] {
  const h: Weights = [[HEAD, 1]];
  return [
    { y: 24.2, rx: 0.95, rz: 1.0, cz: -0.1, w: torsoW },
    { y: 25.0, rx: 0.92, rz: 0.95, w: [[TORSO, 0.45], [HEAD, 0.55]] },
    { y: 25.5, rx: 1.05, rz: 1.2, cz: 0.2, w: h },
    { y: 25.85, rx: 1.2, rz: 1.45, cz: 0.45, face: 0.25, w: h },
    { y: 26.5, rx: 1.38, rz: 1.65, cz: 0.4, w: h },
    { y: 27.2, rx: 1.45, rz: 1.75, cz: 0.3, face: 0.45, w: h },
    { y: 27.8, rx: 1.48, rz: 1.8, cz: 0.25, face: 0.08, w: h },
    { y: 28.5, rx: 1.42, rz: 1.78, cz: 0.12, w: h },
    { y: 29.1, rx: 1.12, rz: 1.45, cz: 0.02, w: h },
    { y: 29.5, rx: 0.5, rz: 0.7, w: h },
  ];
}

function armRings(i: number): Ring[] {
  const s = i === 0 ? -1 : 1;
  const x = (dx: number) => s * (SHOULDER_X + dx);
  const arm = ARM[i];
  const fore = FORE[i];
  return [
    { y: 23.75, cx: x(0.25), rx: 0.9, rz: 0.95, w: [[TORSO, 0.7], [arm, 0.3]] },
    { y: 23.2, cx: x(0.4), rx: 1.02, rz: 1.05, w: [[arm, 0.6], [TORSO, 0.4]] },
    { y: 22.0, cx: x(0.48), rx: 1.0, rz: 1.0, w: [[arm, 0.9], [TORSO, 0.1]] },
    { y: 20.7, cx: x(0.45), cz: 0.1, rx: 0.85, rz: 0.95, w: [[arm, 1]] },
    { y: 19.5, cx: x(0.45), rx: 0.8, rz: 0.85, w: [[arm, 0.85], [fore, 0.15]] },
    { y: 18.8, cx: x(0.45), cz: -0.05, rx: 0.72, rz: 0.78, w: [[arm, 0.5], [fore, 0.5]] },
    { y: 17.9, cx: x(0.45), rx: 0.82, rz: 0.85, w: [[fore, 0.85], [arm, 0.15]] },
    { y: 16.6, cx: x(0.35), rx: 0.62, rz: 0.62, w: [[fore, 1]] },
    { y: 15.7, cx: x(0.3), rx: 0.45, rz: 0.5, w: [[fore, 1]] },
    { y: 15.2, cx: x(0.28), cz: 0.1, rx: 0.38, rz: 0.68, w: [[fore, 1]] },
    { y: 14.2, cx: x(0.25), cz: 0.15, rx: 0.32, rz: 0.62, w: [[fore, 1]] },
    { y: 13.5, cx: x(0.22), cz: 0.2, rx: 0.25, rz: 0.42, w: [[fore, 1]] },
  ];
}

function legRings(i: number): Ring[] {
  const s = i === 0 ? -1 : 1;
  const x = (dx: number) => s * (HIP_X + dx);
  const leg = LEG[i];
  const l: Weights = [[leg, 1]];
  return [
    { y: 15.0, cx: x(0.05), rx: 1.2, rz: 1.4, w: [[TORSO, 0.5], [leg, 0.5]] },
    { y: 13.6, cx: x(0.12), cz: 0.05, rx: 1.5, rz: 1.65, w: [[leg, 0.85], [TORSO, 0.15]] },
    { y: 11.6, cx: x(0.15), cz: 0.15, rx: 1.45, rz: 1.5, w: l },
    { y: 9.6, cx: x(0.05), cz: 0.1, rx: 1.15, rz: 1.2, w: l },
    { y: 8.2, cx: x(0), cz: 0.1, rx: 0.9, rz: 1.0, w: l },
    { y: 7.2, cx: x(0), cz: -0.1, rx: 0.95, rz: 1.1, w: l },
    { y: 5.8, cx: x(0), cz: -0.25, rx: 1.0, rz: 1.2, w: l },
    { y: 4.0, cx: x(0), cz: -0.1, rx: 0.75, rz: 0.8, w: l },
    { y: 2.1, cx: x(0), cz: -0.05, rx: 0.55, rz: 0.6, w: l },
    { y: 1.3, cx: x(0), cz: -0.1, rx: 0.55, rz: 0.65, w: l },
  ];
}

/** Pied, le long de +Z (y = position le long de l'axe, cz = hauteur). */
function footRings(i: number, grow = 0): Ring[] {
  const s = i === 0 ? -1 : 1;
  const cx = s * (HIP_X + 0.05);
  const l: Weights = [[LEG[i], 1]];
  const f = (z: number, h: number, rx: number, ry: number): Ring => ({ y: z, cx, cz: h, rx: rx + grow, rz: ry + grow, w: l });
  return [f(-0.95, 1.0, 0.5, 0.55), f(-0.5, 0.95, 0.6, 0.7), f(0.6, 0.85, 0.75, 0.55), f(1.9, 0.55, 0.85, 0.32),
    f(2.8, 0.5, 0.75, 0.25), f(3.25, 0.48, 0.5, 0.18)];
}

/** Point de la surface du buste à la hauteur y et à l'angle a (interpolé entre anneaux). */
function torsoSurface(y: number, a: number, out = new T.Vector3()) {
  return surface(TORSO_RINGS, y, a, out);
}

/** Point de surface d'un tube vertical (anneaux du haut vers le bas). */
function surface(rings: Ring[], y: number, a: number, out = new T.Vector3()) {
  let i = 0;
  while (i < rings.length - 2 && rings[i + 1].y > y) i++;
  const r0 = rings[i];
  const r1 = rings[i + 1];
  const t = T.MathUtils.clamp((r0.y - y) / (r0.y - r1.y), 0, 1);
  const [x0, z0] = ringPoint(r0, a);
  const [x1, z1] = ringPoint(r1, a);
  return out.set(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t);
}

/** Boucle autour du buste ; `height(a)` donne la hauteur du milieu de la bande. */
function torsoLoop(height: (a: number) => number, lift: number, samples = 32) {
  const path: { p: T.Vector3; n: T.Vector3; up: T.Vector3 }[] = [];
  const p0 = new T.Vector3();
  const p1 = new T.Vector3();
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    const p = torsoSurface(height(a), a);
    // Normale : depuis l'axe du corps, à plat.
    const n = new T.Vector3(p.x, 0, p.z).normalize();
    p.addScaledVector(n, lift);
    // Direction de la bande et « haut » perpendiculaire dans la surface.
    torsoSurface(height(a - 0.05), a - 0.05, p0);
    torsoSurface(height(a + 0.05), a + 0.05, p1);
    const along = p1.sub(p0).normalize();
    const up = new T.Vector3().crossVectors(n, along).normalize();
    if (up.y < 0) up.negate();
    path.push({ p, n, up });
  }
  return path;
}

// ---------------------------------------------------------------- tenue

function wrapRings(hem: number, grow: number): Ring[] {
  // Haut : épouse la taille et le bassin ; bas : tombe autour des deux cuisses.
  const cloth: WeightFn = (x, y) => {
    const t = smooth((14.6 - y) / (14.6 - hem));
    const u = T.MathUtils.clamp(x / 1.7, -1, 1);
    const right = t * 0.8 * (0.5 + 0.5 * u);
    const left = t * 0.8 * (0.5 - 0.5 * u);
    return [[TORSO, 1 - left - right], [LEG[0], left], [LEG[1], right]];
  };
  return [
    { y: 17.0, rx: 2.62 + grow, rz: 1.77 + grow, w: cloth },
    { y: 15.6, rx: 2.95 + grow, rz: 1.85 + grow, back: 0.15, w: cloth },
    { y: 14.4, rx: 3.3 + grow, rz: 2.0 + grow, back: 0.45, w: cloth },
    { y: 12.6, rx: 3.45 + grow, rz: 2.25 + grow, back: 0.4, w: cloth },
    { y: hem, rx: 3.7 + grow, rz: 2.5 + grow, back: 0.3, w: cloth },
  ];
}

function addOutfit(b: Map<T.Material, SkinBuilder>, outfit: Outfit) {
  const at = (material: T.Material) => {
    let builder = b.get(material);
    if (!builder) b.set(material, builder = new SkinBuilder());
    return builder;
  };
  if (outfit.wrap) {
    const hem = outfit.wrap.hem ?? 10.2;
    at(outfit.wrap.material).tube(wrapRings(hem, 0.2), 14, 'y', [false, false]);
    // Envers du pagne (sinon l'intérieur est transparent vu d'en bas).
    at(outfit.wrap.material).tube(wrapRings(hem, 0.12).reverse(), 14, 'y', [false, false]);
    if (outfit.wrap.flap) {
      // Pan avant qui pend plus bas, en pointe (comme sur la référence).
      const flapW: WeightFn = (x, y) => {
        const t = smooth((14.6 - y) / (14.6 - hem)) * 0.4;
        return [[TORSO, 1 - 2 * t], [LEG[0], t], [LEG[1], t]];
      };
      const front = (y: number, half: number, z: number, tip = 0) => [
        { p: new T.Vector3(-half + tip, y, z), n: new T.Vector3(0, 0, 1), up: new T.Vector3(1, 0, 0) },
        { p: new T.Vector3(half + tip, y, z), n: new T.Vector3(0, 0, 1), up: new T.Vector3(1, 0, 0) },
      ];
      const rows = [front(16.4, 1.4, 2.0), front(13, 1.5, 2.45), front(hem - 0.2, 1.4, 2.72), front(hem - 1.7, 0.6, 2.75, 0.3)];
      const builder = at(outfit.wrap.material);
      // Deux faces aux sommets distincts (sinon les normales s'annulent).
      for (const face of [1, -1]) {
        const ids = rows.map((row) => row.map(({ p }) => builder.vertex(p.x, p.y, p.z + face * 0.03, flapW)));
        for (let i = 0; i + 1 < ids.length; i++) {
          const [a, b2] = ids[i];
          const [c, d] = ids[i + 1];
          if (face > 0) { builder.tri(a, c, b2); builder.tri(b2, c, d); } else { builder.tri(a, b2, c); builder.tri(b2, d, c); }
        }
      }
    }
    // Repli roulé de la ceinture du pagne.
    const band = outfit.wrap.band ?? outfit.wrap.material;
    at(band).band(torsoLoop((a) => 16.9 + Math.cos(a) * 0.15, 0.2), 1.1, 0.4, torsoW);
  }
  if (outfit.belt) at(outfit.belt).band(torsoLoop(() => 17.6, 0.15), 0.7, 0.3, torsoW);
  if (outfit.strap) {
    // De l'épaule droite (+X, a = π/2) à la hanche gauche (a = -π/2).
    at(outfit.strap).band(torsoLoop((a) => 20.4 + 3.4 * Math.sin(a), 0.12, 40), 0.75, 0.22, torsoW);
  }
  for (const i of [0, 1]) {
    const s = i === 0 ? -1 : 1;
    if (outfit.cuffs) {
      const w: Weights = [[FORE[i], 1]];
      at(outfit.cuffs).tube([
        { y: 17.3, cx: s * (SHOULDER_X + 0.42), rx: 0.86, rz: 0.88, w },
        { y: 16.2, cx: s * (SHOULDER_X + 0.34), rx: 0.75, rz: 0.75, w },
      ], 8);
    }
    if (outfit.armbands) {
      const w: Weights = [[ARM[i], 1]];
      at(outfit.armbands).tube([
        { y: 20.5, cx: s * (SHOULDER_X + 0.5), cz: 0.1, rx: 1.04, rz: 1.12, w },
        { y: 20.0, cx: s * (SHOULDER_X + 0.48), cz: 0.05, rx: 0.98, rz: 1.04, w },
      ], 8);
    }
    if (outfit.sandals) {
      const w: Weights = [[LEG[i], 1]];
      const cx = s * (HIP_X + 0.05);
      const sole = (z: number, rx: number): Ring => ({ y: z, cx, cz: 0.22, rx, rz: 0.13, w });
      const builder = at(outfit.sandals);
      builder.tube([sole(-1.15, 0.55), sole(-0.6, 0.72), sole(1.0, 0.88), sole(2.3, 0.98), sole(3.2, 0.85), sole(3.55, 0.5)], 8, 'z');
      // Lanières : sur le cou-de-pied et autour de la cheville.
      builder.tube([{ ...footRings(i, 0.1)[3], y: 1.75, rx: 0.95, rz: 0.43 }, { ...footRings(i, 0.1)[3], y: 2.15, rx: 0.93, rz: 0.4 }], 8, 'z');
      builder.tube([
        { y: 1.9, cx, cz: -0.05, rx: 0.68, rz: 0.72, w },
        { y: 1.5, cx, cz: -0.1, rx: 0.68, rz: 0.75, w },
      ], 8);
    }
  }
}

/** Matériau du contour sombre suivant le skinning (coque gonflée le long des normales). */
let outlineMaterial: T.MeshBasicMaterial | undefined;
function skinnedOutline() {
  if (outlineMaterial) return outlineMaterial;
  outlineMaterial = new T.MeshBasicMaterial({ color: PALETTE.outline, side: T.BackSide });
  outlineMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed += normalize(normal) * 0.28;');
  };
  outlineMaterial.customProgramCacheKey = () => 'skinned-outline';
  return outlineMaterial;
}

/**
 * Cache une primitive de l'ancien rig sans casser ce qui s'en sert : elle
 * reste un os (même parent, même index, même type de géométrie) mais sort du
 * calque rendu par la caméra. Ses enfants (détails rigides du visage…)
 * restent visibles. addOutlines l'ignore.
 */
export function hideProxy(object: T.Object3D) {
  object.layers.set(31);
  object.userData['outline'] = true;
  object.userData['proxy'] = true;
}

export interface BodyOptions {
  skin: T.Material;
  outfit?: Outfit;
  /** Contour sombre (héros et boss). */
  outline?: boolean;
  /** Matériaux des détails du visage. */
  eyes?: { white: T.Material; dark: T.Material };
}

/**
 * Habille un rig de son corps skinné. À appeler quand le rig est au repos
 * (aucune rotation), juste après sa construction. Les maillages sont ajoutés
 * comme enfants directs du buste (les animateurs qui collectent les
 * matériaux du buste pour le flash d'impact les trouvent ainsi).
 */
export function skinHuman(bones: BodyBones, options: BodyOptions): HumanBody {
  bones.root.updateMatrixWorld(true);
  const list = [bones.root, bones.torso, bones.head, ...bones.arms, ...bones.fore, ...bones.legs];
  // Les os sont les groupes du rig : three ne lit que leur matrixWorld.
  const skeleton = new T.Skeleton(list as T.Bone[]);
  const rest = new Map(list.map((bone) => [bone, bone.matrixWorld.clone()] as const));
  const human: HumanBody = {
    outfit: new T.Group(), meshes: [], skeleton, bones, bind: bones.root.matrixWorld.clone(), rest,
  };

  const body = new SkinBuilder();
  body.tube(TORSO_RINGS, 14);
  body.tube(headRings().reverse(), 12); // anneaux du haut vers le bas
  for (const i of [0, 1]) {
    body.tube(armRings(i), 8);
    body.tube(legRings(i), 10);
    body.tube(footRings(i), 8, 'z');
  }
  const skinMesh = skinnedMesh(human, body, options.skin, bones.torso, !!options.outline);
  skinMesh.name = 'human-body';
  const rigid = (bone: T.Object3D, mesh: T.Mesh, x: number, y: number, z: number) => rigidAt(human, bone, mesh, x, y, z);

  // Oreilles.
  const ear = new T.SphereGeometry(1, 5, 4);
  for (const s of [-1, 1]) {
    rigid(bones.head, new T.Mesh(ear, options.skin), s * 1.42, 27.35, 0.15).scale.set(0.28, 0.5, 0.4);
  }
  if (options.eyes) {
    const white = new T.BoxGeometry(0.46, 0.2, 0.12);
    const pupil = new T.BoxGeometry(0.2, 0.2, 0.08);
    for (const s of [-1, 1]) {
      rigid(bones.head, new T.Mesh(white, options.eyes.white), s * 0.55, 27.62, 1.98).rotation.y = s * 0.32;
      rigid(bones.head, new T.Mesh(pupil, options.eyes.dark), s * 0.55, 27.62, 2.04).rotation.y = s * 0.32;
    }
  }
  if (options.outfit?.hair) {
    // Cheveux ras : fine coque sur le haut du crâne, ligne frontale haute, nuque plus basse.
    const hair = new SkinBuilder();
    const head = headRings().reverse();
    const segments = 12;
    const rows: number[][] = [];
    const top = 29.5;
    for (const t of [1, 0.75, 0.5, 0.25, 0]) {
      const row: number[] = [];
      for (let j = 0; j < segments; j++) {
        const a = (j / segments) * Math.PI * 2;
        const edge = 27.75 + 0.75 * Math.cos(a);
        const y = edge + (top - edge) * t;
        const p = surface(head, y, a);
        const n = new T.Vector3(p.x, 0, p.z - 0.1).normalize();
        p.addScaledVector(n, 0.09 + 0.05 * t).y += 0.06 * t;
        row.push(hair.vertex(p.x, p.y, p.z, [[HEAD, 1]]));
      }
      rows.push(row);
    }
    for (let i = 0; i + 1 < rows.length; i++) {
      for (let j = 0; j < segments; j++) {
        const k = (j + 1) % segments;
        hair.tri(rows[i][j], rows[i + 1][j], rows[i][k]);
        hair.tri(rows[i][k], rows[i + 1][j], rows[i + 1][k]);
      }
    }
    const crown = hair.vertex(0, top + 0.12, 0.05, [[HEAD, 1]]);
    for (let j = 0; j < segments; j++) hair.tri(crown, rows[0][j], rows[0][(j + 1) % segments]);
    skinnedMesh(human, hair, options.outfit.hair, bones.torso, false).name = 'human-hair';
  }
  human.outfit = dressHuman(human, options.outfit ?? {}, !!options.outline);
  return human;
}

function skinnedMesh(human: HumanBody, builder: SkinBuilder, material: T.Material, parent: T.Object3D, outline: boolean) {
  const geometry = builder.geometry();
  const mesh = new T.SkinnedMesh(geometry, material);
  mesh.userData['outline'] = true; // addOutlines ne sait pas suivre un skinning
  mesh.frustumCulled = false;
  parent.add(mesh);
  // Sommets écrits dans le repère de la racine au repos : la liaison part de sa matrice.
  mesh.bind(human.skeleton, human.bind);
  human.meshes.push(mesh);
  if (outline) {
    const hull = new T.SkinnedMesh(geometry, skinnedOutline());
    hull.userData['outline'] = true;
    hull.frustumCulled = false;
    hull.raycast = () => undefined;
    parent.add(hull);
    hull.bind(human.skeleton, human.bind);
  }
  return mesh;
}

/** Détail rigide posé en coordonnées de repos (rig au repos) puis rattaché à son os. */
function rigidAt(human: HumanBody, bone: T.Object3D, mesh: T.Mesh, x: number, y: number, z: number) {
  bone.add(mesh);
  mesh.userData['outline'] = true;
  const inverse = (human.rest.get(bone) ?? bone.matrixWorld).clone().invert();
  mesh.position.set(x, y, z).applyMatrix4(inverse);
  return mesh;
}

/**
 * Habille un corps d'une tenue (pièces skinnées + détails rigides) dans un
 * groupe du buste. Plusieurs tenues peuvent coexister sur un même corps
 * (ex. Kofi / Badu sur le rig du duelliste) : on bascule leur visibilité.
 */
export function dressHuman(human: HumanBody, outfit: Outfit, outline = false): T.Group {
  const bones = human.bones;
  const group = new T.Group();
  group.name = 'human-outfit';
  bones.torso.add(group);
  const pieces = new Map<T.Material, SkinBuilder>();
  addOutfit(pieces, outfit);
  for (const [material, builder] of pieces) {
    if (!builder.empty) skinnedMesh(human, builder, material, group, outline && material === outfit.wrap?.material);
  }
  if (outfit.scars) {
    // Scarifications : courtes entailles claires (pectoraux, ventre, bras), skinnées comme le reste.
    const cuts = new SkinBuilder();
    const marks: [number, number, number, number, number, number][] = [
      [TORSO, 1.25, 22.0, 2.42, 0.55, 0.3], [TORSO, 1.6, 21.55, 2.36, 0.55, 0.45],
      [TORSO, -1.25, 22.0, 2.42, -0.55, -0.3], [TORSO, -1.6, 21.55, 2.36, -0.55, -0.45],
      [TORSO, 0.7, 18.6, 1.84, 0.7, 0.2], [TORSO, -0.7, 18.6, 1.84, -0.7, -0.2],
      [ARM[0], -(SHOULDER_X + 0.75), 21.6, 0.95, -0.6, -0.7], [ARM[1], SHOULDER_X + 0.75, 21.6, 0.95, 0.6, 0.7],
    ];
    for (const [bone, x, y, z, rz, ry] of marks) cuts.box(new T.Vector3(x, y, z), new T.Vector3(0.95, 0.09, 0.1), new T.Euler(0, ry, rz), [[bone, 1]]);
    skinnedMesh(human, cuts, outfit.scars, group, false);
  }
  return group;
}
