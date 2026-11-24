import * as T from 'three';
import { HUTS, ROCKS, TREES, WATER } from '../constants/scenery';
import { VIEWPORT, WORLD } from '../constants/terrain-constant';
import { CROSSING, GATE, VILLAGE_STOPS } from '../constants/village';
import type { DuelArena } from './duel-fog';

interface Point { x: number; y: number }
export interface Actor3D extends Point {
  facingX: number;
  facingY: number;
  state: string;
  phase: number;
  waveRadius?: number;
}

interface Fighter {
  root: T.Group;
  torso: T.Group;
  arms: T.Group[];
  legs: T.Group[];
  walk: number;
}

export class World3D {
  private readonly renderer: T.WebGLRenderer;
  private readonly scene = new T.Scene();
  private readonly camera = new T.PerspectiveCamera(54, VIEWPORT.WIDTH / VIEWPORT.HEIGHT, 2, 1240);
  private readonly ground: T.Mesh<T.PlaneGeometry, T.MeshStandardMaterial>;
  private readonly player: Fighter;
  private readonly duelist: Fighter;
  private readonly veille = new T.Group();
  private readonly claws: T.Mesh[] = [];
  private readonly mist = new T.Group();
  private readonly marker: T.Mesh;
  private readonly wave: T.Mesh<T.RingGeometry, T.MeshBasicMaterial>;
  private readonly projection = new T.Vector3();
  private readonly cameraGoal = new T.Vector3();
  private readonly cameraLook = new T.Vector3();
  private readonly lookGoal = new T.Vector3();
  private readonly cameraArmBase = new T.Vector3();
  private groundSource?: HTMLCanvasElement;
  private arena?: DuelArena;
  private lastFrame = 0;
  private initialized = false;
  private orbit = 0;
  private viewYaw = Math.PI / 2;
  private targetYaw = Math.PI / 2;
  private dragging?: Point;
  private pitch = 0;
  private readonly controller = new AbortController();
  private readonly mistTexture: T.CanvasTexture;
  private readonly mistMaterial: T.SpriteMaterial;
  private focus: Point | null = null;

  constructor(host: HTMLElement) {
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(VIEWPORT.WIDTH, VIEWPORT.HEIGHT, false);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.setClearColor('#827b62');
    const canvas = this.renderer.domElement;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Terrain de jeu en 3D');
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' });
    host.prepend(canvas);

    const { signal } = this.controller;
    canvas.addEventListener('pointerdown', (event) => {
      this.dragging = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    }, { signal });
    canvas.addEventListener('pointermove', (event) => {
      if (this.dragging === undefined) return;
      if (!this.arena) {
        this.orbit -= (event.clientX - this.dragging.x) * 0.008;
        this.pitch = T.MathUtils.clamp(this.pitch + (event.clientY - this.dragging.y) * 0.34, -24, 40);
      }
      this.dragging = { x: event.clientX, y: event.clientY };
    }, { signal });
    const endDrag = () => { this.dragging = undefined; };
    canvas.addEventListener('lostpointercapture', endDrag, { signal });

    this.scene.fog = new T.FogExp2('#93866e', 0.0021);
    this.scene.add(new T.HemisphereLight('#ffdfb0', '#576962', 2.05));
    const sun = new T.DirectionalLight('#ffd3a0', 2.6);
    sun.position.set(-250, 420, -170);
    this.scene.add(sun);
    this.ground = new T.Mesh(new T.PlaneGeometry(WORLD.WIDTH, WORLD.HEIGHT),
      new T.MeshStandardMaterial({ color: '#aa9677', roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(WORLD.WIDTH / 2, 0, WORLD.HEIGHT / 2);
    this.scene.add(this.ground);
    this.makeScenery();
    this.player = this.makeFighter('#253c54', '#aa793f');
    this.duelist = this.makeFighter('#873f30', '#c2a176');
    this.makeVeille();
    this.mistTexture = this.makeMistTexture();
    this.mistMaterial = new T.SpriteMaterial({
      map: this.mistTexture, transparent: true, depthWrite: false, opacity: 0.62,
    });
    for (let i = 0; i < 44; i++) {
      const sprite = new T.Sprite(this.mistMaterial);
      sprite.scale.set(79, 92 + i % 7 * 8, 1);
      this.mist.add(sprite);
    }
    this.mist.visible = false;
    this.scene.add(this.mist);
    this.marker = new T.Mesh(new T.OctahedronGeometry(5), new T.MeshBasicMaterial({ color: '#ffdb82' }));
    this.scene.add(this.marker);
    this.wave = new T.Mesh(new T.RingGeometry(0.86, 1.03, 64),
      new T.MeshBasicMaterial({ color: '#9bd7c6', transparent: true, depthWrite: false, opacity: 0.55 }));
    this.wave.rotation.x = -Math.PI / 2;
    this.scene.add(this.wave);

  }

  get heading() { return this.viewYaw; }

  private material(color: string) {
    return new T.MeshStandardMaterial({ color, roughness: 0.92, flatShading: true });
  }

  private part(parent: T.Group, geometry: T.BufferGeometry, material: T.Material, x: number, y: number, z: number) {
    const mesh = new T.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  private makeFighter(clothColor: string, accentColor: string): Fighter {
    const root = new T.Group();
    const torso = new T.Group();
    torso.position.y = 16;
    root.add(torso);
    const cloth = this.material(clothColor);
    const skin = this.material('#663b2b');
    const accent = this.material(accentColor);
    this.part(torso, new T.CylinderGeometry(5.4, 3.8, 9, 7), cloth, 0, 4, 0);
    this.part(torso, new T.CylinderGeometry(4.4, 5.6, 7, 7), cloth, 0, -2, 0);
    this.part(torso, new T.CylinderGeometry(4.3, 4.4, 1.7, 8), accent, 0, 0.5, 0);
    this.part(torso, new T.SphereGeometry(3.4, 8, 6), skin, 0, 11, 0.5);
    this.part(torso, new T.SphereGeometry(3.1, 7, 5), this.material('#211917'), 0, 12.1, -0.7);
    const arms: T.Group[] = [];
    const legs: T.Group[] = [];
    for (const side of [-1, 1]) {
      const arm = new T.Group();
      arm.position.set(side * 5, 7, 0);
      torso.add(arm);
      arms.push(arm);
      this.part(arm, new T.CylinderGeometry(1.45, 1.13, 8, 6), skin, 0, -3.4, 0);
      this.part(arm, new T.SphereGeometry(1.3, 6, 4), skin, 0, -8.1, 0.5);
      const leg = new T.Group();
      leg.position.set(side * 2.6, 14, 0);
      root.add(leg);
      legs.push(leg);
      this.part(leg, new T.CylinderGeometry(1.65, 1.08, 12, 6), skin, 0, -6.4, 0);
      this.part(leg, new T.BoxGeometry(2.6, 1.7, 4.2), skin, 0, -12.6, 0.9);
    }
    const staff = this.part(arms[1], new T.CylinderGeometry(0.58, 0.78, 36, 7),
      this.material('#775235'), 0, -8.5, 10);
    staff.rotation.x = Math.PI / 2 - 0.18;
    const shadow = this.part(root, new T.CircleGeometry(10, 18),
      new T.MeshBasicMaterial({ color: '#302119', transparent: true, opacity: 0.28, depthWrite: false }),
      0, 0.15, 0);
    shadow.rotation.x = -Math.PI / 2;
    this.scene.add(root);
    return { root, torso, arms, legs, walk: 0 };
  }

  private makeVeille() {
    const stone = this.material('#56645a');
    const shell = this.part(this.veille, new T.IcosahedronGeometry(22, 1), stone, 0, 12, -4);
    shell.scale.set(0.95, 0.57, 1.23);
    const core = this.part(this.veille, new T.IcosahedronGeometry(10, 0),
      new T.MeshStandardMaterial({ color: '#6cd3ba', emissive: '#27756c' }), 0, 9, 7);
    core.scale.set(0.74, 0.65, 1.25);
    for (const side of [-1, 1]) {
      for (let leg = 0; leg < 3; leg++) {
        const mesh = this.part(this.veille, new T.DodecahedronGeometry(7, 0), stone, side * 18, 5, leg * 11 - 13);
        mesh.scale.set(1.48, 0.59, 0.78);
        this.claws.push(mesh);
      }
      const claw = this.part(this.veille, new T.ConeGeometry(6, 19, 5), this.material('#9c9c75'), side * 10, 8, 21);
      claw.rotation.x = Math.PI / 2;
      claw.rotation.z = side * 0.18;
    }
    this.scene.add(this.veille);
  }

  private makeScenery() {
    const trunk = new T.InstancedMesh(new T.CylinderGeometry(1.8, 4.4, 29, 6), this.material('#56402d'), TREES.length);
    const crown = new T.InstancedMesh(new T.IcosahedronGeometry(1, 1), this.material('#698052'), TREES.length * 2);
    const transform = new T.Object3D();
    TREES.forEach(({ x, y, radius }, index) => {
      transform.position.set(x, 14, y);
      transform.scale.setScalar(1);
      transform.updateMatrix();
      trunk.setMatrixAt(index, transform.matrix);
      for (let tier = 0; tier < 2; tier++) {
        transform.position.set(x + tier * 6, 28 + radius * 0.33 + tier * 8, y);
        transform.scale.set(radius * (0.84 - tier * 0.17), radius * 0.63, radius * 0.8);
        transform.updateMatrix();
        crown.setMatrixAt(index * 2 + tier, transform.matrix);
        crown.setColorAt(index * 2 + tier, new T.Color(['#9ba466', '#65794d', '#82915c'][(index + tier) % 3]));
      }
    });
    this.scene.add(trunk, crown);
    const props = new T.Group();
    const adobe = this.material('#a4775a');
    const thatch = this.material('#ae8654');
    for (const [x, y, radius] of HUTS) {
      this.part(props, new T.CylinderGeometry(radius * 0.77, radius * 0.82, 24, 12), adobe, x, 12, y + 5);
      this.part(props, new T.ConeGeometry(radius, 27, 12), thatch, x, 35, y + 5);
    }
    const stone = this.material('#6c6650');
    for (const [x, y] of ROCKS) this.part(props, new T.DodecahedronGeometry(9, 0), stone, x, 4, y);
    const water = new T.MeshStandardMaterial({ color: '#477873', metalness: 0.22, roughness: 0.37 });
    for (const { x, y, w, h } of WATER) {
      this.part(props, new T.BoxGeometry(w, 0.25, h), water, x + w / 2, 0.21, y + h / 2);
    }
    const wood = this.material('#76573d');
    for (let i = 0; i < 13; i++) {
      this.part(props, new T.BoxGeometry(8.4, 1.6, 51), wood, 1264 + i * 8, 0.9, 792);
    }
    this.scene.add(props);
    for (const target of [...VILLAGE_STOPS, GATE, CROSSING]) {
      const witness = this.makeFighter('#695b42', '#ba9c69');
      witness.root.scale.setScalar(0.82);
      witness.root.position.set(target.x + 12, 0, target.y - 16);
      witness.root.rotation.y = Math.PI;
    }
  }

  private makeMistTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const fade = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    fade.addColorStop(0, '#d0d4b8df');
    fade.addColorStop(0.49, '#b8c5b39a');
    fade.addColorStop(1, '#b8c5b300');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    return texture;
  }

  private setArena(arena?: DuelArena) {
    if (arena === this.arena) return;
    this.arena = arena;
    this.mist.visible = !!arena;
    if (!arena) return;
    // Sprites créés une seule fois (matériau partagé) : changer d'arène ne fait
    // que les replacer, sans allocation ni compilation de shader en plein combat.
    this.mist.children.forEach((sprite, i) => {
      const angle = i * Math.PI * 2 / 44;
      sprite.position.set(Math.sin(angle) * arena.radius, 28 + i % 5 * 7, Math.cos(angle) * arena.radius);
    });
    this.mist.position.set(arena.x, 0, arena.y);
  }

  /**
   * Compile tous les shaders et envoie les textures au GPU avant la première
   * image jouée. Sans ça, la première frame (et la première apparition de la
   * Veille, de la vague ou de la brume) gèle le jeu pendant la compilation.
   */
  async warmUp(ground: HTMLCanvasElement) {
    this.setGround(ground);
    const hidden = [this.duelist.root, this.veille, this.mist, this.marker, this.wave].filter((o) => !o.visible);
    hidden.forEach((object) => { object.visible = true; });
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      this.renderer.compile(this.scene, this.camera);
    }
    if (this.ground.material.map) this.renderer.initTexture(this.ground.material.map);
    this.renderer.initTexture(this.mistTexture);
    // Un rendu complet, sans culling, envoie aussi toutes les géométries au GPU
    // et termine la liaison des programmes (l'écran de chargement le masque).
    const culled: T.Object3D[] = [];
    this.scene.traverse((object) => {
      if (object.frustumCulled) {
        object.frustumCulled = false;
        culled.push(object);
      }
    });
    this.renderer.render(this.scene, this.camera);
    culled.forEach((object) => { object.frustumCulled = true; });
    hidden.forEach((object) => { object.visible = false; });
  }

  private setGround(ground: HTMLCanvasElement) {
    if (this.groundSource === ground) return;
    this.groundSource = ground;
    this.ground.material.map?.dispose();
    const texture = new T.CanvasTexture(ground);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    this.ground.material.map = texture;
    this.ground.material.needsUpdate = true;
  }

  private animate(fighter: Fighter, pose: Actor3D, dt: number) {
    const travel = Math.hypot(pose.x - fighter.root.position.x, pose.y - fighter.root.position.z);
    const moving = pose.state === 'moving' || pose.state === 'chase';
    fighter.walk += Math.min(travel, 12) * 0.14;
    fighter.root.position.set(pose.x, 0, pose.y);
    const desired = Math.atan2(pose.facingX, pose.facingY);
    const angle = desired - fighter.root.rotation.y;
    fighter.root.rotation.y += Math.atan2(Math.sin(angle), Math.cos(angle)) * (1 - Math.exp(-25 * dt));
    const stride = moving ? Math.sin(fighter.walk) : 0;
    const strike = pose.state === 'attacking' ? Math.sin(pose.phase * Math.PI) : 0;
    const ready = pose.state === 'windup' ? pose.phase : 0;
    const dash = pose.state === 'rolling' ? Math.sin(pose.phase * Math.PI) : 0;
    fighter.torso.position.y = 16 + Math.abs(stride) * 0.65 - dash * 6;
    fighter.torso.rotation.set(dash * 0.87 - strike * 0.31 + ready * 0.19, strike * 0.55 - ready * 0.49,
      pose.state === 'hurt' ? -0.2 * (1 - pose.phase) : 0);
    fighter.arms[0].rotation.x = -stride * 0.64 - strike * 0.68;
    fighter.arms[1].rotation.set(stride * 0.53 - strike * 1.15 + ready * 1.05, strike * 0.7, -0.14);
    fighter.legs[0].rotation.x = stride * 0.69;
    fighter.legs[1].rotation.x = -stride * 0.69;
  }

  render(
    ground: HTMLCanvasElement, player: Actor3D, enemy: Actor3D | null, duelist: boolean,
    objective: Point | null, arena?: DuelArena,
  ) {
    this.setGround(ground);
    const now = performance.now();
    const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;
    this.setArena(arena);
    this.mist.rotation.y = now * 0.000046;
    this.animate(this.player, player, dt);
    this.duelist.root.visible = !!enemy && duelist;
    this.veille.visible = !!enemy && !duelist;
    if (enemy && duelist) this.animate(this.duelist, enemy, dt);
    if (enemy && !duelist) {
      this.veille.position.set(enemy.x, 0, enemy.y);
      this.veille.rotation.y = Math.atan2(enemy.facingX, enemy.facingY);
      this.claws.forEach((leg, i) => {
        leg.rotation.y = Math.sin(now * 0.022 + i * 2.3) * (enemy.state === 'chase' ? 0.38 : 0.10);
      });
    }
    this.wave.visible = enemy?.waveRadius !== undefined;
    if (enemy?.waveRadius !== undefined) {
      this.wave.position.set(enemy.x, 1.5, enemy.y);
      this.wave.scale.set(enemy.waveRadius, enemy.waveRadius, 1);
      this.wave.material.opacity = 0.68 - enemy.phase * 0.36;
    }
    this.marker.visible = !!objective;
    if (objective) {
      this.marker.position.set(objective.x, 24 + Math.sin(now / 250) * 2, objective.y);
      this.marker.rotation.y = now / 790;
    }
    this.focus = objective;
    this.updateCamera(player, enemy, dt);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(player: Actor3D, enemy: Point | null, dt: number) {
    if (enemy) {
      this.targetYaw = Math.atan2(enemy.x - player.x, enemy.y - player.y);
      this.orbit = this.targetYaw;
    } else if (!this.initialized) {
      this.orbit = Math.atan2(player.facingX, player.facingY);
      this.targetYaw = this.orbit;
    } else {
      this.targetYaw = this.orbit;
    }
    const distance = enemy ? Math.hypot(enemy.x - player.x, enemy.y - player.y) : 0;
    const difference = this.targetYaw - this.viewYaw;
    const turn = Math.atan2(Math.sin(difference), Math.cos(difference));
    if (!this.initialized) {
      this.viewYaw = this.targetYaw;
    } else if (enemy) {
      // Verrouillage : quand les combattants sont au contact, la ligne
      // joueur→ennemi pivote très vite. On ralentit alors la caméra et on
      // plafonne sa vitesse angulaire pour éviter les coups de fouet.
      const closeness = T.MathUtils.smoothstep(distance, 22, 140);
      const rate = T.MathUtils.lerp(1.4, 6, closeness);
      const maxSpeed = T.MathUtils.lerp(1.6, 3.4, closeness);
      const step = turn * (1 - Math.exp(-rate * dt));
      this.viewYaw += T.MathUtils.clamp(step, -maxSpeed * dt, maxSpeed * dt);
    } else {
      this.viewYaw += turn * (1 - Math.exp(-6.6 * dt));
    }
    const dx = Math.sin(this.viewYaw);
    const dy = Math.cos(this.viewYaw);
    const boom = enemy ? 97 + Math.min(distance, 200) * 0.22 : 104;
    const shoulder = enemy ? 31 : 24;
    this.cameraGoal.set(player.x - dx * boom - dy * shoulder,
      56 + (enemy ? Math.min(distance, 220) * 0.22 : this.pitch),
      player.y - dy * boom + dx * shoulder);
    // Shorten the boom before it reaches a hut when orbiting through the village.
    this.cameraArmBase.set(player.x, 33, player.y);
    for (let fraction = 0.2; fraction < 0.98; fraction += 0.12) {
      const x = T.MathUtils.lerp(player.x, this.cameraGoal.x, fraction);
      const y = T.MathUtils.lerp(33, this.cameraGoal.y, fraction);
      const z = T.MathUtils.lerp(player.y, this.cameraGoal.z, fraction);
      if (HUTS.some(([hx, hz, radius]) => y < 49 &&
          (x - hx) ** 2 + (z - hz - 5) ** 2 < (radius * 0.9) ** 2)) {
        this.cameraGoal.lerp(this.cameraArmBase, 1 - Math.max(0.18, fraction - 0.1));
        break;
      }
    }
    const lead = enemy ? 35 + Math.min(distance, 160) * 0.24 : 36;
    this.lookGoal.set(player.x + dx * lead, 27, player.y + dy * lead);
    if (this.initialized) {
      this.camera.position.lerp(this.cameraGoal, 1 - Math.exp(-10 * dt));
      // Le point visé est lissé lui aussi : les reculs et roulades ne font
      // plus sursauter le cadre.
      this.cameraLook.lerp(this.lookGoal, 1 - Math.exp(-14 * dt));
    } else {
      this.camera.position.copy(this.cameraGoal);
      this.cameraLook.copy(this.lookGoal);
    }
    this.camera.lookAt(this.cameraLook);
    this.initialized = true;
  }

  objectiveOnScreen() {
    if (!this.focus) return null;
    this.projection.set(this.focus.x, 26, this.focus.y).project(this.camera);
    const behind = this.projection.z > 1;
    const x = behind ? -this.projection.x : this.projection.x;
    const y = behind ? -1 : this.projection.y;
    return { x: (x + 1) * 0.5 * VIEWPORT.WIDTH, y: (1 - y) * 0.5 * VIEWPORT.HEIGHT };
  }

  dispose() {
    this.controller.abort();
    this.scene.traverse((object) => {
      if (object instanceof T.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      } else if (object instanceof T.Sprite) object.material.dispose();
    });
    this.ground.material.map?.dispose();
    this.mistMaterial.dispose();
    this.mistTexture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
