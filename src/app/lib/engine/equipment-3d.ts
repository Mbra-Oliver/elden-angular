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
  private readonly arrows: T.Group[] = [];
  private readonly arrowStreaks: T.Mesh[] = [];
  private readonly arrowStreakMaterial = new T.MeshBasicMaterial({
    color: '#bfe9ff', transparent: true, opacity: 0.32, depthWrite: false,
    side: T.DoubleSide, blending: T.AdditiveBlending,
  });
  private readonly bowStrings: T.Mesh[] = [];
  private readonly nockedArrow = new T.Group();
  private readonly bowTipY: number;
  private readonly bowTipZ: number;
  private arrowCount = 0;
  private ammo = 0;
  private weapon: WeaponId = 'spear';
  /** Afena (épée courte à lame en feuille) et batakari (tunique à talismans). */
  private readonly afena = new T.Group();
  private readonly afenaBlade: T.MeshStandardMaterial;
  private readonly afenaGlow: T.MeshBasicMaterial;
  private readonly afenaTrail: WeaponTrail;
  private batakari = new T.Group();
  private look: GearLook = { batakari: false, tier: 0, ready: false };

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
    this.bowTipY = radius * (1 - Math.sin(Math.PI * 0.09));
    this.bowTipZ = radius * Math.cos(Math.PI * 0.09);
    const limb = new T.Mesh(new T.TorusGeometry(radius, 0.5, 5, 18, Math.PI * 0.82), wood);
    limb.rotation.set(0, Math.PI / 2, -Math.PI * 0.91);
    limb.position.y = radius;
    const stringGeometry = new T.CylinderGeometry(0.12, 0.12, 1, 3);
    for (const side of [1, -1]) {
      const segment = new T.Mesh(stringGeometry, fibre);
      segment.scale.y = this.bowTipZ;
      segment.position.set(0, this.bowTipY, side * this.bowTipZ / 2);
      segment.rotation.x = side * Math.PI / 2;
      this.bow.add(segment);
      this.bowStrings.push(segment);
    }
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

    // Afena : poignée, garde ronde et lame en feuille, alignée comme la lance.
    this.afenaBlade = new T.MeshStandardMaterial({ color: TIERS[0].color, metalness: 0.35, roughness: 0.6, flatShading: true });
    this.afenaGlow = new T.MeshBasicMaterial({
      color: '#ff9a3c', transparent: true, opacity: 0, depthWrite: false,
      side: T.DoubleSide, blending: T.AdditiveBlending,
    });
    const brass = new T.MeshStandardMaterial({ color: '#a07a35', metalness: 0.7, roughness: 0.45, flatShading: true });
    const outline = new T.Shape();
    outline.moveTo(-0.28, 0);
    outline.quadraticCurveTo(-1.25, 3.1, -0.45, 8.2);
    outline.quadraticCurveTo(-0.12, 9.9, 1.15, 8.7);
    outline.quadraticCurveTo(1.35, 4.1, 0.28, 0);
    outline.closePath();
    const bladeGeometry = new T.ExtrudeGeometry(outline, {
      depth: 0.34, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 1,
    });
    const blade = new T.Mesh(bladeGeometry, this.afenaBlade);
    blade.position.set(0, 2.1, -0.17);
    const ridge = new T.Mesh(new T.CylinderGeometry(0.08, 0.1, 7.4, 4), this.afenaBlade);
    ridge.position.set(0.32, 6.2, 0.28);
    ridge.rotation.z = -0.06;
    const glow = new T.Mesh(new T.PlaneGeometry(2.9, 9.2), this.afenaGlow);
    glow.position.set(0.3, 6.6, -0.55);
    const hilt = new T.Mesh(new T.CylinderGeometry(0.42, 0.5, 3.2, 6), leather);
    hilt.position.y = -1.5;
    const neck = new T.Mesh(new T.CylinderGeometry(0.36, 0.42, 2.2, 6), brass);
    neck.position.y = 1.1;
    const guard = new T.Mesh(new T.BoxGeometry(3, 0.36, 0.78), brass);
    guard.position.y = 1.85;
    const guardEnd = new T.IcosahedronGeometry(0.42, 0);
    for (const side of [-1, 1]) {
      const knob = new T.Mesh(guardEnd, brass);
      knob.position.set(side * 1.5, 1.85, 0);
      this.afena.add(knob);
    }
    const pommel = new T.Mesh(new T.IcosahedronGeometry(0.55, 0), brass);
    pommel.position.y = -3.2;
    this.afena.add(hilt, neck, guard, pommel, blade, ridge, glow);
    this.afena.position.set(0, -8.6, 1);
    this.afena.rotation.x = Math.PI / 2 - 0.18;
    this.afena.visible = false;
    arms[1].add(this.afena);
    this.afenaTrail = new WeaponTrail(scene, 8, new T.Vector3(0.3, 12, 0.2), new T.Vector3(0.1, 5, 0));

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
      const charm = new T.Mesh(pouch, i % 3 ? leather : red);
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
    const shaftGeometry = new T.CylinderGeometry(0.22, 0.22, 15, 4);
    const tipGeometry = new T.ConeGeometry(0.6, 2.2, 4);
    const tip = new T.MeshStandardMaterial({ color: '#8f8d86', metalness: 0.5, roughness: 0.4 });
    const streakGeometry = new T.PlaneGeometry(1.1, 13);
    for (let i = 0; i < ARROW_POOL; i++) {
      const arrow = new T.Group();
      const shaft = new T.Mesh(shaftGeometry, wood);
      shaft.rotation.x = Math.PI / 2;
      const head = new T.Mesh(tipGeometry, tip);
      head.rotation.x = Math.PI / 2;
      head.position.z = 8.2;
      const streak = new T.Mesh(streakGeometry, this.arrowStreakMaterial);
      streak.rotation.x = Math.PI / 2;
      streak.position.z = -6.5;
      streak.visible = false;
      arrow.add(shaft, head, streak);
      arrow.visible = false;
      scene.add(arrow);
      this.arrows.push(arrow);
      this.arrowStreaks.push(streak);
    }
    const nockShaft = new T.Mesh(shaftGeometry, wood);
    nockShaft.position.y = -6.5;
    const nockHead = new T.Mesh(tipGeometry, tip);
    nockHead.rotation.x = Math.PI;
    nockHead.position.y = -15.2;
    this.nockedArrow.add(nockShaft, nockHead);
    for (const side of [-1, 1]) {
      const feather = new T.Mesh(new T.ConeGeometry(0.45, 2.2, 3), fibre);
      feather.position.set(side * 0.48, 0.4, 0);
      feather.rotation.z = side * 0.35;
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
    this.afenaGlow.opacity = look.ready ? 0.28 : 0;
  }

  setWeapon(weapon: WeaponId) {
    this.weapon = weapon;
  }

  setAmmo(ammo: number) {
    this.ammo = ammo;
  }

  get warmables(): T.Object3D[] {
    return [this.afena, this.bow, this.nockedArrow, ...this.arrowStreaks];
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
    this.afenaGlow.opacity = this.look.ready ? 0.24 + pulse * 0.1 : 0;
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
    const nockY = this.bowTipY + draw * 4.6;
    for (let i = 0; i < this.bowStrings.length; i++) {
      const side = i === 0 ? 1 : -1;
      const segment = this.bowStrings[i];
      const dz = side * this.bowTipZ;
      const dy = this.bowTipY - nockY;
      segment.scale.y = Math.hypot(dy, dz);
      segment.rotation.x = Math.atan2(dz, dy);
      segment.position.set(0, (nockY + this.bowTipY) / 2, dz / 2);
    }
    this.nockedArrow.position.y = nockY;
  }
}
