export type GameScreen = 'main-menu' | 'playing' | 'paused' | 'death' | 'victory' | 'duel';

import { computed, inject, Injectable, signal } from '@angular/core';
import { BOSS_CONFIG } from '../constants/boss.config-constant';
import { ENCOUNTERS, type EncounterId } from '../constants/boss-encounters';
import { PLAYER_CONFIG } from '../constants/player.config-constant';
import {
  BOSS_ATTACKS,
  BossAttackData,
  BossAttackType,
  SURGE_WIDTH,
  SHOT_WIDTH,
  SHOT_DAMAGE_RATIO,
  shotAngles,
  surgeRadius,
  attackProgress,
  isBossHitActive,
  tideRadii,
} from '../interfaces/BossAttackData';
import { SPRITE_MANIFEST } from '../constants/sprite-config';
import { BossEntity, BossHud } from '../entities/bosses/boss.entity';
import { BossStore } from '../entities/bosses/boss.store';
import { PlayerEntity } from '../entities/player/player.entity';
import { PlayerStore } from '../entities/player/player.store';
import { EquipmentStore } from '../entities/player/equipment.store';
import { ArrowService } from '../entities/projectiles/arrow.service';
import { AssetLoaderService } from '../engine/asset-loader.service';
import { CameraService } from '../engine/camera.service';
import { GroundEffectsService } from '../engine/ground-effects.service';
import { DuelFog, FORD_DUEL, SLUICE_DUEL } from '../engine/duel-fog';
import { TerrainCollisionService } from '../engine/terrain-collision.service';
import type { Actor3D, World3D } from '../engine/world-3d';
import { EnvironmentService } from '../engine/environment.service';
import { DestructiblesService } from '../engine/destructibles.service';
import { BATTLE, CLEARING, CROSSING, GATE, VILLAGE_STOPS } from '../constants/village';
import { AttackEventTracker, attackFrame } from '../combat/attack-timeline';
import { Dialogue, DialogueChoice, FlagValue, resolveDialogue } from './dialogue-tree';
import { SliceService } from '../slice/slice.service';
import type { Enemy } from '../slice/enemies.service';
import { TargetLock, type LockView } from '../slice/target-lock';
import { SoulsLoopService, type SoulsPrompt } from './souls-loop.service';
import { FOYERS, SOULS, type Foyer, type FoyerId } from '../constants/souls-world';
import { ruinBlocks } from '../constants/landscape';
import { SLICE_DIALOGUES } from '../slice/slice-content';
import { PrologueService } from '../prologue/prologue.service';
import { CLEARINGS, DRUMMER, groundHeight, PROLOGUE_CENTER, PROLOGUE_DUEL, PROLOGUE_MOOD } from '../prologue/prologue-map';
import { AttackData } from '../interfaces/AttackData';
import { PlayerData } from '../interfaces/PlayerData';
import { CollisionService } from './collision.service';
import { BACKSTAB, HitWeight, TIME_DILATION, isPerilous } from '../constants/immersion.config-constant';
import { GameLoopService } from './game-loop.service';
import { RendererService } from './renderer.service';
import { CombatFxService, type ImpactMaterial, type StrikeStyle } from './combat-fx.service';
import { MusicCue, MusicDirectorService, type MusicZone } from '../audio/music-director.service';
import { AudioEngineService } from '../audio/audio-engine.service';
import { BaduSfx } from '../audio/badu-sfx';
import { TrophyService } from '../trophies/trophy.service';
import { NarrativeDirectorService } from '../narrative/narrative-director.service';
import type { StoryBeatId, StoryPoint } from '../narrative/story-beats';
import { SignatureSfx } from '../audio/signature-sfx';
import { currentSettings } from '../platform/settings.service';

export interface CombatHud {
  /** Cinématique en cours : le HUD de combat est masqué. */
  cinematic: boolean;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  boss: BossHud | null;
  counter: boolean;
  /** Fondu au noir de 0 à 1 (mort du joueur). */
  fade: number;
  /** Nom du boss qui vient de tomber (annonce pendant son animation de mort). */
  defeated: { name: string; label: string } | null;
  /** Danger qui vient de frapper, en degrés depuis le haut de l'écran. */
  hit: { id: number; angle: number; kind: 'shot' | 'melee' } | null;
}

/** Cause de la mort et conseil, par coup de boss. [SUPPOSITION] formulations à relire. */
const KILL_HINTS: Partial<Record<string, string>> = {
  shot: 'Abattu par le mousquet de Badu. Quand la fumée noire sort du canon, esquive de côté au dernier moment.',
  reap: 'Fauché par la double faucheuse. Esquive vers l’avant, à travers la lame, pour finir dans son flanc.',
  judgment: 'Écrasé par le jugement retardé. Attends que la hache commence à descendre avant d’esquiver.',
  feint: 'Pris par la feinte. Quand il lève la hache, ne frappe pas tant que le coup n’est pas parti.',
  backhand: 'Frappé par le revers de crosse. Ne reste pas collé dans son dos.',
  furrow: 'Fauché par le sillon d’étincelles. Esquive en diagonale quand il relève la lame.',
  leap: 'Écrasé par la chute du roi. Roule sous lui pendant qu’il est en l’air.',
  mill: 'Pris dans le moulinet. Reste hors de portée des trois premiers coups, esquive le quatrième.',
  thrust: 'Transpercé par l’estocade. Esquive de côté : l’estoc vide l’endurance.',
};

/** Cause de la mort et conseil, par soldat de terrain. */
const FIELD_HINTS: Partial<Record<string, string>> = {
  eclaireur: 'Tué par la lance de l’éclaireur. Deux coups suffisent : esquive quand il recule le bras.',
  lancier: 'Tué par le lancier. Esquive son estoc sur le côté, puis frappe pendant qu’il se replace.',
  tireur: 'Abattu par le tireur posté. Abrite-toi derrière les troncs : il met quatre secondes à recharger.',
  fusilier: 'Abattu par un fusilier. Une ligne rouge marque la visée : sors-en avant le tir.',
  garde: 'Assommé par le garde d’élite. Son bouclier arrête les coups de face : prends-le de flanc ou frappe lourd.',
  pilleur: 'Tué par un pillard. Ses deux coups s’enchaînent : esquive le second aussi.',
};

@Injectable({
  providedIn: 'root',
})
export class GameStateService {
  private _currentScreen = signal<GameScreen>('main-menu');

  currentScreen = computed(() => this._currentScreen());

  private collision = inject(CollisionService);

  private playerStore = inject(PlayerStore);
  private playerEntity = inject(PlayerEntity);
  private bossEntity = inject(BossEntity);
  private bossStore = inject(BossStore);
  private gameloop = inject(GameLoopService);
  private rendered = inject(RendererService);
  private camera = inject(CameraService);
  private environment = inject(EnvironmentService);
  private view3d: World3D | null = null;
  private readonly equipment = inject(EquipmentStore);
  private readonly arrows = inject(ArrowService);
  private readonly destructibles = inject(DestructiblesService);
  /** Game feel : sons d'impact, éclats, flashs, secousse 3D. */
  private readonly fx = inject(CombatFxService);
  readonly narrative = inject(NarrativeDirectorService);
  private readonly signature = inject(SignatureSfx);
  private lastPlayerState = '';
  private rollLanded = false;
  /** Clé du dernier swing sonorisé (joueur) / du dernier coup de boss sonorisé. */
  private swingKey = '';
  private bossSwingKey = '';
  private hitIndicator: { id: number; angle: number; kind: 'shot' | 'melee'; until: number } | null = null;
  private hitId = 0;

  /** Tranche verticale : plaine, chambres de la digue, ennemis, progression. */
  private readonly slice = inject(SliceService);

  /**
   * Crée les couches 3D de la partie. À attendre AVANT World3D.warmUp : leurs
   * shaders (y compris les variantes du bloom) sont alors compilés pendant
   * l'écran de chargement et non aux premières images jouées.
   * Elles vivent dans le chunk paresseux de world-3d (déjà chargé ici, l'import
   * se résout aussitôt) pour que three.js reste hors du bundle initial.
   */
  async attachLayers(view: World3D) {
    const { GameLayers3D: L } = await import('../engine/world-3d');
    view.addLayer((scene) => new L.Destructibles3D(scene, this.destructibles));
    view.addLayer((scene) => new L.Slice3D(scene, this.slice, this.slice.enemies, this.playerEntity, this.terrain));
    view.addLayer((scene) => new L.Souls3D(scene, () => this.souls.stash()));
    view.addLayer((scene) => new L.AttackTelegraph3D(scene, () => this.threatPose()));
    view.addLayer((scene) => new L.Prologue3D(scene, () => this.chapter() === 'prologue', (id) => this.prologue.hasRead(id),
      () => this.prologue.championSpot, () => this.prologue.bridged,
      () => ({ x: this.playerEntity.centerX, y: this.playerEntity.centerY })));
    view.cameraBlocker = (x, z, y) => this.prologue.blocksCamera(x, z, y);
    view.cameraFloor = (x, z) => this.prologue.cameraFloor(x, z);
  }

  setWorld3D(view: World3D | null) {
    this.view3d = view;
    this.prologueView = null;
    this.prologue.onStory = (id, focus) => this.playStory(id, focus);
    this.narrative.onFinish = (id, skipped) => {
      if (!skipped) return;
      this.view3d?.skipCinematic();
      if (this.introTime > 0) {
        this.introTime = 0;
        this.view3d?.setIntro(null);
      }
    };
    view?.setFxSource(this.fx);
    view?.setCameraMode(currentSettings().cameraMode);
    this.playerEntity.setCameraHeading(view?.heading ?? null);
  }

  /** Déclenche un beat narratif et le plan de caméra associé. */
  private playStory(id: StoryBeatId, focus?: StoryPoint) {
    if (!this.narrative.play(id)) return;
    this.view3d?.playStoryShot(id, {
      player: { x: this.playerEntity.centerX, y: this.playerEntity.centerY },
      boss: id.startsWith('badu-')
        ? { x: this.bossEntity.centerX, y: this.bossEntity.centerY }
        : undefined,
      focus,
      sword: focus,
    });
  }

  /** Interruption au maintien : le beat et la caméra rendent la main. */
  skipStory() {
    this.narrative.finish(true);
  }

  private readonly terrain = inject(TerrainCollisionService);
  private readonly fordShot = { x: FORD_DUEL.x - 24, y: FORD_DUEL.y - 35, zoom: 1.74 };
  private readonly sluiceShot = { x: SLUICE_DUEL.x + 25, y: SLUICE_DUEL.y - 36, zoom: 1.66 };
  private readonly fog = new DuelFog();
  private groundEffects = inject(GroundEffectsService);
  private assets = inject(AssetLoaderService);

  private readonly _hud = signal<CombatHud | null>(null);
  /** État du HUD HTML (null avant la première image). */
  readonly hud = this._hud.asReadonly();
  private hudKey = '';

  private readonly visited = signal(0);
  private readonly dialogueId = signal<string | null>(null);
  private readonly decision = signal<'seal' | 'expose' | null>(null);
  private readonly chapter = signal<'prologue' | 'battle' | 'crossing' | 'village'>('village');
  /** Prologue 1701 : le champ de bataille de Feyiase (lib/prologue). */
  readonly prologue = inject(PrologueService);
  /** Chapitre 1 : duel contre le porte-hache du Denkyira sur la crête. */
  private readonly prologueDuel = signal(false);
  private readonly inCombat = computed(() =>
    this.chapter() === 'battle' || this.decision() !== null || this.prologueDuel());
  private readonly humanBoss = computed(() => {
    const encounter = this.encounter();
    if (encounter) return ENCOUNTERS[encounter].form === 'human';
    return this.chapter() === 'battle' || this.prologueDuel();
  });
  /** Arène du combat en cours. */
  private duelArena() {
    const encounter = this.encounter();
    if (encounter) return ENCOUNTERS[encounter].arena;
    return this.prologueDuel() ? PROLOGUE_DUEL : this.chapter() === 'battle' ? FORD_DUEL : SLUICE_DUEL;
  }
  /** Annonce « vaincu » affichée pendant l'animation de mort du boss. */
  private readonly defeated = signal<{ name: string; label: string } | null>(null);
  private defeatShot = false;
  readonly objective = computed(() => {
    if (this.chapter() === 'prologue') return this.prologue.goal();
    if (this.chapter() === 'battle') return BATTLE;
    if (this.chapter() === 'crossing') return CROSSING;
    return this.decision() ? CLEARING : (VILLAGE_STOPS.at(this.visited()) ?? this.slice.objective() ?? GATE);
  });
  private readonly near = signal(false);
  private readonly counterTime = signal(0);
  readonly counterReady = computed(() => this.counterTime() > 0);
  /** Drapeaux posés par les dialogues (`set` dans dialogues.json). */
  private readonly storyFlags = signal<Record<string, FlagValue>>({});
  /** Drapeaux lus par les conditions des dialogues (`if`). */
  readonly flags = computed(() => ({
    ...this.storyFlags(),
    chapter: this.chapter(),
    visited: this.visited(),
    decision: this.decision(),
    duelist_defeated: this.chapter() !== 'battle',
  }));
  readonly dialogue = computed(() => {
    const id = this.dialogueId();
    return id ? resolveDialogue(id, this.flags()) ??
      resolveDialogue(id, this.flags(), SLICE_DIALOGUES as Record<string, Dialogue>) : null;
  });
  /** Boucle soulslike : cauris, foyers, tache laissée à la mort (souls-loop.service.ts). */
  readonly souls = inject(SoulsLoopService);
  /** Foyer à portée (touche F), hors combat. */
  private readonly restPrompt = signal<SoulsPrompt | null>(null);
  readonly canTalk = computed(() => (this.near() || !!this.restPrompt() || !!this.prologue.prompt()) &&
    !this.dialogue() && !this.decision());
  /** Libellé du bouton d'interaction. */
  readonly interactLabel = computed(() => this.restPrompt()?.label ?? this.prologue.prompt()?.label ?? 'Interagir');
  private readonly activeEncounter = signal<EncounterId | null>(null);
  /** Boss affronté en ce moment (chronomètre des défis), null hors combat. */
  readonly encounter = computed<EncounterId | null>(() =>
    this.activeEncounter() ??
    (this.prologueDuel() ? 'champion' : this.chapter() === 'battle' ? 'ford' : this.decision() ? 'sluice' : null));
  /** Histoire, Boss Rush (boss à la suite) ou défi reçu par URL. */
  readonly mode = signal<'story' | 'rush' | 'challenge'>('story');
  /** Fenêtre d'interface ouverte (écriture d'un message) : la partie attend. */
  readonly uiLock = signal(false);
  private rushPlan: EncounterId[] = [];
  private rushNext: EncounterId[] = [];
  private readonly pendingEncounter = signal<EncounterId | null>(null);
  private rushTransition = 0;
  readonly story = computed(() => {
    if (this.prologueDuel()) {
      return 'Chapitre 1, 1701. Badu Ofosu, le porte-hache du roi du Denkyira, tient encore la crête. Esquive la hache, guette la longue visée du mousquet : la fumée noire marque la ligne du tir. Frappe pendant qu’il recharge.';
    }
    if (this.chapter() === 'prologue') {
      return 'Chapitre 1, 1701. Feyiase, après la bataille. Kwadwo Ofori, isolé de l’arrière-garde, remonte la piste vers la crête à l’est. Des éclaireurs du Denkyira sont embusqués : avance prudemment.';
    }
    if (this.chapter() === 'battle') {
      return 'Acte I, 1824. Le Pra est en crue. Kwabena Ofori, de la lignée de Pokou, fait passer les familles de son clan qui fuient la guerre. Kofi Brempong, capitaine asafo, a l’ordre de ne laisser passer personne. Esquive ses charges et frappe quand il reprend son souffle.';
    }
    if (this.chapter() === 'crossing') {
      return 'Kofi baisse son sabre : il n’y a pas d’armée, seulement des familles. Rejoins le gué : il tiendra la corde pendant que tu les guideras.';
    }
    if (this.decision()) return 'Le Gardien ouvre sa carapace après avoir relâché l’eau. Esquive la vague, puis frappe pendant qu’il se vide.';
    const expedition = this.visited() >= 2 ? this.slice.journal() : null;
    if (expedition) return expedition;
    return [
      'Acte II, 1874. Kumasi a brûlé. Ama Serwaa, petite-nièce de Kwabena, a conduit les rescapés jusqu’au village fondé par les familles du gué. Le puits manque d’eau. Kouamé t’attend sur la place du Goli, avec la vieille corde du gué.',
      'Le chant de Kwabena parle de trois coups entendus sous la digue. Va le redire à Aya.',
      'Le canal a été détourné. Retrouve Yao à la vanne avant que la chambre se vide.',
    ][this.visited()];
  });
  readonly ending = computed(() => this.decision() === 'seal'
    ? 'Le puits se remplit. Yao et sa sœur veillent leur mère ensemble. Le père de Yao retire l’accusation devant le conseil. Quand on lui demande qui a ouvert le canal, il baisse les yeux. Ce soir-là, Aya ajoute un couplet au chant de Kwabena : celui du silence.'
    : 'Tu retiens le Gardien assez longtemps pour que Yao rende l’eau au puits. Le dernier nœud cède, et l’esprit retourne sous l’eau, libre. À l’aube, la sœur de Yao pose la planche devant le conseil. Son père reconnaît sa marque et son ordre. Avant de rentrer veiller leur mère, elle lui demande de venir avec eux.');

  talk() {
    if (this.currentScreen() !== 'playing' || !this.canTalk()) return;
    const rest = this.restPrompt();
    if (rest) {
      this.rest(rest.foyer);
      return;
    }
    if (this.chapter() === 'prologue') {
      this.prologue.interact();
      return;
    }
    const gate = this.slice.progression.has('lever') ? 'gate' : 'gate-blocked';
    this.dialogueId.set(this.chapter() === 'crossing' ? 'crossing' : ['kouame', 'aya', gate][this.visited()]);
  }

  choose(choice: DialogueChoice) {
    if (!this.dialogue()?.choices.includes(choice)) return;
    if (choice.set) this.storyFlags.update((flags) => ({ ...flags, ...choice.set }));
    if (choice.next) {
      this.dialogueId.set(choice.next);
      return;
    }

    this.dialogueId.set(null);
    this.near.set(false);
    if (choice.action === 'cross') {
      this.chapter.set('village');
      this.playerStore.reset();
      this.bossStore.reset();
      this.bossEntity.configure(false);
      this.playerEntity.resetCombat();
      this.groundEffects.reset();
      this.arrows.reset();
      this.equipment.refill();
      this.slice.enterActTwo();
      this.souls.enterChapter('village', this.visited());
      this.camera.snapTo(this.playerEntity.centerX, this.playerEntity.centerY);
    } else if (choice.action === 'expedition') {
      this.slice.startExpedition();
    } else if (choice.action === 'leave') {
      this.visited.update((count) => count + 1);
      this.slice.setVisited(this.visited());
    } else if (choice.action === 'seal' || choice.action === 'expose') {
      this.decision.set(choice.action);
      this.terrain.setArena(SLUICE_DUEL);
      this.beginBossIntro();
      if (choice.action === 'seal') {
        this.bossStore.update({ hp: 225, maxHp: 225 });
      }
    }
  }

  private updateCallback = this.update.bind(this);
  private renderCallback = this.render.bind(this);

  private playerHitThisFrame = false;
  /** Temps restant de l'entrée cinématique du boss (s). */
  private introTime = 0;
  /** L'intro attend que la vue 3D soit prête (les shaders compilent au lancement). */
  private introPending = false;
  static readonly INTRO_DURATION = 3.8;
  /** Entrée de Badu : plus longue et sans coupure (dos tourné, regard, épaulé). [SUPPOSITION] */
  static readonly BADU_INTRO = 12;
  private introLength() {
    return this.bossEntity.id === 'champion' ? GameStateService.BADU_INTRO : GameStateService.INTRO_DURATION;
  }
  /** Dernier coup de combo / anneau vu, pour réarmer la touche à chaque coup. */
  private bossStrikeSeen = -1;
  private bossHitThisFrame = false;
  private readonly playerAttackEvents = new AttackEventTracker();

  constructor() {
    inject(MusicDirectorService).setCueSource(() => this.musicCue());
    // Q (A en AZERTY) : verrouiller la cible, ou recentrer la caméra s'il n'y en a pas.
    // Molette : changer de cible pendant le verrouillage.
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (event) => {
        if (event.code === 'KeyQ' && !event.repeat && this._currentScreen() === 'playing') this.toggleLock();
      });
      window.addEventListener('wheel', (event) => {
        if (this.lock.id !== null && Math.abs(event.deltaY) > 4) this.switchLock(event.deltaY > 0 ? 1 : -1);
      }, { passive: true });
    }
    this.terrain.setGroundSampler(groundHeight);
    // Murs encore debout des ruines (décor de landscape.ts).
    this.terrain.addBlocker(ruinBlocks);
    // Soldats de terrain : chaque coup donné ou reçu a son impact (étincelles,
    // sang, son, secousse), et la cause d'une mort est retenue pour l'écran de mort.
    this.slice.enemies.onEnemyHit = (enemy, dirX, dirY, heavy) => {
      const shielded = enemy.kind === 'garde' && !heavy && -(dirX * enemy.facingX + dirY * enemy.facingY) > 0.35;
      this.fx.hit({ x: enemy.x - dirX * 6, y: enemy.y - dirY * 6, height: 18, dirX, dirY,
        material: shielded ? 'guard' : 'flesh', style: heavy ? 'slam' : 'slash', strength: heavy ? 1.3 : 0.9, target: 'boss' });
    };
    this.slice.enemies.onPlayerHit = (enemy, dirX, dirY) => {
      this.fx.hit({ x: this.playerEntity.centerX, y: this.playerEntity.centerY, height: 20, dirX, dirY,
        material: 'flesh', style: 'thrust', strength: 1.2, target: 'player' });
      this.markHitDir(dirX, dirY, enemy.move === 'shot' || enemy.move === 'longshot' ? 'shot' : 'melee');
      this.lock.noteHit(enemy.id);
      this.lastHitBy = FIELD_HINTS[enemy.kind] ?? 'Tué par un soldat du Denkyira.';
    };
  }

  /** Situation lue par la musique : zone, pause, approche de l'arène de la vanne. */
  private musicCue(): MusicCue {
    const screen = this._currentScreen();
    if (screen === 'victory') return { zone: 'dawn' };
    if (screen === 'death') return { zone: 'silence', defeated: true };
    if (screen !== 'playing' && screen !== 'paused') return { zone: 'silence' };
    const paused = screen === 'paused';
    const encounter = this.encounter();
    if (encounter && this.mode() !== 'story') {
      const silent = encounter === 'champion' && this.introTime > 0 && !this.baduClick;
      const zone: MusicZone = silent ? 'silence' : ENCOUNTERS[encounter].music;
      return { zone, paused };
    }
    const chapter = this.chapter();
    // Entrée de Badu : silence absolu jusqu'au déclic du mousquet, puis les tambours explosent.
    if (chapter === 'prologue') {
      const silent = this.prologueDuel() && this.introTime > 0 && !this.baduClick;
      return { zone: silent ? 'silence' : this.prologueDuel() ? 'duel-badu' : 'feyiase', paused };
    }
    if (chapter === 'battle') return { zone: 'duel-ford', paused };
    if (chapter === 'crossing') return { zone: 'river', paused };
    if (this.decision()) return { zone: 'duel-sluice', paused };
    return {
      zone: 'village', paused,
      player: { x: this.playerEntity.centerX, y: this.playerEntity.centerY },
      nextArena: { x: SLUICE_DUEL.x, y: SLUICE_DUEL.y, zone: 'duel-sluice' },
    };
  }

  /**
   * Boss Rush / défi : enchaîne les boss demandés sans l'exploration. Les PV
   * sont conservés d'un boss à l'autre, les mixtures et flèches rechargées.
   */
  startBossRush(plan: EncounterId[], mode: 'rush' | 'challenge' = 'rush') {
    if (!plan.length) return;
    this.startGame();
    this.mode.set(mode);
    this.rushPlan = [...plan];
    this.rushNext = plan.slice(1);
    this.enterEncounter(plan[0]);
  }

  private enterEncounter(id: EncounterId) {
    const config = ENCOUNTERS[id];
    const arena = config.arena;
    this.activeEncounter.set(id);
    this.pendingEncounter.set(null);
    this.chapter.set(config.boss === 'champion' ? 'prologue' : config.form === 'guardian' ? 'village' : 'battle');
    this.prologueDuel.set(config.boss === 'champion');
    this.visited.set(config.form === 'guardian' ? 2 : 0);
    this.decision.set(config.form === 'guardian' ? 'expose' : null);
    this.dialogueId.set(null);
    this.counterTime.set(0);
    this.bossStore.reset();
    this.bossEntity.configure(config.boss);
    this.playerEntity.resetCombat();
    this.groundEffects.reset();
    this.arrows.reset();
    this.equipment.refill();
    this.terrain.setArena(arena);
    this.bossRewarded = false;
    this.defeatShot = false;
    this.baduClick = false;
    const half = PLAYER_CONFIG.size / 2;
    this.playerStore.update({
      x: arena.x - 180 - half, y: arena.y + 20 - half, vx: 0, vy: 0, facingX: 1, facingY: 0, state: 'idle', stateTimer: 0,
    });
    this.bossStore.update({
      x: arena.x + 80 - BOSS_CONFIG.size / 2, y: arena.y - BOSS_CONFIG.size / 2,
      facingX: -1, facingY: 0, hp: config.hp, maxHp: config.hp, stateTimer: 1150,
    });
    this.camera.snapTo(this.playerEntity.centerX, this.playerEntity.centerY);
    this.beginBossIntro();
  }

  startGame() {
    this.dying = 0;
    this.mode.set('story');
    this.activeEncounter.set(null);
    this.pendingEncounter.set(null);
    this.rushNext = [];
    this.rushTransition = 0;
    this.uiLock.set(false);
    this.destructibles.reset();
    this.stopGame();
    this.visited.set(0);
    this.chapter.set('battle');
    this.terrain.setArena(FORD_DUEL);
    this.decision.set(null);
    this.dialogueId.set(null);
    this.storyFlags.set({});
    this.near.set(false);
    this.counterTime.set(0);
    this.playerEntity.resetCombat();
    this.groundEffects.reset();
    this.arrows.reset();
    this.equipment.reset();
    this.fx.reset();
    this.view3d?.resetFx();
    this.view3d?.clearTraces();
    this.playerHitThisFrame = false;
    this.bossHitThisFrame = false;
    this.playerStore.reset();
    this.bossStore.reset();
    this.bossEntity.configure(true);
    // Départ face à face, de part et d'autre du centre de l'arène agrandie.
    const half = PLAYER_CONFIG.size / 2;
    this.playerStore.update({ x: FORD_DUEL.x - 180 - half, y: FORD_DUEL.y + 20 - half, facingX: 1 });
    this.bossStore.update({
      x: FORD_DUEL.x + 80 - BOSS_CONFIG.size / 2, y: FORD_DUEL.y - BOSS_CONFIG.size / 2,
      hp: 148, maxHp: 148, stateTimer: 1150,
    });

    // Précharge les sprites (fire-and-forget) : le jeu tourne en fallback
    // formes et les sprites apparaissent dès qu'ils sont chargés.
    void this.assets.load(SPRITE_MANIFEST);

    // Centre la caméra sur le joueur dès le départ.
    this.camera.snapTo(this.playerEntity.centerX, this.playerEntity.centerY);

    this.beginBossIntro();
    this._currentScreen.set('playing');
    this.gameloop.onUpdate(this.updateCallback);
    this.gameloop.onRender(this.renderCallback);
    this.gameloop.start();
  }

  /**
   * Nouvelle partie : prologue de 1701, puis le gué de 1824 (finishPrologue).
   * Même mise en place que startGame, sans duel ni entrée de boss.
   */
  startPrologue() {
    this.startGame();
    this.introPending = false;
    this.introTime = 0;
    this.enterPrologue();
    this.prologue.begin();
    this.prologue.placeAtStart();
    this.camera.snapTo(this.playerEntity.centerX, this.playerEntity.centerY);
    this.souls.enterChapter('prologue', 0);
  }

  private enterPrologue() {
    this.chapter.set('prologue');
    this.prologueDuel.set(false);
    this.defeated.set(null);
    this.terrain.setArena(null);
    this.bossStore.reset();
    this.bossEntity.configure(false);
    // Les soldats du Denkyira sont des ennemis de terrain (EnemiesService).
    this.slice.resetWorld();
    // L'accroche du gué (1824) attend la fin du prologue.
    this.slice.hookLine.set(null);
    this.prologue.resume();
    this.prologue.equip();
  }

  /** Le héros arrive sur la crête : entrée du porte-hache, arène fermée. */
  private startPrologueDuel() {
    this.prologueDuel.set(true);
    this.prologue.duelTries++;
    this.terrain.setArena(PROLOGUE_DUEL);
    this.bossStore.reset();
    this.bossEntity.configure('champion');
    this.bossRewarded = false;
    this.defeatShot = false;
    this.baduClick = false;
    this.counterTime.set(0);
    this.bossStore.update({
      x: PROLOGUE_DUEL.x + 95 - BOSS_CONFIG.size / 2, y: PROLOGUE_DUEL.y - 20 - BOSS_CONFIG.size / 2,
      facingX: -1, facingY: 0, hp: 170, maxHp: 170, stateTimer: 1150,
    });
    // Le héros s'avance au centre pendant l'entrée : la caméra reste dans l'arène.
    this.prologue.place({ x: PROLOGUE_DUEL.x - 70, y: PROLOGUE_DUEL.y + 10 }, 1, 0);
    this.beginBossIntro();
  }

  /**
   * Entrée de Badu, sans coupure : de dos au milieu des morts, il entend les
   * pas, tourne la tête (le regard suit déjà le joueur), pivote lentement,
   * plante sa hache, épaule le mousquet ; le chien claque, le duel commence.
   */
  private baduIntroPose(pose: Actor3D, k: number) {
    const toPlayer = Math.atan2(this.playerEntity.centerX - pose.x, this.playerEntity.centerY - pose.y);
    const away = toPlayer + Math.PI;
    const turn = Math.max(0, Math.min(1, (k - 0.42) / 0.2));
    const eased = turn * turn * (3 - 2 * turn);
    const yaw = away + (toPlayer - away) * eased;
    pose.facingX = Math.sin(yaw);
    pose.facingY = Math.cos(yaw);
    if (k < 0.66) {
      pose.state = 'idle';
      pose.phase = 0;
    } else {
      pose.state = 'windup';
      pose.attack = 'shot';
      pose.phase = Math.min(1, (k - 0.66) / 0.26);
    }
    if (k >= 0.88 && !this.baduClick) {
      // Le chien du mousquet claque dans le silence.
      this.baduClick = true;
      this.baduSfx.cock();
    }
  }
  private baduClick = false;

  private bossDeathK = 0;

  /**
   * Poids de la chute du boss : poussière quand le genou touche terre, puis
   * quand le corps tombe (combattants humains) ; gerbe d'eau quand le Gardien
   * s'effondre dans la vase.
   */
  private deathImpacts() {
    const k = this.bossEntity.progress();
    const was = this.bossDeathK;
    this.bossDeathK = k;
    const crossed = (at: number) => was < at && k >= at;
    const x = this.bossEntity.centerX;
    const y = this.bossEntity.centerY;
    const boss = this.bossStore.getData();
    if (this.bossEntity.id === 'guardian') {
      if (crossed(0.45)) {
        this.fx.quake(x, y, 40, 'wet', 1.2);
        this.groundEffects.emit(x, y, 26, 0, 0, true);
        this.rendered.shake(10);
      }
      return;
    }
    if (crossed(0.36)) {
      this.fx.dust(x, y, 0, 0, 1.2);
      this.rendered.shake(4);
    }
    if (crossed(0.8)) {
      const fx = x + boss.facingX * 22;
      const fy = y + boss.facingY * 22;
      this.fx.dust(fx, fy, boss.facingX, boss.facingY, 2.6);
      this.fx.mark(fx, fy, 18, 'crack');
      this.fx.sfx.quake(0.7);
      this.rendered.shake(9);
    }
  }

  /** Une fois par mort de boss : plan de caméra « vaincu » et annonce. */
  private playDefeat() {
    if (this.defeatShot) return;
    this.defeatShot = true;
    this.bossDeathK = 0;
    const boss = { x: this.bossEntity.centerX, y: this.bossEntity.centerY };
    // Le Gardien n'est pas tué : le dernier nœud cède et il retourne au fleuve.
    this.defeated.set({ name: this.bossEntity.lore.name,
      label: this.bossEntity.id === 'guardian' ? 'Esprit libéré'
        : this.bossEntity.id === 'champion' ? 'Ennemi majeur abattu' : 'Adversaire vaincu' });
    if (this.prologueDuel()) {
      this.playStory('badu-fall', boss);
    } else {
      this.view3d?.playDefeatShot({ x: this.playerEntity.centerX, y: this.playerEntity.centerY }, boss);
      this.gameloop.slowMotion(0.35, 700);
    }
  }

  private prologueEnding = false;

  /** Arrivée au camp lue : on enchaîne sur l'acte I, accroche du gué comprise. */
  private finishPrologue() {
    if (this.prologueEnding) return;
    this.prologueEnding = true;
    // Hors de la boucle en cours : startGame la redémarre.
    setTimeout(() => {
      this.prologueEnding = false;
      this.prologue.finished.set(false);
      this.startGame();
      this.slice.hookLine.set(0);
      this.souls.enterChapter('battle', 0);
    });
  }

  stopGame() {
    this.hitIndicator = null;
    this.terrain.setArena(null);
    this.gameloop.stop();
    this.gameloop.offUpdate(this.updateCallback);
    this.gameloop.offRender(this.renderCallback);
  }

  returnToMainMenu() {
    this._currentScreen.set('main-menu');
  }

  openDuel() {
    this._currentScreen.set('duel');
  }

  retry() {
    const mode = this.mode();
    if (mode === 'story') this.respawn();
    else this.startBossRush(this.rushPlan, mode);
  }

  death() {
    this._currentScreen.set('death');
  }

  //Detecter les collisions dans les attaques
  private checkCollision() {
    const player = this.playerStore.getData();
    const boss = this.bossStore.getData();

    // Réarme le coup du joueur entre deux swings.
    if (player.state !== 'attacking') {
      this.bossHitThisFrame = false;
    }

    //Si jamais le player attack le boss et que les deux se chevauchent.

    // Chronologie de l'attaque : la hitbox ne vit que pendant les frames actives.
    // Si une image lente saute toute la fenêtre active, l'événement
    // 'active-start' garantit quand même un test de touche.
    const attackData = this.playerEntity.getActiveAttackData();
    const frame = player.state === 'attacking' ? attackFrame(attackData, attackData.duration - player.stateTimer) : null;
    const events = this.playerAttackEvents.update(frame ? `${player.attackType}${player.comboCount}` : null, frame);
    if (frame && !this.bossHitThisFrame) {
      if (!frame.hitbox && !events.includes('active-start')) return;
      const counterContact = player.attackType === 'counter' &&
        Math.hypot(this.playerEntity.centerX - this.bossEntity.centerX, this.playerEntity.centerY - this.bossEntity.centerY) < 67;
      if (counterContact || this.playerStrikeReaches(player, attackData)) {
        const knockbackX = player.facingX * 150;
        const knockbarY = player.facingY * 150;

        const backstab = this.isBackstab(boss);
        this.bossEntity.takeDamage(this.slice.meleeDamage(attackData.damage), knockbackX, knockbarY, player.attackType === 'counter',
          { weight: player.attackType as HitWeight, backstab, poise: this.prologue.poiseBonus() });
        this.dilateOnCriticalHit(backstab ? 'backstab' : player.attackType === 'counter' ? 'counter' : null);
        this.groundEffects.emit(this.bossEntity.centerX, this.bossEntity.centerY, 7, player.facingX, player.facingY);
        const guarded = boss.state !== 'recover' && player.attackType !== 'counter';
        const heavy = player.attackType !== 'light';
        const finisher = player.attackType === 'light' && player.comboCount >= 3;
        this.rendered.shake(guarded ? 2 : heavy ? 8 : 4);
        // Hitstop 40–80 ms : attaquant et cible figés (la boucle logique est suspendue).
        // Micro-gel : ~70 ms sur un coup franc, plus long sur un coup lourd.
        this.gameloop.freeze(guarded ? 45 : heavy ? 85 : finisher ? 75 : 70);
        const duelist = this.bossEntity.id.startsWith('duel');
        const style: StrikeStyle = player.attackType === 'heavy' ? 'slam'
          : player.attackType === 'counter' || finisher ? 'thrust' : 'slash';
        const material: ImpactMaterial = duelist ? guarded ? 'guard' : 'flesh' : guarded ? 'shell' : 'spirit';
        const bx = this.bossEntity.centerX;
        const by = this.bossEntity.centerY;
        this.fx.hit({ x: bx - player.facingX * 8, y: by - player.facingY * 8, height: duelist ? 22 : 14,
          dirX: player.facingX, dirY: player.facingY, material, style, target: 'boss',
          strength: guarded ? 0.5 : player.attackType === 'counter' ? 1.5 : heavy ? 1.4 : finisher ? 1.1 : 0.9 });
        if (player.attackType === 'counter') this.fx.flash(bx, by, '#bff8ff', 4.5, 0.12);
        if (player.attackType === 'heavy' && !guarded) this.fx.mark(bx, by, 16, duelist ? 'crack' : 'wet');
        this.bossHitThisFrame = true;
      }
    }
  }

  /**
   * Le coup du joueur atteint-il le boss ? Portée mesurée de centre à centre
   * (corps du joueur + allonge de l'arme + rayon du boss) dans un arc de
   * ~140° devant le joueur ; au corps à corps l'angle ne compte plus. Plus
   * juste que l'ancienne boîte carrée, qui touchait en diagonale et ratait
   * de face selon l'orientation.
   */
  private playerStrikeReaches(player: PlayerData, attackData: AttackData) {
    const dx = this.bossEntity.centerX - this.playerEntity.centerX;
    const dy = this.bossEntity.centerY - this.playerEntity.centerY;
    const distance = Math.hypot(dx, dy);
    const bossRadius = BOSS_CONFIG.size * 0.42;
    const reach = PLAYER_CONFIG.size / 2 + attackData.range * PLAYER_CONFIG.size + bossRadius;
    if (distance > reach) return false;
    if (distance < bossRadius + PLAYER_CONFIG.size / 2 + 4) return true;
    const facing = Math.hypot(player.facingX, player.facingY) || 1;
    const cosine = (dx * player.facingX + dy * player.facingY) / (distance * facing);
    return cosine > Math.cos(70 * Math.PI / 180);
  }

  //Le boss touche-t-il le joueur pendant la phase active de son attaque ?
  private checkBossAttack() {
    const boss = this.bossStore.getData();
    const player = this.playerStore.getData();

    // Réarme le coup du boss entre deux attaques.
    if (boss.state !== 'attacking') {
      this.playerHitThisFrame = false;
      this.bossStrikeSeen = -1;
      return;
    }

    // Combo : chaque coup peut toucher. Double vague : chaque anneau aussi.
    const strike = boss.currentAttack === 'tide'
      ? (attackProgress('tide', boss.stateTimer) >= 0.38 ? 1 : 0)
      : boss.comboStep;
    if (strike !== this.bossStrikeSeen) {
      this.bossStrikeSeen = strike;
      this.playerHitThisFrame = false;
    }

    if (this.playerHitThisFrame || player.state === 'dead') {
      return;
    }

    const cfg = this.bossAttackConfig(boss.currentAttack);
    if (!cfg) return;
    const attackName = boss.currentAttack as Exclude<BossAttackType, 'none'>;
    if (!isBossHitActive(attackName, attackProgress(attackName, boss.stateTimer))) return;

    const dxToPlayer = this.playerEntity.centerX - this.bossEntity.centerX;
    const dyToPlayer = this.playerEntity.centerY - this.bossEntity.centerY;
    // Zone de vulnérabilité du joueur un peu plus petite que son modèle (hitbox indulgente).
    const distance = Math.hypot(dxToPlayer, dyToPlayer) + 4;
    const size = BOSS_CONFIG.size;
    const along = (dxToPlayer * boss.facingX + dyToPlayer * boss.facingY) / (distance || 1);
    const across = Math.abs(dxToPlayer * boss.facingY - dyToPlayer * boss.facingX);
    const ahead = (offset: number, radius: number) => Math.hypot(
      dxToPlayer - boss.facingX * offset, dyToPlayer - boss.facingY * offset) + 4 < radius;
    const progress = attackProgress(attackName, boss.stateTimer);
    // Coups de Badu Ofosu : chaque forme suit le geste de l'animation.
    const baduHit = (): boolean | null => {
      switch (attackName) {
        case 'reap': return distance < cfg.range * size + 9 && along > -0.25;
        case 'judgment': return ahead(38, cfg.range * size / 2 + 6);
        case 'feint': return distance < cfg.range * size && along > 0.3;
        case 'backhand': return distance < cfg.range * size && along < 0.2;
        case 'thrust': return along > 0 && distance < cfg.range * size + 9 && across < 22;
        case 'leap': return distance < cfg.range * size / 2;
        case 'furrow': return progress < 0.8 ? distance < size * 0.75 : distance < size * 1.6 && along > 0.2;
        case 'mill': {
          const step = boss.comboStep;
          if (step === 2) return distance < size * 1.4;
          if (step === 3) return ahead(40, 58);
          return distance < cfg.range * size + 9 && along > 0.1;
        }
        default: return null;
      }
    };
    const badu = baduHit();
    let bulletX = boss.facingX;
    let bulletY = boss.facingY;
    // Mousquet ensorcelé : une balle (trois en phase 3) en ligne droite depuis le boss.
    const shotHit = () => shotAngles(boss.phase).some((angle) => {
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      const fx = boss.facingX * c - boss.facingY * sn;
      const fy = boss.facingX * sn + boss.facingY * c;
      const along = dxToPlayer * fx + dyToPlayer * fy;
      const across = Math.abs(dxToPlayer * fy - dyToPlayer * fx);
      if (along > 0 && along < cfg.range * size && across < SHOT_WIDTH + 8) {
        bulletX = fx;
        bulletY = fy;
        return true;
      }
      return false;
    });
    const hit = badu !== null ? badu
      : boss.currentAttack === 'shot' ? shotHit()
      : boss.currentAttack === 'surge'
      ? Math.abs(distance - surgeRadius(size, boss.stateTimer)) <= SURGE_WIDTH + 8
      : boss.currentAttack === 'tide'
      ? tideRadii(size, boss.stateTimer).some((radius) => Math.abs(distance - radius) <= SURGE_WIDTH + 8)
      : boss.currentAttack === 'charge' ? distance < size * 0.7
      : cfg.hitBoxType === 'aoe' ? distance < cfg.range * size / 2
      : distance < Math.min(cfg.range * size, size * 2.2) + 9 &&
          dxToPlayer * boss.facingX + dyToPlayer * boss.facingY > distance * 0.22;
    if (hit) {
      if (player.invicible) {
        this.playerHitThisFrame = true;
        if (this.playerEntity.inPerfectDodge(player)) {
          this.counterTime.set(0.85);
          this.fx.parry(this.playerEntity.centerX, this.playerEntity.centerY);
          this.gameloop.slowMotion(TIME_DILATION.perfectDodge.scale, TIME_DILATION.perfectDodge.ms);
        }
        return;
      }

      // La balle de Badu emporte 70 % de la vie et projette au sol ; l'estoc et la crosse vident l'endurance.
      const shot = boss.currentAttack === 'shot';
      const dx = shot ? bulletX : dxToPlayer;
      const dy = shot ? bulletY : dyToPlayer;
      const len = Math.hypot(dx, dy) || 1;
      const knockback = shot ? 460 : boss.currentAttack === 'judgment' || boss.currentAttack === 'leap' ? 320 : 220;
      const damage = shot ? Math.round(player.maxHp * SHOT_DAMAGE_RATIO) : cfg.damage;

      this.playerEntity.takeDamage(
        damage,
        (dx / len) * knockback,
        (dy / len) * knockback,
      );
      this.markHitDir(dx / len, dy / len, shot ? 'shot' : 'melee');
      if (boss.currentAttack === 'thrust' || boss.currentAttack === 'feint') this.playerStore.update({ stamina: 0 });
      this.lastHitBy = KILL_HINTS[boss.currentAttack] ?? `Frappé par ${this.bossEntity.lore.name}.`;
      this.groundEffects.emit(this.playerEntity.centerX, this.playerEntity.centerY, 8, dx / len, dy / len);
      this.rendered.shake(shot ? 22 : 14);
      // Micro-gel de 60 à 80 ms : les coups lourds pèsent plus.
      this.gameloop.freeze(shot || boss.currentAttack === 'judgment' || boss.currentAttack === 'leap' ? 80 : 65);
      const attack = boss.currentAttack;
      const ground = attack === 'slam' || attack === 'surge' || attack === 'tide';
      this.fx.hit({ x: this.playerEntity.centerX, y: this.playerEntity.centerY, height: 20,
        dirX: dx / len, dirY: dy / len, material: 'flesh', target: 'player',
        style: ground ? 'slam' : attack === 'charge' || attack === 'shot' ? 'thrust' : 'slash', strength: attack === 'slam' ? 1.8 : 1.5 });
      this.playerHitThisFrame = true;
    }
  }

  private bossAttackConfig(name: string): BossAttackData | null {
    if (name === 'none' || !(name in BOSS_ATTACKS)) return null;
    return BOSS_ATTACKS[name as Exclude<BossAttackType, 'none'>];
  }

  /**
   * Entrée du boss (vue 3D seulement) : combat figé, plan bas sur le boss,
   * carton du nom et barre de vie qui se remplit, puis retour au joueur.
   * Point d'accroche pour le son d'entrée du boss.
   */
  private beginBossIntro() {
    if (this.prologueDuel() && this.narrative.seen('badu-entrance')) {
      this.introPending = false;
      this.introTime = 0;
      return;
    }
    this.introPending = true;
    this.introTime = 0;
    if (this.prologueDuel()) this.narrative.play('badu-entrance');
  }

  /** Avancement 0→1 de l'entrée du boss, null hors intro. */
  get introProgress(): number | null {
    return this.introTime > 0 ? 1 - this.introTime / this.introLength() : null;
  }

  update(deltaTime: number) {
    this.narrative.tick();
    if (this.dialogue() || this.uiLock() || this.narrative.blocking()) return;
    // Mort du joueur : il tombe au ralenti, l'image s'éteint, puis l'écran de mort.
    if (this.dying > 0) {
      this.dying = Math.max(0, this.dying - deltaTime / this.gameloop.timeScale);
      if (this.dying === 0) this.onPlayerDeath();
      return;
    }
    // Accroche d'ouverture et menu du foyer : le monde attend.
    if (this.slice.tickHook(deltaTime) || this.slice.blocking()) return;
    if (this.chapter() === 'prologue') {
      // Une mixture de soin avalée : le trophée « L'Éternel » est perdu pour ce chapitre.
      const mixture = this.equipment.getData().mixture;
      if (mixture < this.lastMixture && this.playerStore.getData().state === 'drinking') this.prologue.healed = true;
      this.lastMixture = mixture;
      // Râle du tambourinaire tant qu'on ne lui a pas parlé : on l'entend avant de le voir.
      if (!this.prologue.hasRead('tambourinaire')) {
        const near = Math.hypot(DRUMMER.x - this.playerEntity.centerX, DRUMMER.y - this.playerEntity.centerY);
        this.drummerMoan -= deltaTime;
        if (near < 260 && this.drummerMoan <= 0) {
          this.drummerMoan = 3.5 + Math.random() * 2;
          this.baduSfx.grunt(0.45 * (1 - near / 300), 1.1);
        }
      }
      this.prologue.update(deltaTime);
      if (this.prologue.finished()) this.finishPrologue();
      if (this.prologue.blocking()) return;
      if (!this.prologueDuel() && !this.narrative.active()) {
        const vista = CLEARINGS.find((c) => c.id === 'ligne');
        if (vista && Math.hypot(vista.x - this.playerEntity.centerX, vista.y - this.playerEntity.centerY) < 120) {
          this.playStory('vista', vista);
        }
      }
      if (!this.prologueDuel() && this.prologue.duelDue()) this.startPrologueDuel();
    }
    if (this.rushTransition > 0) {
      this.rushTransition -= deltaTime;
      if (this.rushTransition <= 0) {
        const next = this.pendingEncounter();
        if (next) this.enterEncounter(next);
      }
    }
    if (this.introPending && this.view3d && this.inCombat()) {
      this.introPending = false;
      this.introTime = this.introLength();
      this.view3d?.setIntroDuration(this.introLength() * 1000);
    }
    if (this.introTime > 0) {
      this.introTime = Math.max(0, this.introTime - deltaTime);
      this.view3d?.setIntro(this.introProgress);
      if (this.introTime === 0 && this.narrative.active()?.id === 'badu-entrance') this.narrative.finish();
      return;
    }
    this.view3d?.setIntro(null);

    this.groundEffects.update(deltaTime);
    const inCombat = this.inCombat();
    if (this.defeatShot && this.bossStore.getData().state !== 'dead') {
      this.defeatShot = false;
      this.defeated.set(null);
    }
    this.destructibles.update(deltaTime, inCombat);
    const counter = this.counterTime();
    if (counter > 0) this.counterTime.set(Math.max(0, counter - deltaTime));
    if (counter > 0 && this.playerEntity.tryCounter(this.bossEntity.centerX, this.bossEntity.centerY)) {
      this.counterTime.set(0);
      this.bossHitThisFrame = false;
    }
    const px = this.playerEntity.centerX;
    const py = this.playerEntity.centerY;
    this.slice.setFieldActive(this.mode() === 'story' &&
      (this.chapter() === 'village' || this.chapter() === 'prologue') && !inCombat);
    this.tickLock(deltaTime);
    const locked = this.lockedEnemy();
    this.playerEntity.update(deltaTime, inCombat
      ? { x: this.bossEntity.centerX, y: this.bossEntity.centerY }
      : locked ? { x: locked.x, y: locked.y } : this.slice.aimTarget());
    this.slice.spinFacing();
    this.slice.update(deltaTime, inCombat);
    if (this.mode() === 'story' && this.soulsTick(inCombat)) return;
    this.updateArrows(deltaTime, inCombat);
    const player = this.playerStore.getData();
    this.playerFeel(player);
    this.groundEffects.track(0, this.playerEntity.centerX, this.playerEntity.centerY,
      this.playerEntity.centerX - px, this.playerEntity.centerY - py,
      player.state === 'rolling' || player.attackType === 'counter');
    const target = this.objective();
    if (inCombat) {
      const bx = this.bossEntity.centerX;
      const by = this.bossEntity.centerY;
      const before = this.bossStore.getData();
      this.bossEntity.update(deltaTime * (counter > 0 ? 0.28 : 1));
      const boss = this.bossStore.getData();
      const charge = boss.state === 'attacking' && boss.currentAttack === 'charge';
      this.groundEffects.track(1, this.bossEntity.centerX, this.bossEntity.centerY,
        this.bossEntity.centerX - bx, this.bossEntity.centerY - by, charge);
      if (before.state !== 'shift' && boss.state === 'shift') {
        // Changement de phase : onde de choc, gel bref, secousse forte.
        this.groundEffects.emit(bx, by, 24, 0, 0, !this.bossEntity.id.startsWith('duel'));
        this.rendered.shake(16);
        this.gameloop.freeze(120);
        const duelist = this.bossEntity.id.startsWith('duel');
        this.fx.quake(bx, by, 46, duelist ? 'scorch' : 'wet', 1.3);
        this.fx.flash(bx, by, duelist ? '#ff9a4a' : '#7fe3d0', 6, 0.22, 30);
        if (this.prologueDuel()) {
          this.playStory('badu-phase');
        } else {
          this.view3d?.playPhaseShot({ x: px, y: py },
            () => ({ x: this.bossEntity.centerX, y: this.bossEntity.centerY }), BOSS_CONFIG.shiftDuration * 0.8);
        }
      }
      if (boss.state === 'shift') this.pushPlayerFromBoss(deltaTime);
      if (before.state === 'windup' && boss.state === 'attacking') {
        if (boss.currentAttack === 'slam' || boss.currentAttack === 'surge' || boss.currentAttack === 'tide') {
          this.groundEffects.emit(bx, by, 18, 0, 0, boss.currentAttack !== 'slam');
          const slam = boss.currentAttack === 'slam';
          const duelist = this.bossEntity.id.startsWith('duel');
          this.fx.quake(bx + boss.facingX * (slam ? 22 : 0), by + boss.facingY * (slam ? 22 : 0),
            slam ? 26 : 34, duelist ? 'crack' : 'wet', slam ? 1 : 0.8);
          // Le sabre du capitaine frappe la pierre : la poudre de sa giberne s'enflamme et couve.
          if (slam && duelist) this.view3d?.scatterEmbers(bx + boss.facingX * 22, by + boss.facingY * 22, 16, 20);
        } else if (boss.currentAttack === 'sweep') {
          this.groundEffects.emit(bx, by, 14, 0, 0);
        } else if (charge) {
          this.groundEffects.emit(bx, by, 9, -boss.facingX, -boss.facingY);
        }
      }
      this.soundBossSwing(boss);
      if (this.bossEntity.id === 'champion') {
        this.baduImpacts(before, boss);
        this.baduAudio(before, boss, deltaTime);
      }
      this.telegraphPerilous(boss);
      if (this.view3d) this.separateFighters();
      this.checkCollision();
      this.checkBossAttack();
      this.checkEndConditions();
    } else {
      const near = this.chapter() !== 'prologue' && !this.slice.objective() && Math.hypot(target.x - this.playerEntity.centerX, target.y - this.playerEntity.centerY) < 75;
      this.near.set(near);
    }

    const x = this.playerEntity.centerX;
    const y = this.playerEntity.centerY;
    if (this.inCombat()) {
      const shot = this.humanBoss() ? this.fordShot : this.sluiceShot;
      this.camera.frameCombat(x, y, this.bossEntity.centerX, this.bossEntity.centerY, deltaTime, x - px, y - py, shot);
    } else {
      this.camera.follow(x, y, deltaTime);
    }
  }

  /** Coup porté dans le dos du boss (hors attaque : il ne fait pas face). */
  private isBackstab(boss: { state: string; facingX: number; facingY: number }) {
    if (boss.state === 'attacking' || boss.state === 'shift') return false;
    const dx = this.playerEntity.centerX - this.bossEntity.centerX;
    const dy = this.playerEntity.centerY - this.bossEntity.centerY;
    const distance = Math.hypot(dx, dy) || 1;
    const facing = Math.hypot(boss.facingX, boss.facingY) || 1;
    return (dx * boss.facingX + dy * boss.facingY) / (distance * facing) < BACKSTAB.cosine;
  }

  /** Ralenti bref : coup de grâce sur le boss, coup dans le dos, riposte. */
  private dilateOnCriticalHit(kind: 'backstab' | 'counter' | null) {
    const dilation = this.bossStore.getData().state === 'dead' ? TIME_DILATION.finisher
      : kind ? TIME_DILATION[kind] : null;
    if (dilation) this.gameloop.slowMotion(dilation.scale, dilation.ms);
  }

  private perilousRung = false;

  /** Son aigu au moment où l'éclat apparaît, avant une attaque imparable. */
  private telegraphPerilous(boss: { state: string; currentAttack: string }) {
    if (boss.state !== 'windup') {
      this.perilousRung = false;
      return;
    }
    if (this.perilousRung || this.bossEntity.progress() < 0.75) return;
    if (!isPerilous(this.bossEntity.id, boss.currentAttack)) return;
    this.perilousRung = true;
    this.fx.sfx.glint();
  }

  /** Flèches en vol : impacts sur le boss, chute au sol, ramassage par le joueur. */
  private updateArrows(deltaTime: number, inCombat: boolean) {
    this.equipment.tick();
    const boss = this.bossStore.getData();
    const target = inCombat && boss.state !== 'dead'
      ? { x: this.bossEntity.centerX, y: this.bossEntity.centerY, radius: BOSS_CONFIG.size * 0.42 }
      : null;
    const arena = inCombat ? this.duelArena() : null;
    // Hors duel : les flèches visent les ennemis de la tranche et butent sur ses murs.
    const field = inCombat ? null : this.slice.arrowTargets();
    const hits = this.arrows.update(deltaTime, field ?? target,
      { x: this.playerEntity.centerX, y: this.playerEntity.centerY }, arena, this.slice.arrowBlocked);
    if (field) {
      hits.forEach((hit) => this.slice.onArrowHit(hit));
      return;
    }
    for (const hit of hits) {
      this.bossEntity.takeDamage(this.slice.arrowDamage(hit.damage), hit.dirX * 60, hit.dirY * 60, false, { weight: 'arrow' });
      this.view3d?.stickArrow(this.bossEntity.id.startsWith('duel'), hit.x, hit.y, hit.dirX, hit.dirY);
      this.dilateOnCriticalHit(null);
      this.groundEffects.emit(hit.x, hit.y, 4, hit.dirX, hit.dirY);
      this.rendered.shake(hit.damage > 15 ? 4 : 2);
      this.gameloop.freeze(hit.damage > 15 ? 50 : 40);
      const duelist = this.bossEntity.id.startsWith('duel');
      this.fx.hit({ x: hit.x, y: hit.y, height: 18, dirX: hit.dirX, dirY: hit.dirY, target: 'boss', style: 'thrust',
        material: duelist ? 'flesh' : this.bossEntity.isExposed() ? 'spirit' : 'shell',
        strength: hit.damage > 15 ? 0.8 : 0.55 });
    }
  }

  /**
   * Souffle du swing et poussière de roulade du joueur, déclenchés sur les
   * transitions d'état (aucun coût hors de ces instants).
   */
  private playerFeel(player: PlayerData) {
    const x = this.playerEntity.centerX;
    const y = this.playerEntity.centerY;
    if (player.state === 'attacking') {
      const attack = this.playerEntity.getActiveAttackData(player);
      const key = `${player.attackType}${player.comboCount}`;
      if (attack.duration - player.stateTimer >= attack.windup && key !== this.swingKey) {
        this.swingKey = key;
        this.fx.swing(player.attackType !== 'light');
      }
    } else {
      this.swingKey = '';
    }
    if (player.state === 'rolling') {
      const backstep = this.playerEntity.dodgeKind === 'backstep';
      if (this.lastPlayerState !== 'rolling') {
        this.rollLanded = false;
        this.fx.dust(x, y, player.vx, player.vy, backstep ? 0.5 : 1);
      } else if (!this.rollLanded && !backstep && player.stateTimer < this.playerEntity.dodgeDuration * 0.35) {
        // Réception de la roulade : second nuage, sans son.
        this.rollLanded = true;
        this.fx.dust(x, y, player.vx, player.vy, 0.7, false);
      }
    }
    this.lastPlayerState = player.state;
  }

  /** Souffle de l'arme du boss à chaque coup (combo : à chaque frappe). */
  private soundBossSwing(boss: ReturnType<BossStore['getData']>) {
    if (boss.state !== 'attacking' || boss.currentAttack === 'surge' || boss.currentAttack === 'tide') {
      this.bossSwingKey = '';
      return;
    }
    const key = `${boss.currentAttack}${boss.comboStep}`;
    if (key === this.bossSwingKey) return;
    this.bossSwingKey = key;
    this.fx.swing(true);
  }

  /**
   * Badu : moments d'impact au sol (hache abattue, réception du saut,
   * écrasement final du moulinet, uppercut du sillon) et étincelles de la
   * hache traînée sur la pierre.
   */
  private baduImpacts(before: ReturnType<BossStore['getData']>, boss: ReturnType<BossStore['getData']>) {
    if (boss.state !== 'attacking' || boss.currentAttack === 'none') return;
    const attack = boss.currentAttack as Exclude<BossAttackType, 'none'>;
    const now = attackProgress(attack, boss.stateTimer);
    const was = before.state === 'attacking' && before.currentAttack === attack
      ? attackProgress(attack, before.stateTimer) : -1;
    const crossed = (at: number) => was < at && now >= at;
    const x = this.bossEntity.centerX + boss.facingX * 34;
    const y = this.bossEntity.centerY + boss.facingY * 34;
    const slam = (radius: number, strength: number, shake: number) => {
      this.fx.quake(x, y, radius, 'crack', strength);
      this.fx.dust(x, y, boss.facingX, boss.facingY, 2.2);
      this.groundEffects.emit(x, y, radius * 0.6, 0, 0);
      this.rendered.shake(shake);
    };
    if (attack === 'judgment' && crossed(0.25)) slam(34, 1.3, 16);
    if (attack === 'leap' && crossed(0.74)) {
      this.fx.quake(this.bossEntity.centerX, this.bossEntity.centerY, 46, 'crack', 1.5);
      this.fx.dust(this.bossEntity.centerX, this.bossEntity.centerY, 0, 0, 3);
      this.rendered.shake(20);
    }
    if (attack === 'mill' && crossed(0.75 + 0.25 * 0.2)) slam(30, 1.1, 12);
    if (attack === 'furrow') {
      if (crossed(0.8)) slam(26, 1, 12);
      // La hache racle la roche : gerbes d'étincelles pendant la course.
      if (now < 0.8 && Math.floor(now * 14) !== Math.floor(Math.max(0, was) * 14)) {
        this.fx.flash(this.bossEntity.centerX + boss.facingX * 20, this.bossEntity.centerY + boss.facingY * 20, '#ffb347', 3, 0.08, 2);
        this.fx.dust(this.bossEntity.centerX, this.bossEntity.centerY, -boss.facingX, -boss.facingY, 0.6, false);
      }
    }
    if (attack === 'shot' && crossed(0.01)) {
      this.fx.flash(x, y, '#ff7a2e', 8, 0.1, 28);
      this.rendered.shake(18);
    }
  }

  private readonly engine = inject(AudioEngineService);
  /** Bruiterie de Badu (pas, amulettes, hache, souffle, mousquet). */
  private readonly baduSfx = new BaduSfx(() => {
    const context = this.engine.context;
    const destination = this.engine.bus('sfx');
    return context && destination ? { context, destination } : null;
  });
  private baduStride = 0;
  private baduClinkCooldown = 0;
  private baduScrape = 0;

  /** Sons de Badu selon ses changements d'état et ses déplacements. */
  private baduAudio(before: ReturnType<BossStore['getData']>, boss: ReturnType<BossStore['getData']>, dt: number) {
    const sfx = this.baduSfx;
    const attack = boss.currentAttack;
    const entered = (state: string) => before.state !== state && boss.state === state;
    if (entered('windup')) {
      if (attack === 'shot') {
        sfx.cock();
        sfx.hiss(BOSS_ATTACKS.shot.windupDuration / 1000);
      } else if (attack !== 'feint' && attack !== 'backhand' && attack !== 'thrust') {
        sfx.grunt(attack === 'leap' ? 1.4 : 0.9, attack === 'judgment' ? 0.9 : 0.5);
      }
      sfx.clink();
    }
    if (entered('attacking')) {
      if (attack === 'shot') {
        sfx.shot();
        // La balle frôle le joueur sans le toucher : sifflement d'oreille.
        const dx = this.playerEntity.centerX - this.bossEntity.centerX;
        const dy = this.playerEntity.centerY - this.bossEntity.centerY;
        const across = Math.abs(dx * boss.facingY - dy * boss.facingX);
        if (dx * boss.facingX + dy * boss.facingY > 0 && across < 60) sfx.earRing();
      } else if (attack !== 'furrow') {
        sfx.axe(attack === 'judgment' || attack === 'leap' || attack === 'mill' ? 1.3 : 1);
      }
    }
    // Nouveau coup d'un enchaînement : nouveau sifflement.
    if (boss.state === 'attacking' && before.state === 'attacking' && boss.comboStep !== before.comboStep) sfx.axe(1.1);
    if (boss.state === 'attacking' && attack === 'furrow' && attackProgress('furrow', boss.stateTimer) < 0.8) {
      this.baduScrape -= dt;
      if (this.baduScrape <= 0) { this.baduScrape = 0.11; sfx.scrape(); }
    }
    if (entered('recover') && (attack === 'mill' || attack === 'judgment')) sfx.grunt(0.8, attack === 'mill' ? 1.4 : 0.6);
    if (entered('shift')) sfx.grunt(1.6, 1.2);
    if (before.state === 'shift' && boss.state === 'shift') {
      const was = 1 - before.stateTimer / (before.stateLength || 1);
      const now = 1 - boss.stateTimer / (boss.stateLength || 1);
      if (was < 0.42 && now >= 0.42) sfx.crack();
    }
    if (entered('dead')) sfx.grunt(1.2, 1.1);
    // Pas lourds : un appui tous les ~26 unités parcourues.
    const moved = Math.hypot(boss.x - before.x, boss.y - before.y);
    this.baduStride += moved;
    if (this.baduStride > 26) { this.baduStride = 0; sfx.step(boss.phase === 1 ? 0.8 : 1.1); }
    this.baduClinkCooldown -= dt;
    const turn = Math.abs(boss.facingX * before.facingY - boss.facingY * before.facingX);
    if (turn > 0.06 && this.baduClinkCooldown <= 0) { this.baduClinkCooldown = 0.7; sfx.clink(); }
  }

  /** Pendant la transition de phase, le souffle du boss repousse le joueur. */
  private pushPlayerFromBoss(deltaTime: number) {
    const x = this.playerEntity.centerX;
    const y = this.playerEntity.centerY;
    const dx = x - this.bossEntity.centerX;
    const dy = y - this.bossEntity.centerY;
    const distance = Math.hypot(dx, dy);
    if (distance >= BOSS_CONFIG.shiftPushRadius) return;
    const nx = distance > 0.1 ? dx / distance : 1;
    const ny = distance > 0.1 ? dy / distance : 0;
    const push = (BOSS_CONFIG.shiftPushRadius - distance) * 4 * deltaTime;
    const moved = this.terrain.move(x, y, x + nx * push, y + ny * push, 10);
    const half = PLAYER_CONFIG.size / 2;
    this.playerStore.update({ x: moved.x - half, y: moved.y - half });
  }

  private separateFighters() {
    if (this.bossStore.getData().state === 'dead') return;
    const x = this.playerEntity.centerX;
    const y = this.playerEntity.centerY;
    const dx = x - this.bossEntity.centerX;
    const dy = y - this.bossEntity.centerY;
    const distance = Math.hypot(dx, dy);
    const clearance = this.humanBoss() ? 18 : 36;
    if (distance >= clearance) return;
    const player = this.playerStore.getData();
    const gap = clearance - distance;
    const nx = distance > 0.1 ? dx / distance : -(player.facingX || 1);
    const ny = distance > 0.1 ? dy / distance : 0;
    const moved = this.terrain.move(x, y, x + nx * gap, y + ny * gap, 10);
    const halfPlayer = PLAYER_CONFIG.size / 2;
    this.playerStore.update({ x: moved.x - halfPlayer, y: moved.y - halfPlayer });
  }

  // ─────────────────────────────────────────── Boucle soulslike

  /** Cauris des objets cassés, tache de cauris, invite du foyer, mort hors duel. */
  private soulsTick(inCombat: boolean): boolean {
    this.souls.collectFromProps();
    const x = this.playerEntity.centerX;
    const y = this.playerEntity.centerY;
    const recovered = this.souls.tryRecover(x, y);
    if (recovered) this.slice.say(`Cauris retrouvés : +${recovered}`, 2200);
    const player = this.playerStore.getData();
    this.restPrompt.set(inCombat || player.state === 'dead' ? null : this.souls.promptAt(x, y));
    if (!inCombat && player.state === 'dead') {
      this.beginPlayerDeath();
      return true;
    }
    return false;
  }

  /** Les cauris restent au sol là où Ama tombe ; l'ancienne tache disparaît. */
  private onPlayerDeath() {
    if (this.mode() === 'story') {
      const { dropped, lost } = this.souls.die(this.playerEntity.centerX, this.playerEntity.centerY);
      const cauris = dropped ? `${dropped} cauris sont restés là où tu es tombé.${lost ? ` Les ${lost} d’avant sont perdus.` : ''}`
        : lost ? `Les ${lost} cauris laissés plus tôt sont perdus.` : '';
      // Mort lisible : ce qui a frappé, et comment l'éviter.
      this.deathNote.set([this.lastHitBy, cauris].filter(Boolean).join(' ') || null);
    } else {
      this.deathNote.set(null);
    }
    this.stopGame();
    this._currentScreen.set('death');
  }

  // ─────────────────────────────────────────── Verrouillage de cible

  /** Verrouillage hors duel : choix de la menace, changements automatiques (voir TargetLock). */
  private readonly lock = new TargetLock();
  /** Image où le verrou a été avancé (lockedEnemy() est lu plusieurs fois par image). */
  private lockStamp = -1;
  private lockFrame = 0;
  private lockCached: Enemy | null = null;

  private lockView(): LockView {
    return { px: this.playerEntity.centerX, py: this.playerEntity.centerY, heading: this.view3d?.heading ?? 0 };
  }

  /** Ennemi verrouillé encore valable ; le verrou passe seul à la menace suivante ou saute. */
  private lockedEnemy() {
    if (this.lock.id === null) return null;
    if (this.inCombat()) {
      this.lock.release();
      return null;
    }
    if (this.lockStamp !== this.lockFrame) {
      this.lockStamp = this.lockFrame;
      this.lockCached = this.lock.update(this.lockDt, this.slice.enemies.list, this.lockView());
    }
    return this.lock.id === null ? null : this.lockCached;
  }
  private lockDt = 0;

  /** Avance le verrou d'une image (appelé une fois par mise à jour). */
  private tickLock(deltaTime: number) {
    this.lockFrame++;
    this.lockDt = deltaTime;
  }

  /** Un ennemi est verrouillé (verrouillage automatique au premier coup reçu, côté interface). */
  get lockActive() {
    return this.lockedEnemy() !== null;
  }

  /**
   * Touche de verrouillage (Q, clic du stick droit, bouton tactile) : verrouille
   * la menace la plus pressante (qui attaque, qui vient de frapper, proche et
   * face caméra), déverrouille, ou recentre la caméra s'il n'y a personne.
   * En duel, le boss est toujours cadré.
   */
  toggleLock() {
    if (this.inCombat()) return;
    if (this.lock.id !== null) {
      this.lock.release();
      return;
    }
    if (!this.lock.acquire(this.slice.enemies.list, this.lockView())) this.view3d?.requestRecenter();
  }

  /** Verrouillage automatique au coup reçu (option des Paramètres) : cadre l'agresseur. */
  lockOnAttacker() {
    if (this.inCombat() || this.lock.id !== null) return;
    this.lock.acquireAttacker(this.slice.enemies.list, this.lockView());
  }

  /** Passe à la cible voisine : direction 1 à droite, -1 à gauche (souris, molette, stick, swipe). */
  switchLock(direction: number) {
    if (!this.lockedEnemy()) return;
    this.lock.cycle(direction, this.slice.enemies.list, this.lockView());
    this.lockStamp = -1;
  }

  /** Temps de chute restant (s, temps réel), 0 hors mort. [SUPPOSITION] 2,6 s. */
  private dying = 0;
  private static readonly DEATH_FALL = 2.6;

  private deathProgress() {
    return this.dying > 0 ? 1 - this.dying / GameStateService.DEATH_FALL
      : this.playerStore.getData().state === 'dead' ? 1 : 0;
  }

  /** Le coup fatal : gel, ralenti, la caméra tremble ; la chute se joue avant l'écran de mort. */
  private beginPlayerDeath() {
    if (this.dying > 0) return;
    this.dying = GameStateService.DEATH_FALL;
    this.gameloop.freeze(90);
    this.gameloop.slowMotion(0.35, 1100);
    this.rendered.shake(12);
    this.fx.quake(this.playerEntity.centerX, this.playerEntity.centerY, 18, 'crack', 0.6);
    this.lock.release();
  }

  readonly trophies = inject(TrophyService);
  private lastMixture = 0;
  private drummerMoan = 0;

  /** Dernier coup reçu (cause affichée à la mort). */
  private lastHitBy = '';

  /** Message de l'écran de mort sur les cauris. */
  readonly deathNote = signal<string | null>(null);

  private rewardBoss() {
    if (this.mode() !== 'story' || this.bossRewarded) return;
    this.bossRewarded = true;
    const reward = SOULS.bossReward[this.bossEntity.id] ?? 0;
    this.souls.earn(reward);
    if (reward) this.slice.say(`+${reward} cauris`, 2200);
  }
  private bossRewarded = false;

  /** Repos : soin complet, mixtures et flèches, point de retour, sauvegarde. */
  private rest(foyer: Foyer) {
    const first = this.souls.rest(foyer.id, this.chapter(), this.visited());
    if (foyer.id === 'kyidom' || foyer.id === 'tambours') {
      // Feux du prologue : les soldats du Denkyira reviennent, pas de menu de niveaux.
      this.slice.enemies.respawnAll();
      this.arrows.reset();
      this.prologue.onRest();
    } else if (foyer.id !== 'gue') {
      this.slice.onRest(foyer.id);
    }
    const data = this.playerStore.getData();
    this.playerStore.update({ hp: data.maxHp, stamina: data.maxStamina });
    this.equipment.refill();
    this.signature.rest();
    this.restPrompt.set(null);
    this.slice.say(first ? `${foyer.name} allumé · progression sauvegardée` : `${foyer.name} · repos, progression sauvegardée`, 2400);
  }

  /** Continuer (menu principal) : reprend au dernier foyer sauvegardé. */
  async continueGame(): Promise<boolean> {
    const save = await this.souls.load();
    if (!save) return false;
    await this.slice.loadProgress();
    this.resumeAtCheckpoint();
    return true;
  }

  /** Après la mort : retour au dernier foyer, cauris au sol, monde remis en place. */
  respawn() {
    void this.slice.loadProgress().finally(() => this.resumeAtCheckpoint());
  }

  private resumeAtCheckpoint() {
    const { foyer, chapter, visited } = this.souls.checkpoint();
    this.startGame();
    this.bossRewarded = false;
    // Pas de nouvelle entrée cinématique à chaque retour.
    this.introPending = false;
    this.introTime = 0;
    if (chapter === 'prologue') {
      this.enterPrologue();
      this.placeAtFoyer(foyer.id);
      return;
    }
    if (chapter === 'battle') return;
    this.chapter.set(chapter);
    this.visited.set(visited);
    this.slice.setVisited(visited);
    this.terrain.setArena(null);
    this.bossStore.reset();
    this.bossEntity.configure(false);
    if (chapter === 'village') this.slice.resetWorld();
    this.placeAtFoyer(foyer.id);
  }

  private placeAtFoyer(id: FoyerId) {
    const foyer = FOYERS[id];
    const half = PLAYER_CONFIG.size / 2;
    this.playerStore.update({
      x: foyer.x - half, y: foyer.y + 22 - half, vx: 0, vy: 0, facingX: 0, facingY: 1, state: 'idle', stateTimer: 0,
    });
    this.camera.snapTo(this.playerEntity.centerX, this.playerEntity.centerY);
  }

  /** Pose du boss lue par la zone de danger au sol (anticipation des coups). */
  private threatPose() {
    if (!this.inCombat() || this.introTime > 0) return null;
    const boss = this.bossStore.getData();
    return {
      x: this.bossEntity.centerX, y: this.bossEntity.centerY, facingX: boss.facingX, facingY: boss.facingY,
      state: boss.state, progress: this.bossEntity.progress(boss), attack: boss.currentAttack as BossAttackType,
      shotAngles: boss.currentAttack === 'shot' ? shotAngles(boss.phase) : undefined,
      targetX: boss.chargeTargetX, targetY: boss.chargeTargetY, comboStep: boss.comboStep,
    };
  }

  private checkEndConditions() {
    const player = this.playerStore.getData();
    const boss = this.bossStore.getData();

    if (player.state === 'dead') {
      this.beginPlayerDeath();
    } else if (boss.state === 'dead') {
      this.counterTime.set(0);
      this.rewardBoss();
      this.playDefeat();
      this.deathImpacts();
      // On laisse l'animation de mort se jouer avant la suite.
      if (!this.bossEntity.deathDone) return;
      this.defeated.set(null);
      if (this.mode() !== 'story') {
        if (this.rushTransition > 0) return;
        const next = this.rushNext.shift();
        if (next) {
          this.pendingEncounter.set(next);
          this.rushTransition = 1.8;
        } else {
          this.stopGame();
          this._currentScreen.set('victory');
        }
      } else if (this.prologueDuel()) {
        // Chapitre 1 : la crête est libre, le camp de l'arrière-garde est juste derrière.
        this.prologueDuel.set(false);
        this.prologue.championDown = true;
        const fallen = this.bossStore.getData();
        this.prologue.championSpot = { x: this.bossEntity.centerX, y: this.bossEntity.centerY,
          yaw: Math.atan2(fallen.facingX, fallen.facingY) };
        this.terrain.setArena(null);
        // Trophées du chapitre 1, puis texte sur fond sombre et l'acte suivant.
        if (!this.prologue.healed) this.trophies.unlock('eternel');
        if (this.prologue.duelTries === 1) this.trophies.unlock('premier-coup');
        this.prologue.startOutro();
      } else if (this.chapter() === 'battle') {
        this.terrain.setArena(null);
        this.chapter.set('crossing');
        this.souls.enterChapter('crossing', 0);
      } else {
        this.stopGame();
        this._currentScreen.set('victory');
      }
    }
  }

  private prologueView: boolean | null = null;

  private render3D(view: World3D, combat: boolean, duelist: boolean) {
    const player = this.playerStore.getData();
    const boss = this.bossStore.getData();
    const attack = this.playerEntity.getActiveAttackData(player);
    const playerAttack = player.state === 'attacking';
    const phase = (timer: number, duration: number) => Math.max(0, Math.min(1, 1 - timer / duration));
    // Même chronologie que la hitbox : anticipation / impact / récupération.
    const frame = attackFrame(attack, attack.duration - player.stateTimer);
    const attackState = frame.segment === 'active' ? 'attacking' : frame.segment;
    const attackPhase = frame.t;
    const playerPose: Actor3D = {
      x: this.playerEntity.centerX, y: this.playerEntity.centerY,
      groundZ: this.terrain.groundAt(this.playerEntity.centerX, this.playerEntity.centerY),
      facingX: player.facingX, facingY: player.facingY,
      state: playerAttack ? attackState : player.state,
      phase: player.state === 'dead' ? this.deathProgress()
        : playerAttack ? Math.max(0, Math.min(1, attackPhase))
        : phase(player.stateTimer, player.state === 'rolling' ? this.playerEntity.dodgeDuration
          : player.state === 'exhausted' ? PLAYER_CONFIG.exhaustedDuration : PLAYER_CONFIG.hurtDuration),
      attack: player.attackType,
      step: player.comboCount,
      hitstop: this.gameloop.frozen,
      dodge: this.playerEntity.dodgeKind,
      sprint: this.playerEntity.sprinting,
      guarded: player.invicible && (player.state === 'idle' || player.state === 'moving'),
      knockX: player.vx, knockY: player.vy,
      hpRatio: player.maxHp ? player.hp / player.maxHp : 1,
      ...this.playerEntity.equipmentPose(player),
    };
    // Acte I (gué, 1824) : Kwabena ; acte II (village, 1874) : Ama Serwaa.
    view.setHero(this.chapter() === 'village' ? 'ama' : this.chapter() === 'prologue' ? 'kwadwo' : 'kwabena');
    // Prologue 1701 : Kwadwo torse nu, pagne et bandoulière (tenue du corps skinné, human-outfits.ts).
    const prologue = this.chapter() === 'prologue';
    const look = this.slice.look();
    view.setEquipment(this.equipment.getData().weapon, this.arrows.all, look);
    if (prologue !== this.prologueView) {
      this.prologueView = prologue;
      view.setRegionMood(prologue ? PROLOGUE_MOOD : null);
      view.setLandscapeCenter(prologue ? PROLOGUE_CENTER.x : 1200, prologue ? PROLOGUE_CENTER.y : 800);
      view.setLandscapeVisible(!prologue);
    }
    const waves = boss.state !== 'attacking' ? []
      : boss.currentAttack === 'surge' ? [surgeRadius(BOSS_CONFIG.size, boss.stateTimer)]
      : boss.currentAttack === 'tide' ? tideRadii(BOSS_CONFIG.size, boss.stateTimer) : [];
    const enemyPose: Actor3D | null = combat ? {
      x: this.bossEntity.centerX, y: this.bossEntity.centerY,
      groundZ: this.terrain.groundAt(this.bossEntity.centerX, this.bossEntity.centerY),
      // 'stunned' (équilibre rompu) se joue comme un chancellement sur les rigs.
      facingX: boss.facingX, facingY: boss.facingY, state: boss.state === 'stunned' ? 'hurt' : boss.state,
      glow: this.bossEntity.profile(boss).emissive,
      glowIntensity: this.bossEntity.profile(boss).emissiveIntensity,
      phase: this.bossEntity.progress(boss),
      waveRadii: waves,
      attack: boss.currentAttack,
      step: boss.comboStep,
      bossPhase: boss.phase,
      exposed: this.bossEntity.isExposed(boss),
      flinch: this.bossEntity.flinch,
      flinchX: this.bossEntity.flinchX,
      flinchY: this.bossEntity.flinchY,
    } : null;

    // Pendant l'entrée, le boss se dresse et rugit (pose de transition de phase).
    const intro = this.introProgress;
    if (enemyPose && intro !== null && this.bossEntity.id === 'champion') {
      this.baduIntroPose(enemyPose, intro);
    } else if (enemyPose && intro !== null && intro >= 0.3 && intro <= 0.85) {
      enemyPose.state = 'shift';
      enemyPose.phase = (intro - 0.3) / 0.55;
    }
    view.setBossKind(this.bossEntity.id);
    view.setLockTarget(combat ? null : this.lockedEnemy());
    view.setVista(prologue && !combat && this.prologue.atLookout() ? 1 : 0);
    view.onLockFlick ??= (direction) => this.switchLock(direction);
    view.onLockButton ??= () => this.toggleLock();
    view.timeScale = this.gameloop.timeScale;
    view.render(this.environment.groundCanvas(), playerPose, enemyPose, duelist, combat ? null : this.objective(),
      combat ? this.duelArena() : undefined);
    this.playerEntity.setCameraHeading(view.heading);
  }

  /** Sens d'où vient le coup, dans le repère écran (0 = devant le joueur). */
  private markHitDir(dirX: number, dirY: number, kind: 'shot' | 'melee') {
    const ax = -dirX;
    const ay = -dirY;
    if (Math.hypot(ax, ay) < 0.001) return;
    const heading = this.view3d?.heading ?? 0;
    const right = -ax * Math.cos(heading) + ay * Math.sin(heading);
    const down = -ax * Math.sin(heading) - ay * Math.cos(heading);
    this.hitIndicator = {
      id: ++this.hitId,
      angle: Math.atan2(right, -down) * 180 / Math.PI,
      kind,
      until: performance.now() + 700,
    };
  }

  /**
   * HUD HTML par-dessus le canvas : on ne pousse un nouvel état que lorsque
   * une valeur affichée change (PV arrondis, phase, bannière…), pour ne pas
   * relancer la détection de changements Angular à chaque image.
   */
  private syncHud(combat: boolean) {
    const player = this.playerStore.getData();
    const cinematic = this.introProgress !== null || !!this.view3d?.cinematicActive || this.narrative.maskingHud();
    const next: CombatHud = {
      cinematic,
      hp: Math.round(player.hp), maxHp: player.maxHp,
      stamina: Math.round(player.stamina), maxStamina: player.maxStamina,
      boss: combat ? this.bossEntity.hud(this.introProgress) : null,
      defeated: this.defeated(),
      hit: this.hitIndicator && this.hitIndicator.until > performance.now()
        ? { id: this.hitIndicator.id, angle: this.hitIndicator.angle, kind: this.hitIndicator.kind }
        : null,
      counter: this.counterReady(),
      // Fondu au noir pendant la fin de la chute (pas de 5 % pour ne pas redessiner à chaque image).
      fade: Math.round(Math.max(0, Math.min(1, (this.deathProgress() - 0.55) / 0.45)) * 20) / 20,
    };
    const key = JSON.stringify(next);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this._hud.set(next);
  }

  render() {
    const ctx = this.rendered.context;
    if (!ctx) return;

    this.rendered.tickShake();
    const duelist = this.humanBoss();
    const combat = this.inCombat();
    const view = this.view3d;
    this.rendered.clear(view ? null : '#04060a');
    if (view) {
      this.render3D(view, combat, duelist);
    } else {
      this.rendered.beginWorld(this.camera.x, this.camera.y, this.camera.zoom);
      this.environment.drawGround(ctx);
      this.groundEffects.draw(ctx);
      this.destructibles.draw(ctx);
      const bossBehind = this.bossEntity.centerY <= this.playerEntity.centerY;
      if (combat && bossBehind) this.bossEntity.render(duelist);
      this.playerEntity.render(this.chapter() === 'village');
      this.arrows.render();
      if (combat && !bossBehind) this.bossEntity.render(duelist);
      if (combat) this.fog.draw(ctx, this.duelArena());
      this.rendered.endWorld();

      this.rendered.shadeCombatEdges((this.camera.zoom - 1) / 0.6);
    }
    this.syncHud(combat);
    if (combat) {
      this.bossEntity.renderUi(this.introProgress);
    } else {
      const target = this.objective();
      const projected = view?.objectiveOnScreen();
      const x = Math.max(20, Math.min(projected?.x ?? this.camera.worldToScreenX(target.x), this.rendered.width - 20));
      const y = Math.max(80, Math.min(projected?.y ?? this.camera.worldToScreenY(target.y - 30), this.rendered.height - 24));
      this.rendered.drawText('◆', x, y, '#fff1aa', { size: 24, align: 'center', font: 'Georgia', shadow: true });
    }
  }
}
