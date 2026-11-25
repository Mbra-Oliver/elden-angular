import { Injectable, NgZone, inject, signal } from '@angular/core';

export type InputDevice = 'keyboard' | 'gamepad';

/** Actions du jeu qui ont une icône de touche. */
export type InputAction =
  | 'move' | 'attack' | 'heavy' | 'dodge' | 'sprint' | 'interact'
  | 'switch' | 'drink' | 'message' | 'choice1' | 'choice2' | 'confirm' | 'back';

/** Boutons manette (disposition standard W3C, noms façon Xbox). */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
} as const;

export const ACTION_GLYPHS: Record<InputAction, Record<InputDevice, string>> = {
  move: { keyboard: 'ZQSD', gamepad: 'L' },
  attack: { keyboard: 'Espace', gamepad: 'RB' },
  heavy: { keyboard: 'E', gamepad: 'RT' },
  dodge: { keyboard: 'Maj', gamepad: 'B' },
  sprint: { keyboard: 'Maj ⟳', gamepad: 'B ⟳' },
  interact: { keyboard: 'F', gamepad: 'A' },
  switch: { keyboard: 'R', gamepad: 'Y' },
  drink: { keyboard: 'B', gamepad: 'X' },
  message: { keyboard: 'N', gamepad: '▤' },
  choice1: { keyboard: '1', gamepad: 'A' },
  choice2: { keyboard: '2', gamepad: 'X' },
  confirm: { keyboard: 'Entrée', gamepad: 'A' },
  back: { keyboard: 'Échap', gamepad: 'B' },
};

const STICK_DEADZONE = 0.35;

/**
 * Détecte en direct le dernier périphérique utilisé (clavier/souris ou
 * manette) et lit l'état de la manette une fois par image d'animation.
 * Les icônes de touches s'abonnent au signal `device`.
 */
@Injectable({ providedIn: 'root' })
export class InputDeviceService {
  private readonly zone = inject(NgZone);
  private readonly _device = signal<InputDevice>('keyboard');
  readonly device = this._device.asReadonly();

  private pad: Gamepad | null = null;
  private previous: boolean[] = [];
  private readonly pressedListeners = new Set<(button: number) => void>();

  constructor() {
    if (typeof window === 'undefined') return;
    const toKeyboard = () => { if (this._device() !== 'keyboard') this.zone.run(() => this._device.set('keyboard')); };
    window.addEventListener('keydown', toKeyboard);
    window.addEventListener('pointerdown', (event) => { if (event.pointerType === 'mouse') toKeyboard(); });
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
    if (active && this._device() !== 'gamepad') this.zone.run(() => this._device.set('gamepad'));
  }
}
