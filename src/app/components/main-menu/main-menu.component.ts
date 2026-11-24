import { Component, inject, signal } from '@angular/core';
import { GameStateService } from '../../lib/services/game-state.service';

@Component({
  selector: 'app-main-menu',
  templateUrl: './main-menu.component.html',
  styleUrl: './main-menu.component.css',
})
export class MainMenuComponent {
  private readonly gameState = inject(GameStateService);
  readonly controlsOpen = signal(false);

  start() {
    this.gameState.startGame();
  }
}
