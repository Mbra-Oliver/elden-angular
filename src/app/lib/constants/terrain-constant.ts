/**
 * VIEWPORT = taille du canvas visible à l'écran.
 * WORLD = taille réelle de l'arène (plus grande que l'écran → la caméra suit
 * le joueur et les bords plongent dans l'obscurité, façon Dark Souls 1).
 */
export const VIEWPORT = {
  WIDTH: 960,
  HEIGHT: 540,
};

// Compression des distances au sol sur l’axe qui s’éloigne de la caméra.
export const GROUND_Y_SCALE = 0.80;

export const WORLD = {
  WIDTH: 2400,
  HEIGHT: 1600,
};

// Compat : anciens écrans qui lisaient TERRAIN_INFO.WIDTH/HEIGHT (= viewport).
export const TERRAIN_INFO = {
  WIDTH: VIEWPORT.WIDTH,
  HEIGHT: VIEWPORT.HEIGHT,
};
