//Gerer le jeu en cours

import { computed, Injectable, signal } from '@angular/core';
import { GameState } from '../interfaces/GameState';

@Injectable({
  providedIn: 'root',
})
export class GameStore {
  //Gestionnaire d'etat pour tout gerer ce qui concerne l'etat du jeu

  private state = signal<GameState>({
    isRunning: false, //jeu en cours
    deltaTime: 0, //duree de la derniere frame
    fps: 0, //nombre d'images par seconde,
    frameCount: 0, //nombre d'images affichees
    lastTimeStamp: 0, //timestamp de la derniere frame
  });

  //Leurs equivalents public qui ecoute les changements en temps réel.

  isRunning = computed(() => this.state().isRunning);
  deltaTime = computed(() => this.state().deltaTime);
  fps = computed(() => this.state().fps);
  frameCount = computed(() => this.state().frameCount);
  lastTimeStamp = computed(() => this.state().lastTimeStamp);

  //Fonction qui va se charger de lancer le jeu

  start() {
    console.warn(`DEMARRAGE DU JEU...`);

    this.state.update((state) => ({
      ...state,
      isRunning: true,
      lastTimeStamp: performance.now(),
      frameCount: 0,
    }));
  }

  stop() {
    this.state.update((state) => ({
      ...state,
      isRunning: false,
    }));
  }

  //Mettre à jour les valeurs de fps et deltaTime en fonction de la derniere frame
  updateFrame(timestamp: number) {
    const last = this.state().lastTimeStamp;
    const deltaTime = (timestamp - last) / 1000; //Delta en seconde
    const fps = deltaTime > 0 ? Math.round(1 / deltaTime) : 0;

    this.state.update((state) => ({
      ...state,
      deltaTime,
      fps,
      lastTimeStamp: timestamp,
      frameCount: state.frameCount + 1,
    }));
  }
}
