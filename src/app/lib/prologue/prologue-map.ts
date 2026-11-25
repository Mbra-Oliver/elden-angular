import { sceneryRandom } from '../constants/scenery';

/**
 * Prologue, 1701 : le champ de bataille de la guerre de libération asante
 * contre le Denkyira, sur la route de Feyiase.
 *
 * Kwadwo Ofori, soldat de l'arrière-garde (kyidom), a été assommé pendant
 * l'accrochage. Quand il se relève, la colonne est passée. Le chemin qu'elle
 * a laissé raconte le combat : morts des deux camps, mousquets jetés,
 * herbe brûlée, tambours abandonnés. Il le suit vers l'est jusqu'au camp.
 *
 * La carte vit à l'est du monde des actes I–II (x > 3400) : le brouillard
 * cache l'un à l'autre et rien n'est partagé. Repère : x vers l'est, y vers
 * le sud, en unités du sol (1 unité ≈ 6 cm, un homme ≈ 30 unités).
 * [SUPPOSITION] Toutes les positions, tailles et quantités sont des choix
 * de level design à valider en jeu.
 */

export interface Spot { x: number; y: number }
export interface Circle extends Spot { r: number }

/** Rectangle de la carte (bornes de déplacement quand on y est). */
export const PROLOGUE_AREA = { x: 3400, y: 100, w: 2400, h: 1400 };

export function inPrologue(x: number, y: number, margin = 0) {
  const a = PROLOGUE_AREA;
  return x > a.x - margin && x < a.x + a.w + margin && y > a.y - margin && y < a.y + a.h + margin;
}

/** Ligne médiane du sentier laissé par la colonne, de l'ouest (réveil) à l'est (camp). */
export const TRAIL: readonly Spot[] = [
  { x: 3530, y: 1250 },
  { x: 3760, y: 1170 },
  { x: 3980, y: 1010 },
  { x: 4220, y: 890 },
  { x: 4460, y: 810 },
  { x: 4700, y: 700 },
  { x: 4960, y: 570 },
  { x: 5200, y: 470 },
  { x: 5430, y: 390 },
  { x: 5600, y: 340 },
];

/** Demi-largeur praticable du sentier (herbes piétinées, sous-bois arraché). */
export const TRAIL_HALF = 62;

/** Clairières le long du sentier. */
export const CLEARINGS: readonly (Circle & { id: string })[] = [
  { id: 'reveil', x: 3540, y: 1240, r: 112 },
  { id: 'ruisseau', x: 4225, y: 885, r: 92 },
  { id: 'ligne', x: 4700, y: 700, r: 195 },
  { id: 'tambours', x: 5195, y: 475, r: 125 },
  { id: 'camp', x: 5580, y: 350, r: 150 },
];

/** Ruisseau qui coupe le sentier (décor : on le passe à gué, il ne bloque pas). */
export const STREAM: readonly Spot[] = [
  { x: 4150, y: 560 }, { x: 4200, y: 720 }, { x: 4240, y: 880 }, { x: 4215, y: 1040 }, { x: 4260, y: 1260 },
];

/** Distance d'un point à la ligne brisée. */
export function distanceToPolyline(x: number, y: number, points: readonly Spot[]) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - a.x - dx * t, y - a.y - dy * t));
  }
  return best;
}

/** Vrai si un cercle (x, y, radius) tient entièrement dans le sentier ou une clairière. */
export function walkable(x: number, y: number, radius = 0) {
  if (distanceToPolyline(x, y, TRAIL) + radius <= TRAIL_HALF) return true;
  return CLEARINGS.some((c) => Math.hypot(x - c.x, y - c.y) + radius <= c.r);
}

// ─── Récit du décor ─────────────────────────────────────────────────────────

export type RemainsId =
  | 'kwasi' | 'traces' | 'fusil' | 'archer' | 'ruisseau' | 'ligne' | 'gourde' | 'tambours' | 'awale';

export interface Remains extends Spot {
  id: RemainsId;
  /** Libellé de l'invite (touche F). */
  label: string;
  title: string;
  text: string;
  /** Ce que l'on ramasse, s'il y a quelque chose. */
  gives?: { arrows?: number; bandji?: number };
}

/**
 * Restes que l'on peut examiner (F). Le reste du décor parle seul ; ces
 * points-là disent ce que Kwadwo comprend en les voyant.
 * [SUPPOSITION] Textes à faire relire par une personne akan ou un historien.
 */
export const REMAINS: readonly Remains[] = [
  {
    id: 'kwasi', x: 3575, y: 1205, label: 'Examiner le corps de Kwasi',
    title: 'Kwasi Boateng',
    text: 'Ton frère de lance, de la même compagnie de l’arrière-garde. Il t’a tiré sous le tronc quand la balle t’a jeté à terre, puis il est retourné au combat. Sa lance est brisée. La tienne est restée près de toi.',
  },
  {
    id: 'traces', x: 3735, y: 1185, label: 'Regarder les traces',
    title: 'Le passage de la colonne',
    text: 'Des centaines de pieds nus ont couché l’herbe, toutes vers l’est. Une gourde de poudre est tombée d’une ceinture sans que personne ne s’arrête. L’armée n’a pas attendu ses traînards.',
  },
  {
    id: 'fusil', x: 3965, y: 1040, label: 'Examiner le mousquet',
    title: 'Mousquet de traite',
    text: 'Un fusil à silex venu de la côte, échangé contre de l’or. Le soldat du Denkyira qui le portait n’a pas eu le temps de recharger. La platine est encore chaude.',
  },
  {
    id: 'archer', x: 4125, y: 930, label: 'Fouiller le carquois',
    title: 'Carquois d’un archer',
    text: 'Un archer de ta compagnie, tombé sur son arc. Quelqu’un est déjà passé fouiller les morts. Il reste quatre flèches dans le carquois.',
    gives: { arrows: 4 },
  },
  {
    id: 'ruisseau', x: 4245, y: 845, label: 'Regarder le ruisseau',
    title: 'Le gué du ruisseau',
    text: 'Les deux armées se sont battues dans l’eau jusqu’aux genoux. Des gourdes, des sandales et un tambour d’aisselle dérivent contre les racines.',
  },
  {
    id: 'ligne', x: 4690, y: 690, label: 'Examiner la ligne de fusiliers',
    title: 'La ligne qui a cédé',
    text: 'Ici, les fusiliers du Denkyira tenaient en rang. Les tonnelets de poudre ont brûlé l’herbe autour d’eux. Quand la ligne a cédé, ils ont jeté leurs fusils pour courir plus vite.',
  },
  {
    id: 'gourde', x: 4885, y: 615, label: 'Ramasser la gourde',
    title: 'Gourde de vin de palme',
    text: 'Bouchée de feuilles, encore pleine. Un porteur l’a laissée tomber en courant derrière les soldats.',
    gives: { bandji: 1 },
  },
  {
    id: 'tambours', x: 5165, y: 445, label: 'Examiner les tambours',
    title: 'Les tambours parlants',
    text: 'La paire d’atumpan de l’avant-garde, abandonnée. L’un est crevé d’une balle. Ce sont eux que tu entendais : quelqu’un d’autre en joue maintenant, plus loin vers l’est.',
  },
  {
    id: 'awale', x: 5440, y: 410, label: 'Examiner le plateau',
    title: 'Un plateau d’awalé renversé',
    text: 'Les graines sont éparpillées dans la boue, au milieu d’un abri de feuilles écrasé. On racontera plus tard que le roi du Denkyira, Ntim Gyakari, jouait encore quand les guerriers d’Osei Tutu l’ont trouvé.',
  },
];

/** Distance d'examen (F). */
export const INSPECT_RADIUS = 34;

/** Arrivée : le camp de l'arrière-garde, sur la crête. */
export const CAMP: Spot & { r: number } = { x: 5600, y: 340, r: 70 };

/** Point de départ (sous le tronc couché, à côté de Kwasi). */
export const START: Spot = { x: 3530, y: 1262 };

/** Foyers du prologue (repos, point de retour). */
export const PROLOGUE_FOYERS = {
  kyidom: { x: 3500, y: 1205, name: 'Feu de l’arrière-garde' },
  tambours: { x: 5230, y: 520, name: 'Feu des tambours' },
} as const;

/** Soldats du Denkyira restés en arrière (pillards et fusiliers de la slice). */
export const PROLOGUE_SPAWNS: readonly ({ kind: 'pilleur' | 'fusilier' } & Spot)[] = [
  // Un pillard fouille les morts près de l'archer.
  { kind: 'pilleur', x: 4070, y: 960 },
  // Arrière-garde du Denkyira sur la ligne de fusiliers.
  { kind: 'fusilier', x: 4800, y: 640 },
  { kind: 'pilleur', x: 4640, y: 770 },
  // Un dernier tireur garde les tambours.
  { kind: 'fusilier', x: 5300, y: 430 },
];

// ─── Décor (positions générées une fois, partagées par la 3D et les collisions) ──

const rand = sceneryRandom(1701);

export interface PropSpot extends Spot { yaw: number; variant: number }

/** Arbres de forêt dense des deux côtés du sentier (r : rayon du tronc, couronne ≈ 3 r). */
export const FOREST: readonly (Circle & { height: number; seed: number })[] = (() => {
  const trees: (Circle & { height: number; seed: number })[] = [];
  const a = PROLOGUE_AREA;
  for (let i = 0; trees.length < 520 && i < 6000; i++) {
    const x = a.x + rand() * a.w;
    const y = a.y + rand() * a.h;
    const r = 7 + rand() * 9;
    // Lisière serrée près du sentier, sous-bois plus clair plus loin.
    const edge = distanceToPolyline(x, y, TRAIL) - TRAIL_HALF;
    // Le tronc reste hors du praticable (il peut mordre la lisière).
    if (edge < r * 0.6 || CLEARINGS.some((c) => Math.hypot(x - c.x, y - c.y) < c.r + r * 0.6)) continue;
    if (edge > 260 && rand() < 0.55) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + r + 10)) continue;
    trees.push({ x, y, r, height: 95 + rand() * 120, seed: i });
  }
  return trees;
})();

const along = (count: number, spread: number, from = 0, to = 1): PropSpot[] =>
  Array.from({ length: count }, (_, i) => {
    const t = from + (to - from) * ((i + rand() * 0.8) / count);
    const f = t * (TRAIL.length - 1);
    const k = Math.min(TRAIL.length - 2, Math.floor(f));
    const a = TRAIL[k];
    const b = TRAIL[k + 1];
    const u = f - k;
    const nx = -(b.y - a.y);
    const ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    const side = (rand() * 2 - 1) * spread;
    return {
      x: a.x + (b.x - a.x) * u + nx / len * side,
      y: a.y + (b.y - a.y) * u + ny / len * side,
      yaw: rand() * Math.PI * 2,
      variant: Math.floor(rand() * 4),
    };
  });

const near = (c: Spot, count: number, radius: number): PropSpot[] =>
  Array.from({ length: count }, () => {
    const angle = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * radius;
    return { x: c.x + Math.cos(angle) * d, y: c.y + Math.sin(angle) * d, yaw: rand() * Math.PI * 2, variant: Math.floor(rand() * 4) };
  });

/**
 * Morts des deux camps. variant pair : soldat asante (batakari, pagne
 * indigo) ; impair : soldat du Denkyira (pagne rouille, ceinture de poudre).
 */
export const BODIES: readonly PropSpot[] = [
  ...along(16, 44, 0.08, 0.95),
  ...near(CLEARINGS[2], 9, 140),
  ...near(CLEARINGS[1], 3, 50),
];

/** Lances plantées ou couchées. */
export const SPEARS: readonly PropSpot[] = along(14, 50, 0.05, 0.95);
/** Mousquets jetés (surtout sur la ligne de fusiliers). */
export const MUSKETS: readonly PropSpot[] = [
  ...along(6, 40, 0.15, 0.9),
  ...Array.from({ length: 9 }, (_, i) => ({
    x: 4630 + i * 17 + rand() * 6, y: 610 + i * 9 + rand() * 10, yaw: 0.4 + rand() * 0.8, variant: i % 4,
  })),
];
/** Coupe-coupe et épées afena. */
export const BLADES: readonly PropSpot[] = along(8, 46, 0.1, 0.9);
/** Arcs brisés. */
export const BOWS: readonly PropSpot[] = [...along(4, 40, 0.1, 0.5), { x: 4118, y: 942, yaw: 1.2, variant: 0 }];
/** Plaques d'herbe brûlée (feu de poudre) et terre retournée. */
export const SCORCHES: readonly (PropSpot & { r: number })[] = [
  ...along(12, 40, 0.1, 0.95).map((p) => ({ ...p, r: 12 + rand() * 18 })),
  ...near(CLEARINGS[2], 10, 150).map((p) => ({ ...p, r: 16 + rand() * 22 })),
];
/** Fumées qui montent encore (feux de brousse allumés par la poudre). */
export const SMOKES: readonly Spot[] = [
  { x: 3880, y: 1120 }, { x: 4560, y: 860 }, { x: 4760, y: 600 }, { x: 4900, y: 760 },
  { x: 5310, y: 520 }, { x: 5700, y: 260 }, { x: 5520, y: 230 },
];
/** Tonnelets de poudre éventrés (ligne de fusiliers). */
export const KEGS: readonly PropSpot[] = near({ x: 4730, y: 670 }, 5, 70);
/** Gourdes, sandales, ceintures tombées. */
export const LITTER: readonly PropSpot[] = along(30, 54, 0, 1);

/** Gros obstacles (collision) : tronc couché du réveil, tambours, abri écrasé. */
export const FALLEN_TRUNK = { x: 3498, y: 1290, length: 120, yaw: 0.25, r: 11 };
export const SOLIDS: readonly Circle[] = [
  // Tronc couché : quelques cercles le long de l'axe.
  ...Array.from({ length: 6 }, (_, i) => {
    const t = (i / 5 - 0.5) * FALLEN_TRUNK.length;
    return { x: FALLEN_TRUNK.x + Math.cos(FALLEN_TRUNK.yaw) * t, y: FALLEN_TRUNK.y + Math.sin(FALLEN_TRUNK.yaw) * t, r: FALLEN_TRUNK.r };
  }),
  { x: 5150, y: 430, r: 12 },
  { x: 5172, y: 418, r: 10 },
  { x: 5460, y: 430, r: 26 },
];

/** Guerriers de l'arrière-garde au camp (silhouettes immobiles, autour des feux). */
export const CAMP_WARRIORS: readonly PropSpot[] = [
  { x: 5620, y: 300, yaw: 4.3, variant: 0 }, { x: 5650, y: 330, yaw: 4.0, variant: 1 },
  { x: 5590, y: 280, yaw: 4.7, variant: 2 }, { x: 5680, y: 290, yaw: 4.2, variant: 3 },
  { x: 5700, y: 360, yaw: 3.9, variant: 0 }, { x: 5640, y: 250, yaw: 4.6, variant: 1 },
];
export const CAMP_FIRES: readonly Spot[] = [{ x: 5660, y: 310 }, { x: 5720, y: 250 }];

/**
 * Ambiance : fin d'après-midi enfumée, poudre et feux de brousse sous la
 * canopée. Brouillard plus dense qu'aux actes I–II (il cache aussi le reste
 * du monde, à plus de 1000 unités à l'ouest). [SUPPOSITION] valeurs à régler.
 */
export const PROLOGUE_MOOD = {
  fog: '#6f6a5c', fogDensity: 0.0031, background: '#5f5a4e', hemi: 1.35, sun: 2.0, sunColor: '#ffb47e',
};

/** Centre de la carte (collines lointaines). */
export const PROLOGUE_CENTER = { x: PROLOGUE_AREA.x + PROLOGUE_AREA.w / 2, y: PROLOGUE_AREA.y + PROLOGUE_AREA.h / 2 };
