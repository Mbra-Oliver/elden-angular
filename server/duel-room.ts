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
  type DuelFx,
  type DuelInput,
  type DuelPose,
} from '../src/app/lib/pvp/duel-rules';

type AttackKind = 'light' | 'heavy' | 'throw';

interface Attack {
  kind: AttackKind;
  step: number;
  start: number;
  /** Instant de l'impact (fin de l'anticipation). */
  at: number;
  until: number;
  /** À partir de là, le coup léger suivant ou une roulade peut couper la récupération. */
  chainAt: number;
  hit: boolean;
}

interface Fighter extends DuelPose {
  seat: 0 | 1;
  sessionId: string;
  pending: DuelInput;
  attack: Attack | null;
  /** Début de l'état courant (horloge de la salle, ms). */
  stateSince: number;
  lockUntil: number;
  iFrom: number;
  iUntil: number;
  dodge: { x: number; z: number; speed: number; start: number; duration: number } | null;
  knock: { x: number; z: number; until: number } | null;
  hitstopUntil: number;
  throwUntil: number;
  /** Dernière dépense d'endurance : la régénération attend un peu. */
  staminaAt: number;
  /** Garde levée à cet instant (pour la parade). */
  guardSince: number;
  /** Fin de la gorgée de mixture (null : rien en cours). */
  healAt: number | null;
  lastSeq: number;
  /** Dernière action demandée, gardée un court instant si le combattant est encore pris. */
  buffered: { action: DuelAction; at: number } | null;
}

/** Une touche pressée pendant un coup part dès qu'il se termine, si elle date de moins de ça. */
const BUFFER_MS = 320;
const BUSY = new Set(['light', 'heavy', 'throw', 'heal', 'hurt', 'stagger', 'dodge']);

export class DuelPlayerState extends Schema {
  @type('string') sessionId = '';
  @type('number') seat = 0;
  @type('number') ack = 0;
  @type('number') x = 0;
  @type('number') z = 0;
  @type('number') yaw = 0;
  @type('string') state = 'idle';
  @type('number') actionMs = 0;
  @type('number') step = 0;
  @type('number') hp = DUEL_RULES.maxHp;
  @type('number') stamina = DUEL_RULES.maxStamina;
  @type('boolean') alive = true;
  @type('number') heals = DUEL_RULES.maxHeals;
  @type('boolean') totem = false;
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
  @type('number') totemCarrier = -1;
  @type('number') totemHold = 0;
  @type('number') totemX = 0;
  @type('number') totemZ = 0;
  @type('boolean') totemVisible = true;
  /** Sièges (0/1) qui ont demandé une revanche après la fin du duel. */
  @type(['number']) rematch = new ArraySchema<number>();
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

function spawn(seat: 0 | 1): Pick<Fighter, 'x' | 'z' | 'yaw'> {
  return { x: seat === 0 ? -90 : 90, z: 0, yaw: seat === 0 ? Math.PI / 2 : -Math.PI / 2 };
}

function angleTo(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
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
    this.state.remaining = DUEL_RULES.roundMs;
    this.state.totemVisible = DUEL_RULES.totemEnabled;
    this.onMessage('input', (client, message) => this.receiveInput(client, message));
    this.onMessage('rematch', (client) => this.requestRematch(client));
    this.setSimulationInterval((dt) => this.step(dt), 1000 / DUEL_RULES.tickRate);
  }

  private fresh(seat: 0 | 1, sessionId: string, cosmetics: string[]): Fighter {
    const place = spawn(seat);
    return {
      seat,
      sessionId,
      ...place,
      state: 'idle',
      actionMs: 0,
      step: 0,
      hp: DUEL_RULES.maxHp,
      stamina: DUEL_RULES.maxStamina,
      alive: true,
      heals: DUEL_RULES.maxHeals,
      totem: false,
      ack: 0,
      cosmetics,
      pending: { seq: 0, moveX: 0, moveZ: 0, yaw: place.yaw, actions: [], guard: false },
      attack: null,
      stateSince: this.elapsed,
      lockUntil: 0,
      iFrom: 0,
      iUntil: 0,
      dodge: null,
      knock: null,
      hitstopUntil: 0,
      throwUntil: 0,
      staminaAt: -Infinity,
      guardSince: -Infinity,
      healAt: null,
      lastSeq: 0,
      buffered: null,
    };
  }

  onJoin(client: { sessionId: string }, options: { cosmetics?: unknown }): void {
    if (this.state.players.length >= this.maxClients) throw new ServerError(4001, 'Arène pleine');

    const seat = (this.state.players.length === 0 ? 0 : 1) as 0 | 1;
    const fighter = this.fresh(seat, client.sessionId, cosmeticsOf(options?.cosmetics));
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
    // Chaque action n'est envoyée qu'une fois : on la garde ici jusqu'à ce qu'elle parte.
    const action = input.actions[0];
    if (action) fighter.buffered = { action, at: this.elapsed };
  }

  private requestRematch(client: { sessionId: string }): void {
    const fighter = this.fighters.get(client.sessionId);
    if (!fighter || this.state.phase !== 'finished' || this.fighters.size < 2) return;
    if (!this.state.rematch.includes(fighter.seat)) this.state.rematch.push(fighter.seat);
    if (this.state.rematch.length < 2) return;

    for (const [id, entry] of this.fighters) {
      const next = this.fresh(entry.seat, entry.sessionId, entry.cosmetics as string[]);
      next.lastSeq = entry.lastSeq;
      this.fighters.set(id, next);
      const player = this.state.players.find((item) => item.seat === entry.seat);
      if (player) this.syncState(next, player);
    }
    this.resetTotem();
    this.state.rematch.clear();
    this.state.winner = -1;
    this.state.reason = '';
    this.state.remaining = DUEL_RULES.roundMs;
    this.state.countdown = DUEL_RULES.countdownMs;
    this.state.phase = 'countdown';
  }

  onLeave(client: { sessionId: string }): void {
    const fighter = this.fighters.get(client.sessionId);
    if (!fighter) return;
    this.fighters.delete(client.sessionId);
    if (this.state.phase === 'finished') return;
    if (fighter.totem) this.resetTotem();
    const index = this.state.players.findIndex((player) => player.seat === fighter.seat);
    if (index >= 0) this.state.players.splice(index, 1);
    if (this.state.players.length === 1) {
      const survivor = [...this.fighters.values()][0];
      if (survivor) this.finish(survivor.seat, 'forfait');
    }
  }

  onDispose(): void {
    usedCodes.delete(this.code);
    this.fighters.clear();
  }

  // ------------------------------------------------------------ SIMULATION

  private step(dt: number): void {
    this.elapsed += dt;
    if (this.state.phase === 'countdown') {
      this.state.countdown = Math.max(0, this.state.countdown - dt);
      if (this.state.countdown === 0) this.state.phase = 'fighting';
    }
    const fighters = [...this.fighters.values()];
    if (this.state.phase !== 'fighting' && this.state.phase !== 'finished') {
      // Pendant le compte à rebours, chacun peut déjà se tourner (pas bouger).
      for (const fighter of fighters) {
        const player = this.state.players.find((entry) => entry.seat === fighter.seat);
        if (player) this.syncState(fighter, player);
      }
      return;
    }

    if (DUEL_RULES.roundMs > 0) this.state.remaining = Math.max(0, this.state.remaining - dt);
    for (const fighter of fighters) this.update(fighter, fighters, dt / 1000);
    for (const fighter of fighters) this.act(fighter, fighters);
    for (const fighter of fighters) this.resolve(fighter, fighters);
    for (const fighter of fighters) this.finishHeal(fighter);
    if (DUEL_RULES.totemEnabled && this.state.phase === 'fighting') this.updateTotem(dt);
    for (const fighter of fighters) {
      const player = this.state.players.find((entry) => entry.seat === fighter.seat);
      if (player) this.syncState(fighter, player);
    }

    const alive = fighters.filter((fighter) => fighter.alive);
    if (fighters.length === 2 && alive.length === 1) this.finish(alive[0].seat, 'à mort');
    else if (fighters.length === 2 && alive.length === 0) this.finish(-1, 'double mort');
    else if (DUEL_RULES.roundMs > 0 && this.state.remaining === 0) {
      this.finish(fighters[0].hp >= fighters[1].hp ? fighters[0].seat : fighters[1].seat, 'temps écoulé');
    }
  }

  private setFighterState(fighter: Fighter, state: string): void {
    if (fighter.state !== state) fighter.stateSince = this.elapsed;
    fighter.state = state;
  }

  private opponentOf(fighter: Fighter, fighters: Fighter[]): Fighter | undefined {
    return fighters.find((other) => other !== fighter && other.alive);
  }

  private spend(fighter: Fighter, cost: number): void {
    if (cost <= 0) return;
    fighter.stamina = Math.max(0, fighter.stamina - cost);
    fighter.staminaAt = this.elapsed;
  }

  private update(fighter: Fighter, fighters: Fighter[], dt: number): void {
    if (!fighter.alive || this.elapsed < fighter.hitstopUntil) return;
    const input = fighter.pending;
    const opponent = this.opponentOf(fighter, fighters);
    const locked = this.elapsed < fighter.lockUntil;

    // Fin d'une action : retour au calme (la mixture non finie est perdue).
    if (!locked && BUSY.has(fighter.state)) {
      fighter.attack = null;
      fighter.dodge = null;
      fighter.healAt = null;
      fighter.step = 0;
      this.setFighterState(fighter, 'idle');
    }

    // Recul après un coup reçu.
    if (fighter.knock && this.elapsed < fighter.knock.until) {
      this.slide(fighter, fighter.knock.x * dt, fighter.knock.z * dt, fighters);
      fighter.knock.x *= Math.exp(-9 * dt);
      fighter.knock.z *= Math.exp(-9 * dt);
    } else {
      fighter.knock = null;
    }

    if (fighter.dodge) {
      const t = Math.min(1, (this.elapsed - fighter.dodge.start) / fighter.dodge.duration);
      // Élan au départ, freinage en fin de roulade (même courbe que l'histoire).
      const speed = fighter.dodge.speed * (1 - t) * (1 - t) * 1.6;
      this.slide(fighter, fighter.dodge.x * speed * dt, fighter.dodge.z * speed * dt, fighters);
    } else if (fighter.attack && fighter.attack.kind !== 'throw') {
      const attack = fighter.attack;
      // Pendant l'anticipation de la lourde, le corps suit lentement la cible.
      if (attack.kind === 'heavy' && this.elapsed < attack.at && opponent) {
        const delta = wrap(angleTo(fighter, opponent) - fighter.yaw);
        const turn = DUEL_RULES.heavyTrack * dt;
        fighter.yaw = wrap(fighter.yaw + Math.max(-turn, Math.min(turn, delta)));
      }
      // Petite fente vers l'avant au moment de frapper.
      const lunge = attack.kind === 'heavy' ? DUEL_RULES.heavyLunge : DUEL_RULES.lightLunge;
      const active = attack.kind === 'heavy' ? DUEL_RULES.heavyActive : DUEL_RULES.lightActive;
      if (this.elapsed >= attack.at - 70 && this.elapsed < attack.at + active) {
        const forward = facing(fighter.yaw);
        const step = lunge / ((active + 70) / 1000) * dt;
        this.slide(fighter, forward.x * step, forward.z * step, fighters);
      }
    } else if (!locked) {
      // Garde : tenue tant qu'il reste de l'endurance.
      const guarding = input.guard && fighter.stamina > 0;
      if (guarding && fighter.state !== 'guard') {
        fighter.guardSince = this.elapsed;
        this.setFighterState(fighter, 'guard');
      } else if (!guarding && fighter.state === 'guard') {
        this.setFighterState(fighter, 'idle');
      }
      fighter.yaw = wrap(input.yaw);
      const speed = DUEL_RULES.speed
        * (fighter.state === 'guard' ? DUEL_RULES.guardSpeed : 1)
        * (fighter.totem ? DUEL_RULES.totemSlow : 1);
      this.slide(fighter, input.moveX * speed * dt, input.moveZ * speed * dt, fighters);
      if (fighter.state !== 'guard') this.setFighterState(fighter, Math.hypot(input.moveX, input.moveZ) > 0.15 ? 'walk' : 'idle');
    }

    const resting = !fighter.attack && !fighter.dodge && fighter.state !== 'heal';
    if (resting && this.elapsed - fighter.staminaAt >= DUEL_RULES.staminaDelayMs) {
      const rate = DUEL_RULES.staminaRegen * (fighter.state === 'guard' ? DUEL_RULES.guardRegenFactor : 1);
      fighter.stamina = Math.min(DUEL_RULES.maxStamina, fighter.stamina + rate * dt);
    }
  }

  /** Déplacement borné à l'arène ; les deux corps ne se traversent pas. */
  private slide(fighter: Fighter, dx: number, dz: number, fighters: Fighter[]): void {
    let position = clampToArena(fighter.x + dx, fighter.z + dz);
    for (const other of fighters) {
      if (other === fighter || !other.alive) continue;
      const ox = position.x - other.x;
      const oz = position.z - other.z;
      const distance = Math.hypot(ox, oz);
      const minimum = 22;
      if (distance < minimum && distance > 0.001) {
        position = clampToArena(other.x + ox / distance * minimum, other.z + oz / distance * minimum);
      }
    }
    fighter.x = position.x;
    fighter.z = position.z;
  }

  /** Aide à la visée : un coup lancé à peu près vers l'adversaire part droit sur lui. */
  private aim(fighter: Fighter, fighters: Fighter[], range: number): void {
    const opponent = this.opponentOf(fighter, fighters);
    if (!opponent) return;
    const forward = facing(fighter.yaw);
    const dx = opponent.x - fighter.x;
    const dz = opponent.z - fighter.z;
    const distance = Math.hypot(dx, dz);
    if (distance > range || distance < 0.001) return;
    if ((forward.x * dx + forward.z * dz) / distance < DUEL_RULES.aimAssistArc) return;
    fighter.yaw = Math.atan2(dx, dz);
  }

  private act(fighter: Fighter, fighters: Fighter[]): void {
    if (!fighter.alive || this.elapsed < fighter.hitstopUntil) return;
    const buffered = fighter.buffered;
    if (!buffered) return;
    if (this.elapsed - buffered.at > BUFFER_MS) {
      fighter.buffered = null;
      return;
    }
    const action = buffered.action;
    const attack = fighter.attack;
    const locked = this.elapsed < fighter.lockUntil;
    // Après l'impact d'un coup léger : enchaîner le suivant ou rouler.
    const canCancel = !!attack && attack.kind === 'light' && attack.hit && this.elapsed >= attack.chainAt;
    const chaining = action === 'light' && canCancel && attack!.step < 2;
    if (locked && !chaining && !(action === 'dodge' && canCancel)) return;

    // Comme dans l'histoire : une action part tant qu'il reste un peu d'endurance.
    if (fighter.stamina < this.costOf(action)) return;
    if (action === 'heal' && fighter.heals <= 0) {
      fighter.buffered = null;
      return;
    }
    if (action === 'throw' && this.elapsed < fighter.throwUntil) return;

    fighter.buffered = null;
    fighter.attack = null;
    fighter.healAt = null;
    this.spend(fighter, this.costOf(action));

    if (action === 'dodge') {
      const input = fighter.pending;
      const length = Math.hypot(input.moveX, input.moveZ);
      const back = length < 0.2;
      const away = facing(fighter.yaw);
      const duration = back ? DUEL_RULES.backstepMs : DUEL_RULES.dodgeMs;
      fighter.dodge = {
        x: back ? -away.x : input.moveX / length,
        z: back ? -away.z : input.moveZ / length,
        speed: back ? DUEL_RULES.backstepSpeed : DUEL_RULES.dodgeSpeed,
        start: this.elapsed,
        duration,
      };
      fighter.iFrom = this.elapsed + DUEL_RULES.iFramesFrom;
      fighter.iUntil = fighter.iFrom + (back ? DUEL_RULES.backstepIFramesMs : DUEL_RULES.iFramesMs);
      fighter.lockUntil = this.elapsed + duration;
      fighter.step = back ? 1 : 0;
      fighter.stateSince = this.elapsed;
      fighter.state = 'dodge';
      return;
    }
    if (action === 'heal') {
      fighter.heals -= 1;
      fighter.healAt = this.elapsed + DUEL_RULES.healDrinkMs;
      fighter.lockUntil = this.elapsed + DUEL_RULES.healLock;
      this.setFighterState(fighter, 'heal');
      return;
    }
    if (action === 'throw') {
      this.aim(fighter, fighters, DUEL_RULES.throwRange);
      fighter.throwUntil = this.elapsed + DUEL_RULES.throwCooldownMs;
      fighter.attack = {
        kind: 'throw', step: 0, start: this.elapsed, at: this.elapsed + DUEL_RULES.throwWindup,
        until: this.elapsed + DUEL_RULES.throwLock, chainAt: Infinity, hit: false,
      };
      fighter.lockUntil = fighter.attack.until;
      fighter.stateSince = this.elapsed;
      fighter.state = 'throw';
      return;
    }
    if (action === 'light') {
      const step = chaining ? attack!.step + 1 : 0;
      this.aim(fighter, fighters, DUEL_RULES.aimAssistRange);
      fighter.attack = {
        kind: 'light', step, start: this.elapsed, at: this.elapsed + DUEL_RULES.lightWindup[step],
        until: this.elapsed + DUEL_RULES.lightLock[step], chainAt: this.elapsed + DUEL_RULES.lightChainMs[step], hit: false,
      };
      fighter.step = step;
    } else {
      this.aim(fighter, fighters, DUEL_RULES.aimAssistRange);
      fighter.attack = {
        kind: 'heavy', step: 0, start: this.elapsed, at: this.elapsed + DUEL_RULES.heavyWindup,
        until: this.elapsed + DUEL_RULES.heavyLock, chainAt: Infinity, hit: false,
      };
      fighter.step = 0;
    }
    fighter.lockUntil = fighter.attack.until;
    // Chaque coup du combo repart de zéro pour l'animation.
    fighter.stateSince = this.elapsed;
    fighter.state = action;
  }

  private resolve(fighter: Fighter, fighters: Fighter[]): void {
    const attack = fighter.attack;
    if (!attack || attack.hit || this.elapsed < attack.at) return;
    attack.hit = true;
    if (attack.kind === 'throw') {
      this.resolveThrow(fighter);
      return;
    }
    const heavy = attack.kind === 'heavy';
    const range = heavy ? DUEL_RULES.heavyRange : DUEL_RULES.lightRange;
    const arc = heavy ? DUEL_RULES.heavyArc : DUEL_RULES.lightArc;
    const damage = heavy ? DUEL_RULES.heavyDamage : DUEL_RULES.lightDamage[attack.step];
    for (const target of fighters) {
      if (target === fighter || !target.alive) continue;
      if (!inArc({ ...fighter, yaw: fighter.yaw }, target, arc, range)) continue;
      this.strike(fighter, target, attack.kind, damage);
    }
  }

  private invulnerable(target: Fighter): boolean {
    return this.elapsed >= target.iFrom && this.elapsed < target.iUntil;
  }

  /** Un coup arrive : esquivé, paré, bloqué, garde brisée ou touché. */
  private strike(attacker: Fighter, target: Fighter, kind: AttackKind, damage: number): void {
    const dirX = target.x - attacker.x;
    const dirZ = target.z - attacker.z;
    const length = Math.hypot(dirX, dirZ) || 1;
    const fx = (fxKind: DuelFx['kind'], dealt: number) => this.broadcast('fx', {
      kind: fxKind, attacker: attacker.seat, target: target.seat, attack: kind, damage: Math.round(dealt),
      x: Math.round((attacker.x + target.x) / 2), z: Math.round((attacker.z + target.z) / 2),
      dirX: dirX / length, dirZ: dirZ / length,
    } satisfies DuelFx);

    if (this.invulnerable(target)) {
      fx('evade', 0);
      return;
    }
    const heavy = kind === 'heavy';
    const guarding = target.state === 'guard' && inArc(target, attacker, DUEL_RULES.guardArc, Infinity);
    if (guarding) {
      if (this.elapsed - target.guardSince <= DUEL_RULES.parryWindowMs && kind !== 'throw') {
        // Parade : l'attaquant chancelle, ouvert à la riposte.
        attacker.attack = null;
        attacker.dodge = null;
        attacker.lockUntil = this.elapsed + DUEL_RULES.parryStunMs;
        this.setFighterState(attacker, 'stagger');
        attacker.stateSince = this.elapsed;
        target.stamina = Math.min(DUEL_RULES.maxStamina, target.stamina + 15);
        this.freeze(attacker, target, DUEL_RULES.hitstopMs * 1.6);
        fx('parry', 0);
        return;
      }
      const cost = heavy ? DUEL_RULES.guardCostHeavy : kind === 'throw' ? DUEL_RULES.guardCostThrow : DUEL_RULES.guardCostLight;
      this.spend(target, cost);
      const chip = damage * DUEL_RULES.guardChip;
      this.damage(target, chip);
      if (target.stamina <= 0) {
        // Garde brisée : chancelle, la prochaine frappe fait mal.
        target.lockUntil = this.elapsed + DUEL_RULES.guardBreakMs;
        this.setFighterState(target, 'stagger');
        target.stateSince = this.elapsed;
        target.knock = { x: dirX / length * 120, z: dirZ / length * 120, until: this.elapsed + 260 };
        this.freeze(attacker, target, DUEL_RULES.hitstopMs * 1.4);
        fx('guardbreak', chip);
      } else {
        target.knock = { x: dirX / length * (heavy ? 140 : 70), z: dirZ / length * (heavy ? 140 : 70), until: this.elapsed + 180 };
        this.freeze(attacker, target, DUEL_RULES.hitstopMs * 0.6);
        fx('block', chip);
      }
      return;
    }

    const stunned = target.state === 'stagger';
    const dealt = damage * (stunned ? DUEL_RULES.stunBonus : 1);
    // Touché pendant la gorgée : la mixture est perdue.
    target.healAt = null;
    target.attack = null;
    target.dodge = null;
    target.buffered = null;
    this.damage(target, dealt);
    if (target.alive) {
      const hurt = heavy || stunned ? DUEL_RULES.hurtHeavyMs : DUEL_RULES.hurtLightMs;
      target.lockUntil = this.elapsed + hurt;
      target.stateSince = this.elapsed;
      target.state = 'hurt';
      target.step = heavy || stunned ? 1 : 0;
      const push = (heavy ? DUEL_RULES.knockHeavy : DUEL_RULES.knockLight) * 8;
      target.knock = { x: dirX / length * push, z: dirZ / length * push, until: this.elapsed + 260 };
    }
    this.freeze(attacker, target, heavy ? DUEL_RULES.hitstopMs * 1.5 : DUEL_RULES.hitstopMs);
    fx('hit', dealt);
  }

  /** Gel d'impact sur les deux corps : le coup se sent. */
  private freeze(attacker: Fighter, target: Fighter, ms: number): void {
    for (const fighter of [attacker, target]) {
      fighter.hitstopUntil = this.elapsed + ms;
      fighter.lockUntil = Math.max(fighter.lockUntil, this.elapsed) + ms;
      if (fighter.attack) {
        fighter.attack.until += ms;
        fighter.attack.chainAt += ms;
      }
      if (fighter.dodge) fighter.dodge.start += ms;
      if (fighter.knock) fighter.knock.until += ms;
    }
  }

  private damage(target: Fighter, amount: number): void {
    target.hp = clamp(target.hp - amount, 0, DUEL_RULES.maxHp);
    if (target.totem) this.dropTotem(target);
    if (target.hp <= 0) {
      target.alive = false;
      target.attack = null;
      target.dodge = null;
      target.healAt = null;
      target.stateSince = this.elapsed;
      target.state = 'dead';
    }
  }

  private finishHeal(fighter: Fighter): void {
    if (fighter.healAt === null || !fighter.alive || this.elapsed < fighter.healAt) return;
    fighter.healAt = null;
    fighter.hp = Math.min(DUEL_RULES.maxHp, fighter.hp + DUEL_RULES.healAmount);
    this.broadcast('fx', {
      kind: 'heal', attacker: fighter.seat, target: fighter.seat, attack: 'light', damage: -DUEL_RULES.healAmount,
      x: Math.round(fighter.x), z: Math.round(fighter.z), dirX: 0, dirZ: 0,
    } satisfies DuelFx);
  }

  private resolveThrow(fighter: Fighter): void {
    const target = [...this.fighters.values()]
      .filter((other) => other !== fighter && other.alive)
      .filter((other) => inArc({ ...fighter }, other, DUEL_RULES.throwArc, DUEL_RULES.throwRange))
      .sort((a, b) => Math.hypot(a.x - fighter.x, a.z - fighter.z) - Math.hypot(b.x - fighter.x, b.z - fighter.z))[0];
    if (target) this.strike(fighter, target, 'throw', DUEL_RULES.throwDamage);
  }

  private dropTotem(fighter: Fighter): void {
    if (!fighter.totem) return;
    fighter.totem = false;
    this.state.totemCarrier = -1;
    this.state.totemHold = 0;
    this.state.totemX = Math.round(fighter.x * 10) / 10;
    this.state.totemZ = Math.round(fighter.z * 10) / 10;
    this.state.totemVisible = true;
  }

  private resetTotem(): void {
    this.state.totemCarrier = -1;
    this.state.totemHold = 0;
    this.state.totemX = 0;
    this.state.totemZ = 0;
    this.state.totemVisible = DUEL_RULES.totemEnabled;
    for (const fighter of this.fighters.values()) fighter.totem = false;
  }

  private updateTotem(dt: number): void {
    if (this.state.totemCarrier >= 0) {
      const carrier = [...this.fighters.values()].find((fighter) => fighter.seat === this.state.totemCarrier && fighter.alive);
      if (!carrier) {
        this.resetTotem();
        return;
      }
      this.state.totemX = Math.round(carrier.x * 10) / 10;
      this.state.totemZ = Math.round(carrier.z * 10) / 10;
      this.state.totemHold = Math.min(DUEL_RULES.totemHoldMs, this.state.totemHold + dt);
      if (this.state.totemHold >= DUEL_RULES.totemHoldMs) this.finish(carrier.seat, 'totem rapporté');
      return;
    }
    const candidates = [...this.fighters.values()]
      .filter((fighter) => fighter.alive && this.elapsed >= fighter.hitstopUntil
        && Math.hypot(fighter.x - this.state.totemX, fighter.z - this.state.totemZ) <= DUEL_RULES.totemPickupRange)
      .sort((a, b) => Math.hypot(a.x - this.state.totemX, a.z - this.state.totemZ)
        - Math.hypot(b.x - this.state.totemX, b.z - this.state.totemZ));
    const picked = candidates[0];
    if (!picked) return;
    picked.totem = true;
    this.state.totemCarrier = picked.seat;
    this.state.totemHold = 0;
  }

  private costOf(action: DuelAction): number {
    if (action === 'light') return DUEL_RULES.lightCost;
    if (action === 'heavy') return DUEL_RULES.heavyCost;
    if (action === 'dodge') return DUEL_RULES.dodgeCost;
    if (action === 'throw') return DUEL_RULES.throwCost;
    return DUEL_RULES.healCost;
  }

  private syncState(fighter: Fighter, player: DuelPlayerState): void {
    player.x = Math.round(fighter.x * 10) / 10;
    player.z = Math.round(fighter.z * 10) / 10;
    player.yaw = Math.round(fighter.yaw * 1000) / 1000;
    player.state = fighter.state;
    player.actionMs = Math.round(this.elapsed - fighter.stateSince);
    player.step = fighter.step;
    player.hp = Math.round(fighter.hp);
    player.stamina = Math.round(fighter.stamina);
    player.alive = fighter.alive;
    player.heals = fighter.heals;
    player.totem = fighter.totem;
    player.ack = fighter.lastSeq;
  }

  private finish(winner: number, reason: string): void {
    if (this.state.phase === 'finished') return;
    this.state.phase = 'finished';
    // Une arène terminée ne doit plus attirer un inconnu en duel aléatoire.
    void this.lock();
    this.state.winner = winner;
    this.state.reason = reason;
    this.state.remaining = 0;
    this.broadcast('finish', { winner, reason });
  }
}

export function duelFacing(yaw: number): { x: number; z: number } {
  return facing(yaw);
}
