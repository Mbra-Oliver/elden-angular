import { PLAYER_CONFIG } from '../../constants/player.config-constant';
import { approachVelocity, dodgeSpeed, ShiftGesture } from './locomotion';

describe('locomotion', () => {
  it('turns a short Shift press into a dodge on release', () => {
    const shift = new ShiftGesture();
    expect(shift.update(true, 0.016)).toBeFalse();
    expect(shift.update(true, 0.05)).toBeFalse();
    expect(shift.update(false, 0.016)).toBeTrue();
    expect(shift.sprinting).toBeFalse();
  });

  it('turns a held Shift into a sprint without dodging', () => {
    const shift = new ShiftGesture();
    shift.update(true, 0.016);
    for (let t = 0; t < PLAYER_CONFIG.sprintDelay + 50; t += 16) shift.update(true, 0.016);
    expect(shift.sprinting).toBeTrue();
    expect(shift.update(false, 0.016)).toBeFalse();
    expect(shift.sprinting).toBeFalse();
  });

  it('reaches walking speed quickly and stops without sliding forever', () => {
    let v = { x: 0, y: 0 };
    for (let i = 0; i < 12; i++) v = approachVelocity(v.x, v.y, PLAYER_CONFIG.speed, 0, 1 / 60);
    expect(v.x).toBeGreaterThan(PLAYER_CONFIG.speed * 0.9);
    for (let i = 0; i < 30; i++) v = approachVelocity(v.x, v.y, 0, 0, 1 / 60);
    expect(v.x).toBe(0);
  });

  it('rolls about 150 px, fast first then braking', () => {
    const steps = 200;
    let travel = 0;
    for (let i = 0; i < steps; i++) {
      travel += dodgeSpeed(PLAYER_CONFIG.rollSpeed, (i + 0.5) / steps) * PLAYER_CONFIG.rollDuration / 1000 / steps;
    }
    expect(travel).toBeGreaterThan(130);
    expect(travel).toBeLessThan(170);
    expect(dodgeSpeed(PLAYER_CONFIG.rollSpeed, 0.1)).toBeGreaterThan(dodgeSpeed(PLAYER_CONFIG.rollSpeed, 0.8));
  });
});
