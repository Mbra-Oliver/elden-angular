import { Component, inject } from '@angular/core';
import { MenuItem } from '../../lib/interfaces/MenuItem';
import { GameStateService } from '../../lib/services/game-state.service';

@Component({
  selector: 'app-death-menu',
  imports: [],
  templateUrl: './death-menu.component.html',
  styleUrl: './death-menu.component.css',
})
export class DeathMenuComponent {
  gameService = inject(GameStateService);
  menusItems: MenuItem[] = [
    {
      label: 'REESSAYER',
      action: () => {},
    },
    {
      label: 'ALLER AU MENU',
      action: () => this.gameService.returnToMainMenu(),
    },
    {
      label: 'QUITTER',
      action: () => {},
    },
  ];

  executeItem(i: number) {
    this.menusItems[i].action();
  }
}
