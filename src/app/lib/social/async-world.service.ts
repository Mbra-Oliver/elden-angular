import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { FORD_DUEL, SLUICE_DUEL } from '../engine/duel-fog';
import { PlayerEntity } from '../entities/player/player.entity';
import { PlayerStore } from '../entities/player/player.store';
import { GameLoopService } from '../services/game-loop.service';
import { GameStateService } from '../services/game-state.service';
import {
  ASYNC_WORLD_BACKEND, Bloodstain, GhostRun, GroundMessage, TracePoint, ZoneId, messageText,
} from './async-world.backend';

/** Intervalle d'échantillonnage des fantômes (s). */
export const TRACE_STEP = 0.5;
const STAIN_PATH = 16; // 8 s rejouées par le fantôme rouge
const MAX_TRAIL = 240; // 2 min de fantôme blanc par zone
const READ_RADIUS = 30;
const TOUCH_RADIUS = 26;

export function zoneAt(x: number, y: number): ZoneId {
  if ((x - FORD_DUEL.x) ** 2 + (y - FORD_DUEL.y) ** 2 < (FORD_DUEL.radius + 40) ** 2) return 'ford';
  if ((x - SLUICE_DUEL.x) ** 2 + (y - SLUICE_DUEL.y) ** 2 < (SLUICE_DUEL.radius + 40) ** 2) return 'sluice';
  return 'village';
}

/** Rejeu demandé d'une tache de sang (lu par la couche 3D). */
export interface StainReplay { stain: Bloodstain; startedAt: number }

/**
 * Pont entre la partie et le backend asynchrone : enregistre la trace du
 * joueur, dépose taches de sang et fantômes, charge ceux de la zone
 * courante et gère la lecture / l'écriture des messages au sol.
 */
@Injectable({ providedIn: 'root' })
export class AsyncWorldService {
  private readonly backend = inject(ASYNC_WORLD_BACKEND);
  private readonly loop = inject(GameLoopService);
  private readonly game = inject(GameStateService);
  private readonly player = inject(PlayerEntity);
  private readonly playerStore = inject(PlayerStore);

  readonly offline = this.backend.kind === 'local';
  readonly zone = signal<ZoneId | null>(null);
  /** Données de la zone (tableaux simples, lus à chaque image par la couche 3D). */
  messages: GroundMessage[] = [];
  stains: Bloodstain[] = [];
  ghosts: GhostRun[] = [];
  replay: StainReplay | null = null;
  /** Incrémenté quand les données de zone changent (la couche 3D se reconstruit). */
  revision = 0;

  readonly nearMessage = signal<GroundMessage | null>(null);
  readonly nearStain = signal<Bloodstain | null>(null);
  readonly nearMessageText = computed(() => {
    const message = this.nearMessage();
    return message ? messageText(message) : null;
  });
  readonly composing = signal(false);
  readonly notice = signal<string | null>(null);

  private trail: TracePoint[] = [];
  private sampleClock = 0;
  private attached = false;
  private rated = new Set<string>();
  private noticeTimer?: ReturnType<typeof setTimeout>;
  private readonly tick = (dt: number) => this.update(dt);

  constructor() {
    // Fin de partie : la boucle s'arrête dans la même image, d'où l'effet.
    effect(() => {
      const screen = this.game.currentScreen();
      untracked(() => {
        if (screen === 'death') this.onDeath();
        else if (screen === 'victory' || screen === 'main-menu') this.flushGhost();
      });
    });
  }

  /** Branché par l'écran de jeu une fois le moteur prêt. */
  attach() {
    if (this.attached) return;
    this.attached = true;
    this.loop.onUpdate(this.tick);
  }

  detach() {
    this.flushGhost();
    this.loop.offUpdate(this.tick);
    this.attached = false;
    this.zone.set(null);
    this.replay = null;
    this.nearMessage.set(null);
    this.nearStain.set(null);
  }

  /** Bouton « interagir » hors dialogue : rejoue une tache ou apprécie un message. */
  interact(): boolean {
    const stain = this.nearStain();
    if (stain) {
      this.replay = { stain, startedAt: performance.now() };
      return true;
    }
    const message = this.nearMessage();
    if (message && !message.mine && !this.rated.has(message.id)) {
      this.rated.add(message.id);
      message.likes++;
      void this.backend.rateMessage(message.id);
      this.say('Message apprécié');
      return true;
    }
    return false;
  }

  async write(template: number, word: number) {
    const zone = this.zone();
    if (!zone) return;
    const message = await this.backend.postMessage({
      zone, x: this.player.centerX, y: this.player.centerY, template, word,
    });
    if (this.zone() === zone) {
      this.messages = [...this.messages, message];
      this.revision++;
    }
    this.say(this.offline ? 'Signe tracé (conservé sur cet appareil)' : 'Signe tracé');
  }

  private update(dt: number) {
    if (this.game.currentScreen() !== 'playing') return;
    const x = this.player.centerX;
    const y = this.player.centerY;
    const zone = zoneAt(x, y);
    if (zone !== this.zone()) this.enterZone(zone);

    this.sampleClock += dt;
    if (this.sampleClock >= TRACE_STEP) {
      this.sampleClock -= TRACE_STEP;
      const data = this.playerStore.getData();
      this.trail.push({
        x: Math.round(x), y: Math.round(y),
        fx: round2(data.facingX), fy: round2(data.facingY),
        a: data.state === 'rolling' ? 2 : data.state === 'attacking' ? 1 : 0,
      });
      if (this.trail.length > MAX_TRAIL) this.trail.shift();
    }

    const message = nearest(this.messages, x, y, READ_RADIUS);
    if (message !== this.nearMessage()) this.nearMessage.set(message);
    const stain = nearest(this.stains, x, y, TOUCH_RADIUS);
    if (stain !== this.nearStain()) this.nearStain.set(stain);
  }

  private enterZone(zone: ZoneId) {
    this.flushGhost();
    this.zone.set(zone);
    this.replay = null;
    this.messages = [];
    this.stains = [];
    this.ghosts = [];
    this.revision++;
    void this.backend.fetchZone(zone).then((snapshot) => {
      if (this.zone() !== zone) return;
      this.messages = snapshot.messages;
      this.stains = snapshot.stains;
      // Les fantômes les plus récents d'abord, trois au plus à l'écran.
      this.ghosts = [...snapshot.ghosts].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
      this.revision++;
    });
  }

  private onDeath() {
    const zone = this.zone();
    if (!zone) return;
    const path = this.trail.slice(-STAIN_PATH);
    const x = this.player.centerX;
    const y = this.player.centerY;
    path.push({ x: Math.round(x), y: Math.round(y), fx: 0, fy: 1, a: 0 });
    void this.backend.postBloodstain({ zone, x, y, path });
    this.flushGhost();
  }

  /** Dépose le fantôme blanc de la zone quittée (s'il est assez long). */
  private flushGhost() {
    const zone = this.zone();
    if (zone && this.trail.length >= 12) void this.backend.postGhost({ zone, path: this.trail });
    this.trail = [];
    this.sampleClock = 0;
    if (this.game.currentScreen() !== 'playing') this.zone.set(null);
  }

  private say(text: string) {
    this.notice.set(text);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.notice.set(null), 2200);
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function nearest<T extends { x: number; y: number }>(items: T[], x: number, y: number, radius: number): T | null {
  let best: T | null = null;
  let bestDistance = radius * radius;
  for (const item of items) {
    const distance = (item.x - x) ** 2 + (item.y - y) ** 2;
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}
