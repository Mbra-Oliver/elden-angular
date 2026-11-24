import { inject, Injectable } from '@angular/core';
import {
  COUNTER_ATTACK,
  HEAVY_ATTACK,
  LIGHT_COMBO,
  PLAYER_CONFIG,
} from '../../constants/player.config-constant';
import {
  PLAYER_CLIPS,
  PLAYER_SHEET,
  playerStateToClip,
} from '../../constants/sprite-config';
import { drawPose } from '../../engine/pose-atlas';
import { ActorMotion } from '../../engine/actor-motion';
import { TerrainCollisionService } from '../../engine/terrain-collision.service';
import { AssetLoaderService } from '../../engine/asset-loader.service';
import { Animator } from '../../engine/sprite';
import { PlayerData } from '../../interfaces/PlayerData';
import { InputService } from '../../services/input.service';
import { RendererService } from '../../services/renderer.service';
import { PlayerStore } from './player.store';

@Injectable({
  providedIn: 'root',
})
export class PlayerEntity {
  store = inject(PlayerStore);
  input = inject(InputService);
  private readonly motion = new ActorMotion();
  private readonly terrain = inject(TerrainCollisionService);
  private renderer = inject(RendererService);
  private assets = inject(AssetLoaderService);

  private animator = new Animator(PLAYER_SHEET, PLAYER_CLIPS, 'idle');

  //Creer une methode UPDATE qui sera appelé a chaque frame (60 fois par seconde)

  /**
   * @param deltaTime - Temps écoulé depuis la derniere frame (en secondes)
   */

  //Temps avant que la stamina se regenere
  private staminaRegenCooldown = 0;

  private cameraHeading: number | null = null;
  setCameraHeading(heading: number | null) {
    this.cameraHeading = heading;
  }

  private dodgeHeld = false;
  private dodgeQueued = false;

  resetCombat() {
    this.staminaRegenCooldown = 0;
    this.motion.reset();
    this.dodgeHeld = false;
    this.dodgeQueued = false;
  }

  tryCounter(targetX: number, targetY: number): boolean {
    const data = this.store.getData();
    const dx = targetX - this.centerX;
    const dy = targetY - this.centerY;
    const distance = Math.hypot(dx, dy);
    if (!this.input.attack() || distance > 225 ||
        data.state === 'dead' || data.state === 'hurt') return false;

    const facingX = distance ? dx / distance : data.facingX;
    const facingY = distance ? dy / distance : data.facingY;
    const speed = Math.max(0, distance - 38) / 0.16;
    this.store.update({
      state: 'attacking',
      attackType: 'counter',
      stateTimer: COUNTER_ATTACK.duration,
      facingX, facingY,
      vx: facingX * speed, vy: facingY * speed,
      invicible: true,
      comboCount: 0, comboTimer: 0,
    });
    return true;
  }

  update(deltaTime: number, target?: { x: number; y: number }) {
    const data = this.store.getData();
    //Si le joueur est mort on ne fait rien.

    if (data.state === 'dead') return;

    const dodgeDown = this.input.dodge();
    const dodgePressed = dodgeDown && !this.dodgeHeld;
    this.dodgeHeld = dodgeDown;
    if (dodgePressed && data.state === 'attacking' && data.stateTimer <= 100) {
      this.dodgeQueued = true;
    }
    const queuedDodge = this.dodgeQueued && (data.state === 'idle' || data.state === 'moving');
    if (data.state !== 'attacking') this.dodgeQueued = false;

    switch (data.state) {
      case 'idle':
      case 'moving':
        //Pour le moment on va juste rester sur idle, moving
        this.handleMovement(deltaTime, dodgePressed || queuedDodge, target);
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

      case 'hurt':
        this.handleHurt(deltaTime);
        break;
    }

    this.updateStamina(deltaTime);
    this.resolveMovement(data.x, data.y);
    const resolved = this.store.getData();
    this.motion.update(deltaTime, Math.hypot(resolved.x - data.x, resolved.y - data.y),
      resolved.facingX, resolved.facingY);
    this.updateAnimation(deltaTime);
  }

  private updateAnimation(deltaTime: number) {
    const data = this.store.getData();
    this.animator.play(playerStateToClip(data.state, data.attackType));
    this.animator.update(deltaTime);
  }

  private handleMovement(deltaTime: number, dodgePressed: boolean, target?: { x: number; y: number }) {
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

    const horizontal = (this.input.right() ? 1 : 0) - (this.input.left() ? 1 : 0);
    const vertical = (this.input.down() ? 1 : 0) - (this.input.up() ? 1 : 0);
    const heading = this.cameraHeading;
    const dx = heading === null ? horizontal : -horizontal * Math.cos(heading) - vertical * Math.sin(heading);
    const dy = heading === null ? vertical : horizontal * Math.sin(heading) - vertical * Math.cos(heading);

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
      changes.facingX = normX;
      changes.facingY = normY;
    }
    const locked = heading !== null && !!target;
    if (target && !dodgePressed && (locked ||
        (length === 0 && (this.input.attack() || this.input.heavyAttack())))) {
      const aimX = target.x - this.centerX;
      const aimY = target.y - this.centerY;
      const distance = Math.hypot(aimX, aimY);
      if (distance > 0 && (locked || distance < 155)) {
        changes.facingX = aimX / distance;
        changes.facingY = aimY / distance;
      }
    }

    this.store.update(changes);

    // VERIFIER SI ON A INTERRAGI AVEC LES TOUCHES D'ATTAQUES

    const currentData = this.store.getData();
    //Je dois savoir si on a fais une attaque legere ou lourde . Et si c'est une attaque legere c'est laquelle

    if (dodgePressed && currentData.stamina >= PLAYER_CONFIG.rollCost) {
      this.enterRoll();
      return;
    }

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
      vx: data.facingX * 170,
      vy: data.facingY * 170,
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
      vx: data.facingX * 220,
      vy: data.facingY * 220,
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

    const newTimer = data.stateTimer - deltaTime * 1000;
    const attack = this.getActiveAttackData(data);
    const elapsed = attack.duration - data.stateTimer;
    const lungeStart = data.attackType === 'counter' ? 0 : attack.windup;
    const lungeEnd = data.attackType === 'counter' ? 160 : attack.windup + attack.active;
    const travel = Math.max(0, Math.min(elapsed + deltaTime * 1000, lungeEnd) - Math.max(elapsed, lungeStart)) / 1000;
    this.store.update({ x: data.x + data.vx * travel, y: data.y + data.vy * travel });
    if (newTimer <= 0) {
      const openCombo =
        data.attackType === 'light' && data.comboCount < LIGHT_COMBO.length;

      this.store.update({
        state: 'idle',
        stateTimer: 0,
        vx: 0,
        vy: 0,
        attackType: 'none',
        invicible: false,
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

  //Le joueur encaisse un coup du boss : dégâts + recul + état hurt.
  takeDamage(amount: number, knockX: number, knockY: number) {
    const data = this.store.getData();
    if (data.state === 'dead' || data.invicible) return;

    const newHp = Math.max(0, data.hp - amount);

    if (newHp <= 0) {
      this.store.update({
        hp: 0,
        state: 'dead',
        stateTimer: 0,
        vx: 0,
        vy: 0,
        attackType: 'none',
        comboCount: 0,
        comboTimer: 0,
      });
      return;
    }

    this.store.update({
      hp: newHp,
      state: 'hurt',
      stateTimer: PLAYER_CONFIG.hurtDuration,
      vx: knockX,
      vy: knockY,
      attackType: 'none',
      comboCount: 0,
      comboTimer: 0,
      invicible: false,
    });
  }

  //Gerer l'etat hurt : recul amorti puis retour en idle.
  private handleHurt(deltaTime: number) {
    const data = this.store.getData();
    const newTimer = data.stateTimer - deltaTime * 1000;

    const friction = 0.85;
    const newVx = data.vx * friction;
    const newVy = data.vy * friction;

    this.store.update({
      x: data.x + data.vx * deltaTime,
      y: data.y + data.vy * deltaTime,
      vx: Math.abs(newVx) < 1 ? 0 : newVx,
      vy: Math.abs(newVy) < 1 ? 0 : newVy,
    });

    if (newTimer <= 0) {
      this.store.update({ state: 'idle', stateTimer: 0, vx: 0, vy: 0 });
    } else {
      this.store.update({ stateTimer: newTimer });
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

  private resolveMovement(fromX: number, fromY: number) {
    const { x, y } = this.store.getData();
    if (x === fromX && y === fromY) return;
    const half = PLAYER_CONFIG.size / 2;
    const position = this.terrain.move(fromX + half, fromY + half, x + half, y + half, 10);
    this.store.update({ x: position.x - half, y: position.y - half });
  }

  /** Centre du joueur en coords monde (pour la caméra et l'éclairage). */
  get centerX() {
    return this.store.getData().x + PLAYER_CONFIG.size / 2;
  }
  get centerY() {
    return this.store.getData().y + PLAYER_CONFIG.size / 2;
  }

  render(laterGeneration = false) {
    const data = this.store.getData();
    const size = PLAYER_CONFIG.size;
    const centerX = data.x + size / 2;
    const centerY = data.y + size / 2;

    // Ombre portée au sol.
    this.renderer.fillEllipse(
      centerX,
      centerY + 7,
      size * 0.35,
      size * 0.13,
      '#20160960',
    );

    const art = this.assets.get('ama');
    const img = this.assets.get(PLAYER_SHEET.imageKey);
    if (img) {
      const dw = size * 1.9;
      const dh = size * 1.9;
      const dx = centerX - dw / 2;
      const dy = data.y + size - dh;
      const flip = data.facingX < 0;
      this.renderer.drawSprite(img, this.animator.sourceRect(), dx, dy, dw, dh, flip);
    } else if (art && this.renderer.context) {
      const ctx = this.renderer.context;
      const extent = size * 1.85;
      const attack = this.getActiveAttackData(data);
      const elapsed = attack.duration - data.stateTimer;
      const strikeEnd = attack.windup + attack.active;
      const pose = data.state === 'attacking' ? elapsed < attack.windup ? 'ready' :
        elapsed < strikeEnd ? 'strike' : 'recover' : data.state === 'rolling' ? 'dash' :
        data.state === 'hurt' ? 'hurt' : data.state === 'exhausted' ? 'recover' : 'rest';
      const progress = data.state === 'attacking' ? pose === 'ready' ? elapsed / attack.windup :
        pose === 'strike' ? (elapsed - attack.windup) / attack.active :
          (elapsed - strikeEnd) / (attack.duration - strikeEnd) :
        1 - data.stateTimer / (data.state === 'rolling' ? PLAYER_CONFIG.rollDuration :
          data.state === 'hurt' ? PLAYER_CONFIG.hurtDuration : PLAYER_CONFIG.exhaustedDuration);
      ctx.save();
      ctx.translate(centerX, centerY);
      const atlas = this.assets.get('amaPoses');
      const frame = data.state === 'moving' ? this.motion.walkFrame : pose === 'ready' ? 3 :
        pose === 'strike' ? (data.attackType === 'counter' ? 7 : 4) :
        pose === 'recover' && progress < 0.68 ? 5 : pose === 'dash' ? (progress < 0.55 ? 6 : 1) :
        pose === 'hurt' ? 8 : 1;
      if (laterGeneration) ctx.filter = 'hue-rotate(26deg)';
      if (atlas) {
        this.motion.orient(ctx);
        drawPose(ctx, atlas, 3, frame, extent);
      } else {
        this.motion.apply(ctx, pose, Math.max(0, Math.min(1, progress)));
        ctx.drawImage(art, -extent / 2, -extent / 2, extent, extent);
      }
      ctx.restore();
    } else {
      this.renderFallback(data, size, centerX, centerY);
    }

    // VFX d'attaque : un coup de lame balayé (par-dessus le corps/sprite).
    if (data.state === 'attacking') {
      this.renderSlash(data, size, centerX, centerY);
    }

    // Éclair rouge quand le joueur vient d'encaisser un coup.
    if (data.state === 'hurt') {
      const t = Math.max(0, data.stateTimer) / PLAYER_CONFIG.hurtDuration;
      const ctx = this.renderer.context;
      if (ctx) {
        ctx.save();
        ctx.globalAlpha = 0.6 * t;
        ctx.strokeStyle = '#ff825d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, size * (0.7 + (1 - t) * 0.26), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    this.renderUi(data, size);
  }

  /** Direction du regard normalisée (fallback : droite par défaut). */
  private facingNorm(data: PlayerData) {
    const len = Math.sqrt(data.facingX ** 2 + data.facingY ** 2);
    return {
      x: len > 0 ? data.facingX / len : 1,
      y: len > 0 ? data.facingY / len : 0,
    };
  }

  private renderSlash(
    data: PlayerData,
    size: number,
    centerX: number,
    centerY: number,
  ) {
    const attack = this.getActiveAttackData(data);
    const progress = (attack.duration - data.stateTimer - attack.windup) / attack.active;
    if (progress <= 0 || progress >= 1) return;
    const f = this.facingNorm(data);
    const angle = Math.atan2(f.y, f.x);
    const reach = size * attack.range;
    const color = data.attackType === 'counter' ? '#cbded2bb' :
      data.attackType === 'heavy' ? '#eaba898e' : '#efe0b28b';
    this.renderer.slash(centerX, centerY, angle, reach, progress, color);
  }

  /** Rendu de secours en formes quand le sprite est absent. */
  private renderFallback(
    data: PlayerData,
    size: number,
    centerX: number,
    centerY: number,
  ) {
    const facing = this.facingNorm(data);
    const step = data.state === 'moving' ? Math.sin(performance.now() / 72) * 4 : 0;
    const ctx = this.renderer.context;
    if (!ctx) return;

    ctx.save();
    ctx.translate(centerX, centerY);
    const turn = Math.atan2(facing.y, facing.x);
    ctx.rotate(turn);
    this.renderer.fillEllipse(-7 + step, -7, 7, 4, '#503126');
    this.renderer.fillEllipse(-7 - step, 7, 7, 4, '#503126');
    this.renderer.fillEllipse(0, 0, 11, size / 2, data.state === 'hurt' ? '#a63f36' : '#243f46');
    this.renderer.fillRect(-5, -13, 4, 26, '#eeb96b');
    this.renderer.fillEllipse(5, 0, 8, 8, '#683f2b');
    this.renderer.fillEllipse(2, 0, 5, 7, '#281e1c');
    this.renderer.fillEllipse(4, 13, 5, 4, '#683f2b');
    this.renderer.fillRect(7, 12, 16, 3, '#f6d899');
    ctx.restore();
  }

  /** Barres de vie/stamina et combo, au-dessus du joueur (repère monde). */
  private renderUi(data: PlayerData, size: number) {
    this.renderer.drawBar(data.x, data.y - 12, size, 5, data.hp, data.maxHp, '#ff3333');

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

    if (data.comboTimer > 0 && data.comboCount > 0) {
      this.renderer.drawText(`COMBO x${data.comboCount}`, data.x, data.y - 18, '#ffe66d', {
        size: 10,
        shadow: true,
      });
    }
  }

  getActiveAttackData(data?: PlayerData) {
    const d = data ?? this.store.getData();

    if (d.attackType === 'counter') return COUNTER_ATTACK;
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
