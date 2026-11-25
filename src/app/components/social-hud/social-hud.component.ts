import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { KeyHintComponent } from '../key-hint/key-hint.component';
import { InputDeviceService, PAD } from '../../lib/services/input-device.service';
import { GameStateService } from '../../lib/services/game-state.service';
import { AsyncWorldService } from '../../lib/social/async-world.service';
import { MESSAGE_TEMPLATES, MESSAGE_WORDS, messageText } from '../../lib/social/async-world.backend';
import { BOSS_NAMES, ChallengeService, beats, describe, formatTime } from '../../lib/social/challenge.service';

/**
 * Surcouche « monde partagé » en jeu : lecture des messages au sol, rejeu
 * des taches de sang, écriture d'un message (N / bouton Vue), chrono et
 * carte de défi après un boss.
 */
@Component({
  selector: 'app-social-hud',
  imports: [KeyHintComponent],
  templateUrl: './social-hud.component.html',
  styleUrl: './social-hud.component.css',
})
export class SocialHudComponent {
  readonly world = inject(AsyncWorldService);
  readonly game = inject(GameStateService);
  readonly challenge = inject(ChallengeService);
  private readonly devices = inject(InputDeviceService);

  readonly templates = MESSAGE_TEMPLATES;
  readonly words = MESSAGE_WORDS;
  readonly template = signal(0);
  readonly word = signal(0);
  readonly field = signal<'template' | 'word'>('template');
  readonly preview = computed(() => messageText({ template: this.template(), word: this.word() }));
  readonly bossNames = BOSS_NAMES;
  readonly formatTime = formatTime;
  readonly describe = describe;

  /** Libre pour une invite : pas de dialogue, pas de PNJ à portée. */
  readonly free = computed(() => !this.game.dialogue() && !this.game.canTalk());
  readonly canWrite = computed(() => this.free() && !this.game.encounter() && this.world.zone() !== null);
  readonly verdict = computed(() => {
    const target = this.challenge.target();
    const latest = this.challenge.latest();
    if (!target || !latest || latest.boss !== target.boss) return null;
    return beats(latest, target) ? 'Défi relevé !' : 'Défi manqué. Réessaie.';
  });

  constructor() {
    const off = this.devices.onPadPressed((button) => this.onPad(button));
    inject(DestroyRef).onDestroy(() => {
      off();
      this.close();
    });
  }

  @HostListener('window:keydown', ['$event'])
  onKey(event: KeyboardEvent) {
    if (event.repeat) return;
    if (this.world.composing()) {
      const handled = this.navigate(event.code);
      if (handled) event.preventDefault();
      return;
    }
    if (event.code === 'KeyN' && this.canWrite()) {
      event.preventDefault();
      this.open();
    } else if (event.code === 'KeyF' && this.free()) {
      if (this.world.interact()) event.preventDefault();
    }
  }

  private onPad(button: number) {
    if (this.world.composing()) {
      const code = ({
        [PAD.UP]: 'ArrowUp', [PAD.DOWN]: 'ArrowDown', [PAD.LEFT]: 'ArrowLeft', [PAD.RIGHT]: 'ArrowRight',
        [PAD.A]: 'Enter', [PAD.B]: 'Escape', [PAD.VIEW]: 'Escape',
      } as Record<number, string>)[button];
      if (code) this.navigate(code);
      return;
    }
    if (button === PAD.VIEW && this.canWrite()) this.open();
    else if (button === PAD.A && this.free()) this.world.interact();
  }

  /** Composer : haut/bas change de champ, gauche/droite fait défiler. */
  private navigate(code: string) {
    const cycle = (value: number, length: number, step: number) => (value + step + length) % length;
    switch (code) {
      case 'ArrowUp': case 'ArrowDown': case 'KeyW': case 'KeyS': case 'Tab':
        this.field.update((f) => f === 'template' ? 'word' : 'template');
        return true;
      case 'ArrowLeft': case 'ArrowRight': case 'KeyA': case 'KeyD': {
        const step = code === 'ArrowLeft' || code === 'KeyA' ? -1 : 1;
        if (this.field() === 'template') this.template.update((v) => cycle(v, this.templates.length, step));
        else this.word.update((v) => cycle(v, this.words.length, step));
        return true;
      }
      case 'Enter': case 'Space':
        this.submit();
        return true;
      case 'Escape': case 'KeyN':
        this.close();
        return true;
      default:
        return false;
    }
  }

  open() {
    this.world.composing.set(true);
    this.game.uiLock.set(true);
  }

  close() {
    this.world.composing.set(false);
    this.game.uiLock.set(false);
  }

  submit() {
    void this.world.write(this.template(), this.word());
    this.close();
  }
}
