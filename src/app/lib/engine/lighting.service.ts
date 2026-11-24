import { Injectable } from '@angular/core';
import { VIEWPORT } from '../constants/terrain-constant';

interface Light {
  x: number; // coords ÉCRAN (déjà transformées par la caméra)
  y: number;
  radius: number;
  intensity: number; // 0 → 1 : à quel point la lumière perce l'obscurité
}

/**
 * Éclairage façon Dark Souls 1 : le monde est plongé dans une obscurité
 * quasi totale, et seules des sources de lumière (torche du joueur, aura du
 * boss) révèlent l'environnement via des halos radiaux doux.
 *
 * Technique : un calque offscreen rempli de noir, dans lequel on "perce" des
 * trous dégradés avec `destination-out`. Le calque est ensuite appliqué sur
 * la scène. Une vignette renforce le confinement sur les bords.
 */
@Injectable({ providedIn: 'root' })
export class LightingService {
  private layer: HTMLCanvasElement | null = null;
  private layerCtx: CanvasRenderingContext2D | null = null;

  private lights: Light[] = [];

  /** Opacité de l'obscurité ambiante (1 = noir total hors lumières). */
  darkness = 0.92;

  private ensureLayer() {
    if (this.layer) return;
    this.layer = document.createElement('canvas');
    this.layer.width = VIEWPORT.WIDTH;
    this.layer.height = VIEWPORT.HEIGHT;
    this.layerCtx = this.layer.getContext('2d');
  }

  /** À appeler en début de frame. */
  begin() {
    this.lights.length = 0;
  }

  /**
   * Ajoute une source lumineuse (coords écran).
   * `flicker` ajoute un léger tremblement de torche.
   */
  addLight(
    x: number,
    y: number,
    radius: number,
    intensity = 1,
    flicker = 0,
  ) {
    const f = flicker > 0 ? 1 + (Math.random() - 0.5) * flicker : 1;
    this.lights.push({ x, y, radius: radius * f, intensity });
  }

  /** Compose l'obscurité + les lumières sur le contexte principal. */
  render(ctx: CanvasRenderingContext2D) {
    this.ensureLayer();
    const lc = this.layerCtx;
    if (!lc || !this.layer) return;

    const w = VIEWPORT.WIDTH;
    const h = VIEWPORT.HEIGHT;

    // 1. Remplir le calque d'obscurité.
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, w, h);
    lc.fillStyle = `rgba(4, 6, 10, ${this.darkness})`;
    lc.fillRect(0, 0, w, h);

    // 2. Percer des trous dégradés pour chaque lumière.
    lc.globalCompositeOperation = 'destination-out';
    for (const light of this.lights) {
      const g = lc.createRadialGradient(
        light.x,
        light.y,
        0,
        light.x,
        light.y,
        light.radius,
      );
      g.addColorStop(0, `rgba(0, 0, 0, ${light.intensity})`);
      g.addColorStop(0.65, `rgba(0, 0, 0, ${light.intensity * 0.5})`);
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      lc.fillStyle = g;
      lc.fillRect(
        light.x - light.radius,
        light.y - light.radius,
        light.radius * 2,
        light.radius * 2,
      );
    }
    lc.globalCompositeOperation = 'source-over';

    // 3. Appliquer le calque d'obscurité sur la scène.
    ctx.drawImage(this.layer, 0, 0);

    // 4. Vignette : assombrit progressivement les bords de l'écran.
    const vg = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.35,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.75,
    );
    vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vg.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }
}
