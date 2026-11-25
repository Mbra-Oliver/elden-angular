import type { BossAttackType } from '../interfaces/BossAttackData';
import type { BossId } from './boss-lore';

export const BOSS_CONFIG = {
  size: 64, // Taille  en pixel (Carré 32x32)
  maxHp: 300,
  speed: 150,
  chaseRange: 600, //Porter de chasse
  idlePauseDuration: 475, //Temps de Idle la ou le boss bouge pas.
  knockbarReduction: 0.3,
  hurtDuration: 200,
  phase2Threshold: 0.5, //Passe a la phase 2 quand hp/2 ,
  phase2SpeedMultiplier: 1.5, //Augmente la vitesse du boss e phase 2
  chargeSpeed: 400, //Vitesse de l'attaque de charge,
  phase2WndupMultiplier: 0.7, //Augmente la duree de l'attaque de charge en phase 2
  phase2RecorverMultiplier: 0.8,
  shiftDuration: 1700, // Transition de phase : invulnérable, repousse le joueur
  shiftPushRadius: 120,
  chainRecover: 0.3, // Fraction de récupération conservée quand une attaque est enchaînée
  chainWindup: 0.7, // Préparation raccourcie de l'attaque enchaînée
};

/**
 * Rythme par phase : multiplicateurs de vitesse, préparation et récupération.
 * Ils s'ajoutent au timeScale du profil de phase (BOSS_PHASE_PROFILE) : les
 * valeurs ont été divisées d'autant pour garder les mêmes durées réelles de
 * préparation et de récupération qu'avant l'ajout du timeScale.
 */
export const BOSS_TEMPO: Record<1 | 2 | 3, { speed: number; windup: number; recover: number }> = {
  1: { speed: 1, windup: 1, recover: 1 },
  2: { speed: 1.14, windup: 0.935, recover: 0.935 },
  3: { speed: 1.21, windup: 0.864, recover: 0.9 },
};

export type BossAttackName = Exclude<BossAttackType, 'none'>;

/**
 * Profil d'une phase : pas de nouveau modèle, on change des paramètres.
 * - timeScale : vitesse de l'horloge du boss (états, coups, animations).
 * - emissive : lueur du matériau (braises du duelliste, cœur du Gardien).
 * - attacks : attaques débloquées dans son arbre de décision.
 */
export interface BossPhaseProfile {
  timeScale: number;
  emissive: string;
  emissiveIntensity: number;
  attacks: readonly BossAttackName[];
}

export const BOSS_PHASE_PROFILE: Record<BossId, Record<1 | 2 | 3, BossPhaseProfile>> = {
  duelist: {
    1: { timeScale: 1, emissive: '#000000', emissiveIntensity: 0, attacks: ['slash', 'slam', 'charge'] },
    2: { timeScale: 1.1, emissive: '#5a1d08', emissiveIntensity: 0.6, attacks: ['slash', 'slam', 'charge', 'combo'] },
    3: { timeScale: 1.2, emissive: '#b8400f', emissiveIntensity: 0.85, attacks: ['slash', 'slam', 'charge', 'combo', 'sweep'] },
  },
  guardian: {
    1: { timeScale: 1, emissive: '#27756c', emissiveIntensity: 1, attacks: ['surge', 'slam', 'charge'] },
    2: { timeScale: 1.1, emissive: '#2a8ca0', emissiveIntensity: 1, attacks: ['surge', 'slam', 'charge', 'tide', 'combo'] },
    3: { timeScale: 1.2, emissive: '#58c6ff', emissiveIntensity: 1, attacks: ['surge', 'slam', 'charge', 'tide', 'combo', 'sweep'] },
  },
};

export type BossState =
  | 'idle'
  | 'chase'
  | 'windup'
  | 'attacking'
  | 'recover'
  | 'hurt'
  | 'shift'
  | 'stunned'
  | 'dead';
