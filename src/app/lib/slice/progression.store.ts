import { computed, inject, Injectable, signal } from '@angular/core';
import { SoulsLoopService } from '../services/souls-loop.service';
import { PLAYER_CONFIG } from '../constants/player.config-constant';
import { levelCost, SPIRIT, STAT_ORDER, type StatId } from './slice-content';
import type { ItemId, RestId } from './slice-map';

const BASE_STATS: Record<StatId, number> = { vigueur: 1, souffle: 1, force: 1, adresse: 1, sunsum: 1 };

/**
 * Progression d'Ama : 5 statistiques (payées en cauris de SoulsLoopService), objets ramassés,
 * drapeaux du monde (levier, portes), point de repos courant et jauge
 * d'ardeur. Tout ce qui est sauvegardé passe par ici.
 */
@Injectable({ providedIn: 'root' })
export class ProgressionStore {
  private readonly souls = inject(SoulsLoopService);
  readonly stats = signal<Record<StatId, number>>({ ...BASE_STATS });
  /** Cauris : monnaie partagée avec la boucle de mort (SoulsLoopService). */
  readonly cowries = this.souls.cauris;
  readonly flags = signal<ReadonlySet<string>>(new Set());
  readonly items = signal<readonly ItemId[]>([]);
  readonly restPoint = signal<RestId | null>(null);
  readonly spirit = signal(0);

  readonly level = computed(() => STAT_ORDER.reduce((sum, id) => sum + this.stats()[id], 0) - 4);
  readonly nextCost = computed(() => levelCost(this.level()));

  readonly maxHp = computed(() => PLAYER_CONFIG.maxHp + 12 * (this.stats().vigueur - 1));
  readonly maxStamina = computed(() => PLAYER_CONFIG.maxStamina + 8 * (this.stats().souffle - 1));
  readonly spearMultiplier = computed(() => 1 + 0.08 * (this.stats().force - 1));
  readonly afenaMultiplier = computed(() => 1 + 0.04 * (this.stats().force - 1) + 0.05 * (this.stats().adresse - 1));
  readonly bowMultiplier = computed(() => 1 + 0.1 * (this.stats().adresse - 1));
  readonly spiritGain = computed(() => 1 + 0.15 * (this.stats().sunsum - 1));
  readonly specialMultiplier = computed(() => 1 + 0.1 * (this.stats().sunsum - 1));
  readonly armor = computed(() => this.items().includes('batakari') ? 0.85 : 1);

  reset() {
    this.stats.set({ ...BASE_STATS });
    this.flags.set(new Set());
    this.items.set([]);
    this.restPoint.set(null);
    this.spirit.set(0);
  }

  has(flag: string) {
    return this.flags().has(flag);
  }

  setFlag(flag: string) {
    if (this.has(flag)) return;
    this.flags.update((set) => new Set([...set, flag]));
  }

  addItem(id: ItemId) {
    if (!this.items().includes(id)) this.items.update((list) => [...list, id]);
  }

  addCowries(amount: number) {
    this.souls.earn(amount);
  }

  /** Monte une statistique si le joueur a assez de cauris. */
  levelUp(stat: StatId): boolean {
    const cost = this.nextCost();
    if (this.stats()[stat] >= 20 || !this.souls.spend(cost)) return false;
    this.stats.update((stats) => ({ ...stats, [stat]: stats[stat] + 1 }));
    return true;
  }

  bumpStat(stat: StatId) {
    this.stats.update((stats) => ({ ...stats, [stat]: stats[stat] + 1 }));
  }

  gainSpirit(base: number) {
    this.spirit.update((value) => Math.min(SPIRIT.max, value + base * this.spiritGain()));
  }

  spendSpirit(): boolean {
    if (this.spirit() < SPIRIT.specialCost) return false;
    this.spirit.update((value) => value - SPIRIT.specialCost);
    return true;
  }
}
