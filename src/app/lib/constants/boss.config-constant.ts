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
  /** Animation de mort (ms) avant la suite du chapitre. [SUPPOSITION] */
  deathDuration: 3600,
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
  // Porte-hache du Denkyira : hache, puis mousquet ensorcelé, puis sabre. Lueur de braise sombre (poudre).
  champion: {
    1: { timeScale: 1, emissive: '#000000', emissiveIntensity: 0, attacks: ['shot', 'reap', 'judgment', 'feint', 'backhand'] },
    2: { timeScale: 1.12, emissive: '#2a0904', emissiveIntensity: 0.35, attacks: ['furrow', 'leap', 'mill', 'thrust', 'feint', 'backhand'] },
    3: { timeScale: 1.12, emissive: '#2a0904', emissiveIntensity: 0.35, attacks: ['furrow', 'leap', 'mill', 'thrust', 'feint', 'backhand'] },
  },
  guardian: {
    1: { timeScale: 1, emissive: '#27756c', emissiveIntensity: 1, attacks: ['surge', 'slam', 'charge'] },
    2: { timeScale: 1.1, emissive: '#2a8ca0', emissiveIntensity: 1, attacks: ['surge', 'slam', 'charge', 'tide', 'combo'] },
    3: { timeScale: 1.2, emissive: '#58c6ff', emissiveIntensity: 1, attacks: ['surge', 'slam', 'charge', 'tide', 'combo', 'sweep'] },
  },
  sentinel: {
    1: { timeScale: 1, emissive: '#1c4a55', emissiveIntensity: 0.7, attacks: ['surge', 'slam', 'charge'] },
    2: { timeScale: 1.08, emissive: '#2f7f86', emissiveIntensity: 0.85, attacks: ['surge', 'slam', 'charge', 'tide', 'combo'] },
    3: { timeScale: 1.18, emissive: '#7ad0c2', emissiveIntensity: 1, attacks: ['surge', 'slam', 'charge', 'tide', 'combo', 'sweep'] },
  },
  hunter: {
    1: { timeScale: 1, emissive: '#000000', emissiveIntensity: 0, attacks: ['slash', 'slam', 'charge'] },
    2: { timeScale: 1.1, emissive: '#6b2d10', emissiveIntensity: 0.5, attacks: ['slash', 'slam', 'charge', 'combo'] },
    3: { timeScale: 1.2, emissive: '#c8541c', emissiveIntensity: 0.8, attacks: ['slash', 'slam', 'charge', 'combo', 'sweep'] },
  },
  harvester: {
    1: { timeScale: 1, emissive: '#000000', emissiveIntensity: 0, attacks: ['reap', 'judgment', 'feint'] },
    2: { timeScale: 1.11, emissive: '#7a5b12', emissiveIntensity: 0.6, attacks: ['reap', 'judgment', 'feint', 'furrow', 'leap'] },
    3: { timeScale: 1.2, emissive: '#d5a92c', emissiveIntensity: 0.9, attacks: ['reap', 'judgment', 'furrow', 'leap', 'mill', 'thrust'] },
  },
  oracle: {
    1: { timeScale: 1, emissive: '#000000', emissiveIntensity: 0, attacks: ['shot', 'judgment', 'feint', 'backhand'] },
    2: { timeScale: 1.09, emissive: '#3b1d66', emissiveIntensity: 0.55, attacks: ['shot', 'judgment', 'feint', 'thrust', 'backhand'] },
    3: { timeScale: 1.17, emissive: '#8d62d6', emissiveIntensity: 0.9, attacks: ['shot', 'judgment', 'thrust', 'leap', 'mill'] },
  },
  berserker: {
    1: { timeScale: 1, emissive: '#000000', emissiveIntensity: 0, attacks: ['slam', 'charge', 'combo'] },
    2: { timeScale: 1.12, emissive: '#8a1810', emissiveIntensity: 0.75, attacks: ['slam', 'charge', 'combo', 'sweep', 'mill'] },
    3: { timeScale: 1.25, emissive: '#e03a1e', emissiveIntensity: 1, attacks: ['slash', 'slam', 'charge', 'combo', 'sweep', 'mill'] },
  },
  tideholder: {
    1: { timeScale: 1, emissive: '#1c5b70', emissiveIntensity: 0.8, attacks: ['surge', 'tide', 'slam'] },
    2: { timeScale: 1.09, emissive: '#3b91b4', emissiveIntensity: 1, attacks: ['surge', 'tide', 'slam', 'combo', 'charge'] },
    3: { timeScale: 1.19, emissive: '#8ce0ff', emissiveIntensity: 1.1, attacks: ['surge', 'tide', 'slam', 'combo', 'charge', 'sweep'] },
  },
  ashafo: {
    1: { timeScale: 1, emissive: '#000000', emissiveIntensity: 0, attacks: ['slash', 'combo', 'charge'] },
    2: { timeScale: 1.1, emissive: '#8a4a08', emissiveIntensity: 0.65, attacks: ['slash', 'combo', 'charge', 'sweep'] },
    3: { timeScale: 1.2, emissive: '#e08a1c', emissiveIntensity: 0.95, attacks: ['slash', 'combo', 'charge', 'sweep', 'mill'] },
  },
  ironmouth: {
    1: { timeScale: 1, emissive: '#33363a', emissiveIntensity: 0.5, attacks: ['slam', 'charge', 'surge'] },
    2: { timeScale: 1.08, emissive: '#69737c', emissiveIntensity: 0.8, attacks: ['slam', 'charge', 'surge', 'tide', 'combo'] },
    3: { timeScale: 1.17, emissive: '#b9c6cf', emissiveIntensity: 1, attacks: ['slam', 'charge', 'surge', 'tide', 'combo', 'sweep'] },
  },
  nightblade: {
    1: { timeScale: 1, emissive: '#000000', emissiveIntensity: 0, attacks: ['slash', 'feint', 'backhand'] },
    2: { timeScale: 1.12, emissive: '#241a46', emissiveIntensity: 0.6, attacks: ['slash', 'feint', 'backhand', 'thrust', 'leap'] },
    3: { timeScale: 1.22, emissive: '#6f4cc4', emissiveIntensity: 0.95, attacks: ['slash', 'feint', 'thrust', 'leap', 'mill', 'judgment'] },
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
