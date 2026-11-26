export type DuelPhase = 'waiting' | 'countdown' | 'fighting' | 'finished';
export type DuelAction = 'light' | 'heavy' | 'dodge' | 'heal';

export interface DuelInput {
  seq: number;
  moveX: number;
  moveZ: number;
  yaw: number;
  actions: DuelAction[];
}

export interface DuelPose {
  x: number;
  z: number;
  yaw: number;
  state: string;
  hp: number;
  stamina: number;
  alive: boolean;
  heals: number;
  cosmetics: readonly string[];
}

export const DUEL_RULES = {
  radius: 220,
  tickRate: 20,
  countdownMs: 3000,
  roundMs: 90000,
  maxHp: 100,
  maxStamina: 100,
  staminaRegen: 24,
  speed: 205,
  dodgeCost: 28,
  dodgeMs: 520,
  iFramesMs: 260,
  lightCost: 14,
  lightDamage: 11,
  lightRange: 78,
  lightArc: 0.66,
  lightWindup: 140,
  lightLock: 420,
  heavyCost: 28,
  heavyDamage: 22,
  heavyRange: 88,
  heavyArc: 0.58,
  heavyWindup: 320,
  heavyLock: 720,
  healCost: 20,
  healAmount: 35,
  healLock: 620,
  maxHeals: 2,
  hitstopMs: 110,
} as const;

const ACTIONS = new Set<DuelAction>(['light', 'heavy', 'dodge', 'heal']);

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sanitizeInput(raw: Partial<DuelInput> | undefined): DuelInput {
  const moveX = clamp(Number(raw?.moveX) || 0, -1, 1);
  const moveZ = clamp(Number(raw?.moveZ) || 0, -1, 1);
  const magnitude = Math.hypot(moveX, moveZ);
  const scale = magnitude > 1 ? 1 / magnitude : 1;
  const actions = Array.isArray(raw?.actions)
    ? raw.actions.filter((action): action is DuelAction => ACTIONS.has(action as DuelAction)).slice(0, 2)
    : [];
  return {
    seq: Math.floor(Number(raw?.seq) || 0),
    moveX: moveX * scale,
    moveZ: moveZ * scale,
    yaw: Number.isFinite(raw?.yaw) ? Number(raw?.yaw) : 0,
    actions,
  };
}

export function facing(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

export function clampToArena(x: number, z: number): { x: number; z: number } {
  const distance = Math.hypot(x, z);
  if (distance <= DUEL_RULES.radius) return { x, z };
  const scale = DUEL_RULES.radius / distance;
  return { x: x * scale, z: z * scale };
}

export function inArc(attacker: DuelPose, target: DuelPose, arc: number, range: number): boolean {
  const forward = facing(attacker.yaw);
  const dx = target.x - attacker.x;
  const dz = target.z - attacker.z;
  const distance = Math.hypot(dx, dz);
  if (distance > range || distance < 0.001) return false;
  return (forward.x * dx + forward.z * dz) / distance >= arc;
}

export function poseState(input: DuelInput, stamina: number, hp: number, acting: boolean): string {
  if (hp <= 0) return 'dead';
  if (acting) return input.actions[0] ?? 'idle';
  if (Math.hypot(input.moveX, input.moveZ) > 0.15) return stamina < 20 ? 'run' : 'walk';
  return 'idle';
}
