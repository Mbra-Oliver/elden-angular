import { Injectable } from '@angular/core';
import { HUTS, TREES, WATER } from '../constants/scenery';
import type { DuelArena } from './duel-fog';
import { WORLD } from '../constants/terrain-constant';

interface Point { x: number; y: number }
interface Circle extends Point { radius: number }

const CELL = 96;
const CIRCLES: Circle[] = [
  ...HUTS.map(([x, y, radius]) => ({ x, y: y + 5, radius: radius * 0.82 })),
  ...TREES.map(({ x, y, radius }) => ({ x, y: y + 3, radius: radius * 0.68 })),
];

@Injectable({ providedIn: 'root' })
export class TerrainCollisionService {
  private arena: DuelArena | null = null;
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

  /** Obstacles mobiles ou destructibles (décor cassable), testés en plus du décor fixe. */
  private dynamicBlocker: ((x: number, y: number, radius: number) => boolean) | null = null;

  setDynamicBlocker(blocker: ((x: number, y: number, radius: number) => boolean) | null) {
    this.dynamicBlocker = blocker;
  }

  move(fromX: number, fromY: number, toX: number, toY: number, radius: number): Point {
    let x = fromX;
    let y = fromY;
    const steps = Math.max(1, Math.ceil(Math.hypot(toX - fromX, toY - fromY) / 5));
    const dx = (toX - fromX) / steps;
    const dy = (toY - fromY) / steps;

    for (let step = 0; step < steps; step++) {
      const nx = Math.max(radius, Math.min(WORLD.WIDTH - radius, x + dx));
      if (!this.blocked(nx, y, radius)) x = nx;
      const ny = Math.max(radius, Math.min(WORLD.HEIGHT - radius, y + dy));
      if (!this.blocked(x, ny, radius)) y = ny;
    }
    return { x, y };
  }

  private blocked(x: number, y: number, radius: number) {
    const arena = this.arena;
    if (arena && (x - arena.x) ** 2 + (y - arena.y) ** 2 > (arena.radius - radius) ** 2) return true;
    for (let row = Math.floor((y - radius) / CELL); row <= Math.floor((y + radius) / CELL); row++) {
      for (let col = Math.floor((x - radius) / CELL); col <= Math.floor((x + radius) / CELL); col++) {
        const obstacles = this.cells.get(row * this.columns + col);
        if (obstacles?.some((obstacle) =>
          (x - obstacle.x) ** 2 + (y - obstacle.y) ** 2 < (radius + obstacle.radius) ** 2)) return true;
      }
    }
    if (this.dynamicBlocker?.(x, y, radius)) return true;
    return WATER.some((water) => {
      const edgeX = Math.max(water.x, Math.min(x, water.x + water.w));
      const edgeY = Math.max(water.y, Math.min(y, water.y + water.h));
      return (x - edgeX) ** 2 + (y - edgeY) ** 2 < radius ** 2;
    });
  }
}
