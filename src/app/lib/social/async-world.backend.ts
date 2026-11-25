import { InjectionToken } from '@angular/core';
import { FORD_DUEL, SLUICE_DUEL } from '../engine/duel-fog';
import { sceneryRandom } from '../constants/scenery';

/**
 * Multijoueur asynchrone « léger » : messages au sol, taches de sang et
 * fantômes d'autres voyageurs. Tout passe par AsyncWorldBackend ; seule une
 * implémentation locale (localStorage + voyageurs simulés) existe pour
 * l'instant. Aucune donnée ne quitte le navigateur. Un backend distant
 * (Supabase, Firebase, API maison…) n'aura qu'à implémenter cette interface
 * et à être fourni via ASYNC_WORLD_BACKEND.
 */

export type ZoneId = 'ford' | 'village' | 'sluice';

/** Échantillon de position, pris toutes les 0,5 s. `a` : 0 marche, 1 frappe, 2 roulade. */
export interface TracePoint { x: number; y: number; fx: number; fy: number; a: 0 | 1 | 2 }

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

export interface Bloodstain {
  id: string;
  zone: ZoneId;
  x: number;
  y: number;
  /** Les dernières secondes avant la chute, rejouées par le fantôme rouge. */
  path: TracePoint[];
  createdAt: number;
  mine?: boolean;
}

export interface GhostRun {
  id: string;
  zone: ZoneId;
  path: TracePoint[];
  createdAt: number;
  mine?: boolean;
}

export interface ZoneSnapshot {
  messages: GroundMessage[];
  stains: Bloodstain[];
  ghosts: GhostRun[];
}

export interface AsyncWorldBackend {
  /** 'local' : rien n'est envoyé hors du navigateur. */
  readonly kind: 'local' | 'remote';
  fetchZone(zone: ZoneId): Promise<ZoneSnapshot>;
  postMessage(message: Pick<GroundMessage, 'zone' | 'x' | 'y' | 'template' | 'word'>): Promise<GroundMessage>;
  rateMessage(id: string): Promise<void>;
  postBloodstain(stain: Pick<Bloodstain, 'zone' | 'x' | 'y' | 'path'>): Promise<void>;
  postGhost(ghost: Pick<GhostRun, 'zone' | 'path'>): Promise<void>;
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

const LIMITS = { messages: 40, stains: 16, ghosts: 6, path: 240 };

interface Store { messages: GroundMessage[]; stains: Bloodstain[]; ghosts: GhostRun[]; seeded?: number }

/** Implémentation locale : localStorage, plus quelques voyageurs simulés. */
export class LocalAsyncBackend implements AsyncWorldBackend {
  readonly kind = 'local' as const;
  private readonly key = 'terre-rouge.async-world.v1';
  private cache?: Store;

  constructor(private readonly storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage) {}

  async fetchZone(zone: ZoneId): Promise<ZoneSnapshot> {
    const store = this.load();
    return {
      messages: store.messages.filter((m) => m.zone === zone),
      stains: store.stains.filter((s) => s.zone === zone),
      ghosts: store.ghosts.filter((g) => g.zone === zone),
    };
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

  async postBloodstain(input: Pick<Bloodstain, 'zone' | 'x' | 'y' | 'path'>) {
    const stain: Bloodstain = { ...input, path: input.path.slice(-LIMITS.path), id: uid(), createdAt: Date.now(), mine: true };
    this.mutate((store) => { store.stains = keepLatest([...store.stains, stain], LIMITS.stains); });
  }

  async postGhost(input: Pick<GhostRun, 'zone' | 'path'>) {
    const ghost: GhostRun = { ...input, path: input.path.slice(-LIMITS.path), id: uid(), createdAt: Date.now(), mine: true };
    this.mutate((store) => { store.ghosts = keepLatest([...store.ghosts, ghost], LIMITS.ghosts); });
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
    if (!store || !Array.isArray(store.messages)) store = { messages: [], stains: [], ghosts: [] };
    if (!store.seeded) {
      const seed = simulatedTravellers();
      store.messages.push(...seed.messages);
      store.stains.push(...seed.stains);
      store.ghosts.push(...seed.ghosts);
      store.seeded = 1;
    }
    this.cache = store;
    this.save();
    return store;
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

/**
 * Voyageurs simulés : quelques traces déterministes pour que le monde ne soit
 * pas vide au premier lancement (avant qu'un vrai backend existe).
 */
export function simulatedTravellers(): Store {
  const random = sceneryRandom(90417);
  const old = Date.now() - 86_400_000;
  const wander = (cx: number, cy: number, radius: number, steps: number, fighting: boolean): TracePoint[] => {
    let angle = random() * Math.PI * 2;
    let distance = radius * (0.4 + random() * 0.4);
    const path: TracePoint[] = [];
    for (let i = 0; i < steps; i++) {
      angle += (random() - 0.4) * 0.5;
      distance = Math.max(radius * 0.25, Math.min(radius * 0.85, distance + (random() - 0.5) * 24));
      const x = cx + Math.cos(angle) * distance;
      const y = cy + Math.sin(angle) * distance;
      const prev = path.at(-1);
      const dx = prev ? x - prev.x : 1;
      const dy = prev ? y - prev.y : 0;
      const len = Math.hypot(dx, dy) || 1;
      const roll = random();
      path.push({ x, y, fx: dx / len, fy: dy / len, a: fighting && roll > 0.82 ? 2 : fighting && roll > 0.62 ? 1 : 0 });
    }
    return path;
  };
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
  const stains: Bloodstain[] = [];
  const ghosts: GhostRun[] = [];
  for (const [zone, arena] of [['ford', FORD_DUEL], ['sluice', SLUICE_DUEL]] as const) {
    for (let i = 0; i < 3; i++) {
      const path = wander(arena.x, arena.y, arena.radius, 16, true);
      const last = path.at(-1)!;
      stains.push({ id: `sim-s-${zone}${i}`, zone, x: last.x, y: last.y, path, createdAt: old - i });
    }
    ghosts.push({ id: `sim-g-${zone}`, zone, path: wander(arena.x, arena.y, arena.radius, 90, true), createdAt: old });
  }
  ghosts.push({ id: 'sim-g-village', zone: 'village', path: wander(1000, 760, 260, 120, false), createdAt: old });
  return { messages, stains, ghosts };
}

export const ASYNC_WORLD_BACKEND = new InjectionToken<AsyncWorldBackend>('ASYNC_WORLD_BACKEND', {
  providedIn: 'root',
  factory: () => new LocalAsyncBackend(),
});
