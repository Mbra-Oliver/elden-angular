import { inject, Injectable } from '@angular/core';
import { BossStore } from '../entities/bosses/boss.store';
import { PlayerStore } from '../entities/player/player.store';
import { AudioEngineService } from './audio-engine.service';
import { Instruments } from './instruments';
import { MusicTrack } from './music-track';
import { loadStem } from './stem-loader';
import { playSting, StingId, THEMES, ThemeId } from './themes';

/**
 * Zones musicales. Une zone d'exploration a un thème calme ; une zone de boss
 * a un thème en trois couches qui suivent la phase du boss.
 */
export type MusicZone = 'silence' | 'village' | 'river' | 'depths' | 'dawn' | 'duel-ford' | 'duel-sluice';

export const ZONE_THEMES: Record<MusicZone, ThemeId | null> = {
  silence: null,
  village: 'village',
  river: 'river',
  depths: 'depths',
  dawn: 'dawn',
  'duel-ford': 'boss-duelist',
  'duel-sluice': 'boss-guardian',
};

/** Ce que le jeu dit à la musique, lu à chaque tick. */
export interface MusicCue {
  zone: MusicZone;
  /** Position du joueur et de la prochaine arène, pour le préchargement. */
  player?: { x: number; y: number };
  nextArena?: { x: number; y: number; zone: MusicZone };
  /** Jeu en pause : musique étouffée comme dans l'inventaire. */
  paused?: boolean;
  /** Le joueur vient de mourir : motif funèbre en coupant la musique. */
  defeated?: boolean;
}

export const CROSSFADE_SECONDS = 3;
/** Sous ce ratio de PV, la musique est étouffée et un cœur bat. */
export const LOW_HP_RATIO = 0.15;
/** Distance à l'arène (unités du monde) où le thème du boss est préparé. */
export const PRELOAD_DISTANCE = 520;

const LOOKAHEAD_SECONDS = 0.14;
const TICK_MS = 25;

/**
 * Chef d'orchestre : choisit le thème de la zone, fond les zones en 3 s,
 * ouvre les couches aux changements de phase du boss, étouffe la musique dans
 * l'inventaire et sous 15 % de PV.
 *
 * Le jeu lui fournit sa situation via `setCueSource()` (lu toutes les 25 ms) ;
 * l'inventaire appelle `setInventoryOpen()`, une entrée de boss `sting()`.
 */
@Injectable({ providedIn: 'root' })
export class MusicDirectorService {
  private readonly engine = inject(AudioEngineService);
  private readonly bossStore = inject(BossStore);
  private readonly playerStore = inject(PlayerStore);

  private inst: Instruments | null = null;
  private current: MusicTrack | null = null;
  private zone: MusicZone = 'silence';
  private phase: 1 | 2 | 3 = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cueSource: (() => MusicCue) | null = null;
  private inventoryOpen = false;
  private muffled = -1;
  private nextHeartbeat = 0;
  private readonly prepared = new Set<ThemeId>();
  private readonly recordings = new Map<string, AudioBuffer>();

  /** Démarre la musique. À appeler juste après `AudioEngineService.unlock()`. */
  start() {
    const ac = this.engine.context;
    const noise = this.engine.noiseBuffer();
    if (!ac || !noise) return;
    this.inst ??= new Instruments(ac, noise);
    // Les thèmes non paresseux sont prêts dès le départ.
    for (const theme of Object.values(THEMES)) if (!theme.lazy) this.prepare(theme.id);
    if (this.timer === null) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.current?.stop(1);
    this.current = null;
    this.zone = 'silence';
  }

  /** Fonction qui décrit la situation du jeu (zone, position, prochaine arène). */
  setCueSource(source: (() => MusicCue) | null) {
    this.cueSource = source;
  }

  setInventoryOpen(open: boolean) {
    this.inventoryOpen = open;
  }

  /**
   * Charge un thème avant qu'il ne joue : cordes pincées pré-calculées et,
   * s'il en a, stems enregistrés (OGG/Opus, repli MP3). Sans effet s'il est
   * déjà prêt.
   */
  prepare(id: ThemeId) {
    const ac = this.engine.context;
    if (!ac || !this.inst || this.prepared.has(id)) return;
    this.prepared.add(id);
    const theme = THEMES[id];
    this.inst.preparePlucks(theme.plucks.notes, theme.plucks.sustain);
    for (const stem of theme.stems) {
      const file = stem.file;
      if (!file) continue;
      void loadStem(ac, file).then((buffer) => {
        if (buffer) this.recordings.set(file, buffer);
      });
    }
  }

  isPrepared(id: ThemeId) {
    return this.prepared.has(id);
  }

  /** Motif court par-dessus la musique (entrée de boss, changement de phase, mort). */
  sting(id: StingId) {
    const ac = this.engine.context;
    const bus = this.engine.bus('music');
    if (!ac || !bus || !this.inst) return;
    playSting(id, this.inst, bus, ac.currentTime + 0.02);
  }

  /** Thème qui joue (pour le débogage et les tests). */
  get playing(): ThemeId | null {
    return this.current?.spec.id ?? null;
  }

  private tick() {
    const ac = this.engine.context;
    const musicBus = this.engine.bus('music');
    if (!ac || !musicBus || !this.inst || ac.state !== 'running') return;
    const cue = this.cueSource?.() ?? { zone: 'silence' as MusicZone };

    this.preloadNearArena(cue);
    if (cue.zone !== this.zone) {
      if (cue.defeated && cue.zone === 'silence') this.sting('death');
      this.enterZone(cue.zone, ac, musicBus);
    }
    this.followBossPhase();
    this.updateMuffle(ac, cue);
    this.current?.schedule(ac.currentTime + LOOKAHEAD_SECONDS);
  }

  private enterZone(zone: MusicZone, ac: AudioContext, musicBus: AudioNode) {
    const previous = this.zone;
    this.zone = zone;
    const themeId = ZONE_THEMES[zone];
    this.current?.stop(CROSSFADE_SECONDS);
    this.current = null;
    if (!themeId || !this.inst) return;

    this.prepare(themeId);
    const boss = themeId.startsWith('boss-');
    this.phase = boss ? this.bossStore.getData().phase : 1;
    const track = new MusicTrack(THEMES[themeId], ac, this.inst, musicBus, this.engine.bus('ambience'),
      ac.currentTime + 0.05, this.phase, this.recordings);
    // Entrée de boss : on coupe plus net que le fondu d'exploration.
    track.fade(1, boss && previous !== 'silence' ? 1.2 : CROSSFADE_SECONDS);
    this.current = track;
  }

  private followBossPhase() {
    if (!this.current?.spec.id.startsWith('boss-')) return;
    const phase = this.bossStore.getData().phase;
    if (phase === this.phase) return;
    if (phase > this.phase) this.sting('phase');
    this.phase = phase;
    this.current.setPhase(phase);
  }

  private preloadNearArena(cue: MusicCue) {
    const arena = cue.nextArena;
    const themeId = arena ? ZONE_THEMES[arena.zone] : null;
    if (!arena || !cue.player || !themeId || this.prepared.has(themeId)) return;
    if (Math.hypot(arena.x - cue.player.x, arena.y - cue.player.y) < PRELOAD_DISTANCE) this.prepare(themeId);
  }

  private updateMuffle(ac: AudioContext, cue: MusicCue) {
    const zone = cue.zone;
    const player = this.playerStore.getData();
    const alive = player.hp > 0 && player.maxHp > 0;
    const lowHp = zone !== 'silence' && alive && player.hp / player.maxHp < LOW_HP_RATIO;
    const amount = this.inventoryOpen || cue.paused ? 0.92 : lowHp ? 0.72 : 0;
    // Seulement quand la cible change : chaque appel ajoute un évènement d'automation.
    if (amount !== this.muffled) {
      this.engine.muffle(amount);
      this.muffled = amount;
    }
    if (lowHp && !this.inventoryOpen && ac.currentTime >= this.nextHeartbeat) this.heartbeat(ac);
  }

  /** Battement de cœur sourd, hors filtre (bus ui) pour rester lisible. */
  private heartbeat(ac: AudioContext) {
    const bus = this.engine.bus('ui');
    if (!bus || !this.inst) return;
    const t = Math.max(ac.currentTime + 0.02, this.nextHeartbeat);
    this.inst.talkingDrum(bus, t, 48, { level: 0.35, decay: 0.22, from: 1.3, to: 1, glide: 0.05, click: 0 });
    this.inst.talkingDrum(bus, t + 0.24, 44, { level: 0.24, decay: 0.26, from: 1.3, to: 1, glide: 0.05, click: 0 });
    this.nextHeartbeat = t + 0.92;
  }
}
