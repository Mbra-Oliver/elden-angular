import { Injectable, signal } from '@angular/core';
import { PLAYER_CONFIG } from '../../constants/player.config-constant';
import { PlayerData } from '../../interfaces/PlayerData';

@Injectable({
  providedIn: 'root',
})
export class PlayerStore {
  //Signal pour contenir toutes les donnees du joueur

  private readonly data = signal<PlayerData>({
    // --- Positions initiales
    x: 100,
    y: 100,

    // --- Vélocité (vitesse de déplacement actuelle)
    vx: 0,
    vy: 0,

    // --- Direction du regard (Regarde vers la droite par défaut)
    facingX: 1,
    facingY: 0,

    // --- Statistiques vitales
    hp: PLAYER_CONFIG.maxHp,
    maxHp: PLAYER_CONFIG.maxHp,
    stamina: PLAYER_CONFIG.maxStamina,
    maxStamina: PLAYER_CONFIG.maxStamina,

    // --- État de la Machine à États (FSM)
    state: 'idle',
    stateTimer: 0, // Pas de timer actif au lancement

    // --- Système de Combat & Esquive
    invicible: false,
    attackType: 'none',
    comboCount: 0,
    comboTimer: 0,
  });

  //Avoir les donnees actuelle du joueur

  getData(): PlayerData {
    return this.data();
  }

  //Mettre a jour les donnees

  update(partial: Partial<PlayerData>) {
    this.data.update((data) => ({
      ...data,
      ...partial,
    }));
  }

  reset() {
    this.update({
      x: 100,
      y: 100,
      vx: 0,
      vy: 0,
      hp: PLAYER_CONFIG.maxHp,
      maxHp: PLAYER_CONFIG.maxHp,
      stamina: PLAYER_CONFIG.maxStamina,
      maxStamina: PLAYER_CONFIG.maxStamina,
      state: 'idle',
      stateTimer: 0,
      invicible: false,
      attackType: 'none',
      comboCount: 0,
      comboTimer: 0,
    });
  }
}
