import { GROUND_Y_SCALE } from '../constants/terrain-constant';

export class ActorMotion {
  private stride = 0;
  private pace = 0;
  private heading: number | undefined;

  get walkFrame() {
    const frame = Math.floor(this.stride / (Math.PI / 2));
    return frame === 3 ? 1 : frame;
  }

  orient(ctx: CanvasRenderingContext2D) {
    ctx.scale(1, 1 / GROUND_Y_SCALE);
    ctx.rotate(this.heading ?? 0);
  }

  reset() {
    this.stride = 0;
    this.pace = 0;
    this.heading = undefined;
  }

  update(dt: number, distance: number, facingX: number, facingY: number) {
    const target = Math.atan2(facingY, facingX);
    const heading = this.heading ?? target;
    const difference = target - heading;
    this.heading = heading + Math.atan2(Math.sin(difference), Math.cos(difference)) * (1 - Math.exp(-38 * dt));
    this.stride = (this.stride + distance * 0.082) % (Math.PI * 2);
    const speed = dt > 0 ? distance / dt : 0;
    this.pace += (Math.min(1, speed / 160) - this.pace) * (1 - Math.exp(-19 * dt));
  }

  apply(
    ctx: CanvasRenderingContext2D,
    state: 'rest' | 'ready' | 'strike' | 'dash' | 'recover' | 'hurt',
    progress = 0,
    amplitude = 1,
  ) {
    const step = Math.sin(this.stride) * this.pace;
    this.orient(ctx);
    if (state === 'rest') {
      ctx.translate(0, step * 1.1 * amplitude);
      ctx.rotate(step * 0.028 * amplitude);
      return;
    }
    let shift = 0;
    let tilt = 0;
    if (state === 'ready') {
      shift = -4.5 * progress;
      tilt = -0.16 * progress;
    } else if (state === 'strike') {
      const snap = Math.min(1, progress / 0.38);
      const settle = Math.max(0, (progress - 0.38) / 0.62);
      shift = -4.5 + 9.2 * snap - 3.4 * settle;
      tilt = -0.16 + 0.34 * snap - 0.12 * settle;
    } else if (state === 'dash') {
      shift = Math.sin(Math.PI * progress) * 1.8;
    } else if (state === 'recover') {
      shift = 1.3 * (1 - progress);
      tilt = 0.06 * (1 - progress);
    } else {
      shift = -3.4 * (1 - progress);
      tilt = -0.11 * (1 - progress);
    }
    ctx.translate(shift * amplitude, 0);
    ctx.rotate(tilt * amplitude);
  }
}
