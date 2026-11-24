import { Injectable } from '@angular/core';
import { GROUND_Y_SCALE, VIEWPORT, WORLD } from '../constants/terrain-constant';

export interface CombatShot {
  x: number;
  y: number;
  zoom: number;
}

@Injectable({ providedIn: 'root' })
export class CameraService {
  private _x = 0;
  private _y = 0;
  private _zoom = 1;
  private leadX = 0;
  private leadY = 0;

  get x() { return this._x; }
  get y() { return this._y; }
  get zoom() { return this._zoom; }
  private get width() { return VIEWPORT.WIDTH / this.zoom; }
  private get height() { return VIEWPORT.HEIGHT / (this.zoom * GROUND_Y_SCALE); }

  snapTo(worldX: number, worldY: number) {
    this._zoom = 1;
    this.leadX = 0;
    this.leadY = 0;
    this._x = this.clampX(worldX - this.width / 2);
    this._y = this.clampY(worldY - this.height / 2);
  }

  follow(worldX: number, worldY: number, dt: number) {
    this.leadX = 0;
    this.leadY = 0;
    const centerX = this.x + this.width / 2;
    const centerY = this.y + this.height / 2;
    const dx = worldX - centerX;
    const dy = worldY - centerY;
    const shift = (distance: number, deadzone: number) =>
      Math.sign(distance) * Math.max(0, Math.abs(distance) - deadzone);
    this.frame(
      centerX + shift(dx, this.width * 0.18),
      centerY + shift(dy, this.height * 0.18),
      1,
      dt,
    );
  }

  frameCombat(
    playerX: number, playerY: number, enemyX: number, enemyY: number, dt: number,
    travelX = 0, travelY = 0, shot?: CombatShot,
  ) {
    const dx = enemyX - playerX;
    const dy = enemyY - playerY;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    if (dt > 0) {
      const blend = 1 - Math.exp(-11 * dt);
      this.leadX += (clamp(travelX / dt * 0.12, -43, 43) - this.leadX) * blend;
      this.leadY += (clamp(travelY / dt * 0.12, -32, 32) - this.leadY) * blend;
    }
    const distance = Math.hypot(dx, dy);
    const baseZoom = shot?.zoom ?? 1.87;
    const zoom = Math.max(1, Math.min(baseZoom - clamp((distance - 75) / 540, 0, 0.52),
      VIEWPORT.WIDTH / (Math.abs(dx) + 205),
      VIEWPORT.HEIGHT / ((Math.abs(dy) + 196) * GROUND_Y_SCALE),
    ));
    const pin = (player: number, delta: number, lead: number, halfView: number, margin: number, anchor?: number) => {
      const follow = player + delta * 0.23 + lead;
      const desired = anchor === undefined ? follow : follow + clamp(anchor - follow, -130, 130) * 0.26;
      const minCenter = Math.max(player + delta, player) - halfView + margin;
      const maxCenter = Math.min(player + delta, player) + halfView - margin;
      return minCenter <= maxCenter ? clamp(desired, minCenter, maxCenter) : desired;
    };
    const targetX = pin(playerX, dx, this.leadX, VIEWPORT.WIDTH / (zoom * 2), 72, shot?.x);
    // Slightly favor the space above both fighters for staff swings and attack cues.
    const targetY = pin(playerY, dy, this.leadY - 12, VIEWPORT.HEIGHT / (zoom * GROUND_Y_SCALE * 2), 70, shot?.y);
    this.frame(targetX, targetY, zoom, dt, 15, 8);
  }

  private frame(targetX: number, targetY: number, zoom: number, dt: number, positionRate = 7, zoomRate = 7) {
    const centerX = this.x + this.width / 2;
    const centerY = this.y + this.height / 2;
    const t = 1 - Math.exp(-positionRate * dt);
    this._zoom += (zoom - this.zoom) * (1 - Math.exp(-zoomRate * dt));
    this._x = this.clampX(centerX + (targetX - centerX) * t - this.width / 2);
    this._y = this.clampY(centerY + (targetY - centerY) * t - this.height / 2);
  }

  isVisible(worldX: number, worldY: number, w: number, h: number): boolean {
    return worldX + w >= this.x && worldX <= this.x + this.width &&
      worldY + h >= this.y && worldY <= this.y + this.height;
  }

  worldToScreenX(worldX: number) { return (worldX - this.x) * this.zoom; }
  worldToScreenY(worldY: number) { return (worldY - this.y) * this.zoom * GROUND_Y_SCALE; }

  private clampX(x: number) { return Math.max(0, Math.min(WORLD.WIDTH - this.width, x)); }
  private clampY(y: number) { return Math.max(0, Math.min(WORLD.HEIGHT - this.height, y)); }
}
