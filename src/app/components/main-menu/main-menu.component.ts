import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ChevronRight, LucideAngularModule } from 'lucide-angular';
import { MenuItem } from '../../lib/interfaces/MenuItem';
@Component({
  selector: 'app-main-menu',
  imports: [LucideAngularModule, CommonModule],
  templateUrl: './main-menu.component.html',
  styleUrl: './main-menu.component.css',
})
export class MainMenuComponent implements OnInit, OnDestroy {
  readonly ChevronRightIcon = ChevronRight;
  //Menus du jeu
  menuItems: MenuItem[] = [
    {
      label: 'Jouer',
      action: () => {
        alert(`Jouer au jeu`);
      },
    },
    {
      label: 'Continuer',
      action: () => {
        alert(`Jeu a demarrer`);
      },
    },
    {
      label: 'Options',
      action: () => {
        alert(`Options du jeu`);
      },
    },
    {
      label: 'Quitter',
      action: () => {
        alert(`Quitter le jeu`);
      },
    },
  ];

  embers = this.generateEmbers(20);

  private keydownHandler = this.handleKeyDown.bind(this);
  ngOnInit() {
    window.addEventListener('keydown', this.keydownHandler);
  }

  ngOnDestroy() {
    window.removeEventListener('keydown', this.keydownHandler);
  }

  //Connaitre l'index de l'option qu'on survol ou qu'on selectionne

  selectedIndex = signal<number>(0);

  // Naviguer avec les flèches

  private handleKeyDown(event: KeyboardEvent) {
    console.log(`event`, event);

    //Ecouter les evenements clavier
    switch (event.key) {
      case 'ArrowUp':
      case 'W':
      case 'w':
        event.preventDefault();
        //Mettre a jour la variable d'index
        this.selectedIndex.update(
          (i) => (i - 1 + this.menuItems.length) % this.menuItems.length,
        );

        break;

      case 'ArrowDown':
      case 'S':
      case 's':
        event.preventDefault();
        this.selectedIndex.update((i) => (i + 1) % this.menuItems.length);
        break;

      case 'Enter':
      case ' ':
        event.preventDefault();
        this.menuItems[this.selectedIndex()].action();
        break;
    }
  }

  generateEmbers(totalElement: number) {
    return Array.from({ length: totalElement }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 5,
      duration: Math.random() * 4,
    }));
  }
}
