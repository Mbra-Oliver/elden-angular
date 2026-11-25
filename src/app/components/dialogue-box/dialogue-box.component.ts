import {
  ChangeDetectionStrategy, Component, DestroyRef, effect, HostListener, inject, input, NgZone, output, signal,
} from '@angular/core';
import { AudioEngineService } from '../../lib/audio/audio-engine.service';
import type { Dialogue, DialogueChoice } from '../../lib/services/dialogue-tree';
import { TypewriterVoice } from './typewriter-voice';

/** Lettres affichées par seconde, et un bip toutes les N lettres. */
const CHARS_PER_SECOND = 52;
const BLIP_EVERY = 2;

/**
 * Boîte de dialogue HTML : le texte s'écrit lettre à lettre avec un bip
 * Web Audio. Espace, Entrée ou un clic terminent la phrase d'un coup ;
 * les choix apparaissent une fois le texte entièrement écrit.
 */
@Component({
  selector: 'app-dialogue-box',
  templateUrl: './dialogue-box.component.html',
  styleUrl: './dialogue-box.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogueBoxComponent {
  readonly line = input.required<Dialogue>();
  readonly choose = output<DialogueChoice>();

  readonly shown = signal(0);
  readonly done = signal(false);
  private readonly voice = new TypewriterVoice(inject(AudioEngineService));
  private readonly zone = inject(NgZone);
  private frame = 0;

  constructor() {
    effect(() => this.start(this.line()));
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
  }

  private start(line: Dialogue) {
    cancelAnimationFrame(this.frame);
    this.voice.setSpeaker(line.speaker);
    const text = line.text;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.finish(text);
      return;
    }
    this.shown.set(0);
    this.done.set(false);
    const begin = performance.now();
    let written = 0;
    const tick = (now: number) => {
      if (this.done()) return;
      const count = Math.min(text.length, Math.floor(((now - begin) / 1000) * CHARS_PER_SECOND));
      for (let i = written; i < count; i++) {
        const char = text[i];
        if (i % BLIP_EVERY === 0 && /\p{L}/u.test(char)) this.voice.blip(char);
      }
      if (count !== written) {
        written = count;
        this.shown.set(count);
      }
      if (count >= text.length) this.finish(text);
      else this.frame = requestAnimationFrame(tick);
    };
    this.zone.runOutsideAngular(() => { this.frame = requestAnimationFrame(tick); });
  }

  private finish(text: string) {
    cancelAnimationFrame(this.frame);
    this.shown.set(text.length);
    this.done.set(true);
  }

  /** Termine la phrase en cours (clic, Espace, Entrée). */
  complete() {
    if (!this.done()) this.finish(this.line().text);
  }

  @HostListener('window:keydown', ['$event'])
  onKey(event: KeyboardEvent) {
    if ((event.code === 'Space' || event.code === 'Enter') && !this.done()) {
      event.preventDefault();
      this.complete();
    }
  }
}
