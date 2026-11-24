import { Injectable } from '@angular/core';
import { Rectangle } from '../interfaces/Rectangle';

@Injectable({
  providedIn: 'root',
})
export class CollisionService {
  constructor() {}

  /**
   * Vérifie s'il y a une collision AABB entre deux rectangles.
   */
  checkAABBCollision(r1: Rectangle, r2: Rectangle): boolean {
    return (
      r1.x < r2.x + r2.w && // Le côté gauche de r1 est avant le côté droit de r2
      r1.x + r1.w > r2.x && // Le côté droit de r1 est après le côté gauche de r2
      r1.y < r2.y + r2.h && // Le haut de r1 est avant le bas de r2
      r1.y + r1.h > r2.y // Le bas de r1 est après le haut de r2
    );
  }
}
