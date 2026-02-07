import { inject, Injectable, NgZone } from '@angular/core';
import { GameStore } from '../store/game.store';

@Injectable({
  providedIn: 'root',
})
export class GameLoopService {
  //GameLoop -> Chaque jeu est une boucle infinie qui tourne en executant des actions

  //1. UPDATE-> Appelle toutes les fonctions enregistrer qui peuvent changer l'etat du jeu (physique, le graphisme, etc...)

  //2. RENDER -> Afficher toutes les fonctions qui permette de rendre qqch a l'ecran

  //3. REPREND EN BOUCLE DEPUIS L'ETAPE 1 -> Boucle infinie

  private ngZone = inject(NgZone);
  private gameStore = inject(GameStore);

  //FRAME -> IMAGE -> POUR CHAQUE FRAME ON DOIT AVOIR UN IDENTIFIANT -> SUPPRIMER L'IMAGE DU DECORS OU DE LA SCENE

  //Id de la frame actuelle

  private animationFrameId: number | null = null;

  //Geler des frames . On verifiera si la valeur est > 0, on pourra skipper l'update et continuer le render.

  private freezeFrames = 0;

  //Callback pour que les futurs services puissent utiliser ces fonctions.
  private updateCallbacks: Array<(deltaTime: number) => void> = [];
  private renderCallbacks: Array<() => void> = [];

  constructor() {}

  start() {
    console.log(`APPELLER DEPUIS GAMELOOP SERVICE...`);
    //Si isRunning est en cours alors le jeu a deja demarrer
    if (this.gameStore.isRunning()) return;

    this.gameStore.start();

    this.loop();
  }

  stop() {
    this.gameStore.stop();
  }

  //GameLoop -> Chaque jeu est une boucle infinie qui tourne en executant des actions

  //1. UPDATE-> Appelle toutes les fonctions enregistrer qui peuvent changer l'etat du jeu (physique, le graphisme, etc...)

  //2. RENDER -> Afficher toutes les fonctions qui permette de rendre qqch a l'ecran

  //3. REPREND EN BOUCLE DEPUIS L'ETAPE 1 -> Boucle infinie

  //Elle s'appelle elle même en boucle

  private loop() {
    console.error(`BOUCLE DE JEU EN COURS...`);
    //Utilisateur a bien demarrer le jeu
    if (!this.gameStore.isRunning()) return;

    //Recuperer le temps actuelle ->derniere frame

    const timestamp = performance.now();

    //Mettre a jour le store

    this.gameStore.updateFrame(timestamp);

    //On tape un adversaire (THEORIE) on veut bloquer la mise a jour mais on veut continuer de render.
    if (this.freezeFrames > 0) {
      this.freezeFrames--;

      //Ca tourne en permanence. Donc si on prend 1 coup, on veut donner l'impression d'arrêter (pour voir le freeze)

      this.ngZone.run(() => {
        this.renderCallbacks.forEach((callback) => callback());
      });

      this.animationFrameId = window.requestAnimationFrame(() => this.loop());
      return;
    }

    //Recuperer le dernier temps passé.

    const deltaTime = this.gameStore.deltaTime();
    //1. UPDATE-> Appelle toutes les fonctions enregistrer qui peuvent changer l'etat du jeu (physique, le graphisme, etc...)

    //2. RENDER -> Afficher toutes les fonctions qui permette de rendre qqch a l'ecran

    //3. REPREND EN BOUCLE DEPUIS L'ETAPE 1 -> Boucle infinie

    //Elle s'appelle elle même en boucle

    //=================================
    // Phase 1: Logique du jeu
    //=======================

    this.updateCallbacks.forEach((callback) => callback(deltaTime));

    //==================
    // Phase 2: Affichage
    //==================

    //Utiliser ngZone pour me rassurer que les changements sont détectés.

    this.ngZone.run(() => {
      this.renderCallbacks.forEach((callback) => callback());
    });

    //===========
    //Phase 3: Déclencher la boucle infinie
    //===========

    this.animationFrameId = requestAnimationFrame(() => this.loop());
  }
}
