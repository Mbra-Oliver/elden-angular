import * as T from 'three';
import { HUTS, ROCKS, sceneryRandom, TREES } from '../constants/scenery';
import { WORLD } from '../constants/terrain-constant';
import { groundFree, LANDMARKS, onPath, PALETTE, RUINS } from '../constants/landscape';

/**
 * Ambiance du monde ouvert : lumière, brouillard, ciel, plans de profondeur,
 * repères monumentaux et détails du sol (cailloux, débris, ruines). Tout est construit une fois, dans le
 * constructeur de World3D (avant la compilation des shaders), et presque tout
 * est instancié : ~15 draw calls au total pour le décor ajouté.
 *
 * Le mode graybox (touche G) remplace les matériaux par un gris neutre et
 * superpose une grille de 50 unités et les collisions, pour régler distances,
 * hauteurs et lignes de vue avant les modèles définitifs.
 */
export class Landscape3D {
  private readonly root = new T.Group();
  private readonly sky: T.Mesh;
  private readonly sunGlow: T.Sprite;
  /** Centre de la carte en cours (monde principal, ou prologue à l'est). */
  readonly center = new T.Vector2(WORLD.WIDTH / 2, WORLD.HEIGHT / 2);
  private readonly near: T.Group;
  private readonly far: T.Group;
  private readonly mid: T.Group;
  private readonly smoke: T.Sprite[] = [];
  private readonly textures: T.Texture[] = [];
  private readonly sunDirection = new T.Vector3();
  private graybox?: Graybox;

  constructor(private readonly scene: T.Scene, renderer: T.WebGLRenderer) {
    this.applyLight(renderer);
    this.sky = this.makeSky();
    const glow = this.track(this.softTexture());
    this.sunGlow = new T.Sprite(new T.SpriteMaterial({
      map: glow, color: PALETTE.sun, fog: false, transparent: true, depthWrite: false,
      blending: T.AdditiveBlending, opacity: 0.85,
    }));
    this.sunGlow.scale.setScalar(460);
    this.sunGlow.userData['bloom'] = false;
    this.sunGlow.renderOrder = -9;
    this.root.add(this.sky, this.sunGlow);

    this.root.add(this.makeOuterGround());
    // Trois plans de collines qui suivent plus ou moins la caméra (parallaxe :
    // le plus proche glisse le plus) et pâlissent avec la distance. Tout reste
    // sous la distance d'affichage de la caméra (2600).
    this.near = this.ridge(1500, 40, 125, 0.42, 71);
    this.mid = this.ridge(1850, 110, 250, 0.64, 409);
    this.far = this.ridge(2150, 210, 400, 0.82, 977);
    this.root.add(this.near, this.mid, this.far);
    this.root.add(this.makeDome(), this.makeSmoke(glow));
    this.root.add(this.makeGroundDetail(), this.makeRuins());
    scene.add(this.root);
  }

  /** À chaque image, après le placement de la caméra. */
  update(camera: T.Camera, now: number) {
    const p = camera.position;
    this.sky.position.copy(p);
    this.sunGlow.position.copy(p).addScaledVector(this.sunDirection, 2300);
    // Les anneaux sont construits autour du centre du monde : on les décale
    // vers la carte en cours (prologue à l'est), puis parallaxe autour d'elle.
    const cx = this.center.x - WORLD.WIDTH / 2;
    const cz = this.center.y - WORLD.HEIGHT / 2;
    this.near.position.set(cx + (p.x - this.center.x) * 0.3, 0, cz + (p.z - this.center.y) * 0.3);
    this.mid.position.set(cx + (p.x - this.center.x) * 0.6, 0, cz + (p.z - this.center.y) * 0.6);
    this.far.position.set(cx + (p.x - this.center.x) * 0.85, 0, cz + (p.z - this.center.y) * 0.85);
    const t = now / 1000;
    this.smoke.forEach((puff, i) => {
      const life = (t * 0.035 + i / this.smoke.length) % 1;
      const { x, y, height } = LANDMARKS.smoke;
      puff.position.set(x + life * 220 + Math.sin(i * 2.1) * 30, 40 + life * height, y - life * 90);
      puff.scale.setScalar(120 + life * 360);
      puff.material.opacity = Math.sin(life * Math.PI) * 0.7;
    });
  }

  toggleGraybox() {
    this.graybox ??= new Graybox(this.scene);
    return this.graybox.toggle();
  }

  dispose() {
    this.graybox?.dispose();
    this.textures.forEach((texture) => texture.dispose());
    // Les géométries et matériaux sont libérés par le parcours de scène de World3D.
  }

  // ─── Lumière et brouillard ─────────────────────────────────────────────

  /**
   * Fin d'après-midi : soleil bas et chaud (ombres propres sur les facettes),
   * ciel moins fort pour garder du contraste, brume d'harmattan chaude.
   * ArenaDressing lit ces valeurs comme ambiance de base.
   */
  private applyLight(renderer: T.WebGLRenderer) {
    const hemi = this.scene.children.find((o): o is T.HemisphereLight => o instanceof T.HemisphereLight);
    const sun = this.scene.children.find((o): o is T.DirectionalLight => o instanceof T.DirectionalLight);
    if (hemi) {
      hemi.color.set(PALETTE.hemiSky);
      hemi.groundColor.set(PALETTE.hemiGround);
      hemi.intensity = 1.7;
    }
    if (sun) {
      sun.color.set(PALETTE.sun);
      sun.intensity = 3.1;
      sun.position.set(-400, 260, -240);
      this.sunDirection.copy(sun.position).normalize();
    }
    this.scene.fog = new T.FogExp2(PALETTE.fog, 0.0019);
    renderer.setClearColor(PALETTE.fog);
  }

  private makeSky() {
    const geometry = new T.SphereGeometry(2450, 32, 14);
    const position = geometry.attributes['position'] as T.BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    const zenith = new T.Color(PALETTE.zenith);
    const middle = new T.Color(PALETTE.skyMid);
    const horizon = new T.Color(PALETTE.horizon);
    const fog = new T.Color(PALETTE.fog);
    const color = new T.Color();
    for (let i = 0; i < position.count; i++) {
      const h = position.getY(i) / 2450;
      if (h <= 0) color.copy(fog);
      else if (h < 0.12) color.copy(fog).lerp(horizon, h / 0.12);
      else if (h < 0.4) color.copy(horizon).lerp(middle, (h - 0.12) / 0.28);
      else color.copy(middle).lerp(zenith, Math.min(1, (h - 0.4) / 0.5));
      color.toArray(colors, i * 3);
    }
    geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
    const sky = new T.Mesh(geometry, new T.MeshBasicMaterial({
      vertexColors: true, side: T.BackSide, fog: false, depthWrite: false,
    }));
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    return sky;
  }

  /** Savane hors carte : prolonge le sol jusqu'aux collines, noyée dans la brume. */
  private makeOuterGround() {
    const ground = new T.Mesh(new T.PlaneGeometry(9000, 9000),
      new T.MeshStandardMaterial({ color: PALETTE.savanna[1], roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(WORLD.WIDTH / 2, -0.6, WORLD.HEIGHT / 2);
    return ground;
  }

  /** Couleur déjà mélangée au ciel : la distance se lit sans brouillard. */
  private aerial(color: string, amount: number) {
    return new T.Color(color).lerp(new T.Color(PALETTE.horizon), amount);
  }

  private ridge(radius: number, low: number, high: number, haze: number, seed: number) {
    const random = sceneryRandom(seed);
    const segments = 120;
    const vertices: number[] = [];
    const heights = Array.from({ length: segments }, (_, i) => {
      const a = i / segments * Math.PI * 2;
      const wave = 0.5 + Math.sin(a * 3 + seed) * 0.25 + Math.sin(a * 7.3 + seed * 0.3) * 0.15;
      return low + (high - low) * Math.max(0, Math.min(1, wave + (random() - 0.5) * 0.35));
    });
    for (let i = 0; i < segments; i++) {
      const a0 = i / segments * Math.PI * 2;
      const a1 = (i + 1) / segments * Math.PI * 2;
      const h0 = heights[i];
      const h1 = heights[(i + 1) % segments];
      const r0 = radius + (random() - 0.5) * 80;
      const p = (a: number, r: number, y: number) => [WORLD.WIDTH / 2 + Math.sin(a) * r, y, WORLD.HEIGHT / 2 + Math.cos(a) * r];
      vertices.push(...p(a0, r0, -30), ...p(a1, radius, -30), ...p(a0, r0, h0));
      vertices.push(...p(a1, radius, -30), ...p(a1, radius, h1), ...p(a0, r0, h0));
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({
      color: this.aerial('#4f5a3c', haze), fog: false, side: T.DoubleSide,
    }));
    mesh.frustumCulled = false;
    const group = new T.Group();
    group.add(mesh);
    return group;
  }

  private distant(color: string, haze: number) {
    return new T.MeshStandardMaterial({ color: this.aerial(color, haze), roughness: 1, flatShading: true, fog: false });
  }

  /** Inselberg de granite : un dôme à facettes, lisible à l'horizon est. */
  private makeDome() {
    const { x, y, radius, height } = LANDMARKS.dome;
    const geometry = new T.SphereGeometry(radius, 11, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    const position = geometry.attributes['position'] as T.BufferAttribute;
    const random = sceneryRandom(318);
    for (let i = 0; i < position.count; i++) {
      const k = 0.9 + random() * 0.18;
      position.setXYZ(i, position.getX(i) * k, position.getY(i) * height / radius * k, position.getZ(i) * k);
    }
    geometry.computeVertexNormals();
    const group = new T.Group();
    const dome = new T.Mesh(geometry, this.distant('#8f7c6d', 0.5));
    group.add(dome);
    const shoulder = new T.Mesh(geometry, this.distant('#7d6b5c', 0.55));
    shoulder.scale.set(0.55, 0.5, 0.6);
    shoulder.position.set(-radius * 0.85, 0, radius * 0.5);
    group.add(shoulder);
    group.position.set(x, -10, y);
    return group;
  }

  /** Colonne de fumée de Kumasi, avec la lueur des incendies à sa base. */
  private makeSmoke(glow: T.Texture) {
    const group = new T.Group();
    const puffTexture = this.track(this.softTexture(true));
    for (let i = 0; i < 16; i++) {
      const puff = new T.Sprite(new T.SpriteMaterial({
        map: puffTexture, color: i % 3 ? '#4a4038' : '#5d5248', fog: false, transparent: true, depthWrite: false,
      }));
      this.smoke.push(puff);
      group.add(puff);
    }
    const fire = new T.Sprite(new T.SpriteMaterial({
      map: glow, color: PALETTE.ember, fog: false, transparent: true, depthWrite: false,
      blending: T.AdditiveBlending, opacity: 0.55,
    }));
    fire.scale.set(420, 160, 1);
    fire.position.set(LANDMARKS.smoke.x, 30, LANDMARKS.smoke.y);
    group.add(fire);
    return group;
  }

  // ─── Sol : cailloux, débris ─────────────────────────────────────

  private makeGroundDetail() {
    const group = new T.Group();
    const random = sceneryRandom(2741);
    const transform = new T.Object3D();
    const color = new T.Color();

    // L'herbe animée par le vent est plantée par wind.ts (plantGrass).

    // Cailloux : surtout en lisière de forêt et autour des gros rochers.
    const rockMatrices: T.Matrix4[] = [];
    const rockColors: T.Color[] = [];
    const anchors = [...TREES.map(({ x, y }) => [x, y] as const), ...ROCKS, ...HUTS.map(([x, y, r]) => [x + r, y + r * 0.6] as const)];
    for (let i = 0; i < 420; i++) {
      const [ax, ay] = anchors[Math.floor(random() * anchors.length)];
      const x = ax + (random() - 0.5) * 70;
      const y = ay + (random() - 0.5) * 70;
      if (!groundFree(x, y, 4) || onPath(x, y)) continue;
      const s = 1.4 + random() ** 2 * 4.5;
      transform.position.set(x, s * 0.25, y);
      transform.scale.set(s * (0.9 + random() * 0.5), s * (0.45 + random() * 0.4), s * (0.9 + random() * 0.5));
      transform.rotation.set(random() * 3, random() * 3, random() * 3);
      transform.updateMatrix();
      rockMatrices.push(transform.matrix.clone());
      rockColors.push(color.set(random() < 0.5 ? PALETTE.stone : PALETTE.stoneLight).offsetHSL(0, 0, (random() - 0.5) * 0.06).clone());
    }
    group.add(this.instanced(new T.DodecahedronGeometry(1, 0), rockMatrices, rockColors));

    // Débris laissés par les familles en fuite : bâtons, tessons, planches.
    const debris: T.Matrix4[] = [];
    const debrisColors: T.Color[] = [];
    for (let i = 0; i < 240; i++) {
      const nearVillage = random() < 0.65;
      const x = nearVillage ? 640 + random() * 900 : 360 + random() * 500;
      const y = nearVillage ? 480 + random() * 620 : 180 + random() * 360;
      if (!groundFree(x, y, 3)) continue;
      const stick = random() < 0.55;
      transform.position.set(x, 0.4, y);
      transform.scale.set(stick ? 0.6 : 2 + random() * 2.5, stick ? 0.6 : 0.5, stick ? 6 + random() * 9 : 1.5 + random() * 2);
      transform.rotation.set(0, random() * Math.PI, (random() - 0.5) * 0.3);
      transform.updateMatrix();
      debris.push(transform.matrix.clone());
      debrisColors.push(color.set(stick ? PALETTE.wood : random() < 0.5 ? PALETTE.laterite : PALETTE.banco).clone());
    }
    group.add(this.instanced(new T.BoxGeometry(1, 1, 1), debris, debrisColors));
    return group;
  }

  private makeRuins() {
    const matrices: T.Matrix4[] = [];
    const colors: T.Color[] = [];
    const transform = new T.Object3D();
    const color = new T.Color();
    const random = sceneryRandom(8083);
    for (const block of RUINS) {
      const tint = random() < 0.55 ? PALETTE.laterite : PALETTE.banco;
      transform.position.set(block.x, block.height / 2, block.y);
      // Rotation au sol : l'axe long (x local) suit block.rot dans le plan x/z.
      transform.rotation.set(0, -block.rot, block.fallen ? (random() - 0.5) * 0.3 : 0);
      transform.scale.set(block.length, block.height, block.depth);
      transform.updateMatrix();
      matrices.push(transform.matrix.clone());
      colors.push(color.set(tint).offsetHSL(0, 0, (random() - 0.5) * 0.06).clone());
      if (!block.fallen) {
        // Arête cassée : un ressaut plus étroit sur un côté du mur.
        const c = Math.cos(block.rot);
        const s = Math.sin(block.rot);
        const shift = (random() - 0.5) * block.length * 0.4;
        const cap = 3 + random() * 6;
        transform.position.set(block.x + c * shift, block.height + cap / 2, block.y + s * shift);
        transform.scale.set(block.length * (0.3 + random() * 0.3), cap, block.depth * 0.9);
        transform.updateMatrix();
        matrices.push(transform.matrix.clone());
        colors.push(color.set(PALETTE.lateriteDark).clone());
      }
    }
    const group = new T.Group();
    group.add(this.instanced(new T.BoxGeometry(1, 1, 1), matrices, colors));
    return group;
  }

  private instanced(geometry: T.BufferGeometry, matrices: T.Matrix4[], colors: T.Color[]) {
    const mesh = new T.InstancedMesh(geometry,
      new T.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true }), Math.max(1, matrices.length));
    matrices.forEach((matrix, i) => {
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, colors[i]);
    });
    mesh.count = matrices.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  private softTexture(cloud = false) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const fade = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    fade.addColorStop(0, cloud ? '#ffffffd8' : '#ffffffff');
    fade.addColorStop(cloud ? 0.55 : 0.22, cloud ? '#ffffff80' : '#ffffff70');
    fade.addColorStop(1, '#ffffff00');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    return texture;
  }

  private track<X extends T.Texture>(texture: X) {
    this.textures.push(texture);
    return texture;
  }
}

/** Grayboxing : matériaux gris, grille de 50 unités, collisions dessinées. */
class Graybox {
  private enabled = false;
  private readonly gray = new T.MeshStandardMaterial({ color: '#a3a39e', roughness: 1, flatShading: true });
  private readonly swapped = new Map<T.Mesh, T.Material | T.Material[]>();
  private readonly hidden: T.Object3D[] = [];
  private readonly overlay = new T.Group();
  private background: T.Scene['background'] = null;

  constructor(private readonly scene: T.Scene) {
    const grid = new T.GridHelper(WORLD.WIDTH, WORLD.WIDTH / 50, '#2f3a44', '#6a737a');
    grid.scale.z = WORLD.HEIGHT / WORLD.WIDTH;
    grid.position.set(WORLD.WIDTH / 2, 0.4, WORLD.HEIGHT / 2);
    this.overlay.add(grid);
    const points: number[] = [];
    const circle = (x: number, y: number, r: number) => {
      for (let i = 0; i < 16; i++) {
        const a0 = i / 16 * Math.PI * 2;
        const a1 = (i + 1) / 16 * Math.PI * 2;
        points.push(x + Math.cos(a0) * r, 0.8, y + Math.sin(a0) * r, x + Math.cos(a1) * r, 0.8, y + Math.sin(a1) * r);
      }
    };
    HUTS.forEach(([x, y, r]) => circle(x, y + 5, r * 0.82));
    TREES.forEach(({ x, y, radius }) => circle(x, y + 3, radius * 0.68));
    RUINS.filter((b) => !b.fallen).forEach((b) => {
      const c = Math.cos(b.rot) * b.length / 2;
      const s = Math.sin(b.rot) * b.length / 2;
      points.push(b.x - c, 0.8, b.y - s, b.x + c, 0.8, b.y + s);
    });
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(points, 3));
    this.overlay.add(new T.LineSegments(geometry, new T.LineBasicMaterial({ color: '#d2452c' })));
    this.overlay.visible = false;
    this.overlay.userData['graybox'] = true;
    scene.add(this.overlay);
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) this.enable();
    else this.disable();
    return this.enabled;
  }

  private enable() {
    this.scene.traverse((object) => {
      if (object === this.overlay || object.parent?.userData['graybox']) return;
      if (object instanceof T.Mesh) {
        const material = object.material as T.Material;
        if (object.userData['outline'] || material.transparent || (material as T.MeshBasicMaterial).fog === false) {
          if (object.visible) { object.visible = false; this.hidden.push(object); }
          return;
        }
        this.swapped.set(object, object.material);
        object.material = this.gray;
      } else if ((object instanceof T.Sprite || object instanceof T.Points) && object.visible) {
        object.visible = false;
        this.hidden.push(object);
      }
    });
    this.background = this.scene.background;
    this.scene.background = new T.Color('#8c9196');
    this.overlay.visible = true;
  }

  private disable() {
    this.swapped.forEach((material, mesh) => { mesh.material = material; });
    this.swapped.clear();
    this.hidden.forEach((object) => { object.visible = true; });
    this.hidden.length = 0;
    this.scene.background = this.background;
    this.overlay.visible = false;
  }

  dispose() {
    if (this.enabled) this.disable();
    this.gray.dispose();
  }
}
