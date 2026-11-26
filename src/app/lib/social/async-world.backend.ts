import { InjectionToken } from '@angular/core';
import { FORD_DUEL, SLUICE_DUEL } from '../engine/duel-fog';

/**
 * Monde partagé « léger » : messages tracés au sol par les voyageurs. Tout
 * passe par AsyncWorldBackend ; seule une implémentation locale
 * (localStorage + quelques messages simulés) existe pour l'instant. Aucune
 * donnée ne quitte le navigateur. Les fantômes et taches de sang des anciens
 * joueurs ont été retirés (demande joueur, 2026-11-26) : on ne garde ni ne
 * rejoue plus leurs trajets.
 */

export type ZoneId = 'ford' | 'village' | 'sluice';

export interface GroundMessage {
  id: string;
  zone: ZoneId;
  x: number;
  y: number;
  template: number;
  word: number;
  likes: number;
  createdAt: number;
  /** Écrit par ce navigateur (sinon : voyageur simulé ou distant). */
  mine?: boolean;
}

export interface ZoneSnapshot {
  messages: GroundMessage[];
}

export interface AsyncWorldBackend {
  /** 'local' : rien n'est envoyé hors du navigateur. */
  readonly kind: 'local' | 'remote';
  fetchZone(zone: ZoneId): Promise<ZoneSnapshot>;
  postMessage(message: Pick<GroundMessage, 'zone' | 'x' | 'y' | 'template' | 'word'>): Promise<GroundMessage>;
  rateMessage(id: string): Promise<void>;
}

export const MESSAGE_TEMPLATES = [
  '{} en avant',
  'Attention à {}',
  'Essaie {}',
  'Il faut {}',
  'Pas besoin de {}',
  'Courage face à {}',
  'Voici {}',
  'Si seulement j’avais {}',
] as const;

export const MESSAGE_WORDS = [
  'l’esquive', 'la riposte', 'la lance', 'l’arc', 'la mixture de soin', 'la patience',
  'la charge', 'la vague', 'le flanc gauche', 'le flanc droit', 'la fuite',
  'Kofi', 'le Gardien', 'l’eau', 'un piège', 'un ami',
] as const;

export function messageText(message: Pick<GroundMessage, 'template' | 'word'>) {
  const template = MESSAGE_TEMPLATES[message.template] ?? MESSAGE_TEMPLATES[0];
  const word = MESSAGE_WORDS[message.word] ?? MESSAGE_WORDS[0];
  const text = template.replace('{}', word);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const LIMITS = { messages: 40 };

interface Store { messages: GroundMessage[]; seeded?: number }

/** Implémentation locale : localStorage, plus quelques messages simulés. */
export class LocalAsyncBackend implements AsyncWorldBackend {
  readonly kind = 'local' as const;
  private readonly key = 'terre-rouge.async-world.v1';
  private cache?: Store;

  constructor(private readonly storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage) {}

  async fetchZone(zone: ZoneId): Promise<ZoneSnapshot> {
    return { messages: this.load().messages.filter((m) => m.zone === zone) };
  }

  async postMessage(input: Pick<GroundMessage, 'zone' | 'x' | 'y' | 'template' | 'word'>) {
    const message: GroundMessage = { ...input, id: uid(), likes: 0, createdAt: Date.now(), mine: true };
    this.mutate((store) => { store.messages = keepLatest([...store.messages, message], LIMITS.messages); });
    return message;
  }

  async rateMessage(id: string) {
    this.mutate((store) => {
      const message = store.messages.find((m) => m.id === id);
      if (message) message.likes++;
    });
  }

  private load(): Store {
    if (this.cache) return this.cache;
    let store: Store | null = null;
    try {
      const raw = this.storage?.getItem(this.key);
      if (raw) store = JSON.parse(raw) as Store;
    } catch {
      store = null;
    }
    if (!store || !Array.isArray(store.messages)) store = { messages: [] };
    if (!store.seeded) {
      store.messages.push(...simulatedTravellers().messages);
      store.seeded = 1;
    }
    // Anciennes sauvegardes : les trajets des fantômes et des taches de sang
    // (plusieurs centaines de points) sont effacés de l'appareil.
    this.cache = { messages: store.messages, seeded: store.seeded };
    this.save();
    return this.cache;
  }

  private mutate(change: (store: Store) => void) {
    change(this.load());
    this.save();
  }

  private save() {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.cache));
    } catch {
      // Stockage plein ou désactivé : le monde reste en mémoire pour la session.
    }
  }
}

/** Garde les entrées les plus récentes. */
function keepLatest<T extends { createdAt: number }>(items: T[], limit: number) {
  return items.length <= limit ? items : [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

function uid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Messages simulés : le monde n'est pas vide au premier lancement (avant qu'un vrai backend existe). */
export function simulatedTravellers(): Store {
  const old = Date.now() - 86_400_000;
  const messages: GroundMessage[] = [
    { zone: 'ford', x: FORD_DUEL.x - 150, y: FORD_DUEL.y + 40, template: 2, word: 0, likes: 31 },
    { zone: 'ford', x: FORD_DUEL.x + 60, y: FORD_DUEL.y + 150, template: 1, word: 6, likes: 18 },
    { zone: 'ford', x: FORD_DUEL.x - 60, y: FORD_DUEL.y - 160, template: 3, word: 5, likes: 7 },
    { zone: 'village', x: 790, y: 820, template: 6, word: 15, likes: 12 },
    { zone: 'village', x: 1180, y: 700, template: 7, word: 4, likes: 22 },
    { zone: 'village', x: 1240, y: 830, template: 0, word: 12, likes: 40 },
    { zone: 'sluice', x: SLUICE_DUEL.x - 200, y: SLUICE_DUEL.y + 60, template: 1, word: 7, likes: 27 },
    { zone: 'sluice', x: SLUICE_DUEL.x - 120, y: SLUICE_DUEL.y - 140, template: 2, word: 1, likes: 15 },
  ].map((m, i) => ({ ...m, zone: m.zone as ZoneId, id: `sim-m${i}`, createdAt: old - i * 1000 }));
  return { messages };
}

export const ASYNC_WORLD_BACKEND = new InjectionToken<AsyncWorldBackend>('ASYNC_WORLD_BACKEND', {
  providedIn: 'root',
  factory: () => new LocalAsyncBackend(),
});
