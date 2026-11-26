import * as T from 'three';
import { dressHuman, type Outfit } from './human-body';
import { buildHumanoid, type HumanoidRig } from './humanoid-rig';

/**
 * Corps humain « figé » : le même corps skinné que les personnages animés
 * (human-body.ts), posé une fois puis cuit en géométrie statique, une pièce
 * par couleur. Pour les figurants immobiles en grand nombre (morts du champ
 * de bataille, guerriers du camp, silhouette du menu) dessinés en
 * InstancedMesh ou fusionnés : aucun os à animer, mêmes formes que les vivants.
 */

export type BakedPart = [T.BufferGeometry, string, T.Matrix4];

export interface BakeOptions {
  outfit: (m: (color: string) => T.Material) => Outfit;
  /** Batakari ajusté par-dessus. */
  smock?: { cloth: string; trim: string; charm: string; red: string };
  skin?: string;
  /** Pose appliquée aux os (rig au repos, pieds à l'origine, avant = +Z). */
  pose?: (rig: HumanoidRig) => void;
  /** Placement final de la géométrie cuite (ex. couché sur le dos). */
  place?: T.Matrix4;
  /** Yeux (inutile de loin ou sur un mort face contre terre). */
  eyes?: boolean;
  /**
   * Pli des genoux [gauche, droite] en radians (le squelette animé n'a pas de
   * genou : on plie la jambe sous le genou avant de poser les os).
   */
  knees?: [number, number];
  /** Ne garder que les triangles portés par ces os (0 hanches, 1 buste, 2 tête, 3-4 bras, 5-6 avant-bras, 7-8 jambes). */
  bones?: number[];
}

const KNEE_Y = 8.1;

const v = new T.Vector3();

/** Cuit un humain posé en pièces [géométrie, couleur, matrice identité], groupées par couleur. */
export function bakeHuman(options: BakeOptions): BakedPart[] {
  const materials: T.MeshStandardMaterial[] = [];
  const m = (color: string) => {
    const material = new T.MeshStandardMaterial({ color });
    materials.push(material);
    return material;
  };
  const rig = buildHumanoid(m, '#000000', '#000000', { bareChest: true, outfit: options.outfit(m) });
  rig.root.updateMatrixWorld(true);
  if (options.smock && rig.body) {
    const s = options.smock;
    dressHuman(rig.body, { smock: { cloth: m(s.cloth), trim: m(s.trim), charm: m(s.charm), red: m(s.red) } });
  }
  // Le bâton du rig n'a rien à faire ici : chaque figurant porte sa propre arme.
  rig.arms[1].children.at(-1)!.visible = false;
  if (options.skin && rig.body) (rig.body.meshes[0].material as T.MeshStandardMaterial).color.set(options.skin);
  options.pose?.(rig);
  rig.root.updateMatrixWorld(true);
  rig.body?.skeleton.update();

  const shown = (object: T.Object3D) => {
    for (let o: T.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
    return (object.layers.mask & 1) !== 0;
  };
  const byColor = new Map<string, T.BufferGeometry[]>();
  rig.root.traverse((object) => {
    if (!(object instanceof T.Mesh) || !shown(object)) return;
    const material = object.material as T.Material;
    if (!(material instanceof T.MeshStandardMaterial)) return; // contours, ombre
    if (!options.eyes && object.geometry instanceof T.BoxGeometry && object.parent === rig.torso.children[3]) return;
    const source = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    const position = source.attributes['position'] as T.BufferAttribute;
    const skinIndex = source.attributes['skinIndex'] as T.BufferAttribute | undefined;
    const skinWeight = source.attributes['skinWeight'] as T.BufferAttribute | undefined;
    // Os dominant d'un sommet (détails rigides : leur os parent, la tête en pratique).
    const dominant = (i: number) => {
      if (!skinIndex || !skinWeight) return object.parent === rig.torso.children[3] ? 2 : 1;
      let best = 0;
      for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, best)) best = k;
      return skinIndex.getComponent(i, best);
    };
    const keep: number[] = [];
    for (let t = 0; t < position.count; t += 3) {
      if (!options.bones || options.bones.includes(dominant(t))) keep.push(t, t + 1, t + 2);
    }
    if (!keep.length) { source.dispose(); return; }
    const out = new Float32Array(keep.length * 3);
    for (let n = 0; n < keep.length; n++) {
      const i = keep[n];
      v.fromBufferAttribute(position, i);
      if (options.knees && skinIndex && v.y < KNEE_Y + 0.6) {
        const bone = dominant(i);
        const side = bone === 7 ? 0 : bone === 8 ? 1 : -1;
        if (side === 0 || side === 1) {
          // Rotation autour de l'axe du genou, fondue sur une unité au niveau de l'articulation.
          const angle = options.knees[side] * Math.min(1, (KNEE_Y + 0.6 - v.y) / 1.1);
          const dy = v.y - KNEE_Y;
          const dz = v.z - 0.1;
          v.y = KNEE_Y + dy * Math.cos(angle) - dz * Math.sin(angle);
          v.z = 0.1 + dy * Math.sin(angle) + dz * Math.cos(angle);
        }
      }
      // applyBoneTransform lit les poids de la géométrie d'origine (indexée).
      if (object instanceof T.SkinnedMesh) object.applyBoneTransform(object.geometry.index ? object.geometry.index.getX(i) : i, v);
      v.applyMatrix4(object.matrixWorld);
      if (options.place) v.applyMatrix4(options.place);
      v.toArray(out, n * 3);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(out, 3));
    g.computeVertexNormals();
    source.dispose();
    const hex = `#${material.color.getHexString()}`;
    byColor.set(hex, [...(byColor.get(hex) ?? []), g]);
  });
  materials.forEach((material) => material.dispose());
  const parts: BakedPart[] = [];
  for (const [hex, list] of byColor) {
    const merged = list.length === 1 ? list[0] : mergeSimple(list);
    parts.push([merged, hex, new T.Matrix4()]);
  }
  return parts;
}

function mergeSimple(list: T.BufferGeometry[]) {
  const total = list.reduce((n, g) => n + g.attributes['position'].count, 0);
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  let offset = 0;
  for (const g of list) {
    position.set(g.attributes['position'].array as Float32Array, offset * 3);
    normal.set(g.attributes['normal'].array as Float32Array, offset * 3);
    offset += g.attributes['position'].count;
    g.dispose();
  }
  const merged = new T.BufferGeometry();
  merged.setAttribute('position', new T.BufferAttribute(position, 3));
  merged.setAttribute('normal', new T.BufferAttribute(normal, 3));
  return merged;
}

/**
 * Couché sur le dos, tête vers +X, pieds vers -X (repère des anciens corps du
 * prologue) : le haut du corps (+Y du rig) part en +X, la face (+Z) regarde le ciel.
 */
export const LYING_ON_BACK = new T.Matrix4().makeBasis(
  new T.Vector3(0, 0, 1), new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0),
).setPosition(-15, 2.2, 0);

/** Couché sur le flanc, recroquevillé (même axe tête-pieds). */
export const LYING_ON_SIDE = new T.Matrix4().makeBasis(
  new T.Vector3(0, 1, 0), new T.Vector3(1, 0, 0), new T.Vector3(0, 0, -1),
).setPosition(-12, 4.3, 0);

/** Pièces cuites → une géométrie à couleurs de sommets (pour un seul maillage). */
export function coloredGeometry(parts: BakedPart[]) {
  const color = new T.Color();
  const total = parts.reduce((n, [g]) => n + g.attributes['position'].count, 0);
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  let offset = 0;
  for (const [g, hex] of parts) {
    const count = g.attributes['position'].count;
    position.set(g.attributes['position'].array as Float32Array, offset * 3);
    normal.set(g.attributes['normal'].array as Float32Array, offset * 3);
    color.set(hex);
    for (let i = 0; i < count; i++) color.toArray(colors, (offset + i) * 3);
    offset += count;
    g.dispose();
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new T.BufferAttribute(normal, 3));
  geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  return geometry;
}
