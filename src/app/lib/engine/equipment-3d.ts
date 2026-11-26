import * as T from 'three';
import { EQUIPMENT_CONFIG, type WeaponId } from '../constants/equipment.config-constant';
import { dressHuman, type HumanBody } from './human-body';
import { WeaponTrail } from './player-rig-3d';

interface ArrowView {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  grounded: boolean;
}

interface Pose { state: string; phase: number }

export interface GearLook { batakari: boolean; tier: 0 | 1 | 2; ready: boolean }

const TIERS = [
  { color: '#77746c', metalness: 0.3, roughness: 0.7 }, // fer de forge, terne
  { color: '#a7a69e', metalness: 0.55, roughness: 0.4 }, // fer poli
  { color: '#b89a4e', metalness: 0.65, roughness: 0.35 }, // incrustation de laiton
] as const;

const ARROW_POOL = 24;
const FLIGHT_HEIGHT = 19;
const BOW_RISE = 8;
const BOW_TIP_ANGLE = Math.PI * 0.09;
const BOW_DRAW_TRAVEL = 4.6;
const ARROW_SHAFT_LENGTH = 15;
const QUIVER_CAPACITY = EQUIPMENT_CONFIG.maxArrows;
const AFENA_WRAPS = 6;

export const WEAPON_DIMENSIONS = {
  spear: {
    shaftHalf: 18,
    baseTipY: 21.6,
    stretch: 1.25,
    stretchedTipY: 27,
    heelY: -19.4,
  },
  afena: { tipY: 13.8, guardY: 1.55, gripMin: -1.7, gripMax: 1.2 },
  bow: {
    tipY: BOW_RISE * (1 - Math.sin(BOW_TIP_ANGLE)),
    tipZ: BOW_RISE * Math.cos(BOW_TIP_ANGLE),
    drawTravel: BOW_DRAW_TRAVEL,
    nockOffset: 6.5,
  },
  arrow: { length: ARROW_SHAFT_LENGTH, flightHeight: FLIGHT_HEIGHT },
} as const;

export const WEAPON_MATERIALS = {
  wood: new T.MeshStandardMaterial({ color: '#6a4426', roughness: 0.84, flatShading: true }),
  darkWood: new T.MeshStandardMaterial({ color: '#4d301b', roughness: 0.88, flatShading: true }),
  leather: new T.MeshStandardMaterial({ color: '#4c2f1d', roughness: 0.92, flatShading: true }),
  fibre: new T.MeshBasicMaterial({ color: '#e8dcc0', side: T.DoubleSide }),
  feather: new T.MeshStandardMaterial({ color: '#d8cfae', roughness: 0.9, side: T.DoubleSide, flatShading: true }),
  iron: new T.MeshStandardMaterial({ color: '#8d8a80', metalness: 0.55, roughness: 0.45, flatShading: true }),
  darkIron: new T.MeshStandardMaterial({ color: '#5a5750', metalness: 0.5, roughness: 0.55, flatShading: true }),
  brass: new T.MeshStandardMaterial({ color: '#a07a35', metalness: 0.7, roughness: 0.45, flatShading: true }),
  bone: new T.MeshStandardMaterial({ color: '#d9c9a4', roughness: 0.8, flatShading: true }),
  blade: new T.MeshStandardMaterial({
    color: TIERS[0].color, metalness: TIERS[0].metalness, roughness: TIERS[0].roughness, flatShading: true,
  }),
  glow: new T.MeshBasicMaterial({
    color: '#ff9a3c', transparent: true, opacity: 0, depthWrite: false,
    side: T.DoubleSide, blending: T.AdditiveBlending,
  }),
} as const;

// Échelle : 1 unité ≈ 5 cm (un homme mesure ~34). Hampe de ~4 cm qui
// s'affine vers le fer, comme une lance de guerre en bois dur.
const SPEAR_SHAFT_GEOMETRY = new T.LatheGeometry([
  new T.Vector2(0.4, -18), new T.Vector2(0.44, -15), new T.Vector2(0.41, -10),
  new T.Vector2(0.37, -2), new T.Vector2(0.34, 8), new T.Vector2(0.3, 16), new T.Vector2(0.28, 18),
], 7);
const VEIN_GEOMETRY = new T.CylinderGeometry(0.035, 0.035, 34, 3);
const REAR_WRAP_GEOMETRY = new T.CylinderGeometry(0.49, 0.49, 0.7, 7);
const MID_WRAP_GEOMETRY = new T.CylinderGeometry(0.4, 0.4, 0.65, 7);
const SOCKET_GEOMETRY = new T.CylinderGeometry(0.3, 0.42, 2.4, 7);
const COLLAR_GEOMETRY = new T.CylinderGeometry(0.5, 0.38, 0.4, 7);
const BACK_FERRULE_GEOMETRY = new T.CylinderGeometry(0.42, 0.5, 1.5, 7);

export function leafBladeGeometry(length: number, halfWidth: number, ridge: number): T.BufferGeometry {
  const mid = length * 0.46;
  const base = new T.Vector3(0, 0, 0);
  const tip = new T.Vector3(0, length, 0);
  const left = new T.Vector3(-halfWidth, mid, 0);
  const right = new T.Vector3(halfWidth, mid, 0);
  const front = new T.Vector3(0, mid, ridge);
  const back = new T.Vector3(0, mid, -ridge);
  const vertices: number[] = [];
  const tri = (a: T.Vector3, b: T.Vector3, c: T.Vector3) => {
    vertices.push(c.x, c.y, c.z, b.x, b.y, b.z, a.x, a.y, a.z);
  };
  tri(base, left, front); tri(left, tip, front); tri(base, front, right); tri(front, tip, right);
  tri(base, back, left); tri(left, back, tip); tri(base, right, back); tri(right, tip, back);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function taperedTubeGeometry(curve: T.CatmullRomCurve3, segments: number, radial: number,
  from: number, to: number): T.BufferGeometry {
  const frames = curve.computeFrenetFrames(segments, false);
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const center = curve.getPointAt(t);
    const radius = from + (to - from) * t;
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];
    for (let j = 0; j < radial; j++) {
      const angle = (j / radial) * Math.PI * 2;
      const c = Math.cos(angle) * radius;
      const s = Math.sin(angle) * radius;
      positions.push(center.x + c * normal.x + s * binormal.x,
        center.y + c * normal.y + s * binormal.y,
        center.z + c * normal.z + s * binormal.z);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = (i + 1) * radial + j;
      const c = (i + 1) * radial + (j + 1) % radial;
      const d = i * radial + (j + 1) % radial;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildSpear(unstretch = 1): T.Group {
  const group = new T.Group();
  group.name = 'spear';
  group.add(new T.Mesh(SPEAR_SHAFT_GEOMETRY, WEAPON_MATERIALS.darkWood));
  const fitted = (mesh: T.Mesh, y: number) => {
    mesh.position.y = y;
    mesh.scale.y = unstretch;
    group.add(mesh);
    return mesh;
  };
  for (const angle of [0, 2.1, 4.2]) {
    const vein = new T.Mesh(VEIN_GEOMETRY, WEAPON_MATERIALS.darkWood);
    vein.position.x = Math.cos(angle) * 0.36;
    vein.position.z = Math.sin(angle) * 0.36;
    fitted(vein, 0);
  }
  for (const y of [-16.5, -15.1, -13.7]) fitted(new T.Mesh(REAR_WRAP_GEOMETRY, WEAPON_MATERIALS.leather), y);
  for (const y of [3.5, 5.2]) fitted(new T.Mesh(MID_WRAP_GEOMETRY, WEAPON_MATERIALS.leather), y);
  const half = WEAPON_DIMENSIONS.spear.shaftHalf;
  fitted(new T.Mesh(SOCKET_GEOMETRY, WEAPON_MATERIALS.iron), half + 0.2);
  fitted(new T.Mesh(COLLAR_GEOMETRY, WEAPON_MATERIALS.darkIron), half + 1.4);
  fitted(new T.Mesh(leafBladeGeometry(WEAPON_DIMENSIONS.spear.stretchedTipY - half * WEAPON_DIMENSIONS.spear.stretch,
    0.72, 0.16), WEAPON_MATERIALS.iron), half);
  fitted(new T.Mesh(new T.BoxGeometry(0.09, 3.7, 0.05), WEAPON_MATERIALS.darkIron), half + 1.8).position.z = 0.15;
  fitted(new T.Mesh(BACK_FERRULE_GEOMETRY, WEAPON_MATERIALS.iron), -half - 0.1);
  const heel = new T.Mesh(new T.ConeGeometry(0.4, 3, 5), WEAPON_MATERIALS.iron);
  heel.rotation.z = Math.PI;
  fitted(heel, WEAPON_DIMENSIONS.spear.heelY);
  return group;
}

export function buildAfena(): T.Group {
  const group = new T.Group();
  group.name = 'afena';
  const blade = WEAPON_MATERIALS.blade.clone();
  const glow = WEAPON_MATERIALS.glow.clone();
  group.userData['blade'] = blade;
  group.userData['glow'] = glow;
  group.userData['tipY'] = WEAPON_DIMENSIONS.afena.tipY;
  const grip = new T.Mesh(new T.CylinderGeometry(0.34, 0.4, 4.6, 7), WEAPON_MATERIALS.leather);
  grip.position.y = -0.85;
  const pommel = new T.Mesh(new T.IcosahedronGeometry(0.56, 0), WEAPON_MATERIALS.brass);
  pommel.position.y = -3.5;
  for (let i = 0; i < AFENA_WRAPS; i++) {
    const spiral = new T.Mesh(new T.TorusGeometry(0.39, 0.065, 3, 8), WEAPON_MATERIALS.leather);
    spiral.rotation.set(Math.PI / 2 + 0.14, i * 0.7, 0);
    spiral.position.y = -2.9 + i * 0.66;
    group.add(spiral);
  }
  const guard = new T.Mesh(new T.BoxGeometry(2.6, 0.26, 0.5), WEAPON_MATERIALS.brass);
  guard.position.y = WEAPON_DIMENSIONS.afena.guardY;
  for (const side of [-1, 1]) {
    const quillon = new T.Mesh(new T.ConeGeometry(0.22, 1.1, 4), WEAPON_MATERIALS.brass);
    quillon.rotation.z = -side * (Math.PI / 2 - 0.18);
    quillon.position.set(side * 1.6, 1.68, 0);
    group.add(quillon);
  }
  const neck = new T.Mesh(new T.CylinderGeometry(0.34, 0.44, 1.1, 7), WEAPON_MATERIALS.brass);
  neck.position.y = 2.1;
  const edge = new T.Mesh(leafBladeGeometry(WEAPON_DIMENSIONS.afena.tipY - 2.4, 0.86, 0.16), blade);
  edge.position.y = 2.4;
  const fuller = new T.Mesh(new T.BoxGeometry(0.11, 9.2, 0.05), WEAPON_MATERIALS.darkIron);
  fuller.position.set(0, 7.1, 0.15);
  const shimmer = new T.Mesh(new T.PlaneGeometry(2, 10.4), glow);
  shimmer.position.set(0, 7.8, -0.3);
  group.add(grip, pommel, guard, neck, edge, fuller, shimmer);
  return group;
}

export function buildBow(): T.Group {
  const group = new T.Group();
  group.name = 'bow';
  const { tipY, tipZ } = WEAPON_DIMENSIONS.bow;
  for (const side of [1, -1]) {
    const curve = new T.CatmullRomCurve3([
      new T.Vector3(0, 0, 0),
      new T.Vector3(0, 0.5, side * 2.2),
      new T.Vector3(0, 1.7, side * 4.8),
      new T.Vector3(0, tipY + 0.75, side * (tipZ - 1.5)),
      new T.Vector3(0, tipY, side * tipZ),
    ]);
    group.add(new T.Mesh(taperedTubeGeometry(curve, 9, 5, 0.4, 0.14), WEAPON_MATERIALS.wood));
    const nock = new T.Mesh(new T.IcosahedronGeometry(0.24, 0), WEAPON_MATERIALS.darkIron);
    nock.position.set(0, tipY, side * tipZ);
    group.add(nock);
  }
  const grip = new T.Mesh(new T.CylinderGeometry(0.52, 0.52, 2.6, 7), WEAPON_MATERIALS.leather);
  grip.rotation.x = Math.PI / 2;
  group.add(grip);
  for (const z of [-1.1, 1.1]) {
    const band = new T.Mesh(new T.TorusGeometry(0.54, 0.08, 3, 8), WEAPON_MATERIALS.brass);
    band.rotation.x = Math.PI / 2;
    band.position.z = z;
    group.add(band);
  }
  const sight = new T.Mesh(new T.SphereGeometry(0.2, 6, 4), WEAPON_MATERIALS.bone);
  sight.position.set(0, tipY * 0.55, tipZ * 0.62);
  group.add(sight);
  return group;
}

export function buildSword(): T.Group {
  const group = new T.Group();
  group.name = 'sword';
  const grip = new T.Mesh(new T.CylinderGeometry(0.32, 0.36, 3.8, 6), WEAPON_MATERIALS.leather);
  grip.position.y = -1.7;
  const pommel = new T.Mesh(new T.IcosahedronGeometry(0.42, 0), WEAPON_MATERIALS.brass);
  pommel.position.y = -3.7;
  const guard = new T.Mesh(new T.BoxGeometry(2.8, 0.24, 0.45), WEAPON_MATERIALS.brass);
  guard.position.y = 0.3;
  const edge = new T.Mesh(leafBladeGeometry(12, 0.62, 0.13), WEAPON_MATERIALS.iron);
  edge.position.y = 0.6;
  const fuller = new T.Mesh(new T.BoxGeometry(0.09, 9.8, 0.05), WEAPON_MATERIALS.darkIron);
  fuller.position.set(0, 5.6, 0.12);
  group.add(grip, pommel, guard, edge, fuller);
  return group;
}

export function buildMusket(): T.Group {
  const group = new T.Group();
  group.name = 'musket';
  const stock = new T.Mesh(new T.BoxGeometry(1.1, 13, 1.7), WEAPON_MATERIALS.darkWood);
  stock.position.set(0, -4, -1.1);
  const barrel = new T.Mesh(new T.CylinderGeometry(0.26, 0.32, 18, 7), WEAPON_MATERIALS.darkIron);
  barrel.position.y = 7;
  const band = new T.Mesh(new T.CylinderGeometry(0.4, 0.4, 0.5, 7), WEAPON_MATERIALS.brass);
  band.position.y = 5;
  const lock = new T.Mesh(new T.BoxGeometry(0.5, 1.3, 0.4), WEAPON_MATERIALS.iron);
  lock.position.set(0, 1, 0.95);
  group.add(stock, barrel, band, lock);
  return group;
}

export function buildClub(): T.Group {
  const group = new T.Group();
  group.name = 'club';
  const shaft = new T.Mesh(new T.CylinderGeometry(0.48, 0.78, 12, 6), WEAPON_MATERIALS.darkWood);
  const head = new T.Mesh(new T.IcosahedronGeometry(1.5, 0), WEAPON_MATERIALS.darkWood);
  head.position.y = 5.6;
  group.add(shaft, head);
  for (const y of [3.8, 5.4, 7]) {
    const ring = new T.Mesh(new T.CylinderGeometry(1.3, 1.3, 0.35, 6), WEAPON_MATERIALS.iron);
    ring.position.y = y;
    group.add(ring);
  }
  for (const angle of [0, 1.2, 2.4, 3.6, 4.8]) {
    const stud = new T.Mesh(new T.IcosahedronGeometry(0.34, 0), WEAPON_MATERIALS.iron);
    stud.position.set(Math.cos(angle) * 1.35, 5.6, Math.sin(angle) * 1.35);
    group.add(stud);
  }
  return group;
}

/**
 * Équipement visible du joueur en 3D : lance (le bâton déjà tenu en main
 * droite), arc en main gauche, feuilles de mixture à avaler, et flèches en vol / au sol.
 * Séparé de World3D pour rester indépendant du reste de la scène.
 */
export class Equipment3D {
  private readonly bow = new T.Group();
  private readonly mixture = new T.Group();
  private readonly healAura = new T.Group();
  private readonly auraMaterial = new T.MeshBasicMaterial({
    color: '#9be58a', transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false,
  });
  private readonly quiver = new T.Group();
  private readonly quiverFeathers: T.Mesh[] = [];
  private readonly arrows: T.Group[] = [];
  private readonly arrowStreaks: T.Mesh[] = [];
  private readonly arrowStreakMaterial = new T.MeshBasicMaterial({
    color: '#bfe9ff', transparent: true, opacity: 0.32, depthWrite: false,
    side: T.DoubleSide, blending: T.AdditiveBlending,
  });
  private readonly bowStrings: T.Mesh[] = [];
  private readonly nockedArrow = new T.Group();
  private arrowCount = 0;
  private ammo = 0;
  private weapon: WeaponId = 'spear';
  /** Afena (épée courte à lame en feuille) et batakari (tunique à talismans). */
  private readonly afena = buildAfena();
  private readonly afenaBlade = this.afena.userData['blade'] as T.MeshStandardMaterial;
  private readonly afenaGlow = this.afena.userData['glow'] as T.MeshBasicMaterial;
  private readonly afenaTrail: WeaponTrail;
  private batakari = new T.Group();
  private look: GearLook = { batakari: false, tier: 0, ready: false };

  constructor(
    scene: T.Scene,
    private readonly torso: T.Group,
    private readonly arms: T.Group[],
    private readonly spear: T.Object3D | undefined,
  ) {
    this.bow.add(...buildBow().children);
    const { tipY, tipZ } = WEAPON_DIMENSIONS.bow;
    const stringGeometry = new T.CylinderGeometry(0.07, 0.07, 1, 3);
    for (const side of [1, -1]) {
      const segment = new T.Mesh(stringGeometry, WEAPON_MATERIALS.fibre);
      segment.scale.y = tipZ;
      segment.position.set(0, tipY, side * tipZ / 2);
      segment.rotation.x = side * Math.PI / 2;
      this.bow.add(segment);
      this.bowStrings.push(segment);
    }
    this.bow.position.set(0, -8.6, 0.6);
    this.bow.visible = false;
    arms[0].add(this.bow);

    // Carquois dans le dos, visible quand l'arc est en main.
    const tube = new T.Mesh(new T.CylinderGeometry(1.5, 1.2, 11, 7), WEAPON_MATERIALS.leather);
    this.quiver.add(tube);
    for (const y of [-2.6, 2.4]) {
      const band = new T.Mesh(new T.CylinderGeometry(1.55, 1.55, 0.6, 7), WEAPON_MATERIALS.brass);
      band.position.y = y;
      this.quiver.add(band);
    }
    const cap = new T.Mesh(new T.ConeGeometry(1.65, 2.2, 7), WEAPON_MATERIALS.bone);
    cap.position.y = 6.2;
    this.quiver.add(cap);
    const quiverFeatherGeometry = new T.ConeGeometry(0.62, 2.6, 4);
    for (let i = 0; i < QUIVER_CAPACITY; i++) {
      const feather = new T.Mesh(quiverFeatherGeometry, WEAPON_MATERIALS.feather);
      const angle = i / QUIVER_CAPACITY * Math.PI * 2;
      feather.position.set(Math.cos(angle) * 0.7, 5.6 + (i % 3) * 0.5, Math.sin(angle) * 0.7);
      feather.rotation.z = (i % 3 - 1) * 0.2;
      feather.visible = false;
      this.quiver.add(feather);
      this.quiverFeathers.push(feather);
    }
    this.quiver.position.set(2.5, 7.5, -3.4);
    this.quiver.rotation.z = -0.45;
    this.quiver.visible = false;
    torso.add(this.quiver);

    const leaf = new T.MeshStandardMaterial({ color: '#4f8f3a', roughness: 0.85, side: T.DoubleSide });
    const leafLight = new T.MeshStandardMaterial({ color: '#7fbf58', roughness: 0.8, side: T.DoubleSide });
    for (let i = 0; i < 5; i++) {
      const blade = new T.Mesh(new T.SphereGeometry(1, 6, 4), i % 2 ? leaf : leafLight);
      blade.scale.set(1.15 + i * 0.14, 2.7 + i * 0.22, 0.16);
      blade.position.set((i - 2) * 0.75, -0.4 - i * 0.16, 0);
      blade.rotation.z = (i - 2) * 0.24;
      this.mixture.add(blade);
    }
    this.mixture.position.set(0, -8.6, 1.4);
    this.mixture.rotation.x = -0.5;
    this.mixture.visible = false;
    arms[0].add(this.mixture);

    const ring = new T.Mesh(new T.TorusGeometry(6.4, 0.22, 4, 24), this.auraMaterial);
    ring.rotation.x = Math.PI / 2;
    this.healAura.add(ring);
    for (let i = 0; i < 6; i++) {
      const mote = new T.Mesh(new T.SphereGeometry(0.55, 5, 4), this.auraMaterial);
      const angle = (i / 6) * Math.PI * 2;
      mote.position.set(Math.cos(angle) * 6.4, Math.sin(angle * 2) * 1.8, Math.sin(angle) * 3.2);
      mote.scale.set(0.6, 1.6, 0.28);
      this.healAura.add(mote);
    }
    this.healAura.position.y = 3;
    this.healAura.visible = false;
    torso.add(this.healAura);

    this.afena.position.set(0, -8.6, 1);
    this.afena.rotation.x = Math.PI / 2 - 0.18;
    this.afena.visible = false;
    arms[1].add(this.afena);
    this.afenaTrail = new WeaponTrail(scene, 8, new T.Vector3(0, 13.6, 0), new T.Vector3(0, 6, 0));

    // Batakari : tunique de coton rayé couverte de sachets de cuir (talismans).
    const cotton = new T.MeshStandardMaterial({ color: '#c8b48a', roughness: 0.95, flatShading: true });
    const stripe = new T.MeshStandardMaterial({ color: '#5b4a73', roughness: 0.95, flatShading: true });
    const smock = new T.Mesh(new T.CylinderGeometry(5.9, 6.6, 11.5, 8), cotton);
    smock.position.y = 1.6;
    const band = new T.Mesh(new T.CylinderGeometry(6.65, 6.7, 1.2, 8), stripe);
    band.position.y = -3.4;
    this.batakari.add(smock, band);
    const pouch = new T.BoxGeometry(1.6, 1.9, 0.9);
    const red = new T.MeshStandardMaterial({ color: '#8f2e22', roughness: 0.9, flatShading: true });
    for (let i = 0; i < 10; i++) {
      const angle = i / 10 * Math.PI * 2;
      const charm = new T.Mesh(pouch, i % 3 ? WEAPON_MATERIALS.leather : red);
      const height = i % 2 ? 4.4 : 0.6;
      charm.position.set(Math.sin(angle) * 6.3, height, Math.cos(angle) * 6.3);
      charm.rotation.y = angle;
      this.batakari.add(charm);
    }
    this.batakari.visible = false;
    // Ajusté au corps skinné (human-body.ts), plus étroit que l'ancien buste cylindrique.
    this.batakari.scale.set(0.64, 1, 0.46);
    torso.add(this.batakari);

    // Réserve de flèches partagée (même géométrie et matériau).
    const shaftGeometry = new T.CylinderGeometry(0.15, 0.15, ARROW_SHAFT_LENGTH, 4);
    const tipGeometry = new T.ConeGeometry(0.4, 2.2, 4);
    const arrowFeatherGeometry = new T.ConeGeometry(0.34, 2.2, 3);
    const streakGeometry = new T.PlaneGeometry(1.1, 13);
    for (let i = 0; i < ARROW_POOL; i++) {
      const arrow = new T.Group();
      const shaft = new T.Mesh(shaftGeometry, WEAPON_MATERIALS.wood);
      shaft.rotation.x = Math.PI / 2;
      const head = new T.Mesh(tipGeometry, WEAPON_MATERIALS.iron);
      head.rotation.x = Math.PI / 2;
      head.position.z = 8.2;
      const streak = new T.Mesh(streakGeometry, this.arrowStreakMaterial);
      streak.rotation.x = Math.PI / 2;
      streak.position.z = -6.5;
      streak.visible = false;
      arrow.add(shaft, head, streak);
      for (let j = 0; j < 3; j++) {
        const angle = j / 3 * Math.PI * 2;
        const feather = new T.Mesh(arrowFeatherGeometry, WEAPON_MATERIALS.feather);
        feather.position.set(Math.cos(angle) * 0.42, Math.sin(angle) * 0.42, -4.2);
        feather.rotation.set(Math.PI / 2, 0, angle);
        feather.scale.set(0.35, 1, 1);
        arrow.add(feather);
      }
      arrow.visible = false;
      scene.add(arrow);
      this.arrows.push(arrow);
      this.arrowStreaks.push(streak);
    }
    const nockShaft = new T.Mesh(shaftGeometry, WEAPON_MATERIALS.wood);
    nockShaft.position.y = -6.5;
    const nockHead = new T.Mesh(tipGeometry, WEAPON_MATERIALS.iron);
    nockHead.rotation.x = Math.PI;
    nockHead.position.y = -15.2;
    this.nockedArrow.add(nockShaft, nockHead);
    for (let i = 0; i < 3; i++) {
      const angle = i / 3 * Math.PI * 2;
      const feather = new T.Mesh(arrowFeatherGeometry, WEAPON_MATERIALS.feather);
      feather.position.set(Math.cos(angle) * 0.42, -2.2, Math.sin(angle) * 0.42);
      feather.rotation.y = angle;
      feather.scale.set(0.35, 1, 1);
      this.nockedArrow.add(feather);
    }
    this.nockedArrow.visible = false;
    this.bow.add(this.nockedArrow);
  }

  /**
   * Habillage modulaire : batakari attaché au torse (os du buste), teinte de
   * la lame selon le niveau de Force (fer terne → fer poli → incrustation de
   * laiton, matériaux de l'époque), lueur chaude quand l'attaque spéciale est prête.
   */
  /**
   * Batakari ajusté au corps skinné (human-body.ts) : la blouse suit le buste
   * et s'évase sur les cuisses, au lieu d'un cylindre posé autour du torse.
   */
  fitBody(body: HumanBody) {
    const flat = (color: string) => new T.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true });
    const fitted = dressHuman(body, {
      smock: { cloth: flat('#c9b58c'), trim: flat('#2f3a5a'), charm: flat('#4c2f1d'), red: flat('#8f2e22') },
    });
    fitted.name = 'batakari';
    fitted.visible = this.batakari.visible;
    this.batakari.removeFromParent();
    this.batakari = fitted;
  }

  setLook(look: GearLook) {
    if (look.batakari === this.look.batakari && look.tier === this.look.tier && look.ready === this.look.ready) return;
    this.look = look;
    this.batakari.visible = look.batakari;
    const tint = TIERS[look.tier];
    this.afenaBlade.color.set(tint.color);
    this.afenaBlade.metalness = tint.metalness;
    this.afenaBlade.roughness = tint.roughness;
    this.afenaBlade.emissive.set(look.ready ? '#7a3a10' : '#000000');
    this.afenaGlow.opacity = look.ready ? 0.22 : 0;
  }

  setWeapon(weapon: WeaponId) {
    this.weapon = weapon;
  }

  setAmmo(ammo: number) {
    this.ammo = ammo;
    const shown = Math.min(QUIVER_CAPACITY, Math.max(0, ammo));
    this.quiverFeathers.forEach((feather, i) => { feather.visible = i < shown; });
  }

  get warmables(): T.Object3D[] {
    return [this.afena, this.bow, this.nockedArrow, this.quiver, this.mixture, this.healAura,
      this.batakari, ...this.quiverFeathers, ...this.arrows, ...this.arrowStreaks];
  }

  setArrows(arrows: readonly ArrowView[]) {
    this.arrowCount = arrows.length;
    this.arrows.forEach((mesh, i) => {
      const arrow = arrows[i];
      mesh.visible = !!arrow;
      this.arrowStreaks[i].visible = !!arrow && !arrow.grounded;
      if (!arrow) return;
      mesh.rotation.set(0, Math.atan2(arrow.dirX, arrow.dirY), 0);
      if (arrow.grounded) {
        // Plantée dans le sol, pointe vers le bas.
        mesh.position.set(arrow.x, 3.2, arrow.y);
        mesh.rotateX(0.85);
      } else {
        mesh.position.set(arrow.x, FLIGHT_HEIGHT, arrow.y);
      }
    });
  }

  /** À appeler après l'animation de base du joueur : armes visibles et bras. */
  applyPose(pose: Pose) {
    const drinking = pose.state === 'drinking';
    const bow = this.weapon === 'bow';
    this.bow.visible = bow && !drinking;
    this.quiver.visible = bow;
    this.mixture.visible = drinking;
    if (this.spear) this.spear.visible = this.weapon === 'spear' && !drinking;
    this.afena.visible = this.weapon === 'afena' && !drinking;
    const pulse = Math.sin(performance.now() / 160);
    this.afenaBlade.emissiveIntensity = this.look.ready ? 0.6 + pulse * 0.35 : 1;
    this.afenaGlow.opacity = this.look.ready ? 0.2 + pulse * 0.08 : 0;
    this.nockedArrow.visible = bow && !drinking && this.ammo > 0;
    this.setBowDraw(0);
    if (!drinking) {
      this.healAura.visible = false;
      this.auraMaterial.opacity = 0;
      this.mixture.position.y = -8.6;
      this.mixture.scale.setScalar(1);
      this.mixture.rotation.z = 0;
    }

    const [left, right] = this.arms;
    if (pose.state === 'aiming' || pose.state === 'release') {
      // Bras gauche tendu vers l'avant, main droite tire la corde vers l'épaule.
      const draw = pose.state === 'aiming' ? Math.min(1, pose.phase * 1.4) : 1 - pose.phase;
      left.rotation.set(-1.5 * Math.max(draw, 0.35), 0, -0.1);
      right.rotation.set(-1.3 * Math.max(draw, 0.2), 0, 0.55 * draw);
      this.torso.rotation.set(0, -0.32 * draw, 0);
      this.setBowDraw(draw);
    } else if (drinking) {
      const phase = Math.min(1, Math.max(0, pose.phase));
      const lift = Math.min(1, phase / 0.45);
      const crush = Math.min(1, Math.max(0, (phase - 0.45) / 0.2));
      const swallow = Math.min(1, Math.max(0, (phase - 0.65) / 0.35));
      const restored = Math.min(1, Math.max(0,
        (phase - EQUIPMENT_CONFIG.mixtureHealAt) / (1 - EQUIPMENT_CONFIG.mixtureHealAt)));

      this.mixture.position.y = -8.6 + lift * 2.4 - swallow * 1.2;
      this.mixture.scale.setScalar(1 - crush * 0.38);
      this.mixture.rotation.z = crush * 0.7;
      this.healAura.visible = restored > 0;
      this.healAura.scale.setScalar(0.7 + restored * 0.6);
      this.auraMaterial.opacity = Math.sin(restored * Math.PI) * 0.75;

      left.rotation.set(-2.3 * lift + 0.7 * swallow, 0, 0.5 * lift);
      right.rotation.set(-1.8 * lift + 0.9 * swallow, 0, -0.4 * lift);
      this.torso.rotation.set(-0.12 * lift + 0.2 * swallow, 0, 0);
    }

    let trail = 0;
    if (this.afena.visible) {
      if (pose.state === 'attacking') trail = 1;
      else if (pose.state === 'windup' && pose.phase > 0.8) trail = 0.4;
      else if (pose.state === 'recover' && pose.phase < 0.2) trail = 0.35;
    }
    this.afenaTrail.push(this.afena, trail, this.look.ready ? [1, 0.68, 0.26] : [0.62, 0.9, 0.76]);
  }

  private setBowDraw(draw: number) {
    const nockY = WEAPON_DIMENSIONS.bow.tipY + draw * WEAPON_DIMENSIONS.bow.drawTravel;
    for (let i = 0; i < this.bowStrings.length; i++) {
      const side = i === 0 ? 1 : -1;
      const segment = this.bowStrings[i];
      const dz = side * WEAPON_DIMENSIONS.bow.tipZ;
      const dy = WEAPON_DIMENSIONS.bow.tipY - nockY;
      segment.scale.y = Math.hypot(dy, dz);
      segment.rotation.x = Math.atan2(dz, dy);
      segment.position.set(0, (nockY + WEAPON_DIMENSIONS.bow.tipY) / 2, dz / 2);
    }
    this.nockedArrow.position.y = nockY;
  }
}
