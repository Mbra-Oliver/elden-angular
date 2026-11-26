import { inject, Injectable } from '@angular/core';
import { DESTRUCTIBLE_KINDS, type DebrisStyle } from '../constants/destructibles.config-constant';
import { PLAYER_CONFIG } from '../constants/player.config-constant';
import { PlayerEntity } from '../entities/player/player.entity';
import { PlayerStore } from '../entities/player/player.store';
import { CombatFxService } from '../services/combat-fx.service';
import { GameLoopService } from '../services/game-loop.service';
import { RendererService } from '../services/renderer.service';
import { DestructiblesService } from './destructibles.service';
import { TerrainCollisionService, type WeaponContact, type WeaponSurface } from './terrain-collision.service';

/**
 * Hauteur d'un coup de lance ou d'afena (poitrine) : un fagot ou une jarre
 * basse n'arrête pas un estoc, une palissade ou un mur si. [SUPPOSITION]
 */
export const STRIKE_HEIGHT = 12;
/** Distance minimale depuis le centre du porteur avant de tester : ses propres pieds ne comptent pas. */
const START_OFFSET = 4;

/** Contact d'arme : décor fixe, ou objet cassable encore debout (son id). */
export interface ObstacleContact extends WeaponContact {
  propId?: number;
}

/** Rayons testés pour un coup dans le vide : l'axe, et de part et d'autre pour une taille. */
const SLASH_RAYS = [0, -0.42, 0.42];

const DEBRIS_SURFACE: Record<DebrisStyle, WeaponSurface> = {
  shard: 'earth', clod: 'earth', splinter: 'wood', straw: 'thatch',
};

/**
 * « L'arme traverse-t-elle le décor ? » : une seule question, posée par la
 * logique des coups (boss, soldats, décor cassable) et par la vue 3D (la
 * lance recule au lieu de s'enfoncer dans un mur).
 *
 * Décor fixe : cases, troncs, ruines, murs de la tranche, rochers du prologue.
 * Décor cassable : seulement les objets solides encore debout, assez hauts
 * pour arrêter un coup à hauteur de poitrine.
 */
@Injectable({ providedIn: 'root' })
export class WeaponObstructionService {
  private readonly terrain = inject(TerrainCollisionService);
  private readonly destructibles = inject(DestructiblesService);
  private readonly playerStore = inject(PlayerStore);
  private readonly player = inject(PlayerEntity);
  private readonly fx = inject(CombatFxService);
  private readonly loop = inject(GameLoopService);
  private readonly renderer = inject(RendererService);

  private swingKey = '';
  private stopped = false;
  private landed = false;

  /** Le coup en cours a buté sur le décor : il ne touche plus rien. */
  get swingStopped() {
    return this.stopped;
  }

  /** Le coup en cours a porté sur une cible (pas de rebond ensuite sur le décor derrière elle). */
  noteHit() {
    this.landed = true;
  }

  /**
   * Coup du joueur vers une cible : renvoie true si le décor l'arrête
   * (et déclenche alors le rebond). À appeler avant d'infliger les dégâts.
   * @param radius rayon de la cible : on teste jusqu'à sa surface.
   */
  strikeBlocked(tx: number, ty: number, radius: number): boolean {
    if (this.stopped) return true;
    const contact = this.occluded(tx, ty, radius);
    if (!contact) return false;
    const distance = Math.hypot(tx - this.player.centerX, ty - this.player.centerY) || 1;
    this.stop(contact, (tx - this.player.centerX) / distance, (ty - this.player.centerY) / distance);
    return true;
  }

  /**
   * Obstacle entre le joueur et la surface d'une cible, sans rebond : pour
   * les mêlées à plusieurs cibles, où une autre cible reste peut-être à portée.
   */
  occluded(tx: number, ty: number, radius: number): ObstacleContact | null {
    const sx = this.player.centerX;
    const sy = this.player.centerY;
    const distance = Math.hypot(tx - sx, ty - sy);
    if (distance - radius <= START_OFFSET) return null;
    const k = (distance - radius) / distance;
    return this.cast(sx, sy, sx + (tx - sx) * k, sy + (ty - sy) * k);
  }

  /**
   * Une fois par image, après les tests de touche : un coup qui n'a rien
   * touché mais dont la lame rencontre une case, un tronc ou un mur rebondit.
   */
  update() {
    const data = this.playerStore.getData();
    if (data.state !== 'attacking') {
      this.swingKey = '';
      this.stopped = false;
      this.landed = false;
      return;
    }
    const key = `${data.attackType}:${data.comboCount}`;
    if (key !== this.swingKey) {
      this.swingKey = key;
      this.stopped = false;
      this.landed = false;
    }
    // La riposte est une volte au corps à corps : pas de rebond sur le décor.
    if (this.stopped || this.landed || data.attackType === 'counter') return;
    const attack = this.player.getActiveAttackData(data);
    const elapsed = attack.duration - data.stateTimer;
    if (elapsed < attack.windup || elapsed >= attack.windup + attack.active) return;

    const facing = Math.hypot(data.facingX, data.facingY) || 1;
    const fx = data.facingX / facing;
    const fy = data.facingY / facing;
    const reach = PLAYER_CONFIG.size / 2 + attack.range * PLAYER_CONFIG.size;
    const sx = this.player.centerX;
    const sy = this.player.centerY;
    // Un estoc ne file que dans l'axe ; une taille balaie un arc (afena : 1er
    // et 2e coups ; lance : le coup de talon montant, 2e de la série).
    const afena = this.player.equipment.getData().weapon === 'afena';
    const slash = data.attackType === 'light' && (afena ? data.comboCount < 3 : data.comboCount === 2);
    const rays = slash ? SLASH_RAYS : SLASH_RAYS.slice(0, 1);
    let best: ObstacleContact | null = null;
    for (const angle of rays) {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const dx = fx * c - fy * s;
      const dy = fx * s + fy * c;
      // Les rayons de côté portent un peu moins loin (bout de l'arc).
      const length = reach * (angle === 0 ? 1 : 0.8);
      const contact = this.cast(sx, sy, sx + dx * length, sy + dy * length);
      if (contact && (!best || contact.t < best.t)) best = contact;
    }
    if (best) this.stop(best, fx, fy);
  }

  /** Rebond : son et éclats au point de contact, micro-gel, la lame repart en récupération. */
  private stop(contact: ObstacleContact, dirX: number, dirY: number) {
    this.stopped = true;
    const data = this.playerStore.getData();
    const attack = this.player.getActiveAttackData(data);
    const heavy = data.attackType === 'heavy';
    // Le décor cassable a déjà son propre son de choc (destructibles.service) : pas de doublon.
    if (contact.propId === undefined) this.fx.glance(contact.x, contact.y, dirX, dirY, contact.surface, heavy ? 1.3 : 0.9);
    else this.fx.shake('horizontal', heavy ? 0.45 : 0.3);
    this.renderer.shake(heavy ? 3 : 2);
    this.loop.freeze(heavy ? 70 : 50);
    // La fin de la fenêtre active est sautée : l'arme repart aussitôt, comme
    // repoussée par l'obstacle. La récupération (et ses annulations) reste la même.
    const recoverAt = attack.duration - (attack.windup + attack.active);
    if (data.stateTimer > recoverAt) this.playerStore.update({ stateTimer: recoverAt });
  }

  /**
   * Premier obstacle entre (sx, sy) et (ex, ey), ou null si le coup passe.
   * @param ignoreProp objet visé lui-même (on ne se bloque pas sur sa cible).
   */
  cast(sx: number, sy: number, ex: number, ey: number, height = STRIKE_HEIGHT, ignoreProp?: number): ObstacleContact | null {
    const length = Math.hypot(ex - sx, ey - sy);
    if (length <= START_OFFSET) return null;
    const dx = (ex - sx) / length;
    const dy = (ey - sy) / length;
    const ox = sx + dx * START_OFFSET;
    const oy = sy + dy * START_OFFSET;
    let best: ObstacleContact | null = null;
    const fixed = this.terrain.castSolid(ox, oy, ex, ey);
    if (fixed) best = { ...fixed, t: fixed.t + START_OFFSET };

    for (const prop of this.destructibles.props) {
      if (prop.broken || prop.id === ignoreProp) continue;
      const kind = DESTRUCTIBLE_KINDS[prop.kind];
      if (!kind.solid || kind.height < height) continue;
      const t = entry(sx, sy, dx, dy, length, prop.x, prop.y, prop.radius * 0.85);
      if (t === null || t < START_OFFSET || (best && t >= best.t)) continue;
      best = { t, x: sx + dx * t, y: sy + dy * t, surface: DEBRIS_SURFACE[kind.debris], propId: prop.id };
    }
    return best;
  }

  /** Le point 3D (x, y du plan de jeu, hauteur) est-il dans un obstacle dur ? */
  inside(x: number, y: number, height: number): boolean {
    if (height < 0.5) return false; // dans le sol : géré par l'animation, pas ici
    if (this.terrain.solidAt(x, y, 0.3)) return true;
    for (const prop of this.destructibles.props) {
      if (prop.broken) continue;
      const kind = DESTRUCTIBLE_KINDS[prop.kind];
      if (!kind.solid || height > kind.height) continue;
      const r = prop.radius * 0.85;
      if ((x - prop.x) ** 2 + (y - prop.y) ** 2 < r * r) return true;
    }
    return false;
  }
}

/** Distance le long du segment où il entre dans le cercle, ou null. */
function entry(sx: number, sy: number, dx: number, dy: number, length: number,
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
