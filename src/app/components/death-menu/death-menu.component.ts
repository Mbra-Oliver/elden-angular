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
      label: 'Réessayer',
      action: () => this.gameService.retry(),
    },
    {
      label: 'Retour au village',
      action: () => this.gameService.returnToMainMenu(),
    },
  ];

  executeItem(i: number) {
    this.menusItems[i].action();
  }
}
