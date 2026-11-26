import {
  AfterViewInit, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewChild, computed, inject, isDevMode, signal,
} from '@angular/core';
import { AudioEngineService } from '../../lib/audio/audio-engine.service';
import { MenuAmbience } from '../../lib/audio/menu-ambience';
import { MusicDirectorService } from '../../lib/audio/music-director.service';
import type { MenuScene3D } from '../../lib/engine/menu-scene-3d';
import { CodexService } from '../../lib/platform/codex.service';
import { isTouchDevice } from '../../lib/platform/display';
import { GraphicsQuality, SettingsService } from '../../lib/platform/settings.service';
import { GameStateService } from '../../lib/services/game-state.service';
import { SliceService } from '../../lib/slice/slice.service';
import { BOSS_NAMES, Challenge, ChallengeService, describe, formatTime } from '../../lib/social/challenge.service';
import { THREAD_LINE } from '../../lib/constants/adinkra';
import { DEV_BOSS_RUSH, ENCOUNTERS, OFFICIAL_BOSS_RUSH, type EncounterId } from '../../lib/constants/boss-encounters';
import { BOSS_LORE } from '../../lib/constants/boss-lore';

type Panel = 'codex' | 'settings' | 'challenges' | null;

/** Combats singuliers proposés hors mode dev : les boss du récit, dans l'ordre. */
const STORY_FIGHTS: readonly EncounterId[] = ['champion', 'ford', 'sluice'];

@Component({
  selector: 'app-main-menu',
  templateUrl: './main-menu.component.html',
  styleUrl: './main-menu.component.css',
})
export class MainMenuComponent implements AfterViewInit, OnDestroy {
  @ViewChild('stage') stage!: ElementRef<HTMLElement>;
  @ViewChild('nav') nav?: ElementRef<HTMLElement>;

  private readonly gameState = inject(GameStateService);
  private readonly slice = inject(SliceService);
  private readonly audio = inject(AudioEngineService);
  private readonly music = inject(MusicDirectorService);
  private readonly zone = inject(NgZone);
  readonly settings = inject(SettingsService);
  readonly codex = inject(CodexService);
  readonly challenge = inject(ChallengeService);
  readonly describe = describe;
  readonly formatTime = formatTime;
  readonly bossNames = BOSS_NAMES;
  readonly threadLine = THREAD_LINE;
  readonly touch = isTouchDevice();
  readonly dev = isDevMode();
  readonly devBosses = DEV_BOSS_RUSH.map((id) => ({ id, name: ENCOUNTERS[id].name }));
  readonly rushNames = OFFICIAL_BOSS_RUSH.map((id) => ENCOUNTERS[id].name).join(' · ');
  /** Relu à chaque ouverture du panneau (les records sont en localStorage). */
  private readonly recordsTick = signal(0);
  /**
   * Un boss s'ouvre en combat singulier dès qu'il a été vaincu une fois
   * (un record existe), ou quand l'Épreuve des gardiens est débloquée.
   */
  readonly fights = computed(() => {
    this.recordsTick();
    const unlocked = this.challenge.rushUnlocked();
    return STORY_FIGHTS.map((id) => {
      const record = this.challenge.record(id);
      const encounter = ENCOUNTERS[id];
      return {
        id, record, name: encounter.name,
        epithet: BOSS_LORE[encounter.boss].epithet,
        open: unlocked || !!record,
      };
    });
  });

  readonly panel = signal<Panel>(null);
  /** Scène 3D prête (sinon l'illustration fixe reste en fond). */
  readonly live = signal(false);
  /** Départ lancé : les boutons s'estompent, la caméra avance. */
  readonly leaving = signal(false);
  /** Dernier voile noir avant de rendre la main au jeu. */
  readonly veil = signal(false);
  readonly openEntry = signal<string | null>(null);

  /** Reprend au dernier foyer (cauris, tache, progression de la tranche). */
  readonly hasSave = this.gameState.souls.hasSave;

  readonly qualities: { id: GraphicsQuality; label: string }[] = [
    { id: 'low', label: 'Basse' }, { id: 'medium', label: 'Moyenne' }, { id: 'high', label: 'Haute' },
  ];

  private scene?: MenuScene3D;
  private ambience: MenuAmbience | null = null;
  private destroyed = false;

  ngAfterViewInit() {
    void this.loadScene();
    if (this.dev && typeof location !== 'undefined') {
      const rush = new URLSearchParams(location.search).get('bossrush');
      if (rush === 'all') this.devBossRush();
      else if (rush && this.devBosses.some((boss) => boss.id === rush)) this.devBoss(rush as EncounterId);
    }
    // Le navigateur n'ouvre l'audio qu'après un geste : premier toucher ou touche.
    window.addEventListener('pointerdown', this.wakeAudio, { once: true });
    window.addEventListener('keydown', this.wakeAudio, { once: true });
    // Lien de défi reçu : on ouvre directement l'écran Challenges.
    if (this.challenge.incoming()) queueMicrotask(() => this.openPanel('challenges'));
    // Focus sur le premier bouton : le menu se joue au clavier dès l'ouverture.
    queueMicrotask(() => this.nav?.nativeElement.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }));
  }

  ngOnDestroy() {
    this.destroyed = true;
    window.removeEventListener('pointerdown', this.wakeAudio);
    window.removeEventListener('keydown', this.wakeAudio);
    this.ambience?.stop(0.4);
    this.scene?.dispose();
  }

  private async loadScene() {
    try {
      const { MenuScene3D } = await import('../../lib/engine/menu-scene-3d');
      if (this.destroyed) return;
      this.zone.runOutsideAngular(() => { this.scene = new MenuScene3D(this.stage.nativeElement); });
      this.live.set(true);
    } catch (error) {
      console.warn('Scène du menu indisponible, illustration fixe utilisée.', error);
    }
  }

  private readonly wakeAudio = () => {
    if (this.ambience || this.destroyed || this.leaving()) return;
    this.ambience = MenuAmbience.start(this.audio);
  };

  // ------------------------------------------------------------- NAVIGATION

  @HostListener('window:keydown', ['$event'])
  onKey(event: KeyboardEvent) {
    if (this.leaving()) return;
    if (event.key === 'Escape' && this.panel()) {
      event.preventDefault();
      this.closePanel();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...(this.panel()
      ? document.querySelector('.menu-panel')?.querySelectorAll<HTMLElement>('button:not([disabled]), input') ?? []
      : this.stage.nativeElement.querySelectorAll<HTMLElement>('.title-content nav button'))];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    buttons[(next + buttons.length) % buttons.length].focus();
  }

  openDuel() {
    this.audio.unlock();
    this.gameState.openDuel();
  }

  openPanel(panel: Panel) {
    if (panel === 'challenges') this.recordsTick.update((n) => n + 1);
    this.panel.set(panel);
    queueMicrotask(() => document.querySelector<HTMLElement>('.menu-panel button, .menu-panel input')?.focus());
  }

  closePanel() {
    const was = this.panel();
    this.panel.set(null);
    this.openEntry.set(null);
    queueMicrotask(() => this.stage.nativeElement
      .querySelector<HTMLButtonElement>(`nav [data-panel="${was}"]`)?.focus());
  }

  setQuality(quality: GraphicsQuality) {
    this.settings.update({ quality });
    window.dispatchEvent(new Event('resize'));
  }

  setVolume(kind: 'music' | 'sfx', event: Event) {
    this.settings.update({ [kind]: Number((event.target as HTMLInputElement).value) / 100 });
  }

  setSensitivity(event: Event) {
    this.settings.update({ sensitivity: Number((event.target as HTMLInputElement).value) / 100 });
  }

  // --------------------------------------------------------------- DÉPARTS

  /** Nouvelle lignée : travelling de l'afena vers Kwadwo, puis le prologue de 1701. */
  newLineage() {
    this.gameState.narrative.mark('opening');
    this.depart(() => {
      // Nouvelle partie : progression de la tranche remise à zéro.
      this.slice.newGame();
      this.gameState.souls.newGame();
      this.gameState.startPrologue();
    });
  }

  continue() {
    this.depart(() => void this.gameState.continueGame());
  }

  /** Challenges, Épreuve des gardiens : Kofi puis le Gardien, sans exploration (débloquée en finissant l'histoire). */
  bossRush() {
    if (!this.challenge.rushUnlocked()) return;
    this.depart(() => this.gameState.startBossRush([...OFFICIAL_BOSS_RUSH]), false);
  }

  /** Challenges, combat singulier : un seul boss, chronométré, record à battre. */
  singleFight(id: EncounterId) {
    if (!this.fights().find((fight) => fight.id === id)?.open) return;
    this.depart(() => this.gameState.startBossRush([id]), false);
  }

  devBossRush() {
    this.depart(() => this.gameState.startBossRush([...DEV_BOSS_RUSH]), false);
  }

  devBoss(id: EncounterId) {
    this.depart(() => this.gameState.startBossRush([id]), false);
  }

  /** Relève le défi reçu par lien : on affronte directement ce boss. */
  acceptChallenge(challenge: Challenge) {
    this.challenge.accept(challenge);
    this.depart(() => this.gameState.startBossRush([challenge.boss], 'challenge'), false);
  }

  private depart(launch: () => void, travelling = true) {
    if (this.leaving()) return;
    this.leaving.set(true);
    this.panel.set(null);
    this.audio.unlock();
    // Le moteur du jeu se charge pendant le travelling : pas d'écran de chargement sec.
    void import('../../lib/engine/world-3d');
    void import('phaser/dist/phaser.esm.js');
    this.ambience?.stop(2.4);
    let gone = false;
    const go = () => this.zone.run(() => {
      if (gone) return;
      gone = true;
      this.veil.set(true);
      window.setTimeout(() => {
        this.music.start();
        launch();
      }, 380);
    });
    // Filet : si les images s'arrêtent (onglet en arrière-plan), on part quand même.
    window.setTimeout(go, 10500);
    if (travelling && this.scene) this.scene.travelToKwadwo(go);
    else window.setTimeout(go, 450);
    if (this.touch) enterImmersive();
  }
}

/**
 * Téléphone : plein écran et paysage verrouillé quand le navigateur le permet
 * (PWA installée : le manifeste le fait déjà).
 */
function enterImmersive() {
  // Refus possible (iOS Safari, navigateur intégré) : le jeu continue en fenêtre.
  const lock = () => {
    try {
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      void orientation?.lock?.('landscape')?.catch(() => undefined);
    } catch { /* verrouillage indisponible */ }
  };
  try {
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) {
      void Promise.resolve(root.requestFullscreen({ navigationUI: 'hide' })).then(lock, () => undefined);
    } else {
      lock();
    }
  } catch { /* plein écran refusé */ }
}
