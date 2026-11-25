import * as T from 'three';

/**
 * Cinématiques en temps réel : la caméra du jeu glisse le long d'une courbe
 * 3D (Catmull-Rom) en visant un point, pendant que le HUD de combat est masqué.
 * Aucune vidéo : on reste dans la scène, l'enchaînement avec le jeu est
 * instantané et le coût mémoire est quasi nul (quelques Vector3).
 *
 * Coordonnées : x/z = sol du monde 2D (x, y), y = hauteur.
 */
export interface CinematicShot {
  /** Points de passage de la caméra (au moins 2). */
  path: T.Vector3[];
  /** Point visé ; une fonction permet de suivre une cible qui bouge. */
  look: T.Vector3 | ((t: number) => T.Vector3);
  /** Durée (ms). */
  duration: number;
  /** Champ de vision au début et à la fin du plan (degrés). */
  fov?: [number, number];
  /** Fondu de sortie (ms) : la caméra de jeu reprend la main en douceur. */
  blendOut?: number;
  /** Le joueur peut-il passer le plan (touche Échap / Entrée) ? */
  skippable?: boolean;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const BASE_FOV = 54;

export class CinematicCamera {
  private shot: CinematicShot | null = null;
  private curve: T.CatmullRomCurve3 | null = null;
  private elapsed = 0;
  private readonly point = new T.Vector3();
  private readonly look = new T.Vector3();
  /** Pose de la caméra de jeu, mémorisée pour le fondu de sortie. */
  private blending = 0;
  private readonly blendFrom = new T.Vector3();
  private readonly blendLook = new T.Vector3();

  /** Plan en cours (ou en fondu de sortie) : le HUD doit rester masqué. */
  get active() { return this.shot !== null; }

  play(shot: CinematicShot) {
    if (shot.path.length < 2) return;
    this.shot = shot;
    this.curve = new T.CatmullRomCurve3(shot.path, false, 'centripetal');
    this.elapsed = 0;
    this.blending = 0;
  }

  skip() {
    if (this.shot?.skippable) this.elapsed = this.shot.duration;
  }

  stop() {
    this.shot = null;
    this.curve = null;
  }

  /**
   * Place la caméra pour cette image. Retourne true tant que la cinématique
   * pilote seule la caméra ; pendant le fondu de sortie, retourne false et
   * la caméra de jeu calcule sa pose, que `blend()` mélange ensuite.
   */
  drive(camera: T.PerspectiveCamera, dt: number) {
    const shot = this.shot;
    if (!shot || !this.curve) return false;
    this.elapsed += dt * 1000;
    const t = Math.min(1, this.elapsed / shot.duration);
    if (t < 1) {
      const k = easeInOut(t);
      this.curve.getPointAt(k, this.point);
      camera.position.copy(this.point);
      this.look.copy(typeof shot.look === 'function' ? shot.look(k) : shot.look);
      camera.lookAt(this.look);
      const [from, to] = shot.fov ?? [BASE_FOV, BASE_FOV];
      this.setFov(camera, T.MathUtils.lerp(from, to, k));
      this.blendFrom.copy(this.point);
      this.blendLook.copy(this.look);
      return true;
    }
    // Fin du plan : fondu vers la caméra de jeu.
    const out = shot.blendOut ?? 450;
    this.blending += dt * 1000;
    if (this.blending >= out) {
      this.setFov(camera, BASE_FOV);
      this.stop();
    }
    return false;
  }

  /** À appeler après le calcul de la caméra de jeu, pendant le fondu de sortie. */
  blend(camera: T.PerspectiveCamera, gameLook: T.Vector3) {
    const shot = this.shot;
    if (!shot || this.elapsed < shot.duration) return;
    const k = easeInOut(Math.min(1, this.blending / (shot.blendOut ?? 450)));
    camera.position.lerpVectors(this.blendFrom, camera.position, k);
    this.look.lerpVectors(this.blendLook, gameLook, k);
    camera.lookAt(this.look);
    const [, to] = shot.fov ?? [BASE_FOV, BASE_FOV];
    this.setFov(camera, T.MathUtils.lerp(to, BASE_FOV, k));
  }

  private setFov(camera: T.PerspectiveCamera, fov: number) {
    if (Math.abs(camera.fov - fov) < 0.01) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

/** Plans prêts à l'emploi, construits autour d'un combattant. */
export const SHOTS = {
  /**
   * Entrée du boss : plan bas sur ses pieds dans la brume, lente poussée,
   * puis la caméra se relève jusqu'à son visage (FOV 52 → 54) avant de
   * rendre la main au jeu.
   */
  bossIntro(boss: { x: number; y: number }, from: { x: number; y: number }, duration: number): CinematicShot {
    let ux = from.x - boss.x;
    let uy = from.y - boss.y;
    const len = Math.hypot(ux, uy);
    if (len < 1) { ux = -1; uy = 0; } else { ux /= len; uy /= len; }
    const sx = -uy;
    const sy = ux;
    const ease = (t: number) => easeInOut(Math.max(0, Math.min(1, t)));
    const path = [0, 0.2, 0.4, 0.6, 0.8, 1].map((k) => {
      const push = ease(k / 0.45);
      const rise = ease((k - 0.4) / 0.45);
      const distance = T.MathUtils.lerp(92, 58, push) - rise * 6;
      const orbit = T.MathUtils.lerp(16, 26, k);
      return new T.Vector3(boss.x + ux * distance + sx * orbit, T.MathUtils.lerp(5, 24, rise),
        boss.y + uy * distance + sy * orbit);
    });
    const target = new T.Vector3();
    const look = (k: number) => target.set(boss.x, T.MathUtils.lerp(7, 26, ease((k - 0.4) / 0.45)), boss.y);
    return { path, look, duration, fov: [52, 54], blendOut: 450 };
  },

  /**
   * Changement de phase : demi-tour lent autour du boss, de bas en haut,
   * pendant qu'il est intouchable (durée de l'état 'shift').
   */
  phaseShift(boss: { x: number; y: number }, from: { x: number; y: number }, duration: number,
    look: (t: number) => T.Vector3): CinematicShot {
    const base = Math.atan2(from.y - boss.y, from.x - boss.x);
    const path = [0, 0.35, 0.7, 1].map((k) => {
      const a = base + (k - 0.5) * 1.6;
      const r = 70 - k * 12;
      return new T.Vector3(boss.x + Math.cos(a) * r, 10 + k * 26, boss.y + Math.sin(a) * r);
    });
    return { path, look, duration, fov: [50, 54], blendOut: 380 };
  },

  /** Boss vaincu : la caméra recule et monte, le boss au centre. */
  defeat(boss: { x: number; y: number }, from: { x: number; y: number }, look: (t: number) => T.Vector3): CinematicShot {
    const dx = from.x - boss.x;
    const dy = from.y - boss.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const path = [
      new T.Vector3(boss.x + ux * 40 - uy * 25, 14, boss.y + uy * 40 + ux * 25),
      new T.Vector3(boss.x + ux * 70 - uy * 40, 34, boss.y + uy * 70 + ux * 40),
      new T.Vector3(boss.x + ux * 110 - uy * 30, 70, boss.y + uy * 110 + ux * 30),
    ];
    return { path, look, duration: 2600, fov: [46, 54], blendOut: 500, skippable: true };
  },
};

type FlatPoint = { x: number; y: number };

function direction(from: FlatPoint, to: FlatPoint) {
  let ux = to.x - from.x;
  let uy = to.y - from.y;
  const length = Math.hypot(ux, uy);
  if (length < 1) return { ux: 1, uy: 0, sx: 0, sy: 1 };
  ux /= length;
  uy /= length;
  return { ux, uy, sx: -uy, sy: ux };
}

const smooth = (t: number) => easeInOut(Math.max(0, Math.min(1, t)));

/** Plans du Chapitre 1, tous construits dans la scène 3D (aucune vidéo). */
export const STORY_SHOTS = {
  opening(sword: FlatPoint, player: FlatPoint, duration: number): CinematicShot {
    const { ux, uy, sx, sy } = direction(sword, player);
    const path = [
      new T.Vector3(sword.x + sx * 15, 4, sword.y + sy * 15),
      new T.Vector3(sword.x + ux * 58 - sx * 8, 3, sword.y + uy * 58 - sy * 8),
      new T.Vector3(T.MathUtils.lerp(sword.x, player.x, 0.55) + sx * 26, 5,
        T.MathUtils.lerp(sword.y, player.y, 0.55) + sy * 26),
      new T.Vector3(player.x + ux * 92 + sx * 12, 9, player.y + uy * 92 + sy * 12),
      new T.Vector3(player.x + ux * 48 - sx * 22, 19, player.y + uy * 48 - sy * 22),
    ];
    const target = new T.Vector3();
    return {
      path, duration, fov: [62, 48], blendOut: 600,
      look: (k) => k < 0.42
        ? target.set(sword.x, 3, sword.y)
        : target.set(player.x, 14, player.y),
    };
  },

  vista(player: FlatPoint, focus: FlatPoint, duration: number): CinematicShot {
    const { ux, uy, sx, sy } = direction(player, focus);
    const path = [
      new T.Vector3(player.x - ux * 58 + sx * 24, 28, player.y - uy * 58 + sy * 24),
      new T.Vector3(player.x - ux * 80 + sx * 52, 64, player.y - uy * 80 + sy * 52),
      new T.Vector3(player.x - ux * 96 + sx * 70, 84, player.y - uy * 96 + sy * 70),
    ];
    const target = new T.Vector3();
    return {
      path, duration, fov: [52, 54], blendOut: 900,
      look: (k) => {
        const t = smooth((k - 0.15) / 0.7);
        return target.set(T.MathUtils.lerp(player.x, focus.x, t), 10,
          T.MathUtils.lerp(player.y, focus.y, t));
      },
    };
  },

  drummer(player: FlatPoint, wounded: FlatPoint, duration: number): CinematicShot {
    const { ux, uy, sx, sy } = direction(player, wounded);
    const path = [
      new T.Vector3(player.x - ux * 34 + sx * 22, 21, player.y - uy * 34 + sy * 22),
      new T.Vector3(wounded.x - ux * 46 + sx * 30, 15, wounded.y - uy * 46 + sy * 30),
      new T.Vector3(wounded.x - ux * 30 + sx * 16, 11, wounded.y - uy * 30 + sy * 16),
      new T.Vector3(player.x + ux * 20 + sx * 15, 17, player.y + uy * 20 + sy * 15),
    ];
    const target = new T.Vector3();
    return {
      path, duration, fov: [42, 54], blendOut: 480,
      look: (k) => k < 0.82
        ? target.set(wounded.x, 12, wounded.y)
        : target.set(wounded.x, 6, wounded.y),
    };
  },

  baduEntrance(boss: FlatPoint, player: FlatPoint, duration: number): CinematicShot {
    const { ux, uy, sx, sy } = direction(player, boss);
    const path = [
      new T.Vector3(player.x + ux * 74 + sx * 9, 3, player.y + uy * 74 + sy * 9),
      new T.Vector3(boss.x - ux * 108 + sx * 26, 5, boss.y - uy * 108 + sy * 26),
      new T.Vector3(boss.x + ux * 52 + sx * 12, 12, boss.y + uy * 52 + sy * 12),
      new T.Vector3(boss.x + ux * 86 - sx * 10, 34, boss.y + uy * 86 - sy * 10),
      new T.Vector3(player.x - ux * 62 + sx * 18, 36, player.y - uy * 62 + sy * 18),
    ];
    const target = new T.Vector3();
    return {
      path, duration, fov: [52, 54], blendOut: 520,
      look: (k) => {
        const t = smooth(k);
        return target.set(boss.x - ux * T.MathUtils.lerp(0, 8, t),
          T.MathUtils.lerp(6, 24, t),
          boss.y - uy * T.MathUtils.lerp(0, 8, t));
      },
    };
  },

  baduPhase(boss: FlatPoint, player: FlatPoint, duration: number): CinematicShot {
    const { ux, uy, sx, sy } = direction(player, boss);
    const path = [
      new T.Vector3(boss.x + ux * 54 + sx * 28, 7, boss.y + uy * 54 + sy * 28),
      new T.Vector3(boss.x + sx * 58, 15, boss.y + sy * 58),
      new T.Vector3(boss.x - ux * 46 + sx * 20, 27, boss.y - uy * 46 + sy * 20),
    ];
    const target = new T.Vector3();
    return { path, look: () => target.set(boss.x, 21, boss.y), duration, fov: [50, 54], blendOut: 260 };
  },

  glance(player: FlatPoint, focus: FlatPoint, duration: number): CinematicShot {
    const { ux, uy, sx, sy } = direction(player, focus);
    const path = [
      new T.Vector3(player.x - ux * 38 + sx * 20, 24, player.y - uy * 38 + sy * 20),
      new T.Vector3(T.MathUtils.lerp(player.x, focus.x, 0.62) + sx * 14, 15,
        T.MathUtils.lerp(player.y, focus.y, 0.62) + sy * 14),
      new T.Vector3(focus.x + ux * 42 + sx * 8, 12, focus.y + uy * 42 + sy * 8),
    ];
    const target = new T.Vector3();
    return { path, look: () => target.set(focus.x, 11, focus.y), duration, fov: [48, 54], blendOut: 260 };
  },

  baduFall(boss: FlatPoint, player: FlatPoint, duration: number): CinematicShot {
    const { ux, uy, sx, sy } = direction(player, boss);
    const path = [
      new T.Vector3(player.x - ux * 20 + sx * 28, 18, player.y - uy * 20 + sy * 28),
      new T.Vector3(boss.x + ux * 66 + sx * 34, 26, boss.y + uy * 66 + sy * 34),
      new T.Vector3(boss.x + ux * 102, 62, boss.y + uy * 102),
    ];
    const target = new T.Vector3();
    return {
      path, duration, fov: [46, 54], blendOut: 600,
      look: (k) => {
        const t = smooth((k - 0.5) / 0.5);
        return target.set(boss.x - ux * T.MathUtils.lerp(0, 44, t),
          T.MathUtils.lerp(10, 26, t),
          boss.y - uy * T.MathUtils.lerp(0, 44, t));
      },
    };
  },
};
