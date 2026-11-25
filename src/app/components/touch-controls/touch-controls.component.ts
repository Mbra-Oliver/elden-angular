import { Component, OnDestroy, computed, inject, output, signal } from '@angular/core';
import { InputService } from '../../lib/services/input.service';
import { GameStateService } from '../../lib/services/game-state.service';
import { SliceService } from '../../lib/slice/slice.service';
import { AsyncWorldService } from '../../lib/social/async-world.service';

type Pad = 'dodge' | 'attack' | 'heavy' | 'drink' | 'switch';

/** Chaque bouton tactile appuie sur la touche clavier équivalente. */
const PAD_KEYS: Record<Pad, string> = {
  dodge: 'ShiftLeft', attack: 'Space', heavy: 'KeyE', drink: 'KeyB', switch: 'KeyR',
};

/** Un appui très bref est tenu au moins ce temps, pour qu'une image de jeu le voie. */
const MIN_HOLD_MS = 70;
/** Rayon du joystick (px) et zone morte (fraction du rayon). */
const STICK_RADIUS = 52;
const DEADZONE = 0.28;

/**
 * Contrôles tactiles : joystick flottant à gauche (il apparaît sous le pouce),
 * quatre boutons d'action en arc à droite (esquive en bas, frappe légère au
 * centre, frappe lourde au-dessus, Bandji sur le côté) et l'icône de pause.
 * Tout passe par InputService sous forme de touches virtuelles.
 */
@Component({
  selector: 'app-touch-controls',
  templateUrl: './touch-controls.component.html',
  styleUrl: './touch-controls.component.css',
})
export class TouchControlsComponent implements OnDestroy {
  private readonly input = inject(InputService);
  readonly pause = output<void>();
  private readonly game = inject(GameStateService);
  private readonly slice = inject(SliceService);
  private readonly world = inject(AsyncWorldService);
  /** Bouton d'interaction, seulement quand une invite est à portée (objet, foyer, reste, tache). */
  readonly canInteract = computed(() =>
    !this.game.dialogue() && (this.game.canTalk() || !!this.slice.prompt() || !!this.world.nearStain() || !!this.world.nearMessage()));

  readonly stick = signal<{ x: number; y: number; dx: number; dy: number } | null>(null);
  readonly held = signal<ReadonlySet<Pad>>(new Set());
  private stickPointer: number | null = null;
  private readonly pressedAt = new Map<Pad, number>();
  private readonly releaseTimers = new Map<Pad, number>();

  ngOnDestroy() {
    this.releaseTimers.forEach((timer) => clearTimeout(timer));
    this.input.clearVirtual();
  }

  // --------------------------------------------------------------- JOYSTICK

  stickDown(event: PointerEvent) {
    if (this.stickPointer !== null) return;
    event.preventDefault();
    this.stickPointer = event.pointerId;
    capture(event);
    this.stick.set({ x: event.clientX, y: event.clientY, dx: 0, dy: 0 });
  }

  stickMove(event: PointerEvent) {
    const stick = this.stick();
    if (event.pointerId !== this.stickPointer || !stick) return;
    let dx = event.clientX - stick.x;
    let dy = event.clientY - stick.y;
    const length = Math.hypot(dx, dy);
    if (length > STICK_RADIUS) {
      // Le socle suit le pouce s'il dépasse : pas besoin de revenir au centre.
      const over = length - STICK_RADIUS;
      stick.x += (dx / length) * over;
      stick.y += (dy / length) * over;
      dx = (dx / length) * STICK_RADIUS;
      dy = (dy / length) * STICK_RADIUS;
    }
    this.stick.set({ ...stick, dx, dy });
    this.applyStick(dx / STICK_RADIUS, dy / STICK_RADIUS);
  }

  stickUp(event: PointerEvent) {
    if (event.pointerId !== this.stickPointer) return;
    this.stickPointer = null;
    this.stick.set(null);
    this.applyStick(0, 0);
  }

  /** Huit directions : chaque axe s'allume au-delà de la zone morte et de 22,5°. */
  private applyStick(x: number, y: number) {
    const length = Math.hypot(x, y);
    const on = length > DEADZONE;
    const nx = on ? x / length : 0;
    const ny = on ? y / length : 0;
    const threshold = Math.sin(Math.PI / 8);
    this.input.setVirtual('ArrowRight', nx > threshold);
    this.input.setVirtual('ArrowLeft', nx < -threshold);
    this.input.setVirtual('ArrowDown', ny > threshold);
    this.input.setVirtual('ArrowUp', ny < -threshold);
  }

  // ---------------------------------------------------------------- BOUTONS

  padDown(pad: Pad, event: PointerEvent) {
    event.preventDefault();
    capture(event);
    clearTimeout(this.releaseTimers.get(pad));
    this.pressedAt.set(pad, performance.now());
    this.input.setVirtual(PAD_KEYS[pad], true);
    this.held.update((set) => new Set(set).add(pad));
    navigator.vibrate?.(8);
  }

  /**
   * Verrouillage de cible (ou recentrage s'il n'y a personne). Pour changer de
   * cible verrouillée : glisser franchement le doigt sur l'image (World3D).
   */
  lock(event: PointerEvent) {
    event.preventDefault();
    this.game.toggleLock();
    navigator.vibrate?.(8);
  }

  /** Interaction : même chemin que la touche F (dialogues, objets, foyers, messages). */
  interact(event: PointerEvent) {
    event.preventDefault();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f', bubbles: true }));
    navigator.vibrate?.(8);
  }

  padUp(pad: Pad) {
    if (!this.pressedAt.has(pad)) return;
    const elapsed = performance.now() - (this.pressedAt.get(pad) ?? 0);
    this.pressedAt.delete(pad);
    this.held.update((set) => { const next = new Set(set); next.delete(pad); return next; });
    const release = () => this.input.setVirtual(PAD_KEYS[pad], false);
    if (elapsed >= MIN_HOLD_MS) release();
    else this.releaseTimers.set(pad, window.setTimeout(release, MIN_HOLD_MS - elapsed));
  }
}

/** Garde le doigt sur sa commande même s'il glisse ; sans effet si le pointeur n'est plus actif. */
function capture(event: PointerEvent) {
  try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* pointeur déjà relâché */ }
}
