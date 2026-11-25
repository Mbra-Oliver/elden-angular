import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { REMAINS } from '../prologue/prologue-map';
import { PrologueService } from '../prologue/prologue.service';
import { ITEMS } from '../slice/slice-content';
import { ProgressionStore } from '../slice/progression.store';
import { BOSS_LORE, type BossId } from '../constants/boss-lore';
import { ANCESTRAL_THREAD, adinkraFor } from '../constants/adinkra';
import { GameStateService } from '../services/game-state.service';

export type CodexKind = 'souvenir' | 'relique' | 'adversaire';

export interface CodexEntry {
  id: string;
  kind: CodexKind;
  title: string;
  /** Sous-titre court (époque, effet, épithète). */
  subtitle?: string;
  symbol?: string;
  symbolName?: string;
  thread?: string;
  chapter?: string;
  text: string[];
}

const KEY = 'terre-rouge.codex.v1';

/**
 * Chroniques et reliques : ce que le joueur a lu, ramassé ou vaincu, gardé
 * d'une partie à l'autre (localStorage). Les découvertes sont relevées en
 * observant les signaux du jeu, sans toucher aux systèmes qui les produisent.
 */
@Injectable({ providedIn: 'root' })
export class CodexService {
  private readonly found = signal<ReadonlySet<string>>(load());

  /** Toutes les entrées possibles, dans l'ordre du récit. */
  readonly all: readonly CodexEntry[] = [
    ...REMAINS.map((r): CodexEntry => ({
      id: `remains:${r.id}`, kind: 'souvenir', title: r.title, subtitle: 'Feyiase, 1701',
      chapter: 'Feyiase, 1701', text: [r.text],
    })),
    ...(Object.entries(ITEMS) as [string, (typeof ITEMS)[keyof typeof ITEMS]][]).map(([id, item]): CodexEntry => ({
      id: `item:${id}`, kind: 'relique', title: item.name, subtitle: item.effect,
      chapter: id === 'perle' || id === 'calebasse' ? 'Lignée des Serwaa' : 'Trésors du chemin', text: [item.lore],
    })),
    ...(Object.entries(BOSS_LORE) as [BossId, (typeof BOSS_LORE)[BossId]][]).map(([id, boss]): CodexEntry => ({
      id: `boss:${id}`, kind: 'adversaire', title: boss.name, subtitle: `${boss.epithet} · ${boss.chapter}`,
      chapter: boss.chapter, text: boss.lore,
    })),
  ].map((entry): CodexEntry => {
    const sign = adinkraFor(entry.id);
    return {
      ...entry,
      symbol: sign?.glyph,
      symbolName: sign ? `${sign.name} — ${sign.meaning}` : undefined,
      thread: ANCESTRAL_THREAD[entry.id],
    };
  });

  readonly entries = computed(() => {
    const found = this.found();
    return this.all.filter((entry) => found.has(entry.id));
  });

  readonly total = this.all.length;

  constructor() {
    const prologue = inject(PrologueService);
    const progression = inject(ProgressionStore);
    const game = inject(GameStateService);
    effect(() => {
      const read = prologue.reading();
      if (read) untracked(() => this.discover(`remains:${read.id}`));
    });
    effect(() => {
      const items = progression.items();
      untracked(() => items.forEach((id) => this.discover(`item:${id}`)));
    });
    effect(() => {
      const name = game.hud()?.defeated?.name;
      if (!name) return;
      const id = (Object.keys(BOSS_LORE) as BossId[]).find((boss) => BOSS_LORE[boss].name === name);
      if (id) untracked(() => this.discover(`boss:${id}`));
    });
  }

  discover(id: string) {
    if (this.found().has(id)) return;
    const next = new Set(this.found());
    next.add(id);
    this.found.set(next);
    try { localStorage.setItem(KEY, JSON.stringify([...next])); } catch { /* stockage indisponible */ }
  }
}

function load(): ReadonlySet<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
