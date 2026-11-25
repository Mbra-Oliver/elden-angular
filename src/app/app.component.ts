import { Component, inject } from '@angular/core';
import { DeathMenuComponent } from './components/death-menu/death-menu.component';
import { GameCanvaComponent } from './components/game-canva/game-canva.component';
import { MainMenuComponent } from './components/main-menu/main-menu.component';
import { GameStateService } from './lib/services/game-state.service';
import { CodexService } from './lib/platform/codex.service';
import { SettingsService } from './lib/platform/settings.service';

@Component({
  selector: 'app-root',
  imports: [DeathMenuComponent, MainMenuComponent, GameCanvaComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  title = 'Les Sentiers de Terre Rouge';
  gameState = inject(GameStateService);
  /** Démarrés dès l'ouverture : le codex relève les découvertes, les réglages s'appliquent au son. */
  private readonly codex = inject(CodexService);
  private readonly settings = inject(SettingsService);

  constructor() {
    // Double tap et pincement : ni zoom ni décalage de la page (iOS ignore user-scalable=no).
    const block = (event: Event) => event.preventDefault();
    document.addEventListener('dblclick', block, { passive: false });
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, block, { passive: false });
    document.addEventListener('touchmove', (event) => {
      if ((event as TouchEvent).touches.length > 1) event.preventDefault();
    }, { passive: false });
  }
}
