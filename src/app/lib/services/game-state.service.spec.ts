import { TestBed } from '@angular/core/testing';
import { BATTLE, CLEARING, CROSSING, GATE, VILLAGE_STOPS } from '../constants/village';
import { BossEntity } from '../entities/bosses/boss.entity';
import { BossStore } from '../entities/bosses/boss.store';
import { PlayerStore } from '../entities/player/player.store';
import { AssetLoaderService } from '../engine/asset-loader.service';
import { GameLoopService } from './game-loop.service';
import { GameStateService } from './game-state.service';
import { InputService } from './input.service';
import { TerrainCollisionService } from '../engine/terrain-collision.service';
import { FORD_DUEL } from '../engine/duel-fog';
import { CameraService } from '../engine/camera.service';
import { VIEWPORT } from '../constants/terrain-constant';
import { PLAYER_CONFIG } from '../constants/player.config-constant';
import { ProgressionStore } from '../slice/progression.store';

describe('GameStateService', () => {
  let game: GameStateService;
  let player: PlayerStore;
  let boss: BossStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    spyOn(TestBed.inject(GameLoopService), 'start');
    spyOn(TestBed.inject(AssetLoaderService), 'load').and.resolveTo();
    game = TestBed.inject(GameStateService);
    player = TestBed.inject(PlayerStore);
    boss = TestBed.inject(BossStore);
    game.startGame();
  });

  const visit = ({ x, y }: { x: number; y: number }) => {
    player.update({ x, y });
    game.update(1 / 60);
  };

  const finishPrologue = () => {
    boss.update({ hp: 0, state: 'dead', stateTimer: 0 }); // animation de mort déjà jouée
    game.update(1 / 60);
    expect(game.objective()).toBe(CROSSING);
    visit(CROSSING);
    game.talk();
    game.choose(game.dialogue()!.choices[0]);
  };

  it('lets the boss death animation play before leaving the duel', () => {
    TestBed.inject(BossEntity).takeDamage(9999, 0, 0, true);
    expect(boss.getData().state).toBe('dead');
    game.update(1 / 60);
    expect(game.objective()).toBe(BATTLE);
    for (let frame = 0; frame < 240; frame++) game.update(1 / 60);
    expect(game.objective()).toBe(CROSSING);
  });

  it('starts with the Akan battle, frames both fighters and returns to exploration at the crossing', () => {
    const camera = TestBed.inject(CameraService);
    expect(game.objective()).toBe(BATTLE);
    for (let frame = 0; frame < 24; frame++) game.update(1 / 60);
    expect(camera.zoom).toBeGreaterThan(1.3);
    const playerCenter = player.getData().x + PLAYER_CONFIG.size / 2;
    expect(camera.worldToScreenX(playerCenter)).toBeGreaterThan(0);
    expect(camera.worldToScreenX(BATTLE.x)).toBeLessThan(VIEWPORT.WIDTH);
    finishPrologue();
    expect(camera.zoom).toBe(1);
    expect(game.objective()).toBe(VILLAGE_STOPS[0]);
    expect(boss.getData().hp).toBe(300);
  });

  const choose = (index: number) => game.choose(game.dialogue()!.choices[index]);
  const reachGate = () => {
    visit(VILLAGE_STOPS[0]);
    game.talk();
    choose(0);
    choose(0);
    visit(VILLAGE_STOPS[1]);
    game.talk();
    choose(1);
    choose(0);
    choose(0);
    // L'expédition de la tranche jouable (plaine, chambres, levier) est
    // testée à part : on la considère faite pour atteindre le choix de la vanne.
    const progression = TestBed.inject(ProgressionStore);
    progression.setFlag('metYao');
    progression.setFlag('lever');
    visit(GATE);
    game.talk();
  };

  it('locks movement into the fog ring and releases it when Kofi gives up', () => {
    const terrain = TestBed.inject(TerrainCollisionService);
    const { x, y, radius } = FORD_DUEL;
    const stopped = terrain.move(x, y, x + radius + 55, y, 10);
    expect(stopped.x).toBeLessThanOrEqual(x + radius - 10);
    expect(stopped.x).toBeGreaterThan(x + radius - 20);
    boss.update({ hp: 0, state: 'dead', stateTimer: 0 }); // animation de mort déjà jouée
    game.update(1 / 60);
    const open = terrain.move(stopped.x, y, x + radius + 55, y, 10);
    expect(open.x).toBeGreaterThan(stopped.x + 10);
  });

  it('makes light spam ineffective against Kofi but rewards recovery hits', () => {
    const entity = TestBed.inject(BossEntity);
    const initial = boss.getData().hp;
    for (let hit = 0; hit < 4; hit++) entity.takeDamage(10, 150, 0);
    expect(boss.getData().hp).toBe(initial - 8);
    expect(boss.getData().state).toBe('idle');
    boss.update({ state: 'recover' });
    entity.takeDamage(30, 150, 0);
    expect(boss.getData().hp).toBe(initial - 38);
  });

  it('requires conversations and gives the sluice choice consequences', () => {
    finishPrologue();
    visit(VILLAGE_STOPS[0]);
    expect(game.dialogue()).toBeNull();
    expect(game.objective()).toBe(VILLAGE_STOPS[0]);
    reachGate();
    choose(0);
    expect(game.objective()).toBe(CLEARING);
    expect(boss.getData().hp).toBe(225);
    const sealedEnding = game.ending();
    boss.update({ hp: 0, state: 'dead', stateTimer: 0 }); // animation de mort déjà jouée
    game.update(1 / 60);
    expect(game.currentScreen()).toBe('victory');

    // retry() relance depuis le dernier foyer (boucle soulslike) : nouvelle partie ici.
    game.startGame();
    expect(game.objective()).toBe(BATTLE);
    finishPrologue();
    reachGate();
    choose(1);
    expect(boss.getData().hp).toBe(300);
    expect(game.ending()).not.toBe(sealedEnding);
  });

  it('opens a counter window when the player dashes through an active hit', () => {
    finishPrologue();
    reachGate();
    choose(0);
    boss.update({ x: CLEARING.x, y: CLEARING.y, state: 'attacking', currentAttack: 'slam', stateTimer: 180 });
    player.update({
      x: CLEARING.x - 20, y: CLEARING.y,
      state: 'rolling', stateTimer: PLAYER_CONFIG.rollDuration, invicible: true,
    });
    const initialHp = player.getData().hp;
    game.update(1 / 60);
    expect(game.counterReady()).toBeTrue();
    expect(player.getData().hp).toBe(initialHp);

    spyOn(TestBed.inject(InputService), 'attack').and.returnValue(true);
    game.update(1 / 60);
    expect(game.counterReady()).toBeFalse();
    expect(player.getData().attackType).toBe('counter');
    expect(boss.getData().hp).toBe(225);
    game.update(1 / 60);
    game.update(1 / 60);
    expect(boss.getData().hp).toBeLessThan(225);
  });

  it('lets the Guardian hold its ground during a surge and exposes it during recovery', () => {
    finishPrologue();
    reachGate();
    choose(1);
    const entity = TestBed.inject(BossEntity);
    const startHp = boss.getData().hp;
    boss.update({ state: 'windup', currentAttack: 'surge', stateTimer: 600 });
    entity.takeDamage(20, 100, 0);
    expect(boss.getData().state).toBe('windup');
    expect(boss.getData().hp).toBe(startHp - 4);
    boss.update({ state: 'recover' });
    entity.takeDamage(20, 100, 0);
    expect(boss.getData().state).toBe('recover');
    expect(boss.getData().hp).toBe(startHp - 32);
  });
});
