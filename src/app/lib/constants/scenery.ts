import { WORLD } from './terrain-constant';

export const HUTS = [[732, 640, 53], [909, 564, 48], [980, 650, 40],
  [1178, 507, 53], [1258, 618, 46], [886, 950, 48], [1168, 985, 51]] as const;

export function sceneryRandom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const random = sceneryRandom(35187);
export const TREES = Array.from({ length: 330 }, (_, index) => ({
  x: random() * WORLD.WIDTH,
  y: random() * WORLD.HEIGHT,
  radius: 13 + random() * 23,
  seed: index + 713,
})).filter(({ x, y }) =>
  !(x > 595 && x < 1720 && y > 365 && y < 1130) &&
  !(x > 215 && x < 1000 && y > 100 && y < 540));

export const ROCKS = [[1390, 673], [1526, 688], [1556, 852], [1388, 902]] as const;

// Bandes d’eau avec ouvertures au gué et au tablier.
// Les bords suivent les illustrations dans les zones accessibles.
export const WATER = [
  { x: 261, y: 0, w: 63, h: 222 },
  { x: 275, y: 222, w: 70, h: 100 },
  { x: 276, y: 379, w: 71, h: 121 },
  { x: 232, y: 500, w: 74, h: 153 },
  { x: 1291, y: 550, w: 52, h: 210 },
  { x: 1291, y: 824, w: 52, h: 218 },
];

export const FORD_SURFACE = { x: 269, y: 322, w: 82, h: 57 };
