import { inject, Injectable } from '@angular/core';
import { PLAYER_CONFIG } from '../constants/player.config-constant';
import { GroundEffectsService } from '../engine/ground-effects.service';
import { TerrainCollisionService } from '../engine/terrain-collision.service';
import { PlayerEntity } from '../entities/player/player.entity';
import { PlayerStore } from '../entities/player/player.store';
import type { ArrowTarget } from '../entities/projectiles/arrow.service';
import { GameLoopService } from '../services/game-loop.service';
import { RendererService } from '../services/renderer.service';
import { ProgressionStore } from './progression.store';
import { ENEMIES, ENEMY_MOVES, SHOT_LOCK_MS, SPIRIT, type EnemyMoveId } from './slice-content';
import { PROLOGUE_SPAWNS } from '../prologue/prologue-map';
import { DUNGEON_WALLS, ENEMY_SPAWNS, MOUNDS, segmentBlocked, type EnemyKind, type Rect } from './slice-map';

export type EnemyState = 'idle' | 'chase' | 'windup' | 'active' | 'recover' | 'hurt' | 'dead' | 'return';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  facingX: number;
  facingY: number;
  state: EnemyState;
  timer: number; // ms restantes dans l'état
  move: EnemyMoveId | null;
  hitDone: boolean;
  aimX: number;
  aimY: number;
  cooldown: number;
  strafe: number;
  engaged: boolean;
  flash: number; // ms de clignotement après un coup reçu
  deadTime: number;
  /** Tir de fusil : trait visible quelques ms. */
  tracer: { x1: number; y1: number; x2: number; y2: number; life: number } | null;
}

const PLAYER_RADIUS = PLAYER_CONFIG.size / 2;
const SLEEP_DISTANCE = 950;

/**
 * Ennemis de terrain de la tranche verticale (plaine et chambres de la digue).
 * Trois profils : pilleur (corps à corps rapide), fusilier (visée longue,
 * rechargement lent : à punir), noyé (lent, lourd, ne bronche qu'aux coups
 * lourds). Logique indépendante du boss : rien ne change dans BossEntity.
 */
@Injectable({ providedIn: 'root' })
export class EnemiesService {
  private readonly terrain = inject(TerrainCollisionService);
  private readonly player = inject(PlayerEntity);
  private readonly playerStore = inject(PlayerStore);
  private readonly progression = inject(ProgressionStore);
  private readonly loop = inject(GameLoopService);
  private readonly renderer = inject(RendererService);
  private readonly effects = inject(GroundEffectsService);

  // Les soldats du Denkyira du prologue (1701) réutilisent les profils pillard et fusilier.
  readonly list: Enemy[] = [...ENEMY_SPAWNS, ...PROLOGUE_SPAWNS].map((spawn, id) => this.spawn(id, spawn.kind, spawn.x, spawn.y));
  /** Obstacles de tir (murs + portes fermées), fournis par SliceService. */
  walls: () => readonly Rect[] = () => DUNGEON_WALLS;
  /** Rappel quand un ennemi meurt (cauris, message). */
  onKill: (enemy: Enemy) => void = () => {};

  private swingKey = '';
  private readonly swingHits = new Set<number>();
  private random = 1;

  private spawn(id: number, kind: EnemyKind, x: number, y: number): Enemy {
    const config = ENEMIES[kind];
    return {
      id, kind, homeX: x, homeY: y, x, y, hp: config.hp, maxHp: config.hp,
      facingX: 0, facingY: 1, state: 'idle', timer: 0, move: null, hitDone: false,
      aimX: 0, aimY: 1, cooldown: 600, strafe: id % 2 ? 1 : -1, engaged: false,
      flash: 0, deadTime: 0, tracer: null,
    };
  }

  /** Tous les ennemis reviennent à leur poste, en pleine santé (repos au feu). */
  respawnAll() {
    this.list.forEach((enemy, i) => Object.assign(enemy, this.spawn(i, enemy.kind, enemy.homeX, enemy.homeY)));
    this.swingKey = '';
    this.swingHits.clear();
  }

  private rand() {
    this.random = (Math.imul(this.random, 1664525) + 1013904223) >>> 0;
    return this.random / 4294967296;
  }

  update(dt: number, specialSpin: boolean) {
    const px = this.player.centerX;
    const py = this.player.centerY;
    for (const enemy of this.list) {
      if (enemy.tracer) {
        enemy.tracer.life -= dt * 1000;
        if (enemy.tracer.life <= 0) enemy.tracer = null;
      }
      enemy.flash = Math.max(0, enemy.flash - dt * 1000);
      if (enemy.state === 'dead') {
        enemy.deadTime += dt;
        continue;
      }
      const distance = Math.hypot(px - enemy.x, py - enemy.y);
      if (distance > SLEEP_DISTANCE && enemy.state !== 'return') continue;
      this.think(enemy, dt, px, py, distance);
    }
    this.separate();
    this.checkPlayerStrikes(specialSpin);
  }

  // ----------------------------------------------------------------- IA

  private think(enemy: Enemy, dt: number, px: number, py: number, distance: number) {
    const config = ENEMIES[enemy.kind];
    const player = this.playerStore.getData();
    const playerDead = player.state === 'dead';
    const fromHome = Math.hypot(enemy.x - enemy.homeX, enemy.y - enemy.homeY);
    enemy.cooldown -= dt * 1000;

    if (!enemy.engaged && !playerDead && distance < config.aggro &&
        !segmentBlocked(enemy.x, enemy.y, px, py, this.walls())) {
      enemy.engaged = true;
    }
    if (enemy.engaged && (playerDead || fromHome > config.leash || distance > config.leash)) {
      enemy.engaged = false;
      if (enemy.state === 'chase' || enemy.state === 'idle') enemy.state = 'return';
    }

    const toX = distance > 0 ? (px - enemy.x) / distance : 0;
    const toY = distance > 0 ? (py - enemy.y) / distance : 1;

    switch (enemy.state) {
      case 'idle':
        if (enemy.engaged) enemy.state = 'chase';
        break;
      case 'return': {
        if (enemy.engaged) { enemy.state = 'chase'; break; }
        const hx = enemy.homeX - enemy.x;
        const hy = enemy.homeY - enemy.y;
        const d = Math.hypot(hx, hy);
        if (d < 6) {
          enemy.state = 'idle';
          enemy.hp = enemy.maxHp; // retour au poste : il récupère
        } else {
          this.walk(enemy, hx / d, hy / d, config.speed * 0.8, dt);
        }
        break;
      }
      case 'chase':
        if (!enemy.engaged) { enemy.state = 'return'; break; }
        this.chase(enemy, dt, toX, toY, distance);
        break;
      case 'windup': {
        enemy.timer -= dt * 1000;
        const move = ENEMY_MOVES[enemy.move!];
        // Le fusilier suit la cible jusqu'au verrouillage ; les autres pivotent lentement.
        const tracking = move.shape === 'shot' ? enemy.timer > SHOT_LOCK_MS : enemy.timer > move.windup * 0.35;
        if (tracking) this.turnToward(enemy, toX, toY, move.shape === 'shot' ? 12 : 5, dt);
        if (move.shape === 'shot') { enemy.aimX = enemy.facingX; enemy.aimY = enemy.facingY; }
        if (enemy.timer <= 0) {
          enemy.state = 'active';
          enemy.timer = move.active;
          enemy.hitDone = false;
          if (move.shape === 'shot') this.fire(enemy);
        }
        break;
      }
      case 'active': {
        const move = ENEMY_MOVES[enemy.move!];
        enemy.timer -= dt * 1000;
        if (move.lunge) this.walk(enemy, enemy.facingX, enemy.facingY, move.lunge, dt, false);
        if (!enemy.hitDone && move.shape !== 'shot') this.tryHitPlayer(enemy, move.shape, move.reach, move.damage);
        if (enemy.timer <= 0) {
          if (enemy.move === 'slash') {
            this.startMove(enemy, 'slash2');
          } else {
            enemy.state = 'recover';
            enemy.timer = move.recover;
          }
        }
        break;
      }
      case 'recover':
      case 'hurt':
        enemy.timer -= dt * 1000;
        if (enemy.state === 'hurt') this.walk(enemy, -enemy.facingX, -enemy.facingY, 90 * enemy.timer / 260, dt, false);
        if (enemy.timer <= 0) {
          enemy.state = enemy.engaged ? 'chase' : 'return';
          enemy.cooldown = 350 + this.rand() * 700;
        }
        break;
    }
  }

  private chase(enemy: Enemy, dt: number, toX: number, toY: number, distance: number) {
    const config = ENEMIES[enemy.kind];
    const gap = distance - config.radius - PLAYER_RADIUS;
    this.turnToward(enemy, toX, toY, 7, dt);
    const sideX = -toY * enemy.strafe;
    const sideY = toX * enemy.strafe;

    if (enemy.kind === 'fusilier') {
      if (gap < 30 && enemy.cooldown <= 0) return this.startMove(enemy, 'butt');
      const sight = !segmentBlocked(enemy.x, enemy.y, this.player.centerX, this.player.centerY, this.walls()) &&
        !this.moundBetween(enemy.x, enemy.y, this.player.centerX, this.player.centerY);
      if (sight && enemy.cooldown <= 0 && gap < ENEMY_MOVES.shot.reach - 20) return this.startMove(enemy, 'shot');
      // Garde ses distances : recule si on s'approche, contourne sinon.
      const back = gap < 160 ? -1 : gap > 290 ? 1 : 0;
      this.walk(enemy, toX * back + sideX * 0.6, toY * back + sideY * 0.6, config.speed, dt);
      return;
    }

    const reach = enemy.kind === 'noye' ? ENEMY_MOVES.claw.reach : ENEMY_MOVES.slash.reach;
    if (gap < reach + 6 && enemy.cooldown <= 0) {
      const slam = enemy.kind === 'noye' && this.rand() < 0.4;
      return this.startMove(enemy, enemy.kind === 'noye' ? slam ? 'slam' : 'claw' : 'slash');
    }
    // Entre deux attaques : tourne autour au lieu de coller au joueur.
    if (enemy.cooldown > 0 && gap < 80) {
      this.walk(enemy, sideX * 0.8 - toX * 0.2, sideY * 0.8 - toY * 0.2, config.speed * 0.55, dt);
    } else {
      this.walk(enemy, toX, toY, config.speed, dt);
    }
  }

  private startMove(enemy: Enemy, move: EnemyMoveId) {
    enemy.state = 'windup';
    enemy.move = move;
    enemy.timer = ENEMY_MOVES[move].windup;
    enemy.hitDone = false;
    if (this.rand() < 0.35) enemy.strafe *= -1;
  }

  private turnToward(enemy: Enemy, x: number, y: number, rate: number, dt: number) {
    const current = Math.atan2(enemy.facingY, enemy.facingX);
    const goal = Math.atan2(y, x);
    const gap = Math.atan2(Math.sin(goal - current), Math.cos(goal - current));
    const angle = current + gap * Math.min(1, rate * dt);
    enemy.facingX = Math.cos(angle);
    enemy.facingY = Math.sin(angle);
  }

  private walk(enemy: Enemy, dx: number, dy: number, speed: number, dt: number, face = true) {
    const length = Math.hypot(dx, dy);
    if (length < 0.01) return;
    const radius = ENEMIES[enemy.kind].radius;
    const moved = this.terrain.move(enemy.x, enemy.y,
      enemy.x + dx / length * speed * dt, enemy.y + dy / length * speed * dt, radius);
    enemy.x = moved.x;
    enemy.y = moved.y;
    if (face && enemy.state === 'return') this.turnToward(enemy, dx, dy, 6, dt);
  }

  private moundBetween(ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy || 1;
    return MOUNDS.some((m) => {
      const t = Math.max(0, Math.min(1, ((m.x - ax) * dx + (m.y - ay) * dy) / lengthSq));
      return Math.hypot(ax + dx * t - m.x, ay + dy * t - m.y) < m.r + 2 && t > 0.05 && t < 0.95;
    });
  }

  /** Coup de mousquet : ligne figée pendant le verrouillage, une roulade passe dessous. */
  private fire(enemy: Enemy) {
    const reach = ENEMY_MOVES.shot.reach;
    let endX = enemy.x + enemy.aimX * reach;
    let endY = enemy.y + enemy.aimY * reach;
    // Le tir s'arrête sur le premier mur ou la première termitière.
    for (let t = 12; t < reach; t += 8) {
      const x = enemy.x + enemy.aimX * t;
      const y = enemy.y + enemy.aimY * t;
      const wall = segmentBlocked(enemy.x, enemy.y, x, y, this.walls());
      const mound = MOUNDS.some((m) => Math.hypot(x - m.x, y - m.y) < m.r);
      if (wall || mound) { endX = x; endY = y; break; }
    }
    enemy.tracer = { x1: enemy.x + enemy.aimX * 14, y1: enemy.y + enemy.aimY * 14, x2: endX, y2: endY, life: 110 };
    this.renderer.shake(3);
    const px = this.player.centerX - enemy.x;
    const py = this.player.centerY - enemy.y;
    const along = px * enemy.aimX + py * enemy.aimY;
    const across = Math.abs(px * enemy.aimY - py * enemy.aimX);
    const shotLength = Math.hypot(endX - enemy.x, endY - enemy.y);
    if (along > 0 && along < shotLength + 4 && across < PLAYER_RADIUS - 2) {
      this.damagePlayer(enemy, ENEMY_MOVES.shot.damage, enemy.aimX, enemy.aimY);
    }
  }

  private tryHitPlayer(enemy: Enemy, shape: 'arc' | 'ring' | 'shot', reach: number, damage: number) {
    const dx = this.player.centerX - enemy.x;
    const dy = this.player.centerY - enemy.y;
    const distance = Math.hypot(dx, dy);
    const range = ENEMIES[enemy.kind].radius + reach + PLAYER_RADIUS;
    if (distance > range) return;
    if (shape === 'arc' && distance > 8 && (dx * enemy.facingX + dy * enemy.facingY) / distance < 0.25) return;
    enemy.hitDone = true;
    if (shape === 'ring') this.effects.emit(enemy.x, enemy.y, 14, 0, 0, true);
    this.damagePlayer(enemy, damage, distance > 0 ? dx / distance : enemy.facingX, distance > 0 ? dy / distance : enemy.facingY);
  }

  private damagePlayer(enemy: Enemy, damage: number, dirX: number, dirY: number) {
    const player = this.playerStore.getData();
    if (player.state === 'dead' || player.invicible) return;
    this.player.takeDamage(Math.round(damage * this.progression.armor()), dirX * 200, dirY * 200);
    this.effects.emit(this.player.centerX, this.player.centerY, 7, dirX, dirY);
    this.renderer.shake(enemy.kind === 'noye' ? 12 : 8);
    this.loop.freeze(45);
  }

  // ------------------------------------------------------ COUPS DU JOUEUR

  private checkPlayerStrikes(spin: boolean) {
    const player = this.playerStore.getData();
    if (player.state !== 'attacking') {
      this.swingKey = '';
      this.swingHits.clear();
      return;
    }
    const key = `${player.attackType}:${player.comboCount}:${spin}`;
    if (key !== this.swingKey) {
      this.swingKey = key;
      this.swingHits.clear();
    }
    const attack = this.player.getActiveAttackData(player);
    const elapsed = attack.duration - player.stateTimer;
    if (elapsed < attack.windup || elapsed >= attack.windup + attack.active) return;
    const weapon = this.player.equipment.getData().weapon;
    const multiplier = weapon === 'afena' ? this.progression.afenaMultiplier() : this.progression.spearMultiplier();
    const special = this.player.special !== null;

    for (const enemy of this.list) {
      if (enemy.state === 'dead' || this.swingHits.has(enemy.id)) continue;
      const radius = ENEMIES[enemy.kind].radius;
      const dx = enemy.x - this.player.centerX;
      const dy = enemy.y - this.player.centerY;
      const distance = Math.hypot(dx, dy);
      const reach = PLAYER_RADIUS + attack.range * PLAYER_CONFIG.size + radius;
      if (distance > reach) continue;
      const facing = Math.hypot(player.facingX, player.facingY) || 1;
      const inArc = spin || distance < radius + PLAYER_RADIUS + 4 ||
        (dx * player.facingX + dy * player.facingY) / (distance * facing) > Math.cos(70 * Math.PI / 180);
      if (!inArc) continue;
      this.swingHits.add(enemy.id);
      const heavy = player.attackType !== 'light';
      const damage = attack.damage * multiplier * (special ? this.progression.specialMultiplier() : 1);
      this.damageEnemy(enemy, damage, dx / (distance || 1), dy / (distance || 1), heavy);
      if (!special) this.progression.gainSpirit(SPIRIT.perMeleeHit);
      this.renderer.shake(heavy ? 6 : 3);
      this.loop.freeze(heavy ? 60 : 40);
    }
  }

  /** Dégâts reçus par un ennemi (lance, afena, flèche). */
  damageEnemy(enemy: Enemy, damage: number, dirX: number, dirY: number, heavy: boolean) {
    if (enemy.state === 'dead') return;
    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.flash = 140;
    enemy.engaged = true;
    this.effects.emit(enemy.x, enemy.y, 6, dirX, dirY);
    if (enemy.hp <= 0) {
      enemy.state = 'dead';
      enemy.deadTime = 0;
      enemy.tracer = null;
      enemy.facingX = -dirX;
      enemy.facingY = -dirY;
      this.onKill(enemy);
      return;
    }
    // Les pilleurs et fusiliers bronchent à chaque coup ; le noyé seulement aux coups lourds.
    if (!ENEMIES[enemy.kind].heavyPoise || heavy) {
      enemy.state = 'hurt';
      enemy.timer = 260;
      enemy.facingX = -dirX;
      enemy.facingY = -dirY;
    }
  }

  /** Cibles pour les flèches (ennemis vivants proches). */
  arrowTargets(out: { targets: ArrowTarget[]; enemies: Enemy[] }) {
    out.targets.length = 0;
    out.enemies.length = 0;
    for (const enemy of this.list) {
      if (enemy.state === 'dead') continue;
      if (Math.abs(enemy.x - this.player.centerX) > 800 || Math.abs(enemy.y - this.player.centerY) > 800) continue;
      out.targets.push({ x: enemy.x, y: enemy.y, radius: ENEMIES[enemy.kind].radius });
      out.enemies.push(enemy);
    }
  }

  /** Ennemi engagé le plus proche, pour orienter les coups au corps à corps. */
  nearestEngaged(maxDistance: number): Enemy | null {
    let best: Enemy | null = null;
    let bestDistance = maxDistance;
    for (const enemy of this.list) {
      if (enemy.state === 'dead' || !enemy.engaged) continue;
      const distance = Math.hypot(enemy.x - this.player.centerX, enemy.y - this.player.centerY);
      if (distance < bestDistance) { best = enemy; bestDistance = distance; }
    }
    return best;
  }

  /** Empêche les ennemis de s'empiler entre eux et sur le joueur. */
  private separate() {
    const px = this.player.centerX;
    const py = this.player.centerY;
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      if (a.state === 'dead') continue;
      const ra = ENEMIES[a.kind].radius;
      const dpx = a.x - px;
      const dpy = a.y - py;
      const dp = Math.hypot(dpx, dpy);
      const minP = ra + PLAYER_RADIUS - 4;
      if (dp < minP && dp > 0.01) {
        const moved = this.terrain.move(a.x, a.y, a.x + dpx / dp * (minP - dp), a.y + dpy / dp * (minP - dp), ra);
        a.x = moved.x; a.y = moved.y;
      }
      for (let j = i + 1; j < this.list.length; j++) {
        const b = this.list[j];
        if (b.state === 'dead') continue;
        const min = ra + ENEMIES[b.kind].radius;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
        const d = Math.hypot(dx, dy);
        if (d >= min || d < 0.01) continue;
        const push = (min - d) / 2;
        const ma = this.terrain.move(a.x, a.y, a.x - dx / d * push, a.y - dy / d * push, ra);
        const mb = this.terrain.move(b.x, b.y, b.x + dx / d * push, b.y + dy / d * push, ENEMIES[b.kind].radius);
        a.x = ma.x; a.y = ma.y; b.x = mb.x; b.y = mb.y;
      }
    }
  }
}
