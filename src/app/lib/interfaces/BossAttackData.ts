export type BossAttackType = 'slash' | 'slam' | 'charge' | 'combo' | 'surge' | 'none';

export const BOSS_COMBO_STEP = 3;

// On définit les formes de hitbox possibles pour plus de clarté
export type HitBoxType = 'directional' | 'aoe';

export interface BossAttackData {
  //Dégat qu'il inflige si l'attack touche le player
  damage: number;

  /** Type de zone d'effet (AOE) */
  hitBoxType: HitBoxType;

  /** Portée maximale de l'attaque (en unités de jeu) */
  range: number;

  /**Durée de l'attaque */

  attackDuration: number;

  /** Temps d'attente avant que l'attaque ne devienne active (préparation) */
  windupDuration: number;

  /** Temps de récupération après l'attaque avant de pouvoir agir à nouveau */
  recoverDuration: number;
}

export const BOSS_ATTACKS: Record<
  Exclude<BossAttackType, 'none'>, // Ajout de combo ici
  BossAttackData
> = {
  slash: {
    damage: 20,
    windupDuration: 500, // 0.5s : Rapide, demande de bons réflexes
    attackDuration: 300, // Le coup de lame est bref
    recoverDuration: 500, // Fenêtre courte
    hitBoxType: 'directional',
    range: 2,
  },

  slam: {
    damage: 35, // Plus punitif car plus lent
    windupDuration: 1200, // 1.2s : Le boss lève son arme, le joueur doit temporiser son esquive
    attackDuration: 200, // L'impact est instantané au sol
    recoverDuration: 1500, // Longue récupération : "punissable" par le joueur
    hitBoxType: 'aoe', // Onde de choc circulaire
    range: 3.5,
  },

  charge: {
    damage: 25,
    windupDuration: 800, // Le boss gratte le sol ou se baisse
    attackDuration: 1000, // Durée de la course
    recoverDuration: 1200, // Le boss doit reprendre son souffle après l'élan
    hitBoxType: 'directional',
    range: 8, // Longue distance
  },

  surge: {
    damage: 27,
    windupDuration: 1040,
    attackDuration: 630,
    recoverDuration: 1660,
    hitBoxType: 'aoe',
    range: 3.65,
  },

  combo: {
    damage: 15, // Dégâts faibles par coup, mais dangereux si tout touche
    windupDuration: 400, // Très soudain
    attackDuration: 2000, // Enchaînement de plusieurs coups
    recoverDuration: 800,
    hitBoxType: 'directional',
    range: 2.5,
  },
};


export const SURGE_WIDTH = 23;

export function surgeRadius(size: number, remainingMs: number) {
  const surge = BOSS_ATTACKS.surge;
  const progress = Math.max(0, Math.min(1, 1 - remainingMs / surge.attackDuration));
  return size * (0.45 + (surge.range - 0.45) * progress);
}
