import * as T from 'three';
import { BOSS_CONFIG } from '../constants/boss.config-constant';
import { PALETTE } from '../constants/landscape';
import { BOSS_ATTACKS, SHOT_WIDTH, type BossAttackType } from '../interfaces/BossAttackData';

/**
 * Lisibilité des coups en low poly :
 * - contours sombres (coque inversée) autour des combattants, pour que leur
 *   silhouette se détache du sol et de la brume ;
 * - zone de danger au sol pendant l'anticipation du boss : elle se remplit
 *   au rythme de la préparation et flashe juste avant l'impact (l'éclat sur
 *   l'arme est déjà fait par boss-fx-3d.ts). Les formes reprennent les hitbox de
 *   GameStateService.checkBossAttack (cône, disque, couloir de charge, anneau).
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
}

type Shape = 'cone' | 'disc' | 'lane' | 'ring';

const SHAPES: Record<Exclude<BossAttackType, 'none'>, Shape> = {
  slash: 'cone', combo: 'cone', slam: 'disc', sweep: 'disc', charge: 'lane', surge: 'ring', tide: 'ring', shot: 'lane',
};

/** Couche 3D (World3D.addLayer) : zone de danger pendant l'anticipation. */
export class AttackTelegraph3D {
  private readonly group = new T.Group();
  private readonly fill: T.MeshBasicMaterial;
  private readonly edge: T.MeshBasicMaterial;
  private readonly shapes = new Map<Shape, { fill: T.Mesh; edge: T.Mesh }>();
  private readonly danger = new T.Color(PALETTE.danger);
  private readonly flash = new T.Color(PALETTE.dangerFlash);
  private release = 0;
  private lastAttack: BossAttackType = 'none';

  constructor(private readonly scene: T.Scene, private readonly read: () => ThreatPose | null) {
    this.fill = new T.MeshBasicMaterial({ color: PALETTE.danger, transparent: true, depthWrite: false, opacity: 0.2, side: T.DoubleSide });
    this.edge = new T.MeshBasicMaterial({ color: PALETTE.danger, transparent: true, depthWrite: false, opacity: 0.7, side: T.DoubleSide });
    const size = BOSS_CONFIG.size;
    const coneRadius = (attack: 'slash' | 'combo') => Math.min(BOSS_ATTACKS[attack].range * size, size * 2.2) + 9;
    const half = Math.acos(0.22);
    // Rayon unité : chaque attaque met l'échelle à sa portée.
    this.shapes.set('cone', this.pair(this.sector(1, half), this.sectorEdge(1, half)));
    this.shapes.set('disc', this.pair(this.sector(1, Math.PI), this.sectorEdge(1, Math.PI)));
    this.shapes.set('ring', this.pair(this.sector(1, Math.PI), this.sectorEdge(1, Math.PI)));
    this.shapes.set('lane', this.pair(this.lane(), this.laneEdge()));
    this.coneRadius = { slash: coneRadius('slash'), combo: coneRadius('combo') };
    scene.add(this.group);
  }

  private readonly coneRadius: Record<'slash' | 'combo', number>;

  /** Zones cachées hors anticipation : précompilées par World3D.warmUp. */
  get warmables(): T.Object3D[] {
    return [...this.shapes.values()].flatMap(({ fill, edge }) => [fill, edge]);
  }

  update(dt: number) {
    const pose = this.read();
    const windup = pose?.state === 'windup' && pose.attack !== 'none';
    const active = pose?.state === 'attacking' && pose.attack !== 'none';
    if (pose && (windup || active)) this.lastAttack = pose.attack;
    // Après le déclenchement, la zone reste un instant puis s'efface.
    this.release = active ? Math.max(0, this.release - dt * 6) : windup ? 1 : 0;
    this.shapes.forEach(({ fill, edge }) => { fill.visible = edge.visible = false; });
    if (!pose || (!windup && !(active && this.release > 0)) || this.lastAttack === 'none') return;

    const attack = this.lastAttack as Exclude<BossAttackType, 'none'>;
    const shape = SHAPES[attack];
    // Attaque sans forme connue (nouveau coup) : pas de zone plutôt qu'une zone fausse.
    if (!shape || !BOSS_ATTACKS[attack]) return;
    const parts = this.shapes.get(shape)!;
    const t = windup ? pose.progress : 1;
    const late = windup ? T.MathUtils.smoothstep(t, 0.72, 1) : 0;
    const size = BOSS_CONFIG.size;
    const radius = shape === 'cone' ? this.coneRadius[attack as 'slash' | 'combo']
      : attack === 'slam' ? BOSS_ATTACKS.slam.range * size / 2
      : attack === 'sweep' ? BOSS_ATTACKS.sweep.range * size / 2
      : BOSS_ATTACKS[attack].range * size;
    const yaw = Math.atan2(pose.facingX, pose.facingY);
    for (const mesh of [parts.fill, parts.edge]) {
      mesh.visible = true;
      mesh.position.set(pose.x, 0.9, pose.y);
      mesh.rotation.y = yaw;
    }
    if (shape === 'lane') {
      // Charge : la course ; tir : la ligne de la balle (mince, très longue).
      const shot = attack === 'shot';
      const length = shot ? BOSS_ATTACKS.shot.range * size
        : BOSS_CONFIG.chargeSpeed * BOSS_ATTACKS.charge.attackDuration / 1000;
      const width = shot ? SHOT_WIDTH * 2 : size * 0.7;
      parts.edge.scale.set(width, 1, length);
      parts.fill.scale.set(width, 1, length * Math.max(0.04, t));
    } else {
      parts.edge.scale.set(radius, 1, radius);
      // Anneaux d'eau : la zone se remplit depuis l'extérieur (là où frappe la vague).
      const grow = Math.max(0.04, shape === 'ring' ? 1 : t);
      parts.fill.scale.set(radius * grow, 1, radius * grow);
    }
    const fade = windup ? 1 : this.release;
    this.fill.color.copy(this.danger).lerp(this.flash, late * 0.6);
    this.edge.color.copy(this.danger).lerp(this.flash, late);
    this.fill.opacity = (shape === 'ring' ? 0.08 + t * 0.1 : 0.12 + t * 0.16 + late * 0.12) * fade;
    this.edge.opacity = (0.35 + t * 0.4 + late * 0.25) * fade;

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

  /** Secteur au sol dans le plan x/z, ouvert vers +z (le regard). */
  private sector(radius: number, half: number) {
    const steps = Math.max(8, Math.round(half * 20));
    const v: number[] = [];
    for (let i = 0; i < steps; i++) {
      const a0 = -half + (i / steps) * half * 2;
      const a1 = -half + ((i + 1) / steps) * half * 2;
      v.push(0, 0, 0, Math.sin(a1) * radius, 0, Math.cos(a1) * radius, Math.sin(a0) * radius, 0, Math.cos(a0) * radius);
    }
    return this.geometry(v);
  }

  /** Bord épais du secteur (arc extérieur + côtés si ce n'est pas un disque). */
  private sectorEdge(radius: number, half: number) {
    const steps = Math.max(8, Math.round(half * 20));
    const inner = 0.93;
    const v: number[] = [];
    for (let i = 0; i < steps; i++) {
      const a0 = -half + (i / steps) * half * 2;
      const a1 = -half + ((i + 1) / steps) * half * 2;
      const p = (a: number, r: number) => [Math.sin(a) * r, 0, Math.cos(a) * r];
      v.push(...p(a0, inner), ...p(a1, radius), ...p(a0, radius), ...p(a0, inner), ...p(a1, inner), ...p(a1, radius));
    }
    if (half < Math.PI) {
      for (const side of [-half, half]) {
        const x = Math.sin(side);
        const z = Math.cos(side);
        const nx = Math.cos(side) * 0.035;
        const nz = -Math.sin(side) * 0.035;
        v.push(0, 0, 0, x * radius + nx, 0, z * radius + nz, x * radius - nx, 0, z * radius - nz);
      }
    }
    return this.geometry(v);
  }

  /** Couloir de charge, largeur et longueur unité. */
  private lane() {
    return this.geometry([-1, 0, 0, 1, 0, 1, 1, 0, 0, -1, 0, 0, -1, 0, 1, 1, 0, 1]);
  }

  private laneEdge() {
    const w = 0.08;
    const v: number[] = [];
    for (const side of [-1, 1]) {
      const a = side;
      const b = side - side * w;
      v.push(a, 0, 0, b, 0, 1, a, 0, 1, a, 0, 0, b, 0, 0, b, 0, 1);
    }
    v.push(-1, 0, 0.97, 1, 0, 1, 1, 0, 0.97, -1, 0, 0.97, -1, 0, 1, 1, 0, 1);
    return this.geometry(v);
  }

  private geometry(vertices: number[]) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    // Les deux faces : le sens des triangles ne compte plus.
    return geometry;
  }

}
