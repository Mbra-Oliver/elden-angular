import { Injectable, NgZone, inject, signal } from '@angular/core';

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

/** Actions du jeu qui ont une icône de touche. */
export type InputAction =
  | 'move' | 'attack' | 'heavy' | 'dodge' | 'sprint' | 'interact'
  | 'switch' | 'drink' | 'message' | 'choice1' | 'choice2' | 'confirm' | 'back'
  // Chapitre 1 : poudre de kaolin sur la lame, verrouillage de cible.
  | 'kaolin' | 'lock';

/** Boutons manette (disposition standard W3C, noms façon Xbox). */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
} as const;

/**
 * Tactile : l'icône du bouton à l'écran (touch-controls) ; vide quand on
 * touche directement l'invite ou le choix (rien à afficher).
 */
export const ACTION_GLYPHS: Record<InputAction, Record<InputDevice, string>> = {
  move: { keyboard: 'ZQSD', gamepad: 'L', touch: '◎' },
  attack: { keyboard: 'Espace', gamepad: 'RB', touch: '⟋' },
  heavy: { keyboard: 'E', gamepad: 'RT', touch: '⟱' },
  dodge: { keyboard: 'Maj', gamepad: 'B', touch: '↺' },
  sprint: { keyboard: 'Maj ⟳', gamepad: 'B ⟳', touch: '↺' },
  interact: { keyboard: 'F', gamepad: 'A', touch: '◈' },
  switch: { keyboard: 'R', gamepad: 'Y', touch: '⇄' },
  drink: { keyboard: 'B', gamepad: 'X', touch: '⚱' },
  message: { keyboard: 'N', gamepad: '▤', touch: '✎' },
  choice1: { keyboard: '1', gamepad: 'A', touch: '' },
  choice2: { keyboard: '2', gamepad: 'X', touch: '' },
  confirm: { keyboard: 'Entrée', gamepad: 'A', touch: '' },
  back: { keyboard: 'Échap', gamepad: 'B', touch: '' },
  kaolin: { keyboard: 'T', gamepad: '', touch: '◌' },
  lock: { keyboard: 'Q', gamepad: 'RS', touch: '⊙' },
};

/** Écran tactile principal au démarrage (avant tout geste). */
const startsOnTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const STICK_DEADZONE = 0.35;

/**
 * Détecte en direct le dernier périphérique utilisé (clavier/souris ou
 * manette) et lit l'état de la manette une fois par image d'animation.
 * Les icônes de touches s'abonnent au signal `device`.
 */
@Injectable({ providedIn: 'root' })
export class InputDeviceService {
  private readonly zone = inject(NgZone);
  private readonly _device = signal<InputDevice>(startsOnTouch() ? 'touch' : 'keyboard');
  readonly device = this._device.asReadonly();

  private pad: Gamepad | null = null;
  private previous: boolean[] = [];
  private readonly pressedListeners = new Set<(button: number) => void>();

  constructor() {
    if (typeof window === 'undefined') return;
    const toKeyboard = () => setDevice('keyboard');
    // Les appuis simulés par les boutons tactiles (isTrusted faux) ne changent pas d'appareil.
    window.addEventListener('keydown', (event) => { if (event.isTrusted) toKeyboard(); });
    const setDevice = (device: InputDevice) => {
      document.documentElement.classList.toggle('touch-input', device === 'touch');
      if (this._device() !== device) this.zone.run(() => this._device.set(device));
    };
    setDevice(this._device());
    window.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') setDevice('keyboard');
      else if (event.pointerType === 'touch') setDevice('touch');
    }, { capture: true });
    window.addEventListener('gamepaddisconnected', () => { this.pad = null; toKeyboard(); });
    if (typeof navigator.getGamepads !== 'function') return;
    this.zone.runOutsideAngular(() => {
      const poll = () => { this.poll(); requestAnimationFrame(poll); };
      requestAnimationFrame(poll);
    });
  }

  /** Appelé à chaque appui (front montant) sur un bouton de manette. */
  onPadPressed(listener: (button: number) => void) {
    this.pressedListeners.add(listener);
    return () => this.pressedListeners.delete(listener);
  }

  button(index: number) {
    return !!this.pad?.buttons[index]?.pressed;
  }

  /** Stick gauche ou croix directionnelle, seuillés. */
  axis(axis: 0 | 1, sign: -1 | 1) {
    const pad = this.pad;
    if (!pad) return false;
    const dpad = axis === 0 ? (sign < 0 ? PAD.LEFT : PAD.RIGHT) : (sign < 0 ? PAD.UP : PAD.DOWN);
    return (pad.axes[axis] ?? 0) * sign > STICK_DEADZONE || !!pad.buttons[dpad]?.pressed;
  }

  private poll() {
    const pads = navigator.getGamepads();
    let pad: Gamepad | null = null;
    for (const candidate of pads) if (candidate?.connected) { pad = candidate; break; }
    this.pad = pad;
    if (!pad) return;
    let active = pad.axes.some((value, i) => i < 4 && Math.abs(value) > 0.5);
    pad.buttons.forEach((button, index) => {
      const pressed = button.pressed;
      if (pressed) active = true;
      if (pressed && !this.previous[index]) {
        this.zone.run(() => this.pressedListeners.forEach((listener) => listener(index)));
      }
      this.previous[index] = pressed;
    });
    if (active && this._device() !== 'gamepad') {
      document.documentElement.classList.remove('touch-input');
      this.zone.run(() => this._device.set('gamepad'));
    }
  }
}
