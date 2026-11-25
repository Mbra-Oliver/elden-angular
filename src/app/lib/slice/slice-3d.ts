import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PlayerEntity } from '../entities/player/player.entity';
import type { Enemy, EnemiesService } from './enemies.service';
import { ENEMIES, ENEMY_MOVES, SHOT_LOCK_MS } from './slice-content';
import {
  ACACIAS, DOORS, DUNGEON_WALLS, ITEM_PLACEMENTS, LANDMARK, LEVER, MOUNDS, WALL_HEIGHT,
  type EnemyKind, type ItemId,
} from './slice-map';
import type { SliceService } from './slice.service';

/**
 * Vue 3D de la tranche verticale, branchée par World3D.addLayer.
 *
 * Budget : murs, termitières, acacias en InstancedMesh (une poignée de draw
 * calls) ; les ennemis loin du joueur sont masqués (au plus ~6 à l'écran).
 * Les matériaux sont partagés par type ; seuls la peau et l'habit de chaque
 * ennemi sont clonés pour le clignotement d'impact (même programme GPU).
 */

const VIEW_DISTANCE = 560;
/** Portes, levier et objets : masqués au-delà (le brouillard les cache déjà). */
const PROP_DISTANCE = 620;
const tmp = new T.Object3D();

interface EnemyRig {
  enemy: Enemy;
  root: T.Group;
  body: T.Group;
  torso: T.Group;
  arms: T.Group[];
  legs: T.Group[];
  weapon: T.Object3D;
  flash: T.MeshStandardMaterial[];
  bar: T.Sprite;
  barBack: T.Sprite;
  walk: number;
  lastX: number;
  lastY: number;
  yaw: number;
}

function flat(color: string, extra: Partial<T.MeshStandardMaterialParameters> = {}) {
  return new T.MeshStandardMaterial({ color, roughness: 0.92, flatShading: true, ...extra });
}

export class Slice3D {
  private readonly root = new T.Group();
  private readonly rigs: EnemyRig[] = [];
  private readonly doors = new Map<string, T.Group>();
  private readonly items = new Map<ItemId, T.Group>();
  private readonly lever = new T.Group();
  private leverArm!: T.Object3D;
  private readonly aimLine: T.Mesh<T.BoxGeometry, T.MeshBasicMaterial>[] = [];
  private readonly tracers: T.Mesh<T.BoxGeometry, T.MeshBasicMaterial>[] = [];
  private readonly rings: T.Mesh<T.RingGeometry, T.MeshBasicMaterial>[] = [];
  private readonly time = { value: 0 };
  private readonly fires: T.Object3D[] = [];
  private warmFrames = 2;
  private readonly warmed: T.Object3D[] = [];
  private readonly geometries: T.BufferGeometry[] = [];
  private readonly materials: T.Material[] = [];

  constructor(
    private readonly scene: T.Scene,
    private readonly slice: SliceService,
    private readonly enemies: EnemiesService,
    private readonly player: PlayerEntity,
  ) {
    this.buildWalls();
    this.buildDoors();
    this.buildLever();
    this.buildLandmark();
    this.buildPlain();
    this.buildItems();
    this.buildEnemies();
    this.buildTelegraphs();
    scene.add(this.root);
    // Tout est visible et non culé pendant les deux premières images : les
    // shaders compilent pendant l'accroche d'ouverture, pas en plein combat.
    this.root.traverse((object) => {
      if (!object.visible) { object.visible = true; this.warmed.push(object); }
      object.frustumCulled = false;
    });
  }

  /**
   * Fusionne les maillages d'un groupe par matériau : un draw call par
   * matériau au lieu d'un par pièce (portes, levier, fromager).
   */
  private bake(group: T.Group) {
    group.updateMatrixWorld(true);
    const inverse = group.matrixWorld.clone().invert();
    const byMaterial = new Map<T.Material, T.BufferGeometry[]>();
    const local = new T.Matrix4();
    group.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      geometry.applyMatrix4(local.multiplyMatrices(inverse, object.matrixWorld));
      const list = byMaterial.get(object.material) ?? [];
      list.push(geometry);
      byMaterial.set(object.material, list);
    });
    group.clear();
    for (const [material, geometries] of byMaterial) {
      const merged = mergeGeometries(geometries);
      geometries.forEach((geometry) => geometry.dispose());
      if (merged) group.add(new T.Mesh(this.geo(merged), material));
    }
  }

  private geo<G extends T.BufferGeometry>(geometry: G) { this.geometries.push(geometry); return geometry; }
  private mat<M extends T.Material>(material: M) { this.materials.push(material); return material; }

  // ------------------------------------------------------------ DÉCOR

  private buildWalls() {
    const laterite = this.mat(flat('#8c5538'));
    const walls = new T.InstancedMesh(this.geo(new T.BoxGeometry(1, 1, 1)), laterite, DUNGEON_WALLS.length);
    DUNGEON_WALLS.forEach((wall, index) => {
      // Hauteur légèrement irrégulière : murs érodés, pas un donjon de pierre taillée.
      const height = WALL_HEIGHT - (index * 7 % 5);
      tmp.position.set(wall.x + wall.w / 2, height / 2, wall.y + wall.h / 2);
      tmp.scale.set(wall.w, height, wall.h);
      tmp.rotation.set(0, 0, 0);
      tmp.updateMatrix();
      walls.setMatrixAt(index, tmp.matrix);
      walls.setColorAt(index, new T.Color(index % 3 ? '#8c5538' : '#7a4a31'));
    });
    // Sol boueux des chambres asséchées : une dalle sombre au ras du sol.
    const mud = new T.Mesh(this.geo(new T.PlaneGeometry(460, 880)), this.mat(flat('#4a3a2c')));
    mud.rotation.x = -Math.PI / 2;
    mud.position.set(1900 + 230, 0.12, 300 + 440);
    this.root.add(walls, mud);
  }

  private buildDoors() {
    const wood = this.mat(flat('#6b4a2e'));
    const rope = this.mat(flat('#b89a62'));
    for (const door of DOORS) {
      const group = new T.Group();
      const { x, y, w, h } = door.rect;
      const horizontal = w > h;
      const length = horizontal ? w : h;
      const planks = Math.round(length / 9);
      for (let i = 0; i < planks; i++) {
        const plank = new T.Mesh(this.geo(new T.BoxGeometry(horizontal ? 8 : 6, WALL_HEIGHT - 4 + (i % 2) * 3, horizontal ? 6 : 8)), wood);
        const along = -length / 2 + 4.5 + i * (length / planks);
        plank.position.set(horizontal ? along : 0, (WALL_HEIGHT - 4) / 2, horizontal ? 0 : along);
        group.add(plank);
      }
      const bar = new T.Mesh(this.geo(new T.BoxGeometry(horizontal ? length : 3, 3, horizontal ? 3 : length)), rope);
      bar.position.y = 14;
      group.add(bar);
      this.bake(group);
      group.position.set(x + w / 2, 0, y + h / 2);
      this.root.add(group);
      this.doors.set(door.id, group);
    }
  }

  private buildLever() {
    const wood = this.mat(flat('#5d4027'));
    const post = new T.Mesh(this.geo(new T.CylinderGeometry(2.4, 3, 18, 6)), wood);
    post.position.y = 9;
    const arm = new T.Group();
    const handle = new T.Mesh(this.geo(new T.CylinderGeometry(1, 1, 22, 5)), wood);
    handle.position.y = 10;
    arm.add(handle);
    arm.position.y = 17;
    arm.rotation.z = -0.9;
    this.leverArm = arm;
    const wheel = new T.Mesh(this.geo(new T.TorusGeometry(7, 1.2, 5, 10)), this.mat(flat('#3d3a33')));
    wheel.position.set(0, 12, 4);
    this.lever.add(post, wheel);
    this.bake(this.lever);
    this.lever.add(arm);
    this.lever.position.set(LEVER.x, 0, LEVER.y);
    this.root.add(this.lever);
  }

  /**
   * Grand fromager mort sur la digue : contreforts, tronc gris, branches
   * nues et lambeaux d'étoffe rouge. Matériaux sans brouillard : sa
   * silhouette reste lisible de loin, comme un phare.
   */
  private buildLandmark() {
    const bark = this.mat(new T.MeshStandardMaterial({ color: '#6f6a5f', roughness: 1, flatShading: true, fog: false }));
    const cloth = this.mat(new T.MeshBasicMaterial({ color: '#a8322a', fog: false, side: T.DoubleSide }));
    const tree = new T.Group();
    const trunk = new T.Mesh(this.geo(new T.CylinderGeometry(11, 26, 230, 9)), bark);
    trunk.position.y = 115;
    tree.add(trunk);
    for (let i = 0; i < 5; i++) {
      const buttress = new T.Mesh(this.geo(new T.BoxGeometry(6, 46, 34)), bark);
      buttress.position.set(Math.cos(i * 1.26) * 22, 20, Math.sin(i * 1.26) * 22);
      buttress.rotation.y = -i * 1.26;
      tree.add(buttress);
    }
    const branches: [number, number, number, number][] = [
      [0.4, 190, 80, 0.8], [2.1, 205, 95, 0.65], [3.6, 180, 70, 0.9], [5.0, 215, 85, 0.55], [1.2, 228, 60, 0.4],
    ];
    for (const [angle, height, length, tilt] of branches) {
      const branch = new T.Mesh(this.geo(new T.CylinderGeometry(2.5, 6, length, 6)), bark);
      branch.position.set(Math.cos(angle) * length * 0.42, height, Math.sin(angle) * length * 0.42);
      branch.rotation.set(0, -angle, Math.PI / 2 - tilt);
      branch.rotation.order = 'YZX';
      tree.add(branch);
      const strip = new T.Mesh(this.geo(new T.PlaneGeometry(4, 22)), cloth);
      strip.position.set(Math.cos(angle) * length * 0.7, height - 14, Math.sin(angle) * length * 0.7);
      tree.add(strip);
    }
    this.bake(tree);
    tree.position.set(LANDMARK.x, 0, LANDMARK.y);
    this.root.add(tree);
  }

  private buildPlain() {
    const earth = this.mat(flat('#9a5a3c'));
    const mounds = new T.InstancedMesh(this.geo(new T.ConeGeometry(1, 1, 7)), earth, MOUNDS.length * 2);
    MOUNDS.forEach((mound, i) => {
      tmp.rotation.set(0, i * 0.7, 0);
      tmp.position.set(mound.x, mound.h / 2, mound.y);
      tmp.scale.set(mound.r, mound.h, mound.r);
      tmp.updateMatrix();
      mounds.setMatrixAt(i * 2, tmp.matrix);
      tmp.position.set(mound.x + mound.r * 0.45, mound.h * 0.4, mound.y - mound.r * 0.3);
      tmp.scale.set(mound.r * 0.45, mound.h * 0.8, mound.r * 0.45);
      tmp.updateMatrix();
      mounds.setMatrixAt(i * 2 + 1, tmp.matrix);
    });
    const trunk = new T.InstancedMesh(this.geo(new T.CylinderGeometry(1.6, 2.6, 30, 5)), this.mat(flat('#4f3b2a')), ACACIAS.length);
    const crown = new T.InstancedMesh(this.geo(new T.CylinderGeometry(1, 0.7, 1, 8)), this.mat(flat('#6b7442')), ACACIAS.length);
    ACACIAS.forEach((tree, i) => {
      tmp.rotation.set(0, 0, 0.12 * (i % 2 ? 1 : -1));
      tmp.position.set(tree.x, 15, tree.y);
      tmp.scale.set(1, 1, 1);
      tmp.updateMatrix();
      trunk.setMatrixAt(i, tmp.matrix);
      tmp.rotation.set(0, i, 0);
      tmp.position.set(tree.x + (i % 2 ? 3 : -3), 32, tree.y);
      tmp.scale.set(30 + i % 3 * 6, 5, 26 + i % 2 * 6);
      tmp.updateMatrix();
      crown.setMatrixAt(i, tmp.matrix);
    });
    this.root.add(mounds, trunk, crown);
  }

  private buildItems() {
    const glow = this.mat(new T.MeshBasicMaterial({ color: '#ffe2a0', transparent: true, opacity: 0.55, depthWrite: false }));
    const body = this.mat(flat('#c9a46a', { emissive: '#5a3a12', emissiveIntensity: 0.6 }));
    for (const item of ITEM_PLACEMENTS) {
      const group = new T.Group();
      const halo = new T.Mesh(this.geo(new T.SphereGeometry(5, 8, 6)), glow);
      halo.position.y = 6;
      const object = new T.Mesh(this.geo(new T.OctahedronGeometry(2.6)), body);
      object.position.y = 6;
      group.add(halo, object);
      group.position.set(item.x, 0, item.y);
      this.root.add(group);
      this.items.set(item.id, group);
    }
  }

  // ---------------------------------------------------------- ENNEMIS

  private buildEnemies() {
    const shared = {
      skin: flat('#5b3626'),
      leather: this.mat(flat('#3c2a1d')),
      iron: this.mat(new T.MeshStandardMaterial({ color: '#7d7b74', metalness: 0.4, roughness: 0.5, flatShading: true })),
      wood: this.mat(flat('#5d4027')),
      eye: this.mat(new T.MeshBasicMaterial({ color: '#7ff2de' })),
      red: this.mat(flat('#9a2f26')),
    };
    const geos = {
      chest: this.geo(new T.CylinderGeometry(4.8, 3.6, 9, 7)),
      hips: this.geo(new T.CylinderGeometry(4, 5, 6, 7)),
      head: this.geo(new T.SphereGeometry(3.2, 8, 6)),
      limb: this.geo(new T.CylinderGeometry(1.35, 1.05, 8, 6)),
      leg: this.geo(new T.CylinderGeometry(1.6, 1.1, 12, 6)),
      foot: this.geo(new T.BoxGeometry(2.5, 1.6, 4)),
      wrap: this.geo(new T.CylinderGeometry(3.4, 3.3, 2.4, 8)),
      blade: this.geo(new T.BoxGeometry(0.6, 2.6, 15)),
      musket: this.geo(new T.CylinderGeometry(0.55, 0.7, 30, 6)),
      stock: this.geo(new T.BoxGeometry(1.6, 3, 7)),
      weed: this.geo(new T.ConeGeometry(0.8, 7, 4)),
      bar: this.geo(new T.PlaneGeometry(1, 1)),
    };
    const barBack = this.mat(new T.SpriteMaterial({ color: '#1b1210', transparent: true, opacity: 0.75, depthWrite: false }));
    const barFill = this.mat(new T.SpriteMaterial({ color: '#c9473a', depthWrite: false }));
    const cloth: Record<EnemyKind, string> = {
      pilleur: '#6b3b2a', fusilier: '#2f3f5c', noye: '#3e4a44',
      // Soldats du Denkyira (1701) : pagnes rouille et brun sombre.
      eclaireur: '#7a4a2a', lancier: '#6a3020', tireur: '#5a3a24', garde: '#3c2418',
    };
    // Peau du noyé : ondulation d'eau (vertex) et reflet turquoise (shader élémentaire).
    const time = this.time;
    const drownedSkin = (material: T.MeshStandardMaterial) => {
      material.onBeforeCompile = (shader) => {
        shader.uniforms['uTime'] = time;
        shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>',
          `#include <begin_vertex>
          transformed.x += sin(position.y * 0.9 + uTime * 3.0) * 0.32;
          transformed.z += cos(position.y * 0.7 + uTime * 2.3) * 0.32;`);
        shader.fragmentShader = 'uniform float uTime;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += vec3(0.04, 0.32, 0.3) * (0.55 + 0.45 * sin(vViewPosition.y * 0.5 + uTime * 4.0));`);
      };
      material.customProgramCacheKey = () => 'slice-drowned';
    };

    for (const enemy of this.enemies.list) {
      const kind = enemy.kind;
      const root = new T.Group();
      const body = new T.Group();
      root.add(body);
      const torso = new T.Group();
      torso.position.y = 16;
      body.add(torso);
      const skin = (kind === 'noye' ? flat('#4c5a55') : shared.skin.clone()) as T.MeshStandardMaterial;
      if (kind === 'noye') drownedSkin(skin);
      const dress = flat(cloth[kind]);
      this.materials.push(skin, dress);
      const add = (parent: T.Object3D, g: T.BufferGeometry, m: T.Material, x: number, y: number, z: number) => {
        const mesh = new T.Mesh(g, m);
        mesh.position.set(x, y, z);
        parent.add(mesh);
        return mesh;
      };
      add(torso, geos.chest, dress, 0, 4, 0);
      add(torso, geos.hips, dress, 0, -2, 0);
      add(torso, geos.head, skin, 0, 11, 0.4);
      if (kind === 'pilleur') add(torso, geos.wrap, shared.red, 0, 12.6, 0.2);
      if (kind === 'fusilier' || kind === 'tireur') {
        const belt = add(torso, geos.wrap, shared.leather, 0, 4, 0);
        belt.scale.set(1.5, 0.6, 1.5);
        belt.rotation.z = 0.7;
      }
      if (kind === 'noye') {
        for (const [ex, ey] of [[-1.2, 11.5], [1.2, 11.5]]) add(torso, geos.head, shared.eye, ex, ey, 2.9).scale.setScalar(0.18);
        for (let i = 0; i < 6; i++) {
          const weed = add(torso, geos.weed, this.materials.at(-1)!, Math.cos(i) * 4.4, 0, Math.sin(i) * 4.4);
          weed.rotation.x = Math.PI;
        }
      }
      const arms: T.Group[] = [];
      const legs: T.Group[] = [];
      for (const side of [-1, 1]) {
        const arm = new T.Group();
        arm.position.set(side * 4.9, 7, 0);
        torso.add(arm);
        arms.push(arm);
        add(arm, geos.limb, skin, 0, -3.4, 0);
        const leg = new T.Group();
        leg.position.set(side * 2.5, 14, 0);
        body.add(leg);
        legs.push(leg);
        add(leg, geos.leg, kind === 'noye' ? skin : dress, 0, -6.2, 0);
        add(leg, geos.foot, skin, 0, -12.4, 0.8);
      }
      let weapon: T.Object3D;
      if (kind === 'pilleur') {
        weapon = add(arms[1], geos.blade, shared.iron, 0, -8, 6);
        weapon.rotation.x = Math.PI / 2 - 0.4;
      } else if (kind === 'eclaireur' || kind === 'lancier') {
        // Lance : long manche, fer en feuille.
        const spear = new T.Group();
        const shaft = add(spear, this.geo(new T.CylinderGeometry(0.45, 0.5, 40, 5)), shared.wood, 0, 0, 4);
        shaft.rotation.x = Math.PI / 2;
        const tip = add(spear, this.geo(new T.ConeGeometry(1.3, 6, 4)), shared.iron, 0, 0, 26);
        tip.rotation.x = Math.PI / 2;
        spear.position.set(0, -8, 4);
        arms[1].add(spear);
        weapon = spear;
      } else if (kind === 'garde') {
        // Massue cloutée.
        const club = new T.Group();
        const handle = add(club, this.geo(new T.CylinderGeometry(0.8, 1.1, 16, 6)), shared.wood, 0, 0, 6);
        handle.rotation.x = Math.PI / 2;
        add(club, this.geo(new T.DodecahedronGeometry(3, 0)), shared.wood, 0, 0, 15);
        for (let i = 0; i < 5; i++) {
          const stud = add(club, this.geo(new T.ConeGeometry(0.5, 2, 4)), shared.iron, Math.cos(i * 1.3) * 3, Math.sin(i * 1.3) * 3, 15);
          stud.rotation.z = i * 1.3 - Math.PI / 2;
        }
        club.position.set(0, -8, 3);
        arms[1].add(club);
        weapon = club;
      } else if (kind === 'fusilier' || kind === 'tireur') {
        const gun = new T.Group();
        const barrel = add(gun, geos.musket, shared.wood, 0, 0, 0);
        barrel.rotation.x = Math.PI / 2;
        add(gun, geos.stock, shared.wood, 0, -1, -15);
        gun.position.set(0, -8, 8);
        arms[1].add(gun);
        weapon = gun;
      } else {
        weapon = new T.Group();
        arms[1].add(weapon);
      }
      if (kind === 'noye') body.scale.setScalar(1.35);
      if (kind === 'garde') {
        // Grand bouclier rond en peau de buffle (bras gauche), carrure massive.
        const shield = add(arms[0], this.geo(new T.CylinderGeometry(8.5, 8.5, 1.2, 12)), shared.leather, 0, -6, 4);
        shield.rotation.x = Math.PI / 2;
        add(arms[0], this.geo(new T.SphereGeometry(1.6, 6, 4)), shared.iron, 0, -6, 4.9);
        body.scale.setScalar(1.3);
      }

      const back = new T.Sprite(barBack);
      back.scale.set(22, 2.6, 1);
      back.center.set(0, 0.5);
      const bar = new T.Sprite(barFill);
      bar.center.set(0, 0.5);
      bar.scale.set(21, 1.8, 1);
      const top = kind === 'noye' ? 46 : 36;
      back.position.set(-11, top, 0);
      bar.position.set(-10.5, top, 0.01);
      root.add(back, bar);
      back.visible = bar.visible = false;

      this.root.add(root);
      this.rigs.push({
        enemy, root, body, torso, arms, legs, weapon, flash: [skin, dress], bar, barBack: back,
        walk: 0, lastX: enemy.x, lastY: enemy.y, yaw: 0,
      });
    }
  }

  private buildTelegraphs() {
    const aim = this.mat(new T.MeshBasicMaterial({ color: '#ff3b2a', transparent: true, opacity: 0.5, depthWrite: false }));
    const tracer = this.mat(new T.MeshBasicMaterial({ color: '#fff1c8', transparent: true, opacity: 0.9, depthWrite: false }));
    const ring = this.mat(new T.MeshBasicMaterial({ color: '#7ff2de', transparent: true, opacity: 0.45, depthWrite: false, side: T.DoubleSide }));
    const box = this.geo(new T.BoxGeometry(0.6, 0.6, 1));
    const ringGeometry = this.geo(new T.RingGeometry(0.82, 1, 40));
    for (let i = 0; i < 4; i++) {
      const line = new T.Mesh(box, aim.clone());
      this.materials.push(line.material);
      line.visible = false;
      const flash = new T.Mesh(box, tracer);
      flash.visible = false;
      const telegraph = new T.Mesh(ringGeometry, ring.clone());
      this.materials.push(telegraph.material);
      telegraph.rotation.x = -Math.PI / 2;
      telegraph.visible = false;
      this.root.add(line, flash, telegraph);
      this.aimLine.push(line);
      this.tracers.push(flash);
      this.rings.push(telegraph);
    }
  }

  // ------------------------------------------------------------ IMAGE

  update(dt: number) {
    if (this.warmFrames > 0 && --this.warmFrames === 0) {
      this.warmed.forEach((object) => { object.visible = false; });
      this.root.traverse((object) => { object.frustumCulled = true; });
    }
    const now = performance.now() / 1000;
    this.time.value = now;
    const px = this.player.centerX;
    const py = this.player.centerY;

    for (const [id, group] of this.doors) {
      const goal = this.slice.isDoorOpen(id as never) ? -WALL_HEIGHT - 2 : 0;
      group.position.y += (goal - group.position.y) * Math.min(1, dt * 2.5);
      group.visible = group.position.y > -WALL_HEIGHT &&
        Math.abs(group.position.x - px) < PROP_DISTANCE && Math.abs(group.position.z - py) < PROP_DISTANCE;
    }
    this.lever.visible = Math.abs(LEVER.x - px) < PROP_DISTANCE && Math.abs(LEVER.y - py) < PROP_DISTANCE;
    const pulled = this.slice.progression.has('lever');
    this.leverArm.rotation.z += ((pulled ? 0.9 : -0.9) - this.leverArm.rotation.z) * Math.min(1, dt * 4);
    const items = this.slice.progression.items();
    for (const [id, group] of this.items) {
      group.visible = !items.includes(id) &&
        Math.abs(group.position.x - px) < PROP_DISTANCE && Math.abs(group.position.z - py) < PROP_DISTANCE;
      if (!group.visible) continue;
      group.children[1].rotation.y = now * 1.6;
      group.children[1].position.y = 6 + Math.sin(now * 2.2) * 1.2;
    }
    for (const [i, fire] of this.fires.entries()) {
      const flicker = 1 + Math.sin(now * 11 + i * 1.7) * 0.12 + Math.sin(now * 23 + i) * 0.06;
      if (fire instanceof T.Mesh && fire.geometry instanceof T.ConeGeometry) fire.scale.set(flicker, flicker * 1.1, flicker);
      else fire.rotation.y = Math.sin(now * 1.3 + i) * 0.5;
    }

    let lines = 0;
    let flashes = 0;
    let rings = 0;
    for (const rig of this.rigs) {
      const enemy = rig.enemy;
      const near = Math.abs(enemy.x - px) < VIEW_DISTANCE && Math.abs(enemy.y - py) < VIEW_DISTANCE;
      const gone = enemy.state === 'dead' && enemy.deadTime > 6;
      rig.root.visible = near && !gone;
      if (!rig.root.visible) continue;
      this.animate(rig, dt, now);

      const move = enemy.move ? ENEMY_MOVES[enemy.move] : null;
      if (enemy.state === 'windup' && move?.shape === 'shot' && lines < this.aimLine.length) {
        const line = this.aimLine[lines++];
        const locked = enemy.timer <= SHOT_LOCK_MS;
        const length = this.shotLength(enemy);
        line.visible = true;
        line.position.set(enemy.x + enemy.aimX * (14 + length / 2), 19, enemy.y + enemy.aimY * (14 + length / 2));
        line.rotation.set(0, Math.atan2(enemy.aimX, enemy.aimY), 0);
        line.scale.set(locked ? 1.6 : 1, locked ? 1.6 : 1, length);
        line.material.opacity = locked ? 0.95 : 0.25 + 0.2 * Math.sin(now * 18);
        line.material.color.set(locked ? '#ffe4b0' : '#ff3b2a');
      }
      if (enemy.tracer && flashes < this.tracers.length) {
        const t = enemy.tracer;
        const flash = this.tracers[flashes++];
        const length = Math.hypot(t.x2 - t.x1, t.y2 - t.y1);
        flash.visible = true;
        flash.position.set((t.x1 + t.x2) / 2, 19, (t.y1 + t.y2) / 2);
        flash.rotation.set(0, Math.atan2(t.x2 - t.x1, t.y2 - t.y1), 0);
        flash.scale.set(1.3, 1.3, length);
      }
      if (enemy.state === 'windup' && enemy.move === 'slam' && rings < this.rings.length) {
        const ring = this.rings[rings++];
        const radius = ENEMIES.noye.radius + ENEMY_MOVES.slam.reach;
        const p = 1 - enemy.timer / ENEMY_MOVES.slam.windup;
        ring.visible = true;
        ring.position.set(enemy.x, 0.6, enemy.y);
        ring.scale.setScalar(radius * (0.35 + 0.65 * p));
        ring.material.opacity = 0.25 + 0.5 * p;
      }
    }
    for (let i = lines; i < this.aimLine.length; i++) this.aimLine[i].visible = false;
    for (let i = flashes; i < this.tracers.length; i++) this.tracers[i].visible = false;
    for (let i = rings; i < this.rings.length; i++) this.rings[i].visible = false;
  }

  private shotLength(enemy: Enemy) {
    const reach = ENEMY_MOVES.shot.reach;
    for (let t = 16; t < reach; t += 8) {
      const x = enemy.x + enemy.aimX * t;
      const y = enemy.y + enemy.aimY * t;
      if (DUNGEON_WALLS.some((w) => x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) ||
          MOUNDS.some((m) => Math.hypot(x - m.x, y - m.y) < m.r)) return t - 14;
    }
    return reach - 14;
  }

  private animate(rig: EnemyRig, dt: number, now: number) {
    const enemy = rig.enemy;
    const travel = Math.hypot(enemy.x - rig.lastX, enemy.y - rig.lastY);
    rig.lastX = enemy.x;
    rig.lastY = enemy.y;
    rig.walk += Math.min(travel, 10) * (enemy.kind === 'noye' ? 0.09 : 0.15);
    rig.root.position.set(enemy.x, 0, enemy.y);
    const goal = Math.atan2(enemy.facingX, enemy.facingY);
    const turn = Math.atan2(Math.sin(goal - rig.yaw), Math.cos(goal - rig.yaw));
    rig.yaw += turn * (1 - Math.exp(-18 * dt));
    rig.body.rotation.y = rig.yaw;

    const move = enemy.move ? ENEMY_MOVES[enemy.move] : null;
    const moving = travel > 0.2 && (enemy.state === 'chase' || enemy.state === 'return');
    const stride = moving ? Math.sin(rig.walk) : 0;
    const p = move ? enemy.state === 'windup' ? 1 - enemy.timer / move.windup
      : enemy.state === 'active' ? 1 - enemy.timer / move.active
      : enemy.state === 'recover' ? 1 - enemy.timer / move.recover : 0 : 0;
    const [left, right] = rig.arms;
    rig.legs[0].rotation.x = stride * 0.7;
    rig.legs[1].rotation.x = -stride * 0.7;
    left.rotation.set(-stride * 0.5, 0, 0);
    right.rotation.set(stride * 0.5, 0, 0);
    rig.torso.rotation.set(enemy.kind === 'noye' ? 0.35 : 0, 0, 0);
    rig.torso.position.y = 16 + Math.abs(stride) * 0.6;

    if (enemy.state === 'dead') {
      // Chute en arrière, puis le corps s'enfonce et disparaît.
      const fall = Math.min(1, enemy.deadTime / 0.45);
      rig.body.rotation.x = -fall * Math.PI / 2 * 0.95;
      rig.body.position.y = enemy.deadTime > 3 ? -(enemy.deadTime - 3) * 4 : 0;
      rig.bar.visible = rig.barBack.visible = false;
      return;
    }
    rig.body.rotation.x = 0;
    rig.body.position.y = 0;

    if (enemy.state === 'hurt') {
      rig.torso.rotation.x = -0.45;
      right.rotation.x = 0.6;
    } else if (move && (enemy.state === 'windup' || enemy.state === 'active' || enemy.state === 'recover')) {
      if (move.shape === 'shot') {
        // Mousquet épaulé : les deux bras vers l'avant.
        const raise = enemy.state === 'windup' ? Math.min(1, p * 3) : enemy.state === 'active' ? 1 : 1 - p;
        right.rotation.set(-1.45 * raise, 0, 0.3 * raise);
        left.rotation.set(-1.35 * raise, 0, -0.35 * raise);
        if (enemy.state === 'active') rig.torso.rotation.x = -0.18;
      } else if (move.shape === 'ring') {
        // Deux bras levés, puis frappe au sol.
        const lift = enemy.state === 'windup' ? p : enemy.state === 'active' ? 1 - p : 0;
        left.rotation.x = right.rotation.x = -2.8 * lift + (enemy.state === 'active' ? 0.6 : 0);
        rig.torso.rotation.x = -0.25 * lift + (enemy.state === 'active' ? 0.6 * p : 0.35);
      } else {
        const swing = enemy.state === 'windup' ? -2.3 * p : enemy.state === 'active' ? -2.3 + 3.1 * p : 0.8 * (1 - p);
        right.rotation.set(swing, 0, -0.3);
        rig.torso.rotation.y = enemy.state === 'windup' ? -0.5 * p : enemy.state === 'active' ? -0.5 + 1.1 * p : 0.6 * (1 - p);
        rig.torso.rotation.x = (enemy.kind === 'noye' ? 0.35 : 0) + (enemy.state === 'active' ? 0.25 : 0);
      }
    }

    const flash = enemy.flash / 140;
    for (const material of rig.flash) {
      material.emissive.setRGB(flash * 0.9, flash * 0.75, flash * 0.6);
    }
    const hurt = enemy.hp < enemy.maxHp && enemy.engaged;
    rig.bar.visible = rig.barBack.visible = hurt;
    if (hurt) rig.bar.scale.x = Math.max(0.01, 21 * enemy.hp / enemy.maxHp);
    // Sprites dans le repère du corps : on les garde au-dessus de la tête quelle que soit la rotation.
    void now;
  }

  dispose() {
    this.scene.remove(this.root);
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
  }
}
