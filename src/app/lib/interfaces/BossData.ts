import { BossState } from '../constants/boss.config-constant';

//Fiche de stat globale du joueur
export interface BossData {
  //Positions
  x: number;
  y: number;

  //Vitesse

  vx: number; //Vélocity X (pixels/secondes)
  vy: number; //Vélocity Y (pixels/secondes)

  // ----DIRECTION DU REGARD

  facingX: number; // (-1, 0 ou 1)
  facingY: number;

  // ----STATS

  hp: number; // Points de vie
  maxHp: number; // Points de vie max

  // ----- État

  state: BossState;
  stateTimer: number; //Temps restant pour sortir de l'etat actuel (ms)
  stateLength: number; //Durée totale de l'état actuel (ms), pour l'avancement des animations
  phase: 1 | 2 | 3; //Phase du combat (change aux seuils de PV du lore)

  // ---- COMBAT
  currentAttack: string;
  comboStep: number;
  chargeTargetX: number;
  chargeTargetY: number;
}
