import { inject, Injectable } from '@angular/core';
import { GameStore } from '../store/game.store';

@Injectable({ providedIn: 'root' })
export class GameLoopService {
  private readonly gameStore = inject(GameStore);
  private freezeMilliseconds = 0;
  private readonly updateCallbacks = new Set<(deltaTime: number) => void>();
  private readonly renderCallbacks = new Set<() => void>();

  start() {
    if (!this.gameStore.isRunning()) this.gameStore.start();
  }

  stop() {
    this.gameStore.stop();
    this.freezeMilliseconds = 0;
  }

  /** Appelé par la scène Phaser. Les entités utilisent des secondes. */
  update(deltaMilliseconds: number) {
    if (!this.gameStore.isRunning()) return;
    this.gameStore.updateFrame(performance.now());
    const paused = Math.min(this.freezeMilliseconds, deltaMilliseconds);
    this.freezeMilliseconds -= paused;
    const deltaTime = Math.min((deltaMilliseconds - paused) / 1000, 0.05);
    if (deltaTime <= 0) return;
    for (const callback of this.updateCallbacks) callback(deltaTime);
  }

  render() {
    if (!this.gameStore.isRunning()) return;
    for (const callback of this.renderCallbacks) callback();
  }

  onUpdate(callback: (deltaTime: number) => void) { this.updateCallbacks.add(callback); }
  offUpdate(callback: (deltaTime: number) => void) { this.updateCallbacks.delete(callback); }
  onRender(callback: () => void) { this.renderCallbacks.add(callback); }
  offRender(callback: () => void) { this.renderCallbacks.delete(callback); }

  freeze(milliseconds: number) {
    this.freezeMilliseconds = Math.max(this.freezeMilliseconds, milliseconds);
  }
}
