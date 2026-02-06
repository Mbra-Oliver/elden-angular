import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DeathMenuComponent } from './components/death-menu/death-menu.component';
import { MainMenuComponent } from './components/main-menu/main-menu.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, DeathMenuComponent, MainMenuComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  title = 'elden-angular';

  gameMode = signal<'start' | 'death'>('start');
}
