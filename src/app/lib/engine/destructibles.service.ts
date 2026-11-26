import { inject, Injectable } from '@angular/core';
import { BOSS_CONFIG } from '../constants/boss.config-constant';
import {
  DESTRUCTIBLE_DAMAGE,
  DESTRUCTIBLE_KINDS,
  DESTRUCTIBLE_LAYOUT,
  type DamageSource,
  type DestructibleKind,
} from '../constants/destructibles.config-constant';
import { PLAYER_CONFIG } from '../constants/player.config-constant';
import { BossStore } from '../entities/bosses/boss.store';
import { PlayerEntity } from '../entities/player/player.entity';
import { PlayerStore } from '../entities/player/player.store';
import { ArrowService } from '../entities/projectiles/arrow.service';
import {
  BOSS_ATTACKS,
  SURGE_WIDTH,
  isBossHitActive,
  surgeRadius,
  tideRadii,
  type BossAttackType,
} from '../interfaces/BossAttackData';
import { AudioEngineService } from '../audio/audio-engine.service';
import { PropSfx } from '../audio/prop-sfx';
import { CombatFxService } from '../services/combat-fx.service';
import { GameLoopService } from '../services/game-loop.service';
import { RendererService } from '../services/renderer.service';
import { TerrainCollisionService } from './terrain-collision.service';

export interface Destructible {
  readonly id: number;
  readonly kind: DestructibleKind;
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly radius: number;
  hp: number;
  readonly maxHp: number;
  broken: boolean;
  /** Dernier coup reçu (horloge du jeu, en secondes) : sert au tremblement. */
  hitAt: number;
  hitDirX: number;
  hitDirY: number;
  /** Jeton du dernier coup : une même attaque ne touche un objet qu'une fois. */
  lastStrike: number;
}

/** Événement consommé par la vue 3D pour lancer les éclats. */
export interface DestructibleEvent {
  id: number;
  broken: boolean;
  dirX: number;
  dirY: number;
  strength: number;
}

/**
 * Décor destructible : jarres, paniers, palissades, murs de terre.
 *
 * Toute la logique lit les stores (joueur, boss, flèches) : il suffit
 * d'appeler `update()` une fois par frame depuis la boucle de jeu. Les
 * objets solides encore debout bloquent les déplacements via le service de
 * collision du terrain.
 */
@Injectable({ providedIn: 'root' })
export class DestructiblesService {
  private readonly playerStore = inject(PlayerStore);
  private readonly playerEntity = inject(PlayerEntity);
  private readonly bossStore = inject(BossStore);
  private readonly arrows = inject(ArrowService);
  private readonly renderer = inject(RendererService);
  private readonly gameloop = inject(GameLoopService);
  private readonly fx = inject(CombatFxService);
  private readonly audio = inject(AudioEngineService);
  private readonly sfx = new PropSfx(() => {
    const context = this.audio.context;
    const destination = this.audio.bus('sfx');
    const noise = this.audio.noiseBuffer();
    return context && destination && noise ? { context, destination, noise } : null;
  });

  readonly props: Destructible[] = DESTRUCTIBLE_LAYOUT.map((placement, id) => {
    const kind = DESTRUCTIBLE_KINDS[placement.kind];
    return {
      id, kind: placement.kind, x: placement.x, y: placement.y, rot: placement.rot,
      radius: kind.radius, hp: kind.hp, maxHp: kind.hp, broken: false,
      hitAt: -10, hitDirX: 0, hitDirY: 0, lastStrike: -1,
    };
  });

  /** Incrémenté à chaque changement d'état : la vue 3D ne recalcule que si besoin. */
  revision = 0;
  private pending: DestructibleEvent[] = [];
  private clock = 0;
  private strike = 0;
  private playerSwing = '';
  private playerStrike = 0;
  private bossSwing = '';
  private bossStrike = 0;

  private readonly terrain = inject(TerrainCollisionService);

  constructor() {
    this.terrain.setDynamicBlocker((x, y, radius) => this.blocks(x, y, radius));
  }

  get time() {
    return this.clock;
  }

  reset() {
    for (const prop of this.props) {
      prop.hp = prop.maxHp;
      prop.broken = false;
      prop.hitAt = -10;
      prop.lastStrike = -1;
    }
    this.pending = [];
    this.playerSwing = '';
    this.bossSwing = '';
    this.revision++;
  }

  /** Les événements depuis le dernier appel (vidés à la lecture). */
  drainEvents(): DestructibleEvent[] {
    const events = this.pending;
    this.pending = [];
    return events;
  }

  blocks(x: number, y: number, radius: number) {
    for (const prop of this.props) {
      if (prop.broken || !DESTRUCTIBLE_KINDS[prop.kind].solid) continue;
      const reach = radius + prop.radius * 0.85;
      if ((x - prop.x) ** 2 + (y - prop.y) ** 2 < reach * reach) return true;
    }
    return false;
  }

  /** @param bossActive le boss est présent (combat en cours). */
  update(deltaTime: number, bossActive: boolean) {
    this.clock += deltaTime;
    this.updatePlayer();
    this.updateArrows(deltaTime);
    if (bossActive) this.updateBoss(deltaTime);
  }

  // ---------------------------------------------------------------- joueur

  private updatePlayer() {
    const player = this.playerStore.getData();
    const cx = player.x + PLAYER_CONFIG.size / 2;
    const cy = player.y + PLAYER_CONFIG.size / 2;

    if (player.state === 'rolling') {
      const length = Math.hypot(player.vx, player.vy) || 1;
      for (const prop of this.props) {
        if (prop.broken || !DESTRUCTIBLE_KINDS[prop.kind].fragile) continue;
        if (Math.hypot(prop.x - cx, prop.y - cy) < prop.radius + 12) {
          this.damage(prop, 'roll', player.vx / length, player.vy / length, this.strike++);
        }
      }
    }

    if (player.state !== 'attacking') {
      this.playerSwing = '';
      return;
    }
    const swing = `${player.attackType}:${player.comboCount}`;
    if (swing !== this.playerSwing) {
      this.playerSwing = swing;
      this.playerStrike = this.strike++;
    }
    const attack = this.playerEntity.getActiveAttackData(player);
    const elapsed = attack.duration - player.stateTimer;
    if (elapsed < attack.windup || elapsed >= attack.windup + attack.active) return;

    const source: DamageSource = player.attackType === 'counter' ? 'counter'
      : player.attackType === 'heavy' ? 'heavy' : 'light';
    const facing = Math.hypot(player.facingX, player.facingY) || 1;
    const fx = player.facingX / facing;
    const fy = player.facingY / facing;
    // Portée de la lance : même échelle que la hitbox contre le boss.
    const reach = PLAYER_CONFIG.size / 2 + attack.range * PLAYER_CONFIG.size;
    let broke = false;
    for (const prop of this.props) {
      if (prop.broken || prop.lastStrike === this.playerStrike) continue;
      const dx = prop.x - cx;
      const dy = prop.y - cy;
      const distance = Math.hypot(dx, dy);
      if (distance > reach + prop.radius) continue;
      // Riposte : coup circulaire. Sinon, un cône devant le joueur.
      if (source !== 'counter' && dx * fx + dy * fy < distance * 0.35 - prop.radius) continue;
      // Derrière une case, un tronc ou un mur encore debout : la lance n'y arrive pas.
      if (this.occluded(cx, cy, prop, distance)) continue;
      broke = this.damage(prop, source, dx / (distance || 1), dy / (distance || 1), this.playerStrike) || broke;
    }
    if (broke) {
      this.renderer.shake(source === 'light' ? 2 : 4);
      this.fx.shake('horizontal', source === 'light' ? 0.35 : 0.7);
      this.gameloop.freeze(source === 'light' ? 22 : 40);
    }
  }

  /** Un obstacle dur se trouve-t-il entre le porteur et l'objet visé ? */
  private occluded(cx: number, cy: number, target: Destructible, distance: number) {
    const reach = distance - target.radius;
    if (reach <= 4) return false;
    const dx = (target.x - cx) / distance;
    const dy = (target.y - cy) / distance;
    if (this.terrain.castSolid(cx + dx * 4, cy + dy * 4, cx + dx * reach, cy + dy * reach)) return true;
    for (const prop of this.props) {
      if (prop === target || prop.broken) continue;
      const kind = DESTRUCTIBLE_KINDS[prop.kind];
      if (!kind.solid || kind.height < 12) continue;
      const t = segmentCircle(cx, cy, dx, dy, reach, prop.x, prop.y, prop.radius * 0.85);
      if (t !== null && t > 4) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- flèches

  private updateArrows(deltaTime: number) {
    for (const arrow of this.arrows.all) {
      if (arrow.grounded) continue;
      // Segment parcouru pendant la dernière frame : évite qu'une flèche
      // rapide traverse une jarre entre deux images.
      const travel = arrow.speed * deltaTime;
      const sx = arrow.x - arrow.dirX * travel;
      const sy = arrow.y - arrow.dirY * travel;
      let best: Destructible | null = null;
      let bestT = Infinity;
      for (const prop of this.props) {
        if (prop.broken) continue;
        const t = segmentCircle(sx, sy, arrow.dirX, arrow.dirY, travel, prop.x, prop.y, prop.radius);
        if (t !== null && t < bestT) {
          bestT = t;
          best = prop;
        }
      }
      if (!best) continue;
      const broke = this.damage(best, 'arrow', arrow.dirX, arrow.dirY, this.strike++);
      // Un objet brisé laisse passer la flèche. Sinon elle s'y fiche et tombe
      // au pied de l'objet, ramassable.
      if (broke && DESTRUCTIBLE_KINDS[best.kind].fragile) continue;
      arrow.x = sx + arrow.dirX * Math.max(0, bestT - 4);
      arrow.y = sy + arrow.dirY * Math.max(0, bestT - 4);
      arrow.grounded = true;
    }
  }

  // ---------------------------------------------------------------- boss

  private updateBoss(deltaTime: number) {
    const boss = this.bossStore.getData();
    if (boss.state === 'dead') return;
    const size = BOSS_CONFIG.size;
    const cx = boss.x + size / 2;
    const cy = boss.y + size / 2;
    const attack = boss.currentAttack as BossAttackType;

    // Le boss qui marche bouscule le décor : petits objets brisés net,
    // murs qui cèdent s'il insiste.
    if (boss.state === 'chase' || boss.state === 'idle') {
      for (const prop of this.props) {
        if (prop.broken) continue;
        const dx = prop.x - cx;
        const dy = prop.y - cy;
        const distance = Math.hypot(dx, dy);
        if (distance > prop.radius + 26) continue;
        const nx = dx / (distance || 1);
        const ny = dy / (distance || 1);
        if (DESTRUCTIBLE_KINDS[prop.kind].fragile) this.damage(prop, 'boss', nx, ny, this.strike++);
        else if (boss.state === 'chase') this.damage(prop, 'contact', nx, ny, this.strike++, deltaTime);
      }
    }

    if (boss.state !== 'attacking' || !(attack in BOSS_ATTACKS)) {
      this.bossSwing = '';
      return;
    }
    const cfg = BOSS_ATTACKS[attack as Exclude<BossAttackType, 'none'>];
    const length = boss.stateLength || cfg.attackDuration;
    const progress = Math.max(0, Math.min(1, 1 - boss.stateTimer / length));
    const swing = `${attack}:${boss.comboStep}`;
    if (swing !== this.bossSwing) {
      this.bossSwing = swing;
      this.bossStrike = this.strike++;
    }
    if (!isBossHitActive(attack, progress)) return;

    const facing = Math.hypot(boss.facingX, boss.facingY) || 1;
    const fx = boss.facingX / facing;
    const fy = boss.facingY / facing;
    const rings = attack === 'surge' ? [surgeRadius(size, boss.stateTimer)]
      : attack === 'tide' ? tideRadii(size, boss.stateTimer) : null;
    let broke = false;
    for (const prop of this.props) {
      if (prop.broken || prop.lastStrike === this.bossStrike) continue;
      const dx = prop.x - cx;
      const dy = prop.y - cy;
      const distance = Math.hypot(dx, dy);
      let hit: boolean;
      if (rings) hit = rings.some((radius) => Math.abs(distance - radius) <= SURGE_WIDTH + prop.radius);
      else if (attack === 'charge') hit = distance < size * 0.7 + prop.radius;
      else if (cfg.hitBoxType === 'aoe') hit = distance < cfg.range * size / 2 + prop.radius;
      else {
        hit = distance < Math.min(cfg.range * size, size * 2.2) + prop.radius &&
          dx * fx + dy * fy > distance * 0.22 - prop.radius;
      }
      if (!hit) continue;
      broke = this.damage(prop, 'boss', dx / (distance || 1), dy / (distance || 1), this.bossStrike) || broke;
    }
    if (broke) {
      this.renderer.shake(3);
      this.fx.shake('vertical', 0.6);
    }
  }

  // ---------------------------------------------------------------- dégâts

  /** Renvoie true si l'objet vient de se briser. */
  private damage(prop: Destructible, source: DamageSource, dirX: number, dirY: number, strike: number, scale = 1) {
    const kind = DESTRUCTIBLE_KINDS[prop.kind];
    const amount = DESTRUCTIBLE_DAMAGE[source] * (kind.resist[source] ?? 1) * scale;
    prop.lastStrike = strike;
    if (amount <= 0) {
      // Coup absorbé (flèche contre la pierre) : léger tremblement seulement.
      if (source !== 'contact') this.mark(prop, dirX, dirY, 0.2, false);
      return false;
    }
    prop.hp = Math.max(0, prop.hp - amount);
    const broken = prop.hp <= 0;
    prop.broken = broken;
    // Le contact continu du boss ne relance pas un tremblement à chaque frame.
    if (source !== 'contact' || broken || this.clock - prop.hitAt > 0.25) {
      this.mark(prop, dirX, dirY, Math.min(1, amount / prop.maxHp + (broken ? 0.6 : 0.25)), broken);
    }
    this.revision++;
    return broken;
  }

  private mark(prop: Destructible, dirX: number, dirY: number, strength: number, broken: boolean) {
    const kind = DESTRUCTIBLE_KINDS[prop.kind];
    this.sfx.play(kind.debris, broken, strength + (kind.solid ? 0.3 : 0));
    // Un mur qui s'effondre soulève un nuage de poussière.
    if (broken && kind.solid) this.fx.dust(prop.x, prop.y, dirX, dirY, kind.debris === 'clod' ? 1.6 : 1, false);
    prop.hitAt = this.clock;
    prop.hitDirX = dirX;
    prop.hitDirY = dirY;
    this.revision++;
    if (this.pending.length < 64) this.pending.push({ id: prop.id, broken, dirX, dirY, strength });
  }

  /** Rendu 2D (vue de secours sans WebGL), dans le repère monde. */
  draw(ctx: CanvasRenderingContext2D) {
    for (const prop of this.props) {
      const kind = DESTRUCTIBLE_KINDS[prop.kind];
      ctx.fillStyle = prop.broken ? kind.accent : kind.color;
      ctx.globalAlpha = prop.broken ? 0.55 : 1;
      ctx.beginPath();
      ctx.arc(prop.x, prop.y, prop.broken ? prop.radius * 0.6 : prop.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/** Distance le long du segment où il entre dans le cercle, ou null. */
function segmentCircle(sx: number, sy: number, dx: number, dy: number, length: number,
  cx: number, cy: number, radius: number): number | null {
  const ox = sx - cx;
  const oy = sy - cy;
  const b = ox * dx + oy * dy;
  const c = ox * ox + oy * oy - radius * radius;
  if (c <= 0) return 0;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= length ? t : null;
}
