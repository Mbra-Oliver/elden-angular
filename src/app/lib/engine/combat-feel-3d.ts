import * as T from 'three';
import { FOV, TRACES } from '../constants/immersion.config-constant';
import type { Actor3D } from './world-3d';

/**
 * Sensations de combat côté vue 3D, hors effets d'impact :
 *
 * - FOV kick : le champ s'élargit pendant un sprint ou l'armement d'un coup
 *   lourd, puis se resserre d'un coup à l'impact.
 * - Sursaut (flinch) du haut du corps de l'ennemi touché, additif par-dessus
 *   son animation.
 * - Traces persistantes : flèches plantées dans le boss quelques secondes,
 *   braises qui couvent au sol.
 *
 * Tout est pré-alloué (InstancedMesh, Points) : aucune création d'objet ni
 * de shader pendant un combat.
 */
export class CombatFeel3D {
  readonly root = new T.Group();
  // ─── FOV
  private fov: number = FOV.base;
  private heavyWindup = false;
  // ─── Flèches plantées
  private readonly arrows: T.InstancedMesh;
  private readonly stuck: { local: T.Matrix4; life: number; anchor: T.Object3D }[] = [];
  // ─── Braises
  private readonly embers: T.Points<T.BufferGeometry, T.PointsMaterial>;
  private readonly emberLife = new Float32Array(TRACES.emberMax);
  private readonly emberSeed = new Float32Array(TRACES.emberMax);
  private nextEmber = 0;
  private time = 0;
  // ─── Temporaires
  private readonly m = new T.Matrix4();
  private readonly inverse = new T.Matrix4();
  private readonly q = new T.Quaternion();
  private readonly v = new T.Vector3();
  private readonly s = new T.Vector3();
  private readonly forward = new T.Vector3(0, 0, 1);

  constructor() {
    // Flèche : hampe + empennage, la pointe à l'origine, la hampe vers -Z.
    const shaft = new T.CylinderGeometry(0.35, 0.35, 15, 4).rotateX(Math.PI / 2).translate(0, 0, -7.5);
    this.arrows = new T.InstancedMesh(shaft, new T.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.9 }),
      TRACES.stuckArrowMax);
    this.arrows.count = 0;
    this.arrows.frustumCulled = false;
    this.arrows.userData['bloom'] = false;

    const positions = new Float32Array(TRACES.emberMax * 3);
    const colors = new Float32Array(TRACES.emberMax * 3);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
    this.embers = new T.Points(geometry, new T.PointsMaterial({
      size: 2.6, sizeAttenuation: true, vertexColors: true, map: emberTexture(),
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    }));
    this.embers.frustumCulled = false;
    this.root.add(this.arrows, this.embers);
  }

  /** Objets à rendre visibles le temps de compiler les shaders. */
  get warmables(): T.Object3D[] {
    return [this.arrows, this.embers];
  }

  // ─── FOV kick ────────────────────────────────────────────────────────────

  /** FOV de la caméra de jeu pour cette image (degrés). */
  updateFov(player: Actor3D, dt: number) {
    const heavy = player.attack === 'heavy';
    const winding = heavy && player.state === 'windup';
    const aiming = player.weapon === 'bow' && (player.state === 'aiming' || player.state === 'release');
    if (this.heavyWindup && heavy && player.state === 'attacking') {
      // Impact : retour brutal, un poil sous la normale.
      this.fov = FOV.base + FOV.impactPunch;
    }
    this.heavyWindup = winding;
    let target: number = aiming ? FOV.ads : FOV.base;
    if (!aiming) {
      if (player.sprint && player.state === 'moving') target += FOV.sprint;
      if (winding) target += FOV.heavyCharge * T.MathUtils.smoothstep(player.phase, 0, 1);
    }
    const rate = target > this.fov ? 4.5 : aiming ? 9 : 7;
    this.fov += (target - this.fov) * (1 - Math.exp(-rate * dt));
    return this.fov;
  }

  // ─── Sursaut ─────────────────────────────────────────────────────────────

  /**
   * Sursaut du haut du corps : le buste part dans le sens du coup puis revient.
   * À appeler après l'animation de l'ennemi (s'ajoute à sa pose).
   */
  applyFlinch(root: T.Object3D, torso: T.Object3D, pose: Actor3D, scale = 1) {
    const amount = pose.flinch ?? 0;
    if (amount <= 0.001) return;
    // Montée immédiate, retour amorti : le carré de la valeur décroissante.
    const k = amount * amount * 0.42 * scale;
    const yaw = root.rotation.y;
    const wx = pose.flinchX ?? 0;
    const wz = pose.flinchY ?? 0;
    const lx = Math.cos(yaw) * wx - Math.sin(yaw) * wz;
    const lz = Math.sin(yaw) * wx + Math.cos(yaw) * wz;
    torso.rotation.x += lz * k;
    torso.rotation.z -= lx * k;
    torso.position.y -= k * 2.2;
  }

  // ─── Traces persistantes ─────────────────────────────────────────────────

  /**
   * Plante une flèche dans l'ennemi touché, qui la garde en bougeant.
   * @param x,y point d'impact (plan de jeu), dirX/dirY direction de vol
   */
  stickArrow(anchor: T.Object3D, x: number, y: number, dirX: number, dirY: number) {
    anchor.updateMatrixWorld(true);
    this.v.set(dirX, -0.08 - Math.random() * 0.12, dirY).normalize();
    this.q.setFromUnitVectors(this.forward, this.v);
    // Enfoncée de quelques unités dans le corps, à hauteur de torse.
    const height = 13 + Math.random() * 12;
    this.s.set(x + dirX * 5, height, y + dirY * 5);
    this.m.compose(this.s, this.q, this.v.set(1, 1, 1));
    this.inverse.copy(anchor.matrixWorld).invert();
    const local = new T.Matrix4().multiplyMatrices(this.inverse, this.m);
    if (this.stuck.length >= TRACES.stuckArrowMax) this.stuck.shift();
    this.stuck.push({ local, life: TRACES.stuckArrowLife, anchor });
  }

  /** Braises qui couvent au sol autour d'un point (attaque de feu, poudre). */
  scatterEmbers(x: number, y: number, count: number, radius: number) {
    const positions = this.embers.geometry.attributes['position'] as T.BufferAttribute;
    for (let i = 0; i < count; i++) {
      const index = this.nextEmber;
      this.nextEmber = (this.nextEmber + 1) % TRACES.emberMax;
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * radius;
      positions.setXYZ(index, x + Math.cos(a) * d, 0.8 + Math.random() * 0.6, y + Math.sin(a) * d);
      this.emberLife[index] = TRACES.emberLife * (0.6 + Math.random() * 0.4);
      this.emberSeed[index] = Math.random() * 100;
    }
    positions.needsUpdate = true;
  }

  reset() {
    this.stuck.length = 0;
    this.arrows.count = 0;
    this.emberLife.fill(0);
  }

  update(dt: number) {
    this.time += dt;
    this.updateArrows(dt);
    this.updateEmbers(dt);
  }

  private updateArrows(dt: number) {
    let count = 0;
    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const arrow = this.stuck[i];
      arrow.life -= dt;
      if (arrow.life <= 0 || !visible(arrow.anchor)) this.stuck.splice(i, 1);
    }
    for (const arrow of this.stuck) {
      this.m.multiplyMatrices(arrow.anchor.matrixWorld, arrow.local);
      // Dernières 0,3 s : la flèche se détache (rétrécit dans la plaie).
      const fade = Math.min(1, arrow.life / 0.3);
      if (fade < 1) this.m.multiply(this.inverse.makeScale(fade, fade, fade));
      this.arrows.setMatrixAt(count++, this.m);
    }
    this.arrows.count = count;
    if (count) this.arrows.instanceMatrix.needsUpdate = true;
  }

  private updateEmbers(dt: number) {
    const colors = this.embers.geometry.attributes['color'] as T.BufferAttribute;
    let alive = false;
    for (let i = 0; i < TRACES.emberMax; i++) {
      const life = this.emberLife[i];
      if (life <= 0) {
        if (colors.getX(i) !== 0) colors.setXYZ(i, 0, 0, 0);
        continue;
      }
      alive = true;
      this.emberLife[i] = life - dt;
      const seed = this.emberSeed[i];
      // Couve : pulsation lente et irrégulière, s'éteint en refroidissant (orange → rouge).
      const glow = (0.55 + 0.45 * Math.sin(this.time * (2.3 + seed % 3) + seed)) * Math.min(1, life / 2);
      colors.setXYZ(i, 1.0 * glow, (0.25 + 0.25 * Math.min(1, life / 3)) * glow, 0.05 * glow);
    }
    colors.needsUpdate = true;
    this.embers.visible = alive;
  }

  dispose() {
    this.arrows.geometry.dispose();
    (this.arrows.material as T.Material).dispose();
    this.embers.geometry.dispose();
    this.embers.material.map?.dispose();
    this.embers.material.dispose();
  }
}

function visible(object: T.Object3D) {
  let node: T.Object3D | null = object;
  while (node && node.visible) node = node.parent;
  return !node;
}

function emberTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, '#ffffffff');
  g.addColorStop(0.3, '#ffffff99');
  g.addColorStop(1, '#ffffff00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new T.CanvasTexture(canvas);
}
