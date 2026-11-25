import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { PrologueService } from '../../lib/prologue/prologue.service';
import { KeyHintComponent, SkipHintComponent } from '../key-hint/key-hint.component';

/**
 * Interface du prologue (1701) : texte d'ouverture et de fin en plein écran,
 * carte de lecture des restes examinés (F).
 */
@Component({
  selector: 'app-prologue-hud',
  imports: [KeyHintComponent, SkipHintComponent],
  templateUrl: './prologue-hud.component.html',
  styleUrl: './prologue-hud.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrologueHudComponent {
  readonly prologue = inject(PrologueService);
  /** Vrai une fois que le texte d'ouverture a été montré (pour le fondu). */
  private readonly seenLines = signal(false);
  readonly opened = computed(() => {
    if (this.prologue.line() !== null) {
      queueMicrotask(() => this.seenLines.set(true));
      return false;
    }
    return this.seenLines();
  });

  ceil(value: number) {
    return Math.ceil(value);
  }

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
