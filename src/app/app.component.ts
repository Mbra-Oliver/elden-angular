import { Component, inject, OnInit } from '@angular/core';
import { DeathMenuComponent } from './components/death-menu/death-menu.component';
import { GameCanvaComponent } from './components/game-canva/game-canva.component';
import { MainMenuComponent } from './components/main-menu/main-menu.component';
import { GameLoopService } from './lib/services/game-loop.service';
import { GameStateService } from './lib/services/game-state.service';

@Component({
  selector: 'app-root',
  imports: [DeathMenuComponent, MainMenuComponent, GameCanvaComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  title = 'elden-angular';
  gameState = inject(GameStateService);

  gameLoop = inject(GameLoopService);
  frameCount: number = 0;

  ngOnInit() {
    this.gameLoop.onUpdate(() => {
      this.frameCount++;
    });
  }

  startTest() {
    this.gameLoop.start();
  }

  stopTest() {
    this.gameLoop.stop();
  }
}
