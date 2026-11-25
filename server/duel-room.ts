import { Room, ServerError } from '@colyseus/core';
import { ArraySchema, Schema, type } from '@colyseus/schema';
import {
  DUEL_RULES,
  clamp,
  clampToArena,
  facing,
  inArc,
  sanitizeInput,
  type DuelAction,
  type DuelInput,
  type DuelPose,
} from '../src/app/lib/pvp/duel-rules';

type AttackKind = 'light' | 'heavy';

interface Attack {
  kind: AttackKind;
  at: number;
  until: number;
  hit: boolean;
}

interface Fighter extends DuelPose {
  seat: 0 | 1;
  sessionId: string;
  pending: DuelInput;
  attack: Attack | null;
  dodgeUntil: number;
  iFramesUntil: number;
  lockUntil: number;
  hitstopUntil: number;
  lastSeq: number;
}

export class DuelPlayerState extends Schema {
  @type('string') sessionId = '';
  @type('number') seat = 0;
  @type('number') x = 0;
  @type('number') z = 0;
  @type('number') yaw = 0;
  @type('string') state = 'idle';
  @type('number') hp = DUEL_RULES.maxHp;
  @type('number') stamina = DUEL_RULES.maxStamina;
  @type('boolean') alive = true;
  @type('number') heals = DUEL_RULES.maxHeals;
  @type(['string']) cosmetics = new ArraySchema<string>();
}

export class DuelState extends Schema {
  @type('string') phase: 'waiting' | 'countdown' | 'fighting' | 'finished' = 'waiting';
  @type('string') mode: 'public' | 'private' = 'private';
  @type('string') code = '';
  @type('number') countdown = DUEL_RULES.countdownMs;
  @type('number') remaining = DUEL_RULES.roundMs;
  @type('number') winner = -1;
  @type('string') reason = '';
  @type([DuelPlayerState]) players = new ArraySchema<DuelPlayerState>();
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const usedCodes = new Set<string>();

function makeCode(seed: number): string {
  let value = seed >>> 0;
  let code = '';
  do {
    code = '';
    value = (value * 1664525 + 1013904223) >>> 0;
    for (let i = 0; i < 5; i++) {
      code += ALPHABET[value % ALPHABET.length];
      value = Math.floor(value / ALPHABET.length) >>> 0;
    }
  } while (usedCodes.has(code));
  usedCodes.add(code);
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

function cosmeticsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string').slice(0, 8);
}

export class DuelRoom extends Room<DuelState> {
  maxClients = 2;

  private fighters = new Map<string, Fighter>();
  private elapsed = 0;
  private code = '';
  private mode: 'public' | 'private' = 'private';

  onCreate(options: { code?: string; mode?: string }): void {
    const requestedCode = typeof options?.code === 'string' && options.code.trim()
      ? options.code.trim().toUpperCase()
      : '';
    this.mode = !requestedCode && options?.mode === 'public' ? 'public' : 'private';
    this.code = requestedCode || makeCode(parseInt(this.roomId.replace(/\D/g, '').slice(0, 8) || '1', 36));
    this.setState(new DuelState());
    this.state.mode = this.mode;
    this.state.code = this.code;
    this.onMessage('input', (client, message) => this.receiveInput(client, message));
    this.setSimulationInterval((dt) => this.step(dt), 1000 / DUEL_RULES.tickRate);
  }

  onJoin(client: { sessionId: string }, options: { cosmetics?: unknown }): void {
    if (this.state.players.length >= this.maxClients) throw new ServerError(4001, 'Arène pleine');

    const seat = (this.state.players.length === 0 ? 0 : 1) as 0 | 1;
    const fighter: Fighter = {
      seat,
      sessionId: client.sessionId,
      x: seat === 0 ? -80 : 80,
      z: 0,
      yaw: seat === 0 ? 0 : Math.PI,
      state: 'idle',
      hp: DUEL_RULES.maxHp,
      stamina: DUEL_RULES.maxStamina,
      alive: true,
      heals: DUEL_RULES.maxHeals,
      cosmetics: cosmeticsOf(options?.cosmetics),
      pending: { seq: 0, moveX: 0, moveZ: 0, yaw: seat === 0 ? 0 : Math.PI, actions: [] },
      attack: null,
      dodgeUntil: 0,
      iFramesUntil: 0,
      lockUntil: 0,
      hitstopUntil: 0,
      lastSeq: 0,
    };
    this.fighters.set(client.sessionId, fighter);

    const player = new DuelPlayerState();
    player.sessionId = client.sessionId;
    player.seat = seat;
    player.cosmetics.push(...fighter.cosmetics);
    this.syncState(fighter, player);
    this.state.players.push(player);

    if (this.fighters.size === this.maxClients) this.state.phase = 'countdown';
  }

  private receiveInput(client: { sessionId: string }, message: unknown): void {
    const fighter = this.fighters.get(client.sessionId);
    if (!fighter) return;
    const input = sanitizeInput(message as Partial<DuelInput>);
    if (input.seq <= fighter.lastSeq) return;
    fighter.lastSeq = input.seq;
    fighter.pending = input;
  }

  onLeave(client: { sessionId: string }): void {
    const fighter = this.fighters.get(client.sessionId);
    if (!fighter) return;
    this.fighters.delete(client.sessionId);
    const index = this.state.players.findIndex((player) => player.seat === fighter.seat);
    if (index >= 0) this.state.players.splice(index, 1);
    if (this.state.phase === 'finished') return;
    if (this.state.players.length === 1) {
      const survivor = [...this.fighters.values()][0];
      if (survivor) this.finish(survivor.seat, 'forfait');
    }
  }

  onDispose(): void {
    usedCodes.delete(this.code);
    this.fighters.clear();
  }

  private step(dt: number): void {
    this.elapsed += dt;
    this.state.countdown = Math.max(0, this.state.countdown - dt);
    if (this.state.phase === 'countdown' && this.state.countdown === 0) this.state.phase = 'fighting';
    if (this.state.phase !== 'fighting' && this.state.phase !== 'finished') return;

    this.state.remaining = Math.max(0, this.state.remaining - dt);
    const fighters = [...this.fighters.values()];
    for (const fighter of fighters) this.move(fighter, dt / 1000);
    for (const fighter of fighters) this.act(fighter);
    for (const fighter of fighters) this.resolve(fighter, fighters);
    for (const fighter of fighters) {
      const player = this.state.players.find((entry) => entry.seat === fighter.seat);
      if (player) this.syncState(fighter, player);
    }

    const alive = fighters.filter((fighter) => fighter.alive);
    if (alive.length === 1) this.finish(alive[0].seat, 'victoire');
    else if (alive.length === 0) this.finish(-1, 'double K.O.');
    else if (this.state.remaining === 0) {
      const totalHp = (fighter: Fighter) => fighter.hp + fighter.stamina * 0.2;
      this.finish(totalHp(fighters[0]) >= totalHp(fighters[1]) ? fighters[0].seat : fighters[1].seat, 'temps écoulé');
    }
  }

  private move(fighter: Fighter, dt: number): void {
    if (!fighter.alive || this.elapsed < fighter.hitstopUntil) return;
    const locked = this.elapsed < fighter.lockUntil;
    const dashing = this.elapsed < fighter.dodgeUntil;
    const input = fighter.pending;
    fighter.yaw = Math.atan2(Math.sin(input.yaw), Math.cos(input.yaw));
    if (locked && !dashing) return;
    const speed = DUEL_RULES.speed * (dashing ? 1.55 : 1);
    const position = clampToArena(fighter.x + input.moveX * speed * dt, fighter.z + input.moveZ * speed * dt);
    fighter.x = position.x;
    fighter.z = position.z;
    if (!locked) fighter.stamina = Math.min(DUEL_RULES.maxStamina, fighter.stamina + DUEL_RULES.staminaRegen * dt);
  }

  private act(fighter: Fighter): void {
    if (!fighter.alive || this.elapsed < fighter.lockUntil || this.elapsed < fighter.hitstopUntil) return;
    const action = fighter.pending.actions[0];
    if (!action) return;

    const cost = this.costOf(action);
    if (fighter.stamina < cost) return;
    if (action === 'heal' && fighter.heals <= 0) return;

    fighter.stamina -= cost;
    if (action === 'dodge') {
      fighter.dodgeUntil = this.elapsed + DUEL_RULES.dodgeMs;
      fighter.iFramesUntil = this.elapsed + DUEL_RULES.iFramesMs;
      fighter.lockUntil = this.elapsed + DUEL_RULES.dodgeMs;
      fighter.state = 'dodge';
      return;
    }
    if (action === 'heal') {
      fighter.heals -= 1;
      fighter.hp = Math.min(DUEL_RULES.maxHp, fighter.hp + DUEL_RULES.healAmount);
      fighter.lockUntil = this.elapsed + DUEL_RULES.healLock;
      fighter.state = 'heal';
      return;
    }
    const kind: AttackKind = action;
    const windup = kind === 'light' ? DUEL_RULES.lightWindup : DUEL_RULES.heavyWindup;
    const lock = kind === 'light' ? DUEL_RULES.lightLock : DUEL_RULES.heavyLock;
    fighter.attack = { kind, at: this.elapsed + windup, until: this.elapsed + lock, hit: false };
    fighter.lockUntil = this.elapsed + lock;
    fighter.state = kind;
  }

  private resolve(fighter: Fighter, fighters: Fighter[]): void {
    const attack = fighter.attack;
    if (!attack || attack.hit || this.elapsed < attack.at) return;
    attack.hit = true;
    const range = attack.kind === 'light' ? DUEL_RULES.lightRange : DUEL_RULES.heavyRange;
    const arc = attack.kind === 'light' ? DUEL_RULES.lightArc : DUEL_RULES.heavyArc;
    const damage = attack.kind === 'light' ? DUEL_RULES.lightDamage : DUEL_RULES.heavyDamage;
    for (const target of fighters) {
      if (target === fighter || !target.alive || this.elapsed < target.iFramesUntil) continue;
      if (!inArc({ ...fighter, yaw: fighter.yaw }, target, arc, range)) continue;
      target.hp = clamp(target.hp - damage, 0, DUEL_RULES.maxHp);
      target.hitstopUntil = this.elapsed + DUEL_RULES.hitstopMs;
      target.lockUntil = Math.max(target.lockUntil, this.elapsed + DUEL_RULES.hitstopMs);
      target.state = 'hurt';
      if (target.hp === 0) target.alive = false;
    }
    if (this.elapsed >= attack.until) fighter.attack = null;
  }

  private costOf(action: DuelAction): number {
    if (action === 'light') return DUEL_RULES.lightCost;
    if (action === 'heavy') return DUEL_RULES.heavyCost;
    if (action === 'dodge') return DUEL_RULES.dodgeCost;
    return DUEL_RULES.healCost;
  }

  private syncState(fighter: Fighter, player: DuelPlayerState): void {
    player.x = Math.round(fighter.x * 10) / 10;
    player.z = Math.round(fighter.z * 10) / 10;
    player.yaw = Math.round(fighter.yaw * 1000) / 1000;
    player.state = this.elapsed < fighter.iFramesUntil && fighter.state === 'idle' ? 'dodge' : fighter.state;
    player.hp = Math.round(fighter.hp);
    player.stamina = Math.round(fighter.stamina);
    player.alive = fighter.alive;
    player.heals = fighter.heals;
  }

  private finish(winner: number, reason: string): void {
    if (this.state.phase === 'finished') return;
    this.state.phase = 'finished';
    this.state.winner = winner;
    this.state.reason = reason;
    this.state.remaining = 0;
    this.broadcast('finish', { winner, reason });
  }
}

export function duelFacing(yaw: number): { x: number; z: number } {
  return facing(yaw);
}
