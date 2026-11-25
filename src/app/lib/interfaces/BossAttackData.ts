export type BossAttackType = 'slash' | 'slam' | 'charge' | 'combo' | 'surge' | 'sweep' | 'tide' | 'shot' | 'none';

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
    damage: 14, // Dégâts faibles par coup, mais dangereux si tout touche
    windupDuration: 520, // Soudain, mais lisible
    attackDuration: 1140, // BOSS_COMBO_STEP coups de 380 ms
    recoverDuration: 950,
    hitBoxType: 'directional',
    range: 2.1,
  },

  // Moulinet / tourbillon : zone circulaire autour du boss, à fuir en roulant vers l'extérieur.
  sweep: {
    damage: 24,
    windupDuration: 900,
    attackDuration: 720,
    recoverDuration: 1250,
    hitBoxType: 'aoe',
    range: 2.7,
  },

  // Mousquet ensorcelé (porte-hache du Denkyira) : longue visée lisible, balle
  // instantanée en ligne droite, long rechargement à punir. range en tailles de boss.
  shot: {
    damage: 28,
    windupDuration: 1250,
    attackDuration: 420,
    recoverDuration: 1500,
    hitBoxType: 'directional',
    range: 6,
  },

  // Double vague : deux anneaux décalés, deux esquives à rythmer.
  tide: {
    damage: 22,
    windupDuration: 1150,
    attackDuration: 1150,
    recoverDuration: 1900,
    hitBoxType: 'aoe',
    range: 3.65,
  },
};

/** Avancement 0→1 de la phase active d'une attaque. */
export function attackProgress(attack: Exclude<BossAttackType, 'none'>, remainingMs: number) {
  return Math.max(0, Math.min(1, 1 - remainingMs / BOSS_ATTACKS[attack].attackDuration));
}

/** Indice du coup en cours dans un combo (0..BOSS_COMBO_STEP-1). */
export function comboStepAt(progress: number) {
  return Math.min(BOSS_COMBO_STEP - 1, Math.floor(progress * BOSS_COMBO_STEP));
}

/**
 * Fenêtre où l'attaque blesse réellement. En dehors, l'arme est en
 * mouvement d'armement ou de retour (anticipation / follow-through) et ne
 * touche pas : l'animation et la hitbox racontent la même chose.
 */
export function isBossHitActive(attack: BossAttackType, progress: number) {
  if (attack === 'combo') {
    const local = (progress * BOSS_COMBO_STEP) % 1;
    return local >= 0.18 && local <= 0.62;
  }
  if (attack === 'sweep') return progress >= 0.15 && progress <= 0.82;
  if (attack === 'slash') return progress <= 0.72;
  // La balle part au début : seul le départ du coup blesse, la fumée non.
  if (attack === 'shot') return progress <= 0.3;
  return true;
}

/** Rayons des anneaux d'eau encore actifs pendant une double vague. */
export function tideRadii(size: number, remainingMs: number): number[] {
  const tide = BOSS_ATTACKS.tide;
  const progress = Math.max(0, Math.min(1, 1 - remainingMs / tide.attackDuration));
  const ring = (t: number) => size * (0.45 + (tide.range - 0.45) * t);
  const radii: number[] = [];
  const first = progress / 0.62;
  const second = (progress - 0.38) / 0.62;
  if (first <= 1) radii.push(ring(first));
  if (second >= 0 && second <= 1) radii.push(ring(second));
  return radii;
}


export const SURGE_WIDTH = 23;

export function surgeRadius(size: number, remainingMs: number) {
  const surge = BOSS_ATTACKS.surge;
  const progress = Math.max(0, Math.min(1, 1 - remainingMs / surge.attackDuration));
  return size * (0.45 + (surge.range - 0.45) * progress);
}

/** Directions (radians autour du regard) des balles d'un tir : éventail de trois en phase 3. */
export function shotAngles(phase: number): number[] {
  return phase >= 3 ? [-0.24, 0, 0.24] : [0];
}

/** Demi-largeur (unités) de la ligne de tir qui blesse. */
export const SHOT_WIDTH = 14;
