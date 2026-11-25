import { FORD_DUEL, SLUICE_DUEL, type DuelArena } from '../engine/duel-fog';

/**
 * Objets destructibles du décor (pays akan, 1817-1900).
 *
 * Tout ce qui est marqué [SUPPOSITION] est un choix de design ou de
 * reconstitution à valider : les objets s'inspirent de la culture matérielle
 * akan du XIXᵉ siècle (jarres en terre cuite, calebasses, paniers d'ignames,
 * murs en terre banchée dits « swish », palissades de raphia), mais leur
 * disposition et leurs résistances sont inventées pour le gameplay.
 *
 * Choix volontaire : aucun objet sacré n'est cassable (tabourets, autels,
 * tambours parleurs fontomfrom…). [SUPPOSITION : à confirmer avec toi.]
 */

/** Ce qui frappe l'objet : le multiplicateur de dégâts dépend du matériau. */
export type DamageSource = 'light' | 'heavy' | 'counter' | 'arrow' | 'boss' | 'roll' | 'contact';

export type DestructibleKind =
  | 'pot'        // ahina : jarre à eau en terre cuite
  | 'calabash'   // calebasse (récipient, louche)
  | 'basket'     // panier tressé rempli d'ignames
  | 'jar'        // grande jarre de stockage (vin de palme, grain)
  | 'firewood'   // fagot de bois de chauffe
  | 'barricade'  // panneau de palissade en raphia et bambou
  | 'wall'       // bloc de mur en terre banchée (swish)
  | 'stone';     // bloc de latérite de l'ancienne retenue

export type DebrisStyle = 'shard' | 'splinter' | 'clod' | 'straw';

export interface DestructibleKindConfig {
  label: string;
  radius: number;
  height: number;
  hp: number;
  /** Bloque le passage tant qu'il est debout. */
  solid: boolean;
  /** Petits objets : une roulade ou un passage du boss les brise. */
  fragile: boolean;
  resist: Partial<Record<DamageSource, number>>;
  color: string;
  accent: string;
  debris: DebrisStyle;
  debrisCount: number;
}

export const DESTRUCTIBLE_KINDS: Record<DestructibleKind, DestructibleKindConfig> = {
  pot: {
    label: 'Jarre ahina', radius: 8, height: 13, hp: 6, solid: false, fragile: true,
    resist: {}, color: '#a35a35', accent: '#6e3720', debris: 'shard', debrisCount: 10,
  },
  calabash: {
    label: 'Calebasse', radius: 6, height: 8, hp: 3, solid: false, fragile: true,
    resist: {}, color: '#c9a45a', accent: '#8a6a2e', debris: 'shard', debrisCount: 7,
  },
  basket: {
    label: "Panier d'ignames", radius: 10, height: 11, hp: 10, solid: false, fragile: true,
    resist: { arrow: 0.6 }, color: '#b58b4c', accent: '#7d5a3a', debris: 'straw', debrisCount: 11,
  },
  jar: {
    label: 'Grande jarre', radius: 13, height: 22, hp: 22, solid: true, fragile: false,
    resist: { arrow: 0.7 }, color: '#8f4a2c', accent: '#5c2e1b', debris: 'shard', debrisCount: 16,
  },
  firewood: {
    label: 'Fagot', radius: 12, height: 10, hp: 20, solid: true, fragile: false,
    resist: { arrow: 0.3, light: 0.8 }, color: '#6d4c30', accent: '#4a321f', debris: 'splinter', debrisCount: 12,
  },
  barricade: {
    label: 'Palissade de raphia', radius: 14, height: 24, hp: 38, solid: true, fragile: false,
    resist: { arrow: 0.35, light: 0.8 }, color: '#9c7a45', accent: '#5e4426', debris: 'splinter', debrisCount: 16,
  },
  wall: {
    label: 'Mur en terre (swish)', radius: 16, height: 26, hp: 100, solid: true, fragile: false,
    resist: { arrow: 0.15, light: 0.55, roll: 0 }, color: '#a8724c', accent: '#7a4e32', debris: 'clod', debrisCount: 18,
  },
  stone: {
    label: 'Bloc de latérite', radius: 16, height: 22, hp: 110, solid: true, fragile: false,
    resist: { arrow: 0, light: 0.35, roll: 0 }, color: '#8d4f36', accent: '#5b3324', debris: 'clod', debrisCount: 20,
  },
};

/** Dégâts infligés au décor par source (indépendants des dégâts au boss). */
export const DESTRUCTIBLE_DAMAGE: Record<DamageSource, number> = {
  light: 12,
  heavy: 34,
  counter: 50,
  arrow: 8,
  boss: 90,
  roll: 6,
  contact: 45, // par seconde, quand le boss pousse un objet en marchant
};

export interface DestructiblePlacement {
  kind: DestructibleKind;
  x: number;
  y: number;
  /** Orientation en radians (murs et palissades). */
  rot: number;
}

/** Position polaire relative à une arène : angle en tours, distance en fraction du rayon. */
function around(arena: DuelArena, kind: DestructibleKind, turn: number, reach: number, rot = 0): DestructiblePlacement {
  const angle = turn * Math.PI * 2;
  return { kind, x: arena.x + Math.cos(angle) * arena.radius * reach, y: arena.y + Math.sin(angle) * arena.radius * reach, rot };
}

/** Un pan de mur : plusieurs blocs alignés qui cèdent chacun séparément. */
function wallRun(kind: 'wall' | 'stone' | 'barricade', x: number, y: number, angle: number, blocks: number) {
  const step = DESTRUCTIBLE_KINDS[kind].radius * 1.9;
  const offset = (blocks - 1) / 2;
  return Array.from({ length: blocks }, (_, i): DestructiblePlacement => ({
    kind, x: x + Math.cos(angle) * step * (i - offset), y: y + Math.sin(angle) * step * (i - offset), rot: -angle,
  }));
}

function wallAround(arena: DuelArena, kind: 'wall' | 'stone' | 'barricade', turn: number, reach: number, blocks: number) {
  const angle = turn * Math.PI * 2;
  const x = arena.x + Math.cos(angle) * arena.radius * reach;
  const y = arena.y + Math.sin(angle) * arena.radius * reach;
  return wallRun(kind, x, y, angle + Math.PI / 2, blocks);
}

/**
 * Gué de l'Ouest : les familles ont fui en abandonnant leurs affaires.
 * [SUPPOSITION] Un muret de terre d'un ancien enclos et une palissade de
 * campement de guerre servent de couverts contre les charges de Kofi Brempong.
 */
const FORD_PROPS: DestructiblePlacement[] = [
  ...wallAround(FORD_DUEL, 'wall', 0.38, 0.62, 3),
  ...wallAround(FORD_DUEL, 'barricade', 0.12, 0.7, 2),
  ...wallAround(FORD_DUEL, 'barricade', 0.86, 0.66, 2),
  around(FORD_DUEL, 'pot', 0.2, 0.55),
  around(FORD_DUEL, 'pot', 0.23, 0.6),
  around(FORD_DUEL, 'calabash', 0.21, 0.66),
  around(FORD_DUEL, 'basket', 0.3, 0.78),
  around(FORD_DUEL, 'basket', 0.33, 0.83),
  around(FORD_DUEL, 'firewood', 0.47, 0.75, 0.4),
  around(FORD_DUEL, 'jar', 0.58, 0.66),
  around(FORD_DUEL, 'pot', 0.62, 0.6),
  around(FORD_DUEL, 'calabash', 0.64, 0.7),
  around(FORD_DUEL, 'pot', 0.7, 0.74),
  around(FORD_DUEL, 'basket', 0.74, 0.62),
  around(FORD_DUEL, 'firewood', 0.96, 0.8, 1.2),
  around(FORD_DUEL, 'pot', 0.02, 0.6),
  around(FORD_DUEL, 'calabash', 0.05, 0.56),
];

/**
 * Ancienne retenue : murs de latérite de la digue, jarres de stockage et
 * poteaux de la vanne. [SUPPOSITION] La digue est un ouvrage villageois en
 * blocs de latérite, plausible mais non documenté pour cette époque.
 */
const SLUICE_PROPS: DestructiblePlacement[] = [
  ...wallAround(SLUICE_DUEL, 'stone', 0.08, 0.45, 3),
  ...wallAround(SLUICE_DUEL, 'stone', 0.75, 0.62, 3),
  ...wallAround(SLUICE_DUEL, 'wall', 0.28, 0.6, 2),
  ...wallAround(SLUICE_DUEL, 'barricade', 0.85, 0.7, 2),
  around(SLUICE_DUEL, 'jar', 0.22, 0.55),
  around(SLUICE_DUEL, 'jar', 0.2, 0.66),
  around(SLUICE_DUEL, 'pot', 0.17, 0.5),
  around(SLUICE_DUEL, 'calabash', 0.45, 0.7),
  around(SLUICE_DUEL, 'pot', 0.48, 0.76),
  around(SLUICE_DUEL, 'basket', 0.5, 0.64),
  around(SLUICE_DUEL, 'firewood', 0.95, 0.45, 0.9),
  around(SLUICE_DUEL, 'jar', 0.8, 0.45),
  around(SLUICE_DUEL, 'pot', 0.96, 0.62),
  around(SLUICE_DUEL, 'pot', 0.99, 0.68),
];

/** Quelques jarres et paniers sur la place du village (hors combat). */
const VILLAGE_PROPS: DestructiblePlacement[] = [
  { kind: 'pot', x: 790, y: 690, rot: 0 },
  { kind: 'pot', x: 802, y: 700, rot: 0 },
  { kind: 'calabash', x: 785, y: 708, rot: 0 },
  { kind: 'basket', x: 960, y: 610, rot: 0 },
  { kind: 'jar', x: 1225, y: 560, rot: 0 },
  { kind: 'pot', x: 1210, y: 575, rot: 0 },
  { kind: 'firewood', x: 1040, y: 980, rot: 0.6 },
];

export const DESTRUCTIBLE_LAYOUT: readonly DestructiblePlacement[] = [
  ...FORD_PROPS, ...SLUICE_PROPS, ...VILLAGE_PROPS,
];
