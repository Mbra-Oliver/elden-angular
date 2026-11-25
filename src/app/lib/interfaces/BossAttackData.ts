export type BossAttackType = 'slash' | 'slam' | 'charge' | 'combo' | 'surge' | 'sweep' | 'tide' | 'shot'
  // Badu Ofosu (chapitre 1) : hache et mousquet.
  | 'reap' | 'judgment' | 'feint' | 'backhand' | 'furrow' | 'leap' | 'mill' | 'thrust'
  | 'none';

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

  // Coup de foudre (mousquet de Badu) : 1,2 s de visée lisible, balle
  // instantanée en ligne droite, 2,5 s de rechargement à punir. range en tailles de boss.
  // Dégâts : 70 % de la vie max du joueur (voir SHOT_DAMAGE_RATIO).
  shot: {
    damage: 0,
    windupDuration: 1200,
    attackDuration: 300,
    recoverDuration: 2500,
    hitBoxType: 'directional',
    range: 6,
  },

  // ── Badu Ofosu. [SUPPOSITION] durées et dégâts tirés de la fiche, à régler en jeu.
  // Double faucheuse : épaule armée (0,6 s), deux balayages larges.
  reap: { damage: 24, windupDuration: 600, attackDuration: 1000, recoverDuration: 950, hitBoxType: 'directional', range: 1.9 },
  // Jugement retardé : hache levée, figée 0,8 s, puis abattue (attrape les roulades paniquées).
  judgment: { damage: 48, windupDuration: 1300, attackDuration: 260, recoverDuration: 1500, hitBoxType: 'aoe', range: 1.7 },
  // Feinte : même départ que le jugement, annulée à 0,4 s, pas de côté et coup de crosse (P1) ou estoc (P2).
  feint: { damage: 20, windupDuration: 420, attackDuration: 380, recoverDuration: 750, hitBoxType: 'directional', range: 1.8 },
  // Revers de crosse : frappe vers l'arrière quand le joueur reste dans son dos.
  backhand: { damage: 18, windupDuration: 400, attackDuration: 260, recoverDuration: 650, hitBoxType: 'aoe', range: 1.6 },
  // Sillon d'étincelles : hache traînée au sol, course, uppercut.
  furrow: { damage: 32, windupDuration: 800, attackDuration: 1100, recoverDuration: 1250, hitBoxType: 'directional', range: 8 },
  // Chute du roi : bond, écrasement, onde courte autour de l'impact.
  leap: { damage: 36, windupDuration: 900, attackDuration: 760, recoverDuration: 1300, hitBoxType: 'aoe', range: 2.4 },
  // Moulinet de Feyiase : 2 diagonales, 1 circulaire, 1 écrasement, puis 1,5 s d'essoufflement.
  mill: { damage: 21, windupDuration: 700, attackDuration: 1900, recoverDuration: 1500, hitBoxType: 'directional', range: 1.9 },
  // Estocade brise-garde : ultra-rapide, vide l'endurance.
  thrust: { damage: 26, windupDuration: 500, attackDuration: 220, recoverDuration: 850, hitBoxType: 'directional', range: 2.3 },

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

/** Nombre de coups dans les attaques à plusieurs frappes. */
export const BOSS_STRIKES: Partial<Record<Exclude<BossAttackType, 'none'>, number>> = {
  combo: BOSS_COMBO_STEP, reap: 2, mill: 4,
};

/** Indice du coup en cours dans un combo (0..BOSS_COMBO_STEP-1). */
export function comboStepAt(progress: number, strikes = BOSS_COMBO_STEP) {
  return Math.min(strikes - 1, Math.floor(progress * strikes));
}

/** Part de la vie max du joueur qu'emporte une balle de Badu. */
export const SHOT_DAMAGE_RATIO = 0.7;

/**
 * Fenêtre où l'attaque blesse réellement. En dehors, l'arme est en
 * mouvement d'armement ou de retour (anticipation / follow-through) et ne
 * touche pas : l'animation et la hitbox racontent la même chose.
 */
export function isBossHitActive(attack: BossAttackType, progress: number) {
  const strikes = attack === 'none' ? undefined : BOSS_STRIKES[attack];
  if (strikes) {
    // Chaque coup : armement, lame qui fend l'air, retour. Seul le passage de
    // la lame blesse (calé sur l'animation : la lame est à mi-course vers 0,3).
    const local = (progress * strikes) % 1;
    return local >= 0.28 && local <= 0.58;
  }
  // Jugement : seulement quand la hache touche le sol (k ≈ 0,25), pas pendant qu'elle y reste.
  if (attack === 'judgment') return progress >= 0.2 && progress <= 0.42;
  if (attack === 'feint') return progress >= 0.5 && progress <= 0.75;
  if (attack === 'backhand' || attack === 'thrust') return progress >= 0.2 && progress <= 0.75;
  // Saut : seule la réception blesse ; sillon : la course et l'uppercut final.
  if (attack === 'leap') return progress >= 0.72 && progress <= 0.92;
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
