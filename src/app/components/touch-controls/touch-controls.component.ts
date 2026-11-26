import { Component, OnDestroy, computed, inject, input, output, signal } from '@angular/core';
import { InputService } from '../../lib/services/input.service';
import { GameStateService } from '../../lib/services/game-state.service';
import { SliceService } from '../../lib/slice/slice.service';
import { AsyncWorldService } from '../../lib/social/async-world.service';
import { PrologueService } from '../../lib/prologue/prologue.service';

type Pad = 'dodge' | 'attack' | 'heavy' | 'drink' | 'switch';

/** Chaque bouton tactile appuie sur la touche clavier équivalente. */
const PAD_KEYS: Record<Pad, string> = {
  dodge: 'ShiftLeft', attack: 'Space', heavy: 'KeyE', drink: 'KeyB', switch: 'KeyR',
};

/** Un appui très bref est tenu au moins ce temps, pour qu'une image de jeu le voie. */
const MIN_HOLD_MS = 70;
/** Rayon du joystick (px) et zone morte (fraction du rayon). */
const STICK_RADIUS = 46;
const DEADZONE = 0.18;
/** Au sortir de la zone morte on marche déjà un peu ; la courbe monte en douceur jusqu'à la course. */
const STICK_MIN = 0.28;
const STICK_CURVE = 1.6;

/** Une seule invite à la fois, tapotée pour agir. */
interface TouchPrompt { label: string; act: () => void }

/**
 * Contrôles tactiles : joystick flottant à gauche (il apparaît sous le pouce),
 * quatre boutons d'action en arc à droite (esquive en bas, frappe légère au
 * centre, frappe lourde au-dessus, mixture sur le côté) et l'icône de pause.
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
  /** Combat en cours : boutons secondaires (lourde, mixture, verrou) affichés. */
  readonly combat = input(false);
  private readonly game = inject(GameStateService);
  private readonly slice = inject(SliceService);
  private readonly world = inject(AsyncWorldService);
  private readonly prologue = inject(PrologueService);
  /**
   * L'unique invite à l'écran, par priorité : parler / examiner, objet ou
   * foyer, tache de sang, signe au sol ; le kaolin seulement en combat.
   */
  readonly prompt = computed<TouchPrompt | null>(() => {
    if (this.game.dialogue()) return null;
    const pressF = () => this.pressF();
    if (this.game.canTalk()) return { label: this.game.interactLabel(), act: pressF };
    const item = this.slice.prompt();
    if (item) return { label: item.label, act: pressF };
    if (this.world.nearMessage()) return { label: 'Apprécier le signe', act: pressF };
    const kaolin = this.prologue.kaolin();
    if (this.combat() && kaolin.owned && kaolin.left <= 0) {
      return { label: 'Enduire la lame de kaolin', act: () => this.prologue.applyKaolin() };
    }
    return null;
  });

  /** Boutons de l'arc ; le changement d'arme se fait hors combat (pause tactique). */
  readonly pads: readonly { id: Pad; label: string; glyph: string; combatOnly: boolean }[] = [
    { id: 'dodge', label: 'Esquive (maintenir : sprint)', glyph: '↺', combatOnly: false },
    { id: 'attack', label: 'Frappe légère', glyph: '⟋', combatOnly: false },
    { id: 'heavy', label: 'Frappe lourde', glyph: '⟱', combatOnly: true },
    { id: 'drink', label: 'Avaler la mixture', glyph: '🍃', combatOnly: true },
    { id: 'switch', label: 'Changer d’arme', glyph: '⇄', combatOnly: false },
  ];

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

  /**
   * Joystick analogique : zone morte, puis réponse progressive (pouce à
   * mi-course = marche, à fond = course). Les flèches virtuelles restent
   * posées pour les systèmes qui lisent une direction (esquive, menus).
   */
  private applyStick(x: number, y: number) {
    const length = Math.hypot(x, y);
    const on = length > DEADZONE;
    const nx = on ? x / length : 0;
    const ny = on ? y / length : 0;
    const t = on ? Math.min(1, (length - DEADZONE) / (1 - DEADZONE)) : 0;
    const magnitude = on ? STICK_MIN + (1 - STICK_MIN) * t ** STICK_CURVE : 0;
    this.input.setAnalog(nx * magnitude, ny * magnitude);
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

  /** Tap sur l'invite : son action (touche F simulée, ou kaolin). */
  interact(event: PointerEvent) {
    event.preventDefault();
    this.prompt()?.act();
    navigator.vibrate?.(8);
  }

  /** Même chemin que la touche F (dialogues, objets, foyers, messages). */
  private pressF() {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f', bubbles: true }));
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
