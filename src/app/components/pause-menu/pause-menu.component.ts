import { AfterViewInit, Component, ElementRef, computed, inject, output } from '@angular/core';
import {
  DEFAULT_TOUCH_SLOTS, GraphicsQuality, SettingsService, TOUCH_ACTIONS, TOUCH_ACTION_IDS, type TouchAction,
} from '../../lib/platform/settings.service';

/** Pause en jeu (Échap, Start ou icône tactile) : reprendre, réglages, quitter. */
@Component({
  selector: 'app-pause-menu',
  template: `
    @let s = settings.settings();
    <section class="pause" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <h2 id="pause-title">Pause</h2>
      <button type="button" class="link" (click)="resume.emit()">Reprendre</button>
      <div class="settings">
        <div class="segmented" role="group" aria-label="Qualité graphique">
          @for (q of qualities; track q.id) {
            <button type="button" [class.on]="s.quality === q.id" [attr.aria-pressed]="s.quality === q.id"
              (click)="setQuality(q.id)">{{ q.label }}</button>
          }
        </div>
        <label>Musique<input type="range" min="0" max="100" [value]="s.music * 100" (input)="set('music', $event)"></label>
        <label>Bruitages<input type="range" min="0" max="100" [value]="s.sfx * 100" (input)="set('sfx', $event)"></label>
        <label>Caméra<input type="range" min="40" max="200" step="5" [value]="s.sensitivity * 100" (input)="set('sensitivity', $event)"></label>
        <label>Taille boutons<input type="range" min="80" max="160" step="5" [value]="s.touchScale * 100" (input)="setScale('touchScale', $event)"></label>
        <label>Taille HUD<input type="range" min="80" max="140" step="5" [value]="s.hudScale * 100" (input)="setScale('hudScale', $event)"></label>
        <div class="touch-map">
          <span class="map-title">Touches tactiles</span>
          @for (slot of touchSlots(); track $index) {
            <label><span>Bouton {{ $index + 1 }}</span>
              <select [value]="slot" (change)="setTouchSlot($index, $event)">
                @for (action of touchActions; track action) {
                  <option [value]="action">{{ touchLabels[action] }}</option>
                }
              </select>
            </label>
          }
          <button type="button" class="reset" (click)="resetTouchSlots()">Réinitialiser les touches</button>
        </div>
        <label class="toggle"><input type="checkbox" [checked]="s.autoLock" (change)="settings.update({ autoLock: $any($event.target).checked })"> Verrouillage au premier coup reçu</label>
        <p class="hint">Garde : maintenir G / bouton bouclier</p>
      </div>
      <button type="button" class="link quit" (click)="quit.emit()">Retour au menu principal</button>
    </section>
  `,
  styles: `
    :host { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; background: #050302c7;
      padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
      animation: fade .2s ease both; }
    @keyframes fade { from { opacity: 0; } }
    .pause { display: grid; justify-items: center; gap: 6px; width: min(360px, 90vw); color: #efe6d4; font-family: system-ui, sans-serif; }
    h2 { margin: 0 0 6px; color: #e5c17b; font: 500 34px/1 "Cormorant Garamond", Garamond, "Times New Roman", serif; letter-spacing: .08em; }
    .link { min-height: 48px; border: 0; background: none; color: #efe6d4; font: 500 21px "Cormorant Garamond", Garamond, "Times New Roman", serif; letter-spacing: .05em; cursor: pointer; }
    .link:hover, .link:focus-visible { outline: none; color: #e5c17b; }
    .quit { font-size: 17px; opacity: .8; }
    .settings { display: grid; gap: 8px; width: 100%; padding: 10px 0; border-block: 1px solid #e5c17b33; }
    .segmented { display: flex; gap: 6px; }
    .segmented button { flex: 1; min-height: 44px; border: 1px solid #e5c17b44; background: none; color: #efe6d4; font: inherit; font-size: 13px; cursor: pointer; }
    .segmented button.on { border-color: #e5c17b; color: #e5c17b; background: #e5c17b18; }
    label { display: grid; grid-template-columns: 90px 1fr; align-items: center; font-size: 13px; color: #d9ccb2; }
    input { min-height: 36px; accent-color: #c9a25d; }
    .touch-map { display: grid; gap: 5px; padding: 8px; border: 1px solid #e5c17b33; }
    .map-title { color: #e5c17b; font-size: 12px; letter-spacing: .08em; }
    .touch-map label { grid-template-columns: 78px 1fr; }
    select, .reset { min-height: 34px; border: 1px solid #e5c17b44; background: #130e0b; color: #efe6d4; font: inherit; font-size: 12px; cursor: pointer; }
    .reset { margin-top: 2px; background: none; }
    label.toggle { display: flex; gap: 10px; min-height: 44px; }
    label.toggle input { min-height: 0; width: 20px; height: 20px; }
    .hint { margin: 0; color: #cdbd9f; font-size: 12px; text-align: center; }
    :host { overflow: auto; }
    @media (max-height: 440px) {
      .pause { gap: 2px; padding-block: 8px; }
      h2 { font-size: 24px; margin: 0; }
      .settings { gap: 2px; padding: 4px 0; }
      .link { min-height: 40px; }
    }
  `,
})
export class PauseMenuComponent implements AfterViewInit {
  readonly settings = inject(SettingsService);
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly resume = output<void>();
  readonly quit = output<void>();
  readonly qualities: { id: GraphicsQuality; label: string }[] = [
    { id: 'low', label: 'Basse' }, { id: 'medium', label: 'Moyenne' }, { id: 'high', label: 'Haute' },
  ];
  readonly touchActions = TOUCH_ACTION_IDS;
  readonly touchLabels = Object.fromEntries(TOUCH_ACTION_IDS.map((id) => [id, TOUCH_ACTIONS[id].label])) as Record<TouchAction, string>;
  readonly touchSlots = computed(() => this.settings.settings().touchSlots);

  ngAfterViewInit() {
    (this.host.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.link')?.focus();
  }

  setQuality(quality: GraphicsQuality) {
    this.settings.update({ quality });
    // Le rendu relit la densité au redimensionnement.
    window.dispatchEvent(new Event('resize'));
  }

  set(key: 'music' | 'sfx' | 'sensitivity', event: Event) {
    this.settings.update({ [key]: Number((event.target as HTMLInputElement).value) / 100 });
  }

  setScale(key: 'touchScale' | 'hudScale', event: Event) {
    this.settings.update({ [key]: Number((event.target as HTMLInputElement).value) / 100 });
  }

  setTouchSlot(index: number, event: Event) {
    const action = (event.target as HTMLSelectElement).value as TouchAction;
    const slots = [...this.settings.settings().touchSlots];
    const previous = slots.indexOf(action);
    if (previous >= 0) slots[previous] = slots[index];
    slots[index] = action;
    this.settings.update({ touchSlots: slots });
  }

  resetTouchSlots() {
    this.settings.update({ touchSlots: [...DEFAULT_TOUCH_SLOTS] });
  }
}
