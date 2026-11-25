import { Component, inject } from '@angular/core';
import { MenuItem } from '../../lib/interfaces/MenuItem';
import { GameStateService } from '../../lib/services/game-state.service';
import { ChallengeService, beats, describe, formatTime } from '../../lib/social/challenge.service';

@Component({
  selector: 'app-death-menu',
  imports: [],
  templateUrl: './death-menu.component.html',
  styleUrl: './death-menu.component.css',
})
export class DeathMenuComponent {
  gameService = inject(GameStateService);
  readonly challenge = inject(ChallengeService);
  readonly describe = describe;
  readonly formatTime = formatTime;
  readonly beats = beats;
  menusItems: MenuItem[] = [
    {
      label: 'Revenir au foyer',
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
