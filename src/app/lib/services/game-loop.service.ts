import { inject, Injectable } from '@angular/core';
import { GameStore } from '../store/game.store';

@Injectable({ providedIn: 'root' })
export class GameLoopService {
  private readonly gameStore = inject(GameStore);
  private freezeMilliseconds = 0;
  /** Ralenti sélectif : échelle de temps et durée restante (ms réelles). */
  private slowScale = 1;
  private slowMilliseconds = 0;
  private readonly updateCallbacks = new Set<(deltaTime: number) => void>();
  private readonly renderCallbacks = new Set<() => void>();

  start() {
    if (!this.gameStore.isRunning()) this.gameStore.start();
  }

  stop() {
    this.gameStore.stop();
    this.freezeMilliseconds = 0;
    this.slowScale = 1;
    this.slowMilliseconds = 0;
  }

  /** Appelé par la scène Phaser. Les entités utilisent des secondes. */
  update(deltaMilliseconds: number) {
    if (!this.gameStore.isRunning()) return;
    this.gameStore.updateFrame(performance.now());
    const paused = Math.min(this.freezeMilliseconds, deltaMilliseconds);
    this.freezeMilliseconds -= paused;
    // Le ralenti se décompte en temps réel : 0,2 s reste 0,2 s à l'écran.
    const slowed = Math.min(this.slowMilliseconds, deltaMilliseconds - paused);
    this.slowMilliseconds -= slowed;
    if (this.slowMilliseconds <= 0) this.slowScale = 1;
    const scaled = deltaMilliseconds - paused - slowed * (1 - this.slowScale);
    const deltaTime = Math.min(scaled / 1000, 0.05);
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

  /** Vrai pendant un gel d'impact (hitstop) : la logique est suspendue. */
  get frozen() {
    return this.freezeMilliseconds > 0;
  }

  /** Échelle de temps courante (1 hors ralenti), lue par la vue 3D. */
  get timeScale() {
    return this.slowMilliseconds > 0 ? this.slowScale : 1;
  }

  /**
   * Ralenti bref sur une action critique (esquive parfaite, coup dans le dos,
   * coup de grâce). Le plus fort des ralentis en cours l'emporte.
   */
  slowMotion(scale: number, milliseconds: number) {
    if (this.slowMilliseconds > 0 && this.slowScale <= scale) {
      this.slowMilliseconds = Math.max(this.slowMilliseconds, milliseconds);
      return;
    }
    this.slowScale = scale;
    this.slowMilliseconds = milliseconds;
  }

  freeze(milliseconds: number) {
    this.freezeMilliseconds = Math.max(this.freezeMilliseconds, milliseconds);
  }
}
