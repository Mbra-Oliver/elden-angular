import { FORD_DUEL, SLUICE_DUEL } from '../engine/duel-fog';
import { LocalAsyncBackend, messageText, simulatedTravellers } from './async-world.backend';
import { zoneAt } from './async-world.service';
import { beats, decodeChallenge, encodeChallenge, formatTime } from './challenge.service';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

describe('Défis partageables', () => {
  it('encode puis décode un résultat sans perte', () => {
    const code = encodeChallenge({ boss: 'sluice', time: 102345, hits: 3, flasks: 1 });
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeChallenge(code)).toEqual({ v: 1, boss: 'sluice', time: 102345, hits: 3, flasks: 1 });
  });

  it('refuse un lien altéré ou invalide', () => {
    expect(decodeChallenge('pas-un-defi')).toBeNull();
    expect(decodeChallenge(btoa(JSON.stringify({ v: 1, b: 'autre', t: 1, h: 0, f: 0 })))).toBeNull();
    expect(decodeChallenge(btoa(JSON.stringify({ v: 1, b: 'ford', t: -5, h: 0, f: 0 })))).toBeNull();
  });

  it('formate le temps et compare au défi', () => {
    expect(formatTime(102345)).toBe('1:42.3');
    expect(beats({ boss: 'ford', time: 9000, hits: 5, flasks: 0 }, { boss: 'ford', time: 10000, hits: 0, flasks: 0 })).toBeTrue();
    expect(beats({ boss: 'ford', time: 11000, hits: 0, flasks: 0 }, { boss: 'ford', time: 10000, hits: 0, flasks: 0 })).toBeFalse();
  });
});

describe('Monde asynchrone local', () => {
  it('range les positions dans la bonne zone', () => {
    expect(zoneAt(FORD_DUEL.x, FORD_DUEL.y)).toBe('ford');
    expect(zoneAt(SLUICE_DUEL.x, SLUICE_DUEL.y)).toBe('sluice');
    expect(zoneAt(820, 780)).toBe('village');
  });

  it('peuple le premier lancement de voyageurs simulés', async () => {
    const backend = new LocalAsyncBackend(new MemoryStorage());
    const ford = await backend.fetchZone('ford');
    expect(ford.messages.length).toBeGreaterThan(0);
    expect(ford.stains.length).toBeGreaterThan(0);
    expect(ford.ghosts.length).toBeGreaterThan(0);
    expect(simulatedTravellers().ghosts.every((g) => g.path.length > 10)).toBeTrue();
  });

  it('conserve messages, taches et fantômes entre deux sessions', async () => {
    const storage = new MemoryStorage();
    const first = new LocalAsyncBackend(storage);
    const message = await first.postMessage({ zone: 'village', x: 10, y: 20, template: 2, word: 0 });
    await first.rateMessage(message.id);
    await first.postBloodstain({ zone: 'village', x: 10, y: 20, path: [{ x: 1, y: 2, fx: 1, fy: 0, a: 0 }] });
    await first.postGhost({ zone: 'village', path: Array.from({ length: 300 }, (_, i) => ({ x: i, y: 0, fx: 1, fy: 0, a: 0 as const })) });

    const village = await new LocalAsyncBackend(storage).fetchZone('village');
    const saved = village.messages.find((m) => m.id === message.id)!;
    expect(saved.likes).toBe(1);
    expect(saved.mine).toBeTrue();
    expect(messageText(saved)).toBe('Essaie l’esquive');
    expect(village.stains.some((s) => s.mine)).toBeTrue();
    expect(village.ghosts.find((g) => g.mine)!.path.length).toBe(240);
  });
});
