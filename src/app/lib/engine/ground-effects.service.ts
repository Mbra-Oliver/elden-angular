import { Injectable } from '@angular/core';
import { FORD_SURFACE } from '../constants/scenery';

interface Grain {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  duration: number;
  size: number;
  wet: boolean;
}

@Injectable({ providedIn: 'root' })
export class GroundEffectsService {
  private readonly grains: Grain[] = [];
  private readonly stride = [0, 0];

  reset() {
    this.grains.length = 0;
    this.stride.fill(0);
  }

  update(dt: number) {
    for (let index = this.grains.length - 1; index >= 0; index--) {
      const grain = this.grains[index];
      grain.life -= dt;
      if (grain.life <= 0) {
        this.grains[index] = this.grains[this.grains.length - 1];
        this.grains.pop();
      } else {
        grain.x += grain.vx * dt;
        grain.y += grain.vy * dt;
      }
    }
  }

  track(actor: 0 | 1, x: number, y: number, dx: number, dy: number, fast: boolean) {
    const distance = Math.hypot(dx, dy);
    if (distance < 0.1) return;
    this.stride[actor] += distance;
    if (this.stride[actor] < (fast ? 9 : 19)) return;
    this.stride[actor] = 0;
    this.emit(x - dx, y - dy, fast ? 5 : 2, -dx / distance, -dy / distance);
  }

  emit(x: number, y: number, amount: number, dx = 0, dy = 0, forceWet = false) {
    const ford = FORD_SURFACE;
    const wet = forceWet || (x >= ford.x && x <= ford.x + ford.w && y >= ford.y && y <= ford.y + ford.h);
    for (let n = 0; n < amount && this.grains.length < 110; n++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 14 + Math.random() * (wet ? 45 : 32);
      const duration = wet ? 0.38 : 0.38 + Math.random() * 0.24;
      this.grains.push({
        x, y, vx: Math.cos(angle) * velocity + dx * 45, vy: Math.sin(angle) * velocity + dy * 45,
        duration, life: duration, size: 1 + Math.random() * 2.75, wet,
      });
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    for (const grain of this.grains) {
      const fraction = grain.life / grain.duration;
      const height = grain.wet ? Math.sin(Math.PI * fraction) * 13 : 0;
      const radius = grain.size * (grain.wet ? 0.7 : 1.7 - fraction);
      ctx.fillStyle = grain.wet ? '#c3e7d7' : '#d4a46d';
      ctx.globalAlpha = fraction * (grain.wet ? 0.8 : 0.37);
      ctx.beginPath();
      ctx.ellipse(grain.x, grain.y - height, radius, radius * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
