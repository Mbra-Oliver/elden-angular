import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { BossStore } from '../entities/bosses/boss.store';
import { EquipmentStore } from '../entities/player/equipment.store';
import { PlayerStore } from '../entities/player/player.store';
import { GameLoopService } from '../services/game-loop.service';
import { GameStateService } from '../services/game-state.service';

export type BossId = 'ford' | 'sluice';

export const BOSS_NAMES: Record<BossId, string> = {
  ford: 'Kofi Brempong',
  sluice: 'le Gardien de la retenue',
};

/** Résultat d'un combat de boss gagné, partageable par URL. */
export interface BossResult {
  boss: BossId;
  /** Durée du combat en millisecondes (temps de jeu, hors pauses). */
  time: number;
  hits: number;
  flasks: number;
}

export interface Challenge extends BossResult { v: 1 }

const UNLOCK_KEY = 'terre-rouge.boss-rush';
const RECORDS_KEY = 'terre-rouge.records.v1';
const PARAM = 'defi';

export function formatTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(total / 600);
  const seconds = Math.floor(total / 10) % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${total % 10}`;
}

export function encodeChallenge(result: BossResult) {
  const json = JSON.stringify({ v: 1, b: result.boss, t: Math.round(result.time), h: result.hits, f: result.flasks });
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeChallenge(code: string): Challenge | null {
  try {
    const padded = code.replace(/-/g, '+').replace(/_/g, '/');
    const raw = JSON.parse(atob(padded + '='.repeat((4 - padded.length % 4) % 4)));
    const boss = raw.b === 'ford' || raw.b === 'sluice' ? raw.b as BossId : null;
    const valid = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;
    if (raw.v !== 1 || !boss || !valid(raw.t, 3_600_000) || !valid(raw.h, 999) || !valid(raw.f, 99)) return null;
    return { v: 1, boss, time: raw.t, hits: Math.round(raw.h), flasks: Math.round(raw.f) };
  } catch {
    return null;
  }
}

export function describe(result: BossResult) {
  const hits = result.hits === 0 ? 'sans être touché' : `${result.hits} coup${result.hits > 1 ? 's' : ''} reçu${result.hits > 1 ? 's' : ''}`;
  const flasks = result.flasks === 0 ? 'sans Bandji' : `${result.flasks} Bandji`;
  return `${BOSS_NAMES[result.boss]} vaincu en ${formatTime(result.time)}, ${hits}, ${flasks}`;
}

/** Un résultat bat-il le défi ? Le temps compte d'abord, puis les coups reçus. */
export function beats(result: BossResult, target: BossResult) {
  return result.time < target.time || (result.time === target.time && result.hits <= target.hits);
}

/**
 * Chronomètre chaque combat de boss, produit les URL de défi
 * (`?defi=…`, sans aucune donnée personnelle), lit le défi reçu et garde le
 * déblocage du Boss Rush et les records sur cet appareil.
 */
@Injectable({ providedIn: 'root' })
export class ChallengeService {
  private readonly loop = inject(GameLoopService);
  private readonly game = inject(GameStateService);
  private readonly boss = inject(BossStore);
  private readonly player = inject(PlayerStore);
  private readonly equipment = inject(EquipmentStore);

  /** Défi reçu par l'URL d'ouverture. */
  readonly incoming = signal<Challenge | null>(readIncoming());
  /** Défi en cours (relevé depuis le menu). */
  readonly target = signal<Challenge | null>(null);
  readonly results = signal<BossResult[]>([]);
  readonly latest = signal<BossResult | null>(null);
  readonly rushUnlocked = signal(readFlag(UNLOCK_KEY));
  readonly fightTime = signal(0);
  readonly rushTotal = computed(() => this.results().reduce((sum, r) => sum + r.time, 0));
  readonly copied = signal<string | null>(null);

  private fight: { boss: BossId; time: number; hits: number; flasks: number; hp: number; bandji: number } | null = null;
  private latestTimer?: ReturnType<typeof setTimeout>;
  private readonly tick = (dt: number) => this.update(dt);

  constructor() {
    this.loop.onUpdate(this.tick);
    let previous = this.game.currentScreen();
    effect(() => {
      const screen = this.game.currentScreen();
      untracked(() => {
        if (screen === 'playing' && previous !== 'playing') {
          // Nouvelle partie : résultats remis à zéro, défi conservé seulement s'il est relevé.
          this.reset();
          if (this.game.mode() !== 'challenge') this.target.set(null);
        }
        previous = screen;
        if (screen === 'victory') {
          if (this.fight && this.boss.getData().state === 'dead') this.finish();
          if (this.game.mode() === 'story') this.unlockRush();
        }
        if (screen !== 'playing') this.fight = null;
      });
    });
  }

  /** Remis à zéro à chaque nouvelle partie. */
  reset() {
    this.results.set([]);
    this.latest.set(null);
    this.fight = null;
    this.fightTime.set(0);
  }

  accept(challenge: Challenge) {
    this.target.set(challenge);
    this.incoming.set(null);
    clearParam();
  }

  dismissIncoming() {
    this.incoming.set(null);
    clearParam();
  }

  clearTarget() {
    this.target.set(null);
  }

  shareUrl(result: BossResult) {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set(PARAM, encodeChallenge(result));
    return url.toString();
  }

  async share(result: BossResult) {
    const url = this.shareUrl(result);
    const text = `${describe(result)}. Fais mieux :`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Les Sentiers de Terre Rouge · Défi', text, url });
        return;
      }
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      this.copied.set(url);
    } catch {
      // Presse-papiers refusé : on affiche le lien pour copie manuelle.
      this.copied.set(url);
    }
  }

  record(boss: BossId) {
    return readRecords()[boss] ?? null;
  }

  private update(dt: number) {
    const encounter = this.game.encounter();
    if (this.game.currentScreen() !== 'playing' || !encounter) {
      this.fight = null;
      return;
    }
    const boss = this.boss.getData();
    const player = this.player.getData();
    const gear = this.equipment.getData();
    if (!this.fight || this.fight.boss !== encounter) {
      if (boss.state === 'dead') return;
      this.fight = { boss: encounter, time: 0, hits: 0, flasks: 0, hp: player.hp, bandji: gear.bandji };
    }
    const fight = this.fight;
    if (boss.state === 'dead') {
      this.finish();
      return;
    }
    // L'entrée cinématique du boss ne compte pas dans le chrono.
    if (this.game.introProgress !== null) return;
    fight.time += dt * 1000;
    if (player.hp < fight.hp) fight.hits++;
    if (gear.bandji < fight.bandji) fight.flasks++;
    fight.hp = player.hp;
    fight.bandji = gear.bandji;
    this.fightTime.set(fight.time);
  }

  private finish() {
    const fight = this.fight;
    if (!fight) return;
    this.fight = null;
    const result: BossResult = { boss: fight.boss, time: fight.time, hits: fight.hits, flasks: fight.flasks };
    this.results.update((list) => [...list, result]);
    this.latest.set(result);
    clearTimeout(this.latestTimer);
    this.latestTimer = setTimeout(() => this.latest.set(null), 12000);
    const records = readRecords();
    const best = records[fight.boss];
    if (!best || beats(result, best)) {
      records[fight.boss] = result;
      writeJson(RECORDS_KEY, records);
    }
  }

  private unlockRush() {
    if (this.rushUnlocked()) return;
    this.rushUnlocked.set(true);
    try { localStorage.setItem(UNLOCK_KEY, '1'); } catch { /* stockage indisponible */ }
  }
}

function readIncoming(): Challenge | null {
  if (typeof location === 'undefined') return null;
  const code = new URLSearchParams(location.search).get(PARAM);
  return code ? decodeChallenge(code) : null;
}

function clearParam() {
  if (typeof history === 'undefined') return;
  const url = new URL(location.href);
  if (!url.searchParams.has(PARAM)) return;
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, '', url.toString());
}

function readFlag(key: string) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function readRecords(): Partial<Record<BossId, BossResult>> {
  try { return JSON.parse(localStorage.getItem(RECORDS_KEY) ?? '{}'); } catch { return {}; }
}

function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
}
