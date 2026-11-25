import { inject, Injectable } from '@angular/core';
import { BOSS_CONFIG, BOSS_PHASE_PROFILE, BOSS_TEMPO, BossState } from '../../constants/boss.config-constant';
import { BOSS_TRANSITIONS } from './boss-fsm';
import { BOSS_LORE, BossId, BossPhase } from '../../constants/boss-lore';
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
  attackProgress,
  comboStepAt,
  surgeRadius,
  tideRadii,
} from '../../interfaces/BossAttackData';
import { BossData } from '../../interfaces/BossData';
import { RendererService } from '../../services/renderer.service';
import { PlayerStore } from '../player/player.store';
import { BossStore } from './boss.store';
import { BossBrain, MIN_WINDUP, inReach } from './boss-brain';
import { BACKSTAB, HIT_WEIGHT, HitWeight, POISE } from '../../constants/immersion.config-constant';

/** Détails d'un coup reçu : poids de l'arme et coup porté dans le dos. */
export interface HitImpact {
  weight?: HitWeight;
  backstab?: boolean;
}

type Attack = Exclude<BossAttackType, 'none'>;

/** Choix d'attaque d'une phase : l'attaque, et éventuellement celle qui suit sans pause. */
interface AttackPlan {
  attack: Attack;
  chain?: Attack;
}

/** Durée d'affichage de la bannière de phase après la transition (ms). */
const BANNER_TIME = 2600;

export interface BossHud {
  name: string;
  epithet: string;
  hp: number;
  maxHp: number;
  phase: BossPhase;
  thresholds: [number, number];
  /** Fenêtre de punition affichée sous la barre. */
  opening: string | null;
  banner: { phase: BossPhase; title: string; line: string; duration: number } | null;
}

@Injectable({
  providedIn: 'root',
})
export class BossEntity {
  private store = inject(BossStore);
  private playerStore = inject(PlayerStore);
  private readonly motion = new ActorMotion();
  private readonly terrain = inject(TerrainCollisionService);
  private renderer = inject(RendererService);
  private assets = inject(AssetLoaderService);

  /** Combattant humain (rig humanoïde, cerveau de duelliste) : Kofi ou le porte-hache. */
  private duelist = false;
  private kind: BossId = 'guardian';
  private lastAttack: BossAttackType = 'none';
  /** Attaque enchaînée après la récupération courante (combo de phase). */
  private queued: Attack | null = null;
  /** Compteur d'attaques, pour varier les motifs. */
  private attackCount = 0;
  private banner = 0;
  private animator = new Animator(BOSS_SHEET, BOSS_CLIPS, 'idle');
  /** Placement, tournoiement et réactions entre deux attaques. */
  private readonly brain = new BossBrain();
  /** Attaque choisie que le boss va lancer dès qu'il sera à bonne portée. */
  private pending: AttackPlan | null = null;
  /** Côté préféré pour contourner un obstacle (évite d'hésiter à chaque frame). */
  private steerSide = 1;
  /** Équilibre restant : rompu, le boss chancelle (voir POISE). */
  private poise = 0;
  private poiseRegenDelay = 0;
  /** Recul physique en cours (unités/s), amorti en ~0,12 s. */
  private knockVX = 0;
  private knockVY = 0;
  /** Sursaut du haut du corps (1 → 0) et direction du coup reçu (monde). */
  flinch = 0;
  flinchX = 0;
  flinchY = 0;

  /** Centre du boss en coords monde (caméra / éclairage). */
  get centerX() {
    return this.store.getData().x + BOSS_CONFIG.size / 2;
  }
  get centerY() {
    return this.store.getData().y + BOSS_CONFIG.size / 2;
  }

  get id(): BossId {
    return this.kind;
  }

  /** Vrai une fois l'animation de mort terminée (la suite du chapitre peut venir). */
  get deathDone() {
    const data = this.store.getData();
    return data.state === 'dead' && data.stateTimer <= 0;
  }

  get lore() {
    return BOSS_LORE[this.id];
  }

  /** true : Kofi (gué), false : le Gardien, ou un identifiant de boss. */
  configure(boss: boolean | BossId) {
    this.kind = typeof boss === 'string' ? boss : boss ? 'duelist' : 'guardian';
    this.duelist = this.kind !== 'guardian';
    this.lastAttack = 'none';
    this.queued = null;
    this.attackCount = 0;
    this.banner = 0;
    this.pending = null;
    this.brain.reset();
    this.motion.reset();
    this.poise = POISE.max[this.id];
    this.poiseRegenDelay = 0;
    this.knockVX = 0;
    this.knockVY = 0;
    this.flinch = 0;
  }

  /** Change d'état en gardant la durée totale (pour l'avancement des animations). */
  private enter(state: BossState, ms: number, extra: Partial<BossData> = {}) {
    const from = this.store.getData().state;
    if (from !== state && !BOSS_TRANSITIONS[from].includes(state)) {
      // Machine à états : une transition non prévue est un bug de logique.
      console.warn(`[Boss] transition inattendue ${from} → ${state}`);
    }
    this.store.update({ state, stateTimer: ms, stateLength: ms, ...extra });
  }

  /** Profil de la phase courante (timeScale, lueur, attaques débloquées). */
  profile(data = this.store.getData()) {
    return BOSS_PHASE_PROFILE[this.id][data.phase];
  }

  /** Avancement 0→1 de l'état courant. */
  progress(data = this.store.getData()) {
    return Math.max(0, Math.min(1, 1 - data.stateTimer / (data.stateLength || 1)));
  }

  update(deltaTime: number) {
    const data = this.store.getData();
    if (this.banner > 0) this.banner -= deltaTime * 1000;
    if (data.state === 'dead') {
      this.flinch = Math.max(0, this.flinch - deltaTime * 4.5);
      // Horloge de l'animation de mort (progress() va de 0 à 1).
      if (data.stateTimer > 0) this.store.update({ stateTimer: Math.max(0, data.stateTimer - deltaTime * 1000) });
      return;
    }

    // Horloge du boss accélérée par le profil de phase (timeScale) : états,
    // coups et animations (pilotées par l'avancement) vont plus vite.
    const clock = deltaTime * this.profile(data).timeScale;
    switch (data.state) {
      case 'idle':
        this.handleIdle(clock);
        break;
      case 'chase':
        this.handleChase(clock);
        break;
      case 'windup':
        this.handleWindup(clock);
        break;
      case 'attacking':
        this.handleAttacking(clock);
        break;
      case 'recover':
        this.handleRecover(clock);
        break;
      case 'hurt':
      case 'stunned':
        this.handleHurt(clock);
        break;
      case 'shift':
        this.handleShift(clock);
        break;
    }

    this.tickImpact(deltaTime);
    this.resolveMovement(data.x, data.y);
    const resolved = this.store.getData();
    this.motion.update(deltaTime, Math.hypot(resolved.x - data.x, resolved.y - data.y),
      resolved.facingX, resolved.facingY);
    this.animator.play(bossStateToClip(data.state === 'shift' || data.state === 'stunned' ? 'hurt' : data.state));
    this.animator.update(deltaTime);
  }

  private tempo() {
    return BOSS_TEMPO[this.store.getData().phase];
  }

  handleIdle(deltaTime: number) {
    const data = this.store.getData();
    const newTimer = data.stateTimer - deltaTime * 1000;
    if (newTimer > 0) {
      this.store.update({ stateTimer: newTimer });
    } else if (this.distanceToPlayer() <= BOSS_CONFIG.chaseRange) {
      this.enter('chase', 0);
    } else {
      this.enter('idle', BOSS_CONFIG.idlePauseDuration);
    }
  }

  private toPlayer() {
    const p = this.playerStore.getData();
    const dx = p.x + PLAYER_CONFIG.size / 2 - this.centerX;
    const dy = p.y + PLAYER_CONFIG.size / 2 - this.centerY;
    return { dx, dy, distance: Math.hypot(dx, dy) };
  }

  private distanceToPlayer() {
    return this.toPlayer().distance;
  }

  handleChase(deltaTime: number) {
    const boss = this.store.getData();
    const { dx, dy, distance } = this.toPlayer();

    if (distance > BOSS_CONFIG.chaseRange) {
      this.enter('idle', BOSS_CONFIG.idlePauseDuration);
      return;
    }

    // L'attaque est choisie d'avance (motifs de phase), puis le boss se place
    // à sa vraie portée avant de la préparer.
    if (!this.pending) this.pending = this.plan(distance);
    const player = this.playerStore.getData();
    const intent = this.brain.think(deltaTime * 1000, dx, dy, distance, this.pending.attack,
      player.state, this.duelist);

    // Le joueur fuit ou tire de loin trop longtemps : il change d'avis
    // (la plupart des phases répondent alors par une charge).
    if (this.brain.mode === 'approach' && this.brain.pursuit > 1700) {
      this.brain.pursuit = 0;
      this.pending = this.plan(distance);
    }

    // Collé à un obstacle avec le joueur pas loin : il frappe à travers le
    // décor (ses coups brisent jarres, palissades et murs).
    const smash = this.brain.mode === 'approach' && this.brain.stuck > 700 && distance < 230;
    if (intent.attack || smash) {
      const plan = this.pending;
      this.pending = null;
      this.brain.stuck = 0;
      this.startAttack(plan);
      return;
    }

    const len = distance || 1;
    const speed = BOSS_CONFIG.speed * this.tempo().speed * intent.speed;
    const step = this.steer(intent.dirX, intent.dirY, speed * deltaTime, deltaTime);
    // Il garde toujours le joueur en face, même en tournant ou en reculant.
    this.store.update({
      x: boss.x + step.x,
      y: boss.y + step.y,
      facingX: dx / len,
      facingY: dy / len,
    });
  }

  /**
   * Évitement local : essaie la direction voulue, puis des directions de plus
   * en plus écartées du même côté d'abord. Ne sonde le décor que si la voie
   * directe est bloquée, pour rester léger à 60 fps.
   */
  private steer(dirX: number, dirY: number, distance: number, deltaTime: number) {
    if (distance <= 0) return { x: 0, y: 0 };
    const half = BOSS_CONFIG.size / 2;
    const cx = this.store.getData().x + half;
    const cy = this.store.getData().y + half;
    const probe = 24;
    const clear = (x: number, y: number) => {
      const p = this.terrain.move(cx, cy, cx + x * probe, cy + y * probe, 19);
      return Math.hypot(p.x - cx, p.y - cy) >= probe * 0.7;
    };
    if (clear(dirX, dirY)) {
      this.brain.stuck = Math.max(0, this.brain.stuck - deltaTime * 2000);
      return { x: dirX * distance, y: dirY * distance };
    }
    for (const angle of [0.6, 1.2, 1.8]) {
      for (const side of [this.steerSide, -this.steerSide]) {
        const a = angle * side;
        const x = dirX * Math.cos(a) - dirY * Math.sin(a);
        const y = dirX * Math.sin(a) + dirY * Math.cos(a);
        if (clear(x, y)) {
          this.steerSide = side;
          this.brain.stuck += deltaTime * 400;
          return { x: x * distance, y: y * distance };
        }
      }
    }
    // Coincé (mur, bord de l'arène) : en tournant, il repart dans l'autre sens.
    this.brain.stuck += deltaTime * 1000;
    if (this.brain.mode === 'stalk') this.brain.flipOrbit();
    return { x: dirX * distance, y: dirY * distance };
  }

  /** Config de l'attaque courante (null si aucune). */
  private attackConfig(name: string): BossAttackData | null {
    if (name === 'none' || !(name in BOSS_ATTACKS)) return null;
    return BOSS_ATTACKS[name as Attack];
  }

  //Préparation de l'attaque : le boss se tourne vers le joueur et télégraphie.
  private handleWindup(deltaTime: number) {
    const data = this.store.getData();
    const { dx, dy, distance } = this.toPlayer();
    const len = distance || 1;
    const newTimer = data.stateTimer - deltaTime * 1000;
    // Le regard se verrouille juste avant le coup : c'est ce qui rend l'esquive lisible.
    const locked = data.currentAttack === 'charge' || newTimer < 160;
    const facingX = locked ? data.facingX : dx / len;
    const facingY = locked ? data.facingY : dy / len;

    if (newTimer <= 0) {
      const cfg = this.attackConfig(data.currentAttack);
      this.enter('attacking', cfg ? cfg.attackDuration : 200, { facingX, facingY, comboStep: 0 });
    } else {
      this.store.update({ stateTimer: newTimer, facingX, facingY });
    }
  }

  //Phase active : la charge fonce vers la cible verrouillée, le combo avance d'un pas par coup.
  private handleAttacking(deltaTime: number) {
    const data = this.store.getData();
    const newTimer = data.stateTimer - deltaTime * 1000;

    if (data.currentAttack === 'charge') {
      const cx = data.chargeTargetX - this.centerX;
      const cy = data.chargeTargetY - this.centerY;
      const len = Math.hypot(cx, cy);
      if (len > 4) {
        const step = Math.min(len, BOSS_CONFIG.chargeSpeed * this.tempo().speed * deltaTime);
        this.store.update({ x: data.x + (cx / len) * step, y: data.y + (cy / len) * step });
      }
    } else if (data.currentAttack === 'combo') {
      const step = comboStepAt(attackProgress('combo', Math.max(0, newTimer)));
      if (step !== data.comboStep) {
        // Chaque coup du combo se réaligne sur le joueur et fait un pas en avant.
        const { dx, dy, distance } = this.toPlayer();
        const len = distance || 1;
        const lunge = Math.min(22, Math.max(0, distance - 40));
        this.store.update({
          comboStep: step,
          facingX: dx / len,
          facingY: dy / len,
          x: data.x + (dx / len) * lunge,
          y: data.y + (dy / len) * lunge,
        });
      }
    }

    const reachedChargeTarget = data.currentAttack === 'charge' &&
      Math.hypot(data.chargeTargetX - this.centerX, data.chargeTargetY - this.centerY) <= 5 &&
      newTimer < 820;
    if (newTimer <= 0 || reachedChargeTarget) {
      const cfg = this.attackConfig(data.currentAttack);
      const chain = this.queued ? BOSS_CONFIG.chainRecover : 1;
      this.enter('recover', (cfg ? cfg.recoverDuration : 500) * this.tempo().recover * chain, { vx: 0, vy: 0 });
    } else {
      this.store.update({ stateTimer: newTimer });
    }
  }

  //Récupération : fenêtre punissable avant de pouvoir réagir à nouveau.
  private handleRecover(deltaTime: number) {
    const data = this.store.getData();
    const newTimer = data.stateTimer - deltaTime * 1000;
    if (newTimer > 0) {
      this.store.update({ stateTimer: newTimer });
      return;
    }
    if (this.queued) {
      const next = this.queued;
      this.queued = null;
      this.startAttack({ attack: next }, BOSS_CONFIG.chainWindup);
      return;
    }
    // Plutôt que de rester planté, il reprend ses distances et tourne autour
    // du joueur : c'est le moment pour le joueur de souffler ou de se soigner…
    // à ses risques.
    this.brain.breathe(data.phase);
    this.enter('chase', 0, { currentAttack: 'none', comboStep: 0 });
  }

  handleHurt(deltaTime: number) {
    const data = this.store.getData();
    const newTimer = data.stateTimer - deltaTime * 1000;
    const friction = 0.85;
    const newVx = data.vx * friction;
    const newVy = data.vy * friction;

    this.store.update({
      vx: Math.abs(newVx) < 1 ? 0 : newVx,
      vy: Math.abs(newVy) < 1 ? 0 : newVy,
      x: data.x + data.vx * deltaTime,
      y: data.y + data.vy * deltaTime,
    });

    if (newTimer <= 0) {
      // Riposte encaissée : il recule d'un pas avant de revenir.
      this.brain.retreat(380);
      this.enter('chase', 0);
    } else {
      this.store.update({ stateTimer: newTimer });
    }
  }

  /** Transition de phase : le boss est intouchable, rugit, puis reprend plus vite. */
  private handleShift(deltaTime: number) {
    const data = this.store.getData();
    const newTimer = data.stateTimer - deltaTime * 1000;
    if (newTimer <= 0) {
      // Il rouvre la nouvelle phase avec sa signature, sans laisser souffler le joueur.
      // Si le souffle a repoussé le joueur hors de portée, il fond sur lui
      // pour placer cette signature au lieu de la lancer dans le vide.
      const { distance } = this.toPlayer();
      const opening = this.plan(distance, true);
      if (inReach(opening.attack, distance)) {
        this.startAttack(opening);
      } else {
        this.pending = opening;
        this.brain.reset();
        this.enter('chase', 0, { currentAttack: 'none', comboStep: 0 });
      }
    } else {
      this.store.update({ stateTimer: newTimer });
    }
  }

  /** Phase visée par les PV actuels (seuils du lore). */
  private phaseFor(hp: number, maxHp: number): BossPhase {
    const ratio = hp / maxHp;
    const [second, third] = this.lore.thresholds;
    return ratio <= third ? 3 : ratio <= second ? 2 : 1;
  }

  /** Le boss est-il dans une fenêtre où il encaisse plein pot ? */
  isExposed(data = this.store.getData()) {
    return data.state === 'recover' && (data.currentAttack === 'surge' || data.currentAttack === 'tide');
  }

  /**
   * @param amount dégâts bruts du joueur
   * @param x,y recul appliqué si le coup fait chanceler le boss
   */
  takeDamage(amount: number, x: number, y: number, counter = false, impact: HitImpact = {}) {
    const data = this.store.getData();
    if (data.state === 'dead' || data.state === 'shift') return;

    const recovering = data.state === 'recover' || data.state === 'stunned';
    const guardMultiplier = counter ? 1.1 : this.isExposed(data) ? 1.4 : recovering ? 1 : 0.22;
    // Dans le dos, la garde ne protège plus.
    const multiplier = impact.backstab ? Math.max(guardMultiplier, 1) * BACKSTAB.multiplier : guardMultiplier;
    const poiseBroken = this.react(amount, x, y, impact.weight ?? (counter ? 'counter' : 'light'));
    const newHp = Math.max(0, data.hp - Math.max(1, Math.round(amount * multiplier)));
    this.store.update({ hp: newHp });

    if (newHp <= 0) {
      this.queued = null;
      this.pending = null;
      this.enter('dead', BOSS_CONFIG.deathDuration, { vx: 0, vy: 0, currentAttack: 'none', comboStep: 0 });
      return;
    }

    const next = this.phaseFor(newHp, data.maxHp);
    if (next > data.phase) {
      this.queued = null;
      this.pending = null;
      this.banner = BOSS_CONFIG.shiftDuration + BANNER_TIME;
      this.enter('shift', BOSS_CONFIG.shiftDuration, {
        phase: next, vx: 0, vy: 0, currentAttack: 'none', comboStep: 0,
      });
    } else if (counter && data.state !== 'recover') {
      this.queued = null;
      this.enter('hurt', BOSS_CONFIG.hurtDuration, { vx: x, vy: y });
    } else if (poiseBroken) {
      // Équilibre rompu : il est étourdi, l'attaque en cours est interrompue,
      // et il encaisse les coups sans garde jusqu'à ce qu'il se reprenne.
      this.queued = null;
      this.pending = null;
      this.enter('stunned', POISE.breakDuration, { vx: x * 0.6, vy: y * 0.6, currentAttack: 'none', comboStep: 0 });
    } else if (data.state === 'chase') {
      // Frappé pendant qu'il tournait : il cesse d'attendre et répond.
      this.brain.provoke();
    }
  }

  /**
   * Réaction physique à un coup : recul de quelques centimètres selon le
   * poids de l'arme, sursaut du buste, et usure de l'équilibre.
   * @returns vrai si l'équilibre vient de rompre
   */
  private react(amount: number, x: number, y: number, weight: HitWeight) {
    const w = HIT_WEIGHT[weight];
    const length = Math.hypot(x, y);
    const nx = length ? x / length : 0;
    const ny = length ? y / length : 0;
    const speed = POISE.knockback * w * POISE.knockbackDamping;
    this.knockVX = nx * speed;
    this.knockVY = ny * speed;
    this.flinch = Math.min(1, 0.45 + w * 0.3);
    this.flinchX = nx;
    this.flinchY = ny;
    this.poiseRegenDelay = POISE.regenDelay;
    this.poise -= amount * w;
    if (this.poise > 0) return false;
    this.poise = POISE.max[this.id];
    return true;
  }

  private tickImpact(deltaTime: number) {
    this.flinch = Math.max(0, this.flinch - deltaTime * 4.5);
    if (this.poiseRegenDelay > 0) this.poiseRegenDelay -= deltaTime * 1000;
    else this.poise = Math.min(POISE.max[this.id], this.poise + POISE.regenRate * deltaTime);
    if (Math.abs(this.knockVX) + Math.abs(this.knockVY) < 1) {
      this.knockVX = this.knockVY = 0;
      return;
    }
    const data = this.store.getData();
    this.store.update({ x: data.x + this.knockVX * deltaTime, y: data.y + this.knockVY * deltaTime });
    const decay = Math.exp(-POISE.knockbackDamping * deltaTime);
    this.knockVX *= decay;
    this.knockVY *= decay;
  }

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

    if (data.state === 'windup' && (data.currentAttack === 'surge' || data.currentAttack === 'tide')) {
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
    if (data.currentAttack === 'surge' || data.currentAttack === 'slam' || data.currentAttack === 'tide') {
      const water = data.currentAttack !== 'slam';
      const radii = data.currentAttack === 'tide' ? tideRadii(size, data.stateTimer)
        : [water ? surgeRadius(size, data.stateTimer) : cfg.range * size * 0.5 * (0.3 + progress * 0.7)];
      for (const radius of radii) {
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
      }
    } else if (data.currentAttack === 'sweep') {
      for (let arc = 0; arc < 3; arc++) {
        this.renderer.slash(cx, cy, angle + progress * Math.PI * 2 + arc * 2.09, cfg.range * size * 0.5,
          progress, '#ead6a77a');
      }
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
    const state = data.state;
    const pose = state === 'windup' ? 'ready' : state === 'attacking' ?
      (data.currentAttack === 'charge' ? 'dash' : 'strike') :
      state === 'recover' ? 'recover' : state === 'hurt' || state === 'shift' ? 'hurt' : 'rest';
    const progress = this.progress(data);
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
    const exposed = this.isExposed(data);
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
    const exposed = this.isExposed(data);
    const shell = ['#726451', '#5c7f76', '#6f4d4a'][data.phase - 1];
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
  /** UI écran (repère non-monde) : barre de vie du boss et bannière de phase. */
  /** Canvas : seulement les bandes et le carton de l'entrée (le HUD est en HTML). */
  renderUi(intro: number | null = null): void {
    if (intro !== null) this.renderIntro(this.store.getData(), intro);
  }

  /**
   * État du HUD HTML (barre de vie, ouverture, bannière de phase), lu par
   * GameStateService à chaque image. Valeurs arrondies : le HUD ne se
   * redessine que lorsqu'elles changent.
   */
  hud(intro: number | null = null): BossHud | null {
    const data = this.store.getData();
    if (data.state === 'dead') return null;
    const lore = this.lore;
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    // Pendant l'entrée, la barre se remplit avant de rendre la main.
    const fill = intro === null ? 1 : smooth(0.68, 0.92, intro);
    if (fill <= 0) return null;
    const phase = lore.phases[data.phase];
    return {
      name: lore.name,
      epithet: lore.epithet,
      hp: Math.round(data.hp * fill),
      maxHp: data.maxHp,
      phase: data.phase,
      thresholds: lore.thresholds,
      opening: intro !== null ? null
        : data.state === 'stunned' ? 'Étourdi'
        : data.state !== 'recover' ? null
        : this.isExposed(data) ? 'Carapace ouverte'
        : data.currentAttack === 'shot' ? 'Il recharge' : 'Ouverture',
      banner: this.banner > 0 && data.phase > 1 && intro === null
        ? { phase: data.phase, title: phase.title, line: phase.line, duration: BOSS_CONFIG.shiftDuration + BANNER_TIME }
        : null,
    };
  }

  /**
   * Entrée du boss : bandes noires, puis le nom apparaît une fois le boss
   * révélé, et la barre de vie se remplit avant de rendre la main.
   */
  private renderIntro(data: BossData, k: number) {
    const ctx = this.renderer.context;
    if (!ctx) return;
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const w = this.renderer.width;
    const h = this.renderer.height;
    const bars = smooth(0, 0.08, k) * (1 - smooth(0.9, 1, k));
    const bandH = h * 0.11 * bars;
    this.renderer.fillRect(0, 0, w, bandH, '#000000');
    this.renderer.fillRect(0, h - bandH, w, bandH, '#000000');

    const card = smooth(0.55, 0.65, k) * (1 - smooth(0.9, 0.98, k));
    if (card > 0) {
      const lore = this.lore;
      const cy = h * 0.66;
      ctx.save();
      ctx.globalAlpha = card;
      this.renderer.drawText(lore.epithet.toUpperCase(), w / 2, cy - 30, '#C5A059',
        { size: 13, align: 'center', font: 'Georgia', shadow: true });
      this.renderer.drawText(lore.name.toUpperCase(), w / 2, cy + 4, '#f6e6c4',
        { size: 34, align: 'center', font: 'Georgia', shadow: true });
      const rule = 260 * smooth(0.55, 0.75, k);
      this.renderer.fillRect(w / 2 - rule / 2, cy + 16, rule, 1, '#C5A059');
      this.renderer.drawText(lore.chapter, w / 2, cy + 36, '#e8d5ad',
        { size: 13, align: 'center', font: 'Georgia', shadow: true });
      ctx.restore();
    }
  }

  /**
   * Motifs d'attaque par boss et par phase. Chaque phase garde les coups
   * de la précédente et ajoute sa signature, pour que le joueur reconnaisse
   * le changement sans le réapprendre de zéro.
   */
  private plan(dist: number, opening = false): AttackPlan {
    const phase = this.store.getData().phase;
    const last = this.lastAttack;
    const turn = this.attackCount;

    if (this.kind === 'champion') {
      // Phase 1 : hache. Phase 2 : mousquet ensorcelé tiré de loin, hache de près.
      // Phase 3 : sabre, tir en éventail, charge enchaînée sur un enchaînement.
      if (phase === 3) {
        if (opening) return { attack: 'combo' };
        if (dist > 150 && last !== 'shot') return { attack: 'shot' };
        if (dist > 105 && last !== 'charge') return { attack: 'charge', chain: 'combo' };
        if (dist < 75 && last !== 'sweep') return { attack: 'sweep' };
        return turn % 2 ? { attack: 'combo' } : { attack: 'slash', chain: 'slash' };
      }
      if (phase === 2) {
        if (opening || (dist > 120 && last !== 'shot')) return { attack: 'shot' };
        if (dist < 70) return last === 'sweep' ? { attack: 'slam' } : { attack: 'sweep' };
        return turn % 3 === 0 ? { attack: 'charge', chain: 'slam' } : { attack: 'shot' };
      }
      if (opening) return { attack: 'slam' };
      if (dist > 115 && last !== 'charge') return { attack: 'charge' };
      return dist < 72 && last !== 'sweep' ? { attack: 'sweep' } : { attack: 'slam' };
    }

    if (this.duelist) {
      if (phase === 3) {
        if (opening || (dist < 80 && last !== 'sweep')) return { attack: 'sweep' };
        if (dist > 105 && last !== 'charge') return { attack: 'charge', chain: 'combo' };
        return turn % 2 ? { attack: 'combo' } : { attack: 'slam', chain: 'slash' };
      }
      if (phase === 2) {
        if (opening) return { attack: 'combo' };
        if (dist > 105 && last !== 'charge') return { attack: 'charge', chain: 'slash' };
        return dist < 67 ? { attack: 'slam' } : last === 'combo' ? { attack: 'slash' } : { attack: 'combo' };
      }
      return { attack: last !== 'charge' && dist > 105 ? 'charge' : dist < 67 ? 'slam' : 'slash' };
    }

    // Gardien noyé.
    if (phase === 3) {
      if (opening) return { attack: 'sweep' };
      if (last !== 'tide' && last !== 'surge') return turn % 2 ? { attack: 'tide' } : { attack: 'surge', chain: 'charge' };
      return dist < 85 ? { attack: 'sweep' } : { attack: 'combo', chain: 'slam' };
    }
    if (phase === 2) {
      if (opening || (last !== 'tide' && last !== 'surge')) return { attack: 'tide' };
      return dist > 128 ? { attack: 'charge' } : { attack: 'combo' };
    }
    if (last !== 'surge' && last !== 'none') return { attack: 'surge' };
    return { attack: dist > 128 ? 'charge' : 'slam' };
  }

  private startAttack(plan: AttackPlan, windupScale = 1) {
    // Seules les attaques débloquées par le profil de phase sont jouées.
    const unlocked = this.profile().attacks;
    const attack = unlocked.includes(plan.attack) ? plan.attack : unlocked[0];
    const chain = plan.chain && unlocked.includes(plan.chain) ? plan.chain : undefined;
    this.lastAttack = attack;
    this.attackCount++;
    this.queued = chain ?? null;
    const config = BOSS_ATTACKS[attack];
    const { dx, dy, distance } = this.toPlayer();
    const len = distance || 1;
    // Préparation jamais plus courte que MIN_WINDUP : même enchaînée en phase 3,
    // chaque attaque reste lisible et esquivable.
    // MIN_WINDUP est en temps réel : on le compense du timeScale de la phase.
    const windup = Math.max(MIN_WINDUP * this.profile().timeScale, config.windupDuration * this.tempo().windup * windupScale);
    this.enter('windup', windup, {
      currentAttack: attack,
      comboStep: 0,
      facingX: dx / len,
      facingY: dy / len,
    });

    if (attack === 'charge') {
      const player = this.playerStore.getData();
      this.store.update({
        chargeTargetX: player.x + PLAYER_CONFIG.size / 2,
        chargeTargetY: player.y + PLAYER_CONFIG.size / 2,
      });
    }
  }
}
