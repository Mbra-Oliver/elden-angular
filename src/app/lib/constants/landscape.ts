import { FORD_DUEL, SLUICE_DUEL } from '../engine/duel-fog';
import { HUTS, sceneryRandom, TREES, WATER } from './scenery';
import { WORLD } from './terrain-constant';
import { CROSSING, BATTLE, CLEARING, GATE, VILLAGE_STOPS } from './village';
import { FOYERS } from './souls-world';
import { inRect, SLICE_CLEARINGS } from '../slice/slice-map';

/**
 * Direction artistique commune : une seule palette pour tout ce qui est
 * ajouté au décor (sol, ruines, repères, ciel). Les couleurs reprennent
 * celles déjà posées dans world-3d.ts (banco, chaume, latérite, savane) pour
 * que les éléments neufs et anciens réagissent pareil à la lumière.
 * Matériaux : MeshStandardMaterial, flatShading, roughness ≥ 0.9, pas de
 * métal, sauf l'eau. Échelle : 1 unité ≈ 6 cm (Ama ≈ 30 unités de haut).
 */
export const PALETTE = {
  laterite: '#9a5a3c',
  lateriteDark: '#6e3f2b',
  banco: '#a4775a',
  thatch: '#ae8654',
  stone: '#6c6650',
  stoneLight: '#8a8266',
  savanna: ['#8e8c4f', '#77804a', '#a39a5a', '#68733f'],
  wood: '#76573d',
  ash: '#3b3430',
  ember: '#ff8a3c',
  danger: '#e8572e',
  dangerFlash: '#fff0c8',
  outline: '#1d1511',
  // Ciel de fin d'après-midi, brume d'harmattan.
  zenith: '#6e8095',
  skyMid: '#b9a98e',
  horizon: '#c4a77f',
  fog: '#b39a78',
  sun: '#ffd08f',
  hemiSky: '#ffe0b6',
  hemiGround: '#4b585a',
};

/** Hauteur d'Ama, pour régler le grayboxing (lignes de vue, hauteurs de mur). */
export const HERO_HEIGHT = 30;

// ─── Zones à garder libres (chemins, eau, cases, arènes, PNJ) ───────────────

type Pt = [number, number];
const quad = (a: Pt, c: Pt, b: Pt, n = 24): Pt[] => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n;
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
});

/** Tracés des chemins peints dans environment.service.ts (centre + demi-largeur). */
const PATHS: { points: Pt[]; half: number }[] = [
  { points: quad([CROSSING.x - 72, CROSSING.y], [462, 379], [BATTLE.x, BATTLE.y]), half: 20 },
  { points: quad([630, 1050], [735, 960], [820, 780]), half: 32 },
  { points: quad([820, 780], [965, 720], [1110, 580]), half: 32 },
  { points: quad([820, 780], [1130, 931], [CLEARING.x, CLEARING.y]), half: 32 },
];

const KEEP_CLEAR: { x: number; y: number; r: number }[] = [
  ...[...VILLAGE_STOPS, GATE, CROSSING].map(({ x, y }) => ({ x: x + 12, y: y - 16, r: 22 })),
  ...Object.values(FOYERS).map(({ x, y }) => ({ x, y, r: 26 })),
];

export function onPath(x: number, y: number, margin = 0) {
  return PATHS.some(({ points, half }) => points.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < (half + margin) ** 2));
}

/** Vrai si un détail de sol peut être posé ici sans gêner le jeu ni traverser un objet. */
export function groundFree(x: number, y: number, margin: number) {
  if (x < 4 || y < 4 || x > WORLD.WIDTH - 4 || y > WORLD.HEIGHT - 4) return false;
  if ([FORD_DUEL, SLUICE_DUEL].some((a) => (x - a.x) ** 2 + (y - a.y) ** 2 < (a.radius + margin) ** 2)) return false;
  if (HUTS.some(([hx, hy, r]) => (x - hx) ** 2 + (y - hy - 5) ** 2 < (r + margin) ** 2)) return false;
  if (WATER.some((w) => x > w.x - margin && x < w.x + w.w + margin && y > w.y - margin && y < w.y + w.h + margin)) return false;
  if (KEEP_CLEAR.some((k) => (x - k.x) ** 2 + (y - k.y) ** 2 < (k.r + margin) ** 2)) return false;
  // La plaine et le donjon de la tranche ont leur propre habillage.
  if (SLICE_CLEARINGS.some((rect) => inRect(x, y, rect, margin))) return false;
  return true;
}

const clearOfTrees = (x: number, y: number, margin: number) =>
  !TREES.some((tree) => (x - tree.x) ** 2 + (y - tree.y) ** 2 < (tree.radius * 0.7 + margin) ** 2);

// ─── Ruines : un hameau abandonné dans chaque recoin de la carte ───────────

export interface RuinBlock {
  x: number; y: number;
  /** Longueur, épaisseur, hauteur (unités monde) et rotation au sol. */
  length: number; depth: number; height: number; rot: number;
  fallen: boolean;
}

/**
 * [SUPPOSITION] Vestiges de murs de banco et de latérite d'un hameau
 * abandonné pendant les guerres du siècle : invention plausible, pas un lieu
 * documenté. Les murs encore debout bloquent (collision), les blocs tombés non.
 */
const RUIN_SITES: { x: number; y: number; size: number }[] = [
  { x: 470, y: 1190, size: 1 },
  { x: 160, y: 1000, size: 0.75 },
  { x: 1460, y: 190, size: 0.95 },
  { x: 300, y: 1460, size: 0.85 },
  { x: 2010, y: 130, size: 0.8 },
];

export const RUINS: RuinBlock[] = (() => {
  const random = sceneryRandom(5527);
  const blocks: RuinBlock[] = [];
  for (const site of RUIN_SITES) {
    // Plan rectangulaire d'une ancienne cour : quatre côtés, des brèches.
    const half = 34 * site.size;
    const turn = random() * Math.PI;
    for (let side = 0; side < 4; side++) {
      const angle = turn + side * Math.PI / 2;
      for (let piece = -1; piece <= 1; piece++) {
        if (random() < 0.34) continue; // brèche
        const along = piece * half * 0.66;
        const nx = Math.cos(angle);
        const ny = Math.sin(angle);
        const x = site.x + nx * half - ny * along;
        const y = site.y + ny * half + nx * along;
        const fallen = random() < 0.3;
        if (!groundFree(x, y, 14) || !clearOfTrees(x, y, 10)) continue;
        blocks.push({
          x: fallen ? x + nx * 9 : x, y: fallen ? y + ny * 9 : y,
          length: half * (0.5 + random() * 0.18), depth: 5.5,
          height: fallen ? 4 : 9 + random() * 15 * site.size,
          rot: angle + Math.PI / 2 + (fallen ? (random() - 0.5) * 0.9 : 0),
          fallen,
        });
      }
    }
  }
  return blocks;
})();

const STANDING = RUINS.filter((block) => !block.fallen);

/** Collision des murs debout : rectangle orienté, élargi du rayon du marcheur. */
export function ruinBlocks(x: number, y: number, radius: number) {
  for (const block of STANDING) {
    const dx = x - block.x;
    const dy = y - block.y;
    if (dx * dx + dy * dy > (block.length / 2 + radius + 6) ** 2) continue;
    const c = Math.cos(block.rot);
    const s = Math.sin(block.rot);
    const along = Math.abs(dx * c + dy * s);
    const across = Math.abs(-dx * s + dy * c);
    if (along < block.length / 2 + radius && across < block.depth / 2 + radius) return true;
  }
  return false;
}

// ─── Repères monumentaux, hors de la carte jouable ─────────────────────────

/**
 * Deux silhouettes lointaines pour s'orienter, au-delà des bords (donc sans
 * collision), en plus du fromager mort de la digue posé par la tranche :
 * - au sud-est, un dôme de granite qui sort de la savane (inselberg) ;
 * - au sud-ouest, la fumée de Kumasi incendiée en 1874 (Acte II).
 */
export const LANDMARKS = {
  dome: { x: 2650, y: 1480, radius: 220, height: 300 },
  smoke: { x: -140, y: 1260, height: 700 },
};
