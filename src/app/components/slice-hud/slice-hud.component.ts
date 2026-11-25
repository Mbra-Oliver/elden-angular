import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { HOOK_LINES, SPECIALS, SPIRIT, STAT_ORDER, STATS, type StatId } from '../../lib/slice/slice-content';
import { REST_POINTS } from '../../lib/slice/slice-map';
import { SliceService } from '../../lib/slice/slice.service';
import { EquipmentStore } from '../../lib/entities/player/equipment.store';
import { KeyHintComponent, SkipHintComponent } from '../key-hint/key-hint.component';

/**
 * Interface de la tranche verticale : accroche d'ouverture, menu du foyer
 * (montée de niveau), carte d'objet ramassé avec son lore, jauge d'ardeur
 * et invite d'interaction.
 */
@Component({
  selector: 'app-slice-hud',
  imports: [KeyHintComponent, SkipHintComponent],
  templateUrl: './slice-hud.component.html',
  styleUrl: './slice-hud.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SliceHudComponent {
  readonly slice = inject(SliceService);
  readonly equipment = inject(EquipmentStore);
  readonly progression = this.slice.progression;
  readonly lines = HOOK_LINES;
  readonly stats = STAT_ORDER.map((id) => ({ id, ...STATS[id] }));
  readonly spiritMax = SPIRIT.max;
  readonly spiritCost = SPIRIT.specialCost;
  readonly rests = REST_POINTS;

  specialName() {
    const weapon = this.equipment.state().weapon;
    return SPECIALS[weapon === 'bow' ? 'volee' : weapon === 'afena' ? 'tourbillon' : 'percee'].name;
  }

  level(stat: StatId) {
    this.slice.levelUp(stat);
  }

  @HostListener('window:keydown', ['$event'])
  onKey(event: KeyboardEvent) {
    if (event.repeat) return;
    if (this.slice.hookLine() !== null) {
      if (event.code === 'Space' || event.code === 'Enter' || event.code === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.slice.skipHook();
      }
      return;
    }
    if (this.slice.restMenu()) {
      const index = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(event.code);
      if (index >= 0) {
        event.preventDefault();
        this.level(STAT_ORDER[index]);
      } else if (event.code === 'Escape' || event.code === 'KeyF') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.slice.closeRestMenu();
      }
    }
  }
}
