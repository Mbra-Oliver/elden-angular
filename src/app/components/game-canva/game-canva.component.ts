import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  OnInit,
  ViewChild,
} from '@angular/core';
import { TERRAIN_INFO } from '../../lib/constants/terrain-constant';
import { GameLoopService } from '../../lib/services/game-loop.service';
import { RendererService } from '../../lib/services/renderer.service';
import { GameStore } from '../../lib/store/game.store';

@Component({
  selector: 'app-game-canva',
  imports: [],
  templateUrl: './game-canva.component.html',
  styleUrl: './game-canva.component.css',
})
export class GameCanvaComponent implements AfterViewInit, OnInit {
  CANVAS_CONFIG = TERRAIN_INFO;

  @ViewChild('gameCanva') canvas!: ElementRef<HTMLCanvasElement>;

  gameStore = inject(GameStore);
  renderer = inject(RendererService);
  gameLoop = inject(GameLoopService);

  ngOnInit(): void {
    console.log(`COMPOSANTE EST MONTE`);
    // this.gameLoop.start();
  }
  ngAfterViewInit(): void {
    // setInterval(() => {
    //   this.gameLoop.stop();
    //   console.log(`BOUCLE DE JEU ARRET...`);
    // }, 300);

    this.renderer.init(this.canvas.nativeElement);
  }
}
