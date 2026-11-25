import type { DestructibleKind } from './destructibles.config-constant';
import { REST_POINTS, type RestId } from '../slice/slice-map';

/**
 * Boucle soulslike : foyers (repos + sauvegarde) et cauris perdus à la mort.
 * Les raccourcis du donjon et les niveaux appartiennent à la tranche (lib/slice). Toutes les valeurs sont des [SUPPOSITIONS] à
 * régler en jeu.
 *
 * Les cauris servaient de monnaie dans les marchés de la région au XIXe
 * siècle : ce sont eux qu'Ama ramasse dans les jarres et sur les vaincus.
 */

export type FoyerId = 'gue' | RestId;
export type Chapter = 'battle' | 'crossing' | 'village';

export interface Foyer {
  id: FoyerId;
  name: string;
  x: number;
  y: number;
}

/**
 * Foyers : celui du gué (Acte I) est propre à cette boucle ; ceux du Goli et
 * de la digue reprennent les points de repos de la tranche (slice-map.ts)
 * pour qu'un seul feu existe à chaque endroit.
 */
export const FOYERS: Record<FoyerId, Foyer> = {
  // Au départ du duel, sur le chemin du gué (hors des jarres de l'arène).
  gue: { id: 'gue', name: 'Foyer du gué', x: 512, y: 296 },
  goli: { id: 'goli', name: 'Foyer du Goli', x: REST_POINTS.goli.x, y: REST_POINTS.goli.y },
  digue: { id: 'digue', name: 'Foyer de la digue', x: REST_POINTS.digue.x, y: REST_POINTS.digue.y },
};

/** Foyer où l'on revient pour chaque chapitre tant qu'aucun autre n'a servi. */
export const CHAPTER_FOYER: Record<Chapter, FoyerId> = { battle: 'gue', crossing: 'gue', village: 'goli' };

export const SOULS = {
  /** Distance pour se reposer au foyer. */
  interactRadius: 36,
  /** Distance pour ramasser les cauris perdus (contact). */
  stashRadius: 24,
  bossReward: { duelist: 600, guardian: 1500 } as Record<string, number>,
};

/** Cauris trouvés dans chaque objet cassé. */
export const PROP_CAURIS: Record<DestructibleKind, number> = {
  pot: 14, calabash: 9, basket: 18, jar: 24, firewood: 6, barricade: 8, wall: 5, stone: 5,
};

export const SAVE_KEY = 'souls';
