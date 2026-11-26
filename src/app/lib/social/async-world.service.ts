import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { FORD_DUEL, SLUICE_DUEL } from '../engine/duel-fog';
import { PlayerEntity } from '../entities/player/player.entity';
import { GameLoopService } from '../services/game-loop.service';
import { GameStateService } from '../services/game-state.service';
import { ASYNC_WORLD_BACKEND, GroundMessage, ZoneId, messageText } from './async-world.backend';

const READ_RADIUS = 30;
/** Recherche du message le plus proche : 10 fois par seconde suffit. */
const PROXIMITY_STEP = 0.1;

export function zoneAt(x: number, y: number): ZoneId {
  if ((x - FORD_DUEL.x) ** 2 + (y - FORD_DUEL.y) ** 2 < (FORD_DUEL.radius + 40) ** 2) return 'ford';
  if ((x - SLUICE_DUEL.x) ** 2 + (y - SLUICE_DUEL.y) ** 2 < (SLUICE_DUEL.radius + 40) ** 2) return 'sluice';
  return 'village';
}

/**
 * Pont entre la partie et le backend asynchrone : charge les messages au sol
 * de la zone courante et gère leur lecture / écriture. (Plus de fantômes ni
 * de taches de sang des anciens joueurs.)
 */
@Injectable({ providedIn: 'root' })
export class AsyncWorldService {
  private readonly backend = inject(ASYNC_WORLD_BACKEND);
  private readonly loop = inject(GameLoopService);
  private readonly game = inject(GameStateService);
  private readonly player = inject(PlayerEntity);

  readonly offline = this.backend.kind === 'local';
  readonly zone = signal<ZoneId | null>(null);
  /** Données de la zone (tableaux simples, lus à chaque image par la couche 3D). */
  messages: GroundMessage[] = [];
  /** Incrémenté quand les données de zone changent (la couche 3D se reconstruit). */
  revision = 0;

  readonly nearMessage = signal<GroundMessage | null>(null);
  readonly nearMessageText = computed(() => {
    const message = this.nearMessage();
    return message ? messageText(message) : null;
  });
  readonly composing = signal(false);
  readonly notice = signal<string | null>(null);

  private proximityClock = 0;
  private attached = false;
  private rated = new Set<string>();
  private noticeTimer?: ReturnType<typeof setTimeout>;
  private readonly tick = (dt: number) => this.update(dt);

  constructor() {
    // Fin de partie : la boucle s'arrête dans la même image, d'où l'effet.
    effect(() => {
      const screen = this.game.currentScreen();
      untracked(() => {
        if (screen !== 'playing') this.zone.set(null);
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
    this.loop.offUpdate(this.tick);
    this.attached = false;
    this.zone.set(null);
    this.nearMessage.set(null);
  }

  /** Bouton « interagir » hors dialogue : apprécie un message. */
  interact(): boolean {
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
    this.proximityClock += dt;
    if (this.proximityClock < PROXIMITY_STEP) return;
    this.proximityClock = 0;
    const x = this.player.centerX;
    const y = this.player.centerY;
    const zone = zoneAt(x, y);
    if (zone !== this.zone()) this.enterZone(zone);
    const message = nearest(this.messages, x, y, READ_RADIUS);
    if (message !== this.nearMessage()) this.nearMessage.set(message);
  }

  private enterZone(zone: ZoneId) {
    this.zone.set(zone);
    this.messages = [];
    this.revision++;
    void this.backend.fetchZone(zone).then((snapshot) => {
      if (this.zone() !== zone) return;
      this.messages = snapshot.messages;
      this.revision++;
    });
  }

  private say(text: string) {
    this.notice.set(text);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.notice.set(null), 2200);
  }
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
