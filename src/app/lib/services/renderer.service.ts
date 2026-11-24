import { GROUND_Y_SCALE } from '../constants/terrain-constant';
import { Injectable } from '@angular/core';
import { SourceRect } from '../engine/sprite';

/**
 * Service de rendu bas niveau.
 *
 * - Initialise le canvas.
 * - Fournit un repère MONDE (beginWorld/endWorld) qui applique la caméra et le
 *   screen-shake, et un repère ÉCRAN (par défaut) pour l'UI.
 * - Méthodes de dessin : sprites (drawImage), formes, barres, texte.
 */
@Injectable({ providedIn: 'root' })
export class RendererService {
  private ctx: CanvasRenderingContext2D | null = null;
  private canvaWidth = 0;
  private canvaHeight = 0;
  private focusShade?: CanvasGradient;

  // Screen shake
  private shakeIntensity = 0;
  private shakeDecay = 0.86;
  private shakeX = 0;
  private shakeY = 0;

  init(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    this.canvaWidth = canvas.width;
    this.canvaHeight = canvas.height;
    this.focusShade = undefined;
    if (this.ctx) this.ctx.imageSmoothingEnabled = true;
  }

  get width() {
    return this.canvaWidth;
  }
  get height() {
    return this.canvaHeight;
  }
  get context(): CanvasRenderingContext2D | null {
    return this.ctx;
  }

  // ====================================================================
  // FRAME / CAMÉRA / SHAKE
  // ====================================================================

  /** Efface l'écran et peint le fond. À appeler en début de frame. */
  clear(color: string | null = '#04060a') {
    if (!this.ctx) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvaWidth, this.canvaHeight);
    if (color) {
      this.ctx.fillStyle = color;
      this.ctx.fillRect(0, 0, this.canvaWidth, this.canvaHeight);
    }
  }

  /** Décroît le shake d'une frame. À appeler une fois par frame. */
  tickShake() {
    if (this.shakeIntensity > 0.4) {
      this.shakeX = (Math.random() * 2 - 1) * this.shakeIntensity;
      this.shakeY = (Math.random() * 2 - 1) * this.shakeIntensity;
      this.shakeIntensity *= this.shakeDecay;
    } else {
      this.shakeIntensity = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  /** Entre dans le repère MONDE (caméra + shake appliqués). */
  beginWorld(camX: number, camY: number, zoom = 1) {
    if (!this.ctx) return;
    this.ctx.save();
    this.ctx.translate(this.shakeX, this.shakeY);
    this.ctx.scale(zoom, zoom * GROUND_Y_SCALE);
    this.ctx.translate(-camX, -camY);
  }

  shadeCombatEdges(strength: number) {
    if (!this.ctx || strength < 0.01) return;
    if (!this.focusShade) {
      const x = this.width / 2;
      const y = this.height / 2;
      this.focusShade = this.ctx.createRadialGradient(x, y, y * 0.85, x, y, Math.hypot(x, y));
      this.focusShade.addColorStop(0, 'transparent');
      this.focusShade.addColorStop(1, '#17100cca');
    }
    this.ctx.save();
    this.ctx.globalAlpha = Math.min(1, strength);
    this.ctx.fillStyle = this.focusShade;
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.ctx.restore();
  }

  /** Sort du repère MONDE → retour au repère ÉCRAN. */
  endWorld() {
    if (!this.ctx) return;
    this.ctx.restore();
  }

  shake(intensity: number) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
  }

  // ====================================================================
  // SPRITES
  // ====================================================================

  /** Dessine une frame de sprite-sheet. flipX inverse horizontalement. */
  drawSprite(
    img: HTMLImageElement,
    src: SourceRect,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    flipX = false,
  ) {
    if (!this.ctx) return;
    if (flipX) {
      this.ctx.save();
      this.ctx.translate(dx + dw, dy);
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(img, src.sx, src.sy, src.sw, src.sh, 0, 0, dw, dh);
      this.ctx.restore();
    } else {
      this.ctx.drawImage(img, src.sx, src.sy, src.sw, src.sh, dx, dy, dw, dh);
    }
  }

  // ====================================================================
  // FORMES
  // ====================================================================

  fillRect(x: number, y: number, w: number, h: number, color: string) {
    if (!this.ctx) return;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  fillCircle(x: number, y: number, radius: number, color: string) {
    if (!this.ctx) return;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }

  strokeRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    lineWidth = 1,
  ) {
    if (!this.ctx) return;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    this.ctx.strokeRect(x, y, w, h);
  }

  /** Ellipse douce, utile pour une ombre portée au sol. */
  fillEllipse(x: number, y: number, rx: number, ry: number, color: string) {
    if (!this.ctx) return;
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }

  /**
   * Coup de lame balayé : un arc lumineux qui pivote autour de (cx, cy) dans
   * la direction `facing`, en fonction de `progress` (0 → 1). Donne une vraie
   * sensation d'attaque même sans sprite.
   */
  slash(
    cx: number,
    cy: number,
    facing: number,
    reach: number,
    progress: number,
    color: string,
    spread = Math.PI * 0.85,
  ) {
    const ctx = this.ctx;
    if (!ctx) return;
    const tip = facing - spread / 2 + spread * progress;
    const length = Math.min(spread * 0.48, spread * progress);
    if (length <= 0) return;
    const tail = tip - length;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tip);
    const fade = ctx.createLinearGradient(0, -reach * 0.74, reach, 0);
    fade.addColorStop(0, '#f7dbad00');
    fade.addColorStop(0.48, color);
    fade.addColorStop(1, '#fff1cea6');
    ctx.fillStyle = fade;
    ctx.globalAlpha = Math.sin(Math.PI * progress) * 0.72;
    ctx.beginPath();
    ctx.arc(0, 0, reach, tail - tip, 0);
    ctx.quadraticCurveTo(reach * 0.8, -reach * 0.06, reach * 0.75, -reach * 0.16);
    ctx.quadraticCurveTo(reach * 0.67, -reach * 0.31, Math.cos(length) * reach, -Math.sin(length) * reach);
    ctx.fill();

    ctx.restore();
  }

  /** Dessine un rectangle pivoté autour de son centre (roulade, etc.). */
  fillRectRotated(
    cx: number,
    cy: number,
    w: number,
    h: number,
    angle: number,
    color: string,
  ) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }

  // ====================================================================
  // UI (repère ÉCRAN)
  // ====================================================================

  drawBar(
    x: number,
    y: number,
    w: number,
    h: number,
    current: number,
    max: number,
    fillColor: string,
    bgColor = '#161616',
  ) {
    if (!this.ctx) return;
    this.fillRect(x, y, w, h, bgColor);
    const ratio = Math.max(0, Math.min(current / max, 1));
    const fillWidth = w * ratio;
    if (fillWidth > 0) this.fillRect(x, y, fillWidth, h, fillColor);
  }

  drawText(
    text: string,
    x: number,
    y: number,
    color: string,
    options: {
      size?: number;
      align?: CanvasTextAlign;
      font?: string;
      shadow?: boolean;
    } = {},
  ) {
    if (!this.ctx) return;
    const { size = 12, align = 'left', font = 'Arial', shadow = false } = options;
    this.ctx.font = `${size}px ${font}`;
    this.ctx.textAlign = align;
    if (shadow) {
      this.ctx.fillStyle = 'rgba(0,0,0,0.8)';
      this.ctx.fillText(text, x + 1, y + 1);
    }
    this.ctx.fillStyle = color;
    this.ctx.fillText(text, x, y);
    this.ctx.textAlign = 'left';
  }
}
