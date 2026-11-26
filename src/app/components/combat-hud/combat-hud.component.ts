import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { GameStateService } from '../../lib/services/game-state.service';
import { SettingsService } from '../../lib/platform/settings.service';
import { KeyHintComponent } from '../key-hint/key-hint.component';

/**
 * HUD de combat en HTML/CSS par-dessus le canvas 3D : texte net à toutes les
 * résolutions, animations en CSS, aucun coût GPU. Masqué pendant les
 * cinématiques sur spline.
 *
 * Barres à double jauge : la vie perdue disparaît tout de suite de la jauge
 * pleine, et une jauge pâle la rattrape avec une demi-seconde de retard.
 */
@Component({
  selector: 'app-combat-hud',
  imports: [KeyHintComponent],
  templateUrl: './combat-hud.component.html',
  styleUrl: './combat-hud.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CombatHudComponent {
  private readonly game = inject(GameStateService);
  private readonly settings = inject(SettingsService);
  readonly hud = this.game.hud;
  readonly playing = computed(() => this.game.currentScreen() === 'playing');
  readonly hudScale = computed(() => this.settings.settings().hudScale);

  pct(value: number, max: number) {
    return `${Math.max(0, Math.min(100, (value / (max || 1)) * 100))}%`;
  }
}
