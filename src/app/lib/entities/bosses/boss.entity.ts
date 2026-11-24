import { inject, Injectable } from '@angular/core';
import { BOSS_CONFIG } from '../../constants/boss.config-constant';
import { PLAYER_CONFIG } from '../../constants/player.config-constant';
import {
  BOSS_CLIPS,
  BOSS_SHEET,
  bossStateToClip,
} from '../../constants/sprite-config';
import { drawPose } from '../../engine/pose-atlas';
import { ActorMotion } from '../../engine/actor-motion';
import { TerrainCollisionService } from '../../engine/terrain-collision.service';
import { AssetLoaderService } from '../../engine/asset-loader.service';
import { Animator } from '../../engine/sprite';
import {
  BOSS_ATTACKS,
  BossAttackData,
  BossAttackType,
  SURGE_WIDTH,
  surgeRadius,
} from '../../interfaces/BossAttackData';
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
  private readonly motion = new ActorMotion();
  private readonly terrain = inject(TerrainCollisionService);
  private renderer = inject(RendererService);
  private assets = inject(AssetLoaderService);

  private duelist = false;
  private lastAttack: BossAttackType = 'none';
  private animator = new Animator(BOSS_SHEET, BOSS_CLIPS, 'idle');

  /** Centre du boss en coords monde (caméra / éclairage). */
  get centerX() {
    return this.store.getData().x + BOSS_CONFIG.size / 2;
  }
  get centerY() {
    return this.store.getData().y + BOSS_CONFIG.size / 2;
  }

  configure(duelist: boolean) {
    this.duelist = duelist;
    this.lastAttack = 'none';
    this.motion.reset();
  }

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
      case 'windup':
        this.handleWindup(deltaTime);
        break;
      case 'attacking':
        this.handleAttacking(deltaTime);
        break;
      case 'recover':
        this.handleRecover(deltaTime);
        break;
      case 'hurt':
        this.handleHurt(deltaTime);
        break;
    }

    this.resolveMovement(data.x, data.y);
    const resolved = this.store.getData();
    this.motion.update(deltaTime, Math.hypot(resolved.x - data.x, resolved.y - data.y),
      resolved.facingX, resolved.facingY);
    this.animator.play(bossStateToClip(data.state));
    this.animator.update(deltaTime);
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

    // À portée d'engagement : on déclenche une attaque (windup → coup → récup).
    const attackTrigger = BOSS_CONFIG.size * 3;
    if (distance <= attackTrigger) {
      this.chooseAttack(distance);
      return;
    }

    if (distance > 5) {
      // 3. Calculer la vitesse (plus rapide en phase 2).
      const phase = this.store.phase();
      const speed =
        BOSS_CONFIG.speed *
        (phase === 2 ? BOSS_CONFIG.phase2SpeedMultiplier : 1);
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

  /** Config de l'attaque courante (null si aucune). */
  private attackConfig(name: string): BossAttackData | null {
    if (name === 'none' || !(name in BOSS_ATTACKS)) return null;
    return BOSS_ATTACKS[name as Exclude<BossAttackType, 'none'>];
  }

  //Préparation de l'attaque : le boss se tourne vers le joueur et télégraphie.
  private handleWindup(deltaTime: number) {
    const data = this.store.getData();
    const p = this.playerStore.getData();
    const dx = p.x + PLAYER_CONFIG.size / 2 - this.centerX;
    const dy = p.y + PLAYER_CONFIG.size / 2 - this.centerY;
    const len = Math.hypot(dx, dy) || 1;
    const newTimer = data.stateTimer - deltaTime * 1000;
    const locked = data.currentAttack === 'charge' || newTimer < 160;
    const facingX = locked ? data.facingX : dx / len;
    const facingY = locked ? data.facingY : dy / len;

    if (newTimer <= 0) {
      const cfg = this.attackConfig(data.currentAttack);
      this.store.update({
        state: 'attacking',
        stateTimer: cfg ? cfg.attackDuration : 200,
        facingX, facingY,
      });
    } else {
      this.store.update({
        stateTimer: newTimer,
        facingX, facingY,
      });
    }
  }

  //Phase active de l'attaque : la charge déplace le boss vers la cible verrouillée.
  private handleAttacking(deltaTime: number) {
    const data = this.store.getData();
    const newTimer = data.stateTimer - deltaTime * 1000;

    if (data.currentAttack === 'charge') {
      const cx = data.chargeTargetX - (data.x + BOSS_CONFIG.size / 2);
      const cy = data.chargeTargetY - (data.y + BOSS_CONFIG.size / 2);
      const len = Math.hypot(cx, cy);
      if (len > 4) {
        const nx = cx / len;
        const ny = cy / len;
        this.store.update({
          x: data.x + nx * Math.min(len, BOSS_CONFIG.chargeSpeed * deltaTime),
          y: data.y + ny * Math.min(len, BOSS_CONFIG.chargeSpeed * deltaTime),
        });
      }
    }

    const reachedChargeTarget = data.currentAttack === 'charge' &&
      Math.hypot(data.chargeTargetX - this.centerX, data.chargeTargetY - this.centerY) <= 5 &&
      newTimer < 820;
    if (newTimer <= 0 || reachedChargeTarget) {
      const cfg = this.attackConfig(data.currentAttack);
      const phase = this.store.phase();
      const recoverMult =
        phase === 2 ? BOSS_CONFIG.phase2RecorverMultiplier : 1;
      this.store.update({
        state: 'recover',
        stateTimer: (cfg ? cfg.recoverDuration : 500) * recoverMult,
        vx: 0,
        vy: 0,
      });
    } else {
      this.store.update({ stateTimer: newTimer });
    }
  }

  //Récupération : fenêtre punissable avant de pouvoir réagir à nouveau.
  private handleRecover(deltaTime: number) {
    const data = this.store.getData();
    const newTimer = data.stateTimer - deltaTime * 1000;

    if (newTimer <= 0) {
      this.store.update({
        state: 'idle',
        stateTimer: BOSS_CONFIG.idlePauseDuration,
        currentAttack: 'none',
        comboStep: 0,
      });
    } else {
      this.store.update({ stateTimer: newTimer });
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

  takeDamage(amount: number, x: number, y: number, counter = false) {
    const data = this.store.getData();
    if (data.state === 'dead') return;

    const recovering = data.state === 'recover';
    const exposed = recovering && data.currentAttack === 'surge';
    const multiplier = counter ? 1.1 : exposed ? 1.4 : recovering ? 1 : 0.22;
    const newHp = Math.max(0, data.hp - Math.max(1, Math.round(amount * multiplier)));

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
    } else if (counter && data.state !== 'recover') {
      this.store.update({
        state: 'hurt',
        stateTimer: BOSS_CONFIG.hurtDuration,
        vx: x,
        vy: y,
      });
    }
  }

  //Créer une methode qui empeche le boss de sortir de la zone de jeu

  private resolveMovement(fromX: number, fromY: number) {
    const { x, y } = this.store.getData();
    if (x === fromX && y === fromY) return;
    const half = BOSS_CONFIG.size / 2;
    const position = this.terrain.move(fromX + half, fromY + half, x + half, y + half, 19);
    this.store.update({ x: position.x - half, y: position.y - half });
  }

  render(duelist = false): void {
    const data = this.store.getData();
    const size = BOSS_CONFIG.size;
    const centerX = data.x + size / 2;

    // Ombre portée au sol.
    this.renderer.fillEllipse(
      centerX,
      data.y + size / 2 + (duelist ? 7 : 10),
      size * (duelist ? 0.29 : 0.44),
      size * (duelist ? 0.12 : 0.16),
      '#20160958',
    );

    const img = this.assets.get(BOSS_SHEET.imageKey);
    if (duelist) {
      this.renderDuelist(data, size);
    } else if (img) {
      const dw = size * 1.6;
      const dh = size * 1.6;
      const dx = centerX - dw / 2;
      const dy = data.y + size - dh;
      const flip = data.facingX < 0;
      this.renderer.drawSprite(img, this.animator.sourceRect(), dx, dy, dw, dh, flip);
    } else {
      const art = this.assets.get('veille');
      if (art) this.renderVeille(art, data, size);
      else this.renderFallback(data, size);
    }

    this.renderAttackVfx(data, size, centerX, data.y + size / 2);
    this.renderHitFlash(data, size, centerX);
  }

  /** Télégraphe de préparation + tranchant/onde de choc pendant l'attaque. */
  private renderAttackVfx(
    data: BossData,
    size: number,
    cx: number,
    cy: number,
  ): void {
    const ctx = this.renderer.context;
    if (!ctx) return;
    const cfg = this.attackConfig(data.currentAttack);
    if (!cfg) return;
    const angle = Math.atan2(data.facingY, data.facingX);

    if (data.state === 'windup' && data.currentAttack === 'surge') {
      const strength = 1 - Math.min(1, data.stateTimer / cfg.windupDuration);
      ctx.save();
      ctx.globalAlpha = 0.25 + strength * 0.5;
      for (let i = 0; i < 12; i++) {
        const phase = strength * 8 + i * 2.39;
        const radius = 25 + (i % 4) * 6;
        const lift = (strength * 109 + i * 9) % 21;
        this.renderer.fillEllipse(cx + Math.cos(phase) * radius,
          cy + Math.sin(phase) * radius - lift, 1.7, 2.8, '#c7ebe1');
      }
      ctx.restore();
      return;
    }

    if (data.state !== 'attacking') return;
    const progress = Math.max(0, 1 - data.stateTimer / cfg.attackDuration);
    if (data.currentAttack === 'surge' || data.currentAttack === 'slam') {
      const water = data.currentAttack === 'surge';
      const radius = water ? surgeRadius(size, data.stateTimer) : cfg.range * size * 0.5 * (0.3 + progress * 0.7);
      ctx.save();
      ctx.translate(cx, cy);
      for (let i = 0; i < 25; i++) {
        const direction = i * Math.PI * 2 / 25 + Math.sin(i * 11) * 0.08;
        const crest = radius + Math.sin(i * 7 + progress * 14) * (water ? 11 : 15);
        ctx.globalAlpha = (water ? 0.67 : 0.38) * (1 - progress * 0.69) * (0.35 + (i % 4) * 0.19);
        ctx.fillStyle = water ? i % 3 ? '#8ac8bc' : '#d8f0db' : '#cda56f';
        ctx.beginPath();
        ctx.ellipse(Math.cos(direction) * crest, Math.sin(direction) * crest,
          water ? 10 + crest * 0.058 : 8, water ? 4 + (i % 3) * 2 : 4, direction + Math.PI / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (data.currentAttack !== 'charge') {
      this.renderer.slash(cx, cy, angle, Math.min(cfg.range * size, size * 2.2),
        progress, '#ead6a77a');
    }
  }

  /** Éclair blanc quand le boss vient d'être touché (sprite + fallback). */
  private renderHitFlash(data: BossData, size: number, centerX: number): void {
    if (data.state !== 'hurt') return;
    const t = Math.max(0, data.stateTimer) / BOSS_CONFIG.hurtDuration;
    const ctx = this.renderer.context;
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = 0.9 * t;
    ctx.strokeStyle = '#ffdc9e';
    ctx.lineWidth = 2;
    const centerY = data.y + size / 2;
    for (let spark = 0; spark < 7; spark++) {
      const angle = spark * Math.PI * 2 / 7;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const distance = 18 + (1 - t) * 31;
      ctx.beginPath();
      ctx.moveTo(centerX + dx * distance, centerY + dy * distance);
      ctx.lineTo(centerX + dx * (distance + 6 * t), centerY + dy * (distance + 6 * t));
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Rendu de secours en formes quand le sprite est absent. */
  private applyMotion(ctx: CanvasRenderingContext2D, data: BossData, amplitude: number) {
    const attack = this.attackConfig(data.currentAttack);
    const state = data.state;
    const pose = state === 'windup' ? 'ready' : state === 'attacking' ?
      (data.currentAttack === 'charge' ? 'dash' : 'strike') :
      state === 'recover' ? 'recover' : state === 'hurt' ? 'hurt' : 'rest';
    const duration = state === 'windup' ? attack?.windupDuration : state === 'attacking' ?
      attack?.attackDuration : state === 'recover' ? attack?.recoverDuration : BOSS_CONFIG.hurtDuration;
    const progress = Math.max(0, Math.min(1, 1 - data.stateTimer / (duration || 1)));
    this.motion.apply(ctx, pose, progress, amplitude);
  }

  private renderDuelist(data: BossData, size: number) {
    const ctx = this.renderer.context;
    if (!ctx) return;
    ctx.save();
    ctx.translate(data.x + size / 2, data.y + size / 2);
    const atlas = this.assets.get('kwadwoPoses');
    if (atlas) {
      this.motion.orient(ctx);
      const charge = data.currentAttack === 'charge';
      const frame = data.state === 'chase' ? this.motion.walkFrame : data.state === 'windup' ?
        (charge ? 6 : 3) : data.state === 'attacking' ? (charge ? 7 : 4) :
        data.state === 'recover' ? 5 : data.state === 'hurt' ? 8 : 1;
      drawPose(ctx, atlas, 3, frame, size * 1.53);
      ctx.restore();
      return;
    }
    this.applyMotion(ctx, data, 1.38);
    const step = data.state === 'chase' ? Math.sin(performance.now() / 65) * 5 : 0;
    const art = this.assets.get('kwadwo');
    if (art) {
      const extent = size * 1.37;
      const height = extent * art.naturalHeight / art.naturalWidth;
      ctx.drawImage(art, -extent / 2, -height / 2, extent, height);
      ctx.restore();
      return;
    }
    this.renderer.fillEllipse(-15 + step, -10, 12, 5, '#37251c');
    this.renderer.fillEllipse(-15 - step, 10, 12, 5, '#37251c');
    this.renderer.fillEllipse(-5, 0, 17, 21, '#773f31');
    this.renderer.fillRect(-8, -19, 5, 38, '#d2a362');
    this.renderer.fillEllipse(8, 0, 10, 10, '#663d2a');
    this.renderer.fillEllipse(5, 0, 7, 9, '#271c1a');
    this.renderer.fillEllipse(9, 18, 7, 5, '#663d2a');
    this.renderer.fillRect(13, 16, 30, 4, '#d9ae78');
    ctx.restore();
  }

  private renderVeille(art: HTMLImageElement, data: BossData, size: number) {
    const ctx = this.renderer.context;
    if (!ctx) return;
    const extent = size * 1.65;
    const height = extent * art.naturalHeight / art.naturalWidth;
    const exposed = data.state === 'recover' && data.currentAttack === 'surge';
    const pulse = Math.sin(performance.now() / 125);
    ctx.save();
    ctx.translate(this.centerX, this.centerY);
    const atlas = this.assets.get('veillePoses');
    if (atlas) this.motion.orient(ctx);
    else this.applyMotion(ctx, data, 0.65);
    if (exposed) {
      ctx.shadowColor = '#95eabf';
      ctx.shadowBlur = 12 + pulse * 3;
      this.renderer.fillEllipse(-8, 0, 20, 14, '#8cd6ad');
      ctx.shadowBlur = 0;
    }
    if (atlas) {
      const frame = exposed ? 3 : data.state === 'windup' ? 2 :
        this.motion.walkFrame === 2 ? 1 : 0;
      drawPose(ctx, atlas, 2, frame, size * 1.82);
    } else {
      ctx.drawImage(art, -extent / 2, -height / 2, extent, height);
    }
    if (exposed) this.renderer.fillEllipse(-7, 0, 16, 3 + pulse, '#adffd1bd');
    ctx.restore();
  }

  private renderFallback(data: BossData, size: number): void {
    const ctx = this.renderer.context;
    if (!ctx) return;

    ctx.save();
    ctx.translate(data.x + size / 2, data.y + size / 2);
    ctx.rotate(Math.atan2(data.facingY, data.facingX));
    const stride = data.state === 'chase' ? Math.sin(performance.now() / 55) * 5 : 0;
    for (let i = 0; i < 3; i++) {
      const x = i * 14 - 18;
      this.renderer.fillEllipse(x + stride, -21, 5, 13, '#56342e');
      this.renderer.fillEllipse(x - stride, 21, 5, 13, '#56342e');
    }
    const exposed = data.state === 'recover' && data.currentAttack === 'surge';
    const shell = this.store.phase() === 2 ? '#5c7f76' : '#726451';
    this.renderer.fillEllipse(-14, 0, 25, 26, '#202d2a');
    this.renderer.fillEllipse(-13, 0, 19, 16, exposed ? '#a1e8c1' : '#476457');
    const split = exposed ? 15 : 8;
    for (const side of [-1, 1]) {
      this.renderer.fillEllipse(-17, side * split, 22, 9, shell);
      this.renderer.fillEllipse(-21, side * (split + 3), 13, 3, '#c5b785');
      this.renderer.fillEllipse(11, side * 14, 16, 9, '#4b655d');
      this.renderer.fillEllipse(31, side * 11, 12, 4, '#25352c');
      this.renderer.fillEllipse(25, side * 7, 4, 3, '#e3dda2');
    }
    this.renderer.fillEllipse(17, 0, 17, 10, '#303c34');
    ctx.restore();
  }

  /** UI écran (repère non-monde) : grande barre de vie du boss en bas. */
  renderUi(title?: string): void {
    this.renderBossHpBar(this.store.getData(), title);
  }

  private renderBossHpBar(data: BossData, title?: string) {
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
    const name = title ?? (isPhase2 ? 'LA VEILLE · L’EAU SE SOULÈVE' : 'LA VEILLE SOUS LA DIGUE');

    // On centre le texte au-dessus de la barre
    const textX = barX + barWidth / 2;
    this.renderer.drawText(
      name.toUpperCase(),
      textX,
      barY - 12,
      '#F5F5DC', // Beige/Ivoire pour le texte
    );

    if (data.state === 'recover') {
      this.renderer.drawText('OUVERTURE', textX, barY + 25, '#fde1a7',
        { size: 12, align: 'center', shadow: true });
    }

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

  //Créer une logique qui permet au boss de choisir son attaque en fonction de sa distance par apport au player.

  private chooseAttack(dist: number) {
    const phase = this.store.phase();

    let attack: Exclude<BossAttackType, 'none'>;
    if (this.duelist) {
      attack = this.lastAttack !== 'charge' && dist > 105 ? 'charge' : dist < 67 ? 'slam' : 'slash';
    } else if (this.lastAttack !== 'surge' && (phase === 2 || this.lastAttack !== 'none')) {
      attack = 'surge';
    } else {
      attack = dist > 128 ? 'charge' : 'slam';
    }
    this.lastAttack = attack;

    const config = BOSS_ATTACKS[attack];

    //Si le boss est en phase 2 on va augmenter l'harcelement de ses attaques

    const windupMult = phase === 2 ? BOSS_CONFIG.phase2WndupMultiplier : 1;

    this.store.update({
      state: 'windup',
      stateTimer: config.windupDuration * windupMult,
      currentAttack: attack,
      comboStep: 0,
      facingX: (this.playerStore.getData().x + PLAYER_CONFIG.size / 2 - this.centerX) / (dist || 1),
      facingY: (this.playerStore.getData().y + PLAYER_CONFIG.size / 2 - this.centerY) / (dist || 1),
    });

    if (attack === 'charge') {
      const player = this.playerStore.getData(); //Info sur le player

      this.store.update({
        chargeTargetX: player.x + PLAYER_CONFIG.size / 2,
        chargeTargetY: player.y + PLAYER_CONFIG.size / 2,
      });
    }
  }

  //???? Comment detecter les collisions entre le boss et le player.
}
