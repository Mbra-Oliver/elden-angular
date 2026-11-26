import * as T from 'three';
import { HUTS, ROCKS, TREES, WATER } from '../constants/scenery';
import { VIEWPORT, WORLD } from '../constants/terrain-constant';
import { CROSSING, GATE, VILLAGE_STOPS } from '../constants/village';
import type { DuelArena } from './duel-fog';
import { ArenaDressing, type RegionMood } from './arena-3d';
import { GuardianRig, animateDuelist } from './boss-rig-3d';
import { BossFx, attachHeroRim } from './boss-fx-3d';
import { CombatFeel3D } from './combat-feel-3d';
import { PostFx } from './post-fx';
import { CombatFx3D, HitFlash } from './combat-fx-3d';
import type { FxEvent } from '../services/combat-fx.service';
import { CinematicCamera, type CinematicShot, SHOTS, STORY_SHOTS } from './cinematic-camera';
import { STORY_BEATS, type StoryBeatId, type StoryPoint, type StoryShotContext } from '../narrative/story-beats';
import { Equipment3D, type GearLook } from './equipment-3d';
import { buildHumanoid, type HumanoidRig } from './humanoid-rig';
import { addBodyShape, dressHuman, showBody, type Outfit } from './human-body';
import { kwadwoOutfit, plainOutfit } from './human-outfits';
import { PlayerAnimator } from './player-rig-3d';
import { MartialArts3D, type WeaponProbe } from './martial-arts-3d';
import { BipedGait, DUELIST_GAIT } from './gait';
import { plantGrass } from './wind';
import { KENTE_PLAYER, adinkraTexture, attachBatakari, attachToga, kenteTexture } from './akan-garments';
import { Landscape3D } from './landscape-3d';
import { addOutlines, AttackTelegraph3D } from './attack-readability-3d';
import { Destructibles3D } from './destructibles-3d';
import { Souls3D } from './souls-3d';
import { Slice3D } from '../slice/slice-3d';
import { Prologue3D } from '../prologue/prologue-3d';
import { ChampionGear, animateBadu } from './champion-rig-3d';
import type { BossId } from '../constants/boss-lore';
import type { WeaponId } from '../constants/equipment.config-constant';
import { renderPixelRatio } from '../platform/display';
import { currentSettings, type CameraMode } from '../platform/settings.service';
import { RemotePlayer } from '../pvp/remote-player';
import type { DuelPose } from '../pvp/duel-rules';

interface Point { x: number; y: number }

interface CameraProfile {
  boom: number;
  boomDistance: number;
  vistaBoom: number;
  shoulder: number;
  height: number;
  heightDistance: number;
  vistaHeight: number;
  lookHeight: number;
  lead: number;
  leadDistance: number;
  pitchMin: number;
  pitchMax: number;
  floorClearance: number;
}

const CAMERA_PROFILES: Record<CameraMode, CameraProfile> = {
  wide: {
    boom: 74, boomDistance: 0.16, vistaBoom: 82, shoulder: 22,
    height: 42, heightDistance: 0.16, vistaHeight: 58, lookHeight: 25,
    lead: 30, leadDistance: 0.2, pitchMin: -18, pitchMax: 32, floorClearance: 12,
  },
  // TPS épaule façon Call of Duty Mobile : caméra basse, à hauteur de la tête,
  // décalée à droite ; le regard reste à l'horizon juste devant le héros, qui
  // occupe le bas-centre de l'image avec son arme visible. Plus de vue d'en haut.
  shoulder: {
    boom: 64, boomDistance: 0.04, vistaBoom: 12, shoulder: 13,
    height: 30, heightDistance: 0.02, vistaHeight: 8, lookHeight: 29,
    lead: 52, leadDistance: 0, pitchMin: -20, pitchMax: 20, floorClearance: 8,
  },
};

export interface Actor3D extends Point {
  groundZ?: number;
  facingX: number;
  facingY: number;
  state: string;
  weapon?: WeaponId;
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

/**
 * Couches 3D pilotées par GameStateService. Réexportées ici pour rester dans
 * le chunk paresseux de world-3d (avec three.js) au lieu du bundle initial.
 */
export const GameLayers3D = { Destructibles3D, Slice3D, Souls3D, AttackTelegraph3D, Prologue3D };

export class World3D {
  private readonly renderer: T.WebGLRenderer;
  private readonly scene = new T.Scene();
  private readonly camera = new T.PerspectiveCamera(54, VIEWPORT.WIDTH / VIEWPORT.HEIGHT, 2, 2600);
  private readonly ground: T.Mesh<T.PlaneGeometry, T.MeshStandardMaterial>;
  private readonly player: Fighter;
  private readonly gear: Equipment3D;
  private readonly playerAnim: PlayerAnimator;
  private readonly martial: MartialArts3D;
  private readonly duelist: Fighter;
  private readonly remote: Fighter;
  private readonly remotePlayer = new RemotePlayer();
  private remotePose: DuelPose | null = null;
  private remoteVisible = false;
  /** Habillage et armes du porte-glaive du Denkyira sur le rig du duelliste. */
  private readonly champion: ChampionGear;
  private bossKind: BossId = 'duelist';
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
  /** Sensibilité de la caméra (Paramètres), relue à chaque prise. */
  private dragSensitivity = 1;
  private aimingFactor = 1;
  /** Doigt (ou souris) qui tient la caméra : un seul à la fois, suivi par pointerId. */
  private dragPointer: number | null = null;
  /** Rotation demandée par le geste, appliquée en douceur image par image (amortissement). */
  private pendingYaw = 0;
  private pendingPitch = 0;
  /** Temps passé à courir de côté par rapport à la caméra (recentrage doux). */
  private lateralTime = 0;
  private pitch = 0;
  private cameraMode: CameraMode = currentSettings().cameraMode ?? 'wide';
  /** Secondes depuis le dernier geste de caméra (souris, stick droit). */
  private manualLook = 99;
  /** Recentrage derrière le héros demandé (Q / clic du stick droit). */
  private recenter = false;
  /**
   * Obstacles qui raccourcissent le bras de caméra en plus des cases
   * (troncs et feuillage du prologue), en coordonnées monde (x, z, hauteur).
   */
  cameraBlocker: ((x: number, z: number, y: number) => boolean) | null = null;
  /** Hauteur du sol sous la caméra (relief) : elle passe au-dessus des talus au lieu de rentrer dedans. */
  cameraFloor: ((x: number, z: number) => number) | null = null;
  /** Ennemi verrouillé hors duel (GameStateService) : la caméra le cadre comme un boss. */
  private lockPoint: Point | null = null;
  /** Changement de cible demandé par un geste (souris, doigt, stick droit) : -1 gauche, 1 droite. */
  onLockFlick: ((direction: number) => void) | null = null;
  /** Clic du stick droit : verrouiller / déverrouiller. */
  onLockButton: (() => void) | null = null;
  private flickDrag = 0;
  private flickReady = true;
  private lockPressed = false;
  private readonly lockMarker = new T.Mesh(new T.OctahedronGeometry(1.6, 0),
    new T.MeshBasicMaterial({ color: '#ff5a2e', transparent: true, opacity: 0.85, depthTest: false, fog: false }));
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
  /** Objets cachés des couches ajoutées (addLayer), à rendre visibles pendant warmUp. */
  private readonly layerWarmables: T.Object3D[] = [];
  /** Couches de scène ajoutées par d'autres systèmes (décor destructible…). */
  private readonly layers: { update(dt: number): void; dispose(): void }[] = [];
  /** Tenues du héros, une seule visible selon l'acte (setHero). */
  private readonly togas: { kwabena: T.Group; ama: T.Group };
  private hero: 'kwadwo' | 'kwabena' | 'ama' | null = null;
  /** Corps d'homme (Kwadwo, Kwabena) et de femme (Ama) du joueur. */
  private heroBodies?: { man: T.SkinnedMesh; woman: T.SkinnedMesh };

  constructor(private readonly host: HTMLElement) {
    // Qualité basse : pas d'antialiasing matériel (MSAA), coûteux sur les GPU de téléphone.
    this.renderer = new T.WebGLRenderer({ antialias: currentSettings().quality !== 'low', powerPreference: 'high-performance' });
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
      // Un deuxième doigt sur l'image ne vole pas la caméra au premier.
      if (this.dragPointer !== null) return;
      this.dragPointer = event.pointerId;
      this.dragging = { x: event.clientX, y: event.clientY };
      // Au doigt, plus doux qu'à la souris : un petit écran amplifie le moindre geste.
      this.dragSensitivity = currentSettings().sensitivity * (event.pointerType === 'touch' ? 0.85 : 1);
      try { canvas.setPointerCapture(event.pointerId); } catch { /* pointeur déjà relâché */ }
    }, { signal });
    canvas.addEventListener('pointermove', (event) => {
      if (this.dragging === undefined || event.pointerId !== this.dragPointer) return;
      // Cible verrouillée : un geste latéral franc (souris, doigt) passe à la cible voisine.
      if (this.lockPoint && !this.arena) {
        this.flickDrag += event.clientX - this.dragging.x;
        if (Math.abs(this.flickDrag) > 70) {
          this.onLockFlick?.(Math.sign(this.flickDrag));
          this.flickDrag = 0;
        }
        this.dragging = { x: event.clientX, y: event.clientY };
        return;
      }
      if (!this.arena) {
        const dx = event.clientX - this.dragging.x;
        // Accélération : un grand balayage tourne plus vite (regarder derrière soi d'un geste).
        const boost = 1 + T.MathUtils.clamp((Math.abs(dx) - 6) / 30, 0, 1) * 0.5;
        this.pendingYaw -= dx * 0.008 * this.dragSensitivity * this.aimingFactor * boost;
        this.pendingPitch += (event.clientY - this.dragging.y) * 0.34 * this.dragSensitivity * this.aimingFactor;
        this.manualLook = 0;
        this.recenter = false;
      }
      this.dragging = { x: event.clientX, y: event.clientY };
    }, { signal });
    const endDrag = (event: PointerEvent) => {
      if (event.pointerId !== this.dragPointer) return;
      this.dragging = undefined;
      this.dragPointer = null;
    };
    canvas.addEventListener('pointerup', endDrag, { signal });
    canvas.addEventListener('pointercancel', endDrag, { signal });
    // Rotation du téléphone, plein écran, changement de qualité : nouveau tampon.
    window.addEventListener('resize', () => this.fit(), { signal });
    const observer = new ResizeObserver(() => this.fit());
    observer.observe(host);
    signal.addEventListener('abort', () => observer.disconnect());
    canvas.addEventListener('lostpointercapture', endDrag, { signal });

    this.scene.fog = new T.FogExp2('#8d7f70', 0.0021);
    this.scene.add(new T.HemisphereLight('#b8c8e0', '#5b3a2c', 1.8));
    const sun = new T.DirectionalLight('#ffb066', 2.4);
    sun.position.set(-320, 180, -210);
    this.scene.add(sun);
    this.ground = new T.Mesh(new T.PlaneGeometry(WORLD.WIDTH, WORLD.HEIGHT),
      new T.MeshStandardMaterial({ color: '#aa9677', roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(WORLD.WIDTH / 2, 0, WORLD.HEIGHT / 2);
    this.scene.add(this.ground);
    this.makeScenery();
    // Corps skinné commun (human-body.ts) ; tenue de Kwadwo, cachée sous les toges des autres héros.
    this.player = this.makeFighter('#253c54', '#aa793f', true, kwadwoOutfit((color) => this.material(color)), true);
    // La lance est la dernière pièce ajoutée au bras droit par makeFighter.
    const spear = this.player.arms[1].children.at(-1);
    this.gear = new Equipment3D(this.scene, this.player.torso, this.player.arms, spear);
    if (this.player.body) this.gear.fitBody(this.player.body);
    // Ama Serwaa (1874) : silhouette de femme sur le même squelette (bascule dans setHero).
    if (this.player.body) {
      this.heroBodies = {
        man: this.player.body.meshes.find((m) => m.name === 'human-body')!,
        woman: addBodyShape(this.player.body, 'woman', true),
      };
    }
    this.playerAnim = new PlayerAnimator(this.scene, this.player, spear!);
    // Prise martiale : l'arme quitte le poignet, les deux mains la tiennent par IK.
    this.martial = new MartialArts3D(this.player, spear!);
    this.duelist = this.makeFighter('#873f30', '#c2a176', false, undefined, true);
    this.remote = this.makeFighter('#6c3a2f', '#d0a85f');
    this.remote.root.visible = false;
    this.duelist.gait = new BipedGait(DUELIST_GAIT);
    // Le bâton de Kofi est la dernière pièce du bras droit (buildHumanoid).
    this.champion = new ChampionGear(this.scene, this.duelist, this.duelist.arms[1].children.at(-1));
    this.layerWarmables.push(...this.champion.warmables);
    this.makeVeille();
    // Badu : sa tenue (batakari, pagne) prend aussi le liseré du boss.
    this.champion.setActive(true);
    this.bossFx.attachRim(this.duelist.root, 'duelist');
    this.champion.setActive(false);
    // Liseré du héros : il se détache du sol sombre et de la brume.
    attachHeroRim(this.player.root);
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
    this.lockMarker.renderOrder = 10;
    this.lockMarker.visible = false;
    this.scene.add(this.lockMarker);
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
    // Batakari de Kofi : blouse ajustée au corps skinné (hors corps skinné : l'ancienne pièce).
    if (this.duelist.body) {
      const flat = (color: string) => new T.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true });
      dressHuman(this.duelist.body, {
        smock: { cloth: flat('#d6c6a0'), trim: flat('#2b3a55'), charm: flat('#4a2f1c'), red: flat('#9a2f26') },
      }, true).name = 'akan-batakari';
    } else attachBatakari(this.duelist.torso);
    plantGrass(this.scene);
    // Avant ArenaDressing : il lit la lumière et la brume posées ici comme ambiance de base.
    this.landscape = new Landscape3D(this.scene, this.renderer);
    this.arenaDressing = new ArenaDressing(this.scene, this.renderer, this.camera);
    this.scene.add(this.feel.root);
    this.post = new PostFx(this.renderer, VIEWPORT.WIDTH, VIEWPORT.HEIGHT);
    this.fit();
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

  /**
   * Ajoute une couche de scène. Ses objets cachés (`warmables`) et ses
   * textures sont compilés / envoyés au GPU tout de suite, au chargement,
   * plutôt qu'à leur première apparition en plein combat.
   */
  addLayer(create: (scene: T.Scene) => {
    update(dt: number): void; dispose(): void; warmables?: T.Object3D[]; textures?: T.Texture[];
  }) {
    const layer = create(this.scene);
    this.layers.push(layer);
    // Gardés pour warmUp : il recompile tout, variantes du bloom comprises.
    this.layerWarmables.push(...(layer.warmables ?? []));
    const hidden = (layer.warmables ?? []).filter((object) => !object.visible);
    hidden.forEach((object) => { object.visible = true; });
    this.renderer.compile(this.scene, this.camera);
    layer.textures?.forEach((texture) => this.renderer.initTexture(texture));
    hidden.forEach((object) => { object.visible = false; });
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
  private makeFighter(clothColor: string, accentColor: string, bareChest = false, outfit?: Outfit, outline = false): Fighter {
    const rig = buildHumanoid((color) => this.material(color), clothColor, accentColor, { bareChest, outfit, outline });
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
      const witness = this.makeFighter('#695b42', '#ba9c69', true, plainOutfit((color) => this.material(color), '#7a4a2c'));
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
      ...this.gear.warmables, ...this.layerWarmables,
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
    fighter.root.position.set(pose.x, pose.groundZ ?? 0, pose.y);
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
    fighter.root.position.y = (pose.groundZ ?? 0) + drop;
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
    // L'arc et les feuilles posent les bras directement : l'animateur repart de
    // cette pose ensuite, pour un fondu sans à-coup.
    this.playerAnim.capture();
    this.martial.update(player, dt, now, !!enemy);
    this.remotePlayer.update(this.remotePose, realDt);
    this.remote.root.visible = this.remoteVisible;
    if (this.remoteVisible) {
      const remoteActor = this.remotePlayer.actor();
      remoteActor.x += WORLD.WIDTH / 2;
      remoteActor.y += WORLD.HEIGHT / 2;
      this.animate(this.remote, remoteActor, dt);
      this.feel.applyFlinch(this.remote.root, this.remote.torso, remoteActor);
    }
    this.duelist.root.visible = !!enemy && duelist;
    this.veille.visible = !!enemy && !duelist;
    if (enemy && duelist) {
      this.animate(this.duelist, enemy, dt);
      if (this.bossKind === 'champion') animateBadu(this.duelist, enemy, now);
      else animateDuelist(this.duelist, enemy, now);
      this.champion.update(this.bossKind === 'champion' ? enemy : null, now, dt, player);
      this.applyGlow(enemy);
      this.feel.applyFlinch(this.duelist.root, this.duelist.torso, enemy);
    } else {
      this.champion.update(null, now, dt);
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
      let blade = true;
      if (this.bossKind === 'champion') {
        // Badu : la lame de l'afena (ou la bouche du mousquet, sans traînée, quand il tire).
        blade = this.champion.bladeSegment(this.weaponBase, this.weaponTip);
      } else {
        // Bâton tenu par le bras droit : axe local (0, 0.18, 0.98) autour de (0, -8.5, 10).
        this.duelist.root.updateMatrixWorld(true);
        this.weaponBase.set(0, -10.3, 0.2);
        this.weaponTip.set(0, -5.3, 27.7);
        this.duelist.arms[1].localToWorld(this.weaponBase);
        this.duelist.arms[1].localToWorld(this.weaponTip);
      }
      weapon = blade ? { base: this.weaponBase, tip: this.weaponTip } : null;
      glint = this.weaponTip;
    } else if (enemy) {
      glint = this.glintPoint.set(enemy.x + enemy.facingX * 20, 16, enemy.y + enemy.facingY * 20);
    }
    this.bossFx.update(this.intro !== null && this.intro < 0.3 ? null : enemy, this.bossKind,
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
    this.updateCamera(player, enemy, dt, realDt);
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

  private introDuration = 3800;
  /** Durée de l'entrée du boss en cours (ms), pour caler le plan de caméra. */
  setIntroDuration(ms: number) {
    this.introDuration = ms;
  }

  /** Boss incarné par le rig humain : Kofi ('duelist') ou le porte-glaive ('champion'). */
  setBossKind(kind: BossId) {
    this.bossKind = kind;
  }

  /** Boss vaincu : la caméra recule et monte pendant qu'il tombe. */
  playDefeatShot(from: Point, boss: Point) {
    const look = new T.Vector3();
    this.cine.play(SHOTS.defeat(boss, from, () => look.set(boss.x, 10, boss.y)));
  }

  /** Joue un plan de caméra sur spline ; la caméra de jeu reprend la main ensuite. */
  playCinematic(shot: CinematicShot) {
    this.cine.play(shot);
  }

  /** Réserve le fondu de sortie dans la durée annoncée du beat narratif. */
  private playTimedShot(shot: CinematicShot) {
    const out = shot.blendOut ?? 450;
    this.cine.play({ ...shot, duration: Math.max(200, shot.duration - out) });
  }

  /** Plans du récit (Chapitre 1), calés sur la durée du beat narratif. */
  playStoryShot(id: StoryBeatId, ctx: StoryShotContext) {
    const duration = STORY_BEATS[id].duration;
    const player = ctx.player;
    const focus = ctx.focus ?? ctx.boss ?? player;
    if (id === 'badu-phase' || id === 'badu-fall' || id === 'badu-entrance') {
      if (!ctx.boss) return;
      const shot = id === 'badu-phase' ? STORY_SHOTS.baduPhase(ctx.boss, player, duration)
        : id === 'badu-fall' ? STORY_SHOTS.baduFall(ctx.boss, player, duration)
          : STORY_SHOTS.baduEntrance(ctx.boss, player, duration);
      this.playTimedShot(shot);
      return;
    }
    if (id === 'vista' || id === 'bridge-glance') {
      this.playTimedShot((id === 'vista' ? STORY_SHOTS.vista : STORY_SHOTS.glance)(player, focus, duration));
      return;
    }
    if (id === 'drummer') {
      this.playTimedShot(STORY_SHOTS.drummer(player, focus, duration));
      return;
    }
    this.playTimedShot(STORY_SHOTS.opening(ctx.sword ?? player, player, duration));
  }

  /** Micro-regard optionnel : la caméra revient seule au joueur. */
  glanceAt(player: StoryPoint, point: StoryPoint, seconds = 1.5) {
    this.playTimedShot(STORY_SHOTS.glance(player, point, seconds * 1000));
  }

  setRemotePose(pose: DuelPose | null, visible = true): void {
    this.remotePose = pose;
    this.remoteVisible = visible;
  }

  /** Changement de phase : demi-tour lent autour du boss, de bas en haut. */
  playPhaseShot(from: Point, boss: () => Point, duration: number) {
    const look = new T.Vector3();
    const at = boss();
    this.playTimedShot(SHOTS.phaseShift(at, from, duration, () => {
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
  private cinematicCamera(player: Actor3D, enemy: Point | null, cineDt: number) {
    if (this.intro === null) {
      this.introStarted = false;
    } else if (!this.introStarted && enemy && this.bossKind !== 'champion' && !this.cine.active) {
      this.introStarted = true;
      const duration = this.introDuration * 0.88 * (1 - this.intro);
      this.playTimedShot(SHOTS.bossIntro(enemy, player, duration));
    }
    return this.cine.drive(this.camera, cineDt);
  }

  private updateCamera(player: Actor3D, boss: Point | null, dt: number, cineDt: number) {
    if (this.cinematicCamera(player, boss, cineDt)) return;
    const aiming = player.weapon === 'bow' && (player.state === 'aiming' || player.state === 'release');
    this.aimingFactor = aiming ? 0.62 : 1;
    this.glideLock(dt);
    // Cible cadrée : le boss du duel, sinon l'ennemi verrouillé.
    const enemy = boss ?? this.lockPoint;
    // Pas de marqueur sur un boss qui tombe.
    this.lockMarker.visible = !!enemy && (boss as Actor3D | null)?.state !== 'dead';
    if (enemy) {
      this.lockMarker.position.set(enemy.x, boss ? 40 : 30 + this.lockGround, enemy.y);
      this.lockMarker.rotation.y += dt * 2;
      this.padFlick();
    }
    if (enemy) {
      this.targetYaw = Math.atan2(enemy.x - player.x, enemy.y - player.y);
      this.orbit = this.targetYaw;
      this.pendingYaw = 0;
      this.pendingPitch = 0;
    } else if (!this.initialized) {
      this.orbit = Math.atan2(player.facingX, player.facingY);
      this.targetYaw = this.orbit;
    } else {
      this.followHero(player, dt);
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
      // Un grand écart (nouvelle cible, ennemi dans le dos) se rattrape vite
      // même au contact : seul le petit pivot continu est freiné.
      const wide = T.MathUtils.smoothstep(Math.abs(turn), 0.6, 1.6);
      const rate = T.MathUtils.lerp(T.MathUtils.lerp(1.4, 6, closeness), 5, wide);
      const maxSpeed = T.MathUtils.lerp(T.MathUtils.lerp(1.6, 3.4, closeness), 4.4, wide);
      const step = turn * (1 - Math.exp(-rate * dt));
      this.viewYaw += T.MathUtils.clamp(step, -maxSpeed * dt, maxSpeed * dt);
    } else {
      this.viewYaw += turn * (1 - Math.exp(-6.6 * dt));
    }
    const dx = Math.sin(this.viewYaw);
    const dy = Math.cos(this.viewYaw);
    this.vista += (this.vistaTarget - this.vista) * (1 - Math.exp(-1.2 * dt));
    const profile = CAMERA_PROFILES[this.cameraMode];
    const boom = enemy
      ? profile.boom + Math.min(distance, 200) * profile.boomDistance
      : profile.boom + profile.vistaBoom * this.vista;
    let shoulder = (enemy ? profile.shoulder : profile.shoulder * 0.8) * (aiming ? 0.45 : 1);
    const ground = player.groundZ ?? 0;
    const height = enemy
      ? profile.height + Math.min(distance, 220) * profile.heightDistance
      : profile.height + this.pitch + profile.vistaHeight * this.vista;
    this.cameraGoal.set(player.x - dx * boom - dy * shoulder,
      ground + height,
      player.y - dy * boom + dx * shoulder);
    // Shorten the boom before it reaches a hut when orbiting through the village.
    // Relief : la caméra s'élève au-dessus des talus et des parois plutôt que de plonger dedans.
    if (this.cameraFloor) {
      let floor = -Infinity;
      for (let fraction = 0.3; fraction <= 1.001; fraction += 0.35) {
        const x = T.MathUtils.lerp(player.x, this.cameraGoal.x, fraction);
        const z = T.MathUtils.lerp(player.y, this.cameraGoal.z, fraction);
        floor = Math.max(floor, this.cameraFloor(x, z) * fraction);
      }
      if (this.cameraGoal.y < floor + profile.floorClearance) this.cameraGoal.y = floor + profile.floorClearance;
    }
    this.cameraArmBase.set(player.x, ground + 27, player.y);
    for (let fraction = 0.2; fraction < 0.98; fraction += 0.12) {
      const x = T.MathUtils.lerp(player.x, this.cameraGoal.x, fraction);
      const y = T.MathUtils.lerp(this.cameraArmBase.y, this.cameraGoal.y, fraction);
      const z = T.MathUtils.lerp(player.y, this.cameraGoal.z, fraction);
      if (HUTS.some(([hx, hz, radius]) => y < 49 &&
          (x - hx) ** 2 + (z - hz - 5) ** 2 < (radius * 0.9) ** 2) || this.cameraBlocker?.(x, z, y)) {
        this.cameraGoal.lerp(this.cameraArmBase, 1 - Math.max(0.18, fraction - 0.1));
        break;
      }
    }
    const lead = enemy
      ? profile.lead + Math.min(distance, 160) * profile.leadDistance
      : profile.lead;
    const sight = lead * (aiming ? 0.55 : 1);
    this.lookGoal.set(player.x + dx * sight, ground + profile.lookHeight, player.y + dy * sight);
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

  /**
   * Caméra d'exploration façon soulslike : épaule droite, derrière le héros.
   * La souris (glisser) ou le stick droit tournent librement ; un peu après
   * le dernier geste, la caméra se replace d'elle-même dans le dos du héros
   * quand il avance (lentement s'il court de côté, jamais s'il revient vers
   * l'objectif). Q ou le clic du stick droit la recentrent tout de suite.
   * [SUPPOSITION] vitesses et délais à régler en jeu.
   */
  private followHero(player: Actor3D, dt: number) {
    this.manualLook += dt;
    this.padLook(dt);
    // Geste de caméra lissé : un doigt qui tremble ne fait pas sauter le cadre.
    const ease = 1 - Math.exp(-12 * dt);
    const yawStep = this.pendingYaw * ease;
    const pitchStep = this.pendingPitch * ease;
    this.orbit += yawStep;
    const profile = CAMERA_PROFILES[this.cameraMode];
    this.pitch = T.MathUtils.clamp(this.pitch + pitchStep, profile.pitchMin, profile.pitchMax);
    this.pendingYaw -= yawStep;
    this.pendingPitch -= pitchStep;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const behind = Math.atan2(player.facingX, player.facingY);
    const gap = wrap(behind - this.orbit);
    // Course de côté (au joystick surtout) : au bout de 0,6 s, la caméra pivote doucement dans le dos.
    this.lateralTime = player.state === 'moving' && Math.abs(gap) > 0.45 && Math.abs(gap) < 2.1 ? this.lateralTime + dt : 0;
    if (this.recenter) {
      this.orbit += gap * (1 - Math.exp(-11 * dt));
      this.pitch += (0 - this.pitch) * (1 - Math.exp(-8 * dt));
      if (Math.abs(gap) < 0.03) this.recenter = false;
      return;
    }
    // Suivi plus présent : la caméra reprend la main 0,7 s après le dernier geste.
    if (this.manualLook < 0.7 || player.state !== 'moving') return;
    // Course vers la caméra : on garde le cadre (pas de demi-tour brutal).
    if (Math.abs(gap) > 2.1) return;
    const forward = Math.max(0, Math.cos(gap));
    let rate = (player.sprint ? 2.6 : 1.9) * (0.25 + 0.75 * forward);
    if (this.lateralTime > 0.6) rate = Math.max(rate, 1.2);
    this.orbit += gap * (1 - Math.exp(-rate * dt));
  }

  /** Stick droit de la manette : orbite et hauteur ; clic (RS) pour recentrer. */
  private padLook(dt: number) {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
    const pad = [...navigator.getGamepads()].find((p) => p?.connected);
    if (!pad) return;
    const dead = (v: number) => Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82;
    const lx = dead(pad.axes[2] ?? 0);
    const ly = dead(pad.axes[3] ?? 0);
    if (lx || ly) {
      this.orbit -= lx * 2.6 * this.aimingFactor * dt;
      const p = CAMERA_PROFILES[this.cameraMode];
      this.pitch = T.MathUtils.clamp(this.pitch + ly * 60 * this.aimingFactor * dt, p.pitchMin, p.pitchMax);
      this.manualLook = 0;
      this.recenter = false;
    }
    this.padButton(pad);
  }

  /** Clic du stick droit (RS) : verrouille s'il y a une cible, sinon recentre. */
  private padButton(pad: Gamepad) {
    const pressed = !!pad.buttons[11]?.pressed;
    if (pressed && !this.lockPressed) {
      if (this.onLockButton) this.onLockButton();
      else this.recenter = true;
    }
    this.lockPressed = pressed;
  }

  /** Cible verrouillée : un coup sec du stick droit change de cible. */
  private padFlick() {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
    const pad = [...navigator.getGamepads()].find((p) => p?.connected);
    if (!pad) return;
    this.padButton(pad);
    const x = pad.axes[2] ?? 0;
    if (Math.abs(x) > 0.7 && this.flickReady) {
      this.flickReady = false;
      this.onLockFlick?.(Math.sign(x));
    } else if (Math.abs(x) < 0.3) {
      this.flickReady = true;
    }
  }

  /** Q sans cible à verrouiller : la caméra revient dans le dos du héros. */
  requestRecenter() {
    this.recenter = true;
  }

  setCameraMode(mode: CameraMode) {
    this.cameraMode = mode;
    this.recenter = true;
  }

  private vista = 0;
  private vistaTarget = 0;
  /** Point de vue (promontoire) : 1 = la caméra recule et s'élève doucement, 0 = normale. */
  setVista(amount: number) {
    this.vistaTarget = amount;
  }

  /** Ennemi verrouillé hors duel (null : caméra libre). */
  setLockTarget(point: (Point & { ground?: number }) | null) {
    this.lockGoal = point ? { x: point.x, y: point.y } : null;
    this.lockGround = point?.ground ?? 0;
    if (!point) {
      this.lockPoint = null;
      this.flickDrag = 0;
    } else if (!this.lockPoint) {
      this.lockPoint = { x: point.x, y: point.y };
    }
  }

  /** Cible réelle du verrou ; lockPoint la rejoint en glissant (changement de cible sans à-coup). */
  private lockGoal: Point | null = null;
  /** Hauteur du sol sous la cible (relief du prologue) : le marqueur flotte au-dessus d'elle. */
  private lockGround = 0;

  /**
   * [SUPPOSITION] Lissage du point cadré : il suit de près un ennemi qui se
   * déplace, mais glisse en ~0,3 s vers une nouvelle cible au lieu d'y sauter.
   */
  private glideLock(dt: number) {
    if (!this.lockGoal || !this.lockPoint) return;
    const gap = Math.hypot(this.lockGoal.x - this.lockPoint.x, this.lockGoal.y - this.lockPoint.y);
    const rate = gap > 30 ? 9 : 22;
    const k = 1 - Math.exp(-rate * dt);
    this.lockPoint.x += (this.lockGoal.x - this.lockPoint.x) * k;
    this.lockPoint.y += (this.lockGoal.y - this.lockPoint.y) * k;
  }

  /** Ambiance d'une carte hors arène (prologue) ; null : ambiance de base. */
  setRegionMood(mood: RegionMood | null) {
    this.arenaDressing.setRegionMood(mood);
  }

  /** Centre autour duquel les collines lointaines glissent (carte en cours). */
  setLandscapeCenter(x: number, z: number) {
    this.landscape.center.set(x, z);
  }

  /** Horizon d'harmattan des actes suivants : masqué là où une carte a son propre ciel et son relief. */
  setLandscapeVisible(visible: boolean) {
    this.landscape.root.visible = visible;
  }

  /** Arme en main et flèches (en vol ou au sol), mises à jour avant render(). */
  /** Héros incarné : Kwabena (acte I, 1824) ou Ama Serwaa (acte II, 1874). */
  setHero(hero: 'kwadwo' | 'kwabena' | 'ama') {
    if (hero === this.hero) return;
    this.hero = hero;
    this.togas.kwabena.visible = hero === 'kwabena';
    this.togas.ama.visible = hero === 'ama';
    // Pagne, bandoulière, brassards et sandales de Kwadwo (1701).
    if (this.player.body) this.player.body.outfit.visible = hero === 'kwadwo';
    if (this.heroBodies) {
      showBody(this.heroBodies.man, hero !== 'ama');
      showBody(this.heroBodies.woman, hero === 'ama');
    }
  }

  /** Décor dur pour l'arme du joueur : la lance recule au lieu de traverser un mur. */
  setWeaponProbe(probe: WeaponProbe | null) {
    this.martial.probe = probe;
  }

  setEquipment(weapon: WeaponId, arrows: readonly { x: number; y: number; dirX: number; dirY: number; grounded: boolean }[],
    look?: GearLook, ammo = 0) {
    this.gear.setWeapon(weapon);
    this.gear.setAmmo(ammo);
    if (look) {
      this.gear.setLook(look);
      // Batakari ramassé : il recouvre le haut du pagne (seul le bas dépasse).
      for (const toga of [this.togas.kwabena, this.togas.ama]) {
        for (const part of toga.children) if (part.userData['underBatakari']) part.visible = !look.batakari;
      }
    }
    this.gear.setArrows(arrows);
  }

  /**
   * L'écran de jeu remplit tout l'écran, quel que soit son format (16:9, 20:9,
   * 4:3) : 540 lignes internes, largeur selon le format, champ vertical
   * inchangé (un écran allongé voit plus large). Densité plafonnée à 1,5.
   */
  private fit() {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    const aspect = width / height;
    const internalWidth = Math.round(VIEWPORT.HEIGHT * aspect);
    this.renderer.setSize(internalWidth, VIEWPORT.HEIGHT, false);
    this.renderer.setPixelRatio(renderPixelRatio(this.host, internalWidth));
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.post?.setAspect(aspect);
    this.post?.setSize(internalWidth, VIEWPORT.HEIGHT);
    this.post?.setQuality(currentSettings().quality);
  }

  /** Repère d'objectif, en coordonnées du canvas 2D 16:9 centré sur l'écran de jeu. */
  objectiveOnScreen() {
    if (!this.focus) return null;
    this.projection.set(this.focus.x, 26, this.focus.y).project(this.camera);
    const behind = this.projection.z > 1;
    let x = behind ? -this.projection.x : this.projection.x;
    let y = behind ? -1 : this.projection.y;
    const stretch = this.camera.aspect / (VIEWPORT.WIDTH / VIEWPORT.HEIGHT);
    if (stretch >= 1) x *= stretch;
    else y /= stretch;
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
    this.champion.dispose();
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
