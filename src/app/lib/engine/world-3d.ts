import * as T from 'three';
import { HUTS, ROCKS, TREES, WATER } from '../constants/scenery';
import { VIEWPORT, WORLD } from '../constants/terrain-constant';
import { CROSSING, GATE, VILLAGE_STOPS } from '../constants/village';
import type { DuelArena } from './duel-fog';
import { ArenaDressing } from './arena-3d';
import { GuardianRig, animateDuelist } from './boss-rig-3d';
import { BossFx } from './boss-fx-3d';
import { CombatFeel3D } from './combat-feel-3d';
import { PostFx } from './post-fx';
import { CombatFx3D, HitFlash } from './combat-fx-3d';
import type { FxEvent } from '../services/combat-fx.service';
import { CinematicCamera, type CinematicShot, SHOTS } from './cinematic-camera';
import { Equipment3D, type GearLook } from './equipment-3d';
import { buildHumanoid, type HumanoidRig } from './humanoid-rig';
import { PlayerAnimator } from './player-rig-3d';
import { BipedGait, DUELIST_GAIT } from './gait';
import { plantGrass } from './wind';
import { KENTE_PLAYER, adinkraTexture, attachBatakari, attachToga, kenteTexture } from './akan-garments';
import { Landscape3D } from './landscape-3d';
import { addOutlines } from './attack-readability-3d';
import type { WeaponId } from '../constants/equipment.config-constant';

interface Point { x: number; y: number }
export interface Actor3D extends Point {
  facingX: number;
  facingY: number;
  state: string;
  phase: number;
  waveRadius?: number;
  /** Boss : anneaux d'eau actifs, attaque en cours, coup du combo, phase du combat. */
  waveRadii?: number[];
  attack?: string;
  step?: number;
  bossPhase?: number;
  exposed?: boolean;
  /** Boss : lueur émissive du profil de phase (couleur, intensité). */
  glow?: string;
  glowIntensity?: number;
  /** Gel d'impact en cours : l'animation se fige et tremble. */
  hitstop?: boolean;
  /** Vitesse de recul (joueur touché) : oriente la réaction au coup. */
  knockX?: number;
  knockY?: number;
  /** Joueur : type d'esquive en cours et course. */
  dodge?: 'roll' | 'backstep';
  sprint?: boolean;
  /** Invincibilité brève après un coup reçu : le corps clignote. */
  guarded?: boolean;
  /** Ennemi : sursaut du buste (1 → 0) et direction du coup reçu. */
  flinch?: number;
  flinchX?: number;
  flinchY?: number;
  /** Joueur : PV restants (0 → 1), pour la vignette de PV bas. */
  hpRatio?: number;
}

interface Fighter extends HumanoidRig {
  walk: number;
  /** Démarche calée sur la distance (capitaine) : pieds posés, pas lourds. */
  gait?: BipedGait;
  speed?: number;
  bob?: number;
  bobV?: number;
}

export class World3D {
  private readonly renderer: T.WebGLRenderer;
  private readonly scene = new T.Scene();
  private readonly camera = new T.PerspectiveCamera(54, VIEWPORT.WIDTH / VIEWPORT.HEIGHT, 2, 2600);
  private readonly ground: T.Mesh<T.PlaneGeometry, T.MeshStandardMaterial>;
  private readonly player: Fighter;
  private readonly gear: Equipment3D;
  private readonly playerAnim: PlayerAnimator;
  private readonly duelist: Fighter;
  private readonly guardian = new GuardianRig((color) => this.material(color));
  private readonly veille = this.guardian.root;
  private readonly bossFx = new BossFx();
  /** FOV kick, sursaut de l'ennemi, flèches plantées et braises. */
  private readonly feel = new CombatFeel3D();
  private readonly post: PostFx;
  /** Ciel, collines, repères lointains, détails du sol, graybox (landscape-3d.ts). */
  private readonly landscape: Landscape3D;
  /** Échelle de temps du jeu (ralenti sélectif) appliquée aux animations. */
  timeScale = 1;
  /** Avancement 0→1 de l'entrée cinématique du boss (null hors intro). */
  private intro: number | null = null;
  /** Caméra sur spline : entrées de boss, phases, victoire (HUD masqué). */
  private readonly cine = new CinematicCamera();
  private introStarted = false;
  private duelistMaterials?: T.MeshStandardMaterial[];
  private readonly weaponBase = new T.Vector3();
  private readonly weaponTip = new T.Vector3();
  private readonly glintPoint = new T.Vector3();
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
  private readonly arenaDressing: ArenaDressing;
  /** Impacts : éclats, décalques, lumières flash, secousse de caméra. */
  private readonly fx: CombatFx3D;
  private readonly duelistFlash: HitFlash;
  private readonly guardianFlash: HitFlash;
  private fxSource?: { drain(handle: (event: FxEvent) => void): void };
  private readonly handleFx = (event: FxEvent) => this.onFx(event);
  /** Décalage de secousse appliqué à la caméra à l'image précédente. */
  private readonly appliedShake = new T.Vector3();
  /** Couches de scène ajoutées par d'autres systèmes (décor destructible…). */
  private readonly layers: { update(dt: number): void; dispose(): void }[] = [];
  /** Tenues du héros, une seule visible selon l'acte (setHero). */
  private readonly togas: { kwabena: T.Group; ama: T.Group };
  private hero: 'kwabena' | 'ama' | null = null;

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
    this.player = this.makeFighter('#253c54', '#aa793f', true);
    // La lance est la dernière pièce ajoutée au bras droit par makeFighter.
    const spear = this.player.arms[1].children.at(-1);
    this.gear = new Equipment3D(this.scene, this.player.torso, this.player.arms, spear);
    this.playerAnim = new PlayerAnimator(this.scene, this.player, spear!);
    this.duelist = this.makeFighter('#873f30', '#c2a176');
    this.duelist.gait = new BipedGait(DUELIST_GAIT);
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
    // Tenues akan (le pan de pagne et l'herbe ondulent au vent, compilés au warmUp) :
    // pagne kente du héros (Kwabena en 1824 : toge sur l'épaule gauche ; Ama en
    // 1874 : noué sous les bras, foulard de tête), batakari pour le capitaine asafo.
    this.togas = {
      kwabena: attachToga(this.player.torso, kenteTexture(KENTE_PLAYER), 'man'),
      ama: attachToga(this.player.torso, kenteTexture(KENTE_PLAYER), 'woman'),
    };
    this.setHero('ama');
    attachBatakari(this.duelist.torso);
    plantGrass(this.scene);
    // Avant ArenaDressing : il lit la lumière et la brume posées ici comme ambiance de base.
    this.landscape = new Landscape3D(this.scene, this.renderer);
    this.arenaDressing = new ArenaDressing(this.scene, this.renderer, this.camera);
    this.scene.add(this.feel.root);
    this.post = new PostFx(this.renderer, VIEWPORT.WIDTH, VIEWPORT.HEIGHT);
    this.fx = new CombatFx3D(this.scene);
    this.duelistFlash = new HitFlash(this.duelist.root);
    this.guardianFlash = new HitFlash(this.veille);
    // Silhouettes lisibles : contour sombre autour des combattants.
    addOutlines([this.player.root, this.duelist.root, this.veille]);

  }

  get heading() { return this.viewYaw; }

  /** Source des événements d'impact (CombatFxService), vidée à chaque image. */
  setFxSource(source: { drain(handle: (event: FxEvent) => void): void } | undefined) {
    this.fxSource = source;
  }

  /** Nouveau combat : efface éclats, traces et flashs en cours. */
  resetFx() {
    this.fx.reset();
    this.duelistFlash.clear();
    this.guardianFlash.clear();
  }

  private onFx(event: FxEvent) {
    this.fx.handle(event);
    if (event.type === 'hit' && event.target === 'boss') {
      const flash = this.duelist.root.visible ? this.duelistFlash : this.guardianFlash;
      const color = event.material === 'guard' || event.material === 'shell' ? '#ffd9a0'
        : event.material === 'spirit' ? '#d8fffa' : '#ffffff';
      flash.trigger(color, event.material === 'guard' ? 0.55 : 0.95);
    }
  }

  addLayer(create: (scene: T.Scene) => { update(dt: number): void; dispose(): void }) {
    this.layers.push(create(this.scene));
  }

  private material(color: string) {
    return new T.MeshStandardMaterial({ color, roughness: 0.92, flatShading: true });
  }

  private part(parent: T.Group, geometry: T.BufferGeometry, material: T.Material, x: number, y: number, z: number) {
    const mesh = new T.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  /** Humanoïde du rig partagé (joueur, duelliste, villageois : même squelette). */
  private makeFighter(clothColor: string, accentColor: string, bareChest = false): Fighter {
    const rig = buildHumanoid((color) => this.material(color), clothColor, accentColor, { bareChest });
    this.scene.add(rig.root);
    return { ...rig, walk: 0 };
  }

  private makeVeille() {
    this.guardian.hide();
    this.scene.add(this.veille, this.guardian.rings, this.bossFx.root);
    this.bossFx.attachRim(this.duelist.root, 'duelist');
    this.bossFx.attachRim(this.veille, 'guardian');
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
      const witness = this.makeFighter('#695b42', '#ba9c69', true);
      attachToga(witness.torso, adinkraTexture('#7a4a2c'));
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
   * Gardien, de la vague ou de la brume) gèle le jeu pendant la compilation.
   */
  async warmUp(ground: HTMLCanvasElement) {
    this.setGround(ground);
    const hidden = [this.duelist.root, this.veille, this.mist, this.marker, this.wave, ...this.bossFx.warmables, ...this.fx.warmables, ...this.feel.warmables,
      // Habillage des deux arènes (lueurs et poussières en PointsMaterial) : compilé avec
      // l'état final de la scène (brouillard, lumières), pas seulement au constructeur.
      ...this.arenaDressing.warmObjects].filter((o) => !o.visible);
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
    // Variantes de shader du bloom (tampon linéaire, occulteurs noirs, flou).
    this.post.warm(this.scene, this.camera);
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
    const dx = pose.x - fighter.root.position.x;
    const dz = pose.y - fighter.root.position.z;
    const travel = Math.min(Math.hypot(dx, dz), 12);
    const moving = pose.state === 'moving' || pose.state === 'chase';
    fighter.walk += travel * 0.14;
    fighter.root.position.set(pose.x, 0, pose.y);
    const desired = Math.atan2(pose.facingX, pose.facingY);
    const angle = desired - fighter.root.rotation.y;
    fighter.root.rotation.y += Math.atan2(Math.sin(angle), Math.cos(angle)) * (1 - Math.exp(-25 * dt));
    const strike = pose.state === 'attacking' ? Math.sin(pose.phase * Math.PI) : 0;
    const ready = pose.state === 'windup' ? pose.phase : 0;
    const dash = pose.state === 'rolling' ? Math.sin(pose.phase * Math.PI) : 0;

    // Démarche : la phase suit la distance parcourue le long du regard, la
    // jambe d'appui balaie à vitesse constante, le bassin se pose dessus et
    // chaque pas lourd fait plonger le buste (ressort amorti).
    let legL = 0;
    let legR = 0;
    let armL = 0;
    let armR = 0;
    let drop = 0;
    let roll = 0;
    const gait = fighter.gait;
    if (gait && dt > 0) {
      fighter.speed = (fighter.speed ?? 0) + (travel / dt - (fighter.speed ?? 0)) * (1 - Math.exp(-12 * dt));
      const yaw = fighter.root.rotation.y;
      const along = travel > 0 ? (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / Math.hypot(dx, dz) : 0;
      gait.update(moving ? travel * along : 0, moving ? fighter.speed : 0, dt);
      legL = -gait.swing[0];
      legR = -gait.swing[1];
      armL = -gait.swing[1] * 0.75;
      armR = -gait.swing[0] * 0.55;
      drop = -13.45 * (1 - gait.reach);
      if (gait.contact[0] || gait.contact[1]) fighter.bobV = (fighter.bobV ?? 0) - 16 * gait.pace;
      fighter.bobV = (fighter.bobV ?? 0) + (-160 * (fighter.bob ?? 0) - 2 * 0.55 * 12.6 * (fighter.bobV ?? 0)) * dt;
      fighter.bob = (fighter.bob ?? 0) + fighter.bobV * dt;
      // Le poids passe d'une jambe à l'autre : le buste roule vers l'appui.
      roll = (gait.swing[0] - gait.swing[1]) * 0.08 * gait.pace;
      fighter.legs[0].scale.y = 1 - 0.16 * gait.fold[0];
      fighter.legs[1].scale.y = 1 - 0.16 * gait.fold[1];
    } else if (moving) {
      const stride = Math.sin(fighter.walk);
      legL = stride * 0.69;
      legR = -stride * 0.69;
      armL = -stride * 0.64;
      armR = stride * 0.53;
    }
    fighter.root.position.y = drop;
    fighter.torso.position.y = 16 + (fighter.bob ?? 0) - dash * 6;
    fighter.torso.rotation.set(dash * 0.87 - strike * 0.31 + ready * 0.19 + (gait?.pace ?? 0) * 0.08,
      strike * 0.55 - ready * 0.49 + (legL - legR) * 0.08,
      pose.state === 'hurt' ? -0.2 * (1 - pose.phase) : roll);
    fighter.arms[0].rotation.x = armL - strike * 0.68;
    fighter.arms[1].rotation.set(armR - strike * 1.15 + ready * 1.05, strike * 0.7, -0.14);
    fighter.legs[0].rotation.x = legL;
    fighter.legs[1].rotation.x = legR;
  }

  render(
    ground: HTMLCanvasElement, player: Actor3D, enemy: Actor3D | null, duelist: boolean,
    objective: Point | null, arena?: DuelArena,
  ) {
    this.setGround(ground);
    const now = performance.now();
    const realDt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 1 / 60;
    const dt = realDt * this.timeScale;
    this.lastFrame = now;
    this.setArena(arena);
    this.arenaDressing.update(arena, now, dt);
    for (const layer of this.layers) layer.update(dt);
    this.mist.rotation.y = now * 0.000046;
    // La secousse est un décalage pur : on le retire avant que la caméra de
    // jeu ne se recale, pour qu'il ne s'accumule jamais dans son lissage.
    this.camera.position.sub(this.appliedShake);
    this.duelistFlash.restore();
    this.guardianFlash.restore();
    this.fxSource?.drain(this.handleFx);
    this.playerAnim.update(player, dt, now, !!enemy);
    this.gear.applyPose(player);
    // L'arc et la gourde posent les bras directement : l'animateur repart de
    // cette pose ensuite, pour un fondu sans à-coup.
    this.playerAnim.capture();
    this.duelist.root.visible = !!enemy && duelist;
    this.veille.visible = !!enemy && !duelist;
    if (enemy && duelist) {
      this.animate(this.duelist, enemy, dt);
      animateDuelist(this.duelist, enemy, now);
      this.applyGlow(enemy);
      this.feel.applyFlinch(this.duelist.root, this.duelist.torso, enemy);
    }
    if (enemy && !duelist) {
      this.guardian.update(enemy, now);
      this.feel.applyFlinch(this.veille, this.guardian.torso, enemy, 0.6);
    } else this.guardian.hide();
    if (enemy) {
      const flash = duelist ? this.duelistFlash : this.guardianFlash;
      flash.apply(dt, !!enemy.hitstop);
      if (enemy.hitstop) {
        // Gel d'impact : la cible tremble sur place, comme le joueur.
        const body = duelist ? this.duelist.root : this.veille;
        body.position.x += Math.sin(now * 0.93) * 0.8;
        body.position.z += Math.cos(now * 1.37) * 0.8;
      }
    }
    let weapon: { base: T.Vector3; tip: T.Vector3 } | null = null;
    let glint: T.Vector3 | null = null;
    if (enemy && duelist) {
      // Bâton tenu par le bras droit : axe local (0, 0.18, 0.98) autour de (0, -8.5, 10).
      this.duelist.root.updateMatrixWorld(true);
      this.weaponBase.set(0, -10.3, 0.2);
      this.weaponTip.set(0, -5.3, 27.7);
      this.duelist.arms[1].localToWorld(this.weaponBase);
      this.duelist.arms[1].localToWorld(this.weaponTip);
      weapon = { base: this.weaponBase, tip: this.weaponTip };
      glint = this.weaponTip;
    } else if (enemy) {
      glint = this.glintPoint.set(enemy.x + enemy.facingX * 20, 16, enemy.y + enemy.facingY * 20);
    }
    this.bossFx.update(this.intro !== null && this.intro < 0.3 ? null : enemy, duelist ? 'duelist' : 'guardian',
      weapon, glint, now, dt);
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
    const fov = this.feel.updateFov(player, realDt);
    if (!this.cine.active && Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.feel.update(dt);
    this.fx.update(dt, this.camera);
    this.appliedShake.copy(this.fx.shakeOffset);
    this.camera.position.add(this.appliedShake);
    this.landscape.update(this.camera, now);
    this.post.render(this.scene, this.camera, player.hpRatio ?? null, realDt);
  }

  /** Grayboxing (touche G) : gris neutre, grille de 50 unités, collisions. */
  toggleGraybox() {
    return this.landscape.toggleGraybox();
  }

  /** Une flèche qui touche reste plantée dans le boss quelques secondes. */
  stickArrow(duelist: boolean, x: number, y: number, dirX: number, dirY: number) {
    this.feel.stickArrow(duelist ? this.duelist.root : this.veille, x, y, dirX, dirY);
  }

  /** Braises qui couvent au sol après une attaque de feu (ou de poudre). */
  scatterEmbers(x: number, y: number, count: number, radius: number) {
    this.feel.scatterEmbers(x, y, count, radius);
  }

  /** Efface flèches plantées et braises (nouvelle partie, changement de chapitre). */
  clearTraces() {
    this.feel.reset();
  }

  /** Pilote l'entrée cinématique du boss : k de 0 à 1, null pour rendre la main. */
  setIntro(k: number | null) {
    this.intro = k;
  }

  /** Lueur du duelliste selon la phase (braises sous la peau en phases 2 et 3). */
  private applyGlow(enemy: Actor3D) {
    if (!enemy.glow) return;
    if (!this.duelistMaterials) {
      const found = new Set<T.MeshStandardMaterial>();
      this.duelist.root.traverse((o) => {
        if (o instanceof T.Mesh && o.material instanceof T.MeshStandardMaterial) found.add(o.material);
      });
      this.duelistMaterials = [...found];
    }
    // Pulsation lente : la lueur respire, elle ne clignote pas.
    const pulse = 0.85 + 0.15 * Math.sin(performance.now() * 0.004);
    for (const material of this.duelistMaterials) {
      material.emissive.set(enemy.glow);
      material.emissiveIntensity = (enemy.glowIntensity ?? 0) * pulse;
    }
  }

  /** Joue un plan de caméra sur spline ; la caméra de jeu reprend la main ensuite. */
  playCinematic(shot: CinematicShot) {
    this.cine.play(shot);
  }

  /** Changement de phase : demi-tour lent autour du boss, de bas en haut. */
  playPhaseShot(from: Point, boss: () => Point, duration: number) {
    const look = new T.Vector3();
    const at = boss();
    this.cine.play(SHOTS.phaseShift(at, from, duration, () => {
      const p = boss();
      return look.set(p.x, 22, p.y);
    }));
  }

  skipCinematic() {
    this.cine.skip();
  }

  get cinematicActive() { return this.cine.active; }

  /**
   * Entrée du boss : un plan spline par boss (poussée basse sur les pieds,
   * remontée vers le visage), lancé au premier setIntro(k). Retourne true
   * tant que la cinématique pilote seule la caméra.
   */
  private cinematicCamera(player: Actor3D, enemy: Point | null, dt: number) {
    if (this.intro === null) {
      this.introStarted = false;
    } else if (!this.introStarted && enemy) {
      this.introStarted = true;
      // L'intro de GameStateService dure 3,8 s ; la caméra rend la main à 88 %.
      this.cine.play(SHOTS.bossIntro(enemy, player, 3800 * 0.88 * (1 - this.intro)));
    }
    return this.cine.drive(this.camera, dt);
  }

  private updateCamera(player: Actor3D, enemy: Point | null, dt: number) {
    if (this.cinematicCamera(player, enemy, dt)) return;
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
    this.cine.blend(this.camera, this.cameraLook);
    this.initialized = true;
  }

  /** Arme en main et flèches (en vol ou au sol), mises à jour avant render(). */
  /** Héros incarné : Kwabena (acte I, 1824) ou Ama Serwaa (acte II, 1874). */
  setHero(hero: 'kwabena' | 'ama') {
    if (hero === this.hero) return;
    this.hero = hero;
    this.togas.kwabena.visible = hero === 'kwabena';
    this.togas.ama.visible = hero === 'ama';
  }

  setEquipment(weapon: WeaponId, arrows: readonly { x: number; y: number; dirX: number; dirY: number; grounded: boolean }[],
    look?: GearLook) {
    this.gear.setWeapon(weapon);
    if (look) {
      this.gear.setLook(look);
      // Batakari ramassé : il recouvre le haut du pagne (seul le bas dépasse).
      for (const toga of [this.togas.kwabena, this.togas.ama]) {
        for (const part of toga.children) if (part.userData['underBatakari']) part.visible = !look.batakari;
      }
    }
    this.gear.setArrows(arrows);
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
    this.landscape.dispose();
    this.arenaDressing.dispose();
    this.fx.dispose();
    this.feel.dispose();
    this.post.dispose();
    this.layers.forEach((layer) => layer.dispose());
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
