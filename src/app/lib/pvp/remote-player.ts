import { attackTimeline, type DuelPose } from './duel-rules';

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export class RemotePlayer {
  private x = 0;
  private z = 0;
  private currentYaw = 0;
  private initialized = false;
  private latest: DuelPose = {
    x: 0, z: 0, yaw: 0, state: 'idle', actionMs: 0, step: 0, hp: 100, stamina: 100, alive: true, heals: 2, totem: false, cosmetics: [], ack: 0,
  };

  update(pose: DuelPose | null, dt: number): void {
    if (!pose) return;
    this.latest = pose;
    if (!this.initialized) {
      this.x = pose.x;
      this.z = pose.z;
      this.currentYaw = pose.yaw;
      this.initialized = true;
      return;
    }
    this.x = lerp(this.x, pose.x, 1 - Math.exp(-dt * 14));
    this.z = lerp(this.z, pose.z, 1 - Math.exp(-dt * 14));
    let delta = pose.yaw - this.currentYaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.currentYaw += delta * (1 - Math.exp(-dt * 18));
  }

  get positionX(): number { return this.x; }
  get positionZ(): number { return this.z; }
  get yaw(): number { return this.currentYaw; }
  get pose(): DuelPose { return this.latest; }

  actor(): {
    x: number; z: number; y: number; facingX: number; facingY: number; state: string; phase: number;
  } {
    const timeline = attackTimeline(this.latest.state, this.latest.actionMs, this.latest.step);
    const state = timeline
      ? timeline.segment === 'windup' ? 'windup' : 'attacking'
      : this.latest.state === 'dodge' ? 'rolling'
        : this.latest.state === 'walk' ? 'moving' : this.latest.state;
    return {
      x: this.x,
      z: this.z,
      y: this.z,
      facingX: Math.sin(this.currentYaw),
      facingY: Math.cos(this.currentYaw),
      state,
      phase: timeline ? (timeline.segment === 'recover' ? 1 : timeline.t) : 0,
    };
  }
}
