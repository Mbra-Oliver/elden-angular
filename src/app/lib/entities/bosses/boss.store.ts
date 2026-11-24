import { computed, Injectable, signal } from '@angular/core';
import { BOSS_CONFIG } from '../../constants/boss.config-constant';
import { CLEARING } from '../../constants/village';
import { BossData } from '../../interfaces/BossData';

@Injectable({
  providedIn: 'root',
})
export class BossStore {
  private readonly initialData: BossData = {
    x: CLEARING.x - BOSS_CONFIG.size / 2,
    y: CLEARING.y - BOSS_CONFIG.size / 2,
    vx: 0,
    vy: 0,
    facingX: -1,
    facingY: 0,
    hp: BOSS_CONFIG.maxHp,
    maxHp: BOSS_CONFIG.maxHp,
    state: 'idle',
    stateTimer: 2000,
    currentAttack: 'none',
    comboStep: 0,
    chargeTargetX: 0,
    chargeTargetY: 0,
  };
  private readonly data = signal<BossData>({ ...this.initialData });

  //Computed pour connaitre la phase dans laquelle le boss est.

  readonly phase = computed(() => {
    const d = this.data();
    return d.hp / d.maxHp <= BOSS_CONFIG.phase2Threshold ? 2 : 1;
  });

  getData(): BossData {
    return this.data();
  }

  //Mettre a jour les donnees

  update(partial: Partial<BossData>) {
    this.data.update((data) => ({
      ...data,
      ...partial,
    }));
  }

  reset() {
    this.data.set({ ...this.initialData });
  }
}
