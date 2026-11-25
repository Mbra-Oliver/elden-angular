import type { DuelPose } from './duel-rules';

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export class RemotePlayer {
  private x = 0;
  private z = 0;
  private currentYaw = 0;
  private initialized = false;
  private latest: DuelPose = {
    x: 0, z: 0, yaw: 0, state: 'idle', hp: 100, stamina: 100, alive: true, heals: 2, cosmetics: [],
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
    return {
      x: this.x,
      z: this.z,
      y: this.z,
      facingX: Math.sin(this.currentYaw),
      facingY: Math.cos(this.currentYaw),
      state: this.latest.state === 'dodge' ? 'roll'
        : this.latest.state === 'light' || this.latest.state === 'heavy' ? 'attack'
          : this.latest.state === 'heal' ? 'interact' : this.latest.state,
      phase: 0,
    };
  }
}
