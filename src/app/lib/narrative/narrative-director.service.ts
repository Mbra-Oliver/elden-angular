import { computed, inject, Injectable, signal } from '@angular/core';
import { MusicDirectorService } from '../audio/music-director.service';
import { GameLoopService } from '../services/game-loop.service';
import { STORY_BEATS, type StoryBeat, type StoryBeatId } from './story-beats';

const STORAGE_KEY = 'terre-rouge.story-beats.v1';
const HOLD_MS = 750;

@Injectable({ providedIn: 'root' })
export class NarrativeDirectorService {
  private readonly loop = inject(GameLoopService);
  private readonly music = inject(MusicDirectorService);
  private readonly played = signal<ReadonlySet<StoryBeatId>>(load());
  private startedAt = 0;
  private holdStartedAt = 0;
  private holding = false;
  onFinish?: (id: StoryBeatId, skipped: boolean) => void;

  readonly active = signal<StoryBeat | null>(null);
  readonly progress = signal(0);
  readonly holdProgress = signal(0);
  readonly blocking = computed(() => !!this.active()?.blocking);
  readonly maskingHud = computed(() => !!this.active()?.letterbox);

  play(id: StoryBeatId): boolean {
    const beat = STORY_BEATS[id];
    if (beat.once && this.played().has(id)) return false;
    this.active.set(beat);
    this.progress.set(0);
    this.holdProgress.set(0);
    this.startedAt = performance.now();
    this.holding = false;
    if (beat.slow) this.loop.slowMotion(beat.slow.scale, beat.slow.milliseconds);
    if (beat.sting) this.music.sting(beat.sting);
    return true;
  }

  mark(id: StoryBeatId) {
    if (this.played().has(id)) return;
    this.played.update((set) => new Set([...set, id]));
    save(this.played());
  }

  seen(id: StoryBeatId) {
    return this.played().has(id);
  }

  finish(skipped = false) {
    const beat = this.active();
    if (!beat) return;
    if (beat.once) this.mark(beat.id);
    this.onFinish?.(beat.id, skipped);
    this.active.set(null);
    this.progress.set(0);
    this.holdProgress.set(0);
    this.holding = false;
  }

  setHold(held: boolean) {
    const beat = this.active();
    if (!beat?.skippable) return;
    if (held && !this.holding) {
      this.holding = true;
      this.holdStartedAt = performance.now();
    } else if (!held && this.holding) {
      this.holding = false;
      this.holdProgress.set(0);
    }
  }

  tick(now = performance.now()) {
    const beat = this.active();
    if (!beat) return;
    const elapsed = now - this.startedAt;
    this.progress.set(Math.min(1, elapsed / beat.duration));
    if (this.holding) {
      const held = Math.min(1, (now - this.holdStartedAt) / HOLD_MS);
      this.holdProgress.set(held);
      if (held >= 1) {
        this.finish(true);
        return;
      }
    }
    if (elapsed >= beat.duration) this.finish();
  }
}

function load(): ReadonlySet<StoryBeatId> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[];
    return new Set(raw.filter((id): id is StoryBeatId => id in STORY_BEATS));
  } catch {
    return new Set();
  }
}

function save(ids: ReadonlySet<StoryBeatId>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    return;
  }
}
