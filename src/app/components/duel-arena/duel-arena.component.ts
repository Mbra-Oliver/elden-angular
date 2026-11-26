import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener,
  ViewChild, computed, inject, signal,
} from '@angular/core';
import { GameStateService } from '../../lib/services/game-state.service';
import { EnvironmentService } from '../../lib/engine/environment.service';
import { WORLD } from '../../lib/constants/terrain-constant';
import type { Actor3D, World3D } from '../../lib/engine/world-3d';
import { FORD_DUEL } from '../../lib/engine/duel-fog';
import { DuelClientService, type DuelSnapshot } from '../../lib/pvp/duel-client.service';
import { RemotePlayer } from '../../lib/pvp/remote-player';
import { DUEL_RULES, attackTimeline, clamp, clampToArena, type DuelAction, type DuelFx, type DuelPose } from '../../lib/pvp/duel-rules';
import { CombatFxService } from '../../lib/services/combat-fx.service';
import { AudioEngineService } from '../../lib/audio/audio-engine.service';
import { InputService } from '../../lib/services/input.service';
import { ShiftGesture } from '../../lib/entities/player/locomotion';
import { isTouchDevice } from '../../lib/platform/display';
import { TouchControlsComponent } from '../touch-controls/touch-controls.component';
import { PauseMenuComponent } from '../pause-menu/pause-menu.component';

interface Vector {
  x: number;
  z: number;
}

/** Durée d'un clic de souris converti en appui de touche (comme en jeu). */
const CLICK_PULSE_MS = 90;
const INPUT_HZ = 30;
const BUSY_STATES = new Set(['light', 'heavy', 'throw', 'heal', 'hurt', 'stagger', 'dodge', 'dead']);

@Component({
  selector: 'app-duel-arena',
  imports: [TouchControlsComponent, PauseMenuComponent],
  templateUrl: './duel-arena.component.html',
  styleUrl: './duel-arena.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DuelArenaComponent implements AfterViewInit {
  @ViewChild('viewport') viewport!: ElementRef<HTMLElement>;

  private readonly destroyRef = inject(DestroyRef);
  private readonly gameState = inject(GameStateService);
  private readonly environment = inject(EnvironmentService);
  /** Mêmes entrées que l'aventure : clavier, manette, souris et contrôles tactiles. */
  private readonly input = inject(InputService);
  private readonly audio = inject(AudioEngineService);
  private readonly combatFx = inject(CombatFxService);
  private readonly shift = new ShiftGesture();
  private readonly held = new Set<string>();
  private click: { x: number; y: number; at: number } | null = null;
  private lastFrame = 0;
  readonly touch = isTouchDevice();
  readonly menuOpen = signal(false);
  private readonly queued: DuelAction[] = [];
  private readonly localSmooth = new RemotePlayer();
  private readonly remoteSmooth = new RemotePlayer();
  private world: World3D | null = null;
  private frame = 0;
  private timer = 0;
  /** Dernière orientation voulue ; null = garder celle d'apparition (face à l'adversaire). */
  private lastYaw: number | null = null;
  private readonly pendingInputs: { seq: number; moveX: number; moveZ: number }[] = [];
  private baseX = 0;
  private baseZ = 0;
  private baseState = 'idle';
  private baseTotem = false;
  private lastPose: DuelPose | null = null;
  private lastPublishAt = 0;
  private predictedX = 0;
  private predictedZ = 0;
  private predictedReady = false;
  private lastFxId = 0;
  private lastPhase = '';
  private lastSeat: 0 | 1 = 0;
  private lastAttackStates: Record<0 | 1, string> = { 0: '', 1: '' };
  readonly copied = signal(false);
  readonly duelTotem = DUEL_RULES.totemEnabled;

  readonly client = inject(DuelClientService);
  readonly status = this.client.status;
  readonly mode = this.client.mode;
  readonly error = this.client.error;
  readonly snapshot = this.client.snapshot;
  readonly seat = this.client.seat;
  readonly codeInput = signal('');
  readonly inviteUrl = this.client.inviteUrl;
  readonly rematchAsked = computed(() => this.snapshot().rematch.includes(this.seat()));
  readonly rematchOffered = computed(() => this.snapshot().rematch.some((seat) => seat !== this.seat()));
  readonly opponentGone = computed(() => this.snapshot().phase === 'finished' && this.snapshot().reason === 'forfait');
  readonly joined = computed(() => this.status() === 'connected');
  readonly countdown = computed(() => Math.ceil(this.snapshot().countdown / 1000));
  readonly remaining = computed(() => Math.max(0, Math.ceil(this.snapshot().remaining / 1000)));
  readonly me = computed(() => this.snapshot().players[this.seat()]);
  readonly opponent = computed(() => this.snapshot().players[this.seat() === 0 ? 1 : 0]);
  readonly waitingLabel = computed(() => this.mode() === 'public'
    ? 'Recherche d’un adversaire…'
    : 'Ouverture de l’arène…');
  readonly phaseLabel = computed(() => {
    const phase = this.snapshot().phase;
    if (phase === 'waiting') return 'En attente d’un adversaire';
    if (phase === 'countdown') return `Commence dans ${this.countdown()}`;
    if (phase === 'fighting') return `Duel · ${this.remaining()} s`;
    if (this.opponentGone()) return 'Victoire par forfait';
    return this.snapshot().reason || 'Fin du duel';
  });
  readonly result = computed(() => {
    const winner = this.snapshot().winner;
    if (winner < 0) return 'Égalité';
    return winner === this.seat() ? 'Victoire d’honneur' : 'Défaite';
  });
  readonly totemHolder = computed(() => {
    const carrier = this.snapshot().totemCarrier;
    if (carrier === this.seat()) return 'Vous portez le totem';
    if (carrier >= 0) return 'L’adversaire porte le totem';
    return 'Totem sacré au sol';
  });
  readonly totemProgress = computed(() => clamp(this.snapshot().totemHold / DUEL_RULES.totemHoldMs * 100, 0, 100));

  ngAfterViewInit(): void {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('duel');
    if (invite) {
      // Lien d'invitation : on rejoint une seule fois, puis on nettoie l'adresse
      // pour qu'un rechargement ou un retour au menu ne relance pas la connexion.
      params.delete('duel');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
      this.codeInput.set(invite.toUpperCase());
      void this.client.join(invite);
    }
    void this.setup();
    this.timer = window.setInterval(() => this.publishInput(), 1000 / INPUT_HZ);
    this.destroyRef.onDestroy(() => {
      this.input.clearVirtual();
      cancelAnimationFrame(this.frame);
      window.clearInterval(this.timer);
      this.world?.setDuelLockTarget(null);
      this.combatFx.reset();
      this.world?.dispose();
      this.world = null;
      void this.client.leave();
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
      event.preventDefault();
    }
    if (event.repeat) return;
    // Échap : menu pause, comme en jeu (le duel, lui, continue côté serveur).
    if (event.code === 'Escape' && this.joined()) this.toggleMenu();
    // Le javelot n'existe qu'en duel : touche T (le kaolin de l'aventure n'y a pas cours).
    if (event.code === 'KeyT' && this.joined() && !this.menuOpen()) this.queue('throw');
  }

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
    this.input.clearVirtual();
  }

  /** Souris : clic gauche bref = frappe légère, clic droit = frappe lourde (glisser = caméra). */
  onPointerDown(event: PointerEvent): void {
    this.audio.unlock();
    if (event.pointerType !== 'mouse' || this.menuOpen()) return;
    if (event.button === 2) this.pulse('KeyE');
    if (event.button === 0) this.click = { x: event.clientX, y: event.clientY, at: performance.now() };
  }

  onPointerUp(event: PointerEvent): void {
    const click = this.click;
    this.click = null;
    if (!click || event.pointerType !== 'mouse' || event.button !== 0 || this.menuOpen()) return;
    const moved = Math.hypot(event.clientX - click.x, event.clientY - click.y);
    if (moved < 8 && performance.now() - click.at < 350) this.pulse('Space');
  }

  private pulse(code: string): void {
    this.input.setVirtual(code, true);
    window.setTimeout(() => this.input.setVirtual(code, false), CLICK_PULSE_MS);
  }

  setCode(event: Event): void {
    this.codeInput.set((event.target as HTMLInputElement).value.toUpperCase());
  }

  create(): void {
    this.audio.unlock();
    void this.client.create();
  }

  quickMatch(): void {
    this.audio.unlock();
    void this.client.quickMatch();
  }

  join(): void {
    this.audio.unlock();
    void this.client.join(this.codeInput());
  }

  async share(): Promise<void> {
    const url = this.inviteUrl();
    if (!url) return;
    try {
      // Feuille de partage native (iPhone) d'abord, presse-papiers ensuite.
      if (navigator.share) await navigator.share({ title: 'Duel d’honneur', text: `Code ${this.snapshot().code}`, url });
      else if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(url);
      else return;
      this.copied.set(true);
      window.setTimeout(() => this.copied.set(false), 1800);
    } catch {
      // Partage annulé : l'adresse reste affichée à l'écran.
    }
  }

  rematch(): void {
    this.lastYaw = null;
    this.pendingInputs.length = 0;
    this.predictedReady = false;
    this.lastFxId = 0;
    this.combatFx.reset();
    this.client.requestRematch();
  }

  async exit(): Promise<void> {
    this.input.setVirtual('KeyG', false);
    this.combatFx.reset();
    await this.client.leave();
    this.gameState.returnToMainMenu();
  }

  press(action: DuelAction, event?: Event): void {
    event?.preventDefault();
    this.audio.unlock();
    this.queue(action);
  }

  private queue(action: DuelAction): void {
    if (this.queued.length < 2) this.queued.push(action);
  }

  /**
   * Lu à chaque image, avec les mêmes règles que le héros : Espace / clic
   * gauche / RB = légère, E / clic droit / RT = lourde, Maj bref / B = esquive
   * (au relâcher), B clavier / X = mixture.
   */
  private readActions(dt: number): void {
    if (!this.joined() || this.menuOpen()) {
      this.shift.reset();
      this.held.clear();
      return;
    }
    const edge = (name: string, pressed: boolean) => {
      const was = this.held.has(name);
      if (pressed) this.held.add(name);
      else this.held.delete(name);
      return pressed && !was;
    };
    if (edge('attack', this.input.attack())) this.queue('light');
    if (edge('heavy', this.input.heavyAttack())) this.queue('heavy');
    if (edge('drink', this.input.drink())) this.queue('heal');
    if (this.shift.update(this.input.dodge(), dt)) this.queue('dodge');
  }

  /** Direction relative à la caméra, exactement comme le héros de l'aventure (monde x, y = serveur x, z). */
  private vector(): Vector {
    if (this.menuOpen()) return { x: 0, z: 0 };
    const { x: horizontal, y: vertical } = this.input.moveAxis();
    const heading = this.world?.heading ?? null;
    const dx = heading === null ? horizontal : -horizontal * Math.cos(heading) - vertical * Math.sin(heading);
    const dz = heading === null ? vertical : horizontal * Math.sin(heading) - vertical * Math.cos(heading);
    const length = Math.hypot(dx, dz);
    if (length < 0.05) return { x: 0, z: 0 };
    const magnitude = Math.min(1, length);
    return { x: dx / length * magnitude, z: dz / length * magnitude };
  }

  private publishInput(): void {
    if (!this.joined()) return;
    const move = this.vector();
    const state = this.client.snapshot();
    const me = state.players[this.client.seat()];
    const opponent = state.players[this.client.seat() === 0 ? 1 : 0];
    const seq = this.client.sendInput({
      moveX: move.x,
      moveZ: move.z,
      yaw: this.aimYaw(me, opponent),
      actions: this.queued.splice(0, 2),
      guard: this.input.guard(),
    });
    if (!seq) return;
    this.pendingInputs.push({ seq, moveX: move.x, moveZ: move.z });
    if (this.pendingInputs.length > 16) this.pendingInputs.shift();
    this.lastPublishAt = performance.now();
  }

  private async setup(): Promise<void> {
    const { World3D } = await import('../../lib/engine/world-3d');
    this.world = new World3D(this.viewport.nativeElement);
    this.world.setFxSource(this.combatFx);
    this.loop();
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
    if (!this.world) return;
    const now = performance.now();
    const frameDt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;
    this.readActions(frameDt);
    const state = this.client.snapshot();
    const me = state.players[this.client.seat()];
    const opponent = state.players[this.client.seat() === 0 ? 1 : 0];
    this.syncPrediction(state, me, opponent, now);
    const predicted = me
      ? { ...me, x: this.predictedX, z: this.predictedZ, yaw: this.aimYaw(me, opponent) }
      : null;
    this.localSmooth.update(predicted, frameDt);
    this.remoteSmooth.update(opponent, frameDt);
    this.playStateSounds(me, opponent);
    this.consumeFx();
    const remoteActor = this.actor(this.remoteSmooth, opponent);
    this.world.setRemotePose(opponent, !!opponent);
    this.world.setDuelLockTarget(opponent ? { x: remoteActor.x, y: remoteActor.y } : null);
    this.world.setDuelTotem(state.totemVisible && DUEL_RULES.totemEnabled ? {
      x: state.totemX + WORLD.WIDTH / 2,
      z: state.totemZ + WORLD.HEIGHT / 2,
      carrier: state.totemCarrier,
    } : null);
    this.world.render(
      this.environment.groundCanvas(),
      this.actor(this.localSmooth, me),
      null,
      false,
      null,
      FORD_DUEL,
    );
  };

  private syncPrediction(state: DuelSnapshot, me: DuelPose | null, opponent: DuelPose | null, now: number): void {
    const seat = this.client.seat();
    if (seat !== this.lastSeat || state.phase !== this.lastPhase) {
      this.lastSeat = seat;
      this.lastPhase = state.phase;
      this.pendingInputs.length = 0;
      this.predictedReady = false;
      this.lastPose = null;
      this.lastFxId = 0;
      this.combatFx.reset();
    }
    if (!me) {
      this.predictedReady = false;
      this.lastPose = null;
      this.pendingInputs.length = 0;
      return;
    }
    if (me !== this.lastPose) {
      while (this.pendingInputs.length && this.pendingInputs[0].seq <= me.ack) this.pendingInputs.shift();
      this.baseX = me.x;
      this.baseZ = me.z;
      this.baseState = me.state;
      this.baseTotem = me.totem;
      this.lastPose = me;
      this.predictedReady = true;
    }
    this.rebuildPrediction(me, opponent, now);
  }

  private rebuildPrediction(me: DuelPose, opponent: DuelPose | null, now: number): void {
    let x = this.baseX;
    let z = this.baseZ;
    if (!BUSY_STATES.has(this.baseState)) {
      const speed = this.speedFor(this.baseState, this.baseTotem);
      const step = 1 / INPUT_HZ;
      for (const input of this.pendingInputs) {
        x += input.moveX * speed * step;
        z += input.moveZ * speed * step;
      }
      const move = this.vector();
      const unsent = this.lastPublishAt ? Math.min(0.05, (now - this.lastPublishAt) / 1000) : 0;
      x += move.x * speed * unsent;
      z += move.z * speed * unsent;
    }
    const place = clampToArena(x, z);
    if (opponent) {
      const dx = place.x - opponent.x;
      const dz = place.z - opponent.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 22 && distance > 0.001) {
        place.x = opponent.x + dx / distance * 22;
        place.z = opponent.z + dz / distance * 22;
      }
    }
    this.predictedX = place.x;
    this.predictedZ = place.z;
    if (!this.predictedReady) this.predictedReady = true;
  }

  private speedFor(state: string, totem: boolean): number {
    return DUEL_RULES.speed
      * (state === 'guard' ? DUEL_RULES.guardSpeed : 1)
      * (totem ? DUEL_RULES.totemSlow : 1);
  }

  private aimYaw(me: DuelPose | null, opponent: DuelPose | null): number {
    if (!me || !opponent) return this.lastYaw ?? 0;
    const x = this.predictedReady ? this.predictedX : me.x;
    const z = this.predictedReady ? this.predictedZ : me.z;
    return Math.atan2(opponent.x - x, opponent.z - z);
  }

  private playStateSounds(me: DuelPose | null, opponent: DuelPose | null): void {
    for (const [pose, seat] of [[me, 0], [opponent, 1]] as const) {
      const state = pose?.state ?? '';
      if (state !== this.lastAttackStates[seat]) {
        if (state === 'light' || state === 'throw') this.combatFx.sfx.swing(false);
        else if (state === 'heavy') this.combatFx.sfx.swing(true, 1.15);
        else if (state === 'dodge') this.combatFx.sfx.roll();
      }
      this.lastAttackStates[seat] = state;
    }
  }

  private consumeFx(): void {
    const fx = this.client.fx();
    if (!fx || fx.id === this.lastFxId) return;
    this.lastFxId = fx.id ?? 0;
    const x = fx.x + WORLD.WIDTH / 2;
    const y = fx.z + WORLD.HEIGHT / 2;
    const target = fx.target === this.client.seat() ? 'player' : 'boss';
    const style = fx.attack === 'heavy' ? 'slam' : fx.attack === 'throw' ? 'thrust' : 'slash';
    const strength = clamp(Math.abs(fx.damage) / DUEL_RULES.heavyDamage, 0.45, 1.5);
    if (fx.kind === 'parry') this.combatFx.parry(x, y);
    else if (fx.kind === 'evade') this.combatFx.dust(x, y, fx.dirX, fx.dirZ, 0.4, false);
    else if (fx.kind === 'heal') this.combatFx.flash(x, y, '#8be06d', 3, 0.35, 30);
    else this.combatFx.hit({
      x, y, height: 24, dirX: fx.dirX, dirY: fx.dirZ,
      material: fx.kind === 'hit' ? 'flesh' : 'guard',
      style,
      strength: fx.kind === 'guardbreak' ? 1.4 : fx.kind === 'hit' ? strength : strength * 0.7,
      target,
    });
  }

  private actor(smoothed: RemotePlayer, pose: DuelPose | null): Actor3D {
    const actor = smoothed.actor();
    const timeline = pose ? attackTimeline(pose.state, pose.actionMs, pose.step) : null;
    return {
      ...actor,
      x: actor.x + WORLD.WIDTH / 2,
      y: actor.z + WORLD.HEIGHT / 2,
      hpRatio: pose ? pose.hp / DUEL_RULES.maxHp : undefined,
      attack: timeline ? pose?.state : undefined,
      step: pose?.step,
      phase: timeline ? (timeline.segment === 'recover' ? 1 : timeline.t) : actor.phase,
    };
  }
}
