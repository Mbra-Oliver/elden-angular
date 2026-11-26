export type DuelPhase = 'waiting' | 'countdown' | 'fighting' | 'finished';
export type DuelAction = 'light' | 'heavy' | 'dodge' | 'heal' | 'throw';

export interface DuelInput {
  seq: number;
  moveX: number;
  moveZ: number;
  yaw: number;
  actions: DuelAction[];
  /** Garde tenue (G, LB, bouton bouclier). */
  guard: boolean;
}

export interface DuelPose {
  x: number;
  z: number;
  yaw: number;
  /**
   * idle, walk, guard, dodge, light, heavy, throw, heal, hurt, stagger
   * (garde brisée ou parade subie), dead.
   */
  state: string;
  /** Temps écoulé dans l'état courant (ms), pour caler les animations. */
  actionMs: number;
  /** Coup du combo léger (0, 1, 2). */
  step: number;
  hp: number;
  stamina: number;
  alive: boolean;
  heals: number;
  totem: boolean;
  cosmetics: readonly string[];
  ack: number;
}

export interface DuelFx {
  kind: 'hit' | 'block' | 'parry' | 'guardbreak' | 'heal' | 'evade';
  attacker: number;
  target: number;
  attack: 'light' | 'heavy' | 'throw';
  damage: number;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  id?: number;
}

/**
 * Duel à mort, dans l'esprit des boss de l'histoire : même allure que le
 * héros (pas, roulade, combo en trois coups), mais des anticipations plus
 * lisibles, une garde qui coûte de l'endurance, une parade au bon moment, des
 * coups lourds qui brisent la garde et se punissent, deux mixtures à boire
 * sans être touché. Pas de chrono ni de totem : seul le dernier debout gagne.
 * [SUPPOSITION] toutes les valeurs sont réglées à l'œil, pas encore jouées.
 */
export const DUEL_RULES = {
  radius: 220,
  tickRate: 30,
  countdownMs: 3000,
  /** 0 : pas de limite de temps, le duel est à mort. */
  roundMs: 0,
  maxHp: 160,
  maxStamina: 100,
  /** Endurance : remonte vite, mais seulement après une courte pause (comme l'histoire). */
  staminaRegen: 52,
  staminaDelayMs: 620,
  /** En garde, l'endurance remonte trois fois moins vite. */
  guardRegenFactor: 0.28,
  speed: 165,
  guardSpeed: 0.5,

  dodgeCost: 20,
  dodgeMs: 520,
  dodgeSpeed: 420,
  iFramesFrom: 30,
  iFramesMs: 320,
  /** Sans direction : pas en arrière, plus court. */
  backstepMs: 340,
  backstepSpeed: 330,
  backstepIFramesMs: 180,

  /** Combo léger : trois coups, le suivant part à partir de chainMs. */
  lightCost: 16,
  lightDamage: [13, 14, 20] as readonly number[],
  lightWindup: [210, 200, 290] as readonly number[],
  lightActive: 90,
  lightLock: [520, 520, 760] as readonly number[],
  lightChainMs: [360, 360, 9999] as readonly number[],
  lightLunge: 16,
  lightRange: 74,
  lightArc: 0.45,

  /** Lourde : longue anticipation (lisible, esquivable), brise la garde, longue récupération (punissable). */
  heavyCost: 34,
  heavyDamage: 32,
  heavyWindup: 560,
  heavyActive: 110,
  heavyLock: 1240,
  heavyLunge: 30,
  heavyRange: 86,
  heavyArc: 0.4,
  /** Pendant l'anticipation, la lourde suit lentement sa cible (rad/s). */
  heavyTrack: 1.6,

  /** Garde : de face seulement, chaque coup paré coûte de l'endurance et laisse passer un peu. */
  guardArc: 0.2,
  guardChip: 0.15,
  guardCostLight: 20,
  guardCostHeavy: 48,
  guardCostThrow: 14,
  /** Garde levée juste avant l'impact : parade, l'attaquant chancelle. */
  parryWindowMs: 170,
  parryStunMs: 950,
  guardBreakMs: 1150,
  /** Coup reçu pendant un étourdissement : dégâts majorés (la riposte). */
  stunBonus: 1.5,

  /** Mixture : on boit, puis seulement on guérit ; un coup pendant la gorgée la gâche. */
  healCost: 12,
  healAmount: 55,
  healDrinkMs: 900,
  healLock: 1350,
  maxHeals: 2,

  hurtLightMs: 330,
  hurtHeavyMs: 640,
  knockLight: 10,
  knockHeavy: 36,
  hitstopMs: 90,
  /** Aide à la visée : au départ d'un coup, on se tourne vers l'adversaire s'il est devant. */
  aimAssistArc: -0.2,
  aimAssistRange: 170,

  throwCost: 26,
  throwDamage: 12,
  throwRange: 210,
  throwArc: 0.86,
  throwWindup: 380,
  throwLock: 760,
  throwCooldownMs: 4000,

  /** Mode totem (autre variante) : coupé, le duel se joue à mort. */
  totemEnabled: false,
  totemHoldMs: 12000,
  totemPickupRange: 34,
  totemSlow: 0.82,
} as const;

/** Découpage d'une attaque pour l'animation : anticipation, impact, récupération (phase 0 → 1). */
export function attackTimeline(state: string, ms: number, step: number): { segment: 'windup' | 'attacking' | 'recover'; t: number } | null {
  let windup: number;
  let active: number;
  let lock: number;
  if (state === 'light') {
    const index = Math.min(2, Math.max(0, step));
    windup = DUEL_RULES.lightWindup[index];
    active = DUEL_RULES.lightActive;
    lock = DUEL_RULES.lightLock[index];
  } else if (state === 'heavy') {
    windup = DUEL_RULES.heavyWindup;
    active = DUEL_RULES.heavyActive;
    lock = DUEL_RULES.heavyLock;
  } else if (state === 'throw') {
    windup = DUEL_RULES.throwWindup;
    active = 80;
    lock = DUEL_RULES.throwLock;
  } else {
    return null;
  }
  if (ms < windup) return { segment: 'windup', t: ms / windup };
  if (ms < windup + active) return { segment: 'attacking', t: (ms - windup) / active };
  return { segment: 'recover', t: Math.min(1, (ms - windup - active) / Math.max(1, lock - windup - active)) };
}

const ACTIONS = new Set<DuelAction>(['light', 'heavy', 'dodge', 'heal', 'throw']);

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
    guard: raw?.guard === true,
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
