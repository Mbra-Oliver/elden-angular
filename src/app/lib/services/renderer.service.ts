import { Injectable } from '@angular/core';

/**
 * CE SERVICE s'occupe de la gestion des rendus (UNIQUEMENT)
 *
 * INITIALISER LE CANVAS
 * Fournir des methodes de dessins (Rectangle, textes, cercles...)
 * Gerer les effets visuels (screenShake, particules...)
 */

@Injectable({
  providedIn: 'root',
})
export class RendererService {
  private ctx: CanvasRenderingContext2D | null = null;

  /*
   *DIMENSION du canvas
   */

  private canvaWidth = 0;
  private canvaHeight = 0;

  /*
   * Gerer le tremblement d'écran
   */

  private shakeActive = false;
  private shakeDecay = 0.85; // Vitesse de décroissance pour retourner a l'etat normal
  private shakeIntensity = 0; //Intensité du tremblement

  //Initialiser le service avec CANVA html
  init(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');

    this.canvaWidth = canvas.width;
    this.canvaHeight = canvas.height;

    console.log(`CANVAS INITIALISER A ${this.canvaWidth}x${this.canvaHeight}`);
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

  //======================
  //METHODE DE DESSIN
  //=======================

  //Dans le cas de la boucle supprimer les anciennes images avant de poser la nouvelle pour eviter la superposition.
  clear(color = '#0f0f23') {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvaWidth, this.canvaHeight);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.canvaWidth, this.canvaHeight);
  }

  /*
   *DESSINER UN RECTANGE Plein
   * @param x - Position X en pixel
   * @param y - Position Y en pixel
   * @param width - Largeur en pixel
   * @param height - Hauteur en pixel
   * @param color - Couleur du rectangle
   */

  fillRect(x: number, y: number, h: number, w: number, color: string) {
    if (!this.ctx) return;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  /**
   * DESSINER UN CERCLE PLEIN
   * @param x - Centre X
   * @param y - Centre Y
   * @param radius - Rayon du cercle
   * @param color - Couleur de remplissage
   */
  fillCircle(x: number, y: number, radius: number, color: string) {
    if (!this.ctx) return;
    this.ctx.beginPath();
    // arc(x, y, radius, startAngle, endAngle)
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }

  /**
   * DESSINER UNE BARRE DE STATUT
   * @param x - Position X
   * @param y - Position Y
   * @param w - Largeur totale
   * @param h - Hauteur de la barre
   * @param current - Valeur actuelle (ex: 50)
   * @param max - Valeur max (ex: 100)
   * @param fillColor - Couleur de la jauge
   * @param bgColor - Couleur du fond (défaut noir)
   */
  drawBar(
    x: number,
    y: number,
    w: number,
    h: number,
    current: number,
    max: number,
    fillColor: string,
    bgColor: string = '#222222',
  ) {
    if (!this.ctx) return;

    // 1. Dessiner le fond (barre vide)
    this.fillRect(x, y, h, w, bgColor);

    // 2. Calculer le ratio de remplissage (entre 0 et 1)
    const ratio = Math.max(0, Math.min(current / max, 1));
    const fillWidth = w * ratio;

    // 3. Dessiner la jauge par-dessus
    if (fillWidth > 0) {
      this.fillRect(x, y, h, fillWidth, fillColor);
    }
  }

  drawText(title: string, x: number, y: number, color: string) {
    if (!this.ctx) return;
    this.ctx.font = `10px Arial`;
    this.ctx.fillStyle = color;
    this.ctx.fillText(title, x, y);
  }

  /**
   *  DECLENCHER UN TREMBLEMENT D'ECRAN
   * Utile quand on va frapper l'ennemi pour donner de l'impact.
   *  @param intensity - Intensité du tremblement (ex 8 = leger, 20 = fort)
   */

  shake(intenisity: number) {
    this.shakeIntensity = intenisity;
  }

  applyShake() {
    if (!this.ctx || this.shakeIntensity <= 0) return;

    if (this.shakeIntensity > 0.8) {
      // Calcul d'un décalage aléatoire entre -intensity et +intensity
      const offsetX = (Math.random() * 2 - 1) * this.shakeIntensity;
      const offsetY = (Math.random() * 2 - 1) * this.shakeIntensity;

      //Reduire progressivement l'intensite

      this.shakeIntensity *= this.shakeDecay;

      // 1. On sauvegarde l'état intact du canvas (position 0,0)
      this.ctx.save();

      // 2. On déplace tout le repère de dessin
      this.ctx.translate(offsetX, offsetY);

      this.shakeActive = true;
    } else {
      //Tremblement est terminé

      this.shakeIntensity = 0;
      this.shakeActive = false;
    }
  }

  //Remet le canva a sa positio normale

  resetCanvas() {
    if (!this.ctx) return;
    this.ctx.restore();
    this.shakeActive = true;
  }

  //Dessiner un contour de rectangle

  strokeRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    lineWidth: number,
  ) {
    if (!this.ctx) return;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    this.ctx.strokeRect(x, y, w, h);
  }
}
