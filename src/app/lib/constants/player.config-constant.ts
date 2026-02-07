import { AttackData } from '../interfaces/AttackData';

export const PLAYER_CONFIG = {
  size: 32, // Taille  en pixel (Carré 32x32)

  //Stats

  maxHp: 100,
  maxStamina: 100,

  //Mouvement

  speed: 150, // x pixel par seconde (pas par frame)

  //Souffle stamina.

  staminaRegen: 25, // Regenere 25 stamina par seconde

  staminaRegenDelay: 800, // Temps en millisecondes avant de pouvoir regenerer de la stamina

  staminaLowThreshold: 0.2, // Pourcentage de stamina basse pour l'effet de tremblement (20%)

  //Roulade

  rollCost: 20, //Coût en stamina,
  rollDuration: 400, //Durée (ms)
  rollSpeed: 300, // Vitesse pendant le roll

  //Attaque

  comboWindowDuration: 600, // Fenetre pour enchainer un combo (ms)

  hurtDuration: 300,
  exhaustedDuration: 1000,
};

//Attaque rapide
export const LIGHT_COMBO: AttackData[] = [
  { damage: 10, staminaCost: 15, duration: 300, range: 1.2 },
  { damage: 12, staminaCost: 18, duration: 500, range: 1.3 },
  { damage: 18, staminaCost: 22, duration: 350, range: 1.5 },
];

//Attaque lourdes

export const HEAVY_ATTACK: AttackData = {
  damage: 30,
  staminaCost: 50,
  duration: 600,
  range: 1.8,
};

export type AttackType = 'light' | 'heavy' | 'none';
