import { Injectable } from '@angular/core';
import { HUTS, TREES, WATER } from '../constants/scenery';
import type { DuelArena } from './duel-fog';
import { WORLD } from '../constants/terrain-constant';

interface Point { x: number; y: number }
interface Circle extends Point { radius: number; surface: WeaponSurface }

/** Ce que l'arme heurte : sert au son et aux éclats du rebond. */
export type WeaponSurface = 'wood' | 'earth' | 'thatch';

/** Premier obstacle rencontré par une arme le long d'un segment. */
export interface WeaponContact {
  /** Distance parcourue depuis le départ du segment. */
  t: number;
  x: number;
  y: number;
  surface: WeaponSurface;
}

type Blocker = (x: number, y: number, radius: number) => boolean;
/** Pas d'échantillonnage du lancer d'arme (unités du monde). */
const WEAPON_STEP = 2;

const CELL = 96;
const GROUND_STEP = 2;
const GROUND_CACHE_LIMIT = 4096;
const CIRCLES: Circle[] = [
  ...HUTS.map(([x, y, radius]) => ({ x, y: y + 5, radius: radius * 0.82, surface: 'thatch' as const })),
  ...TREES.map(({ x, y, radius }) => ({ x, y: y + 3, radius: radius * 0.68, surface: 'wood' as const })),
];

@Injectable({ providedIn: 'root' })
export class TerrainCollisionService {
  private arena: DuelArena | null = null;
  private groundSampler: ((x: number, y: number) => number) | null = null;
  private readonly groundCache = new Map<string, number>();
  private readonly cells = new Map<number, Circle[]>();
  private readonly columns = Math.ceil(WORLD.WIDTH / CELL) + 2;

  constructor() {
    for (const circle of CIRCLES) {
      const { x, y, radius } = circle;
      for (let row = Math.floor((y - radius) / CELL); row <= Math.floor((y + radius) / CELL); row++) {
        for (let col = Math.floor((x - radius) / CELL); col <= Math.floor((x + radius) / CELL); col++) {
          const key = row * this.columns + col;
          const cell = this.cells.get(key) ?? [];
          cell.push(circle);
          this.cells.set(key, cell);
        }
      }
    }
  }

  setArena(arena: DuelArena | null) {
    this.arena = arena;
  }

  setGroundSampler(sampler: ((x: number, y: number) => number) | null) {
    this.groundSampler = sampler;
    this.groundCache.clear();
  }

  groundAt(x: number, y: number): number {
    if (!this.groundSampler) return 0;
    const gx = Math.round(x / GROUND_STEP);
    const gy = Math.round(y / GROUND_STEP);
    const key = `${gx},${gy}`;
    const cached = this.groundCache.get(key);
    if (cached !== undefined) return cached;
    if (this.groundCache.size >= GROUND_CACHE_LIMIT) this.groundCache.clear();
    const height = this.groundSampler(gx * GROUND_STEP, gy * GROUND_STEP);
    this.groundCache.set(key, height);
    return height;
  }

  gradeFactor(x: number, y: number, dirX: number, dirY: number): number {
    if (!this.groundSampler) return 1;
    const step = 14;
    const gx = (this.groundAt(x + step, y) - this.groundAt(x - step, y)) / (2 * step);
    const gy = (this.groundAt(x, y + step) - this.groundAt(x, y - step)) / (2 * step);
    const climb = Math.max(0, gx * dirX + gy * dirY);
    return 1 / (1 + climb * 2.4);
  }

  /** Obstacles mobiles ou destructibles (décor cassable), testés en plus du décor fixe. */
  private dynamicBlocker: ((x: number, y: number, radius: number) => boolean) | null = null;

  setDynamicBlocker(blocker: ((x: number, y: number, radius: number) => boolean) | null) {
    this.dynamicBlocker = blocker;
  }

  /** Obstacles permanents ajoutés par d'autres systèmes (palissade, ruines…). */
  private readonly blockers: Blocker[] = [];
  /** Obstacles qui arrêtent aussi les armes (murs, rochers ; pas l'eau ni les bords de carte). */
  private readonly weaponBlockers: Blocker[] = [];

  /**
   * @param stopsWeapons false quand le bloqueur décrit aussi de l'eau ou des
   * bords de falaise : on ne veut pas qu'un coup de lance « rebondisse » sur une rivière.
   */
  addBlocker(blocker: Blocker, stopsWeapons = true) {
    if (!this.blockers.includes(blocker)) this.blockers.push(blocker);
    if (stopsWeapons) this.addWeaponBlocker(blocker);
  }

  /** Obstacle pour les armes seulement (le déplacement a déjà son propre bloqueur). */
  addWeaponBlocker(blocker: Blocker) {
    if (!this.weaponBlockers.includes(blocker)) this.weaponBlockers.push(blocker);
  }

  /**
   * Décor fixe et dur au point donné, pour une arme : cases, troncs, murs.
   * Ni l'eau, ni la brume de l'arène, ni le décor cassable (testé à part).
   */
  solidAt(x: number, y: number, radius = 0.5): WeaponSurface | null {
    const row = Math.floor(y / CELL);
    const col = Math.floor(x / CELL);
    if (col >= 0 && col < this.columns) {
      const obstacles = this.cells.get(row * this.columns + col);
      if (obstacles) {
        for (const obstacle of obstacles) {
          if ((x - obstacle.x) ** 2 + (y - obstacle.y) ** 2 < (radius + obstacle.radius) ** 2) return obstacle.surface;
        }
      }
    }
    for (const blocker of this.weaponBlockers) if (blocker(x, y, radius)) return 'earth';
    return null;
  }

  /** Premier décor fixe sur le segment (sx, sy) → (ex, ey), ou null s'il est dégagé. */
  castSolid(sx: number, sy: number, ex: number, ey: number): WeaponContact | null {
    const length = Math.hypot(ex - sx, ey - sy);
    if (length < 1e-3) return null;
    const steps = Math.ceil(length / WEAPON_STEP);
    for (let i = 1; i <= steps; i++) {
      const t = Math.min(length, i * WEAPON_STEP);
      const x = sx + (ex - sx) * t / length;
      const y = sy + (ey - sy) * t / length;
      const surface = this.solidAt(x, y);
      if (surface) return { t, x, y, surface };
    }
    return null;
  }

  /** Cartes hors du monde principal (prologue) : on reste borné à celle où l'on est. */
  private readonly regions: { x: number; y: number; w: number; h: number }[] = [];

  addRegion(rect: { x: number; y: number; w: number; h: number }) {
    if (!this.regions.includes(rect)) this.regions.push(rect);
  }

  private boundsAt(x: number, y: number) {
    return this.regions.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
      ?? { x: 0, y: 0, w: WORLD.WIDTH, h: WORLD.HEIGHT };
  }

  move(fromX: number, fromY: number, toX: number, toY: number, radius: number): Point {
    let x = fromX;
    let y = fromY;
    const steps = Math.max(1, Math.ceil(Math.hypot(toX - fromX, toY - fromY) / 5));
    const dx = (toX - fromX) / steps;
    const dy = (toY - fromY) / steps;
    const b = this.boundsAt(fromX, fromY);

    for (let step = 0; step < steps; step++) {
      const nx = Math.max(b.x + radius, Math.min(b.x + b.w - radius, x + dx));
      if (!this.blocked(nx, y, radius)) x = nx;
      const ny = Math.max(b.y + radius, Math.min(b.y + b.h - radius, y + dy));
      if (!this.blocked(x, ny, radius)) y = ny;
    }
    return { x, y };
  }

  /**
   * Une balle passant en (x, y) touche-t-elle le décor ? Les obstacles durs
   * (cases, arbres, rochers, troncs, murs), les murs/briques et le décor
   * cassable, mais pas les bords du sentier ni l'eau.
   */
  blocksShot(x: number, y: number): boolean {
    return this.solidAt(x, y, 1) !== null || !!this.dynamicBlocker?.(x, y, 1);
  }

  private blocked(x: number, y: number, radius: number) {
    const arena = this.arena;
    if (arena && (x - arena.x) ** 2 + (y - arena.y) ** 2 > (arena.radius - radius) ** 2) return true;
    for (let row = Math.floor((y - radius) / CELL); row <= Math.floor((y + radius) / CELL); row++) {
      for (let col = Math.floor((x - radius) / CELL); col <= Math.floor((x + radius) / CELL); col++) {
        // Hors de la grille (carte du prologue) : la clé tomberait sur une autre ligne.
        if (col < 0 || col >= this.columns) continue;
        const obstacles = this.cells.get(row * this.columns + col);
        if (obstacles?.some((obstacle) =>
          (x - obstacle.x) ** 2 + (y - obstacle.y) ** 2 < (radius + obstacle.radius) ** 2)) return true;
      }
    }
    if (this.dynamicBlocker?.(x, y, radius)) return true;
    if (this.blockers.some((blocker) => blocker(x, y, radius))) return true;
    return WATER.some((water) => {
      const edgeX = Math.max(water.x, Math.min(x, water.x + water.w));
      const edgeY = Math.max(water.y, Math.min(y, water.y + water.h));
      return (x - edgeX) ** 2 + (y - edgeY) ** 2 < radius ** 2;
    });
  }
}
