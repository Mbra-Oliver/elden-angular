import {
  AfterViewInit, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewChild, inject, signal,
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

type Panel = 'codex' | 'settings' | null;

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
  readonly touch = isTouchDevice();

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
    // Le navigateur n'ouvre l'audio qu'après un geste : premier toucher ou touche.
    window.addEventListener('pointerdown', this.wakeAudio, { once: true });
    window.addEventListener('keydown', this.wakeAudio, { once: true });
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
    const root = (this.panel() ? document.querySelector('.menu-panel') : this.nav?.nativeElement) as HTMLElement | null;
    const buttons = [...(root?.querySelectorAll<HTMLElement>('button:not([disabled]), input') ?? [])];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    buttons[(next + buttons.length) % buttons.length].focus();
  }

  openPanel(panel: Panel) {
    this.panel.set(panel);
    queueMicrotask(() => document.querySelector<HTMLElement>('.menu-panel button, .menu-panel input')?.focus());
  }

  closePanel() {
    const was = this.panel();
    this.panel.set(null);
    this.openEntry.set(null);
    queueMicrotask(() => this.nav?.nativeElement
      .querySelector<HTMLButtonElement>(`[data-panel="${was}"]`)?.focus());
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

  /** Boss Rush : Kofi puis le Gardien, sans exploration (débloqué en finissant l'histoire). */
  bossRush() {
    if (!this.challenge.rushUnlocked()) return;
    this.depart(() => this.gameState.startBossRush(['ford', 'sluice']), false);
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
    window.setTimeout(go, 6000);
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
