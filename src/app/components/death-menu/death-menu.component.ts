import { Component } from '@angular/core';


interface MenuItem{
  label: string;
  action:()=>void
}

@Component({
  selector: 'app-death-menu',
  imports: [],
  templateUrl: './death-menu.component.html',
  styleUrl: './death-menu.component.css'
})
export class DeathMenuComponent {

  menusItems = [
    {
      label: 'REESSAYER',
      action:()=>{}
    },
    {
      label: 'ALLER AU MENU',
      action:()=>{}
    },
    {
      label: 'QUITTER',
      action:()=>{}
    }
  ]

}
