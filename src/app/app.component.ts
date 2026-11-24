import { Component, inject } from '@angular/core';
import { DeathMenuComponent } from './components/death-menu/death-menu.component';
import { GameCanvaComponent } from './components/game-canva/game-canva.component';
import { MainMenuComponent } from './components/main-menu/main-menu.component';
import { GameStateService } from './lib/services/game-state.service';

@Component({
  selector: 'app-root',
  imports: [DeathMenuComponent, MainMenuComponent, GameCanvaComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  title = 'Les Sentiers de Terre Rouge';
  gameState = inject(GameStateService);
}
