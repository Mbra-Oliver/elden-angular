import { Injectable, effect, inject, signal } from '@angular/core';
import { AudioEngineService } from '../audio/audio-engine.service';

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface GameSettings {
  quality: GraphicsQuality;
  /** Volumes entre 0 et 1. */
  music: number;
  sfx: number;
  /** Sensibilité de la caméra (glisser à la souris ou au doigt), 0,4 à 2. */
  sensitivity: number;
  /** Verrouiller automatiquement l'ennemi le plus proche au premier coup reçu. */
  autoLock: boolean;
}

const KEY = 'terre-rouge.settings.v1';

/** Téléphones et tablettes : qualité moyenne par défaut, sinon haute. */
const DEFAULTS: GameSettings = {
  quality: typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'medium' : 'high',
  // Musique en retrait des bruitages (retour joueur : trop forte à 0,55).
  music: 0.35,
  sfx: 0.9,
  sensitivity: 1,
  autoLock: true,
};

/** Échelle de rendu par qualité, appliquée sous le plafond de densité (display.ts). */
export const QUALITY_SCALE: Record<GraphicsQuality, number> = { low: 0.6, medium: 0.8, high: 1 };

/**
 * Paramètres du joueur (menu principal et pause), gardés dans le localStorage.
 * Les volumes sont poussés vers les bus audio ; la qualité et la sensibilité
 * sont lues par le rendu 3D (World3D, scène du menu).
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly audio = inject(AudioEngineService);
  readonly settings = signal<GameSettings>(load());

  constructor() {
    effect(() => {
      const s = this.settings();
      save(s);
      this.audio.setVolume('music', s.music);
      // Ambiance et bruitages suivent le même réglage « bruitages ».
      this.audio.setVolume('sfx', s.sfx);
      this.audio.setVolume('ambience', s.sfx * 0.55);
    });
  }

  update(patch: Partial<GameSettings>) {
    this.settings.update((s) => ({ ...s, ...patch }));
  }
}

/** Lecture directe hors injection (moteur 3D chargé à la demande). */
export function currentSettings(): GameSettings {
  return load();
}

function load(): GameSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<GameSettings> | null;
    // Ancien défaut enregistré sans que le joueur l'ait choisi : on applique le nouveau.
    if (raw?.music === 0.55) delete raw.music;
    return { ...DEFAULTS, ...(raw ?? {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings: GameSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* stockage indisponible */ }
}
