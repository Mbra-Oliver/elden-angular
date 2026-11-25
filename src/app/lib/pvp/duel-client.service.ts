import { DestroyRef, Injectable, NgZone, computed, inject, signal } from '@angular/core';
import type { Client, Room } from 'colyseus.js';
import type { DuelAction, DuelInput, DuelPhase, DuelPose } from './duel-rules';
import { CodexService } from '../platform/codex.service';

export type DuelStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface DuelSnapshot {
  phase: DuelPhase;
  mode: 'public' | 'private';
  code: string;
  countdown: number;
  remaining: number;
  winner: number;
  reason: string;
  players: Record<0 | 1, DuelPose | null>;
}

interface DuelRoomState {
  phase: DuelPhase;
  mode: 'public' | 'private';
  code: string;
  countdown: number;
  remaining: number;
  winner: number;
  reason: string;
  players: Array<DuelPose & { seat: number; sessionId: string }>;
}

const EMPTY: DuelSnapshot = {
  phase: 'waiting',
  mode: 'private',
  code: '',
  countdown: 0,
  remaining: 0,
  winner: -1,
  reason: '',
  players: { 0: null, 1: null },
};

function endpoint(): string {
  const override = new URLSearchParams(window.location.search).get('duelServer');
  if (override) return override;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname || 'localhost'}:3001`;
}

function toPose(player: DuelRoomState['players'][number] | undefined): DuelPose | null {
  if (!player) return null;
  return {
    x: player.x,
    z: player.z,
    yaw: player.yaw,
    state: player.state,
    hp: player.hp,
    stamina: player.stamina,
    alive: player.alive,
    heals: player.heals,
    cosmetics: player.cosmetics ?? [],
  };
}

@Injectable({ providedIn: 'root' })
export class DuelClientService {
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly codex = inject(CodexService);
  private client: Client | null = null;
  private room: Room<DuelRoomState> | null = null;
  private seq = 0;

  readonly status = signal<DuelStatus>('idle');
  readonly mode = signal<'private' | 'public'>('private');
  readonly error = signal('');
  readonly snapshot = signal<DuelSnapshot>(EMPTY);
  readonly seat = signal<0 | 1>(0);
  readonly me = computed(() => this.seat());
  readonly connected = computed(() => this.status() === 'connected');
  private ownSeatValue: 0 | 1 = 0;

  constructor() {
    this.destroyRef.onDestroy(() => void this.leave());
  }

  async create(): Promise<void> {
    await this.connect('', 'private');
  }

  async join(code: string): Promise<void> {
    await this.connect(code.trim().toUpperCase(), 'private');
  }

  async quickMatch(): Promise<void> {
    await this.connect('', 'public');
  }

  sendInput(input: Omit<DuelInput, 'seq'>): void {
    if (!this.room) return;
    this.seq += 1;
    this.room.send('input', { ...input, seq: this.seq });
  }

  sendActions(actions: DuelAction[]): void {
    const pose = this.snapshot().players[this.ownSeatValue];
    if (!pose) return;
    this.sendInput({ moveX: 0, moveZ: 0, yaw: pose.yaw, actions });
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.client = null;
    this.status.set('idle');
    this.mode.set('private');
    this.error.set('');
    this.snapshot.set(EMPTY);
    this.ownSeatValue = 0;
    this.seat.set(0);
    this.seq = 0;
    if (room) await room.leave().catch(() => undefined);
  }

  private ownSeat(): 0 | 1 {
    return this.ownSeatValue;
  }

  private async connect(code: string, mode: 'private' | 'public'): Promise<void> {
    await this.leave();
    this.status.set('connecting');
    this.mode.set(mode);
    try {
      const { Client } = await import('colyseus.js');
      this.client = new Client(endpoint());
      const room = await this.client.joinOrCreate<DuelRoomState>('duel', {
        code,
        mode,
        cosmetics: this.codex.entries().map((entry) => entry.id).slice(0, 8),
      });
      this.room = room;
      this.status.set('connected');
      this.ownSeatValue = room.sessionId === room.state.players[0]?.sessionId ? 0 : 1;
      this.seat.set(this.ownSeatValue);
      room.onStateChange((state) => this.zone.run(() => this.apply(state)));
      room.onMessage<{ winner: number; reason: string }>('finish', (message) => {
        this.zone.run(() => {
          this.snapshot.update((current) => ({ ...current, winner: message.winner, reason: message.reason }));
        });
      });
      room.onLeave((code) => {
        this.zone.run(() => {
          if (code !== 0) this.error.set('Connexion perdue.');
          this.status.set('idle');
          this.room = null;
        });
      });
      room.onError((_code, message) => this.zone.run(() => this.error.set(message ?? 'Erreur de connexion.')));
      this.apply(room.state);
    } catch (error) {
      this.status.set('error');
      this.error.set(error instanceof Error ? error.message : 'Serveur de duel indisponible.');
    }
  }

  private apply(state: DuelRoomState): void {
    const seat0 = state.players.find((player) => player.seat === 0);
    const seat1 = state.players.find((player) => player.seat === 1);
    this.snapshot.set({
      phase: state.phase,
      mode: state.mode,
      code: state.code,
      countdown: state.countdown,
      remaining: state.remaining,
      winner: state.winner,
      reason: state.reason,
      players: { 0: toPose(seat0), 1: toPose(seat1) },
    });
  }
}
