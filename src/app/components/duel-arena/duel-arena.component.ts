import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener,
  ViewChild, computed, inject, signal,
} from '@angular/core';
import { GameStateService } from '../../lib/services/game-state.service';
import { EnvironmentService } from '../../lib/engine/environment.service';
import { WORLD } from '../../lib/constants/terrain-constant';
import type { Actor3D, World3D } from '../../lib/engine/world-3d';
import { DuelClientService } from '../../lib/pvp/duel-client.service';
import { RemotePlayer } from '../../lib/pvp/remote-player';
import { DUEL_RULES, clamp, type DuelAction, type DuelPose } from '../../lib/pvp/duel-rules';

interface Vector {
  x: number;
  z: number;
}

@Component({
  selector: 'app-duel-arena',
  templateUrl: './duel-arena.component.html',
  styleUrl: './duel-arena.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DuelArenaComponent implements AfterViewInit {
  @ViewChild('viewport') viewport!: ElementRef<HTMLElement>;

  private readonly destroyRef = inject(DestroyRef);
  private readonly gameState = inject(GameStateService);
  private readonly environment = inject(EnvironmentService);
  private readonly keys = new Set<string>();
  private readonly queued: DuelAction[] = [];
  private readonly localSmooth = new RemotePlayer();
  private readonly remoteSmooth = new RemotePlayer();
  private world: World3D | null = null;
  private frame = 0;
  private timer = 0;
  private touch: Vector = { x: 0, z: 0 };
  private lastYaw = 0;
  readonly copied = signal(false);

  readonly client = inject(DuelClientService);
  readonly status = this.client.status;
  readonly mode = this.client.mode;
  readonly error = this.client.error;
  readonly snapshot = this.client.snapshot;
  readonly seat = this.client.seat;
  readonly codeInput = signal('');
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
    return this.snapshot().reason || 'Fin du duel';
  });
  readonly result = computed(() => {
    const winner = this.snapshot().winner;
    if (winner < 0) return 'Égalité';
    return winner === this.seat() ? 'Victoire d’honneur' : 'Défaite';
  });

  ngAfterViewInit(): void {
    const invite = new URLSearchParams(window.location.search).get('duel');
    if (invite) void this.client.join(invite);
    void this.setup();
    this.timer = window.setInterval(() => this.publishInput(), 1000 / 20);
    this.destroyRef.onDestroy(() => {
      cancelAnimationFrame(this.frame);
      window.clearInterval(this.timer);
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
    this.keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'KeyJ') this.queue('light');
    if (event.code === 'KeyK') this.queue('heavy');
    if (event.code === 'KeyL' || event.code === 'Space') this.queue('dodge');
    if (event.code === 'KeyH') this.queue('heal');
    if (event.code === 'Escape') void this.exit();
  }

  @HostListener('document:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    this.keys.delete(event.code);
  }

  setCode(event: Event): void {
    this.codeInput.set((event.target as HTMLInputElement).value.toUpperCase());
  }

  create(): void {
    void this.client.create();
  }

  quickMatch(): void {
    void this.client.quickMatch();
  }

  join(): void {
    void this.client.join(this.codeInput());
  }

  async share(): Promise<void> {
    const code = this.snapshot().code;
    if (!code || !navigator.clipboard) return;
    await navigator.clipboard.writeText(`${window.location.origin}/?duel=${code}`);
    this.copied.set(true);
    window.setTimeout(() => this.copied.set(false), 1800);
  }

  async exit(): Promise<void> {
    await this.client.leave();
    this.gameState.returnToMainMenu();
  }

  press(action: DuelAction): void {
    this.queue(action);
  }

  move(event: PointerEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.touch = {
      x: clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1),
      z: clamp(1 - (event.clientY - rect.top) / rect.height * 2, -1, 1),
    };
  }

  releaseMove(): void {
    this.touch = { x: 0, z: 0 };
  }

  private queue(action: DuelAction): void {
    if (this.queued.length < 2) this.queued.push(action);
  }

  private vector(): Vector {
    let x = this.touch.x;
    let z = this.touch.z;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z -= 1;
    const magnitude = Math.hypot(x, z);
    if (magnitude > 1) return { x: x / magnitude, z: z / magnitude };
    return { x, z };
  }

  private publishInput(): void {
    if (!this.joined()) return;
    const move = this.vector();
    if (Math.hypot(move.x, move.z) > 0.12) this.lastYaw = Math.atan2(move.x, move.z);
    this.client.sendInput({
      moveX: move.x,
      moveZ: move.z,
      yaw: this.lastYaw,
      actions: this.queued.splice(0, 2),
    });
  }

  private async setup(): Promise<void> {
    const { World3D } = await import('../../lib/engine/world-3d');
    this.world = new World3D(this.viewport.nativeElement);
    this.loop();
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
    if (!this.world) return;
    const state = this.client.snapshot();
    const me = state.players[this.client.seat()];
    const opponent = state.players[this.client.seat() === 0 ? 1 : 0];
    const dt = 1 / 60;
    this.localSmooth.update(me, dt);
    this.remoteSmooth.update(opponent, dt);
    this.world.setRemotePose(opponent, !!opponent);
    this.world.render(
      this.environment.groundCanvas(),
      this.actor(this.localSmooth, me),
      null,
      false,
      null,
    );
  };

  private actor(smoothed: RemotePlayer, pose: DuelPose | null): Actor3D {
    const actor = smoothed.actor();
    return {
      ...actor,
      x: actor.x + WORLD.WIDTH / 2,
      y: actor.z + WORLD.HEIGHT / 2,
      hpRatio: pose ? pose.hp / DUEL_RULES.maxHp : undefined,
    };
  }
}
