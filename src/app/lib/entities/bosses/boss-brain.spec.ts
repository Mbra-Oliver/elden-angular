import { TestBed } from '@angular/core/testing';
import { BOSS_CONFIG } from '../../constants/boss.config-constant';
import { PLAYER_CONFIG } from '../../constants/player.config-constant';
import { PlayerStore } from '../player/player.store';
import { ATTACK_REACH, BossBrain, MIN_WINDUP, inReach } from './boss-brain';
import { BossEntity } from './boss.entity';
import { BossStore } from './boss.store';

describe('Boss AI', () => {
  let entity: BossEntity;
  let store: BossStore;
  let player: PlayerStore;

  /** Place le joueur à `distance` px à droite du centre du boss. */
  const placePlayer = (distance: number) => {
    const b = store.getData();
    player.update({
      x: b.x + BOSS_CONFIG.size / 2 + distance - PLAYER_CONFIG.size / 2,
      y: b.y + BOSS_CONFIG.size / 2 - PLAYER_CONFIG.size / 2,
      state: 'idle',
    });
  };
  const gap = () => {
    const b = store.getData();
    const p = player.getData();
    return Math.hypot(p.x + PLAYER_CONFIG.size / 2 - b.x - BOSS_CONFIG.size / 2,
      p.y + PLAYER_CONFIG.size / 2 - b.y - BOSS_CONFIG.size / 2);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    entity = TestBed.inject(BossEntity);
    store = TestBed.inject(BossStore);
    player = TestBed.inject(PlayerStore);
    store.reset();
    player.reset();
    entity.configure(true);
  });

  it('closes to the real reach of its attack before winding up', () => {
    placePlayer(180);
    store.update({ state: 'chase', stateTimer: 0 });
    let frames = 0;
    while (store.getData().state === 'chase' && frames++ < 300) entity.update(0.016);
    const attack = store.getData().currentAttack as keyof typeof ATTACK_REACH;
    expect(store.getData().state).toBe('windup');
    expect(inReach(attack, gap())).toBeTrue();
  });

  it('circles the player after an attack instead of standing still', () => {
    placePlayer(140);
    store.update({ state: 'recover', stateTimer: 10, stateLength: 10, currentAttack: 'slash' });
    entity.update(0.016);
    expect(store.getData().state).toBe('chase');
    const start = { ...store.getData() };
    for (let i = 0; i < 20; i++) entity.update(0.016);
    const end = store.getData();
    expect(end.state).toBe('chase');
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(5);
    expect(Math.abs(gap() - 140)).toBeLessThan(30);
  });

  it('stops waiting when the player drinks', () => {
    const brain = new BossBrain();
    brain.breathe(1);
    brain.think(16, 150, 0, 150, 'slash', 'drinking', true);
    expect(brain.mode).toBe('approach');
  });

  it('backs off when the player hugs it while circling', () => {
    const brain = new BossBrain();
    brain.breathe(1);
    const intent = brain.think(16, 30, 0, 30, 'slash', 'idle', true);
    expect(intent.dirX).toBeLessThan(0);
    expect(brain.mode).toBe('retreat');
  });

  it('never winds up faster than the readable minimum', () => {
    placePlayer(60);
    store.update({ phase: 3, state: 'recover', stateTimer: 10, stateLength: 10, currentAttack: 'slam' });
    (entity as any).queued = 'combo';
    entity.update(0.016);
    expect(store.getData().state).toBe('windup');
    expect(store.getData().stateLength).toBeGreaterThanOrEqual(MIN_WINDUP);
  });
});
