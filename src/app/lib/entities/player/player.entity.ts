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
import { EquipmentStore } from './equipment.store';
import { ArrowService } from '../projectiles/arrow.service';
import {
  BOW_POWER_SHOT,
  BOW_QUICK_SHOT,
  BowShotData,
  EQUIPMENT_CONFIG,
  WEAPONS,
} from '../../constants/equipment.config-constant';
import { approachVelocity, DodgeKind, dodgeProfile, dodgeSpeed, ShiftGesture } from './locomotion';
import { AFENA_COMBO, AFENA_HEAVY, SPECIALS, type SpecialId } from '../../slice/slice-content';

type BufferedAction = 'light' | 'heavy' | 'dodge';


/** Vitesse de marche (fraction de la vitesse normale) pendant une action du haut du corps. */
const BUSY_WALK = { drinking: 0.35, aiming: 0.45 };

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
  readonly equipment = inject(EquipmentStore);
  private readonly arrows = inject(ArrowService);

  // --- Équipement : tir à l'arc et mixture de soin
  private shot: BowShotData = BOW_QUICK_SHOT;
  private arrowReleased = false;
  private mixtureHealed = false;
  private switchHeld = false;
  private drinkHeld = false;

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

  // --- Tampon d'entrée : un appui reste mémorisé PLAYER_CONFIG.inputBuffer ms
  // et part à la première fenêtre possible (fin d'impact, récupération…).
  private dodgeHeld = false;
  private attackHeld = false;
  private heavyHeld = false;
  private buffered: BufferedAction | null = null;
  private bufferTime = 0;

  // --- Locomotion : Shift bref = esquive, maintenu = sprint (voir locomotion.ts)
  private readonly shift = new ShiftGesture();
  /** Esquive en cours (lu par l'animateur 3D quand state === 'rolling'). */
  dodgeKind: DodgeKind = 'roll';
  /** Vrai pendant un sprint (state === 'moving'). */
  sprinting = false;
  /** Invincibilité restante après un coup reçu (ms). */
  private hurtIFrames = 0;
  private lockTarget: { x: number; y: number } | undefined;
  /** Attaque spéciale en cours (lancée par SliceService, touche C). */
  special: SpecialId | null = null;

  /** Combo et coup lourd de l'arme de corps à corps en main. */
  private moveset() {
    return this.equipment.getData().weapon === 'afena'
      ? { combo: AFENA_COMBO, heavy: AFENA_HEAVY }
      : { combo: LIGHT_COMBO, heavy: HEAVY_ATTACK };
  }

  /** Durée de l'esquive en cours (ms), pour calculer sa phase d'animation. */
  get dodgeDuration() {
    return dodgeProfile(this.dodgeKind).duration;
  }

  /** Début d'esquive : un coup évité ici ouvre la riposte. */
  inPerfectDodge(data = this.store.getData()) {
    return data.state === 'rolling' &&
      this.dodgeDuration - data.stateTimer <= PLAYER_CONFIG.perfectDodgeWindow;
  }

  resetCombat() {
    this.staminaRegenCooldown = 0;
    this.motion.reset();
    this.dodgeHeld = false;
    this.attackHeld = false;
    this.heavyHeld = false;
    this.buffered = null;
    this.bufferTime = 0;
    this.shift.reset();
    this.dodgeKind = 'roll';
    this.sprinting = false;
    this.hurtIFrames = 0;
    this.lockTarget = undefined;
    this.arrowReleased = false;
    this.mixtureHealed = false;
    this.switchHeld = false;
    this.drinkHeld = false;
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
    // L'appui qui déclenche la riposte ne doit pas relancer une attaque ensuite.
    this.attackHeld = true;
    this.buffered = null;
    return true;
  }

  update(deltaTime: number, target?: { x: number; y: number }) {
    const data = this.store.getData();
    //Si le joueur est mort on ne fait rien.

    if (data.state === 'dead') return;
    if (data.state !== 'attacking') this.special = null;

    this.lockTarget = this.cameraHeading !== null ? target : undefined;
    this.tickHurtIFrames(deltaTime);
    this.readActions(deltaTime);
    const dodgePressed = this.buffered === 'dodge';

    switch (data.state) {
      case 'idle':
      case 'moving':
        //Pour le moment on va juste rester sur idle, moving
        this.handleMovement(deltaTime, dodgePressed, target);
        break;
      case 'attacking':
        this.handleAttacking(deltaTime, target);
        break;

      case 'rolling':
        this.handleRolling(deltaTime, target);
        break;

      case 'exhausted':
        this.handleExhausted(deltaTime);
        break;

      case 'hurt':
        this.handleHurt(deltaTime);
        break;

      case 'shooting':
        this.handleShooting(deltaTime, dodgePressed);
        break;

      case 'drinking':
        this.handleDrinking(deltaTime);
        break;
    }

    if (this.store.getData().state !== 'moving') this.sprinting = false;
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

  /** Détecte les appuis (fronts montants) et les garde en mémoire un court instant. */
  private readActions(deltaTime: number) {
    const attack = this.input.attack();
    const heavy = this.input.heavyAttack();
    const dodge = this.input.dodge();
    // Shift : l'esquive part au relâchement d'un appui bref ; maintenu, c'est un sprint.
    const dodgeTap = this.shift.update(dodge, deltaTime);
    let pressed: BufferedAction | null = null;
    if (attack && !this.attackHeld) pressed = 'light';
    if (heavy && !this.heavyHeld) pressed = 'heavy';
    if (dodgeTap) pressed = 'dodge';
    this.attackHeld = attack;
    this.heavyHeld = heavy;
    this.dodgeHeld = dodge;
    if (pressed) {
      this.buffered = pressed;
      this.bufferTime = PLAYER_CONFIG.inputBuffer;
    } else if (this.buffered) {
      this.bufferTime -= deltaTime * 1000;
      if (this.bufferTime <= 0) this.buffered = null;
    }
  }

  private consume() {
    this.buffered = null;
    this.bufferTime = 0;
  }

  /** Direction demandée au clavier, en coordonnées monde (relative à la caméra). */
  private inputDirection() {
    // Joystick tactile : vecteur analogique ; clavier et manette : -1, 0 ou 1 par axe.
    const { x: horizontal, y: vertical } = this.input.moveAxis();
    const heading = this.cameraHeading;
    const dx = heading === null ? horizontal : -horizontal * Math.cos(heading) - vertical * Math.sin(heading);
    const dy = heading === null ? vertical : horizontal * Math.sin(heading) - vertical * Math.cos(heading);
    const length = Math.hypot(dx, dy);
    // Pouce à mi-course : on marche ; à fond : on court (le clavier reste à fond).
    const magnitude = Math.min(1, length);
    return { x: length > 0 ? dx / length : 0, y: length > 0 ? dy / length : 0, length, magnitude };
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

    const heading = this.cameraHeading;
    const { x: normX, y: normY, length, magnitude } = this.inputDirection();

    //Probleme sur les diagonales a gerer.
    //Si on appuie sur Haut + Droite: dx = 1 et dy = -1
    //Commet sera le calcul de la vitesse ->

    // 2. Calculer la longueur du vecteur (Magnitude)
    // Formule : racine carrée de (x² + y²)

    // Sprint (Shift maintenu) tant qu'il reste du souffle ; marche plus posée
    // quand on tourne autour d'un ennemi verrouillé.
    const locked = heading !== null && !!target;
    this.sprinting = length > 0 && this.shift.sprinting && data.stamina > 0;
    const grade = length > 0 ? this.terrain.gradeFactor(data.x + PLAYER_CONFIG.size / 2,
      data.y + PLAYER_CONFIG.size / 2, normX, normY) : 1;
    const speed = (this.sprinting ? PLAYER_CONFIG.sprintSpeed
      : PLAYER_CONFIG.speed * (locked ? PLAYER_CONFIG.lockedSpeedFactor : 1) * magnitude) * grade;

    // Inertie courte : on accélère et on freine en quelques centièmes de seconde.
    const velocity = approachVelocity(data.vx, data.vy, normX * speed, normY * speed, deltaTime);

    //Mettre a jour la position
    const changes: Partial<typeof data> = {
      x: data.x + velocity.x * deltaTime,
      y: data.y + velocity.y * deltaTime,
      vx: velocity.x,
      vy: velocity.y,
      state: length > 0 ? 'moving' : 'idle',
    };
    if (this.sprinting) {
      changes.stamina = Math.max(0, data.stamina - PLAYER_CONFIG.sprintStaminaPerSecond * deltaTime);
      this.staminaRegenCooldown = Math.max(this.staminaRegenCooldown, PLAYER_CONFIG.staminaRegenDelay * 0.5);
    }

    //Mettre a jour la direction du regard
    if (length > 0) {
      changes.facingX = normX;
      changes.facingY = normY;
    }
    // En sprint, on court droit devant : le regard suit la course, pas l'ennemi.
    if (target && !dodgePressed && !this.sprinting && (locked ||
        (length === 0 && (this.buffered === 'light' || this.buffered === 'heavy')))) {
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

    if (dodgePressed && currentData.stamina > 0) {
      this.consume();
      this.enterRoll();
      return;
    }

    // Équipement : changer d'arme (R) et avaler la mixture de soin (B), sur appui.
    const switchDown = this.input.switchWeapon();
    const switchPressed = switchDown && !this.switchHeld;
    this.switchHeld = switchDown;
    if (switchPressed) {
      const weapon = this.equipment.switchWeapon();
      this.equipment.say(`${WEAPONS[weapon].name} en main`, 900);
    }
    const drinkDown = this.input.drink();
    const drinkPressed = drinkDown && !this.drinkHeld;
    this.drinkHeld = drinkDown;
    if (drinkPressed) {
      if (currentData.hp >= currentData.maxHp) {
        this.equipment.say('Déjà en pleine forme', 900);
      } else if (this.equipment.consumeMixture()) {
        this.enterDrinking();
        return;
      }
    }

    if (this.equipment.getData().weapon === 'bow') {
      const shot = this.buffered === 'heavy' ? BOW_POWER_SHOT : this.buffered === 'light' ? BOW_QUICK_SHOT : null;
      if (shot && currentData.stamina > 0) {
        this.consume();
        if (this.equipment.getData().arrows > 0) this.enterShooting(shot);
        else this.equipment.say('Plus de flèches');
      }
      return;
    }

    // Comme dans le genre : une action part tant qu'il reste un peu de souffle.
    if (this.buffered === 'light' && currentData.stamina > 0) {
      //Entrer en mode attaque rapide
      this.consume();
      this.enterLightAttack();
      return;
    }

    if (
      this.buffered === 'heavy' &&
      currentData.stamina > 0
    ) {
      this.consume();
      this.enterHeavyAttack();
      return;
    }
  }

  private getCurrentLightAttack(comboIndex: number) {
    const combo = this.moveset().combo;
    return combo[Math.min(comboIndex, combo.length - 1)];
  }

  //Entrer en mode attaque rapide (COMBO)
  private enterLightAttack() {
    const data = this.store.getData();
    const attack = this.getCurrentLightAttack(data.comboCount);
    this.special = null;

    this.store.update({
      state: 'attacking',
      attackType: 'light',
      comboCount: data.comboCount + 1,
      stateTimer: attack.duration,
      vx: data.facingX * 170,
      vy: data.facingY * 170,
      comboTimer: 0,
      stamina: Math.max(0, data.stamina - attack.staminaCost),
    });

    this.staminaRegenCooldown = PLAYER_CONFIG.staminaRegenDelay;
  }

  //Entrer en mode attaque lourde

  private enterHeavyAttack() {
    const data = this.store.getData();
    const HEAVY_ATTACK = this.moveset().heavy;
    this.special = null;

    this.store.update({
      state: 'attacking',
      attackType: 'heavy',
      stateTimer: HEAVY_ATTACK.duration,
      vx: data.facingX * 220,
      vy: data.facingY * 220,
      comboTimer: 0,
      comboCount: 0,
      stamina: Math.max(0, data.stamina - HEAVY_ATTACK.staminaCost),
    });

    this.staminaRegenCooldown = PLAYER_CONFIG.staminaRegenDelay;
  }

  //Pour rentrer dans le mode roulade.
  // Verrouillé sur un ennemi sans direction tenue : pas en arrière (court,
  // on garde l'ennemi en face). Sinon roulade dans la direction tenue.

  private enterRoll() {
    const data = this.store.getData();
    const wish = this.inputDirection();
    const kind: DodgeKind = wish.length === 0 && this.lockTarget ? 'backstep' : 'roll';
    const profile = dodgeProfile(kind);
    this.dodgeKind = kind;
    this.sprinting = false;
    if (kind === 'roll' && wish.length > 0) this.store.update({ facingX: wish.x, facingY: wish.y });
    if (kind === 'backstep' && this.lockTarget) {
      const aimX = this.lockTarget.x - this.centerX;
      const aimY = this.lockTarget.y - this.centerY;
      const distance = Math.hypot(aimX, aimY);
      if (distance > 0) this.store.update({ facingX: aimX / distance, facingY: aimY / distance });
    }

    this.store.update({
      state: 'rolling',
      stateTimer: profile.duration,
      comboTimer: 0,
      comboCount: 0,
      stamina: Math.max(0, data.stamina - profile.cost),
      invicible: true,
      attackType: 'none',
    });

    this.staminaRegenCooldown = PLAYER_CONFIG.staminaRegenDelay;
  }

  //Gerer le roll (Roulade) : élan puis freinage, invincible au début seulement,
  //récupération annulable par une action tamponnée.

  private handleRolling(deltaTime: number, target?: { x: number; y: number }) {
    const data = this.store.getData();
    const profile = dodgeProfile(this.dodgeKind);
    const newTimer = data.stateTimer - deltaTime * 1000; //Pour convertir en MilliSeconde
    const elapsed = profile.duration - newTimer;

    const f = this.facingNorm(data);
    const direction = this.dodgeKind === 'backstep' ? -1 : 1;
    const speed = dodgeSpeed(profile.speed, (elapsed - deltaTime * 500) / profile.duration);
    const vx = f.x * direction * speed;
    const vy = f.y * direction * speed;
    const newX = data.x + vx * deltaTime;
    const newY = data.y + vy * deltaTime;

    if (newTimer <= 0 || (elapsed >= profile.cancel && this.buffered !== null)) {
      // Fin de l'esquive : l'élan restant alimente la marche (pas d'arrêt sec).
      this.store.update({
        state: 'idle',
        stateTimer: 0,
        vx: vx * 0.5,
        vy: vy * 0.5,
        x: newX,
        y: newY,
        invicible: this.hurtIFrames > 0,
      });
      // Action tamponnée pendant la récupération : elle part tout de suite.
      if (this.buffered !== null) this.handleMovement(0, this.buffered === 'dodge', target);
    } else {
      this.store.update({
        stateTimer: newTimer,
        x: newX,
        y: newY,
        vx, vy,
        invicible: elapsed < profile.iFrames || this.hurtIFrames > 0,
      });
    }
  }

  //Pouvoir gerer les attaques

  private handleAttacking(deltaTime: number, target?: { x: number; y: number }) {
    let data = this.store.getData();
    const attack = this.getActiveAttackData(data);
    const elapsed = attack.duration - data.stateTimer;
    const impactEnd = attack.windup + attack.active;

    // Fenêtres d'annulation : roulade dès la fin de l'impact, nouvelle attaque
    // à partir de `chain`. L'appui a pu être fait bien avant (tampon).
    if (data.attackType !== 'counter' && elapsed >= impactEnd) {
      const chain = attack.chain ?? attack.duration;
      if (this.buffered === 'dodge' && data.stamina > 0) {
        this.consume();
        this.enterRoll();
        return;
      }
      if (elapsed >= chain && this.equipment.getData().weapon !== 'bow') {
        const finished = data.attackType !== 'light' || data.comboCount >= LIGHT_COMBO.length;
        if (this.buffered === 'light' && data.stamina > 0) {
          this.consume();
          if (finished) this.store.update({ comboCount: 0 });
          this.enterLightAttack();
          return;
        }
        if (this.buffered === 'heavy' && data.stamina > 0) {
          this.consume();
          this.enterHeavyAttack();
          return;
        }
      }
    }

    // Pendant l'anticipation on peut encore orienter le coup (vers la cible
    // verrouillée, sinon vers la direction tenue), à vitesse limitée.
    if (data.attackType !== 'counter' && elapsed < attack.windup) {
      const wish = this.cameraHeading !== null && target
        ? { x: target.x - this.centerX, y: target.y - this.centerY }
        : this.inputDirection();
      if (wish.x !== 0 || wish.y !== 0) {
        const current = Math.atan2(data.facingY, data.facingX);
        const goal = Math.atan2(wish.y, wish.x);
        const gap = Math.atan2(Math.sin(goal - current), Math.cos(goal - current));
        const maxTurn = PLAYER_CONFIG.windupTurnRate * deltaTime;
        const angle = current + Math.max(-maxTurn, Math.min(maxTurn, gap));
        const speed = Math.hypot(data.vx, data.vy);
        this.store.update({
          facingX: Math.cos(angle), facingY: Math.sin(angle),
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        });
        data = this.store.getData();
      }
    }

    const newTimer = data.stateTimer - deltaTime * 1000;
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

  // ====================================================================
  // ARC
  // ====================================================================

  private enterShooting(shot: BowShotData) {
    const data = this.store.getData();
    this.shot = shot;
    this.arrowReleased = false;
    this.store.update({
      state: 'shooting',
      attackType: 'none',
      stateTimer: shot.duration,
      vx: 0,
      vy: 0,
      comboCount: 0,
      comboTimer: 0,
      stamina: Math.max(0, data.stamina - shot.staminaCost),
    });
    this.staminaRegenCooldown = PLAYER_CONFIG.staminaRegenDelay;
  }

  /** Bande l'arc (windup), décoche à la fin du windup, puis récupère. */
  private handleShooting(deltaTime: number, dodgePressed: boolean) {
    const data = this.store.getData();
    // Une roulade annule le tir tant que la flèche n'est pas partie.
    if (dodgePressed && !this.arrowReleased && data.stamina > 0) {
      this.consume();
      this.enterRoll();
      return;
    }
    this.walkWhileBusy(deltaTime, BUSY_WALK.aiming);
    const newTimer = data.stateTimer - deltaTime * 1000;
    const elapsed = this.shot.duration - newTimer;
    if (!this.arrowReleased && elapsed >= this.shot.windup) {
      this.arrowReleased = true;
      if (this.equipment.consumeArrow()) {
        const f = this.facingNorm(data);
        this.arrows.fire(this.centerX + f.x * 16, this.centerY + f.y * 16, f.x, f.y,
          this.shot.arrowSpeed, this.shot.damage, this.shot.maxDistance);
      }
    }
    if (newTimer <= 0) {
      this.store.update({ state: 'idle', stateTimer: 0 });
      if (this.store.getData().stamina <= 0) this.enterExhausted();
    } else {
      this.store.update({ stateTimer: newTimer });
    }
  }

  /**
   * Pas lents pendant une action du haut du corps (mastiquer, viser) : le
   * regard ne change pas, seules les jambes avancent (blending haut/bas
   * dans player-rig-3d.ts).
   */
  private walkWhileBusy(deltaTime: number, factor: number) {
    const data = this.store.getData();
    const { x, y } = this.inputDirection();
    const speed = PLAYER_CONFIG.speed * factor;
    const velocity = approachVelocity(data.vx, data.vy, x * speed, y * speed, deltaTime);
    this.store.update({
      x: data.x + velocity.x * deltaTime,
      y: data.y + velocity.y * deltaTime,
      vx: velocity.x,
      vy: velocity.y,
    });
  }

  // ====================================================================
  // MIXTURE DE SOIN : feuilles écrasées avalées, soin limité, pas lents pendant la mastication
  // ====================================================================

  private enterDrinking() {
    this.mixtureHealed = false;
    this.store.update({
      state: 'drinking',
      attackType: 'none',
      stateTimer: EQUIPMENT_CONFIG.mixtureDuration,
      vx: 0,
      vy: 0,
      comboCount: 0,
      comboTimer: 0,
    });
  }

  /** Le soin tombe aux 60 % de la mastication : un coup reçu avant fait perdre les feuilles. */
  private handleDrinking(deltaTime: number) {
    this.walkWhileBusy(deltaTime, BUSY_WALK.drinking);
    const data = this.store.getData();
    const newTimer = data.stateTimer - deltaTime * 1000;
    const progress = 1 - newTimer / EQUIPMENT_CONFIG.mixtureDuration;
    const changes: Partial<PlayerData> = { stateTimer: newTimer };
    if (!this.mixtureHealed && progress >= EQUIPMENT_CONFIG.mixtureHealAt) {
      this.mixtureHealed = true;
      changes.hp = Math.min(data.maxHp, data.hp + EQUIPMENT_CONFIG.mixtureHeal);
    }
    if (newTimer <= 0) {
      changes.state = 'idle';
      changes.stateTimer = 0;
    }
    this.store.update(changes);
  }

  /** Pose 3D pour les états d'équipement (null = laisser la logique par défaut). */
  equipmentPose(data?: PlayerData): { state: string; phase: number } | null {
    const d = data ?? this.store.getData();
    if (d.state === 'shooting') {
      const elapsed = this.shot.duration - d.stateTimer;
      return elapsed < this.shot.windup
        ? { state: 'aiming', phase: elapsed / this.shot.windup }
        : { state: 'release', phase: (elapsed - this.shot.windup) / (this.shot.duration - this.shot.windup) };
    }
    if (d.state === 'drinking') {
      return { state: 'drinking', phase: 1 - d.stateTimer / EQUIPMENT_CONFIG.mixtureDuration };
    }
    return null;
  }

  //Une fonction pour qua d l'utilisateur est a bout de souffle

  // Souffle vidé : plus d'étourdissement d'une seconde (ressenti comme un bug),
  // seulement une reprise de souffle plus lente. L'état 'exhausted' reste
  // disponible pour d'autres causes.
  private enterExhausted() {
    this.staminaRegenCooldown = Math.max(this.staminaRegenCooldown, PLAYER_CONFIG.exhaustedRegenDelay);
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
    this.sprinting = false;
    this.hurtIFrames = 0;
  }

  /** Brève invincibilité après un coup : le temps de se relever et de réagir. */
  private tickHurtIFrames(deltaTime: number) {
    if (this.hurtIFrames <= 0) return;
    this.hurtIFrames -= deltaTime * 1000;
    if (this.hurtIFrames > 0) return;
    this.hurtIFrames = 0;
    const data = this.store.getData();
    if (data.state !== 'rolling' && data.attackType !== 'counter') this.store.update({ invicible: false });
  }

  //Gerer l'etat hurt : recul amorti puis retour en idle.
  private handleHurt(deltaTime: number) {
    const data = this.store.getData();
    const newTimer = data.stateTimer - deltaTime * 1000;

    // Fin de recul : une roulade tamponnée permet de se dégager.
    if (newTimer <= PLAYER_CONFIG.hurtDuration * (1 - PLAYER_CONFIG.hurtDodgeCancel) &&
        this.buffered === 'dodge' && data.stamina > 0) {
      this.hurtIFrames = PLAYER_CONFIG.hurtIFrames;
      this.consume();
      this.enterRoll();
      return;
    }

    // Frottement indépendant de la cadence d'images (≈ 0,85 par image à 60 fps).
    const friction = Math.exp(-10 * deltaTime);
    const newVx = data.vx * friction;
    const newVy = data.vy * friction;

    this.store.update({
      x: data.x + data.vx * deltaTime,
      y: data.y + data.vy * deltaTime,
      vx: Math.abs(newVx) < 1 ? 0 : newVx,
      vy: Math.abs(newVy) < 1 ? 0 : newVy,
    });

    if (newTimer <= 0) {
      this.hurtIFrames = PLAYER_CONFIG.hurtIFrames;
      this.store.update({ state: 'idle', stateTimer: 0, vx: 0, vy: 0, invicible: true });
    } else {
      this.store.update({ stateTimer: newTimer });
    }
  }

  //Regeneration de stamina

  private updateStamina(delatTime: number) {
    const data = this.store.getData();

    if (data.state === 'attacking' || data.state === 'rolling' || data.state === 'shooting' || this.sprinting) return;

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

    const special = this.special && d.state === 'attacking' ? SPECIALS[this.special].attack : undefined;
    if (special) return special;
    if (d.attackType === 'counter') return COUNTER_ATTACK;
    if (d.attackType === 'heavy') {
      return this.moveset().heavy;
    }

    //Attaque rapide : A prendre selon le combo

    const comboIndex = Math.max(0, d.comboCount - 1);
    const combo = this.moveset().combo;

    return combo[Math.min(comboIndex, combo.length - 1)];
  }

  //Function pour avoir des infos sur l'attaque

  // getActiveAttackData(data?: PlayerData): AttackData {
  //   const d = this.store.getData();
  //   // if (data.state !== 'attacking') return null;
  //   // return data.attackData;
  // }
}
