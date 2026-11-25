import * as T from 'three';

/**
 * Squelette humanoïde partagé (« rig sharing ») : le joueur, le duelliste et
 * les villageois sont construits par la même fonction, avec la même
 * hiérarchie d'articulations. Une pose ou un animateur écrit pour l'un
 * s'applique aux autres sans adaptation, et les géométries de base sont
 * créées une seule fois pour tous.
 *
 * Les articulations portent les noms Mixamo (sans le préfixe `mixamorig:`) :
 * si l'on passe un jour à des modèles GLTF skinnés (Mixamo simplifié à
 * 20-25 os), les mêmes canaux d'animation pourront viser ces os par leur nom.
 * Aujourd'hui le rig low poly n'en utilise que 8 :
 *
 *   Hips (racine) ─ Spine (torse, porte la tête)
 *                 │   ├─ LeftArm
 *                 │   └─ RightArm ─ RightHand (poignet de l'arme, ajouté par l'animateur)
 *                 ├─ LeftUpLeg
 *                 └─ RightUpLeg
 */
export const HUMANOID_BONES = {
  root: 'Hips',
  torso: 'Spine',
  arms: ['LeftArm', 'RightArm'],
  legs: ['LeftUpLeg', 'RightUpLeg'],
  wrist: 'RightHand',
} as const;

export interface HumanoidRig {
  root: T.Group;
  torso: T.Group;
  arms: T.Group[];
  legs: T.Group[];
}

type MaterialFactory = (color: string) => T.Material;

/** Géométries partagées par tous les humanoïdes (une seule copie GPU). */
let shared: Record<string, T.BufferGeometry> | null = null;
function geometries() {
  shared ??= {
    chest: new T.CylinderGeometry(5.4, 3.8, 9, 7),
    hips: new T.CylinderGeometry(4.4, 5.6, 7, 7),
    belt: new T.CylinderGeometry(4.3, 4.4, 1.7, 8),
    head: new T.SphereGeometry(3.4, 8, 6),
    hair: new T.SphereGeometry(3.1, 7, 5),
    arm: new T.CylinderGeometry(1.45, 1.13, 8, 6),
    hand: new T.SphereGeometry(1.3, 6, 4),
    leg: new T.CylinderGeometry(1.65, 1.08, 12, 6),
    foot: new T.BoxGeometry(2.6, 1.7, 4.2),
    staff: new T.CylinderGeometry(0.58, 0.78, 36, 7),
    shadow: new T.CircleGeometry(10, 18),
  };
  return shared;
}

function part(parent: T.Object3D, geometry: T.BufferGeometry, material: T.Material, x: number, y: number, z: number) {
  const mesh = new T.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/**
 * Construit un humanoïde low poly. L'arme (bâton/lance) est la dernière
 * pièce du bras droit ; l'ombre est un disque sous la racine.
 */
export function buildHumanoid(material: MaterialFactory, clothColor: string, accentColor: string,
  options: { bareChest?: boolean } = {}): HumanoidRig {
  const g = geometries();
  const root = new T.Group();
  root.name = HUMANOID_BONES.root;
  const torso = new T.Group();
  torso.name = HUMANOID_BONES.torso;
  torso.position.y = 16;
  root.add(torso);
  const cloth = material(clothColor);
  const skin = material('#663b2b');
  const accent = material(accentColor);
  // Torse nu sous une toge (épaule droite découverte) : la poitrine prend la peau.
  part(torso, g['chest'], options.bareChest ? skin : cloth, 0, 4, 0);
  part(torso, g['hips'], cloth, 0, -2, 0);
  part(torso, g['belt'], accent, 0, 0.5, 0);
  part(torso, g['head'], skin, 0, 11, 0.5);
  part(torso, g['hair'], material('#211917'), 0, 12.1, -0.7);
  const arms: T.Group[] = [];
  const legs: T.Group[] = [];
  for (const [i, side] of [-1, 1].entries()) {
    const arm = new T.Group();
    arm.name = HUMANOID_BONES.arms[i];
    arm.position.set(side * 5, 7, 0);
    torso.add(arm);
    arms.push(arm);
    part(arm, g['arm'], skin, 0, -3.4, 0);
    part(arm, g['hand'], skin, 0, -8.1, 0.5);
    const leg = new T.Group();
    leg.name = HUMANOID_BONES.legs[i];
    leg.position.set(side * 2.6, 14, 0);
    root.add(leg);
    legs.push(leg);
    part(leg, g['leg'], skin, 0, -6.4, 0);
    part(leg, g['foot'], skin, 0, -12.6, 0.9);
  }
  const staff = part(arms[1], g['staff'], material('#775235'), 0, -8.5, 10);
  staff.rotation.x = Math.PI / 2 - 0.18;
  const shadow = part(root, g['shadow'],
    new T.MeshBasicMaterial({ color: '#302119', transparent: true, opacity: 0.28, depthWrite: false }), 0, 0.15, 0);
  shadow.rotation.x = -Math.PI / 2;
  return { root, torso, arms, legs };
}
