import { inject, Injectable } from '@angular/core';
import { PLAYER_CONFIG } from '../constants/player.config-constant';
import { InputService } from '../services/input.service';
import { RendererService } from '../services/renderer.service';
import { PlayerStore } from './player/player.store';

@Injectable({
  providedIn: 'root',
})
export class PlayerEntity {
  store = inject(PlayerStore);
  input = inject(InputService);
  private renderer = inject(RendererService);

  //Creer une methode UPDATE qui sera appelé a chaque frame (60 fois par seconde)

  /**
   * @param deltaTime - Temps écoulé depuis la derniere frame (en secondes)
   */

  update(deltaTime: number) {
    const data = this.store.getData();

    //Si le joueur est mort on ne fait rien.

    if (data.state === 'dead') return;

    //Pour le moment on va juste rester sur idle, moving

    this.handleMovement(deltaTime);
  }

  private handleMovement(deltaTime: number) {
    const data = this.store.getData();

    //Lire les inputs sur les directions. dx -> directionX ; dy->directionY

    const dx = (this.input.right() ? 1 : 0) - (this.input.left() ? 1 : 0);
    const dy = (this.input.down() ? 1 : 0) - (this.input.up() ? 1 : 0);

    //Probleme sur les diagonales a gerer.
    //Si on appuie sur Haut + Droite: dx = 1 et dy = -1
    //Commet sera le calcul de la vitesse ->

    // 2. Calculer la longueur du vecteur (Magnitude)
    // Formule : racine carrée de (x² + y²)

    const length = Math.sqrt(dx * dx + dy * dy);
    const normX = length > 0 ? dx / length : 0;
    const normY = length > 0 ? dy / length : 0;

    const speed = PLAYER_CONFIG.speed;

    //Calculer la nouvelle position

    const newX = data.x + normX * speed * deltaTime;
    const newY = data.y + normY * speed * deltaTime;

    //Mettre a jour la position
    const changes: Partial<typeof data> = {
      x: newX,
      y: newY,
      vx: normX * speed,
      vy: normY * speed,
      state: length > 0 ? 'moving' : 'idle',
    };

    //Mettre a jour la direction du regard
    if (length > 0) {
      changes.facingX = dx;
      changes.facingY = dy;
    }

    this.store.update(changes);
  }

  //Empecher le joueur de sortir du terrain  en fonction de la limite du canevas

  private clampPosition() {
    const data = this.store.getData();
    const size = PLAYER_CONFIG.size;

    //Les limites du cancas.

    const maxX = this.renderer.width - size;
    const maxY = this.renderer.height - size;

    //Limiter x etre 0 et maxX
    const clampedX = Math.max(0, Math.min(maxX, data.x));
    const clampedY = Math.max(0, Math.min(maxY, data.y));

    //Mettre a jour la position que si on detecte qu'ellle a changer.

    if (clampedX !== data.x || clampedY !== data.y) {
      this.store.update({
        x: clampedX,
        y: clampedY,
      });
    }
  }

  render() {
    const data = this.store.getData();
    const size = PLAYER_CONFIG.size;

    let color = '#4ecdc4';

    if (data.state === 'moving') {
      color = '#5be6d4';
    }
    //Dessiner le corps du joueur (Un carré)

    this.renderer.fillRect(data.x, data.y, size, size, color);

    //Dessiner un indicateur de direction

    const indicatorSize = 6;
    const centerX = data.x + size / 2;
    const centerY = data.y + size / 2;

    //Normaliser la direction du regard avec Math.sqrt

    const fLen = Math.sqrt(data.facingX ** 2 + data.facingY ** 2);

    const normFx = fLen > 0 ? data.facingX / fLen : 1;
    const normFy = fLen > 0 ? data.facingY / fLen : 0;

    //Position de l'indicateur (devant le joueur)

    const indX = centerX + normFx * (size / 2 + 4) - indicatorSize / 2;
    const indY = centerY + normFy * (size / 2 + 4) - indicatorSize / 2;

    this.renderer.fillRect(indX, indY, indicatorSize, indicatorSize, '#ffffff');

    //Indicateur de debug

    this.renderer.drawText(
      data.state.toUpperCase(),
      data.x,
      data.y - 10,
      '#88888',
    );
  }
}
