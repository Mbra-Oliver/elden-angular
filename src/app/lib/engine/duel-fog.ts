import { WORLD } from '../constants/terrain-constant';

export interface DuelArena { x: number; y: number; radius: number }

// Arènes agrandies (rayons 232 → 290 et 283 → 345, soit ~1,5× la surface).
// Centres choisis pour que la rivière, le bord du monde et les cases restent
// hors du cercle (le gué) ou seulement en lisière (la retenue).
export const FORD_DUEL: DuelArena = { x: 712, y: 305, radius: 290 };
export const SLUICE_DUEL: DuelArena = { x: 1500, y: 800, radius: 345 };

export class DuelFog {
  private lastArena?: DuelArena;
  private canvas?: HTMLCanvasElement;

  draw(ctx: CanvasRenderingContext2D, arena: DuelArena) {
    if (this.lastArena !== arena || !this.canvas) {
      this.lastArena = arena;
      this.canvas = this.paint(arena.radius);
    }
    const radius = this.canvas.width / 2;
    ctx.save();
    ctx.fillStyle = '#93aba2a4';
    ctx.beginPath();
    ctx.rect(0, 0, WORLD.WIDTH, WORLD.HEIGHT);
    ctx.arc(arena.x, arena.y, radius, 0, Math.PI * 2);
    ctx.fill('evenodd');
    ctx.translate(arena.x, arena.y);
    ctx.rotate(performance.now() * 0.000044);
    ctx.drawImage(this.canvas, -radius, -radius);
    ctx.restore();
  }

  private paint(radius: number) {
    const canvas = document.createElement('canvas');
    const extent = radius + 100;
    canvas.width = canvas.height = extent * 2;
    const ctx = canvas.getContext('2d')!;
    const mist = ctx.createRadialGradient(extent, extent, radius - 92, extent, extent, extent);
    mist.addColorStop(0, '#b1c4b500');
    mist.addColorStop(0.27, '#a8c3b457');
    mist.addColorStop(0.47, '#d7e5d5e8');
    mist.addColorStop(0.67, '#b2c8baf2');
    mist.addColorStop(1, '#93aba2a4');
    ctx.fillStyle = mist;
    ctx.beginPath();
    ctx.arc(extent, extent, extent, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 59; i++) {
      const angle = i * Math.PI * 2 / 59;
      const distance = radius + Math.sin(i * 4.3) * 31;
      const x = extent + Math.cos(angle) * distance;
      const y = extent + Math.sin(angle) * distance;
      const puff = ctx.createRadialGradient(x, y, 0, x, y, 24 + (i % 5) * 5);
      puff.addColorStop(0, '#e0ecdf81');
      puff.addColorStop(1, '#d6e6d600');
      ctx.fillStyle = puff;
      ctx.fillRect(x - 45, y - 45, 90, 90);
    }
    return canvas;
  }
}
