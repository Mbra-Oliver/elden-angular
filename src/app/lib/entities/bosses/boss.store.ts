import { computed, Injectable, signal } from '@angular/core';
import { BOSS_CONFIG } from '../../constants/boss.config-constant';
import { BossData } from '../../interfaces/BossData';

@Injectable({
  providedIn: 'root',
})
export class BossStore {
  private readonly data = signal<BossData>({
    x: 600,
    y: 250,
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
  });

  //Computed pour connaitre la phase dans laquelle le boss est.

  readonly phase = computed(() => {
    const d = this.data();
    return d.hp / d.maxHp <= BOSS_CONFIG.phase2Threshold ? 2 : 1;
  });

  reset() {
    //Reset les stats du Boss
  }
}
