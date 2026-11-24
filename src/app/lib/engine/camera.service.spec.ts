import { GROUND_Y_SCALE, VIEWPORT } from '../constants/terrain-constant';
import { CameraService } from './camera.service';

describe('CameraService', () => {
  it('keeps the focus centered and projects vertical distances with the ground tilt', () => {
    const camera = new CameraService();
    camera.snapTo(1000, 750);
    expect(camera.worldToScreenY(750)).toBeCloseTo(VIEWPORT.HEIGHT / 2);
    expect(camera.worldToScreenY(850) - camera.worldToScreenY(750)).toBeCloseTo(100 * GROUND_Y_SCALE);
  });

  it('follows the player faster than the opponent while keeping both visible', () => {
    const camera = new CameraService();
    camera.snapTo(1000, 750);
    for (let frame = 0; frame < 40; frame++) {
      camera.frameCombat(1000, 750, 1190, 750, 1 / 60);
    }
    expect(Math.abs(camera.worldToScreenX(1000) - VIEWPORT.WIDTH / 2))
      .toBeLessThan(Math.abs(camera.worldToScreenX(1190) - VIEWPORT.WIDTH / 2));

    const originalX = camera.x;
    for (let frame = 1; frame <= 12; frame++) {
      camera.frameCombat(1000 + frame * 6, 750, 1190, 750, 1 / 60, 6);
    }
    expect(camera.x).toBeGreaterThan(originalX + 35);
    expect(camera.worldToScreenX(1190)).toBeLessThan(VIEWPORT.WIDTH - 60);
  });

  it('uses an authored arena shot without letting the combatants leave the view', () => {
    const camera = new CameraService();
    const shot = { x: 1280, y: 700, zoom: 1.66 };
    camera.snapTo(1000, 750);
    for (let frame = 0; frame < 50; frame++) {
      camera.frameCombat(1000, 750, 1090, 750, 1 / 60, 0, 0, shot);
    }
    expect(camera.zoom).toBeLessThan(shot.zoom);
    expect(camera.worldToScreenX(1000)).toBeGreaterThan(100);
    expect(camera.worldToScreenX(1090)).toBeLessThan(VIEWPORT.WIDTH - 100);
  });

  it('widens the frame when the fighters split vertically', () => {
    const camera = new CameraService();
    camera.snapTo(1000, 750);
    for (let frame = 0; frame < 55; frame++) {
      camera.frameCombat(1000, 750, 1040, 790, 1 / 60);
    }
    const closeZoom = camera.zoom;
    for (let frame = 0; frame < 55; frame++) {
      camera.frameCombat(1000, 750, 1040, 1060, 1 / 60);
    }
    expect(camera.zoom).toBeLessThan(closeZoom - 0.46);
    expect(camera.worldToScreenY(1060)).toBeLessThan(VIEWPORT.HEIGHT - 55);
  });
});
