import { AnimationClip, SpriteSheetConfig } from '../engine/sprite';

/** Illustrations livrées avec le jeu. Les feuilles d’animation restent optionnelles. */
export const SPRITE_MANIFEST: Record<string, string> = {
  ama: 'assets/ama.png',
  kwadwo: 'assets/kwadwo.png',
  veille: 'assets/la-veille.png',
  amaPoses: 'assets/ama-poses.png',
  kwadwoPoses: 'assets/kwadwo-poses.png',
  veillePoses: 'assets/veille-poses.png',
  soil: 'assets/terre-peinte.jpg',
  ford: 'assets/gue-peint.jpg',
  basin: 'assets/retenue-peinte.jpg',
};

// ---------------------------------------------------------------- PLAYER
export const PLAYER_SHEET: SpriteSheetConfig = {
  imageKey: 'player',
  frameW: 64,
  frameH: 64,
};

export const PLAYER_CLIPS: Record<string, AnimationClip> = {
  idle: { row: 0, frames: 4, fps: 6, loop: true },
  walk: { row: 1, frames: 6, fps: 10, loop: true },
  attack: { row: 2, frames: 5, fps: 14, loop: false },
  roll: { row: 3, frames: 5, fps: 14, loop: false },
  hurt: { row: 4, frames: 2, fps: 8, loop: false },
  exhausted: { row: 5, frames: 2, fps: 4, loop: true },
  dead: { row: 6, frames: 4, fps: 6, loop: false },
};

// ------------------------------------------------------------------ BOSS
export const BOSS_SHEET: SpriteSheetConfig = {
  imageKey: 'boss',
  frameW: 96,
  frameH: 96,
};

export const BOSS_CLIPS: Record<string, AnimationClip> = {
  idle: { row: 0, frames: 4, fps: 5, loop: true },
  chase: { row: 1, frames: 6, fps: 9, loop: true },
  windup: { row: 2, frames: 4, fps: 8, loop: false },
  attacking: { row: 3, frames: 4, fps: 12, loop: false },
  hurt: { row: 4, frames: 2, fps: 8, loop: false },
  dead: { row: 5, frames: 5, fps: 6, loop: false },
};

/** Mappe l'état FSM du joueur vers un clip d'animation. */
export function playerStateToClip(
  state: string,
  attackType: string,
): string {
  switch (state) {
    case 'moving':
      return 'walk';
    case 'attacking':
      return 'attack';
    case 'rolling':
      return 'roll';
    case 'hurt':
      return 'hurt';
    case 'exhausted':
      return 'exhausted';
    case 'dead':
      return 'dead';
    default:
      return 'idle';
  }
}

/** Mappe l'état FSM du boss vers un clip d'animation. */
export function bossStateToClip(state: string): string {
  if (BOSS_CLIPS[state]) return state;
  if (state === 'recover') return 'idle';
  return 'idle';
}
