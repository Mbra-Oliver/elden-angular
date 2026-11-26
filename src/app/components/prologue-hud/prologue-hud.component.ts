import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { PrologueService, RAVINE_LINE } from '../../lib/prologue/prologue.service';
import { TrophyService } from '../../lib/trophies/trophy.service';
import { NarrativeDirectorService } from '../../lib/narrative/narrative-director.service';
import { KeyHintComponent, SkipHintComponent } from '../key-hint/key-hint.component';
import { InputDeviceService } from '../../lib/services/input-device.service';

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
  /** Avertissement de Kwadwo à l'entrée de la ravine (tireur posté). */
  readonly ravineLine = RAVINE_LINE;
  readonly prologue = inject(PrologueService);
  readonly trophies = inject(TrophyService);
  private readonly story = inject(NarrativeDirectorService);
  readonly cinematic = computed(() => !!this.story.active());
  /** Vrai une fois que le texte d'ouverture a été montré (pour le fondu). */
  private readonly seenLines = signal(false);
  readonly opened = computed(() => {
    if (this.prologue.line() !== null) {
      queueMicrotask(() => this.seenLines.set(true));
      return false;
    }
    return this.seenLines();
  });

  /** Mobile : la fiche d'examen se lit une phrase à la fois, au toucher. */
  readonly touch = computed(() => this.devices.device() === 'touch');
  private readonly devices = inject(InputDeviceService);
  private readonly pageOf = signal<{ id: string; page: number } | null>(null);
  readonly sentences = computed(() => splitSentences(this.prologue.reading()?.text ?? ''));
  readonly page = computed(() => {
    const id = this.prologue.reading()?.id;
    const state = this.pageOf();
    return state && state.id === id ? state.page : 0;
  });

  /** Tap sur la fiche : phrase suivante, puis fermeture après la dernière. */
  nextPage() {
    const item = this.prologue.reading();
    if (!item) return;
    const next = this.page() + 1;
    if (next >= this.sentences().length) {
      this.prologue.closeReading();
      return;
    }
    this.pageOf.set({ id: item.id, page: next });
    this.prologue.holdReading();
  }

  constructor() {
    // Au doigt, on lit à son rythme : la fiche ne se ferme pas d'elle-même pendant 30 s.
    effect(() => {
      if (this.prologue.reading() && this.touch()) untracked(() => this.prologue.holdReading(30000));
    });
  }

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

/** Découpe un texte en phrases (guillemets et points de suspension compris). */
function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+(?:[.!?…]+[»"]?\s*|$)/g) ?? [text];
  // Les fragments très courts (« Ofori… ») restent collés à la phrase suivante.
  const sentences: string[] = [];
  let carry = '';
  for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
    const joined = carry ? `${carry} ${part}` : part;
    if (joined.length < 28) carry = joined;
    else { sentences.push(joined); carry = ''; }
  }
  if (carry) sentences.length ? (sentences[sentences.length - 1] += ` ${carry}`) : sentences.push(carry);
  return sentences;
}
