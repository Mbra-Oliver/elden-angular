import { AttackData } from '../interfaces/AttackData';

export const PLAYER_CONFIG = {
  size: 32, // Taille  en pixel (Carré 32x32)

  //Stats

  maxHp: 120,
  maxStamina: 100,

  //Mouvement

  speed: 220, // x pixel par seconde (pas par frame)

  //Souffle stamina.

  staminaRegen: 66, // Barre pleine en ~1,5 s (cahier des charges du chapitre 1)

  staminaRegenDelay: 360, // Temps en millisecondes avant de pouvoir regenerer de la stamina

  staminaLowThreshold: 0.2, // Pourcentage de stamina basse pour l'effet de tremblement (20%)

  //Roulade

  rollCost: 10, //Coût en stamina,
  rollDuration: 400, //Durée totale (ms) : élan, invincibilité puis récupération
  rollSpeed: 560, // Vitesse de pointe (px/s), décroît jusqu'à 0 en fin de roulade (~150 px)
  rollIFrames: 300, // Invincibilité dès le début de la roulade (ms)
  rollCancel: 310, // Après ce temps, une attaque ou une roulade tamponnée coupe la récupération
  perfectDodgeWindow: 125, // Début de roulade où esquiver un coup ouvre la riposte

  //Pas en arrière : verrouillé sur l'ennemi, Shift sans direction
  backstepCost: 7,
  backstepDuration: 300,
  backstepSpeed: 420, // ~85 px
  backstepIFrames: 150,

  //Sprint : maintenir Shift (un appui bref, relâché avant sprintDelay, déclenche la roulade)
  sprintDelay: 220, // ms
  sprintSpeed: 340,
  sprintStaminaPerSecond: 16,

  //Inertie et verrouillage
  acceleration: 24, // Réactivité vers la vitesse voulue (1/s)
  deceleration: 34,
  lockedSpeedFactor: 0.82, // Marche plus posée quand on tourne autour de l'ennemi

  //Attaque

  comboWindowDuration: 600, // Fenetre pour enchainer un combo (ms)
  inputBuffer: 150, // Durée de vie d'un appui mémorisé (ms) : attaque, lourde ou roulade
  windupTurnRate: 9, // Rotation possible pendant l'anticipation (rad/s)

  hurtDuration: 300,
  hurtIFrames: 380, // Invincibilité après un coup reçu : plus d'enchaînement subi sans pouvoir réagir
  hurtDodgeCancel: 0.6, // Fraction du recul après laquelle on peut rouler pour se dégager
  exhaustedDuration: 1000,
  exhaustedRegenDelay: 900, // Stamina vidée : plus d'étourdissement, juste une reprise de souffle plus lente
};

//Attaque rapide
// Anticipation lisible (windup), impact court (active), puis récupération
// annulable : à partir de `chain` une nouvelle attaque tamponnée part
// aussitôt, et la roulade peut annuler dès la fin de l'impact.
export const LIGHT_COMBO: AttackData[] = [
  { damage: 10, staminaCost: 6, duration: 340, range: 1.2, windup: 100, active: 60, chain: 215 },
  { damage: 12, staminaCost: 7, duration: 370, range: 1.3, windup: 105, active: 70, chain: 240 },
  { damage: 18, staminaCost: 9, duration: 540, range: 1.5, windup: 175, active: 85, chain: 420 },
];

//Attaque lourdes

export const HEAVY_ATTACK: AttackData = {
  damage: 30,
  staminaCost: 24,
  duration: 660,
  range: 1.8,
  windup: 280,
  active: 90,
  chain: 530,
};

export const COUNTER_ATTACK: AttackData = { damage: 44, staminaCost: 0, duration: 290, range: 2.4, windup: 32, active: 145 };

export type AttackType = 'light' | 'heavy' | 'counter' | 'none';
