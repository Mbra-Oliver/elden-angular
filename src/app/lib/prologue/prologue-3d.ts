import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sceneryRandom } from '../constants/scenery';
import {
  BLADES, BODIES, BOWS, CAMP_FIRES, CAMP_WARRIORS, CLEARINGS, FALLEN_TRUNK, FOREST, KEGS, LITTER, MUSKETS,
  PROLOGUE_AREA, PROLOGUE_FOYERS, REMAINS, SCORCHES, SMOKES, SPEARS, STREAM, TRAIL, TRAIL_HALF,
  UMBRELLA, type PropSpot, type RemainsId,
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

export class Prologue3D {
  readonly root = new T.Group();
  readonly warmables = [this.root];
  readonly textures: T.Texture[] = [];
  private readonly materials: T.Material[] = [];
  private readonly flames: T.Mesh[] = [];
  private readonly smoke: { sprite: T.Sprite; base: { x: number; y: number }; seed: number }[] = [];
  private readonly glints: { sprite: T.Sprite; id: RemainsId }[] = [];
  private readonly vultures: { bird: T.Group; wings: T.Mesh[]; seed: number }[] = [];
  private embers?: T.Points<T.BufferGeometry, T.PointsMaterial>;
  /** Corps du porte-hache, couché sur la crête après le combat. */
  private readonly corpse: T.Group;
  private time = 0;
  private readonly tmp = new T.Object3D();
  private readonly random = sceneryRandom(91701);

  constructor(
    private readonly scene: T.Scene,
    private readonly active: () => boolean,
    private readonly hasRead: (id: RemainsId) => boolean,
    private readonly championSpot: () => { x: number; y: number; yaw: number } | null = () => null,
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
    this.root.visible = false;
    scene.add(this.root);
  }

  update(dt: number) {
    const on = this.active();
    this.root.visible = on;
    if (!on) return;
    this.time += dt;
    const t = this.time;
    const spot = this.championSpot();
    this.corpse.visible = !!spot;
    if (spot) {
      this.corpse.position.set(spot.x, 0, spot.y);
      this.corpse.rotation.y = spot.yaw - Math.PI / 2;
    }
    this.flames.forEach((flame, i) => {
      const f = 1 + Math.sin(t * 13 + i * 2.1) * 0.12 + Math.sin(t * 7.3 + i) * 0.08;
      flame.scale.set(1 / Math.sqrt(f), f, 1 / Math.sqrt(f));
    });
    for (const puff of this.smoke) {
      const life = (t * 0.05 + puff.seed) % 1;
      puff.sprite.position.set(puff.base.x + life * 70 + Math.sin(puff.seed * 9) * 8, 10 + life * 230, puff.base.y - life * 40);
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
    ctx.fillStyle = '#3f3f27';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = ['#36391f', '#4a4529', '#2f3420', '#514b2c'][i % 4];
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
    const stroke = (width: number, color: string, jitter: number, alpha = 1) => {
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width * scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      TRAIL.forEach((p, i) => {
        const x = X(p.x + (rand() - 0.5) * jitter);
        const y = Y(p.y + (rand() - 0.5) * jitter);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    stroke(TRAIL_HALF * 2.3, '#5a4d30', 30, 0.8);
    stroke(TRAIL_HALF * 1.8, '#755c3e', 18);
    stroke(TRAIL_HALF * 0.9, '#7f5f3e', 10);
    stroke(TRAIL_HALF * 0.4, '#6c4f34', 6, 0.7);
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

    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.push(texture);
    const ground = new T.Mesh(new T.PlaneGeometry(w, h),
      this.mat(new T.MeshStandardMaterial({ map: texture, roughness: 1 })));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(ox + w / 2, 0.05, oy + h / 2);
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
      o.position.set(tree.x, 0, tree.y);
      o.rotation.set(0, tree.seed, 0);
      o.scale.set(tree.r, trunkHeight, tree.r);
      o.updateMatrix();
      trunks.setMatrixAt(i, o.matrix);
      for (let k = 0; k < 3; k++) {
        const spread = tree.r * 1.4;
        o.position.set(tree.x + Math.cos(tree.seed + k * 2.1) * spread, tree.height * (0.62 + k * 0.13),
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
      for (let k = 0; k < 14; k++) {
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
      o.position.set(b.x, 0, b.y);
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
      o.position.set(p.x, 0, p.y);
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

  private body(denkyira: boolean, curled: boolean): T.BufferGeometry {
    const cloth = denkyira ? C.denkyira : C.asanteSmock;
    const parts: Part[] = [
      [box(10, 3.6, 7), cloth, m4(0, 2, 0)],
      [ball(2.6, 1), C.skin, m4(7.8, 2.2, 0)],
      [box(5, 3.2, 7.4), denkyira ? C.denkyira : C.indigo, m4(-6.5, 1.8, 0)],
    ];
    if (denkyira) {
      // Ceinture de poudre : petites gourdes de cuir.
      parts.push([box(1.2, 4, 7.6), C.leather, m4(-3, 2.1, 0)]);
      for (const z of [-3, -1, 1, 3]) parts.push([ball(0.9, 0), C.leather, m4(-3, 4.2, z)]);
    } else {
      // Batakari : talismans de cuir cousus sur la tunique.
      for (const [x, z, c] of [[2, -2, C.talisman], [-1, 2, C.talismanRed], [3, 2.5, C.talisman], [-2, -2.6, C.talismanRed]] as const) {
        parts.push([box(1.6, 0.8, 1.2), c, m4(x, 4, z)]);
      }
    }
    if (curled) {
      parts.push([box(7, 2.4, 2.6), C.skin, m4(-10, 1.3, 1.8, 0, 0.9, 0)]);
      parts.push([box(7, 2.4, 2.6), C.skin, m4(-12, 1.3, -1.5, 0, 0.7, 0)]);
      parts.push([box(8, 2, 2), C.skin, m4(5, 2, 4.5, 0, -0.8, 0)]);
      parts.push([box(8, 2, 2), C.skin, m4(6, 1.6, 2, 0, -1.1, 0)]);
    } else {
      parts.push([box(13, 2.4, 2.6), C.skin, m4(-14, 1.3, 1.8, 0, -0.08, 0)]);
      parts.push([box(13, 2.4, 2.6), C.skin, m4(-14, 1.3, -1.9, 0, 0.12, 0)]);
      parts.push([box(9, 2, 2), C.skin, m4(4, 1.4, 7.5, 0, 0.9, 0)]);
      parts.push([box(9, 2, 2), C.skin, m4(1, 1.4, -7, 0, -0.5, 0)]);
    }
    return merge(parts);
  }

  private scatter(geometry: T.BufferGeometry, material: T.Material, spots: readonly PropSpot[],
    place: (spot: PropSpot, o: T.Object3D) => void) {
    const mesh = new T.InstancedMesh(geometry, material, Math.max(1, spots.length));
    mesh.count = spots.length;
    spots.forEach((spot, i) => {
      this.tmp.position.set(spot.x, 0, spot.y);
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

    const spear = merge([
      [cyl(0.45, 0.45, 34, 5), C.wood, m4(0, 17, 0)],
      [new T.ConeGeometry(1.4, 6, 4), C.iron, m4(0, 37, 0, 0, 0, 0, 1, 1, 0.35)],
    ]);
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
    const musket = merge([
      [cyl(0.45, 0.5, 20, 6), C.iron, m4(0, 0, 0, 0, 0, Math.PI / 2)],
      [box(9, 1.8, 1.3), C.wood, m4(-12, -0.4, 0, 0, 0, -0.12)],
      [box(2, 1, 1), C.iron, m4(-6.5, 0.6, 0.4)],
    ]);
    this.scatter(musket, material, MUSKETS, (s, o) => {
      o.position.y = 1;
      o.rotation.set(0, s.yaw, s.variant === 3 ? 0.6 : 0);
    });
    const blade = merge([
      [cyl(0.5, 0.5, 4, 5), C.leather, m4(-3, 0, 0, 0, 0, Math.PI / 2)],
      [box(12, 0.3, 2.2), C.iron, m4(5, 0, 0, 0, 0, 0, 1, 1, 1)],
      [new T.ConeGeometry(1.1, 3, 4), C.iron, m4(12.4, 0, 0, Math.PI / 2, 0, -Math.PI / 2, 1, 1, 0.2)],
    ]);
    this.scatter(blade, material, BLADES, (s, o) => { o.position.y = 0.4; o.rotation.set(0, s.yaw, 0.05); });
    const bow = merge([[new T.TorusGeometry(10, 0.4, 4, 10, 2.1), C.darkWood, m4(0, 0, 0, Math.PI / 2, 0, 0)]]);
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

  /** Badu Ofosu tombé face contre terre, la hache à côté de lui. */
  private buildCorpse(material: T.Material) {
    const group = new T.Group();
    const body = new T.Mesh(this.body(true, false), material);
    body.scale.setScalar(1.15);
    body.rotation.x = Math.PI;
    body.position.y = 4.2;
    const axe = new T.Mesh(merge([
      [cyl(0.7, 0.85, 44, 6), C.wood, m4(0, 0.8, 0, 0, 0, Math.PI / 2)],
      [box(2, 0.8, 16), C.iron, m4(21, 0.8, 4)],
    ]), material);
    axe.position.set(4, 0, 12);
    axe.rotation.y = 0.5;
    group.add(body, axe);
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
    standing.position.set(5150, 0, 430);
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
    awale.position.set(5440, 0, 412);
    awale.rotation.set(0, 0.4, 0.5);
    const seeds = new T.InstancedMesh(merge([[ball(0.5, 0), '#2a2520', m4(0, 0.4, 0)]]), material, 24);
    for (let i = 0; i < 24; i++) {
      this.tmp.position.set(5440 + Math.cos(i * 2.4) * (3 + i * 0.5), 0, 412 + Math.sin(i * 2.4) * (3 + i * 0.5));
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
    shelter.position.set(5462, 0, 432);
    this.root.add(standing, fallen, horn, awale, seeds, shelter);
  }

  // ─── Feux (foyers du prologue, camp) ───────────────────────────────────────

  private fire(material: T.Material, x: number, y: number, size = 1) {
    const group = new T.Group();
    group.position.set(x, 0, y);
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

  private buildFires(material: T.Material) {
    for (const foyer of Object.values(PROLOGUE_FOYERS)) this.fire(material, foyer.x, foyer.y);
  }

  // ─── Camp de l'arrière-garde ─────────────────────────────────────────────

  private buildCamp(material: T.Material) {
    for (const f of CAMP_FIRES) this.fire(material, f.x, f.y, 1.2);
    // Guerriers debout : batakari à talismans, lance ou mousquet tenu droit.
    const warrior = (musket: boolean) => merge([
      [box(2.6, 13, 2.8), C.indigo, m4(-1.6, 6.5, 0)],
      [box(2.6, 13, 2.8), C.indigo, m4(1.6, 6.5, 0)],
      [box(8.5, 11, 5.2), C.asanteSmock, m4(0, 18, 0)],
      [box(1.6, 0.8, 1.2), C.talismanRed, m4(-2, 20, 2.7)],
      [box(1.6, 0.8, 1.2), C.talisman, m4(2.2, 17, 2.7)],
      [ball(2.7, 1), C.skin, m4(0, 26.5, 0.3)],
      [box(2, 10, 2), C.skin, m4(-5.4, 18, 0, 0, 0, 0.1)],
      [box(2, 10, 2), C.skin, m4(5.4, 18, 1, -0.4, 0, -0.1)],
      musket
        ? [cyl(0.45, 0.5, 27, 6), C.iron, m4(6.5, 22, 3)]
        : [cyl(0.45, 0.45, 38, 5), C.wood, m4(6.5, 22, 3)],
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
    umbrella.position.set(UMBRELLA.x, 0, UMBRELLA.y);
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
      for (let k = 0; k < 6; k++) {
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
      sprite.position.set(remains.x, 4, remains.y);
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
