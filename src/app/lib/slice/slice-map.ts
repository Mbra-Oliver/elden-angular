/**
 * Carte de la tranche verticale (Acte II, 1874).
 *
 * Après Aya, Yao envoie Ama par la plaine des termitières jusqu'aux chambres
 * asséchées de la vieille digue (mini-donjon en boucle autour du feu de la
 * digue). Le levier du canal, au fond, ouvre le passage de la digue : un
 * raccourci qui ramène à la vanne où attend Yao, puis au Gardien noyé.
 *
 * Repère du monde (x vers l'est, y vers le sud), en pixels du sol 2400×1600.
 * [SUPPOSITION] Toutes les positions et tailles sont des choix de level design
 * à valider en jeu.
 */

export interface Rect { x: number; y: number; w: number; h: number }
export interface Spot { x: number; y: number }

/** Zones où la forêt est dégagée (lue par scenery.ts). */
export const SLICE_CLEARINGS: readonly Rect[] = [
  { x: 600, y: 1120, w: 1790, h: 440 }, // plaine des termitières
  { x: 1880, y: 280, w: 500, h: 920 }, // chambres de la digue
  { x: 1690, y: 290, w: 220, h: 240 }, // passage de la digue → retenue
];

export const PLAIN: Rect = { x: 620, y: 1150, w: 1740, h: 390 };
export const DUNGEON: Rect = { x: 1900, y: 300, w: 460, h: 880 };

export const WALL_HEIGHT = 28;

/** Murs de latérite des chambres asséchées (épaisseur 16). */
export const DUNGEON_WALLS: readonly Rect[] = [
  // Enceinte
  { x: 1900, y: 300, w: 460, h: 16 },
  { x: 1900, y: 300, w: 16, h: 30 },
  { x: 1900, y: 410, w: 16, h: 770 },
  { x: 2344, y: 300, w: 16, h: 880 },
  { x: 1900, y: 1164, w: 190, h: 16 },
  { x: 2170, y: 1164, w: 190, h: 16 },
  // Couloir ouest | chambre centrale | couloir est
  { x: 2020, y: 420, w: 16, h: 596 },
  { x: 2224, y: 420, w: 16, h: 596 },
  { x: 2020, y: 420, w: 90, h: 16 },
  { x: 2150, y: 420, w: 90, h: 16 },
  // Fond de la chambre centrale (côté hall)
  { x: 2020, y: 1000, w: 220, h: 16 },
];

export type DoorId = 'shortcut' | 'passage';

export interface DoorDef {
  id: DoorId;
  rect: Rect;
  name: string;
  /** Côté d'où l'on peut l'ouvrir (test sur la position du joueur). */
  opensFrom: (x: number, y: number) => boolean;
  lockedText: string;
}

export const DOORS: readonly DoorDef[] = [
  {
    // Porte basse barrée de l'intérieur : du hall on ne peut pas l'ouvrir.
    id: 'shortcut',
    rect: { x: 2240, y: 1000, w: 104, h: 16 },
    name: 'Porte barrée',
    opensFrom: (_x, y) => y < 1000,
    lockedText: 'Barrée de l’autre côté.',
  },
  {
    // Ouverte par le levier du canal.
    id: 'passage',
    rect: { x: 1900, y: 330, w: 16, h: 80 },
    name: 'Passage de la digue',
    opensFrom: () => false,
    lockedText: 'Le passage est noyé de boue. Le levier du canal doit être plus loin.',
  },
];

export type RestId = 'goli' | 'digue';

export interface RestPoint extends Spot { id: RestId; name: string }

export const REST_POINTS: Record<RestId, RestPoint> = {
  goli: { id: 'goli', x: 960, y: 832, name: 'Feu du Goli' },
  digue: { id: 'digue', x: 2190, y: 1092, name: 'Feu de la digue' },
};

export const DUNGEON_ENTRANCE: Spot & { name: string } = { x: 2130, y: 1196, name: 'Chambres de la vieille digue' };
export const LEVER: Spot & { name: string } = { x: 2306, y: 360, name: 'Levier du canal' };

/** Grand fromager mort sur la digue : visible depuis le village et le gué. */
export const LANDMARK: Spot = { x: 2130, y: 236 };

/** Termitières de la plaine : obstacles et couverts contre les fusiliers. */
export const MOUNDS: readonly (Spot & { r: number; h: number })[] = [
  { x: 760, y: 1270, r: 15, h: 34 }, { x: 905, y: 1440, r: 19, h: 44 },
  { x: 1040, y: 1235, r: 13, h: 28 }, { x: 1180, y: 1360, r: 20, h: 48 },
  { x: 1330, y: 1470, r: 14, h: 30 }, { x: 1420, y: 1280, r: 18, h: 40 },
  { x: 1590, y: 1360, r: 16, h: 38 }, { x: 1730, y: 1460, r: 21, h: 50 },
  { x: 1860, y: 1270, r: 14, h: 31 }, { x: 2010, y: 1420, r: 17, h: 42 },
  { x: 2240, y: 1300, r: 15, h: 33 }, { x: 2290, y: 1480, r: 19, h: 45 },
];

/** Acacias clairsemés (décor, sans collision). */
export const ACACIAS: readonly Spot[] = [
  { x: 680, y: 1490 }, { x: 990, y: 1330 }, { x: 1270, y: 1210 }, { x: 1500, y: 1500 },
  { x: 1660, y: 1210 }, { x: 1950, y: 1500 }, { x: 2330, y: 1210 },
];

export type EnemyKind = 'pilleur' | 'fusilier' | 'noye';

export interface EnemySpawn extends Spot { kind: EnemyKind }

export const ENEMY_SPAWNS: readonly EnemySpawn[] = [
  // Plaine : hommes du conseil et pillards venus de la guerre.
  { kind: 'pilleur', x: 960, y: 1300 },
  { kind: 'pilleur', x: 1250, y: 1420 },
  { kind: 'fusilier', x: 1440, y: 1230 },
  { kind: 'pilleur', x: 1650, y: 1420 },
  { kind: 'pilleur', x: 1700, y: 1300 },
  { kind: 'fusilier', x: 2060, y: 1340 },
  // Couloir ouest
  { kind: 'pilleur', x: 1966, y: 820 },
  { kind: 'fusilier', x: 1966, y: 470 },
  // Galerie nord
  { kind: 'noye', x: 2160, y: 362 },
  // Chambre centrale (pièce optionnelle : l'afena)
  { kind: 'noye', x: 2090, y: 700 },
  { kind: 'noye', x: 2170, y: 860 },
  // Couloir est, vers la porte barrée
  { kind: 'pilleur', x: 2292, y: 560 },
  { kind: 'noye', x: 2292, y: 860 },
];

export type ItemId = 'piquet' | 'poids' | 'batakari' | 'perle' | 'afena' | 'calebasse';

export interface ItemPlacement extends Spot { id: ItemId }

export const ITEM_PLACEMENTS: readonly ItemPlacement[] = [
  { id: 'piquet', x: 1120, y: 1500 },
  { id: 'poids', x: 1800, y: 1210 },
  { id: 'batakari', x: 2320, y: 1400 },
  { id: 'perle', x: 1950, y: 352 },
  { id: 'afena', x: 2130, y: 960 },
  { id: 'calebasse', x: 2300, y: 975 },
];

export function inRect(x: number, y: number, rect: Rect, margin = 0) {
  return x >= rect.x - margin && x <= rect.x + rect.w + margin &&
    y >= rect.y - margin && y <= rect.y + rect.h + margin;
}

/** Cercle (x, y, r) contre rectangle. */
export function circleHitsRect(x: number, y: number, r: number, rect: Rect) {
  const ex = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const ey = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  return (x - ex) ** 2 + (y - ey) ** 2 < r * r;
}

/** Le segment (ax,ay)→(bx,by) traverse-t-il un mur ? (ligne de tir) */
export function segmentBlocked(ax: number, ay: number, bx: number, by: number, rects: readonly Rect[]) {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 8);
  for (let i = 1; i < steps; i++) {
    const x = ax + (bx - ax) * i / steps;
    const y = ay + (by - ay) * i / steps;
    if (rects.some((rect) => inRect(x, y, rect))) return true;
  }
  return false;
}
