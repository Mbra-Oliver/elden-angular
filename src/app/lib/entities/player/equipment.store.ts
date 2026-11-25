import { computed, Injectable, signal } from '@angular/core';
import { EQUIPMENT_CONFIG, WEAPONS, WeaponId } from '../../constants/equipment.config-constant';

export interface EquipmentData {
  weapon: WeaponId;
  arrows: number;
  maxArrows: number;
  mixture: number;
  maxMixture: number;
  /** Armes possédées, dans l'ordre du cycle de R. */
  owned: WeaponId[];
}

/** Inventaire d'Ama : arme en main, flèches restantes, poignées de mixture de soin. */
@Injectable({ providedIn: 'root' })
export class EquipmentStore {
  private readonly data = signal<EquipmentData>(this.initial());
  /** Petit message HUD temporaire (« Plus de flèches », « +1 flèche »…). */
  private readonly toast = signal<{ text: string; until: number } | null>(null);

  readonly state = this.data.asReadonly();
  readonly weapon = computed(() => WEAPONS[this.data().weapon]);
  readonly notice = computed(() => this.toast()?.text ?? null);

  getData(): EquipmentData {
    return this.data();
  }

  reset() {
    this.data.set(this.initial());
    this.toast.set(null);
  }

  /** Remplit carquois et mixtures sans changer l'arme en main (changement de chapitre). */
  refill() {
    this.data.update((d) => ({ ...d, arrows: d.maxArrows, mixture: d.maxMixture }));
  }

  switchWeapon(): WeaponId {
    const { owned, weapon } = this.data();
    const next = owned[(owned.indexOf(weapon) + 1) % owned.length] ?? 'spear';
    this.data.update((d) => ({ ...d, weapon: next }));
    return next;
  }

  setOwned(owned: WeaponId[]) {
    this.data.update((d) => ({ ...d, owned, weapon: owned.includes(d.weapon) ? d.weapon : owned[0] }));
  }

  setWeapon(weapon: WeaponId) {
    if (this.data().owned.includes(weapon)) this.data.update((d) => ({ ...d, weapon }));
  }

  setMaxMixture(maxMixture: number) {
    this.data.update((d) => ({ ...d, maxMixture, mixture: Math.min(d.mixture, maxMixture) }));
  }

  /** Taille du carquois (prologue : arc limité). Le carquois est rempli. */
  setMaxArrows(maxArrows: number) {
    this.data.update((d) => ({ ...d, maxArrows, arrows: maxArrows }));
  }

  /** Flèches trouvées (carquois d'un mort) : elles agrandissent le carquois. */
  addArrows(count: number) {
    this.data.update((d) => ({ ...d, maxArrows: Math.max(d.maxArrows, d.arrows + count), arrows: d.arrows + count }));
    this.say(`+${count} flèches`);
  }

  /** Feuilles trouvées : une mixture de plus jusqu'au prochain repos. */
  addMixture(count: number) {
    this.data.update((d) => ({ ...d, maxMixture: Math.max(d.maxMixture, d.mixture + count), mixture: d.mixture + count }));
    this.say(`+${count} mixture${count > 1 ? 's' : ''} de soin`);
  }

  /** Retire une flèche du carquois. Renvoie false s'il n'y en a plus. */
  consumeArrow(): boolean {
    if (this.data().arrows <= 0) {
      this.say('Plus de flèches');
      return false;
    }
    this.data.update((d) => ({ ...d, arrows: d.arrows - 1 }));
    return true;
  }

  /** Ramasse une flèche tombée au sol. */
  recoverArrow(): boolean {
    const d = this.data();
    if (d.arrows >= d.maxArrows) return false;
    this.data.update((current) => ({ ...current, arrows: current.arrows + 1 }));
    this.say('+1 flèche');
    return true;
  }

  /** Retire une poignée de feuilles. Renvoie false s'il n'y en a plus. */
  consumeMixture(): boolean {
    if (this.data().mixture <= 0) {
      this.say('Plus de mixture de soin');
      return false;
    }
    this.data.update((d) => ({ ...d, mixture: d.mixture - 1 }));
    return true;
  }

  say(text: string, milliseconds = 1400) {
    this.toast.set({ text, until: performance.now() + milliseconds });
  }

  /** À appeler à chaque frame : efface le message quand il a expiré. */
  tick(now = performance.now()) {
    const toast = this.toast();
    if (toast && now >= toast.until) this.toast.set(null);
  }

  private initial(): EquipmentData {
    return {
      weapon: 'spear',
      arrows: EQUIPMENT_CONFIG.maxArrows,
      maxArrows: EQUIPMENT_CONFIG.maxArrows,
      mixture: EQUIPMENT_CONFIG.maxMixture,
      maxMixture: EQUIPMENT_CONFIG.maxMixture,
      owned: ['spear', 'bow'],
    };
  }
}
