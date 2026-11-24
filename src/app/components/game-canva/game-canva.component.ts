import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  HostListener,
  NgZone,
  OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';
import type { Game } from 'phaser';
import type { World3D } from '../../lib/engine/world-3d';
import { VIEWPORT } from '../../lib/constants/terrain-constant';
import { SPRITE_MANIFEST } from '../../lib/constants/sprite-config';
import { AssetLoaderService } from '../../lib/engine/asset-loader.service';
import { EnvironmentService } from '../../lib/engine/environment.service';
import { GameLoopService } from '../../lib/services/game-loop.service';
import { GameStateService } from '../../lib/services/game-state.service';
import { RendererService } from '../../lib/services/renderer.service';
import { EquipmentStore } from '../../lib/entities/player/equipment.store';

@Component({
  selector: 'app-game-canva',
  imports: [],
  templateUrl: './game-canva.component.html',
  styleUrl: './game-canva.component.css',
})
export class GameCanvaComponent implements AfterViewInit, OnDestroy {
  @ViewChild('viewport') viewport!: ElementRef<HTMLDivElement>;

  readonly gameState = inject(GameStateService);
  readonly equipment = inject(EquipmentStore);
  readonly engineStatus = signal<'loading' | 'ready' | 'failed'>('loading');
  private readonly renderer = inject(RendererService);
  private readonly loop = inject(GameLoopService);
  private readonly zone = inject(NgZone);
  private readonly assets = inject(AssetLoaderService);
  private readonly environment = inject(EnvironmentService);
  private game?: Game;
  private world?: World3D;
  private destroyed = false;
  private warming = false;

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    const dialogue = this.gameState.dialogue();
    const choice = dialogue?.choices[event.code === 'Digit1' ? 0 : event.code === 'Digit2' ? 1 : -1];
    if (choice && !event.repeat) {
      event.preventDefault();
      this.gameState.choose(choice);
      return;
    }
    if (event.code === 'KeyF' && !event.repeat && this.gameState.canTalk()) {
      event.preventDefault();
      this.gameState.talk();
    }
  }

  ngAfterViewInit(): void {
    void this.loadEngine();
  }

  private async loadEngine() {
    try {
      const [Phaser, { World3D }] = await Promise.all([
        import('phaser/dist/phaser.esm.js'),
        import('../../lib/engine/world-3d'),
        // Les textures du sol doivent être prêtes avant la première image :
        // sinon le terrain 2400×1600 est repeint et renvoyé au GPU en plein combat.
        this.assets.load(SPRITE_MANIFEST),
      ]);
      if (this.destroyed) return;

      this.zone.runOutsideAngular(() => {
        this.game = new Phaser.Game({
          type: Phaser.CANVAS,
          parent: this.viewport.nativeElement,
          width: VIEWPORT.WIDTH,
          height: VIEWPORT.HEIGHT,
          banner: false,
          audio: { noAudio: true },
          input: { keyboard: false, mouse: false, touch: false, gamepad: false },
          render: { antialias: true, transparent: true, clearBeforeRender: false },
          callbacks: {
            preBoot: (game: Game) => {
              game.events.on(Phaser.Core.Events.POST_RENDER, () => {
                if (!this.destroyed && !this.warming) this.loop.render();
              });
            },
            postBoot: (game: Game) => {
              if (this.destroyed) return;
              game.canvas.setAttribute('role', 'img');
              game.canvas.setAttribute('aria-label', 'Terrain de jeu vu du dessus');
              Object.assign(game.canvas.style, { width: '100%', height: '100%', display: 'block' });
              let world: World3D | undefined;
              try {
                world = new World3D(this.viewport.nativeElement);
                game.canvas.setAttribute('aria-hidden', 'true');
                Object.assign(game.canvas.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
              } catch (error) {
                console.warn('WebGL indisponible, vue 2D utilisée.', error);
              }
              this.renderer.init(game.canvas);
              if (!world) {
                this.engineStatus.set('ready');
                return;
              }
              this.world = world;
              // Ni logique ni rendu tant que les shaders ne sont pas compilés.
              this.warming = true;
              void world.warmUp(this.environment.groundCanvas()).finally(() => {
                if (this.destroyed) return;
                this.gameState.setWorld3D(world);
                this.warming = false;
                this.zone.run(() => this.engineStatus.set('ready'));
              });
            },
          },
          scene: { update: (_time: number, delta: number) => { if (!this.warming) this.loop.update(delta); } },
        });
      });
    } catch (error) {
      if (this.destroyed) return;
      console.error('Impossible de charger Phaser', error);
      this.engineStatus.set('failed');
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.gameState.stopGame();
    this.gameState.setWorld3D(null);
    this.world?.dispose();
    this.game?.destroy(true);
  }
}
