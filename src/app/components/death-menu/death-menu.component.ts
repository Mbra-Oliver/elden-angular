import { Component } from '@angular/core';
import { MenuItem } from '../../lib/interfaces/MenuItem';

@Component({
  selector: 'app-death-menu',
  imports: [],
  templateUrl: './death-menu.component.html',
  styleUrl: './death-menu.component.css',
})
export class DeathMenuComponent {
  menusItems: MenuItem[] = [
    {
      label: 'REESSAYER',
      action: () => {},
    },
    {
      label: 'ALLER AU MENU',
      action: () => {},
    },
    {
      label: 'QUITTER',
      action: () => {},
    },
  ];
}
