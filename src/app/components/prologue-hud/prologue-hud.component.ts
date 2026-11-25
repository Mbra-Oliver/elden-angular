import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { PrologueService } from '../../lib/prologue/prologue.service';

/**
 * Interface du prologue (1701) : texte d'ouverture et de fin en plein écran,
 * carte de lecture des restes examinés (F).
 */
@Component({
  selector: 'app-prologue-hud',
  templateUrl: './prologue-hud.component.html',
  styleUrl: './prologue-hud.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrologueHudComponent {
  readonly prologue = inject(PrologueService);

  @HostListener('window:keydown', ['$event'])
  onKey(event: KeyboardEvent) {
    if (event.repeat) return;
    if (this.prologue.line() !== null) {
      if (event.code === 'Space' || event.code === 'Enter' || event.code === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.prologue.skipLine();
      }
    } else if (this.prologue.reading() && event.code === 'Escape') {
      event.preventDefault();
      this.prologue.closeReading();
    }
  }
}
