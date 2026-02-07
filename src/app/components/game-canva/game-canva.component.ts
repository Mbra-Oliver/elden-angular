import { Component, ElementRef, ViewChild } from '@angular/core';
import { TERRAIN_INFO } from '../../lib/constants/terrain-constant';

@Component({
  selector: 'app-game-canva',
  imports: [],
  templateUrl: './game-canva.component.html',
  styleUrl: './game-canva.component.css',
})
export class GameCanvaComponent {
  CANVAS_CONFIG = TERRAIN_INFO;

  @ViewChild('gameCanva') canvas!: ElementRef<HTMLCanvasElement>;
}
