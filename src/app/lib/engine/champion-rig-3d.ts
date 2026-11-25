import * as T from 'three';
import { BOSS_ATTACKS, shotAngles } from '../interfaces/BossAttackData';
import { BOSS_CONFIG } from '../constants/boss.config-constant';
import type { FighterRig } from './boss-rig-3d';
import type { Actor3D } from './world-3d';

/**
 * Badu Ofosu, porte-hache du roi du Denkyira (chapitre 1, 1701).
 *
 * Il réutilise le rig humain du duelliste (mêmes animations de combat) :
 * cette classe ne fait que l'habiller (ceinture de poudre, bandeau rouge),
 * lui mettre en main l'arme de l'attaque en cours (grande hache, mousquet,
 * sabre) et jouer la « sorcellerie » du mousquet : la poudre mêlée à la
 * cendre d'un suman fait une fumée noire qui rampe, et la balle laisse une
 * traînée de braises. Pas de runes ni de lumière magique : fumée, braise.
 * [SUPPOSITION] Formes et couleurs à valider en jeu.
 */

type Weapon = 'axe' | 'musket' | 'sabre';

const SMOKE = 26;
const TRAILS = 3;

export class ChampionGear {
  private readonly hand = new T.Group();
  private readonly weapons: Record<Weapon, T.Group>;
  private readonly outfit = new T.Group();
  private readonly fx = new T.Group();
  private readonly smoke: { sprite: T.Sprite; life: number; vx: number; vy: number; vz: number }[] = [];
  private readonly trails: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>[] = [];
  private readonly flash: T.Sprite;
  private readonly muzzle = new T.Vector3();
  private readonly materials: T.Material[] = [];
  private trailLife = 0;
  private lastShot = false;
  private puffClock = 0;
  private next = 0;

  constructor(private readonly scene: T.Scene, private readonly rig: FighterRig, private readonly staff: T.Object3D | undefined) {
    const flat = (color: string, extra: Partial<T.MeshStandardMaterialParameters> = {}) =>
      this.mat(new T.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...extra }));
    const wood = flat('#5a3a22');
    const iron = flat('#4b4a46', { roughness: 0.6, metalness: 0.3 });
    const brass = flat('#9c7a3a', { roughness: 0.6 });
    const leather = flat('#3a2518');
    const add = (parent: T.Object3D, geometry: T.BufferGeometry, material: T.Material,
      x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const mesh = new T.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      parent.add(mesh);
      return mesh;
    };

    // Les armes partent de la main droite et pointent vers l'avant (axe +y local).
    this.hand.position.set(0, -8.5, 0.5);
    this.hand.rotation.x = Math.PI / 2 - 0.18;
    rig.arms[1].add(this.hand);

    // Grande hache de guerre : long manche, fer large en croissant, pointe arrière.
    const axe = new T.Group();
    add(axe, new T.CylinderGeometry(0.7, 0.85, 44, 6), wood, 0, 14, 0);
    const blade = new T.Shape();
    blade.moveTo(0, -5);
    blade.quadraticCurveTo(9, -8, 11, 0);
    blade.quadraticCurveTo(9, 8, 0, 5);
    blade.lineTo(0, -5);
    add(axe, new T.ExtrudeGeometry(blade, { depth: 0.8, bevelEnabled: false }), iron, 0.6, 32, -0.4, 0, 0, Math.PI / 2);
    add(axe, new T.ConeGeometry(1.2, 5, 4), iron, 0, 32, 0, 0, 0, Math.PI / 2);
    add(axe, new T.CylinderGeometry(1.1, 1.1, 2.2, 6), brass, 0, 29, 0);

    // Mousquet de traite : long canon, crosse sombre, cordelette de charmes.
    const musket = new T.Group();
    add(musket, new T.CylinderGeometry(0.55, 0.6, 30, 6), iron, 0, 15, 1.2);
    add(musket, new T.BoxGeometry(1.8, 16, 2.4), wood, 0, 3, 0.4);
    add(musket, new T.BoxGeometry(2.2, 6, 3.4), wood, 0, -6, 0, 0.25, 0, 0);
    add(musket, new T.BoxGeometry(1.2, 2.2, 1.6), brass, 0, 6, 2.4);
    for (let i = 0; i < 3; i++) add(musket, new T.BoxGeometry(1, 1.3, 0.6), i === 1 ? flat('#7a2e22') : leather, 1.4, 10 + i * 2.6, 0.4);

    // Sabre : poignée de bois, lame légèrement courbe.
    const sabre = new T.Group();
    add(sabre, new T.CylinderGeometry(0.6, 0.6, 5, 6), wood, 0, 0.5, 0);
    add(sabre, new T.BoxGeometry(3.4, 0.7, 1.2), brass, 0, 3.2, 0);
    for (let i = 0; i < 4; i++) {
      add(sabre, new T.BoxGeometry(0.35, 6, 2.2 - i * 0.35), iron, 0, 6.5 + i * 5.6, i * i * 0.35, -i * 0.09, 0, 0);
    }
    this.weapons = { axe, musket, sabre };
    for (const group of Object.values(this.weapons)) this.hand.add(group);

    // Tenue : bandeau rouge, ceinture de poudre en bandoulière avec ses gourdes.
    add(this.outfit, new T.TorusGeometry(3.4, 0.7, 5, 10), flat('#8e2a20'), 0, 12.6, 0.4, Math.PI / 2, 0, 0);
    add(this.outfit, new T.TorusGeometry(6.3, 0.55, 4, 14), leather, 0, 3, 0, Math.PI / 2, 0.55, 0);
    for (let i = 0; i < 5; i++) {
      const a = -1 + i * 0.5;
      add(this.outfit, new T.SphereGeometry(0.9, 5, 4), flat('#6b4a2a'), Math.sin(a) * 6.4, 3 + Math.cos(a) * 3.4, Math.cos(a) * 6.4);
    }
    rig.torso.add(this.outfit);

    // Sorcellerie du mousquet : fumée noire, éclair de bouche, traînées de braise.
    const puff = this.softTexture();
    for (let i = 0; i < SMOKE; i++) {
      const sprite = new T.Sprite(this.mat(new T.SpriteMaterial({
        map: puff, color: i % 3 ? '#1b1512' : '#3a1a10', transparent: true, depthWrite: false, opacity: 0,
      })));
      sprite.visible = false;
      this.fx.add(sprite);
      this.smoke.push({ sprite, life: 0, vx: 0, vy: 0, vz: 0 });
    }
    this.flash = new T.Sprite(this.mat(new T.SpriteMaterial({
      map: puff, color: '#ff7a2e', transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0,
    })));
    this.flash.userData['bloom'] = true;
    this.fx.add(this.flash);
    for (let i = 0; i < TRAILS; i++) {
      const trail = new T.Mesh(new T.PlaneGeometry(1, 1),
        this.mat(new T.MeshBasicMaterial({
          color: '#ff5a1e', transparent: true, depthWrite: false, opacity: 0, side: T.DoubleSide, blending: T.AdditiveBlending,
        })));
      trail.rotation.x = -Math.PI / 2;
      trail.userData['bloom'] = true;
      trail.visible = false;
      this.fx.add(trail);
      this.trails.push(trail);
    }
    scene.add(this.fx);
    this.setActive(false);
  }

  /** Objets à rendre visibles le temps de compiler leurs shaders. */
  get warmables(): T.Object3D[] {
    return [this.hand, this.outfit, this.fx];
  }

  /** true : le rig du duelliste est le porte-hache (sinon Kofi garde son bâton). */
  setActive(on: boolean) {
    this.hand.visible = on;
    this.outfit.visible = on;
    this.fx.visible = on;
    if (this.staff) this.staff.visible = !on;
  }

  update(pose: Actor3D | null, now: number, dt: number) {
    this.setActive(!!pose);
    if (!pose) {
      this.lastShot = false;
      return;
    }
    const weapon = this.weaponFor(pose);
    for (const [name, group] of Object.entries(this.weapons)) group.visible = name === weapon;
    // Le mousquet reste à l'horizontale quel que soit le bras (épaulé, au repos).
    this.weapons.musket.rotation.x = -(this.rig.arms[1].rotation.x + 0.55 + this.rig.torso.rotation.x);

    this.rig.root.updateMatrixWorld(true);
    this.muzzle.set(0, 30, 1.2);
    this.weapons.musket.localToWorld(this.muzzle);
    const aiming = pose.attack === 'shot' && pose.state === 'windup';
    const firing = pose.attack === 'shot' && pose.state === 'attacking';

    // Pendant la visée, la fumée sort du canon et rampe vers le sol.
    this.puffClock -= dt;
    if (aiming && this.puffClock <= 0) {
      this.puffClock = 0.06;
      this.emit(this.muzzle.x, this.muzzle.y, this.muzzle.z, (Math.random() - 0.5) * 6, -4, (Math.random() - 0.5) * 6, 1.4);
    }
    // Départ du coup : éclair, nuage noir et traînées de braise le long des balles.
    if (firing && !this.lastShot) {
      this.flash.position.copy(this.muzzle);
      this.flash.material.opacity = 1;
      this.flash.scale.setScalar(26);
      for (let i = 0; i < 10; i++) {
        this.emit(this.muzzle.x, this.muzzle.y, this.muzzle.z,
          pose.facingX * 30 + (Math.random() - 0.5) * 18, 4 + Math.random() * 6, pose.facingY * 30 + (Math.random() - 0.5) * 18, 2.2);
      }
      const angles = shotAngles(pose.bossPhase ?? 1);
      const length = BOSS_ATTACKS.shot.range * BOSS_CONFIG.size;
      this.trails.forEach((trail, i) => {
        const angle = angles[i];
        trail.visible = angle !== undefined;
        if (angle === undefined) return;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const fx = pose.facingX * c - pose.facingY * s;
        const fy = pose.facingX * s + pose.facingY * c;
        trail.position.set(pose.x + fx * length / 2, 1.2 + i * 0.05, pose.y + fy * length / 2);
        trail.rotation.set(-Math.PI / 2, 0, Math.atan2(-fy, fx));
        trail.scale.set(length, 3.2, 1);
        trail.material.opacity = 0.9;
      });
      this.trailLife = 1;
    }
    this.lastShot = firing;

    this.flash.material.opacity = Math.max(0, this.flash.material.opacity - dt * 7);
    this.trailLife = Math.max(0, this.trailLife - dt * 0.6);
    for (const trail of this.trails) {
      if (!trail.visible) continue;
      // La braise s'éteint en rougissant, puis disparaît.
      trail.material.opacity = 0.9 * this.trailLife * (0.75 + 0.25 * Math.sin(now * 0.03));
      trail.material.color.setRGB(1, 0.25 + 0.2 * this.trailLife, 0.08);
      if (this.trailLife <= 0) trail.visible = false;
    }
    for (const puff of this.smoke) {
      if (puff.life <= 0) continue;
      puff.life -= dt;
      const p = puff.sprite.position;
      p.x += puff.vx * dt;
      p.y = Math.max(2, p.y + puff.vy * dt);
      p.z += puff.vz * dt;
      puff.vx *= 1 - dt * 1.5;
      puff.vz *= 1 - dt * 1.5;
      const age = Math.max(0, puff.life);
      puff.sprite.scale.setScalar(6 + (1 - Math.min(1, age)) * 16);
      puff.sprite.material.opacity = Math.min(0.75, age * 0.6);
      puff.sprite.visible = puff.life > 0;
    }
  }

  dispose() {
    this.scene.remove(this.fx);
    this.materials.forEach((material) => material.dispose());
  }

  /** Hache en phase 1, mousquet pour tirer, sabre en phase 3. */
  private weaponFor(pose: Actor3D): Weapon {
    if (pose.attack === 'shot' && (pose.state === 'windup' || pose.state === 'attacking' || pose.state === 'recover')) return 'musket';
    if (pose.attack === 'slash' || pose.attack === 'combo') return 'sabre';
    if (pose.attack === 'slam' || pose.attack === 'sweep' || pose.attack === 'charge') return 'axe';
    const phase = pose.bossPhase ?? 1;
    return phase === 3 ? 'sabre' : phase === 2 ? 'musket' : 'axe';
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) {
    const puff = this.smoke[this.next];
    this.next = (this.next + 1) % this.smoke.length;
    puff.life = life;
    puff.vx = vx;
    puff.vy = vy;
    puff.vz = vz;
    puff.sprite.position.set(x, y, z);
    puff.sprite.visible = true;
  }

  private softTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, '#ffffffff');
    g.addColorStop(1, '#ffffff00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new T.CanvasTexture(canvas);
    return texture;
  }

  private mat<M extends T.Material>(material: M) {
    this.materials.push(material);
    return material;
  }
}
