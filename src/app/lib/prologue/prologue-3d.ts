import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sceneryRandom } from '../constants/scenery';
import { applyWind } from '../engine/wind';
import { currentSettings } from '../platform/settings.service';
import { LYING_ON_BACK, LYING_ON_SIDE, bakeHuman } from '../engine/human-bake';
import { plainOutfit, soldierOutfit } from '../engine/human-outfits';
import { buildBow, buildMusket, buildSpear, buildSword, WEAPON_DIMENSIONS } from '../engine/equipment-3d';
import {
  BLADES, BODIES, BOWS, CAMP_FIRES, CAMP_WARRIORS, CLEARINGS, FALLEN_TRUNK, FOREST, KEGS, LITTER, MUSKETS,
  PROLOGUE_AREA, PROLOGUE_FOYERS, REMAINS, SCORCHES, SMOKES, SPEARS, STREAM, TRAIL, TRAIL_HALF,
  UMBRELLA, type PropSpot, type RemainsId,
  BRANCHES, BRIDGE, COVER_TRUNKS, CREST_FALLEN, KAPOK, DRUMMER, LOOKOUT, pathHeight, terrainHeight, TRAIL_HALVES, PROLOGUE_CENTER, PROLOGUE_DUEL,
} from './prologue-map';

/**
 * Décor 3D du prologue (1701) : forêt dense, sentier piétiné, morts des deux
 * camps, armes jetées, herbe brûlée, fumées, tambours abandonnés, camp de
 * l'arrière-garde sous le parasol d'un chef.
 *
 * Règles reprises du reste du moteur : low poly, flatShading, roughness ≥ 0.9,
 * aucune lumière ajoutée (le nombre de lumières ne change jamais), tout est
 * construit une fois et précompilé (warmables). Les objets répétés sont des
 * InstancedMesh de géométries fusionnées à couleurs de sommets.
 * [SUPPOSITION] Couleurs et proportions à valider en jeu.
 */

const C = {
  skin: '#5a3a26',
  asanteSmock: '#8a6a43',
  talisman: '#3b2a1d',
  talismanRed: '#7a2e22',
  indigo: '#2f3a52',
  denkyira: '#8c4a2c',
  leather: '#3e2a1c',
  wood: '#6b4a30',
  darkWood: '#3f2b1d',
  iron: '#3a3a38',
  bone: '#d8cdb0',
  gourd: '#b08d4e',
  trunk: '#4d3b2a',
  leaves: ['#3f5a30', '#4b6634', '#35502c', '#56703a'],
  bush: '#3f5530',
  palm: '#5b7a34',
};

type Part = [T.BufferGeometry, string, T.Matrix4];

const m4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)),
    new T.Vector3(sx, sy, sz));

/** Fusionne des pièces (géométrie, couleur, placement) en une géométrie à couleurs de sommets. */
function merge(parts: Part[]) {
  const color = new T.Color();
  const list = parts.map(([geometry, hex, matrix]) => {
    const g = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
    g.deleteAttribute('uv');
    color.set(hex);
    const count = g.attributes['position'].count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    g.setAttribute('color', new T.BufferAttribute(colors, 3));
    return g;
  });
  const merged = mergeGeometries(list)!;
  list.forEach((g) => g.dispose());
  parts.forEach(([g]) => g.dispose());
  return merged;
}

const box = (w: number, h: number, d: number) => new T.BoxGeometry(w, h, d);
const cyl = (top: number, bottom: number, h: number, sides = 6) => new T.CylinderGeometry(top, bottom, h, sides);
const ball = (r: number, detail = 0) => new T.IcosahedronGeometry(r, detail);

function builderParts(group: T.Group, transform: T.Matrix4): Part[] {
  group.updateMatrixWorld(true);
  const parts: Part[] = [];
  group.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    const material = object.material as T.MeshStandardMaterial | T.MeshBasicMaterial;
    parts.push([object.geometry.clone(), `#${material.color.getHexString()}`,
      transform.clone().multiply(object.matrixWorld)]);
  });
  return parts;
}

export class Prologue3D {
  readonly root = new T.Group();
  readonly warmables = [this.root];
  readonly textures: T.Texture[] = [];
  private readonly materials: T.Material[] = [];
  private readonly flames: T.Mesh[] = [];
  private readonly smoke: { sprite: T.Sprite; base: { x: number; y: number }; seed: number; floor?: number }[] = [];
  private readonly glints: { sprite: T.Sprite; id: RemainsId }[] = [];
  private readonly vultures: { bird: T.Group; wings: T.Mesh[]; seed: number }[] = [];
  private embers?: T.Points<T.BufferGeometry, T.PointsMaterial>;
  /** Cendres et braises qui flottent autour du héros. */
  private motes?: T.Points<T.BufferGeometry, T.PointsMaterial>;
  private embersAir?: T.Points<T.BufferGeometry, T.PointsMaterial>;
  private readonly moteSeeds: number[] = [];
  /** Incendies au fond de la vallée. */
  private readonly valleyFires: T.Sprite[] = [];

  /** Tisons qui balisent le sentier (lueur qui pulse). */
  private readonly brands: T.Sprite[] = [];
  /** Feux de la crête, visibles de loin. */
  private readonly beacons: T.Sprite[] = [];

  /** Corps du porte-glaive, couché sur la crête après le combat. */
  private readonly corpse: T.Group;
  /** Tronc du raccourci : debout au bord du ravin, puis couché en pont. */
  private trunkStanding!: T.Object3D;
  private trunkBridge!: T.Object3D;
  private time = 0;
  private readonly tmp = new T.Object3D();
  private readonly random = sceneryRandom(91701);
  /**
   * Bouffées de fumée par colonne : grands sprites transparents qui se
   * superposent (un appel de dessin chacun, beaucoup de pixels repeints).
   * Moitié moins hors qualité haute, pour les GPU de téléphone.
   */
  private readonly puffs = currentSettings().quality === 'high' ? 1 : 2;

  constructor(
    private readonly scene: T.Scene,
    private readonly active: () => boolean,
    private readonly hasRead: (id: RemainsId) => boolean,
    private readonly championSpot: () => { x: number; y: number; yaw: number } | null = () => null,
    private readonly bridged: () => boolean = () => false,
    private readonly hero: () => { x: number; y: number } | null = () => null,
  ) {
    const vertex = this.mat(new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
    this.buildGround();
    this.buildForest(vertex);
    this.buildBattle(vertex);
    this.buildLandmarks(vertex);
    this.buildFires(vertex);
    this.buildCamp(vertex);
    this.buildSmoke();
    this.buildGlints();
    this.buildVultures(vertex);
    this.corpse = this.buildCorpse(vertex);
    this.buildSequences(vertex);
    this.buildGuidance(vertex);
    this.buildAtmosphere(vertex);
    this.root.visible = false;
    scene.add(this.root);
  }

  update(dt: number) {
    const on = this.active();
    this.root.visible = on;
    if (!on) return;
    this.time += dt;
    const t = this.time;
    this.updateMotes(dt);
    this.valleyFires.forEach((f, i) => { f.material.opacity = 0.65 + 0.3 * Math.sin(t * (1.7 + i * 0.13) + i); });
    this.brands.forEach((b, i) => { b.material.opacity = 0.55 + 0.25 * Math.sin(t * 3.1 + i * 1.7) + 0.1 * Math.sin(t * 11 + i); });
    this.beacons.forEach((b, i) => { b.material.opacity = 0.7 + 0.2 * Math.sin(t * 2.3 + i * 2.1); });
    const down = this.bridged();
    this.trunkStanding.visible = !down;
    this.trunkBridge.visible = down;
    const spot = this.championSpot();
    this.corpse.visible = !!spot;
    if (spot) {
      this.corpse.position.set(spot.x, terrainHeight(spot.x, spot.y), spot.y);
      this.corpse.rotation.y = spot.yaw - Math.PI / 2;
    }
    this.flames.forEach((flame, i) => {
      const f = 1 + Math.sin(t * 13 + i * 2.1) * 0.12 + Math.sin(t * 7.3 + i) * 0.08;
      flame.scale.set(1 / Math.sqrt(f), f, 1 / Math.sqrt(f));
    });
    for (const puff of this.smoke) {
      const life = (t * 0.05 + puff.seed) % 1;
      puff.sprite.position.set(puff.base.x + life * 70 + Math.sin(puff.seed * 9) * 8, 10 + (puff.floor ?? 0) + life * 230, puff.base.y - life * 40);
      puff.sprite.scale.setScalar(26 + life * 120);
      puff.sprite.material.opacity = Math.sin(life * Math.PI) * 0.42;
    }
    for (const glint of this.glints) {
      const read = this.hasRead(glint.id);
      glint.sprite.visible = !read;
      if (!read) glint.sprite.material.opacity = 0.45 + Math.sin(t * 3 + glint.sprite.position.x) * 0.25;
    }
    if (this.embers) this.embers.material.opacity = 0.65 + Math.sin(t * 9) * 0.2 + Math.sin(t * 23) * 0.1;
    for (const v of this.vultures) {
      const a = t * 0.18 + v.seed * 2.4;
      const r = 120 + v.seed * 40;
      v.bird.position.set(4700 + Math.cos(a) * r, 170 + v.seed * 30 + Math.sin(t * 0.5 + v.seed) * 8, 700 + Math.sin(a) * r);
      v.bird.rotation.set(0, -a, 0.25);
      const flap = Math.sin(t * 2.2 + v.seed * 5) * 0.25;
      v.wings[0].rotation.x = flap;
      v.wings[1].rotation.x = -flap;
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.textures.forEach((texture) => texture.dispose());
    // Géométries et matériaux : libérés par le parcours de scène de World3D.
  }

  // ─── Sol ──────────────────────────────────────────────────────────────────

  private buildGround() {
    const margin = 520;
    const a = PROLOGUE_AREA;
    const w = a.w + margin * 2;
    const h = a.h + margin * 2;
    const scale = 0.5;
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d')!;
    const ox = a.x - margin;
    const oy = a.y - margin;
    const X = (x: number) => (x - ox) * scale;
    const Y = (y: number) => (y - oy) * scale;
    const rand = sceneryRandom(1702);

    // Sous-bois : humus sombre, taches de feuilles.
    // Sous-bois sombre et froid : le sentier clair et chaud s'en détache nettement.
    ctx.fillStyle = '#262619';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = ['#202517', '#2f2c1c', '#1c2016', '#35301e'][i % 4];
      ctx.globalAlpha = 0.35 + rand() * 0.4;
      ctx.beginPath();
      ctx.arc(rand() * canvas.width, rand() * canvas.height, 4 + rand() * 22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Clairières : herbe à éléphant couchée.
    for (const c of CLEARINGS) {
      const g = ctx.createRadialGradient(X(c.x), Y(c.y), c.r * scale * 0.3, X(c.x), Y(c.y), c.r * scale * 1.1);
      g.addColorStop(0, '#6a6438');
      g.addColorStop(1, '#6a643800');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(X(c.x), Y(c.y), c.r * scale * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    // Sentier : latérite mise à nu par des centaines de pieds, bords irréguliers.
    // Chaque tronçon prend sa vraie largeur praticable : le bord peint est le bord où l'on bute.
    const stroke = (factor: number, color: string, alpha = 1) => {
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < TRAIL.length - 1; i++) {
        ctx.lineWidth = TRAIL_HALVES[i] * 2 * factor * scale;
        ctx.beginPath();
        ctx.moveTo(X(TRAIL[i].x), Y(TRAIL[i].y));
        ctx.lineTo(X(TRAIL[i + 1].x), Y(TRAIL[i + 1].y));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    stroke(1.08, '#140f0b', 0.9); // liseré sombre : la lisière se lit d'un coup d'œil
    stroke(1, '#8e6340');
    stroke(0.55, '#a1724a');
    stroke(0.18, '#7a5234', 0.7);
    // Embranchements (sentiers plus étroits) et ravin du raccourci.
    for (const branch of BRANCHES) {
      ctx.strokeStyle = '#7a5638';
      ctx.lineWidth = branch.half * 1.9 * scale;
      ctx.beginPath();
      branch.points.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.stroke();
    }
    ctx.strokeStyle = '#120d0a';
    ctx.lineWidth = 34 * scale;
    ctx.beginPath();
    ctx.moveTo(X(3460), Y(1372));
    ctx.quadraticCurveTo(X(3570), Y(1390), X(3680), Y(1362));
    ctx.stroke();
    // Ruisseau.
    ctx.lineCap = 'round';
    for (const [width, color] of [[34, '#2c3532'], [22, '#3e4d47'], [8, '#62746a']] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width * scale;
      ctx.beginPath();
      STREAM.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.stroke();
    }
    // Empreintes de pieds nus, toutes vers l'est.
    ctx.fillStyle = '#4c3826';
    for (let i = 0; i < TRAIL.length - 1; i++) {
      const p = TRAIL[i];
      const q = TRAIL[i + 1];
      const angle = Math.atan2(q.y - p.y, q.x - p.x);
      for (let k = 0; k < 70; k++) {
        const u = rand();
        const side = (rand() - 0.5) * TRAIL_HALF * 1.4;
        const x = p.x + (q.x - p.x) * u - Math.sin(angle) * side;
        const y = p.y + (q.y - p.y) * u + Math.cos(angle) * side;
        ctx.globalAlpha = 0.35 + rand() * 0.3;
        ctx.beginPath();
        ctx.ellipse(X(x), Y(y), 2.2, 1, angle, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Herbe brûlée par la poudre.
    for (const s of SCORCHES) {
      const g = ctx.createRadialGradient(X(s.x), Y(s.y), 0, X(s.x), Y(s.y), s.r * scale);
      g.addColorStop(0, '#141110ee');
      g.addColorStop(0.6, '#2a2219aa');
      g.addColorStop(1, '#2a221900');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(X(s.x), Y(s.y), s.r * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    // Sang séché sous les corps, discret.
    for (const b of BODIES) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#3a1812';
      ctx.beginPath();
      ctx.ellipse(X(b.x + 3), Y(b.y + 2), 6 + rand() * 4, 3 + rand() * 3, b.yaw, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Parois de la gorge et de la montée : roche latéritique, plus claire que le sous-bois.
    for (let py = 0; py < canvas.height; py += 6) {
      for (let px = 0; px < canvas.width; px += 6) {
        const wx = ox + px / scale;
        const wz = oy + py / scale;
        const relief = terrainHeight(wx, wz) - pathHeight(wx, wz);
        if (relief < 34) continue;
        ctx.globalAlpha = Math.min(1, (relief - 34) / 40);
        ctx.fillStyle = ['#5e4a3c', '#6b5444', '#544438'][(px + py) % 3];
        ctx.fillRect(px, py, 6, 6);
      }
    }
    ctx.globalAlpha = 1;

    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.push(texture);
    // Sol en relief : le sentier monte, talus, parois et vallée l'entourent.
    const segX = Math.round(w / 18);
    const segY = Math.round(h / 18);
    const plane = new T.PlaneGeometry(w, h, segX, segY);
    const pos = plane.attributes['position'] as T.BufferAttribute;
    const cx = ox + w / 2;
    const cz = oy + h / 2;
    const tint = new Float32Array(pos.count * 3);
    const ember = new T.Color('#e0603a');
    const white = new T.Color('#ffffff');
    const c = new T.Color();
    for (let i = 0; i < pos.count; i++) {
      const wx = cx + pos.getX(i);
      const wz = cz - pos.getY(i);
      const hgt = terrainHeight(wx, wz);
      pos.setZ(i, hgt);
      // Parois hautes : roche grise ; fond de la vallée : rougeoiement des incendies.
      c.copy(white);
      if (hgt < -40) c.lerp(ember, Math.min(0.8, (-hgt - 40) / 160));
      c.toArray(tint, i * 3);
    }
    plane.setAttribute('color', new T.BufferAttribute(tint, 3));
    plane.computeVertexNormals();
    const ground = new T.Mesh(plane, this.mat(new T.MeshStandardMaterial({
      map: texture, roughness: 1, flatShading: true, vertexColors: true,
    })));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, 0.05, cz);
    this.root.add(ground);
  }

  // ─── Forêt ───────────────────────────────────────────────────────────────

  private buildForest(material: T.Material) {
    const trunkGeo = merge([[cyl(0.55, 1, 1, 6), C.trunk, m4(0, 0.5, 0)]]);
    const trunks = new T.InstancedMesh(trunkGeo, material, FOREST.length);
    const crownGeo = merge([[ball(1, 0), '#ffffff', m4()]]);
    const crowns = new T.InstancedMesh(crownGeo, this.mat(new T.MeshStandardMaterial({ flatShading: true, roughness: 0.95 })),
      FOREST.length * 3);
    const color = new T.Color();
    const o = this.tmp;
    FOREST.forEach((tree, i) => {
      const trunkHeight = tree.height * 0.8;
      const base = terrainHeight(tree.x, tree.y) - 2;
      o.position.set(tree.x, base, tree.y);
      o.rotation.set(0, tree.seed, 0);
      o.scale.set(tree.r, trunkHeight, tree.r);
      o.updateMatrix();
      trunks.setMatrixAt(i, o.matrix);
      for (let k = 0; k < 3; k++) {
        const spread = tree.r * 1.4;
        o.position.set(tree.x + Math.cos(tree.seed + k * 2.1) * spread, base + tree.height * (0.62 + k * 0.13),
          tree.y + Math.sin(tree.seed + k * 2.1) * spread);
        const s = tree.r * (3.2 - k * 0.5);
        o.scale.set(s, s * 0.62, s);
        o.rotation.set(0, tree.seed * 3 + k, 0);
        o.updateMatrix();
        crowns.setMatrixAt(i * 3 + k, o.matrix);
        crowns.setColorAt(i * 3 + k, color.set(C.leaves[(tree.seed + k) % C.leaves.length]));
      }
    });
    this.root.add(trunks, crowns);

    // Broussailles et palmiers à huile sur la lisière du sentier.
    const rand = this.random;
    const edge: PropSpot[] = [];
    for (let i = 0; i < TRAIL.length - 1; i++) {
      const p = TRAIL[i];
      const q = TRAIL[i + 1];
      const nx = -(q.y - p.y);
      const ny = q.x - p.x;
      const len = Math.hypot(nx, ny);
      for (let k = 0; k < 8; k++) {
        const u = rand();
        const side = (rand() < 0.5 ? -1 : 1) * (TRAIL_HALF + 6 + rand() * 30);
        const x = p.x + (q.x - p.x) * u + nx / len * side;
        const y = p.y + (q.y - p.y) * u + ny / len * side;
        if (CLEARINGS.some((c) => Math.hypot(x - c.x, y - c.y) < c.r)) continue;
        edge.push({ x, y, yaw: rand() * 6, variant: Math.floor(rand() * 4) });
      }
    }
    const bushes = new T.InstancedMesh(merge([[ball(1, 0), C.bush, m4(0, 0.4, 0, 0, 0, 0, 1, 0.7, 1)]]), material, edge.length);
    edge.forEach((b, i) => {
      o.position.set(b.x, terrainHeight(b.x, b.y) - 1, b.y);
      o.rotation.set(0, b.yaw, 0);
      o.scale.setScalar(8 + b.variant * 3);
      o.updateMatrix();
      bushes.setMatrixAt(i, o.matrix);
    });
    this.root.add(bushes);

    const palms = edge.filter((_, i) => i % 5 === 0);
    const palmParts: Part[] = [[cyl(1.1, 1.6, 70, 6), C.trunk, m4(0, 35, 0)]];
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      palmParts.push([cyl(0.2, 2.2, 34, 3), C.palm,
        m4(Math.cos(a) * 14, 66, Math.sin(a) * 14, 0, -a, -(Math.PI / 2 + 0.45), 1, 1, 0.25)]);
    }
    const palmMesh = new T.InstancedMesh(merge(palmParts), material, palms.length);
    palms.forEach((p, i) => {
      o.position.set(p.x, terrainHeight(p.x, p.y) - 1, p.y);
      o.rotation.set(0, p.yaw, (p.variant - 1.5) * 0.06);
      o.scale.setScalar(0.85 + p.variant * 0.1);
      o.updateMatrix();
      palmMesh.setMatrixAt(i, o.matrix);
    });
    this.root.add(palmMesh);

    // Tronc couché du réveil (Kwadwo y a été tiré à l'abri).
    const fallen = new T.Mesh(merge([
      [cyl(9, 11, FALLEN_TRUNK.length, 7), C.trunk, m4(0, 0, 0, 0, 0, Math.PI / 2)],
      [cyl(2, 3, 26, 5), C.trunk, m4(20, 8, 9, 0.9, 0, 0.5)],
      [ball(14, 0), C.leaves[2], m4(-FALLEN_TRUNK.length / 2 - 8, 4, 0, 0, 0, 0, 1, 0.6, 1.1)],
    ]), material);
    fallen.position.set(FALLEN_TRUNK.x, 8, FALLEN_TRUNK.y);
    fallen.rotation.y = -FALLEN_TRUNK.yaw;
    this.root.add(fallen);
  }

  // ─── Traces du combat ─────────────────────────────────────────────────────

  /**
   * Mort du champ de bataille : le même corps humain que les vivants
   * (human-body.ts), posé puis cuit en géométrie statique. Asante : pagne
   * indigo sous le batakari à talismans ; Denkyira : pagne rouille,
   * ceinture et bandoulière de poudre.
   */
  private body(denkyira: boolean, curled: boolean, badu = false): T.BufferGeometry {
    const parts = bakeHuman({
      skin: C.skin,
      outfit: (m) => denkyira ? soldierOutfit(m, 'tireur', m(C.denkyira)) : plainOutfit(m, C.indigo),
      // Badu garde son batakari indigo de porte-glaive (même tenue qu'en combat).
      smock: badu ? { cloth: '#273047', trim: '#7a2a1c', charm: '#2b1b12', red: '#93301f' }
        : denkyira ? undefined : { cloth: C.asanteSmock, trim: C.indigo, charm: C.talisman, red: C.talismanRed },
      pose: curled
        ? (rig) => {
          rig.torso.rotation.x = 0.55;
          rig.legs[0].rotation.x = -1.25;
          rig.legs[1].rotation.x = -1.0;
          rig.arms[0].rotation.set(-1.1, 0, 0.2);
          rig.arms[1].rotation.set(-0.8, 0, -0.1);
        }
        : (rig) => {
          rig.arms[0].rotation.z = -0.7;
          rig.arms[1].rotation.set(-0.2, 0, 1.1);
          rig.legs[0].rotation.z = -0.12;
          rig.legs[1].rotation.z = 0.18;
          rig.torso.children[3].rotation.y = 0.5;
        },
      place: curled ? LYING_ON_SIDE : LYING_ON_BACK,
    });
    if (denkyira) {
      // Ceinture de poudre : petites gourdes de cuir (le long du corps couché).
      for (const z of [-1.6, -0.5, 0.6, 1.7]) parts.push([ball(0.55, 0), C.leather, (curled ? LYING_ON_SIDE : LYING_ON_BACK).clone().multiply(m4(z, 17.4, 1.9))]);
    }
    return merge(parts);
  }

  private scatter(geometry: T.BufferGeometry, material: T.Material, spots: readonly PropSpot[],
    place: (spot: PropSpot, o: T.Object3D) => void) {
    const mesh = new T.InstancedMesh(geometry, material, Math.max(1, spots.length));
    mesh.count = spots.length;
    spots.forEach((spot, i) => {
      this.tmp.position.set(spot.x, terrainHeight(spot.x, spot.y), spot.y);
      this.tmp.rotation.set(0, spot.yaw, 0);
      this.tmp.scale.setScalar(1);
      place(spot, this.tmp);
      this.tmp.updateMatrix();
      mesh.setMatrixAt(i, this.tmp.matrix);
    });
    this.root.add(mesh);
    return mesh;
  }

  private buildBattle(material: T.Material) {
    for (const denkyira of [false, true]) {
      for (const curled of [false, true]) {
        const spots = BODIES.filter((b) => (b.variant % 2 === 1) === denkyira && (b.variant >= 2) === curled);
        this.scatter(this.body(denkyira, curled), material, spots, () => undefined);
      }
    }
    // Kwasi, à côté du réveil : sur le dos, la lance brisée en travers.
    const kwasi = REMAINS[0];
    this.scatter(this.body(false, false), material, [{ x: kwasi.x, y: kwasi.y, yaw: 2.6, variant: 0 }], () => undefined);

    const spear = merge(builderParts(buildSpear(), m4(0, 16, 0, 0, 0, 0, 0.85, 0.85, 0.85)));
    this.scatter(spear, material, SPEARS, (s, o) => {
      if (s.variant < 2) {
        // Plantée, penchée, la pointe vers le ciel.
        o.position.y = -6;
        o.rotation.set(0.35 + s.variant * 0.2, s.yaw, 0.2);
      } else {
        // Couchée, parfois brisée (raccourcie).
        o.position.y = 0.6;
        o.rotation.set(Math.PI / 2, s.yaw, 0);
        o.scale.set(1, s.variant === 3 ? 0.55 : 1, 1);
      }
    });
    const musket = merge(builderParts(buildMusket(), m4(0, 0, 0, 0, 0, -Math.PI / 2, 1.1, 1.1, 1.1)));
    this.scatter(musket, material, MUSKETS, (s, o) => {
      o.position.y = 1;
      o.rotation.set(0, s.yaw, s.variant === 3 ? 0.6 : 0);
    });
    const blade = merge(builderParts(buildSword(), m4(0, 0, 0, 0, 0, -Math.PI / 2)));
    this.scatter(blade, material, BLADES, (s, o) => { o.position.y = 0.4; o.rotation.set(0, s.yaw, 0.05); });
    const bowTransform = new T.Matrix4().makeRotationFromEuler(new T.Euler(Math.PI / 2, Math.PI / 2, 0))
      .scale(new T.Vector3(1.1, 1.1, 1.1));
    const bowParts = builderParts(buildBow(), bowTransform);
    bowParts.push([cyl(0.12, 0.12, 1, 3), C.bone, bowTransform.clone().multiply(
      m4(0, WEAPON_DIMENSIONS.bow.tipY, 0, Math.PI / 2, 0, 0, 1, WEAPON_DIMENSIONS.bow.tipZ * 2, 1))]);
    const bow = merge(bowParts);
    this.scatter(bow, material, BOWS, (s, o) => { o.position.y = 0.5; o.rotation.set(0, s.yaw, 0); });
    const keg = merge([
      [cyl(4, 4.4, 7, 8), C.darkWood, m4(0, 3.5, 0)],
      [cyl(4.1, 4.1, 0.8, 8), C.iron, m4(0, 5.6, 0)],
      [box(1.4, 8, 0.6), C.darkWood, m4(7, 0.4, 2, Math.PI / 2, 0, 0.3)],
    ]);
    this.scatter(keg, material, KEGS, (s, o) => {
      if (s.variant % 2) { o.rotation.set(Math.PI / 2, s.yaw, 0); o.position.y = 0; }
    });
    const litter = [
      merge([[ball(1.8, 1), C.gourd, m4(0, 1.4, 0, 0, 0, 0, 1, 0.8, 1)], [cyl(0.4, 0.5, 1.6, 5), C.gourd, m4(0, 3, 0)]]),
      merge([[box(4, 0.5, 1.7), C.leather, m4(0, 0.3, 0)], [box(4, 0.5, 1.7), C.leather, m4(1, 0.3, 2.6, 0, 0.3, 0)]]),
      merge([[new T.TorusGeometry(3.2, 0.5, 4, 10), C.leather, m4(0, 0.4, 0, Math.PI / 2, 0, 0, 1, 1, 0.5)]]),
      merge([[cyl(0.35, 0.35, 12, 5), C.wood, m4(0, 0.5, 0, Math.PI / 2, 0, 0)], [new T.ConeGeometry(0.9, 3, 4), C.iron, m4(0, 0.5, 7, Math.PI / 2, 0, 0)]]),
    ];
    litter.forEach((geometry, kind) => this.scatter(geometry, material, LITTER.filter((l) => l.variant === kind), () => undefined));

    // Braises qui couvent sur la ligne de fusiliers.
    const points: number[] = [];
    const rand = this.random;
    for (const s of SCORCHES) {
      if (Math.hypot(s.x - 4700, s.y - 700) > 220) continue;
      for (let k = 0; k < 8; k++) points.push(s.x + (rand() - 0.5) * s.r, 0.8, s.y + (rand() - 0.5) * s.r);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(points, 3));
    this.embers = new T.Points(geometry, this.mat(new T.PointsMaterial({
      color: '#ff7a2e', size: 2.2, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    })));
    this.embers.userData['bloom'] = true;
    this.root.add(this.embers);
  }

  /** Badu Ofosu tombé face contre terre, son afena à côté de lui. */
  private buildCorpse(material: T.Material) {
    const group = new T.Group();
    const body = new T.Mesh(this.body(true, false, true), material);
    body.scale.setScalar(1.12);
    body.rotation.x = Math.PI;
    body.position.y = 4.2;
    // Afena (≈ 1 m) : poignée sombre, lame large et claire, posée à plat.
    const sword = new T.Mesh(merge([
      [cyl(0.55, 0.55, 5, 6), C.darkWood, m4(-2.5, 0.6, 0, 0, 0, Math.PI / 2)],
      [box(14, 0.25, 2.2), C.iron, m4(7, 0.4, 0.3)],
    ]), material);
    sword.position.set(6, 0, 12);
    sword.rotation.y = 0.5;
    group.add(body, sword);
    group.visible = false;
    this.root.add(group);
    return group;
  }

  // ─── Tambours, plateau d'awalé ───────────────────────────────────────────

  private buildLandmarks(material: T.Material) {
    // Paire d'atumpan : grands tambours sculptés sur leur support, l'un renversé.
    const drum = (height: number) => merge([
      [cyl(4.2, 2.6, height, 10), C.darkWood, m4(0, height / 2, 0)],
      [cyl(4.3, 4.3, 0.6, 10), C.bone, m4(0, height, 0)],
      [cyl(4.4, 4.4, 1.2, 10), C.wood, m4(0, height * 0.25, 0)],
      [cyl(4.4, 4.4, 1.2, 10), C.wood, m4(0, height * 0.7, 0)],
    ]);
    const standing = new T.Mesh(drum(18), material);
    standing.position.set(5150, terrainHeight(5150, 430), 430);
    standing.rotation.z = 0.08;
    const fallen = new T.Mesh(drum(16), material);
    fallen.position.set(5176, 4.4, 416);
    fallen.rotation.set(0, 0.7, Math.PI / 2);
    // Cor de guerre en ivoire (aben) tombé à côté.
    const horn = new T.Mesh(merge([[new T.TorusGeometry(7, 1.1, 5, 8, 1.5), C.bone, m4(0, 0, 0, Math.PI / 2, 0, 0)]]), material);
    horn.position.set(5132, 1, 452);
    // Plateau d'awalé renversé et abri de feuilles écrasé.
    const awale = new T.Mesh(merge([
      [box(14, 2, 5), C.wood, m4(0, 1, 0)],
      ...Array.from({ length: 12 }, (_, i): Part =>
        [cyl(0.9, 0.9, 0.4, 6), C.darkWood, m4(-5.5 + (i % 6) * 2.2, 2.05, i < 6 ? -1.2 : 1.2)]),
    ]), material);
    awale.position.set(5355, terrainHeight(5355, 450), 450);
    awale.rotation.set(0, 0.4, 0.5);
    const seeds = new T.InstancedMesh(merge([[ball(0.5, 0), '#2a2520', m4(0, 0.4, 0)]]), material, 24);
    for (let i = 0; i < 24; i++) {
      this.tmp.position.set(5355 + Math.cos(i * 2.4) * (3 + i * 0.5), 0, 450 + Math.sin(i * 2.4) * (3 + i * 0.5));
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.scale.setScalar(1);
      this.tmp.updateMatrix();
      seeds.setMatrixAt(i, this.tmp.matrix);
    }
    const shelter = new T.Mesh(merge([
      [box(46, 1.2, 30), '#8b7a45', m4(0, 6, 0, 0.25, 0, 0.12)],
      [cyl(0.8, 0.8, 22, 5), C.wood, m4(-18, 8, -12, 0.6, 0, 0.3)],
      [cyl(0.8, 0.8, 22, 5), C.wood, m4(18, 4, 12, -1.1, 0, 0)],
    ]), material);
    shelter.position.set(5345, terrainHeight(5345, 480), 480);
    this.root.add(standing, fallen, horn, awale, seeds, shelter);
  }

  // ─── Feux (foyers du prologue, camp) ───────────────────────────────────────

  private fire(material: T.Material, x: number, y: number, size = 1) {
    const group = new T.Group();
      group.position.set(x, terrainHeight(x, y), y);
    group.add(new T.Mesh(merge([
      ...Array.from({ length: 7 }, (_, i): Part => {
        const a = i / 7 * Math.PI * 2;
        return [new T.DodecahedronGeometry(2.3, 0), '#5f5a48', m4(Math.cos(a) * 7, 1.2, Math.sin(a) * 7)];
      }),
      ...Array.from({ length: 3 }, (_, i): Part => [cyl(0.9, 0.9, 11, 5), C.trunk, m4(0, 2.2, 0, Math.PI / 2 - 0.35, i * 2.1, 0)]),
    ]), material));
    const flame = new T.Mesh(new T.ConeGeometry(3.6, 11, 6),
      this.mat(new T.MeshBasicMaterial({ color: '#ff8a3c', transparent: true, opacity: 0.88, depthWrite: false })));
    flame.position.y = 7;
    flame.userData['bloom'] = true;
    group.add(flame);
    group.scale.setScalar(size);
    this.flames.push(flame);
    this.root.add(group);
  }

  /** Braseros rituels (autel de mémoire, crête) : coupe sur trépied, cauris, calabasse d'eau. */
  private buildFires(material: T.Material) {
    for (const foyer of Object.values(PROLOGUE_FOYERS)) {
      const group = new T.Group();
      group.position.set(foyer.x, terrainHeight(foyer.x, foyer.y), foyer.y);
      group.add(new T.Mesh(merge([
        [cyl(5.5, 3.2, 3.5, 9), '#4a3a2c', m4(0, 7.5, 0)],
        ...[0, 2.1, 4.2].map((a): Part => [cyl(0.5, 0.6, 9, 4), C.darkWood, m4(Math.cos(a) * 3.2, 3.5, Math.sin(a) * 3.2, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3)]),
        ...Array.from({ length: 14 }, (_, i): Part => {
          const a = i / 14 * Math.PI * 2;
          return [ball(0.7, 0), '#efe6cf', m4(Math.cos(a) * 9, 0.3, Math.sin(a) * 9, 0, 0, 0, 1.2, 0.5, 0.8)];
        }),
        [ball(2.6, 1), C.gourd, m4(11, 2, 4, 0, 0, 0, 1, 0.8, 1)],
        [cyl(2.2, 2.2, 0.3, 8), '#3d5a62', m4(11, 3.6, 4)],
      ]), material));
      const flame = new T.Mesh(new T.ConeGeometry(3.4, 10, 6),
        this.mat(new T.MeshBasicMaterial({ color: '#ff8a3c', transparent: true, opacity: 0.9, depthWrite: false })));
      flame.position.y = 13;
      flame.userData['bloom'] = true;
      group.add(flame);
      this.flames.push(flame);
      this.root.add(group);
    }
  }

  /**
   * Lisibilité : ciel de crépuscule qui rougeoie à l'est, soleil bas derrière
   * la crête (on marche vers la lumière), éperon rocheux de la crête et ses
   * feux visibles de loin, tisons qui balisent le sentier, eau du ruisseau.
   */
  private buildGuidance(material: T.Material) {
    // Ciel propre à la carte (dessiné par-dessus le ciel d'harmattan des actes suivants).
    const radius = 2000;
    const skyGeo = new T.SphereGeometry(radius, 32, 16);
    const pos = skyGeo.attributes['position'] as T.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const zenith = new T.Color('#1d1a24');
    const mid = new T.Color('#5a2f2a');
    const horizon = new T.Color('#b4532c');
    const ground = new T.Color('#2a1d1b');
    const c = new T.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / radius;
      const east = Math.max(0, pos.getX(i) / radius); // plus rouge vers l'est, là où le soleil se couche
      if (h <= 0) c.copy(ground);
      else if (h < 0.18) c.copy(ground).lerp(horizon, h / 0.18);
      else if (h < 0.5) c.copy(horizon).lerp(mid, (h - 0.18) / 0.32);
      else c.copy(mid).lerp(zenith, Math.min(1, (h - 0.5) / 0.4));
      if (h > 0 && h < 0.5) c.lerp(new T.Color('#e0743a'), east * (1 - h * 2) * 0.55);
      else if (h <= 0.5) c.lerp(horizon, 0);
      c.toArray(colors, i * 3);
    }
    skyGeo.setAttribute('color', new T.BufferAttribute(colors, 3));
    const sky = new T.Mesh(skyGeo, this.mat(new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false })));
    sky.position.set(PROLOGUE_CENTER.x, 0, PROLOGUE_CENTER.y);
    sky.renderOrder = -9;
    sky.frustumCulled = false;
    const glowTexture = this.soft();
    const sun = new T.Sprite(this.mat(new T.SpriteMaterial({
      map: glowTexture, color: '#ff7a3a', fog: false, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.9,
    })));
    sun.position.set(PROLOGUE_CENTER.x + 1750, 160, PROLOGUE_CENTER.y - 560);
    sun.scale.setScalar(900);
    sun.renderOrder = -8;
    this.root.add(sky, sun);

    // Éperon rocheux de la crête, derrière l'arène : la silhouette qu'on vise dès le départ.
    const spur = new T.Mesh(merge([
      [new T.DodecahedronGeometry(1, 0), '#3b3530', m4(0, 30, 0, 0, 0, 0, 70, 95, 55)],
      [new T.DodecahedronGeometry(1, 0), '#352f2a', m4(-60, 18, 40, 0, 0.6, 0, 55, 60, 45)],
      [new T.DodecahedronGeometry(1, 0), '#40382f', m4(50, 12, -50, 0, 1.2, 0, 50, 45, 40)],
    ]), material);
    spur.position.set(PROLOGUE_DUEL.x + 330, terrainHeight(PROLOGUE_DUEL.x + 330, PROLOGUE_DUEL.y - 40), PROLOGUE_DUEL.y - 40);
    this.root.add(spur);
    for (const [dx, y, dz] of [[-10, 132, 0], [-70, 82, 40], [40, 62, -50]]) {
      const fire = new T.Sprite(this.mat(new T.SpriteMaterial({
        map: glowTexture, color: '#ff8a3c', fog: false, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      })));
      fire.position.set(spur.position.x + dx, y, spur.position.z + dz);
      fire.scale.setScalar(70);
      fire.userData['bloom'] = true;
      this.beacons.push(fire);
      this.root.add(fire);
    }

    // Tisons tombés le long du sentier, tous les ~150 unités, alternés gauche / droite.
    const brandBody = merge([[cyl(0.8, 1, 9, 5), '#1a120d', m4(0, 0.8, 0, Math.PI / 2 - 0.15, 0, 0)]]);
    const spots: { x: number; y: number }[] = [];
    let side = 1;
    for (let i = 0; i < TRAIL.length - 1; i++) {
      const a = TRAIL[i];
      const b = TRAIL[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      for (let d = 70; d < len; d += 150) {
        side = -side;
        const off = TRAIL_HALVES[i] * 0.75 * side;
        spots.push({ x: a.x + (b.x - a.x) * d / len + nx * off, y: a.y + (b.y - a.y) * d / len + ny * off });
      }
    }
    const logs = new T.InstancedMesh(brandBody, material, spots.length);
    spots.forEach((s, i) => {
      this.tmp.position.set(s.x, terrainHeight(s.x, s.y), s.y);
      this.tmp.rotation.set(0, i * 2.3, 0);
      this.tmp.scale.setScalar(1);
      this.tmp.updateMatrix();
      logs.setMatrixAt(i, this.tmp.matrix);
      const glow = new T.Sprite(this.mat(new T.SpriteMaterial({
        map: glowTexture, color: '#ff6a24', transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      })));
      glow.position.set(s.x, 3, s.y);
      glow.scale.setScalar(11);
      glow.userData['bloom'] = true;
      this.brands.push(glow);
      this.root.add(glow);
    });
    this.root.add(logs);

    // Ruisseau : une vraie eau peu profonde, sombre et brillante.
    const water = this.mat(new T.MeshStandardMaterial({
      color: '#2b3a3a', metalness: 0.35, roughness: 0.18, transparent: true, opacity: 0.9,
    }));
    for (let i = 0; i < STREAM.length - 1; i++) {
      const a = STREAM[i];
      const b = STREAM[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const strip = new T.Mesh(new T.PlaneGeometry(len + 14, 24), water);
      strip.rotation.set(-Math.PI / 2, 0, Math.atan2(-(b.y - a.y), b.x - a.x));
      strip.position.set((a.x + b.x) / 2, 0.35, (a.y + b.y) / 2);
      this.root.add(strip);
    }
  }

  /**
   * Finitions : vallée en flammes sous la crête (feux et fumées vus d'en
   * haut), herbes hautes qui ondulent au vent le long du sentier, cendres
   * grises qui tombent et braises qui montent autour du héros, cairn de
   * pierres sur le promontoire.
   */
  private buildAtmosphere(material: T.Material) {
    const rand = sceneryRandom(17011);
    const glow = this.soft();
    // Vallée de Feyiase en flammes : foyers au fond, colonnes de fumée qui montent jusqu'à la crête.
    for (let i = 0; i < 16; i++) {
      const x = 5050 + rand() * 900;
      const lineY = 470 - (x - 5200) * 0.32;
      const y = lineY - 200 - rand() * 260;
      const h = terrainHeight(x, y);
      const fire = new T.Sprite(this.mat(new T.SpriteMaterial({
        map: glow, color: rand() < 0.5 ? '#ff6a24' : '#ff9a3c', transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false,
      })));
      fire.position.set(x, h + 6, y);
      fire.scale.setScalar(40 + rand() * 50);
      fire.userData['bloom'] = true;
      this.valleyFires.push(fire);
      this.root.add(fire);
      if (i % 3 === 0) {
        for (let k = 0; k < 5; k += this.puffs) {
          const sprite = new T.Sprite(this.mat(new T.SpriteMaterial({
            map: glow, color: k % 2 ? '#3a2c28' : '#4a3a32', transparent: true, depthWrite: false, opacity: 0,
          })));
          this.smoke.push({ sprite, base: { x, y }, seed: (k / 5 + i * 0.29) % 1, floor: h });
          this.root.add(sprite);
        }
      }
    }
    // Herbes hautes au vent sur les talus du sentier.
    const blades: number[] = [];
    for (let b = 0; b < 5; b++) {
      const a = b * 2.4;
      const ox = Math.cos(a) * (0.6 + b * 0.5);
      const oz = Math.sin(a) * (0.6 + b * 0.5);
      const height = 6 + rand() * 5;
      const lean = (rand() - 0.5) * 2;
      blades.push(ox - 0.8, 0, oz, ox + 0.8, 0, oz, ox + lean, height, oz + lean * 0.4);
    }
    const tuft = new T.BufferGeometry();
    tuft.setAttribute('position', new T.Float32BufferAttribute(blades, 3));
    tuft.computeVertexNormals();
    const grassMat = this.mat(applyWind(new T.MeshLambertMaterial({ side: T.DoubleSide, color: '#6b6a38' }),
      { anchor: 0, tip: 10, amplitude: 1.6, sway: [1, 0.6], speed: 1.2 }));
    const spots: { x: number; y: number }[] = [];
    for (let i = 0; i < TRAIL.length - 1; i++) {
      const a = TRAIL[i];
      const b = TRAIL[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      for (let k = 0; k < 26; k++) {
        const u = rand();
        const side = (rand() < 0.5 ? -1 : 1) * (TRAIL_HALVES[i] - 6 + rand() * 30);
        spots.push({ x: a.x + (b.x - a.x) * u + nx * side, y: a.y + (b.y - a.y) * u + ny * side });
      }
    }
    const grass = new T.InstancedMesh(tuft, grassMat, spots.length);
    const color = new T.Color();
    spots.forEach((p, i) => {
      this.tmp.position.set(p.x, terrainHeight(p.x, p.y), p.y);
      this.tmp.rotation.set(0, rand() * 6, 0);
      this.tmp.scale.setScalar(0.8 + rand() * 0.9);
      this.tmp.updateMatrix();
      grass.setMatrixAt(i, this.tmp.matrix);
      grass.setColorAt(i, color.set(['#6b6a38', '#7a6e3c', '#55613a', '#8a7a44'][i % 4]));
    });
    this.root.add(grass);
    // Cairn de pierres sur le promontoire : on s'y arrête pour regarder la vallée.
    const cairn = new T.Mesh(merge([
      [new T.DodecahedronGeometry(4, 0), '#6c6650', m4(0, 3, 0, 0, 0, 0, 1.3, 0.8, 1.2)],
      [new T.DodecahedronGeometry(3, 0), '#77705a', m4(0.5, 7.5, 0.3, 0.4, 0.6, 0)],
      [new T.DodecahedronGeometry(2, 0), '#6c6650', m4(-0.2, 10.5, 0, 0, 1, 0.3)],
    ]), material);
    cairn.position.set(LOOKOUT.x - 18, terrainHeight(LOOKOUT.x - 18, LOOKOUT.y - 22), LOOKOUT.y - 22);
    this.root.add(cairn);
    // Cendres qui tombent, braises qui montent, autour du héros (boîte qui le suit).
    const count = 260;
    const ash = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      ash[i * 3] = (rand() - 0.5) * 360;
      ash[i * 3 + 1] = 20 + rand() * 120;
      ash[i * 3 + 2] = (rand() - 0.5) * 360;
      this.moteSeeds.push(rand() * 10);
    }
    const ashGeo = new T.BufferGeometry();
    ashGeo.setAttribute('position', new T.BufferAttribute(ash, 3));
    // Points ronds et petits : vus de près, ils ne deviennent pas des carrés géants.
    this.motes = new T.Points(ashGeo, this.mat(new T.PointsMaterial({
      color: '#9a9088', size: 0.9, map: glow, alphaTest: 0.05, transparent: true, opacity: 0.7, depthWrite: false,
    })));
    const sparks = new Float32Array(60 * 3);
    for (let i = 0; i < 60; i++) {
      sparks[i * 3] = (rand() - 0.5) * 300;
      sparks[i * 3 + 1] = rand() * 120;
      sparks[i * 3 + 2] = (rand() - 0.5) * 300;
    }
    const sparkGeo = new T.BufferGeometry();
    sparkGeo.setAttribute('position', new T.BufferAttribute(sparks, 3));
    this.embersAir = new T.Points(sparkGeo, this.mat(new T.PointsMaterial({
      color: '#ff8a3c', size: 1.1, map: glow, transparent: true, opacity: 0.85, depthWrite: false, blending: T.AdditiveBlending,
    })));
    this.embersAir.userData['bloom'] = true;
    this.motes.frustumCulled = false;
    this.embersAir.frustumCulled = false;
    this.root.add(this.motes, this.embersAir);
  }

  /** La boîte de cendres suit le héros ; chaque point tombe (cendre) ou monte (braise) et revient en boucle. */
  private updateMotes(dt: number) {
    const hero = this.hero();
    if (!hero || !this.motes || !this.embersAir) return;
    const height = terrainHeight(hero.x, hero.y);
    this.motes.position.set(hero.x, height, hero.y);
    this.embersAir.position.set(hero.x, height, hero.y);
    const t = this.time;
    const ash = this.motes.geometry.attributes['position'] as T.BufferAttribute;
    for (let i = 0; i < ash.count; i++) {
      let y = ash.getY(i) - dt * (6 + (i % 5));
      if (y < 0) y += 140;
      ash.setY(i, y);
      ash.setX(i, ash.getX(i) + Math.sin(t * 0.7 + this.moteSeeds[i]) * dt * 5);
    }
    ash.needsUpdate = true;
    const sparks = this.embersAir.geometry.attributes['position'] as T.BufferAttribute;
    for (let i = 0; i < sparks.count; i++) {
      let y = sparks.getY(i) + dt * (10 + (i % 7) * 2);
      if (y > 120) y -= 120;
      sparks.setY(i, y);
      sparks.setX(i, sparks.getX(i) + Math.sin(t * 2 + i) * dt * 8);
    }
    sparks.needsUpdate = true;
  }

  /**
   * Séquences 1 à 4 : charge de porteur renversée, troncs de la ravine,
   * rocher du tireur, autel profané, tronc du raccourci, grand fromager et
   * tambourinaire, rochers de la montée, morts aux pieds de Badu.
   */
  private buildSequences(material: T.Material) {
    const o = this.tmp;
    // Charge de porteur renversée (paniers, ballots) près de l'éclaireur.
    const load = new T.Mesh(merge([
      [cyl(6, 4.5, 6, 8), '#8b6d3e', m4(0, 3, 0, 1.3, 0, 0.3)],
      [box(7, 3, 5), '#6b4a2a', m4(9, 1.5, 4, 0, 0.6, 0)],
      [ball(2, 0), C.gourd, m4(-6, 1.6, 5)],
      [box(14, 1, 1), C.wood, m4(2, 0.6, -6, 0, 0.3, 0)],
    ]), material);
    load.position.set(3830, terrainHeight(3830, 1175), 1175);
    // Troncs brisés de la ravine (couverts contre le tir).
    const stump = merge([[cyl(1, 1.2, 1, 6), C.trunk, m4(0, 0.5, 0)], [cyl(0.4, 1, 0.25, 5), '#6a5a3a', m4(0.3, 1.1, 0, 0.3, 0, 0.2)]]);
    const stumps = new T.InstancedMesh(stump, material, COVER_TRUNKS.length);
    COVER_TRUNKS.forEach((c, i) => {
      o.position.set(c.x, terrainHeight(c.x, c.y), c.y);
      o.rotation.set(0, i * 1.7, 0);
      o.scale.set(c.r, 34 + i * 6, c.r);
      o.updateMatrix();
      stumps.setMatrixAt(i, o.matrix);
    });
    // Rochers : parois de la ravine, rocher du tireur, montée vers la crête.
    const rocks: { x: number; y: number; s: number }[] = [];
    const rand = this.random;
    const flank = (from: number, to: number, count: number) => {
      for (let i = from; i < to; i++) {
        const a = TRAIL[i];
        const b = TRAIL[i + 1];
        const nx = -(b.y - a.y);
        const ny = b.x - a.x;
        const len = Math.hypot(nx, ny);
        for (let k = 0; k < count; k++) {
          const u = rand();
          const side = (rand() < 0.5 ? -1 : 1) * (TRAIL_HALVES[i] + 8 + rand() * 14);
          rocks.push({ x: a.x + (b.x - a.x) * u + nx / len * side, y: a.y + (b.y - a.y) * u + ny / len * side, s: 8 + rand() * 12 });
        }
      }
    };
    flank(2, 4, 16);
    flank(7, 8, 14);
    rocks.push({ x: 4418, y: 790, s: 16 }, { x: 4430, y: 752, s: 13 }, { x: 4392, y: 748, s: 10 });
    const rockMesh = new T.InstancedMesh(merge([[new T.DodecahedronGeometry(1, 0), '#5d5648', m4(0, 0.3, 0, 0, 0, 0, 1, 0.75, 1)]]), material, rocks.length);
    rocks.forEach((r, i) => {
      o.position.set(r.x, terrainHeight(r.x, r.y) - 2, r.y);
      o.rotation.set(rand() * 0.4, rand() * 6, 0);
      o.scale.setScalar(r.s);
      o.updateMatrix();
      rockMesh.setMatrixAt(i, o.matrix);
    });
    // Autel forestier profané : pierre plate renversée, pots brisés, talisman.
    const shrine = new T.Mesh(merge([
      [box(16, 4, 9), '#6c6650', m4(0, 2, 0, 0, 0, 0.18)],
      [cyl(2.2, 1.6, 4, 7), '#8a5a3a', m4(-9, 1, 6, 1.2, 0, 0)],
      [cyl(2, 1.5, 3, 7), '#8a5a3a', m4(8, 1.5, 6, 0, 0, 0.4)],
      [ball(1.4, 0), '#b07a3a', m4(14, 0.8, 13)],
      [box(3, 0.4, 2), '#b5793a', m4(22, 0.4, 18, 0, 0.4, 0)],
    ]), material);
    shrine.position.set(4300, terrainHeight(4300, 605), 605);
    // Tronc du raccourci : debout au bord du ravin, puis couché en travers.
    const trunk = merge([[cyl(5, 6, 96, 7), C.trunk, m4(0, 48, 0)], [ball(14, 0), C.leaves[1], m4(0, 96, 0)]]);
    this.trunkStanding = new T.Mesh(trunk, material);
    this.trunkStanding.position.set(3600, terrainHeight(3600, 1440), 1440);
    this.trunkStanding.rotation.z = 0.12;
    this.trunkBridge = new T.Mesh(merge([[cyl(5, 6, 110, 7), C.trunk, m4(0, 0, 0, Math.PI / 2, 0, 0)]]), material);
    this.trunkBridge.position.set(3582, 4, 1382);
    this.trunkBridge.rotation.y = -0.13;
    // Grand fromager aux contreforts, le tambourinaire adossé, son tambour.
    const kapok = new T.Mesh(merge([
      [cyl(KAPOK.r * 0.6, KAPOK.r, 200, 8), '#6e6252', m4(0, 100, 0)],
      ...Array.from({ length: 5 }, (_, i): Part => [box(2.5, 26, 22), '#6e6252', m4(0, 12, 0, 0, i * 1.26, 0).multiply(m4(0, 0, KAPOK.r))]),
      [ball(60, 0), C.leaves[0], m4(0, 210, 0, 0, 0, 0, 1, 0.45, 1)],
    ]), material);
    kapok.position.set(KAPOK.x, terrainHeight(KAPOK.x, KAPOK.y), KAPOK.y);
    // Le tambourinaire : assis, adossé au fromager, une main sur la plaie, son tambour à côté.
    // Taille réelle d'un homme assis, tourné vers le sentier : on ne peut pas le rater.
    const drummer = new T.Mesh(merge([
      [box(9, 12, 6), C.asanteSmock, m4(0, 9, 0, -0.3, 0, 0)],
      [box(1.6, 0.8, 1.2), C.talismanRed, m4(-2, 11, 3.2, -0.3, 0, 0)],
      [ball(3, 1), C.skin, m4(0, 17.5, -2.4)],
      [box(4.5, 2.4, 13), C.indigo, m4(-2.2, 1.4, 6)],
      [box(4.5, 2.4, 13), C.indigo, m4(2.4, 1.4, 6, 0, -0.15, 0)],
      [box(2.2, 9, 2.2), C.skin, m4(-5.5, 8, 2, 0.9, 0, 0.3)],
      [box(2.2, 9, 2.2), C.skin, m4(5, 9, 1, -0.6, 0, -0.5)],
      [box(5, 4, 1), '#5a1a12', m4(1.5, 8, 3.3, -0.3, 0, 0)],
      [cyl(3.8, 2.4, 12, 9), C.darkWood, m4(10, 6, 4, 0, 0, 0.45)],
      [cyl(3.9, 3.9, 0.4, 9), C.bone, m4(12.6, 11.4, 4, 0, 0, 0.45)],
    ]), material);
    drummer.position.set(DRUMMER.x, terrainHeight(DRUMMER.x, DRUMMER.y), DRUMMER.y);
    drummer.rotation.y = Math.PI + 0.35;
    // Petit feu à côté de lui : il éclaire la scène et attire l'œil depuis le sentier.
    this.fire(material, DRUMMER.fireX, DRUMMER.fireY, 0.8);
    this.root.add(load, stumps, rockMesh, shrine, this.trunkStanding, this.trunkBridge, kapok, drummer);
    // Trois guerriers asante tombés aux pieds de Badu.
    this.scatter(this.body(false, false), material, CREST_FALLEN.filter((b) => b.variant < 2), () => undefined);
    this.scatter(this.body(false, true), material, CREST_FALLEN.filter((b) => b.variant >= 2), () => undefined);
  }

  // ─── Camp de l'arrière-garde ─────────────────────────────────────────────

  private buildCamp(material: T.Material) {
    for (const f of CAMP_FIRES) this.fire(material, f.x, f.y, 1.2);
    // Guerriers debout : batakari à talismans, lance ou mousquet tenu droit.
    const warrior = (musket: boolean) => merge([
      ...bakeHuman({
        skin: C.skin,
        outfit: (m) => plainOutfit(m, C.indigo),
        smock: { cloth: C.asanteSmock, trim: C.indigo, charm: C.talisman, red: C.talismanRed },
        // Arme tenue droite de la main droite, l'autre bras le long du corps.
        pose: (rig) => { rig.arms[1].rotation.set(-0.42, 0, -0.05); rig.arms[0].rotation.z = -0.08; },
      }),
      ...(musket
        ? [
          [cyl(0.45, 0.5, 27, 6), C.iron, m4(3.75, 21, 3.4)],
          [box(3, 1, 1.4), C.darkWood, m4(3.75, 8.5, 3.4)],
        ] as Part[]
        : [
          [cyl(0.45, 0.45, 38, 5), C.wood, m4(3.75, 25, 3.4)],
          [new T.ConeGeometry(1.3, 5, 4), C.iron, m4(3.75, 46.5, 3.4)],
        ] as Part[]),
    ]);
    for (const musket of [false, true]) {
      this.scatter(warrior(musket), material, CAMP_WARRIORS.filter((w) => (w.variant % 2 === 1) === musket), () => undefined);
    }
    // Parasol de chef (kyinie) : sous lui, l'arrière-garde se rassemble. Repère visible de loin.
    const umbrella = new T.Mesh(merge([
      [cyl(0.9, 1.1, 74, 6), C.darkWood, m4(0, 37, 0)],
      [new T.ConeGeometry(24, 9, 12), '#9c3127', m4(0, 74, 0)],
      [cyl(24, 24, 5, 12, ), '#c39a3a', m4(0, 68, 0)],
      [ball(2.4, 0), '#c39a3a', m4(0, 81, 0)],
    ]), material);
    umbrella.position.set(UMBRELLA.x, terrainHeight(UMBRELLA.x, UMBRELLA.y), UMBRELLA.y);
    this.root.add(umbrella);
  }

  // ─── Fumées, repères à examiner, vautours ─────────────────────────────────

  private soft() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, '#ffffffff');
    g.addColorStop(1, '#ffffff00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new T.CanvasTexture(canvas);
    this.textures.push(texture);
    return texture;
  }

  private buildSmoke() {
    const texture = this.soft();
    SMOKES.forEach((base, i) => {
      for (let k = 0; k < 6; k += this.puffs) {
        const sprite = new T.Sprite(this.mat(new T.SpriteMaterial({
          map: texture, color: k % 2 ? '#5d5850' : '#6e675d', transparent: true, depthWrite: false, opacity: 0,
        })));
        this.smoke.push({ sprite, base, seed: (k / 6 + i * 0.37) % 1 });
        this.root.add(sprite);
      }
    });
  }

  private buildGlints() {
    const texture = this.soft();
    for (const remains of REMAINS) {
      const sprite = new T.Sprite(this.mat(new T.SpriteMaterial({
        map: texture, color: '#ffe2a8', transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      })));
      sprite.position.set(remains.x, terrainHeight(remains.x, remains.y) + 4, remains.y);
      sprite.scale.setScalar(7);
      sprite.userData['bloom'] = true;
      this.glints.push({ sprite, id: remains.id });
      this.root.add(sprite);
    }
  }

  private buildVultures(material: T.Material) {
    const wing = new T.BufferGeometry();
    wing.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, -3, 0, 13, 4, 0, 10], 3));
    wing.computeVertexNormals();
    const wingMaterial = this.mat(new T.MeshStandardMaterial({ color: '#1f1a17', side: T.DoubleSide, roughness: 1 }));
    for (let i = 0; i < 5; i++) {
      const bird = new T.Group();
      bird.add(new T.Mesh(merge([[ball(1.6, 0), '#1f1a17', m4(0, 0, 0, 0, 0, 0, 2.4, 0.8, 1)]]), material));
      const left = new T.Mesh(wing, wingMaterial);
      const right = new T.Mesh(wing, wingMaterial);
      right.scale.z = -1;
      bird.add(left, right);
      this.vultures.push({ bird, wings: [left, right], seed: i * 0.73 });
      this.root.add(bird);
    }
  }

  private mat<M extends T.Material>(material: M) {
    this.materials.push(material);
    return material;
  }
}
