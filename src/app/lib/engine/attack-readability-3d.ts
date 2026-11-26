import * as T from 'three';
import { BOSS_CONFIG } from '../constants/boss.config-constant';
import { PALETTE } from '../constants/landscape';
import { BOSS_ATTACKS, BOSS_STRIKES, SHOT_WIDTH, comboStepAt, type BossAttackType } from '../interfaces/BossAttackData';

/**
 * Lisibilité des coups en low poly :
 * - contours sombres (coque inversée) autour des combattants, pour que leur
 *   silhouette se détache du sol et de la brume ;
 * - zone de danger au sol pendant l'anticipation du boss : elle se remplit
 *   au rythme de la préparation et flashe juste avant l'impact (l'éclat sur
 *   l'arme est déjà fait par boss-fx-3d.ts). Les formes reprennent les hitbox de
 *   GameStateService.checkBossAttack (cône, disque, couloir de charge, anneau) ;
 *   chaque coup a la sienne (sauf la feinte, exprès), y compris revers, estoc et point de chute
 *   du saut. Les frappes enchaînées (combo, faucheuse, moulinet) annoncent
 *   chaque coup pendant la phase active.
 */

/**
 * Ajoute une coque inversée sombre à chaque pièce opaque. Les coques sont
 * enfants des pièces : elles suivent animations et visibilité sans code.
 * Épaisseur constante (≈ `thickness` unités) quelle que soit la taille.
 */
export function addOutlines(roots: T.Object3D[], thickness = 0.42) {
  const material = new T.MeshBasicMaterial({ color: PALETTE.outline, side: T.BackSide });
  const box = new T.Box3();
  const size = new T.Vector3();
  const center = new T.Vector3();
  for (const root of roots) {
    const parts: T.Mesh[] = [];
    root.traverse((object) => {
      if (!(object instanceof T.Mesh) || object.userData['outline'] || object instanceof T.InstancedMesh) return;
      const m = object.material as T.Material;
      if (Array.isArray(object.material) || m.transparent || !(m instanceof T.MeshStandardMaterial)) return;
      const g = object.geometry;
      if (g instanceof T.CircleGeometry || g instanceof T.PlaneGeometry || g instanceof T.RingGeometry) return;
      parts.push(object);
    });
    for (const part of parts) {
      box.setFromBufferAttribute(part.geometry.attributes['position'] as T.BufferAttribute);
      box.getSize(size);
      box.getCenter(center);
      const hull = new T.Mesh(part.geometry, material);
      hull.userData['outline'] = true;
      hull.scale.set(
        (size.x + thickness * 2) / Math.max(size.x, 0.01),
        (size.y + thickness * 2) / Math.max(size.y, 0.01),
        (size.z + thickness * 2) / Math.max(size.z, 0.01));
      hull.position.copy(center).multiply(new T.Vector3(1, 1, 1).sub(hull.scale));
      hull.raycast = () => undefined;
      part.add(hull);
    }
  }
}

export interface ThreatPose {
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  state: string;
  /** Avancement 0→1 de l'état courant. */
  progress: number;
  attack: BossAttackType;
  /** Tir du boss : un couloir par balle. */
  shotAngles?: readonly number[];
  /** Point visé verrouillé (charge, sillon, saut). */
  targetX?: number;
  targetY?: number;
  /** Coup en cours dans les attaques à plusieurs frappes. */
  comboStep?: number;
}

type Attack = Exclude<BossAttackType, 'none'>;

/** Demi-angles des secteurs : repris des tests `along` de checkBossAttack. */
const SECTORS = {
  cone: Math.acos(0.22), // slash, combo
  reap: Math.acos(-0.25),
  mill: Math.acos(0.1),
  back: Math.PI - Math.acos(0.2), // revers : tout ce qui est derrière l'épaule
  disc: Math.PI,
} as const;
type SectorId = keyof typeof SECTORS;

/** Une zone à dessiner cette image (coordonnées monde, cap = yaw). */
type Zone =
  | { kind: 'sector'; id: SectorId; x: number; y: number; yaw: number; radius: number; grow: boolean }
  | { kind: 'lane'; x: number; y: number; yaw: number; half: number; length: number };

/**
 * Début de la fenêtre qui blesse (avancement de l'état « attacking »), voir
 * isBossHitActive. Tant qu'elle n'est pas ouverte, la zone reste affichée
 * pleine : un saut ou un jugement retardé reste lisible jusqu'à l'impact.
 */
const HIT_START: Partial<Record<Attack, number>> = {
  judgment: 0.2, backhand: 0.2, thrust: 0.2, leap: 0.72, sweep: 0.15,
};

/** Couche 3D (World3D.addLayer) : zone de danger pendant l'anticipation. */
export class AttackTelegraph3D {
  private readonly group = new T.Group();
  private readonly fill: T.MeshBasicMaterial;
  private readonly edge: T.MeshBasicMaterial;
  /** Deux secteurs par forme (moulinet : coup courant + disque). */
  private readonly sectors = new Map<SectorId, { fill: T.Mesh; edge: T.Mesh }[]>();
  private readonly lanes: { fill: T.Mesh; edge: T.Mesh }[] = [];
  private readonly danger = new T.Color(PALETTE.danger);
  private readonly flash = new T.Color(PALETTE.dangerFlash);
  private release = 0;
  private lastAttack: BossAttackType = 'none';
  private readonly zones: Zone[] = [];

  constructor(private readonly scene: T.Scene, private readonly read: () => ThreatPose | null) {
    this.fill = new T.MeshBasicMaterial({ color: PALETTE.danger, transparent: true, depthWrite: false, opacity: 0.2, side: T.DoubleSide });
    this.edge = new T.MeshBasicMaterial({ color: PALETTE.danger, transparent: true, depthWrite: false, opacity: 0.7, side: T.DoubleSide });
    // Rayon unité : chaque attaque met l'échelle à sa portée.
    for (const id of Object.keys(SECTORS) as SectorId[]) {
      const half = SECTORS[id];
      this.sectors.set(id, [0, 1].map(() => this.pair(groundSector(half), groundSectorEdge(half))));
    }
    for (let i = 0; i < 3; i++) this.lanes.push(this.pair(groundLane(), groundLaneEdge()));
    this.hideAll();
    scene.add(this.group);
  }

  /** Zones cachées hors anticipation : précompilées par World3D.warmUp. */
  get warmables(): T.Object3D[] {
    return [...[...this.sectors.values()].flat(), ...this.lanes].flatMap(({ fill, edge }) => [fill, edge]);
  }

  update(dt: number) {
    const pose = this.read();
    const windup = pose?.state === 'windup' && pose.attack !== 'none';
    const active = pose?.state === 'attacking' && pose.attack !== 'none';
    if (pose && (windup || active)) this.lastAttack = pose.attack;
    this.hideAll();
    if (!pose || (!windup && !active) || this.lastAttack === 'none') { this.release = 0; return; }
    const attack = this.lastAttack as Attack;
    if (!BOSS_ATTACKS[attack]) return;

    // t : remplissage (anticipation) ; late : virage vers l'éclat juste avant le coup.
    let t = 1;
    let late = 0;
    let fade = 1;
    let step = 0;
    if (windup) {
      t = pose.progress;
      late = T.MathUtils.smoothstep(t, 0.72, 1);
      this.release = 1;
    } else {
      const strikes = BOSS_STRIKES[attack];
      if (strikes) {
        // Plusieurs frappes : chaque coup a sa zone, visible jusqu'au passage de la lame.
        step = pose.comboStep ?? comboStepAt(pose.progress, strikes);
        const local = (pose.progress * strikes) % 1;
        if (local > 0.58) return;
        late = local > 0.12 ? 1 : 0;
        fade = 1 - T.MathUtils.smoothstep(local, 0.42, 0.58);
      } else if (pose.progress < (HIT_START[attack] ?? 0)) {
        late = 1;
      } else {
        // Après le déclenchement, la zone reste un instant puis s'efface.
        this.release = Math.max(0, this.release - dt * 6);
        if (this.release <= 0) return;
        late = 1;
        fade = this.release;
      }
    }

    this.zones.length = 0;
    this.collect(pose, attack, step, windup);
    if (!this.zones.length) return;
    const ring = attack === 'surge' || attack === 'tide';
    const used = new Map<SectorId, number>();
    let lanes = 0;
    for (const zone of this.zones) {
      if (zone.kind === 'lane') {
        const lane = this.lanes[lanes++];
        if (!lane) continue;
        this.place(lane, zone.x, zone.y, zone.yaw);
        lane.edge.scale.set(zone.half, 1, zone.length);
        lane.fill.scale.set(zone.half, 1, zone.length * Math.max(0.04, t));
      } else {
        const index = used.get(zone.id) ?? 0;
        used.set(zone.id, index + 1);
        const parts = this.sectors.get(zone.id)![index];
        if (!parts) continue;
        this.place(parts, zone.x, zone.y, zone.yaw);
        parts.edge.scale.set(zone.radius, 1, zone.radius);
        // Anneaux d'eau : la zone se remplit depuis l'extérieur (là où frappe la vague).
        const grow = Math.max(0.04, zone.grow ? t : 1);
        parts.fill.scale.set(zone.radius * grow, 1, zone.radius * grow);
      }
    }
    this.fill.color.copy(this.danger).lerp(this.flash, late * 0.6);
    this.edge.color.copy(this.danger).lerp(this.flash, late);
    this.fill.opacity = (ring ? 0.08 + t * 0.1 : 0.12 + t * 0.16 + late * 0.12) * fade;
    this.edge.opacity = (0.35 + t * 0.4 + late * 0.25) * fade;
  }

  /** Formes de chaque coup, calquées sur GameStateService.checkBossAttack. */
  private collect(pose: ThreatPose, attack: Attack, step: number, windup: boolean) {
    const size = BOSS_CONFIG.size;
    const range = BOSS_ATTACKS[attack].range * size;
    const { x, y, facingX: fx, facingY: fy } = pose;
    const yaw = Math.atan2(fx, fy);
    const sector = (id: SectorId, radius: number, at = { x, y }, heading = yaw, grow = true) =>
      this.zones.push({ kind: 'sector', id, x: at.x, y: at.y, yaw: heading, radius, grow });
    const ahead = (offset: number) => ({ x: x + fx * offset, y: y + fy * offset });
    // Couloir vers la cible verrouillée (charge, sillon) : la trajectoire réelle.
    const run = (half: number, extra: number, fallback: number) => {
      const tx = pose.targetX;
      const ty = pose.targetY;
      const to = tx !== undefined && ty !== undefined ? Math.hypot(tx - x, ty - y) : 0;
      const heading = to > 4 ? Math.atan2(tx! - x, ty! - y) : yaw;
      this.zones.push({ kind: 'lane', x, y, yaw: heading, half, length: Math.min(fallback, to > 4 ? to : fallback) + extra });
    };
    switch (attack) {
      case 'slash':
      case 'combo':
        return sector('cone', Math.min(range, size * 2.2) + 9);
      case 'reap':
        return sector('reap', range + 9);
      case 'feint':
        // Choix de design : la feinte garde sa surprise, il faut lire le corps de Badu.
        return;
      case 'backhand':
        return sector('back', range, undefined, yaw + Math.PI);
      case 'thrust':
        return this.zones.push({ kind: 'lane', x, y, yaw, half: 22, length: range + 9 });
      case 'judgment':
        return sector('disc', range / 2 + 6, ahead(range * 0.55));
      case 'leap': {
        // Point d'impact : là où Badu retombe, pas là où il s'élance.
        const at = pose.targetX !== undefined && pose.targetY !== undefined ? { x: pose.targetX, y: pose.targetY } : { x, y };
        return sector('disc', range / 2, at);
      }
      case 'slam':
      case 'sweep':
        return sector('disc', range / 2);
      case 'surge':
      case 'tide':
        return sector('disc', range, undefined, yaw, false);
      case 'charge':
        return run(size * 0.7, size * 0.35, BOSS_CONFIG.chargeSpeed * BOSS_ATTACKS.charge.attackDuration / 1000);
      case 'furrow':
        // Course, puis uppercut au bout du sillon.
        return run(size * 0.75, size * 1.2, BOSS_CONFIG.chargeSpeed * 1.1 * BOSS_ATTACKS.furrow.attackDuration / 1000);
      case 'mill':
        // Pendant l'anticipation on annonce le premier coup ; ensuite, chaque coup.
        if (!windup && step === 2) return sector('disc', size * 1.4);
        if (!windup && step === 3) return sector('disc', 50, ahead(40));
        return sector('mill', range + 9);
      case 'shot': {
        const length = range;
        for (const angle of pose.shotAngles ?? [0]) {
          this.zones.push({ kind: 'lane', x, y, yaw: yaw + angle, half: SHOT_WIDTH + 8, length });
        }
        return;
      }
      default:
        // Attaque inconnue (nouveau coup) : pas de zone plutôt qu'une zone fausse.
        return;
    }
  }

  private place({ fill, edge }: { fill: T.Mesh; edge: T.Mesh }, x: number, y: number, yaw: number) {
    for (const mesh of [fill, edge]) {
      mesh.visible = true;
      mesh.position.set(x, 0.9, y);
      mesh.rotation.y = yaw;
    }
  }

  private hideAll() {
    for (const list of this.sectors.values()) for (const { fill, edge } of list) fill.visible = edge.visible = false;
    for (const { fill, edge } of this.lanes) fill.visible = edge.visible = false;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((object) => {
      if (object instanceof T.Mesh) object.geometry.dispose();
    });
    this.fill.dispose();
    this.edge.dispose();
  }

  private pair(fillGeometry: T.BufferGeometry, edgeGeometry: T.BufferGeometry) {
    const fill = new T.Mesh(fillGeometry, this.fill);
    const edge = new T.Mesh(edgeGeometry, this.edge);
    fill.renderOrder = edge.renderOrder = 2;
    this.group.add(fill, edge);
    return { fill, edge };
  }
}

// ------------------------------------------------ GÉOMÉTRIES AU SOL (rayon unité)

/** Secteur au sol dans le plan x/z, ouvert vers +z (le regard). */
export function groundSector(half: number) {
  const steps = Math.max(8, Math.round(half * 20));
  const v: number[] = [];
  for (let i = 0; i < steps; i++) {
    const a0 = -half + (i / steps) * half * 2;
    const a1 = -half + ((i + 1) / steps) * half * 2;
    v.push(0, 0, 0, Math.sin(a1), 0, Math.cos(a1), Math.sin(a0), 0, Math.cos(a0));
  }
  return geometry(v);
}

/** Bord épais du secteur (arc extérieur + côtés si ce n'est pas un disque). */
export function groundSectorEdge(half: number) {
  const steps = Math.max(8, Math.round(half * 20));
  const inner = 0.93;
  const v: number[] = [];
  for (let i = 0; i < steps; i++) {
    const a0 = -half + (i / steps) * half * 2;
    const a1 = -half + ((i + 1) / steps) * half * 2;
    const p = (a: number, r: number) => [Math.sin(a) * r, 0, Math.cos(a) * r];
    v.push(...p(a0, inner), ...p(a1, 1), ...p(a0, 1), ...p(a0, inner), ...p(a1, inner), ...p(a1, 1));
  }
  if (half < Math.PI) {
    for (const side of [-half, half]) {
      const x = Math.sin(side);
      const z = Math.cos(side);
      const nx = Math.cos(side) * 0.035;
      const nz = -Math.sin(side) * 0.035;
      v.push(0, 0, 0, x + nx, 0, z + nz, x - nx, 0, z - nz);
    }
  }
  return geometry(v);
}

/** Couloir (charge, estoc, balle) : demi-largeur et longueur unité, vers +z. */
export function groundLane() {
  return geometry([-1, 0, 0, 1, 0, 1, 1, 0, 0, -1, 0, 0, -1, 0, 1, 1, 0, 1]);
}

export function groundLaneEdge() {
  const w = 0.08;
  const v: number[] = [];
  for (const side of [-1, 1]) {
    const a = side;
    const b = side - side * w;
    v.push(a, 0, 0, b, 0, 1, a, 0, 1, a, 0, 0, b, 0, 0, b, 0, 1);
  }
  v.push(-1, 0, 0.97, 1, 0, 1, 1, 0, 0.97, -1, 0, 0.97, -1, 0, 1, 1, 0, 1);
  return geometry(v);
}

function geometry(vertices: number[]) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  // Matériaux DoubleSide : le sens des triangles ne compte pas.
  return g;
}
