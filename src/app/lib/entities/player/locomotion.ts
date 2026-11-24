import { PLAYER_CONFIG } from '../../constants/player.config-constant';

/**
 * Briques de déplacement du joueur, sans dépendance Angular (testables seules) :
 * geste de la touche Shift (appui bref = esquive, maintien = sprint), inertie
 * de la marche et courbe de vitesse des esquives.
 */

export type DodgeKind = 'roll' | 'backstep';

/** Lit Shift : un appui relâché avant `sprintDelay` est une esquive, un maintien un sprint. */
export class ShiftGesture {
  private heldFor = 0;
  private down = false;

  /** @returns true à l'image où un appui bref vient d'être relâché. */
  update(pressed: boolean, deltaTime: number): boolean {
    let tap = false;
    if (pressed) {
      this.heldFor = this.down ? this.heldFor + deltaTime * 1000 : 0;
    } else if (this.down) {
      tap = this.heldFor < PLAYER_CONFIG.sprintDelay;
      this.heldFor = 0;
    }
    this.down = pressed;
    return tap;
  }

  get sprinting() {
    return this.down && this.heldFor >= PLAYER_CONFIG.sprintDelay;
  }

  reset() {
    this.heldFor = 0;
    this.down = false;
  }
}

/** Rapproche la vitesse actuelle de la vitesse voulue (accélération / freinage exponentiels). */
export function approachVelocity(vx: number, vy: number, targetX: number, targetY: number, deltaTime: number) {
  const speeding = targetX * targetX + targetY * targetY >= vx * vx + vy * vy;
  const rate = speeding ? PLAYER_CONFIG.acceleration : PLAYER_CONFIG.deceleration;
  const k = 1 - Math.exp(-rate * deltaTime);
  const x = vx + (targetX - vx) * k;
  const y = vy + (targetY - vy) * k;
  // Évite une glissade infinie à quelques px/s.
  return Math.hypot(x, y) < 4 && targetX === 0 && targetY === 0 ? { x: 0, y: 0 } : { x, y };
}

export interface DodgeProfile {
  duration: number;
  speed: number;
  iFrames: number;
  cancel: number;
  cost: number;
}

export function dodgeProfile(kind: DodgeKind): DodgeProfile {
  return kind === 'backstep'
    ? {
        duration: PLAYER_CONFIG.backstepDuration,
        speed: PLAYER_CONFIG.backstepSpeed,
        iFrames: PLAYER_CONFIG.backstepIFrames,
        cancel: PLAYER_CONFIG.backstepDuration * 0.75,
        cost: PLAYER_CONFIG.backstepCost,
      }
    : {
        duration: PLAYER_CONFIG.rollDuration,
        speed: PLAYER_CONFIG.rollSpeed,
        iFrames: PLAYER_CONFIG.rollIFrames,
        cancel: PLAYER_CONFIG.rollCancel,
        cost: PLAYER_CONFIG.rollCost,
      };
}

/** Vitesse d'esquive : élan franc au départ, freinage progressif jusqu'à l'arrêt. */
export function dodgeSpeed(peak: number, progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  return peak * (1 - p * p);
}
