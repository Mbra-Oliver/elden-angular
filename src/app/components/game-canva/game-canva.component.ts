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
  gameLoop = inject(GameLoopService);

  ngOnInit(): void {
    console.log(`COMPOSANTE EST MONTE`);
    // this.gameLoop.start();
  }
  ngAfterViewInit(): void {}
}
