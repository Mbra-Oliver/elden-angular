import { TestBed } from '@angular/core/testing';
import { HUTS } from '../constants/scenery';
import { PLAYER_CONFIG } from '../constants/player.config-constant';
import { PlayerEntity } from '../entities/player/player.entity';
import { PlayerStore } from '../entities/player/player.store';
import { WeaponObstructionService } from './weapon-obstruction.service';

/** Le coup de lance bute sur une case au lieu de la traverser. */
describe('WeaponObstructionService', () => {
  let service: WeaponObstructionService;
  let store: PlayerStore;
  let player: PlayerEntity;
  const [hx, hy, hr] = HUTS[0];
  const wall = hx - hr * 0.82; // bord ouest de la case (collision), au niveau de y = hy + 5

  /** Joueur face à l'est, son centre à `gap` du mur de la case, en pleine fenêtre active d'un coup léger. */
  const strikeAt = (gap: number) => {
    store.reset();
    player.resetCombat();
    const half = PLAYER_CONFIG.size / 2;
    store.update({ x: wall - gap - half, y: hy + 5 - half, facingX: 1, facingY: 0,
      state: 'attacking', attackType: 'light', comboCount: 1 });
    const attack = player.getActiveAttackData(store.getData());
    store.update({ stateTimer: attack.duration - attack.windup - attack.active / 2 });
    return attack;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WeaponObstructionService);
    store = TestBed.inject(PlayerStore);
    player = TestBed.inject(PlayerEntity);
  });

  it('stops a thrust on the hut wall and sends the weapon into recovery', () => {
    const attack = strikeAt(14);
    service.update();
    expect(service.swingStopped).toBeTrue();
    expect(store.getData().stateTimer).toBe(attack.duration - attack.windup - attack.active);
  });

  it('lets a thrust in open ground run its course', () => {
    const attack = strikeAt(14);
    // Centre de l'arène du gué : ni case ni arbre.
    store.update({ x: 650, y: 290 });
    const before = store.getData().stateTimer;
    service.update();
    expect(service.swingStopped).toBeFalse();
    expect(store.getData().stateTimer).toBe(before);
    expect(before).toBeGreaterThan(attack.duration - attack.windup - attack.active);
  });

  it('blocks a target standing behind the hut, not one in front of it', () => {
    strikeAt(14);
    expect(service.occluded(hx, hy + 5, 10)).not.toBeNull();
    expect(service.occluded(wall - 2, hy + 5, 1)).toBeNull();
  });

  it('reports the spear tip as inside the hut wall, and free above open ground', () => {
    expect(service.inside(hx, hy + 5, 15)).toBeTrue();
    expect(service.inside(wall - 30, hy + 5, 15)).toBeFalse();
  });
});
