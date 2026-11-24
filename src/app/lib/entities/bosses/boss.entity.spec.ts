import { TestBed } from '@angular/core/testing';
import { BOSS_CONFIG } from '../../constants/boss.config-constant';
import { BOSS_ATTACKS, isBossHitActive, tideRadii } from '../../interfaces/BossAttackData';
import { PlayerStore } from '../player/player.store';
import { BossEntity } from './boss.entity';
import { BossStore } from './boss.store';

describe('BossEntity phases', () => {
  let entity: BossEntity;
  let store: BossStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    entity = TestBed.inject(BossEntity);
    store = TestBed.inject(BossStore);
    store.reset();
    entity.configure(true);
    store.update({ hp: 100, maxHp: 100, state: 'recover', stateTimer: 400, stateLength: 400, currentAttack: 'slash' });
  });

  it('enters a shift into phase 2, then phase 3, and ignores hits during the shift', () => {
    entity.takeDamage(40, 0, 0);
    expect(store.getData().phase).toBe(2);
    expect(store.getData().state).toBe('shift');
    const hp = store.getData().hp;
    entity.takeDamage(40, 0, 0);
    expect(store.getData().hp).toBe(hp);

    for (let t = 0; t < BOSS_CONFIG.shiftDuration + 50; t += 16) entity.update(0.016);
    expect(store.getData().state).not.toBe('shift');

    store.update({ state: 'recover', stateTimer: 400, currentAttack: 'slash' });
    entity.takeDamage(40, 0, 0);
    expect(store.getData().phase).toBe(3);
  });

  it('opens each new phase with its signature attack', () => {
    TestBed.inject(PlayerStore).update({ x: store.getData().x + 40, y: store.getData().y });
    entity.takeDamage(40, 0, 0);
    for (let t = 0; t < BOSS_CONFIG.shiftDuration + 50; t += 16) entity.update(0.016);
    expect(store.getData().state).toBe('windup');
    expect(store.getData().currentAttack).toBe('combo');
  });

  it('only hurts during the impact part of a swing, and the tide sends two rings', () => {
    expect(isBossHitActive('combo', 0.05)).toBeFalse();
    expect(isBossHitActive('combo', 0.12)).toBeTrue();
    expect(isBossHitActive('sweep', 0.05)).toBeFalse();
    expect(tideRadii(64, BOSS_ATTACKS.tide.attackDuration * 0.5).length).toBe(2);
  });
});
