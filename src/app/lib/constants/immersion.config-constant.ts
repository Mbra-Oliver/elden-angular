import type { BossId } from './boss-lore';
import type { BossAttackType } from '../interfaces/BossAttackData';

/**
 * Réglages de « sensation » du combat : recul, équilibre (poise), caméra,
 * ralentis, traces persistantes et post-traitement. Valeurs choisies à
 * l'œil, à ajuster en jouant.
 */

/** Poids des coups du joueur : recul, perte d'équilibre et sursaut du boss. */
export const HIT_WEIGHT = {
  light: 1,
  heavy: 1.8,
  counter: 2.4,
  arrow: 0.45,
} as const;
export type HitWeight = keyof typeof HIT_WEIGHT;

export const POISE = {
  /** Réserve d'équilibre de chaque boss (en « dégâts bruts » encaissés). */
  max: { duelist: 70, guardian: 110, champion: 90 } satisfies Record<BossId, number>,
  /** Délai sans coup avant que l'équilibre se recharge (ms), puis vitesse (points/s). */
  regenDelay: 2200,
  regenRate: 28,
  /** Durée du chancellement quand l'équilibre rompt (ms). */
  breakDuration: 520,
  /** Recul physique par unité de poids (unités monde, ~5 cm chacune). */
  knockback: 3.2,
  /** Le recul se joue sur ~0,12 s : vitesse initiale = distance × amorti. */
  knockbackDamping: 16,
} as const;

/** Coup dans le dos : arc arrière du boss (cosinus) et bonus de dégâts. */
export const BACKSTAB = {
  cosine: -0.45,
  multiplier: 1.5,
} as const;

/** Ralenti sélectif (échelle de temps et durée en temps réel). */
export const TIME_DILATION = {
  perfectDodge: { scale: 0.25, ms: 200 },
  backstab: { scale: 0.3, ms: 200 },
  counter: { scale: 0.3, ms: 200 },
  finisher: { scale: 0.2, ms: 260 },
} as const;

/** FOV de base et poussées (degrés). */
export const FOV = {
  base: 54,
  sprint: 6,
  heavyCharge: 7,
  /** Au moment de l'impact lourd, le cadre se resserre un instant sous la base. */
  impactPunch: -2.5,
} as const;

/** Attaques imparables, annoncées par un éclat et un son aigu. */
export const PERILOUS_ATTACKS: Record<BossId, readonly BossAttackType[]> = {
  duelist: ['charge', 'sweep'],
  champion: ['shot', 'sweep'],
  guardian: ['tide', 'surge'],
};

export function isPerilous(boss: BossId, attack: BossAttackType | string) {
  return (PERILOUS_ATTACKS[boss] as readonly string[]).includes(attack);
}

/** Traces persistantes du combat. */
export const TRACES = {
  /** Flèches plantées dans le boss (s) et nombre maximum affiché. */
  stuckArrowLife: 4.5,
  stuckArrowMax: 10,
  /** Braises au sol (s) et nombre maximum. */
  emberLife: 6,
  emberMax: 120,
} as const;

/** Post-traitement léger. */
export const POST_FX = {
  bloomStrength: 1.15,
  /** Vignette sombre sous ce ratio de PV. */
  lowHpRatio: 0.2,
} as const;
