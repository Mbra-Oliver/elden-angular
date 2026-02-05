import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DeathMenuComponent } from './components/death-menu/death-menu.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet,DeathMenuComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'elden-angular';
}
