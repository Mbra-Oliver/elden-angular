export const BOSS_CONFIG = {
  size: 64, // Taille  en pixel (Carré 32x32)
  maxHp: 300,
  speed: 150,
  chaseRange: 600, //Porter de chasse
  idlePauseDuration: 1000, //Temps de Idle la ou le boss bouge pas.
  knockbarReduction: 0.3,
  hurtDuration: 200,
  phase2Threshold: 0.5, //Passe a la phase 2 quand hp/2 ,
  phase2SpeedMultiplier: 1.5, //Augmente la vitesse du boss e phase 2
  chargeSpeed: 400, //Vitesse de l'attaque de charge,
  phase2WndupMultiplier: 0.7, //Augmente la duree de l'attaque de charge en phase 2
  phase2RecorverMultiplier: 0.8,
};

export type BossState =
  | 'idle'
  | 'chase'
  | 'windup'
  | 'attacking'
  | 'recover'
  | 'hurt'
  | 'dead';
