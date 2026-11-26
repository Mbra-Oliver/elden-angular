import { DestroyRef, Injectable, NgZone, computed, inject, signal } from '@angular/core';
import type { Client, Room } from 'colyseus.js';
import type { DuelAction, DuelFx, DuelInput, DuelPhase, DuelPose } from './duel-rules';
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
  totemCarrier: number;
  totemHold: number;
  totemX: number;
  totemZ: number;
  totemVisible: boolean;
  /** Sièges qui ont demandé la revanche. */
  rematch: readonly number[];
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
  totemCarrier: number;
  totemHold: number;
  totemX: number;
  totemZ: number;
  totemVisible: boolean;
  rematch?: ArrayLike<number>;
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
  totemCarrier: -1,
  totemHold: 0,
  totemX: 0,
  totemZ: 0,
  totemVisible: true,
  rematch: [],
  players: { 0: null, 1: null },
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Code court, sans 0/O ni 1/I, facile à dicter : « KTR-4M ». */
function makeCode(): string {
  const values = crypto.getRandomValues(new Uint32Array(5));
  const raw = Array.from(values, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('');
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

/** Accepte « ktr4m », « KTR 4M », « ktr-4m » : même code. */
export function normalizeCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.length > 3 ? `${clean.slice(0, 3)}-${clean.slice(3, 5)}` : clean;
}

function friendlyError(error: unknown): string {
  console.warn('[duel] connexion refusée', error);
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/no rooms found/i.test(message)) return 'Aucun duel ouvert avec ce code. Vérifie-le, ou demande à ton ami d’en ouvrir un.';
  if (/locked|full|pleine/i.test(message)) return 'Ce duel est déjà complet.';
  return 'Serveur de duel injoignable. Lance « npm run start:duel » sur l’ordinateur hôte et ouvre le jeu depuis l’adresse qu’il affiche.';
}

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
    actionMs: player.actionMs ?? 0,
    step: player.step ?? 0,
    hp: player.hp,
    stamina: player.stamina,
    alive: player.alive,
    heals: player.heals,
    totem: !!player.totem,
    cosmetics: player.cosmetics ?? [],
    ack: player.ack ?? 0,
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
  private fxSeq = 0;

  readonly status = signal<DuelStatus>('idle');
  readonly mode = signal<'private' | 'public'>('private');
  readonly error = signal('');
  readonly snapshot = signal<DuelSnapshot>(EMPTY);
  readonly seat = signal<0 | 1>(0);
  readonly fx = signal<DuelFx | null>(null);
  readonly me = computed(() => this.seat());
  readonly connected = computed(() => this.status() === 'connected');
  /** Adresse à ouvrir sur l'autre appareil (IP Wi-Fi de l'hôte), avec le code du salon. */
  readonly inviteUrl = signal('');
  private ownSeatValue: 0 | 1 = 0;
  private lanOrigin = '';

  constructor() {
    this.destroyRef.onDestroy(() => void this.leave());
  }

  async create(): Promise<void> {
    await this.connect('create', makeCode(), 'private');
  }

  async join(code: string): Promise<void> {
    await this.connect('join', normalizeCode(code), 'private');
  }

  async quickMatch(): Promise<void> {
    await this.connect('joinOrCreate', '', 'public');
  }

  requestRematch(): void {
    this.room?.send('rematch');
  }

  sendInput(input: Omit<DuelInput, 'seq'>): number {
    if (!this.room) return 0;
    this.seq += 1;
    this.room.send('input', { ...input, seq: this.seq });
    return this.seq;
  }

  sendActions(actions: DuelAction[]): void {
    const pose = this.snapshot().players[this.ownSeatValue];
    if (!pose) return;
    this.sendInput({ moveX: 0, moveZ: 0, yaw: pose.yaw, actions, guard: false });
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.client = null;
    this.status.set('idle');
    this.mode.set('private');
    this.error.set('');
    this.snapshot.set(EMPTY);
    this.fx.set(null);
    this.fxSeq = 0;
    this.inviteUrl.set('');
    this.ownSeatValue = 0;
    this.seat.set(0);
    this.seq = 0;
    if (room) await room.leave().catch(() => undefined);
  }

  /**
   * Le serveur local connaît ses adresses Wi-Fi : l'hôte qui joue sur
   * « localhost » partage ainsi une adresse que l'iPhone peut ouvrir.
   */
  private async resolveLanOrigin(): Promise<string> {
    if (this.lanOrigin) return this.lanOrigin;
    const local = ['localhost', '127.0.0.1', '[::1]', ''].includes(window.location.hostname);
    if (!local) return (this.lanOrigin = window.location.origin);
    try {
      const base = endpoint().replace(/^ws/, 'http');
      const info = await fetch(`${base}/duel-info`).then((response) => response.json()) as { addresses?: string[] };
      this.lanOrigin = info.addresses?.[0] ?? window.location.origin;
    } catch {
      this.lanOrigin = window.location.origin;
    }
    return this.lanOrigin;
  }

  private async connect(how: 'create' | 'join' | 'joinOrCreate', code: string, mode: 'private' | 'public'): Promise<void> {
    await this.leave();
    this.status.set('connecting');
    this.mode.set(mode);
    try {
      // colyseus.js est livré en CommonJS pour le navigateur : selon le
      // bundler, la classe est exportée directement ou sous « default ».
      const module = await import('colyseus.js') as typeof import('colyseus.js') & { default?: typeof import('colyseus.js') };
      const Client = (typeof module.Client === 'function' ? module.Client : module.default?.Client) as typeof import('colyseus.js').Client;
      this.client = new Client(endpoint());
      // Les salons sont filtrés par (mode, code) : « create » ouvre un salon à
      // ce code, « join » n'entre que dans un salon existant à ce code.
      const options = { code, mode, cosmetics: this.codex.entries().map((entry) => entry.id).slice(0, 8) };
      const room = how === 'create'
        ? await this.client.create<DuelRoomState>('duel', options)
        : how === 'join'
          ? await this.client.join<DuelRoomState>('duel', options)
          : await this.client.joinOrCreate<DuelRoomState>('duel', options);
      this.room = room;
      this.status.set('connected');
      if (mode === 'private') {
        const origin = await this.resolveLanOrigin();
        this.inviteUrl.set(`${origin}/?duel=${code}`);
      }
      room.onStateChange((state) => this.zone.run(() => this.apply(state)));
      room.onMessage<DuelFx>('fx', (message) => {
        this.zone.run(() => this.fx.set({ ...message, id: ++this.fxSeq }));
      });
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
      // L'état complet arrive juste après la connexion (souvent plus tard sur
      // Safari/iPhone) : on ne le lit que s'il est déjà là.
      if (room.state?.players) this.apply(room.state);
    } catch (error) {
      this.status.set('error');
      this.error.set(friendlyError(error));
    }
  }

  private apply(state: DuelRoomState): void {
    if (!state?.players) return;
    // Le siège se lit dans l'état synchronisé : à la connexion, la liste des
    // joueurs peut encore être vide côté client.
    const own = this.room ? state.players.find((player) => player.sessionId === this.room?.sessionId) : undefined;
    if (own && own.seat !== this.ownSeatValue) {
      this.ownSeatValue = own.seat === 1 ? 1 : 0;
      this.seat.set(this.ownSeatValue);
    }
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
      totemCarrier: state.totemCarrier,
      totemHold: state.totemHold,
      totemX: state.totemX,
      totemZ: state.totemZ,
      totemVisible: state.totemVisible,
      rematch: Array.from(state.rematch ?? []),
      players: { 0: toPose(seat0), 1: toPose(seat1) },
    });
  }
}
