import { inject, Injectable } from '@angular/core';
import { EQUIPMENT_CONFIG } from '../../constants/equipment.config-constant';
import { WORLD } from '../../constants/terrain-constant';
import type { DuelArena } from '../../engine/duel-fog';
import { RendererService } from '../../services/renderer.service';
import { EquipmentStore } from '../player/equipment.store';

export interface Arrow {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  speed: number;
  damage: number;
  travelled: number;
  maxDistance: number;
  /** Au sol : la flèche a manqué, elle peut être ramassée. */
  grounded: boolean;
  life: number; // secondes restantes au sol
}

export interface ArrowTarget {
  x: number;
  y: number;
  radius: number;
}

export interface ArrowHit {
  damage: number;
  dirX: number;
  dirY: number;
  x: number;
  y: number;
  /** Index de la cible touchée quand plusieurs cibles sont passées. */
  index?: number;
}

/** Flèches en vol et flèches tombées au sol (ramassables). */
@Injectable({ providedIn: 'root' })
export class ArrowService {
  private readonly equipment = inject(EquipmentStore);
  private readonly renderer = inject(RendererService);
  private arrows: Arrow[] = [];

  get all(): readonly Arrow[] {
    return this.arrows;
  }

  reset() {
    this.arrows = [];
  }

  fire(x: number, y: number, dirX: number, dirY: number, speed: number, damage: number, maxDistance: number) {
    const length = Math.hypot(dirX, dirY) || 1;
    this.arrows.push({
      x, y, dirX: dirX / length, dirY: dirY / length, speed, damage,
      travelled: 0, maxDistance, grounded: false, life: EQUIPMENT_CONFIG.groundArrowLifetime,
    });
  }

  /**
   * Avance les flèches, renvoie les impacts sur la cible et gère le ramassage.
   * Une flèche qui touche est perdue ; une flèche qui manque tombe au sol.
   */
  update(deltaTime: number, target: ArrowTarget | readonly ArrowTarget[] | null, picker: { x: number; y: number } | null,
    arena?: DuelArena | null, blocked?: (x: number, y: number) => boolean): ArrowHit[] {
    const targets: readonly ArrowTarget[] = !target ? [] : Array.isArray(target) ? target : [target as ArrowTarget];
    const hits: ArrowHit[] = [];
    const kept: Arrow[] = [];
    for (const arrow of this.arrows) {
      if (arrow.grounded) {
        arrow.life -= deltaTime;
        const picked = picker &&
          Math.hypot(picker.x - arrow.x, picker.y - arrow.y) < EQUIPMENT_CONFIG.arrowPickupRadius &&
          this.equipment.recoverArrow();
        if (!picked && arrow.life > 0) kept.push(arrow);
        continue;
      }

      // Sous-pas : une flèche rapide ne doit pas traverser la cible entre deux frames.
      const distance = arrow.speed * deltaTime;
      const steps = Math.max(1, Math.ceil(distance / 8));
      let hit = false;
      for (let step = 0; step < steps && !arrow.grounded; step++) {
        arrow.x += arrow.dirX * distance / steps;
        arrow.y += arrow.dirY * distance / steps;
        arrow.travelled += distance / steps;
        const index = targets.findIndex((t) => Math.hypot(t.x - arrow.x, t.y - arrow.y) <
          t.radius + EQUIPMENT_CONFIG.arrowHitRadius);
        if (index >= 0) {
          hits.push({ damage: arrow.damage, dirX: arrow.dirX, dirY: arrow.dirY, x: arrow.x, y: arrow.y, index });
          hit = true;
          break;
        }
        if (blocked?.(arrow.x, arrow.y)) {
          arrow.x -= arrow.dirX * 6;
          arrow.y -= arrow.dirY * 6;
          arrow.grounded = true;
          break;
        }
        const outOfArena = arena && Math.hypot(arrow.x - arena.x, arrow.y - arena.y) > arena.radius - 6;
        const outOfWorld = arrow.x < 4 || arrow.y < 4 || arrow.x > WORLD.WIDTH - 4 || arrow.y > WORLD.HEIGHT - 4;
        if (outOfArena || outOfWorld) {
          arrow.x -= arrow.dirX * 6;
          arrow.y -= arrow.dirY * 6;
          arrow.grounded = true;
        } else if (arrow.travelled >= arrow.maxDistance) {
          arrow.grounded = true;
        }
      }
      if (!hit) kept.push(arrow);
    }
    this.arrows = kept;
    return hits;
  }

  /** Rendu 2D (vue de secours sans WebGL), dans le repère monde. */
  render() {
    const ctx = this.renderer.context;
    if (!ctx) return;
    for (const arrow of this.arrows) {
      const length = arrow.grounded ? 10 : 16;
      ctx.save();
      ctx.globalAlpha = arrow.grounded ? Math.min(1, arrow.life / 3) * 0.85 : 1;
      ctx.strokeStyle = '#6b4a2b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(arrow.x, arrow.y);
      ctx.lineTo(arrow.x - arrow.dirX * length, arrow.y - arrow.dirY * length);
      ctx.stroke();
      ctx.fillStyle = '#d9d2c0';
      ctx.beginPath();
      ctx.arc(arrow.x, arrow.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
