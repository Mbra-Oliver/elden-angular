import { AttackData } from '../interfaces/AttackData';

export const PLAYER_CONFIG = {
  size: 32, // Taille  en pixel (Carré 32x32)

  //Stats

  maxHp: 120,
  maxStamina: 100,

  //Mouvement

  speed: 220, // x pixel par seconde (pas par frame)

  //Souffle stamina.

  staminaRegen: 38, // Regenere 25 stamina par seconde

  staminaRegenDelay: 360, // Temps en millisecondes avant de pouvoir regenerer de la stamina

  staminaLowThreshold: 0.2, // Pourcentage de stamina basse pour l'effet de tremblement (20%)

  //Roulade

  rollCost: 10, //Coût en stamina,
  rollDuration: 250, //Durée (ms)
  rollSpeed: 520,
  perfectDodgeWindow: 125, // Vitesse pendant le roll

  //Attaque

  comboWindowDuration: 600, // Fenetre pour enchainer un combo (ms)

  hurtDuration: 300,
  exhaustedDuration: 1000,
};

//Attaque rapide
export const LIGHT_COMBO: AttackData[] = [
  { damage: 10, staminaCost: 6, duration: 190, range: 1.2, windup: 52, active: 58 },
  { damage: 12, staminaCost: 7, duration: 220, range: 1.3, windup: 61, active: 70 },
  { damage: 18, staminaCost: 9, duration: 260, range: 1.5, windup: 77, active: 77 },
];

//Attaque lourdes

export const HEAVY_ATTACK: AttackData = {
  damage: 30,
  staminaCost: 24,
  duration: 410,
  range: 1.8,
  windup: 140,
  active: 86,
};

export const COUNTER_ATTACK: AttackData = { damage: 44, staminaCost: 0, duration: 290, range: 2.4, windup: 32, active: 145 };

export type AttackType = 'light' | 'heavy' | 'counter' | 'none';
