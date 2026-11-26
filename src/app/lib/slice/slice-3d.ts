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
import { TerrainCollisionService } from '../engine/terrain-collision.service';
import { HIP_X, SHOULDER_X, hideProxy, skinHuman } from '../engine/human-body';
import { soldierOutfit } from '../engine/human-outfits';
import { groundSector, groundSectorEdge } from '../engine/attack-readability-3d';
import { PALETTE } from '../constants/landscape';
import { buildAfena, buildClub, buildMusket, buildSpear, buildSword, WEAPON_MATERIALS } from '../engine/equipment-3d';

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
/** Coups au corps à corps : même demi-angle que EnemiesService.tryHitPlayer (cos ≥ 0,25). */
const ARC_HALF = Math.acos(0.25);
const MAX_ARCS = 6;

/**
 * [SUPPOSITION] Poses du mousquet (radians). right/left : bras vers l'avant
 * (négatif = levé), rightZ/leftZ : écart latéral du bras (négatif à droite,
 * positif à gauche = ramené devant la poitrine), gun :
 * pente du canon par rapport au corps (0 = horizontal, -π/2 = vertical),
 * gunZ : position de la poignée le long de la main (crosse calée à l'épaule en visée).
 */
interface MusketPose { right: number; rightZ: number; left: number; leftZ: number; gun: number; gunZ: number; torsoX: number; torsoY: number }
const MUSKET_CARRY: MusketPose = { right: -0.35, rightZ: -0.05, left: -0.6, leftZ: 0.3, gun: -0.6, gunZ: 8, torsoX: 0, torsoY: 0 };
const MUSKET_AIM: MusketPose = { right: -1.15, rightZ: -0.12, left: -1.4, leftZ: 0.42, gun: 0, gunZ: 1.5, torsoX: 0.05, torsoY: -0.3 };
const MUSKET_RELOAD: MusketPose = { right: -0.42, rightZ: -0.08, left: -2.05, leftZ: 0.22, gun: -1.42, gunZ: 4, torsoX: 0.16, torsoY: 0.1 };
function blendPose(pose: MusketPose, to: MusketPose, t: number) {
  for (const key of Object.keys(pose) as (keyof MusketPose)[]) pose[key] += (to[key] - pose[key]) * t;
}

interface EnemyRig {
  enemy: Enemy;
  root: T.Group;
  body: T.Group;
  torso: T.Group;
  arms: T.Group[];
  legs: T.Group[];
  weapon: T.Object3D;
  muzzle?: T.Object3D;
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
  private readonly groundLine: T.Mesh<T.BoxGeometry, T.MeshBasicMaterial>[] = [];
  private readonly tracers: T.Mesh<T.BoxGeometry, T.MeshBasicMaterial>[] = [];
  private readonly rings: T.Mesh<T.RingGeometry, T.MeshBasicMaterial>[] = [];
  private readonly arcs: { fill: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>; edge: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial> }[] = [];
  private readonly danger = new T.Color(PALETTE.danger);
  private readonly dangerFlash = new T.Color(PALETTE.dangerFlash);
  private readonly muzzles: T.Sprite[] = [];
  private readonly muzzlePos = new T.Vector3();
  private muzzleTexture?: T.CanvasTexture;
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
    private readonly terrain: TerrainCollisionService,
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
      geometry.deleteAttribute('uv');
      geometry.deleteAttribute('uv1');
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
      const object = new T.Group();
      if (item.id === 'afena') {
        const afena = buildAfena();
        afena.scale.setScalar(0.4);
        this.materials.push(afena.userData['blade'] as T.Material, afena.userData['glow'] as T.Material);
        object.add(afena);
        object.rotation.z = 0.3;
      } else {
        object.add(new T.Mesh(this.geo(new T.OctahedronGeometry(2.6)), body));
      }
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
      weed: this.geo(new T.ConeGeometry(0.8, 7, 4)),
      bar: this.geo(new T.PlaneGeometry(1, 1)),
    };
    const barBack = this.mat(new T.SpriteMaterial({ color: '#1b1210', transparent: true, opacity: 0.75, depthWrite: false }));
    const barFill = this.mat(new T.SpriteMaterial({ color: '#c9473a', depthWrite: false }));
    const cloth: Record<EnemyKind, string> = {
      pilleur: '#3c2c27', fusilier: '#273447', noye: '#263b39',
      eclaireur: '#423126', lancier: '#452720', tireur: '#352820', garde: '#241b17',
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

    // Tenues : matériaux partagés par couleur entre tous les soldats.
    const outfitMaterials = new Map<string, T.Material>();
    const outfitMaterial = (color: string) => {
      let material = outfitMaterials.get(color);
      if (!material) outfitMaterials.set(color, material = this.mat(flat(color)));
      return material;
    };
    const eyeWhite = this.mat(flat('#d8c9ae'));
    const eyeDark = this.mat(flat('#161010'));
    const sheathColors = [WEAPON_MATERIALS.leather, WEAPON_MATERIALS.darkWood, WEAPON_MATERIALS.wood];
    const lengths = [0.92, 1, 1.08];
    const addSheath = (group: T.Group, variant: number, height: number, width: number, depth: number,
      y: number, z: number) => {
      const sheath = new T.Mesh(this.geo(new T.BoxGeometry(width, height, depth)), sheathColors[variant % sheathColors.length]);
      sheath.position.set(0, y, z);
      group.add(sheath);
      const wear = new T.Mesh(this.geo(new T.BoxGeometry(0.14, height * 0.45, depth + 0.18)), WEAPON_MATERIALS.darkIron);
      wear.position.set(variant % 2 ? width * 0.32 : -width * 0.32, y, z - 0.08);
      group.add(wear);
    };
    const finishWeapon = (group: T.Group, variant: number) => {
      group.scale.y = lengths[variant % lengths.length];
      this.bake(group);
      return group;
    };

    for (const [index, enemy] of this.enemies.list.entries()) {
      const kind = enemy.kind;
      const variant = index % 3;
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
      const arms: T.Group[] = [];
      const legs: T.Group[] = [];
      for (const side of [-1, 1]) {
        const arm = new T.Group();
        arm.position.set(side * SHOULDER_X, 7, 0);
        torso.add(arm);
        arms.push(arm);
        add(arm, geos.limb, skin, 0, -3.4, 0);
        const leg = new T.Group();
        leg.position.set(side * HIP_X, 14, 0);
        body.add(leg);
        legs.push(leg);
        add(leg, geos.leg, kind === 'noye' ? skin : dress, 0, -6.2, 0);
        add(leg, geos.foot, skin, 0, -12.4, 0.8);
      }
      // Corps humain commun (human-body.ts) ; les primitives ci-dessus deviennent des os invisibles.
      for (const group of [torso, ...arms, ...legs]) for (const child of group.children) if (child instanceof T.Mesh) hideProxy(child);
      const human = skinHuman({ root: body, torso, head: torso.children[2], arms, fore: arms, legs }, {
        skin, outfit: soldierOutfit(outfitMaterial, kind, dress),
        eyes: kind === 'noye' ? undefined : { white: eyeWhite, dark: eyeDark },
      });
      const tie = add(human.bones.head, geos.wrap, kind === 'noye' ? outfitMaterial('#2f6b62') : shared.red, 0, 1.9, -0.3);
      tie.scale.set(0.5, 0.55, 0.6);
      if (kind === 'tireur' || kind === 'fusilier') {
        // Ceinture de poudre : petites gourdes de poudre et poire en corne.
        for (const [x, z] of [[-1.6, 1.75], [-0.4, 1.95], [0.8, 1.9], [2.6, 0.9]] as const) {
          add(torso, geos.head, shared.wood, x, 1.0, z).scale.set(0.16, 0.24, 0.16);
        }
        const horn = add(torso, geos.weed, outfitMaterial('#c9b38a'), -2.9, 0.6, 0.6);
        horn.rotation.z = 1.2;
        horn.scale.set(0.9, 0.6, 0.9);
      }
      if (kind === 'noye') {
        for (const [ex, ey] of [[-0.55, 0.62], [0.55, 0.62]]) add(human.bones.head, geos.head, shared.eye, ex, ey, 1.55).scale.setScalar(0.09);
        for (let i = 0; i < 6; i++) {
          const weed = add(torso, geos.weed, dress, Math.cos(i) * 2.9, 0, Math.sin(i) * 2.0);
          weed.rotation.x = Math.PI;
        }
      }
      let weapon: T.Object3D;
      let muzzle: T.Object3D | undefined;
      if (kind === 'pilleur') {
        const sword = buildSword();
        addSheath(sword, variant, 5.4, 2.1, 0.9, 3.1, -0.5);
        finishWeapon(sword, variant);
        sword.position.set(0, -8, 6);
        sword.rotation.x = Math.PI / 2 - 0.4;
        arms[1].add(sword);
        weapon = sword;
      } else if (kind === 'eclaireur' || kind === 'lancier') {
        const spear = buildSpear();
        addSheath(spear, variant, 3.2, 1.5, 1.2, 6.5, 0);
        finishWeapon(spear, variant);
        spear.position.set(0, -8, 4);
        spear.rotation.x = Math.PI / 2;
        arms[1].add(spear);
        weapon = spear;
      } else if (kind === 'garde') {
        const club = new T.Group();
        const model = buildClub();
        addSheath(model, variant, 4, 2.3, 1.8, -3.5, 0);
        model.scale.y = lengths[variant % lengths.length];
        model.rotation.x = Math.PI / 2;
        model.position.z = 6;
        club.add(model);
        finishWeapon(club, 1);
        club.position.set(0, -8, 3);
        arms[1].add(club);
        weapon = club;
      } else if (kind === 'fusilier' || kind === 'tireur') {
        const gun = new T.Group();
        const model = buildMusket();
        const barrelScale = 1.1 * lengths[variant % lengths.length];
        model.rotation.x = Math.PI / 2;
        model.scale.y = barrelScale;
        gun.add(model);
        finishWeapon(gun, 1);
        gun.position.set(0, -8, 8);
        muzzle = new T.Object3D();
        muzzle.position.set(0, 0, 16 * barrelScale);
        gun.add(muzzle);
        arms[1].add(gun);
        weapon = gun;
      } else {
        weapon = new T.Group();
        arms[1].add(weapon);
      }
      if (kind === 'noye') body.scale.setScalar(1.35);
      if (kind === 'garde') {
        const shield = new T.Group();
        const disc = new T.Mesh(this.geo(new T.CylinderGeometry(8.5, 8.5, 1.2, 12)), WEAPON_MATERIALS.leather);
        disc.rotation.x = Math.PI / 2;
        shield.add(disc);
        for (const radius of [8.4, 6.7, 4.5]) {
          const ring = new T.Mesh(this.geo(new T.TorusGeometry(radius, 0.35, 4, 12)),
            radius === 8.4 ? WEAPON_MATERIALS.brass : WEAPON_MATERIALS.darkWood);
          ring.position.z = 0.7;
          shield.add(ring);
        }
        const boss = new T.Mesh(this.geo(new T.SphereGeometry(1.7, 6, 4)), WEAPON_MATERIALS.iron);
        boss.position.z = 0.95;
        shield.add(boss);
        for (const x of [-3.2, 3.2]) {
          const strap = new T.Mesh(this.geo(new T.BoxGeometry(1.6, 13, 0.5)), WEAPON_MATERIALS.leather);
          strap.position.set(x, 0, -0.85);
          shield.add(strap);
        }
        this.bake(shield);
        shield.position.set(0, -6, 4);
        arms[0].add(shield);
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
        enemy, root, body, torso, arms, legs, weapon, muzzle, flash: [skin, dress], bar, barBack: back,
        walk: 0, lastX: enemy.x, lastY: enemy.y, yaw: 0,
      });
    }
  }

  private buildTelegraphs() {
    const aim = this.mat(new T.MeshBasicMaterial({ color: '#ff3b2a', transparent: true, opacity: 0.5, depthWrite: false }));
    const tracer = this.mat(new T.MeshBasicMaterial({ color: '#fff1c8', transparent: true, opacity: 0.95, depthWrite: false, blending: T.AdditiveBlending }));
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
    // Zone de coup au sol (lance, coupe-coupe, massue, griffe) : secteur qui se
    // remplit pendant l'anticipation et pâlit vers le blanc juste avant l'impact.
    const arcFill = this.geo(groundSector(ARC_HALF));
    const arcEdge = this.geo(groundSectorEdge(ARC_HALF));
    for (let i = 0; i < MAX_ARCS; i++) {
      const fill = new T.Mesh(arcFill, this.mat(new T.MeshBasicMaterial({
        color: PALETTE.danger, transparent: true, opacity: 0.2, depthWrite: false, side: T.DoubleSide })));
      const edge = new T.Mesh(arcEdge, this.mat(new T.MeshBasicMaterial({
        color: PALETTE.danger, transparent: true, opacity: 0.6, depthWrite: false, side: T.DoubleSide })));
      fill.renderOrder = edge.renderOrder = 2;
      fill.visible = edge.visible = false;
      this.root.add(fill, edge);
      this.arcs.push({ fill, edge });
    }
    const groundAim = this.mat(new T.MeshBasicMaterial({ color: '#ff3b2a', transparent: true, opacity: 0.4, depthWrite: false }));
    for (let i = 0; i < 4; i++) {
      const line = new T.Mesh(box, groundAim.clone());
      this.materials.push(line.material);
      line.visible = false;
      this.root.add(line);
      this.groundLine.push(line);
    }
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, '#fffbe6');
    gradient.addColorStop(0.28, '#ffd27a');
    gradient.addColorStop(1, '#ff6b2c00');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    this.muzzleTexture = new T.CanvasTexture(canvas);
    for (let i = 0; i < 4; i++) {
      const sprite = new T.Sprite(this.mat(new T.SpriteMaterial({
        map: this.muzzleTexture, color: '#ffe8b0', transparent: true, opacity: 0,
        blending: T.AdditiveBlending, depthWrite: false,
      })));
      sprite.visible = false;
      this.root.add(sprite);
      this.muzzles.push(sprite);
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
    let grounds = 0;
    let flashes = 0;
    let rings = 0;
    let muzzleFlashes = 0;
    let arcs = 0;
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
        // Même longueur que la balle : la ligne s'arrête sur le rocher ou l'arbre qui la bloquera.
        const length = Math.max(4, enemy.shotLength - 14);
        const progress = 1 - enemy.timer / move.windup;
        const x1 = enemy.x + enemy.aimX * 14;
        const y1 = enemy.y + enemy.aimY * 14;
        const x2 = enemy.x + enemy.aimX * (14 + length);
        const y2 = enemy.y + enemy.aimY * (14 + length);
        // Du canon à la poitrine du joueur, prolongée au-delà : la ligne suit la pente (ravine, rocher).
        const from = this.terrain.groundAt(enemy.x, enemy.y) + 19;
        const to = from + this.shotSlope(enemy, from, px, py) * (14 + length);
        this.span(line, x1, from, y1, x2, to, y2, locked ? 1.6 : 1);
        line.material.opacity = locked ? 0.95 : 0.25 + 0.2 * Math.sin(now * 18);
        line.material.color.set(locked ? '#ffe4b0' : '#ff3b2a');
        // Bande au sol seulement si le tireur est au niveau du sentier : depuis
        // son rocher, elle flotterait dans le vide (la ligne de visée suffit).
        if (grounds < this.groundLine.length && Math.abs(to - from) < 12) {
          const ground = this.groundLine[grounds++];
          this.span(ground, x1, this.terrain.groundAt(x1, y1) + 0.8, y1, x2, this.terrain.groundAt(x2, y2) + 0.8, y2, 1);
          ground.scale.x = 9 + 6 * progress;
          ground.scale.y = 0.12;
          ground.material.opacity = locked ? 0.6 : 0.14 + 0.28 * progress;
        }
      }
      // Mèche allumée du mousquet pendant la visée : braise qui grossit, vive au verrouillage.
      if (rig.muzzle && enemy.state === 'windup' && move?.shape === 'shot' && muzzleFlashes < this.muzzles.length) {
        const sprite = this.muzzles[muzzleFlashes++];
        const locked = enemy.timer <= SHOT_LOCK_MS;
        rig.root.updateMatrixWorld(true);
        rig.weapon.getWorldPosition(this.muzzlePos);
        sprite.visible = true;
        sprite.position.copy(this.muzzlePos);
        sprite.position.y += 2;
        sprite.material.color.set(locked ? '#fff0b8' : '#ff8a3a');
        sprite.material.opacity = locked ? 1 : 0.55 + 0.3 * Math.sin(now * 31 + enemy.id);
        const size = locked ? 7 : 3.5 + 1.2 * Math.sin(now * 17);
        sprite.scale.set(size, size, 1);
      }
      if (rig.muzzle && enemy.shotFlash > 0 && muzzleFlashes < this.muzzles.length) {
        const sprite = this.muzzles[muzzleFlashes++];
        const life = enemy.shotFlash / 90;
        rig.root.updateMatrixWorld(true);
        rig.muzzle.getWorldPosition(this.muzzlePos);
        sprite.visible = true;
        sprite.position.copy(this.muzzlePos);
        sprite.material.color.set('#ffe8b0');
        sprite.material.opacity = life;
        const size = 8 + (1 - life) * 12;
        sprite.scale.set(size, size, 1);
      }
      if (enemy.tracer && flashes < this.tracers.length) {
        const t = enemy.tracer;
        const flash = this.tracers[flashes++];
        const from = this.terrain.groundAt(enemy.x, enemy.y) + 19;
        const slope = this.shotSlope(enemy, from, px, py);
        this.span(flash, t.x1, from + slope * 14, t.y1, t.x2, from + slope * Math.hypot(t.x2 - enemy.x, t.y2 - enemy.y), t.y2, 1.3);
      }
      if (move?.shape === 'arc' && arcs < this.arcs.length &&
          (enemy.state === 'windup' || (enemy.state === 'active' && !enemy.hitDone))) {
        this.showArc(this.arcs[arcs++], enemy, move);
      }
      if (enemy.state === 'windup' && enemy.move === 'slam' && rings < this.rings.length) {
        const ring = this.rings[rings++];
        const radius = ENEMIES.noye.radius + ENEMY_MOVES.slam.reach;
        const p = 1 - enemy.timer / ENEMY_MOVES.slam.windup;
        ring.visible = true;
        ring.position.set(enemy.x, this.terrain.groundAt(enemy.x, enemy.y) + 0.6, enemy.y);
        ring.scale.setScalar(radius * (0.35 + 0.65 * p));
        ring.material.opacity = 0.25 + 0.5 * p;
      }
    }
    for (let i = lines; i < this.aimLine.length; i++) this.aimLine[i].visible = false;
    for (let i = grounds; i < this.groundLine.length; i++) this.groundLine[i].visible = false;
    for (let i = flashes; i < this.tracers.length; i++) this.tracers[i].visible = false;
    for (let i = rings; i < this.rings.length; i++) this.rings[i].visible = false;
    for (let i = muzzleFlashes; i < this.muzzles.length; i++) this.muzzles[i].visible = false;
    for (let i = arcs; i < this.arcs.length; i++) this.arcs[i].fill.visible = this.arcs[i].edge.visible = false;
  }

  /**
   * Portée réelle du coup : corps + allonge + élan de la fente pendant la
   * phase active. Orientée sur le regard courant (l'ennemi pivote encore au
   * début de l'anticipation, la zone le suit).
   */
  private showArc(arc: Slice3D['arcs'][number], enemy: Enemy, move: (typeof ENEMY_MOVES)[keyof typeof ENEMY_MOVES]) {
    const windup = enemy.state === 'windup';
    const t = windup ? Math.max(0, Math.min(1, 1 - enemy.timer / move.windup)) : 1;
    const late = windup ? T.MathUtils.smoothstep(t, 0.7, 1) : 1;
    const lunge = (move.lunge ?? 0) * (windup ? move.active : Math.max(0, enemy.timer)) / 1000;
    const radius = ENEMIES[enemy.kind].radius + move.reach + lunge;
    const ground = this.terrain.groundAt(enemy.x, enemy.y) + 1.2;
    const yaw = Math.atan2(enemy.facingX, enemy.facingY);
    for (const mesh of [arc.fill, arc.edge]) {
      mesh.visible = true;
      mesh.position.set(enemy.x, ground, enemy.y);
      mesh.rotation.y = yaw;
    }
    arc.edge.scale.set(radius, 1, radius);
    const grow = Math.max(0.05, t) * radius;
    arc.fill.scale.set(grow, 1, grow);
    arc.fill.material.color.copy(this.danger).lerp(this.dangerFlash, late * 0.6);
    arc.edge.material.color.copy(this.danger).lerp(this.dangerFlash, late);
    arc.fill.material.opacity = 0.1 + t * 0.16 + late * 0.1;
    arc.edge.material.opacity = 0.3 + t * 0.4 + late * 0.25;
  }

  /** Pente verticale du tir : du canon vers la poitrine du joueur (bornée). */
  private shotSlope(enemy: Enemy, from: number, px: number, py: number) {
    const distance = Math.max(30, Math.hypot(px - enemy.x, py - enemy.y));
    return T.MathUtils.clamp((this.terrain.groundAt(px, py) + 19 - from) / distance, -0.6, 0.6);
  }

  /** Pose une barre (boîte unitaire allongée sur z) entre deux points 3D. */
  private span(mesh: T.Mesh, x1: number, h1: number, z1: number, x2: number, h2: number, z2: number, thickness: number) {
    mesh.visible = true;
    mesh.position.set((x1 + x2) / 2, (h1 + h2) / 2, (z1 + z2) / 2);
    this.spanTarget.set(x2, h2, z2);
    mesh.lookAt(this.spanTarget);
    mesh.scale.set(thickness, thickness, Math.hypot(x2 - x1, h2 - h1, z2 - z1));
  }
  private readonly spanTarget = new T.Vector3();

  private animate(rig: EnemyRig, dt: number, now: number) {
    const enemy = rig.enemy;
    const travel = Math.hypot(enemy.x - rig.lastX, enemy.y - rig.lastY);
    rig.lastX = enemy.x;
    rig.lastY = enemy.y;
    rig.walk += Math.min(travel, 10) * (enemy.kind === 'noye' ? 0.09 : 0.15);
    rig.root.position.set(enemy.x, this.terrain.groundAt(enemy.x, enemy.y), enemy.y);
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
    rig.body.position.set(0, 0, 0);
    const gunner = enemy.kind === 'tireur' || enemy.kind === 'fusilier';
    const attacking = enemy.state === 'windup' || enemy.state === 'active' || enemy.state === 'recover';

    if (enemy.state === 'hurt') {
      rig.torso.rotation.x = -0.45;
      right.rotation.x = 0.6;
      if (gunner) {
        rig.weapon.rotation.x = MUSKET_CARRY.gun - right.rotation.x;
        rig.weapon.position.z = MUSKET_CARRY.gunZ;
      }
    } else if (gunner && (!move || move.shape === 'shot' || !attacking)) {
      this.poseMusket(rig, enemy, attacking ? move : null, now, stride !== 0);
    } else if (move && attacking) {
      if (move.shape === 'ring') {
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

    // Coup de crosse : le mousquet suit le bras, canon à l'horizontale.
    if (gunner && move && move.shape !== 'shot' && attacking) {
      rig.weapon.rotation.x = -right.rotation.x * 0.6;
      rig.weapon.position.z = MUSKET_CARRY.gunZ;
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

  /**
   * Mousquet du Denkyira : port d'arme en marchant, épauler en se plaçant de
   * trois quarts, visée tenue (léger balancement qui s'arrête au verrouillage),
   * recul net au départ du coup, puis rechargement crosse au sol : la main
   * gauche bourre la charge à la baguette avant de remettre l'arme au port.
   * Le canon garde sa pente propre quel que soit le bras (contre-rotation).
   */
  private poseMusket(rig: EnemyRig, enemy: Enemy, move: (typeof ENEMY_MOVES)[keyof typeof ENEMY_MOVES] | null, now: number, walking: boolean) {
    const [left, right] = rig.arms;
    const pose = { ...MUSKET_CARRY };
    let kick = 0;
    let stance = 0;
    if (move && enemy.state === 'windup') {
      const shoulder = T.MathUtils.smoothstep(1 - enemy.timer / move.windup, 0, 0.32);
      blendPose(pose, MUSKET_AIM, shoulder);
      stance = shoulder;
      // Respiration du tireur : elle s'éteint quand la ligne se fige.
      const steady = T.MathUtils.smoothstep(enemy.timer, SHOT_LOCK_MS, SHOT_LOCK_MS + 300);
      const sway = Math.sin(now * 4.7 + enemy.id) * 0.035 * steady * shoulder;
      pose.right += sway;
      pose.left += sway;
      pose.gun += sway * 0.5;
    } else if (move && (enemy.state === 'active' || enemy.state === 'recover')) {
      // Temps écoulé depuis le coup (ms).
      const since = enemy.state === 'active' ? move.active - enemy.timer : move.active + move.recover - enemy.timer;
      const total = move.active + move.recover;
      kick = Math.exp(-since / 110);
      const lower = T.MathUtils.smoothstep(since, 260, 700);
      const ready = T.MathUtils.smoothstep(since, total - 480, total);
      blendPose(pose, MUSKET_AIM, 1 - ready);
      blendPose(pose, MUSKET_RELOAD, lower * (1 - ready));
      stance = (1 - lower) * (1 - ready);
      // Baguette : la main gauche monte et descend le long du canon.
      const ram = lower * (1 - ready) * T.MathUtils.smoothstep(since, 700, 900);
      pose.left += Math.sin(since / 1000 * Math.PI * 2 * 1.4) * 0.38 * ram;
    } else if (walking) {
      pose.gun += Math.sin(now * 6 + enemy.id) * 0.04;
    }
    // Recul : le canon se relève, les épaules partent en arrière, un demi-pas subi.
    pose.right -= 0.32 * kick;
    pose.left -= 0.22 * kick;
    pose.gun -= 0.3 * kick;
    pose.torsoX -= 0.24 * kick;
    rig.body.position.set(-enemy.facingX * 2.4 * kick, 0, -enemy.facingY * 2.4 * kick);

    right.rotation.set(pose.right, 0, pose.rightZ);
    left.rotation.set(pose.left, 0, pose.leftZ);
    rig.weapon.rotation.x = pose.gun - pose.right;
    rig.weapon.position.z = pose.gunZ;
    rig.torso.rotation.set(pose.torsoX, pose.torsoY, 0);
    // Hanches de trois quarts, buste et canon face à la cible.
    rig.body.rotation.y = rig.yaw - pose.torsoY;
    if (!walking && stance > 0) {
      // Pied gauche devant, droit en arrière : appui pour encaisser le recul.
      rig.legs[0].rotation.x = -0.22 * stance;
      rig.legs[1].rotation.x = 0.26 * stance;
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.muzzleTexture?.dispose();
  }
}
