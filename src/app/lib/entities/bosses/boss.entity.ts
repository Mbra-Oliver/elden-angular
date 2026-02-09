import { inject, Injectable } from '@angular/core';
import { BOSS_CONFIG } from '../../constants/boss.config-constant';
import { PLAYER_CONFIG } from '../../constants/player.config-constant';
import { BossData } from '../../interfaces/BossData';
import { RendererService } from '../../services/renderer.service';
import { PlayerStore } from '../player/player.store';
import { BossStore } from './boss.store';

@Injectable({
  providedIn: 'root',
})
export class BossEntity {
  private store = inject(BossStore);

  //on doit poursuivre le joueur dans le jeu ou detecter le joueur

  private playerStore = inject(PlayerStore);

  //Dessiner le boss dans l'environnement.
  private renderer = inject(RendererService);

  update(deltaTime: number) {
    //Les differents etats du boss

    const data = this.store.getData();
    //Si le joueur est mort on ne fait rien.

    if (data.state === 'dead') return;

    switch (data.state) {
      case 'idle':
        this.handleIdle(deltaTime);
        break;
      case 'chase':
        this.handleChase(deltaTime);
        break;
      case 'hurt':
        this.handleHurt(deltaTime);
        break;
    }

    this.clampPosition();
  }

  //Methode quand le boss ne bouge pas.

  handleIdle(deltaTime: number) {
    const data = this.store.getData();
    const newTimer = data.stateTimer - deltaTime * 1000; //Pour convertir en MilliSeconde
    if (newTimer <= 0) {
      //On doit connaitre la positionn du boss par apport au joueur.
      const distanceBetweenPlayerAndBoss = this.distanceToPlayer();

      //distToPlayer: Distance entre le joueur et le boss.

      if (distanceBetweenPlayerAndBoss <= BOSS_CONFIG.chaseRange) {
        this.store.update({
          state: 'chase',
          stateTimer: 0,
        });
      } else {
        this.store.update({
          stateTimer: BOSS_CONFIG.idlePauseDuration,
        });
      }
    } else {
      this.store.update({
        stateTimer: newTimer,
      });
    }
  }

  private distanceToPlayer() {
    const b = this.store.getData();
    const p = this.playerStore.getData();

    // Calcul de la différence sur les axes (en partant du centre des entités)
    const dx = p.x + PLAYER_CONFIG.size / 2 - (b.x + BOSS_CONFIG.size / 2);
    const dy = p.y + PLAYER_CONFIG.size / 2 - (b.y + BOSS_CONFIG.size / 2);

    // La formule corrigée : racine carrée de (dx² + dy²)
    return Math.sqrt(dx * dx + dy * dy);
  }

  //Methode pour poursuivre le joueur

  handleChase(deltaTime: number) {
    //Logique de poursuite du Player

    const player = this.playerStore.getData(); //Info sur le player
    const boss = this.store.getData(); //Info sur le boss

    // 1. Calculer la distance sur chaque axe (du centre vers le centre)
    const dx =
      player.x + PLAYER_CONFIG.size / 2 - (boss.x + BOSS_CONFIG.size / 2);
    const dy =
      player.y + PLAYER_CONFIG.size / 2 - (boss.y + BOSS_CONFIG.size / 2);

    // 2. Calculer la distance réelle (Hypoténuse)
    const distance = Math.sqrt(dx * dx + dy * dy);

    //30 metre du boss et la porter du boss est a 29 metre. ALors il ne fait rien puisque le joueur n'est pas assez proche.

    if (distance > BOSS_CONFIG.chaseRange) {
      this.store.update({
        state: 'idle',
        stateTimer: BOSS_CONFIG.idlePauseDuration,
      });

      return;
    }

    if (distance > 5) {
      // 3. Calculer la vitesse
      const speed = BOSS_CONFIG.speed;
      const normX = dx / distance;
      const normY = dy / distance;
      this.store.update({
        x: boss.x + normX * speed * deltaTime,
        y: boss.y + normY * speed * deltaTime,
        facingX: normX,
        facingY: normY,
      });
    }
  }

  //Methode quand le boss est attaquer

  handleHurt(deltaTime: number) {
    const data = this.store.getData();
    const newTimer = data.stateTimer - deltaTime * 1000;

    //Zone de friction -> Zone de potentiel combat. Zone ou le boss prend des dommages.

    const friction = 0.85;
    const newVx = data.vx * friction;
    const newVy = data.vy * friction;

    // 3. Mise à jour du store
    this.store.update({
      vx: Math.abs(newVx) < 1 ? 0 : newVx,
      vy: Math.abs(newVy) < 1 ? 0 : newVy,
      x: data.x + data.vx * deltaTime,
      y: data.y + data.vy * deltaTime,
    });

    // 4. Transition d'état : si le timer tombe à 0, on repasse en mode IDLE ou CHASE
    if (newTimer <= 0) {
      this.store.update({
        state: 'idle',
        stateTimer: BOSS_CONFIG.idlePauseDuration,
      });
    } else {
      this.store.update({
        stateTimer: newTimer,
      });
    }
  }

  //Methode pour quand le boss est attaquer

  /**
   * @param {number} amount - The amount of damage to take
   */

  private takeDamage(amount: number, x: number, y: number) {
    const data = this.store.getData();
    if (data.state === 'dead') return;

    const newHp = Math.max(0, data.hp - amount);

    this.store.update({
      hp: newHp,
    });

    if (newHp <= 0) {
      this.store.update({
        state: 'dead',
        stateTimer: 0,
        vx: 0,
        vy: 0,
      });
    } else {
      this.store.update({
        state: 'hurt',
        stateTimer: BOSS_CONFIG.hurtDuration,
        vx: x,
        vy: y,
      });
    }
  }

  //Créer une methode qui empeche le boss de sortir de la zone de jeu

  private clampPosition() {
    const data = this.store.getData();
    const size = BOSS_CONFIG.size;

    //Les limites du cancas.

    const maxX = this.renderer.width - size;
    const maxY = this.renderer.height - size;

    //Limiter x etre 0 et maxX
    const clampedX = Math.max(0, Math.min(maxX, data.x));
    const clampedY = Math.max(0, Math.min(maxY, data.y));

    //Mettre a jour la position que si on detecte qu'ellle a changer.

    if (clampedX !== data.x || clampedY !== data.y) {
      this.store.update({
        x: clampedX,
        y: clampedY,
      });
    }
  }

  render(): void {
    const data = this.store.getData();
    const size = BOSS_CONFIG.size;
    const phase = this.store.phase();

    console.log(`STATE DU BOSS::::`, data.state);

    let bodyColor = '#C5A059'; // Or terni / Bronze (L'armure de Malenia)

    switch (data.state) {
      case 'chase':
        // Un doré plus éclatant ou "divin" pour la détermination
        bodyColor = '#E6B34B';
        break;
      case 'hurt':
        // Le rouge de la Putréfaction Écarlate (sombre, organique, inquiétant)
        bodyColor = '#8B0000';
        break;
      case 'dead':
        // Une couleur de pétales fanés ou de chair corrompue
        bodyColor = '#4A3728';
        break;
    }

    this.renderer.fillRect(data.x, data.y, size, size, bodyColor);

    //Le boss a deux phases ????

    if (phase === 2 && data.state !== 'dead') {
      // 1. Création d'une oscillation (pulse) entre 0 et 1
      // On utilise Date.now() pour avoir un mouvement continu
      const speed = 0.005; // Ajuste la vitesse du battement
      const pulse = (Math.sin(performance.now() * speed) + 1) / 2;

      // 2. Calcul de l'opacité (Alpha) en hexadécimal (00 à FF)
      // On veut que l'aura oscille entre une certaine transparence
      const alphaVal = Math.floor(pulse * 150) + 50; // Entre 50 et 200
      const alphaHex = alphaVal.toString(16).padStart(2, '0');

      // 3. Couleur : Un orange/rouge "Putréfaction" avec l'alpha dynamique
      const auraColor = `#ff4500${alphaHex}`;

      // 4. Rendu de l'aura (un peu plus grande que le boss)
      const auraSize = size + Math.sin(Date.now() * 0.01) * 10;
      const offsetX = (auraSize - size) / 2;

      this.renderer.fillRect(
        data.x - offsetX,
        data.y - offsetX,
        auraSize,
        auraSize,
        auraColor,
      );

      // 5. On dessine le corps du boss par-dessus l'aura
      this.renderer.strokeRect(
        data.x - 2,
        data.y - 2,
        size + 4,
        size + 4,
        bodyColor,
        3,
      );
    }

    //Afficher l'etat du boss sur sa tête
    this.renderer.drawText(
      data.state.toUpperCase(),
      data.x,
      data.y - 14,
      '#aaa',
    );

    //Afficher la vie du boss
    this.renderBossHpBar(data);
  }

  private renderBossHpBar(data: BossData) {
    if (data.state === 'dead') return;

    const barWidth = 500; // Un peu plus large pour le côté épique
    const barHeight = 8; // Plus fine pour plus d'élégance
    const barX = (this.renderer.width - barWidth) / 2;
    const barY = this.renderer.height - 60;

    // 1. Fond et Bordure style "Elden Ring"
    // Un noir profond avec une fine bordure dorée
    this.renderer.fillRect(
      barX - 2,
      barY - 2,
      barWidth + 4,
      barHeight + 4,
      '#1a1a1a',
    );
    this.renderer.strokeRect(
      barX - 2,
      barY - 2,
      barWidth + 4,
      barHeight + 4,
      '#C5A059',
      1,
    );

    // 2. Détermination de la couleur selon la phase
    // Phase 1 : Or terni / Phase 2 : Rouge Putréfaction
    const isPhase2 = this.store.phase() === 2;
    const hpColor = isPhase2 ? '#8B0000' : '#C5A059';

    // 3. Dessin de la barre de vie
    this.renderer.drawBar(
      barX,
      barY,
      barWidth,
      barHeight,
      data.hp,
      data.maxHp,
      hpColor,
    );

    // 4. Texte stylisé
    const name = isPhase2
      ? 'MALENIA, DÉESSE DE LA PUTRÉFACTION'
      : 'MALENIA, ÉPÉE DE MIQUELLA';

    // On centre le texte au-dessus de la barre
    const textX = barX + barWidth / 2;
    this.renderer.drawText(
      name.toUpperCase(),
      textX,
      barY - 12,
      '#F5F5DC', // Beige/Ivoire pour le texte
    );

    // 5. Petit bonus : Ornement sur les côtés
    this.renderDecorativeOrnaments(barX, barY, barWidth, barHeight);
  }

  private renderDecorativeOrnaments(
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    const ornamentSize = 6;
    const color = '#C5A059'; // Ton doré signature

    // Fonction interne pour dessiner un losange (Diamond)
    const drawDiamond = (centerX: number, centerY: number) => {
      // On dessine un petit carré pivoté
      this.renderer.fillRect(
        -ornamentSize / 2,
        -ornamentSize / 2,
        ornamentSize,
        ornamentSize,
        color,
      );
    };

    // 1. Ornement à Gauche
    drawDiamond(x - 10, y + height / 2);
    // 2. Ornement à Droite
    drawDiamond(x + width + 10, y + height / 2);
    // 3. Optionnel : Une ligne de séparation fine sous le nom
    this.renderer.fillRect(x, y - 4, width, 1, '#C5A05944');
  }
}
