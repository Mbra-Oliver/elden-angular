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
import { GameLoopService } from '../../lib/services/game-loop.service';
import { GameStateService } from '../../lib/services/game-state.service';
import { RendererService } from '../../lib/services/renderer.service';

@Component({
  selector: 'app-game-canva',
  imports: [],
  templateUrl: './game-canva.component.html',
  styleUrl: './game-canva.component.css',
})
export class GameCanvaComponent implements AfterViewInit, OnDestroy {
  @ViewChild('viewport') viewport!: ElementRef<HTMLDivElement>;

  readonly gameState = inject(GameStateService);
  readonly engineStatus = signal<'loading' | 'ready' | 'failed'>('loading');
  private readonly renderer = inject(RendererService);
  private readonly loop = inject(GameLoopService);
  private readonly zone = inject(NgZone);
  private game?: Game;
  private world?: World3D;
  private destroyed = false;

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
                if (!this.destroyed) this.loop.render();
              });
            },
            postBoot: (game: Game) => {
              if (this.destroyed) return;
              game.canvas.setAttribute('role', 'img');
              game.canvas.setAttribute('aria-label', 'Terrain de jeu vu du dessus');
              Object.assign(game.canvas.style, { width: '100%', height: '100%', display: 'block' });
              try {
                this.world = new World3D(this.viewport.nativeElement);
                this.gameState.setWorld3D(this.world);
                game.canvas.setAttribute('aria-hidden', 'true');
                Object.assign(game.canvas.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
              } catch (error) {
                console.warn('WebGL indisponible, vue 2D utilisée.', error);
              }
              this.renderer.init(game.canvas);
              this.engineStatus.set('ready');
            },
          },
          scene: { update: (_time: number, delta: number) => this.loop.update(delta) },
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
