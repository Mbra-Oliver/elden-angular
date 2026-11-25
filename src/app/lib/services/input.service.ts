import { Injectable, inject } from '@angular/core';
import { InputDeviceService, PAD } from './input-device.service';

@Injectable({
  providedIn: 'root',
})
export class InputService {
  private keys = new Map<string, boolean>();
  /** Touches virtuelles : boutons tactiles, joystick, clics de souris (même codes que le clavier). */
  private readonly virtualKeys = new Set<string>();
  /** Manette (lue en plus du clavier : les deux marchent en même temps). */
  private readonly pad = inject(InputDeviceService);

  constructor() {
    window.addEventListener('keydown', (e) => {
      // CRUCIAL : On stocke le 'code' (ex: 'KeyE', 'Space', 'ShiftLeft')
      this.keys.set(e.code, true);
    });

    window.addEventListener('blur', () => { this.keys.clear(); this.virtualKeys.clear(); });

    window.addEventListener('keyup', (e) => {
      this.keys.set(e.code, false);
    });
  }

  private isPressed(code: string): boolean {
    return this.keys.get(code) === true || this.virtualKeys.has(code);
  }

  /** Appui virtuel (contrôles tactiles, souris) sous le code d'une touche du clavier. */
  setVirtual(code: string, pressed: boolean) {
    if (pressed) this.virtualKeys.add(code);
    else this.virtualKeys.delete(code);
  }

  clearVirtual() {
    this.virtualKeys.clear();
  }

  //===============
  // MAPPING DES TOUCHES (Utilisant uniquement les codes physiques)
  //===============

  up(): boolean {
    // 'KeyW' est physiquement en haut à gauche (Z sur AZERTY, W sur QWERTY)
    return this.isPressed('ArrowUp') || this.isPressed('KeyW') || this.pad.axis(1, -1);
  }

  down(): boolean {
    return this.isPressed('ArrowDown') || this.isPressed('KeyS') || this.pad.axis(1, 1);
  }

  left(): boolean {
    // 'KeyA' est à gauche (Q sur AZERTY, A sur QWERTY)
    return this.isPressed('ArrowLeft') || this.isPressed('KeyA') || this.pad.axis(0, -1);
  }

  right(): boolean {
    return this.isPressed('ArrowRight') || this.isPressed('KeyD') || this.pad.axis(0, 1);
  }

  attack(): boolean {
    // Le code pour la barre espace est 'Space'
    return this.isPressed('Space') || this.pad.button(PAD.RB);
  }

  heavyAttack(): boolean {
    // Maintenant, cela fonctionnera car e.code renvoie bien 'KeyE'
    return this.isPressed('KeyE') || this.pad.button(PAD.RT);
  }

  dodge(): boolean {
    // e.code fait la distinction entre les deux Shift, donc on vérifie les deux
    return this.isPressed('ShiftLeft') || this.isPressed('ShiftRight') || this.pad.button(PAD.B);
  }

  switchWeapon(): boolean {
    // R : même position en AZERTY et QWERTY
    return this.isPressed('KeyR') || this.pad.button(PAD.Y);
  }

  drink(): boolean {
    // B comme Bandji
    return this.isPressed('KeyB') || this.pad.button(PAD.X);
  }
}
