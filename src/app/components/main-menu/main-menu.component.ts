import { Component, inject, signal } from '@angular/core';
import { AudioEngineService } from '../../lib/audio/audio-engine.service';
import { MusicDirectorService } from '../../lib/audio/music-director.service';
import { GameStateService } from '../../lib/services/game-state.service';
import { SliceService } from '../../lib/slice/slice.service';
import { BOSS_NAMES, Challenge, ChallengeService, describe, formatTime } from '../../lib/social/challenge.service';

@Component({
  selector: 'app-main-menu',
  templateUrl: './main-menu.component.html',
  styleUrl: './main-menu.component.css',
})
export class MainMenuComponent {
  private readonly gameState = inject(GameStateService);
  private readonly slice = inject(SliceService);
  private readonly audio = inject(AudioEngineService);
  private readonly music = inject(MusicDirectorService);
  readonly controlsOpen = signal(false);
  readonly challenge = inject(ChallengeService);
  readonly describe = describe;
  readonly formatTime = formatTime;
  readonly bossNames = BOSS_NAMES;

  /** Boss Rush : Kofi puis le Gardien, sans exploration (débloqué en finissant l'histoire). */
  bossRush() {
    if (!this.challenge.rushUnlocked()) return;
    this.audio.unlock();
    this.music.start();
    this.gameState.startBossRush(['ford', 'sluice']);
  }

  /** Relève le défi reçu par lien : on affronte directement ce boss. */
  acceptChallenge(challenge: Challenge) {
    this.challenge.accept(challenge);
    this.audio.unlock();
    this.music.start();
    this.gameState.startBossRush([challenge.boss], 'challenge');
  }

  start() {
    // Le navigateur n'autorise l'audio qu'après un geste : on l'ouvre sur ce clic.
    this.audio.unlock();
    this.music.start();
    // Nouvelle partie : progression de la tranche remise à zéro, accroche de 30 s.
    this.slice.newGame();
    this.gameState.souls.newGame();
    // Prologue de 1701 (Feyiase), puis l'acte I au gué du Pra.
    this.gameState.startPrologue();
  }

  /** Reprend au dernier foyer (cauris, tache, progression de la tranche). */
  readonly hasSave = this.gameState.souls.hasSave;

  continue() {
    this.audio.unlock();
    this.music.start();
    void this.gameState.continueGame();
  }
}
