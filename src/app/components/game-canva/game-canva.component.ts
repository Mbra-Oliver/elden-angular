import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { TERRAIN_INFO } from '../../lib/constants/terrain-constant';
import { PlayerEntity } from '../../lib/entities/player/player.entity';
import { GameLoopService } from '../../lib/services/game-loop.service';
import { RendererService } from '../../lib/services/renderer.service';
import { GameStore } from '../../lib/store/game.store';

@Component({
  selector: 'app-game-canva',
  imports: [],
  templateUrl: './game-canva.component.html',
  styleUrl: './game-canva.component.css',
})
export class GameCanvaComponent implements AfterViewInit, OnInit, OnDestroy {
  CANVAS_CONFIG = TERRAIN_INFO;

  @ViewChild('gameCanva') canvas!: ElementRef<HTMLCanvasElement>;

  gameStore = inject(GameStore);
  renderer = inject(RendererService);
  gameLoop = inject(GameLoopService);
  private player = inject(PlayerEntity);

  private updateCallback = this.update.bind(this);
  private renderCallback = this.render.bind(this);

  ngOnInit(): void {
    console.log(`COMPOSANTE EST MONTE`);
    // this.gameLoop.start();
  }
  ngAfterViewInit(): void {
    const canvas = this.canvas.nativeElement;
    this.renderer.init(canvas);

    //Inscrire a la gameloop

    this.gameLoop.onUpdate(this.updateCallback);
    this.gameLoop.onRender(this.renderCallback);

    //Démarrer la boucle

    this.gameLoop.start();
  }

  ngOnDestroy(): void {
    this.gameLoop.stop();
    this.gameLoop.offUpdate(this.updateCallback);
    this.gameLoop.offRender(this.renderCallback);
  }

  private update(deltaTime: number) {
    this.player.update(deltaTime);
  }

  private render() {
    //1. Effacer l'ecran

    this.renderer.clear('#0f0f23');

    //2. Dessiner le terrain

    this.player.render();
  }
}
