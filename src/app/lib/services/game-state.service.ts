export type GameScreen = 'main-menu' | 'playing' | 'paused' | 'death';

import { computed, Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class GameStateService {
  private _currentScreen = signal<GameScreen>('main-menu');

  currentScreen = computed(() => this._currentScreen());

  constructor() {}

  startGame() {
    this._currentScreen.set('playing');
  }

  returnToMainMenu() {
    this._currentScreen.set('main-menu');
  }

  retry() {
    this._currentScreen.set('playing');
  }

  death() {
    this._currentScreen.set('death');
  }
}
