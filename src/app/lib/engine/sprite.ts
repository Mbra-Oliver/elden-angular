/**
 * Système de sprite-sheets et d'animations (logique pure, sans Angular).
 *
 * Une sprite-sheet est une grille régulière de frames (frameW × frameH).
 * Une AnimationClip décrit une séquence de frames sur une ligne donnée,
 * jouée à un fps fixe, en boucle ou non. L'Animator avance le temps et
 * fournit le rectangle source (sx, sy, sw, sh) à passer à drawImage.
 */

export interface SpriteSheetConfig {
  /** Clé de l'image dans l'AssetLoader. */
  imageKey: string;
  /** Dimensions d'une frame en pixels. */
  frameW: number;
  frameH: number;
}

export interface AnimationClip {
  /** Ligne de la sheet (0-based) sur laquelle se trouve l'animation. */
  row: number;
  /** Nombre de frames de l'animation (colonnes consécutives depuis 0). */
  frames: number;
  /** Vitesse de lecture (images par seconde). */
  fps: number;
  /** Boucle ? Sinon se fige sur la dernière frame. */
  loop: boolean;
}

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export class Animator {
  private clips: Record<string, AnimationClip>;
  private current: string;
  private elapsed = 0;
  private frameIndex = 0;

  constructor(
    readonly sheet: SpriteSheetConfig,
    clips: Record<string, AnimationClip>,
    initial: string,
  ) {
    this.clips = clips;
    this.current = initial;
  }

  /** Change d'animation. Ne réinitialise pas si déjà en cours. */
  play(name: string) {
    if (this.current === name || !this.clips[name]) return;
    this.current = name;
    this.elapsed = 0;
    this.frameIndex = 0;
  }

  /** Avance l'animation. dt en secondes. */
  update(dt: number) {
    const clip = this.clips[this.current];
    if (!clip || clip.frames <= 1) return;

    this.elapsed += dt;
    const frameDuration = 1 / clip.fps;

    while (this.elapsed >= frameDuration) {
      this.elapsed -= frameDuration;
      this.frameIndex++;

      if (this.frameIndex >= clip.frames) {
        this.frameIndex = clip.loop ? 0 : clip.frames - 1;
      }
    }
  }

  /** Rectangle source de la frame courante dans la sheet. */
  sourceRect(): SourceRect {
    const clip = this.clips[this.current] ?? { row: 0 };
    return {
      sx: this.frameIndex * this.sheet.frameW,
      sy: clip.row * this.sheet.frameH,
      sw: this.sheet.frameW,
      sh: this.sheet.frameH,
    };
  }

  get currentClip(): string {
    return this.current;
  }
}
