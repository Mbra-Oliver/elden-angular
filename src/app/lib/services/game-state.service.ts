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
} from '../interfaces/BossAttackData';
import { SPRITE_MANIFEST } from '../constants/sprite-config';
import { BossEntity } from '../entities/bosses/boss.entity';
import { BossStore } from '../entities/bosses/boss.store';
import { PlayerEntity } from '../entities/player/player.entity';
import { PlayerStore } from '../entities/player/player.store';
import { AssetLoaderService } from '../engine/asset-loader.service';
import { CameraService } from '../engine/camera.service';
import { GroundEffectsService } from '../engine/ground-effects.service';
import { DuelFog, FORD_DUEL, SLUICE_DUEL } from '../engine/duel-fog';
import { TerrainCollisionService } from '../engine/terrain-collision.service';
import type { Actor3D, World3D } from '../engine/world-3d';
import { EnvironmentService } from '../engine/environment.service';
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

  setWorld3D(view: World3D | null) {
    this.view3d = view;
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
  private bossHitThisFrame = false;

  constructor() {}

  startGame() {
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
    this.playerHitThisFrame = false;
    this.bossHitThisFrame = false;
    this.playerStore.reset();
    this.bossStore.reset();
    this.bossEntity.configure(true);
    this.playerStore.update({ x: 510, y: 339, facingX: 1 });
    this.bossStore.update({
      x: BATTLE.x - BOSS_CONFIG.size / 2, y: BATTLE.y - BOSS_CONFIG.size / 2,
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
      const playerHitbox = this.getPlayerAttackHitbox(player, attackData);

      const bossHitBox = {
        x: boss.x,
        y: boss.y,
        w: BOSS_CONFIG.size,
        h: BOSS_CONFIG.size,
      };

      const counterContact = player.attackType === 'counter' &&
        Math.hypot(this.playerEntity.centerX - this.bossEntity.centerX, this.playerEntity.centerY - this.bossEntity.centerY) < 67;
      if (counterContact || this.collision.checkAABBCollision(playerHitbox, bossHitBox)) {
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

  //Un. truc qui m'embete quelque part.
  //Recuperer la hitbox de l'attaque. Utile ? Aucune idée.
  private getPlayerAttackHitbox(player: PlayerData, attackData: AttackData) {
    const playerSize = PLAYER_CONFIG.size;

    //Le but c'est de connaitre la porter de l'attaque en fonction du joueur (en fonction de son centre)
    const centerX = player.x + playerSize / 2;
    const centerY = player.y + playerSize / 2;

    const attackRange = attackData.range * playerSize;
    const fLen = Math.sqrt(player.facingX ** 2 + player.facingY ** 2);

    // Si le joueur ne regarde nulle part (0,0), on évite la division par zéro
    const normX = fLen > 0 ? player.facingX / fLen : 0;
    const normY = fLen > 0 ? player.facingY / fLen : 0;

    return {
      x: centerX + normX * (playerSize / 2 + attackRange / 2) - attackRange / 2,
      y: centerY + normY * (playerSize / 2 + attackRange / 2) - attackRange / 2,
      w: attackRange,
      h: attackRange,
    };
  }

  //Le boss touche-t-il le joueur pendant la phase active de son attaque ?
  private checkBossAttack() {
    const boss = this.bossStore.getData();
    const player = this.playerStore.getData();

    // Réarme le coup du boss entre deux attaques.
    if (boss.state !== 'attacking') {
      this.playerHitThisFrame = false;
      return;
    }

    if (this.playerHitThisFrame || player.state === 'dead') {
      return;
    }

    const cfg = this.bossAttackConfig(boss.currentAttack);
    if (!cfg) return;

    const dxToPlayer = this.playerEntity.centerX - this.bossEntity.centerX;
    const dyToPlayer = this.playerEntity.centerY - this.bossEntity.centerY;
    const distance = Math.hypot(dxToPlayer, dyToPlayer);
    const size = BOSS_CONFIG.size;
    const hit = boss.currentAttack === 'surge'
      ? Math.abs(distance - surgeRadius(size, boss.stateTimer)) <= SURGE_WIDTH + 8
      : boss.currentAttack === 'charge' ? distance < size * 0.7
      : cfg.hitBoxType === 'aoe' ? distance < cfg.range * size / 2
      : distance < Math.min(cfg.range * size, size * 2.2) + 9 &&
          dxToPlayer * boss.facingX + dyToPlayer * boss.facingY > distance * 0.22;
    if (hit) {
      if (player.invicible) {
        this.playerHitThisFrame = true;
        if (player.state === 'rolling' &&
            player.stateTimer >= PLAYER_CONFIG.rollDuration - PLAYER_CONFIG.perfectDodgeWindow) {
          this.counterTime.set(0.85);
        }
        return;
      }

      const dx = player.x - boss.x;
      const dy = player.y - boss.y;
      const len = Math.hypot(dx, dy) || 1;
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
      if (before.state === 'windup' && boss.state === 'attacking') {
        if (boss.currentAttack === 'slam' || boss.currentAttack === 'surge') {
          this.groundEffects.emit(bx, by, 18, 0, 0, boss.currentAttack === 'surge');
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
    const preparation = playerAttack && elapsed < attack.windup;
    const phase = (timer: number, duration: number) => Math.max(0, Math.min(1, 1 - timer / duration));
    const playerPose: Actor3D = {
      x: this.playerEntity.centerX, y: this.playerEntity.centerY,
      facingX: player.facingX, facingY: player.facingY,
      state: preparation ? 'windup' : player.state,
      phase: playerAttack ? preparation ? elapsed / attack.windup : phase(
        attack.windup + attack.active - elapsed, attack.active,
      ) : phase(player.stateTimer, player.state === 'rolling' ? PLAYER_CONFIG.rollDuration : PLAYER_CONFIG.hurtDuration),
    };
    const cfg = this.bossAttackConfig(boss.currentAttack);
    const duration = (boss.state === 'windup' ? cfg?.windupDuration : boss.state === 'attacking' ?
      cfg?.attackDuration : cfg?.recoverDuration) ?? BOSS_CONFIG.hurtDuration;
    const enemyPose: Actor3D | null = combat ? {
      x: this.bossEntity.centerX, y: this.bossEntity.centerY,
      facingX: boss.facingX, facingY: boss.facingY, state: boss.state,
      phase: phase(boss.stateTimer, duration),
      waveRadius: boss.state === 'attacking' && boss.currentAttack === 'surge'
        ? surgeRadius(BOSS_CONFIG.size, boss.stateTimer) : undefined,
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
      const bossBehind = this.bossEntity.centerY <= this.playerEntity.centerY;
      if (combat && bossBehind) this.bossEntity.render(duelist);
      this.playerEntity.render(this.chapter() === 'village');
      if (combat && !bossBehind) this.bossEntity.render(duelist);
      if (combat) this.fog.draw(ctx, duelist ? FORD_DUEL : SLUICE_DUEL);
      this.rendered.endWorld();

      this.rendered.shadeCombatEdges((this.camera.zoom - 1) / 0.6);
    }
    if (combat) {
      this.bossEntity.renderUi(duelist ? 'KWADWO, GARDIEN DU GUÉ' : undefined);
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
