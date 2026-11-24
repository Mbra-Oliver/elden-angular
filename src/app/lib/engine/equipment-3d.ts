import * as T from 'three';
import type { WeaponId } from '../constants/equipment.config-constant';

interface ArrowView {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  grounded: boolean;
}

interface Pose { state: string; phase: number }

const ARROW_POOL = 24;
const FLIGHT_HEIGHT = 19;

/**
 * Équipement visible du joueur en 3D : lance (le bâton déjà tenu en main
 * droite), arc en main gauche, gourde de Bandji, et flèches en vol / au sol.
 * Séparé de World3D pour rester indépendant du reste de la scène.
 */
export class Equipment3D {
  private readonly bow = new T.Group();
  private readonly gourd = new T.Group();
  private readonly quiver = new T.Group();
  private readonly arrows: T.Group[] = [];
  private weapon: WeaponId = 'spear';

  constructor(
    scene: T.Scene,
    private readonly torso: T.Group,
    private readonly arms: T.Group[],
    private readonly spear: T.Object3D | undefined,
  ) {
    const wood = new T.MeshStandardMaterial({ color: '#6a4426', roughness: 0.8 });
    const fibre = new T.MeshBasicMaterial({ color: '#e8dcc0' });

    // Arc : un arc de tore tenu dans la main gauche. Repère du bras : -y va de
    // l'épaule vers la main, donc bras tendu, +z est le haut du monde.
    // La poignée est à l'origine, le ventre de l'arc vers l'avant (-y) et la
    // corde côté archer (+y).
    const radius = 8;
    const limb = new T.Mesh(new T.TorusGeometry(radius, 0.5, 5, 18, Math.PI * 0.82), wood);
    limb.rotation.set(0, Math.PI / 2, -Math.PI * 0.91);
    limb.position.y = radius;
    const string = new T.Mesh(
      new T.CylinderGeometry(0.12, 0.12, 2 * radius * Math.cos(Math.PI * 0.09), 3), fibre);
    string.rotation.x = Math.PI / 2;
    string.position.y = radius * (1 - Math.sin(Math.PI * 0.09));
    this.bow.add(limb, string);
    this.bow.position.set(0, -8.6, 0.6);
    this.bow.visible = false;
    arms[0].add(this.bow);

    // Carquois dans le dos, visible quand l'arc est en main.
    const leather = new T.MeshStandardMaterial({ color: '#4c2f1d', roughness: 0.9 });
    const tube = new T.Mesh(new T.CylinderGeometry(1.5, 1.2, 11, 7), leather);
    this.quiver.add(tube);
    for (let i = 0; i < 3; i++) {
      const feather = new T.Mesh(new T.ConeGeometry(0.7, 2.4, 4), fibre);
      feather.position.set((i - 1) * 0.8, 6.4, 0);
      this.quiver.add(feather);
    }
    this.quiver.position.set(2.5, 7.5, -3.4);
    this.quiver.rotation.z = -0.45;
    this.quiver.visible = false;
    torso.add(this.quiver);

    // Gourde de Bandji (calebasse) : apparaît pendant qu'Ama boit.
    const calabash = new T.MeshStandardMaterial({ color: '#b98b4a', roughness: 0.7 });
    const belly = new T.Mesh(new T.SphereGeometry(2.4, 8, 6), calabash);
    const neck = new T.Mesh(new T.CylinderGeometry(0.7, 1.1, 2.6, 6), calabash);
    neck.position.y = 2.8;
    this.gourd.add(belly, neck);
    this.gourd.position.set(0, -9.6, 1.2);
    this.gourd.visible = false;
    arms[0].add(this.gourd);

    // Réserve de flèches partagée (même géométrie et matériau).
    const shaftGeometry = new T.CylinderGeometry(0.22, 0.22, 15, 4);
    const tipGeometry = new T.ConeGeometry(0.6, 2.2, 4);
    const tip = new T.MeshStandardMaterial({ color: '#8f8d86', metalness: 0.5, roughness: 0.4 });
    for (let i = 0; i < ARROW_POOL; i++) {
      const arrow = new T.Group();
      const shaft = new T.Mesh(shaftGeometry, wood);
      shaft.rotation.x = Math.PI / 2;
      const head = new T.Mesh(tipGeometry, tip);
      head.rotation.x = Math.PI / 2;
      head.position.z = 8.2;
      arrow.add(shaft, head);
      arrow.visible = false;
      scene.add(arrow);
      this.arrows.push(arrow);
    }
  }

  setWeapon(weapon: WeaponId) {
    this.weapon = weapon;
  }

  setArrows(arrows: readonly ArrowView[]) {
    this.arrows.forEach((mesh, i) => {
      const arrow = arrows[i];
      mesh.visible = !!arrow;
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
    this.gourd.visible = drinking;
    if (this.spear) this.spear.visible = !bow && !drinking;

    const [left, right] = this.arms;
    if (pose.state === 'aiming' || pose.state === 'release') {
      // Bras gauche tendu vers l'avant, main droite tire la corde vers l'épaule.
      const draw = pose.state === 'aiming' ? Math.min(1, pose.phase * 1.4) : 1 - pose.phase;
      left.rotation.set(-1.5 * Math.max(draw, 0.35), 0, -0.1);
      right.rotation.set(-1.3 * Math.max(draw, 0.2), 0, 0.55 * draw);
      this.torso.rotation.set(0, -0.32 * draw, 0);
    } else if (drinking) {
      // Lève la calebasse aux lèvres puis la redescend.
      const lift = Math.sin(Math.min(1, pose.phase) * Math.PI);
      left.rotation.set(-2.35 * lift, 0, 0.55 * lift);
      right.rotation.set(0, 0, -0.14);
      this.torso.rotation.set(-0.18 * lift, 0, 0);
    }
  }
}
