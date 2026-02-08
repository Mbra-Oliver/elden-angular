import { inject, Injectable } from '@angular/core';
import {
  HEAVY_ATTACK,
  LIGHT_COMBO,
  PLAYER_CONFIG,
} from '../constants/player.config-constant';
import { PlayerData } from '../interfaces/PlayerData';
import { InputService } from '../services/input.service';
import { RendererService } from '../services/renderer.service';
import { PlayerStore } from './player/player.store';

@Injectable({
  providedIn: 'root',
})
export class PlayerEntity {
  store = inject(PlayerStore);
  input = inject(InputService);
  private renderer = inject(RendererService);

  //Creer une methode UPDATE qui sera appelé a chaque frame (60 fois par seconde)

  /**
   * @param deltaTime - Temps écoulé depuis la derniere frame (en secondes)
   */

  //Temps avant que la stamina se regenere
  private staminaRegenCooldown = 0;

  update(deltaTime: number) {
    const data = this.store.getData();
    //Si le joueur est mort on ne fait rien.

    if (data.state === 'dead') return;

    switch (data.state) {
      case 'idle':
      case 'moving':
        //Pour le moment on va juste rester sur idle, moving
        this.handleMovement(deltaTime);
        break;
      case 'attacking':
        this.handleAttacking(deltaTime);
        break;

      case 'rolling':
        this.handleRolling(deltaTime);
        break;

      case 'exhausted':
        this.handleExhausted(deltaTime);
        break;
    }

    this.updateStamina(deltaTime);
    this.clampPosition();
  }

  private handleMovement(deltaTime: number) {
    const data = this.store.getData();

    //Essayer de l'ecouter ici.

    if (data.comboTimer > 0) {
      const newComboTimer = data.comboTimer - deltaTime * 1000;

      if (newComboTimer <= 0) {
        this.store.update({
          comboTimer: 0,
          comboCount: 0,
        });
      } else {
        this.store.update({
          comboTimer: newComboTimer,
        });
      }
    }

    //Lire les inputs sur les directions. dx -> directionX ; dy->directionY

    const dx = (this.input.right() ? 1 : 0) - (this.input.left() ? 1 : 0);
    const dy = (this.input.down() ? 1 : 0) - (this.input.up() ? 1 : 0);

    //Probleme sur les diagonales a gerer.
    //Si on appuie sur Haut + Droite: dx = 1 et dy = -1
    //Commet sera le calcul de la vitesse ->

    // 2. Calculer la longueur du vecteur (Magnitude)
    // Formule : racine carrée de (x² + y²)

    const length = Math.sqrt(dx * dx + dy * dy);
    const normX = length > 0 ? dx / length : 0;
    const normY = length > 0 ? dy / length : 0;

    const speed = PLAYER_CONFIG.speed;

    //Calculer la nouvelle position

    const newX = data.x + normX * speed * deltaTime;
    const newY = data.y + normY * speed * deltaTime;

    //Mettre a jour la position
    const changes: Partial<typeof data> = {
      x: newX,
      y: newY,
      vx: normX * speed,
      vy: normY * speed,
      state: length > 0 ? 'moving' : 'idle',
    };

    //Mettre a jour la direction du regard
    if (length > 0) {
      changes.facingX = dx;
      changes.facingY = dy;
    }

    this.store.update(changes);

    // VERIFIER SI ON A INTERRAGI AVEC LES TOUCHES D'ATTAQUES

    const currentData = this.store.getData();
    //Je dois savoir si on a fais une attaque legere ou lourde . Et si c'est une attaque legere c'est laquelle

    const lightAttack = this.getCurrentLightAttack(currentData.comboCount);

    if (this.input.attack() && currentData.stamina >= lightAttack.staminaCost) {
      //Entrer en mode attaque rapide

      this.enterLightAttack();
      return;
    }

    if (
      this.input.heavyAttack() &&
      currentData.stamina >= HEAVY_ATTACK.staminaCost
    ) {
      this.enterHeavyAttack();
      return;
    }

    //Gerer le cas de roulade.

    if (this.input.dodge() && currentData.stamina >= PLAYER_CONFIG.rollCost) {
      this.enterRoll();
      return;
    }
  }

  private getCurrentLightAttack(comboIndex: number) {
    return LIGHT_COMBO[Math.min(comboIndex, LIGHT_COMBO.length - 1)];
  }

  //Entrer en mode attaque rapide (COMBO)
  private enterLightAttack() {
    const data = this.store.getData();
    const attack = this.getCurrentLightAttack(data.comboCount);

    this.store.update({
      state: 'attacking',
      attackType: 'light',
      comboCount: data.comboCount + 1,
      stateTimer: attack.duration,
      vx: 0,
      vy: 0,
      comboTimer: 0,
      stamina: data.stamina - attack.staminaCost,
    });

    this.staminaRegenCooldown = PLAYER_CONFIG.staminaRegenDelay;
  }

  //Entrer en mode attaque lourde

  private enterHeavyAttack() {
    const data = this.store.getData();

    this.store.update({
      state: 'attacking',
      attackType: 'heavy',
      stateTimer: HEAVY_ATTACK.duration,
      vx: 0,
      vy: 0,
      comboTimer: 0,
      comboCount: 0,
      stamina: data.stamina - HEAVY_ATTACK.staminaCost,
    });

    this.staminaRegenCooldown = PLAYER_CONFIG.staminaRegenDelay;
  }

  //Pour rentrer dans le mode roulade.

  private enterRoll() {
    const data = this.store.getData();

    this.store.update({
      state: 'rolling',
      stateTimer: PLAYER_CONFIG.rollDuration,
      comboTimer: 0,
      comboCount: 0,
      stamina: data.stamina - PLAYER_CONFIG.rollCost,
      invicible: true,
      attackType: 'none',
    });

    this.staminaRegenCooldown = PLAYER_CONFIG.staminaRegenDelay;
  }

  //Gerer le roll (Roulade)

  private handleRolling(deltaTime: number) {
    const data = this.store.getData();
    const newTimer = data.stateTimer - deltaTime * 1000; //Pour convertir en MilliSeconde

    //Gerer les deplacement

    const length = Math.sqrt(data.facingX ** 2 + data.facingY ** 2);
    const normX = length > 0 ? data.facingX / length : 1;
    const normY = length > 0 ? data.facingY / length : 0;

    const rollSpeed = PLAYER_CONFIG.rollSpeed; // 300px par secondes

    const newX = data.x + normX * rollSpeed * deltaTime;
    const newY = data.y + normY * rollSpeed * deltaTime;

    if (newTimer <= 0) {
      this.store.update({
        state: 'idle',
        stateTimer: 0,
        vx: 0,
        vy: 0,
        x: newX,
        y: newY,
        invicible: false, //Si l'animation fini il n'est plus invincible
      });

      if (this.store.getData().stamina <= 0) {
        this.enterExhausted();
      }
    } else {
      this.store.update({
        stateTimer: newTimer,
        x: newX,
        y: newY,
      });
    }
  }

  //Pouvoir gerer les attaques

  private handleAttacking(deltaTime: number) {
    const data = this.store.getData();

    const newTimer = data.stateTimer - deltaTime * 1000; //Pour convertir en MilliSeconde
    if (newTimer <= 0) {
      const openCombo =
        data.attackType === 'light' && data.comboCount < LIGHT_COMBO.length;

      this.store.update({
        state: 'idle',
        stateTimer: 0,
        vx: 0,
        vy: 0,
        attackType: 'none',
        comboTimer: openCombo ? PLAYER_CONFIG.comboWindowDuration : 0,
        comboCount: openCombo ? data.comboCount : 0,
      });

      //Vérifier si on est pas épuisé
      if (this.store.getData().stamina <= 0) {
        this.enterExhausted();
      }
    } else {
      this.store.update({
        stateTimer: newTimer,
      });
    }
  }

  //Une fonction pour qua d l'utilisateur est a bout de souffle

  private enterExhausted() {
    this.store.update({
      state: 'exhausted',
      stateTimer: PLAYER_CONFIG.exhaustedDuration,
      vx: 0,
      vy: 0,
      comboCount: 0,
      comboTimer: 0,
      attackType: 'none',
    });
  }

  private handleExhausted(deltaTime: number) {
    const data = this.store.getData();
    const newTimer = data.stateTimer - deltaTime * 1000; //Pour convertir en MilliSeconde
    if (newTimer <= 0) {
      this.store.update({
        state: 'idle',
        stateTimer: 0,
      });
    } else {
      this.store.update({
        stateTimer: newTimer,
      });
    }
  }

  //Regeneration de stamina

  private updateStamina(delatTime: number) {
    const data = this.store.getData();

    if (data.state === 'attacking' || data.state === 'rolling') return;

    //Petit délai avat de regenerer le souffle.

    if (this.staminaRegenCooldown > 0) {
      this.staminaRegenCooldown -= delatTime * 1000;
      return;
    }

    //Regenerer la stamina

    if (data.stamina < data.maxStamina) {
      const newStamina = Math.min(
        data.maxStamina,
        data.stamina + PLAYER_CONFIG.staminaRegen * delatTime,
      );
      this.store.update({
        stamina: newStamina,
      });
    }
  }

  //Empecher le joueur de sortir du terrain  en fonction de la limite du canevas

  private clampPosition() {
    const data = this.store.getData();
    const size = PLAYER_CONFIG.size;

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

  render() {
    const data = this.store.getData();
    const size = PLAYER_CONFIG.size;

    let color = '#4ecdc4';

    switch (data.state) {
      case 'moving':
        color = '#5be6d4';
        break;
      case 'attacking':
        color = data.attackType === 'light' ? '#ff3333' : '#d77710ff';
        break;
      case 'exhausted':
        color = '#3313a8ff';
        break;
      case 'rolling':
        color = '#e7fb0bff';
    }

    // if (data.state === 'moving') {
    //   color = '#5be6d4';
    // }
    //Dessiner le corps du joueur (Un carré)

    this.renderer.fillRect(data.x, data.y, size, size, color);

    //Dessiner un indicateur de direction

    const indicatorSize = 6;
    const centerX = data.x + size / 2;
    const centerY = data.y + size / 2;

    //Normaliser la direction du regard avec Math.sqrt

    const fLen = Math.sqrt(data.facingX ** 2 + data.facingY ** 2);

    const normFx = fLen > 0 ? data.facingX / fLen : 1;
    const normFy = fLen > 0 ? data.facingY / fLen : 0;

    //Position de l'indicateur (devant le joueur)

    const indX = centerX + normFx * (size / 2 + 4) - indicatorSize / 2;
    const indY = centerY + normFy * (size / 2 + 4) - indicatorSize / 2;

    this.renderer.fillRect(indX, indY, indicatorSize, indicatorSize, '#ffffff');

    //HITBOX D'ATTAQUE

    if (data.state === 'attacking') {
      // const attackData = this.get
      //Avoir des infos sur l'attaque actuelle. Legere ou lourde.
      const attackData = this.getActiveAttackData(data);
      const attackRange = size * attackData.range;
      //On doit avoir les infos sur l'attaque sur les axes X et Y
      const attackX =
        centerX + normFx * (size / 2 + attackRange / 2) - attackRange / 2;

      const attackY =
        centerY + normFy * (size / 2 + attackRange / 2) - attackRange / 2;

      const hitBoxColor = data.attackType === 'heavy' ? '#ff3333' : '#d77710ff';

      //Visualiser la hitbox

      this.renderer.strokeRect(
        attackX,
        attackY,
        attackRange,
        attackRange,
        hitBoxColor,
        2,
      );
    }

    //Barre de HPT

    this.renderer.drawBar(
      data.x,
      data.y - 12,
      size,
      5,
      data.hp,
      data.maxHp,
      '#ff3333',
    );

    //Barre de stamina

    const staminaRatio = data.stamina / data.maxStamina;
    let staminaColor = '#45e9a0';
    if (staminaRatio < PLAYER_CONFIG.staminaLowThreshold) {
      staminaColor =
        Math.floor(Date.now() / 200) % 2 === 0 ? '#ff3333' : '#45e9a0';
    }

    this.renderer.drawBar(
      data.x,
      data.y - 7,
      size,
      3,
      data.stamina,
      data.maxStamina,
      staminaColor,
    );

    //SI on fais des combo. Je veux les affichers.

    if (data.comboTimer > 0 && data.comboCount > 0) {
      this.renderer.drawText(
        `COMBO x${data.comboCount}`,
        data.x,
        data.y - 22,
        '#ffe66d',
      );
    }

    //Ramener mon label d'etat

    const yOffset = data.comboTimer > 0 ? 30 : 18;
    this.renderer.drawText(
      data.state.toUpperCase(),
      data.x,
      data.y - yOffset,
      '#88888',
    );

    //Indicateur de debug

    // this.renderer.drawText(
    //   data.state.toUpperCase(),
    //   data.x,
    //   data.y - 10,
    //   '#88888',
    // );
  }

  getActiveAttackData(data?: PlayerData) {
    const d = data ?? this.store.getData();

    if (d.attackType === 'heavy') {
      return HEAVY_ATTACK;
    }

    //Attaque rapide : A prendre selon le combo

    const comboIndex = Math.max(0, d.comboCount - 1);

    return LIGHT_COMBO[Math.min(comboIndex, LIGHT_COMBO.length - 1)];
  }

  //Function pour avoir des infos sur l'attaque

  // getActiveAttackData(data?: PlayerData): AttackData {
  //   const d = this.store.getData();
  //   // if (data.state !== 'attacking') return null;
  //   // return data.attackData;
  // }
}
