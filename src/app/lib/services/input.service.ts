import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class InputService {
  //Stocker l'etat de chaque touche.

  private keys = new Map<string, boolean>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.keys.set(e.key, true);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.set(e.key, false);
    });

    console.log(`INPUT SERVICE INITIALIZED`);
  }

  //Methode pour ecouter si une touche est actuellement presser

  /**
   * @Param code - Le code de la touche a verifier
   * @returns true si la touche est actuellement presser, false sinon
   */

  private isPressed(code: string): boolean {
    return this.keys.get(code) || false;
  }

  //===============
  //METHODES PUBLIQUES: Mapping des touches
  //===============

  /**
   * Deplacemet
   * On doit supporter 2 types de clavier:
   * ZQSD -> CLAVIER AZERTY et QSDZ -> CLAVIER QWERTY
   * -Flèche directionnelles
   */

  //Aller en haut
  up(): boolean {
    return (
      this.isPressed('ArrowUp') || this.isPressed('w') || this.isPressed('W')
    );
  }
  down(): boolean {
    return (
      this.isPressed('ArrowDown') || this.isPressed('s') || this.isPressed('S')
    );
  }

  left(): boolean {
    return (
      this.isPressed('ArrowLeft') ||
      this.isPressed('a') ||
      this.isPressed('A') ||
      this.isPressed('q') ||
      this.isPressed('Q')
    );
  }

  right(): boolean {
    return (
      this.isPressed('ArrowRight') || this.isPressed('d') || this.isPressed('D')
    );
  }

  //Attack

  attack(): boolean {
    return this.isPressed(' ');
  }

  //Attaque lourde

  heavyAttack(): boolean {
    return this.isPressed('KeyE');
  }

  //Dodge // Roll

  dodge(): boolean {
    return this.isPressed('ShiftLeft') || this.isPressed('ShiftRight');
  }
}
