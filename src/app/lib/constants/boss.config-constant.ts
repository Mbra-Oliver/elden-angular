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

/** Rythme par phase : multiplicateurs de vitesse, préparation et récupération. */
export const BOSS_TEMPO: Record<1 | 2 | 3, { speed: number; windup: number; recover: number }> = {
  1: { speed: 1, windup: 1, recover: 1 },
  2: { speed: 1.25, windup: 0.85, recover: 0.85 },
  3: { speed: 1.45, windup: 0.72, recover: 0.75 },
};

export type BossState =
  | 'idle'
  | 'chase'
  | 'windup'
  | 'attacking'
  | 'recover'
  | 'hurt'
  | 'shift'
  | 'dead';
