import { TestBed } from '@angular/core/testing';
import { PLAYER_CONFIG, LIGHT_COMBO } from '../../constants/player.config-constant';
import { InputService } from '../../services/input.service';
import { PlayerEntity } from './player.entity';
import { PlayerStore } from './player.store';

/**
 * Simulation image par image du joueur (60 fps), avec un clavier factice :
 * vérifie le ressenti voulu (sprint, roulade, pas en arrière, souffle,
 * invincibilité après un coup) sans dépendre du rendu.
 */
describe('Player combat feel (simulation)', () => {
  const DT = 1 / 60;
  let player: PlayerEntity;
  let store: PlayerStore;
  const keys = new Set<string>();

  beforeEach(() => {
    TestBed.configureTestingModule({});
    const input = TestBed.inject(InputService);
    spyOn(input, 'up').and.callFake(() => keys.has('up'));
    spyOn(input, 'down').and.callFake(() => keys.has('down'));
    spyOn(input, 'left').and.callFake(() => keys.has('left'));
    spyOn(input, 'right').and.callFake(() => keys.has('right'));
    spyOn(input, 'attack').and.callFake(() => keys.has('attack'));
    spyOn(input, 'heavyAttack').and.callFake(() => keys.has('heavy'));
    spyOn(input, 'dodge').and.callFake(() => keys.has('shift'));
    keys.clear();
    player = TestBed.inject(PlayerEntity);
    store = TestBed.inject(PlayerStore);
    store.reset();
    player.resetCombat();
    player.setCameraHeading(null);
    // Zone dégagée au centre de l'arène du gué.
    store.update({ x: 650, y: 290, facingX: 1, facingY: 0 });
  });

  const run = (frames: number, target?: { x: number; y: number }) => {
    for (let i = 0; i < frames; i++) player.update(DT, target);
  };
  const tapShift = (target?: { x: number; y: number }) => {
    keys.add('shift');
    run(4, target);
    keys.delete('shift');
    run(1, target);
  };

  it('rolls about 150 px on a short Shift tap, invincible only at the start', () => {
    keys.add('right');
    run(10);
    const startX = store.getData().x;
    tapShift();
    expect(store.getData().state).toBe('rolling');
    expect(store.getData().invicible).toBeTrue();
    keys.delete('right');
    run(Math.ceil(PLAYER_CONFIG.rollIFrames / 1000 / DT) + 2);
    expect(store.getData().invicible).toBeFalse();
    run(20);
    expect(store.getData().state).not.toBe('rolling');
    expect(store.getData().x - startX).toBeGreaterThan(130);
    expect(store.getData().x - startX).toBeLessThan(220);
  });

  it('sprints while Shift is held, costs breath and never rolls on release', () => {
    store.update({ x: 440 });
    keys.add('right');
    keys.add('shift');
    run(30);
    const x0 = store.getData().x;
    run(60);
    const speed = store.getData().x - x0;
    expect(player.sprinting).toBeTrue();
    expect(speed).toBeGreaterThan(PLAYER_CONFIG.sprintSpeed * 0.9);
    expect(store.getData().stamina).toBeLessThan(PLAYER_CONFIG.maxStamina - 15);
    keys.delete('shift');
    run(1);
    expect(store.getData().state).toBe('moving');
    expect(player.sprinting).toBeFalse();
  });

  it('steps back from a locked enemy when no direction is held', () => {
    player.setCameraHeading(Math.PI / 2);
    const target = { x: 900, y: 306 };
    run(5, target);
    const x0 = store.getData().x;
    tapShift(target);
    expect(player.dodgeKind).toBe('backstep');
    run(30, target);
    const moved = store.getData().x - x0;
    expect(moved).toBeLessThan(-60);
    expect(moved).toBeGreaterThan(-120);
    expect(store.getData().facingX).toBeGreaterThan(0.9);
  });

  it('still attacks on an almost empty breath bar, without the old 1 s stun', () => {
    store.update({ stamina: 2 });
    keys.add('attack');
    run(1);
    keys.delete('attack');
    expect(store.getData().state).toBe('attacking');
    expect(store.getData().stamina).toBe(0);
    run(Math.ceil(LIGHT_COMBO[0].duration / 1000 / DT) + 2);
    expect(store.getData().state).not.toBe('exhausted');
    keys.add('right');
    run(5);
    expect(store.getData().state).toBe('moving');
  });

  it('grants a short invincibility after a hit so combos cannot stun-lock', () => {
    player.takeDamage(10, -200, 0);
    expect(store.getData().state).toBe('hurt');
    run(Math.ceil(PLAYER_CONFIG.hurtDuration / 1000 / DT) + 1);
    const hp = store.getData().hp;
    player.takeDamage(10, -200, 0);
    expect(store.getData().hp).toBe(hp);
    run(Math.ceil(PLAYER_CONFIG.hurtIFrames / 1000 / DT) + 2);
    player.takeDamage(10, -200, 0);
    expect(store.getData().hp).toBeLessThan(hp);
  });

  it('cuts the end of a roll with a buffered attack', () => {
    keys.add('right');
    tapShift();
    keys.delete('right');
    run(12);
    keys.add('attack');
    run(1);
    keys.delete('attack');
    let frames = 0;
    while (store.getData().state === 'rolling' && frames < 60) {
      run(1);
      frames++;
    }
    expect(store.getData().state).toBe('attacking');
    // Parti avant la fin naturelle de la roulade.
    expect(13 + frames).toBeLessThan(PLAYER_CONFIG.rollDuration / 1000 / DT);
  });
});
