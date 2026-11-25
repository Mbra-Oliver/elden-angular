import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ACTION_GLYPHS, InputAction, InputDeviceService } from '../../lib/services/input-device.service';

/**
 * Icône de touche contextuelle : affiche la touche clavier ou le bouton
 * manette de l'action, et bascule en direct selon le dernier périphérique
 * utilisé. Exemple : <app-key-hint action="attack" /> Frapper.
 */
@Component({
  selector: 'app-key-hint',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<kbd [class]="'key ' + devices.device()" [class.wide]="glyph().length > 2" [attr.aria-label]="glyph()">{{ glyph() }}</kbd>`,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; }
    .key {
      display: inline-grid; place-items: center; min-width: 1.7em; height: 1.7em; padding: 0 0.35em;
      font: 700 0.78em/1 system-ui, sans-serif; color: #1c140d;
      background: linear-gradient(#f4e6c4, #cdb68a); border: 1px solid #6b5636;
      border-bottom-width: 3px; border-radius: 5px; box-sizing: border-box;
      transition: border-radius 160ms ease, background 160ms ease;
    }
    .key.gamepad { border-radius: 999px; background: radial-gradient(circle at 35% 30%, #4b4c52, #17181c); color: #f2ead6; border-color: #050506; }
  `],
})
export class KeyHintComponent {
  readonly action = input.required<InputAction>();
  readonly devices = inject(InputDeviceService);
  readonly glyph = computed(() => ACTION_GLYPHS[this.action()][this.devices.device()]);
}
