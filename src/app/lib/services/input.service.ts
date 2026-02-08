import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class InputService {
  private keys = new Map<string, boolean>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      // CRUCIAL : On stocke le 'code' (ex: 'KeyE', 'Space', 'ShiftLeft')
      this.keys.set(e.code, true);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.set(e.code, false);
    });
  }

  private isPressed(code: string): boolean {
    return this.keys.get(code) === true;
  }

  //===============
  // MAPPING DES TOUCHES (Utilisant uniquement les codes physiques)
  //===============

  up(): boolean {
    // 'KeyW' est physiquement en haut à gauche (Z sur AZERTY, W sur QWERTY)
    return this.isPressed('ArrowUp') || this.isPressed('KeyW');
  }

  down(): boolean {
    return this.isPressed('ArrowDown') || this.isPressed('KeyS');
  }

  left(): boolean {
    // 'KeyA' est à gauche (Q sur AZERTY, A sur QWERTY)
    return this.isPressed('ArrowLeft') || this.isPressed('KeyA');
  }

  right(): boolean {
    return this.isPressed('ArrowRight') || this.isPressed('KeyD');
  }

  attack(): boolean {
    // Le code pour la barre espace est 'Space'
    return this.isPressed('Space');
  }

  heavyAttack(): boolean {
    // Maintenant, cela fonctionnera car e.code renvoie bien 'KeyE'
    return this.isPressed('KeyE');
  }

  dodge(): boolean {
    // e.code fait la distinction entre les deux Shift, donc on vérifie les deux
    return this.isPressed('ShiftLeft') || this.isPressed('ShiftRight');
  }
}
