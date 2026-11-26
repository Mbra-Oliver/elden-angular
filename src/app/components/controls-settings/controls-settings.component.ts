import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  SettingsService, TOUCH_ACTIONS, TOUCH_ACTION_IDS, type TouchAction,
} from '../../lib/platform/settings.service';

@Component({
  selector: 'app-controls-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = settings.settings();
    <fieldset class="controls-settings">
      <legend>Boutons tactiles</legend>
      <label>Taille boutons <span>{{ (s.touchScale * 100).toFixed(0) }} %</span>
        <input type="range" min="80" max="160" step="5" [value]="s.touchScale * 100"
          (input)="setScale('touchScale', $event)">
      </label>
      <label>Taille HUD <span>{{ (s.hudScale * 100).toFixed(0) }} %</span>
        <input type="range" min="80" max="140" step="5" [value]="s.hudScale * 100"
          (input)="setScale('hudScale', $event)">
      </label>
      <p class="hint">Choisis l’action de chaque emplacement ; les actions sont échangées, rien n’est perdu.</p>
      @for (slot of touchSlots(); track $index) {
        <label class="binding"><span>Bouton {{ $index + 1 }}</span>
          <select [value]="slot" [attr.aria-label]="'Bouton ' + ($index + 1)"
            (input)="setSlot($index, $event)" (change)="setSlot($index, $event)">
            @for (action of touchActions; track action) {
              <option [value]="action" [selected]="slot === action">{{ touchLabels[action] }}</option>
            }
          </select>
        </label>
      }
      <button type="button" class="reset" (click)="settings.resetTouchSlots()">Réinitialiser les touches</button>
    </fieldset>
  `,
  styles: `
    :host { display: block; }
    .controls-settings { display: grid; gap: 6px; border: 1px solid #e5c17b33; margin: 10px 0; padding: 8px 10px; }
    legend { color: #e5c17b; font-size: 13px; letter-spacing: .04em; }
    label { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px; margin: 0; font-size: 12px; color: #d9ccb2; }
    label span { color: #e5c17b; font-variant-numeric: tabular-nums; }
    input { grid-column: 1 / -1; min-height: 32px; accent-color: #c9a25d; }
    .hint { margin: 0; color: #cdbd9f; font-size: 11px; }
    .binding { grid-template-columns: 76px 1fr; min-height: 34px; }
    select { min-height: 34px; max-width: 100%; border: 1px solid #e5c17b44; background: #130e0b; color: #efe6d4; font: inherit; font-size: 12px; cursor: pointer; }
    .reset { min-height: 34px; margin-top: 2px; border: 1px solid #e5c17b44; background: none; color: #efe6d4; font: inherit; font-size: 12px; cursor: pointer; }
    .reset:hover, .reset:focus-visible { border-color: #e5c17b; color: #e5c17b; }
  `,
})
export class ControlsSettingsComponent {
  readonly settings = inject(SettingsService);
  readonly touchActions = TOUCH_ACTION_IDS;
  readonly touchLabels = Object.fromEntries(TOUCH_ACTION_IDS.map((id) => [id, TOUCH_ACTIONS[id].label])) as Record<TouchAction, string>;
  readonly touchSlots = computed(() => this.settings.settings().touchSlots);

  setScale(key: 'touchScale' | 'hudScale', event: Event) {
    this.settings.update({ [key]: Number((event.target as HTMLInputElement).value) / 100 });
  }

  setSlot(index: number, event: Event) {
    const action = (event.target as HTMLSelectElement).value as TouchAction;
    if (this.settings.settings().touchSlots[index] !== action) this.settings.setTouchSlot(index, action);
  }
}
