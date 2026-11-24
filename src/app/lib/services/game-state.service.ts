export type GameScreen = 'main-menu' | 'playing' | 'paused' | 'death' | 'victory';

import { computed, inject, Injectable, signal } from '@angular/core';
import { BOSS_CONFIG } from '../constants/boss.config-constant';
import { PLAYER_CONFIG } from '../constants/player.config-constant';
import {
  BOSS_ATTACKS,
  BossAttackData,
  BossAttackType,
  SURGE_WIDTH,
  surgeRadius,
  attackProgress,
  isBossHitActive,
  tideRadii,
} from '../interfaces/BossAttackData';
import { SPRITE_MANIFEST } from '../constants/sprite-config';
import { BossEntity } from '../entities/bosses/boss.entity';
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
import { Destructibles3D } from '../engine/destructibles-3d';
import { BATTLE, CLEARING, CROSSING, DIALOGUES, DialogueChoice, GATE, VILLAGE_STOPS } from '../constants/village';
import { AttackData } from '../interfaces/AttackData';
import { PlayerData } from '../interfaces/PlayerData';
import { CollisionService } from './collision.service';
import { GameLoopService } from './game-loop.service';
import { RendererService } from './renderer.service';

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

  setWorld3D(view: World3D | null) {
    this.view3d = view;
    view?.addLayer((scene) => new Destructibles3D(scene, this.destructibles));
    this.playerEntity.setCameraHeading(view?.heading ?? null);
  }

  private readonly terrain = inject(TerrainCollisionService);
  private readonly fordShot = { x: FORD_DUEL.x - 24, y: FORD_DUEL.y - 35, zoom: 1.74 };
  private readonly sluiceShot = { x: SLUICE_DUEL.x + 25, y: SLUICE_DUEL.y - 36, zoom: 1.66 };
  private readonly fog = new DuelFog();
  private groundEffects = inject(GroundEffectsService);
  private assets = inject(AssetLoaderService);

  private readonly visited = signal(0);
  private readonly dialogueId = signal<string | null>(null);
  private readonly decision = signal<'seal' | 'expose' | null>(null);
  private readonly chapter = signal<'battle' | 'crossing' | 'village'>('village');
  private readonly inCombat = computed(() => this.chapter() === 'battle' || this.decision() !== null);
  readonly objective = computed(() => {
    if (this.chapter() === 'battle') return BATTLE;
    if (this.chapter() === 'crossing') return CROSSING;
    return this.decision() ? CLEARING : (VILLAGE_STOPS.at(this.visited()) ?? GATE);
  });
  private readonly near = signal(false);
  private readonly counterTime = signal(0);
  readonly counterReady = computed(() => this.counterTime() > 0);
  readonly dialogue = computed(() => {
    const id = this.dialogueId();
    return id ? DIALOGUES[id] : null;
  });
  readonly canTalk = computed(() => this.near() && !this.dialogue() && !this.decision());
  readonly story = computed(() => {
    if (this.chapter() === 'battle') {
      return 'Pays akan, XVIIIᵉ siècle. Ama tient le gué pendant que les familles fuient la guerre. Kwadwo a reçu l’ordre de les ramener. Esquive ses charges et frappe quand il reprend son souffle.';
    }
    if (this.chapter() === 'crossing') {
      return 'Kwadwo lâche son arme. Il veut sauver son frère. Rejoins le gué : il tiendra la corde pendant que tu guideras les familles.';
    }
    if (this.decision()) return 'La Veille ouvre sa cuirasse après avoir relâché l’eau. Esquive la vague, puis frappe pendant qu’elle se vide.';
    return [
      'Des générations plus tard, le village fondé par les familles du gué manque d’eau. Kouamé t’attend sur la place du Goli, avec le carnet d’Ama.',
      'Le carnet d’Ama mentionne les trois coups entendus sous la digue. Porte-le à Aya.',
      'Le canal a été détourné. Retrouve Yao à la vanne avant que la chambre se vide.',
    ][this.visited()];
  });
  readonly ending = computed(() => this.decision() === 'seal'
    ? 'Le puits se remplit. Yao et sa sœur veillent leur mère ensemble. Le père de Yao retire l’accusation devant le conseil. Quand on lui demande qui a ouvert le canal, il baisse les yeux. Aya inscrit son silence à la dernière page du carnet.'
    : 'Tu retiens la Veille assez longtemps pour que Yao rende l’eau au puits. À l’aube, sa sœur pose la planche devant le conseil. Le père de Yao reconnaît le sceau et son ordre. Avant de rentrer veiller leur mère, elle lui demande de venir avec eux.');

  talk() {
    if (this.currentScreen() !== 'playing' || !this.canTalk()) return;
    this.dialogueId.set(this.chapter() === 'crossing' ? 'crossing' : ['kouame', 'aya', 'gate'][this.visited()]);
  }

  choose(choice: DialogueChoice) {
    if (!this.dialogue()?.choices.includes(choice)) return;
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
      this.camera.snapTo(this.playerEntity.centerX, this.playerEntity.centerY);
    } else if (choice.action === 'leave') {
      this.visited.update((count) => count + 1);
    } else if (choice.action === 'seal' || choice.action === 'expose') {
      this.decision.set(choice.action);
      this.terrain.setArena(SLUICE_DUEL);
      if (choice.action === 'seal') {
        this.bossStore.update({ hp: 225, maxHp: 225 });
      }
    }
  }

  private updateCallback = this.update.bind(this);
  private renderCallback = this.render.bind(this);

  private playerHitThisFrame = false;
  /** Dernier coup de combo / anneau vu, pour réarmer la touche à chaque coup. */
  private bossStrikeSeen = -1;
  private bossHitThisFrame = false;

  constructor() {}

  startGame() {
    this.destructibles.reset();
    this.stopGame();
    this.visited.set(0);
    this.chapter.set('battle');
    this.terrain.setArena(FORD_DUEL);
    this.decision.set(null);
    this.dialogueId.set(null);
    this.near.set(false);
    this.counterTime.set(0);
    this.playerEntity.resetCombat();
    this.groundEffects.reset();
    this.arrows.reset();
    this.equipment.reset();
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

    this._currentScreen.set('playing');
    this.gameloop.onUpdate(this.updateCallback);
    this.gameloop.onRender(this.renderCallback);
    this.gameloop.start();
  }

  stopGame() {
    this.terrain.setArena(null);
    this.gameloop.stop();
    this.gameloop.offUpdate(this.updateCallback);
    this.gameloop.offRender(this.renderCallback);
  }

  returnToMainMenu() {
    this._currentScreen.set('main-menu');
  }

  retry() {
    this.startGame();
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

    if (player.state === 'attacking' && !this.bossHitThisFrame) {
      const attackData = this.playerEntity.getActiveAttackData();
      const elapsed = attackData.duration - player.stateTimer;
      if (elapsed < attackData.windup || elapsed >= attackData.windup + attackData.active) return;
      const counterContact = player.attackType === 'counter' &&
        Math.hypot(this.playerEntity.centerX - this.bossEntity.centerX, this.playerEntity.centerY - this.bossEntity.centerY) < 67;
      if (counterContact || this.playerStrikeReaches(player, attackData)) {
        const knockbackX = player.facingX * 150;
        const knockbarY = player.facingY * 150;

        this.bossEntity.takeDamage(attackData.damage, knockbackX, knockbarY, player.attackType === 'counter');
        this.groundEffects.emit(this.bossEntity.centerX, this.bossEntity.centerY, 7, player.facingX, player.facingY);
        const guarded = boss.state !== 'recover' && player.attackType !== 'counter';
        const heavy = player.attackType !== 'light';
        this.rendered.shake(guarded ? 2 : heavy ? 8 : 4);
        this.gameloop.freeze(guarded ? 18 : heavy ? 70 : 50);
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
    const distance = Math.hypot(dxToPlayer, dyToPlayer);
    const size = BOSS_CONFIG.size;
    const hit = boss.currentAttack === 'surge'
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
        }
        return;
      }

      // Recul calculé de centre à centre (les deux corps n'ont pas la même taille).
      const dx = dxToPlayer;
      const dy = dyToPlayer;
      const len = distance || 1;
      const knockback = 220;

      this.playerEntity.takeDamage(
        cfg.damage,
        (dx / len) * knockback,
        (dy / len) * knockback,
      );
      this.groundEffects.emit(this.playerEntity.centerX, this.playerEntity.centerY, 8, dx / len, dy / len);
      this.rendered.shake(14);
      this.gameloop.freeze(55);
      this.playerHitThisFrame = true;
    }
  }

  private bossAttackConfig(name: string): BossAttackData | null {
    if (name === 'none' || !(name in BOSS_ATTACKS)) return null;
    return BOSS_ATTACKS[name as Exclude<BossAttackType, 'none'>];
  }

  update(deltaTime: number) {
    if (this.dialogue()) return;

    this.groundEffects.update(deltaTime);
    const inCombat = this.inCombat();
    this.destructibles.update(deltaTime, inCombat);
    const counter = this.counterTime();
    if (counter > 0) this.counterTime.set(Math.max(0, counter - deltaTime));
    if (counter > 0 && this.playerEntity.tryCounter(this.bossEntity.centerX, this.bossEntity.centerY)) {
      this.counterTime.set(0);
      this.bossHitThisFrame = false;
    }
    const px = this.playerEntity.centerX;
    const py = this.playerEntity.centerY;
    this.playerEntity.update(deltaTime, inCombat
      ? { x: this.bossEntity.centerX, y: this.bossEntity.centerY }
      : undefined);
    this.updateArrows(deltaTime, inCombat);
    const player = this.playerStore.getData();
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
      }
      if (boss.state === 'shift') this.pushPlayerFromBoss(deltaTime);
      if (before.state === 'windup' && boss.state === 'attacking') {
        if (boss.currentAttack === 'slam' || boss.currentAttack === 'surge' || boss.currentAttack === 'tide') {
          this.groundEffects.emit(bx, by, 18, 0, 0, boss.currentAttack !== 'slam');
        } else if (boss.currentAttack === 'sweep') {
          this.groundEffects.emit(bx, by, 14, 0, 0);
        } else if (charge) {
          this.groundEffects.emit(bx, by, 9, -boss.facingX, -boss.facingY);
        }
      }
      if (this.view3d) this.separateFighters();
      this.checkCollision();
      this.checkBossAttack();
      this.checkEndConditions();
    } else {
      const near = Math.hypot(target.x - this.playerEntity.centerX, target.y - this.playerEntity.centerY) < 75;
      this.near.set(near);
    }

    const x = this.playerEntity.centerX;
    const y = this.playerEntity.centerY;
    if (this.inCombat()) {
      const shot = this.chapter() === 'battle' ? this.fordShot : this.sluiceShot;
      this.camera.frameCombat(x, y, this.bossEntity.centerX, this.bossEntity.centerY, deltaTime, x - px, y - py, shot);
    } else {
      this.camera.follow(x, y, deltaTime);
    }
  }

  /** Flèches en vol : impacts sur le boss, chute au sol, ramassage par le joueur. */
  private updateArrows(deltaTime: number, inCombat: boolean) {
    this.equipment.tick();
    const boss = this.bossStore.getData();
    const target = inCombat && boss.state !== 'dead'
      ? { x: this.bossEntity.centerX, y: this.bossEntity.centerY, radius: BOSS_CONFIG.size * 0.42 }
      : null;
    const arena = inCombat ? this.chapter() === 'battle' ? FORD_DUEL : SLUICE_DUEL : null;
    const hits = this.arrows.update(deltaTime, target,
      { x: this.playerEntity.centerX, y: this.playerEntity.centerY }, arena);
    for (const hit of hits) {
      this.bossEntity.takeDamage(hit.damage, hit.dirX * 60, hit.dirY * 60);
      this.groundEffects.emit(hit.x, hit.y, 4, hit.dirX, hit.dirY);
      this.rendered.shake(hit.damage > 15 ? 4 : 2);
      this.gameloop.freeze(hit.damage > 15 ? 40 : 20);
    }
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
    const clearance = this.chapter() === 'battle' ? 18 : 36;
    if (distance >= clearance) return;
    const player = this.playerStore.getData();
    const gap = clearance - distance;
    const nx = distance > 0.1 ? dx / distance : -(player.facingX || 1);
    const ny = distance > 0.1 ? dy / distance : 0;
    const moved = this.terrain.move(x, y, x + nx * gap, y + ny * gap, 10);
    const halfPlayer = PLAYER_CONFIG.size / 2;
    this.playerStore.update({ x: moved.x - halfPlayer, y: moved.y - halfPlayer });
  }

  private checkEndConditions() {
    const player = this.playerStore.getData();
    const boss = this.bossStore.getData();

    if (player.state === 'dead') {
      this.stopGame();
      this._currentScreen.set('death');
    } else if (boss.state === 'dead') {
      this.counterTime.set(0);
      if (this.chapter() === 'battle') {
        this.terrain.setArena(null);
        this.chapter.set('crossing');
      } else {
        this.stopGame();
        this._currentScreen.set('victory');
      }
    }
  }

  private render3D(view: World3D, combat: boolean, duelist: boolean) {
    const player = this.playerStore.getData();
    const boss = this.bossStore.getData();
    const attack = this.playerEntity.getActiveAttackData(player);
    const playerAttack = player.state === 'attacking';
    const elapsed = attack.duration - player.stateTimer;
    const impactEnd = attack.windup + attack.active;
    const phase = (timer: number, duration: number) => Math.max(0, Math.min(1, 1 - timer / duration));
    // Attaque découpée en anticipation / impact / récupération pour l'animateur 3D.
    const attackState = elapsed < attack.windup ? 'windup' : elapsed < impactEnd ? 'attacking' : 'recover';
    const attackPhase = attackState === 'windup' ? elapsed / attack.windup
      : attackState === 'attacking' ? (elapsed - attack.windup) / attack.active
      : (elapsed - impactEnd) / Math.max(1, attack.duration - impactEnd);
    const playerPose: Actor3D = {
      x: this.playerEntity.centerX, y: this.playerEntity.centerY,
      facingX: player.facingX, facingY: player.facingY,
      state: playerAttack ? attackState : player.state,
      phase: playerAttack ? Math.max(0, Math.min(1, attackPhase))
        : phase(player.stateTimer, player.state === 'rolling' ? this.playerEntity.dodgeDuration
          : player.state === 'exhausted' ? PLAYER_CONFIG.exhaustedDuration : PLAYER_CONFIG.hurtDuration),
      attack: player.attackType,
      step: player.comboCount,
      hitstop: this.gameloop.frozen,
      dodge: this.playerEntity.dodgeKind,
      sprint: this.playerEntity.sprinting,
      guarded: player.invicible && (player.state === 'idle' || player.state === 'moving'),
      knockX: player.vx, knockY: player.vy,
      ...this.playerEntity.equipmentPose(player),
    };
    view.setEquipment(this.equipment.getData().weapon, this.arrows.all);
    const waves = boss.state !== 'attacking' ? []
      : boss.currentAttack === 'surge' ? [surgeRadius(BOSS_CONFIG.size, boss.stateTimer)]
      : boss.currentAttack === 'tide' ? tideRadii(BOSS_CONFIG.size, boss.stateTimer) : [];
    const enemyPose: Actor3D | null = combat ? {
      x: this.bossEntity.centerX, y: this.bossEntity.centerY,
      facingX: boss.facingX, facingY: boss.facingY, state: boss.state,
      phase: this.bossEntity.progress(boss),
      waveRadii: waves,
      attack: boss.currentAttack,
      step: boss.comboStep,
      bossPhase: boss.phase,
      exposed: this.bossEntity.isExposed(boss),
    } : null;

    view.render(this.environment.groundCanvas(), playerPose, enemyPose, duelist, combat ? null : this.objective(),
      combat ? duelist ? FORD_DUEL : SLUICE_DUEL : undefined);
    this.playerEntity.setCameraHeading(view.heading);

    this.rendered.drawBar(20, 88, 148, 7, player.hp, player.maxHp, '#c96349');
    this.rendered.drawBar(20, 99, 110, 4, player.stamina, player.maxStamina, '#b0bd76');
  }

  render() {
    const ctx = this.rendered.context;
    if (!ctx) return;

    this.rendered.tickShake();
    const duelist = this.chapter() === 'battle';
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
      if (combat) this.fog.draw(ctx, duelist ? FORD_DUEL : SLUICE_DUEL);
      this.rendered.endWorld();

      this.rendered.shadeCombatEdges((this.camera.zoom - 1) / 0.6);
    }
    if (combat) {
      this.bossEntity.renderUi();
    } else {
      const target = this.objective();
      const projected = view?.objectiveOnScreen();
      const x = Math.max(20, Math.min(projected?.x ?? this.camera.worldToScreenX(target.x), this.rendered.width - 20));
      const y = Math.max(80, Math.min(projected?.y ?? this.camera.worldToScreenY(target.y - 30), this.rendered.height - 24));
      this.rendered.drawText('◆', x, y, '#fff1aa', { size: 24, align: 'center', font: 'Georgia', shadow: true });
    }
    if (this.counterReady()) {
      this.rendered.drawText('ESQUIVE PARFAITE  ·  ESPACE POUR RIPOSTER', this.rendered.width / 2, 110,
        '#a7fff0', { size: 18, align: 'center', shadow: true });
    }
  }
}
