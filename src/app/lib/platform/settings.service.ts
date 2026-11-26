import { Injectable, effect, inject, signal } from '@angular/core';
import { AudioEngineService } from '../audio/audio-engine.service';

export type GraphicsQuality = 'low' | 'medium' | 'high';
export type CameraMode = 'wide' | 'shoulder';
export type TouchAction = 'dodge' | 'attack' | 'heavy' | 'guard' | 'drink' | 'switch';

export const TOUCH_ACTIONS: Record<TouchAction, { label: string; glyph: string; key: string; combatOnly: boolean }> = {
  dodge: { label: 'Esquive / sprint', glyph: '↺', key: 'ShiftLeft', combatOnly: false },
  attack: { label: 'Frappe légère', glyph: '⟋', key: 'Space', combatOnly: false },
  heavy: { label: 'Frappe lourde / saut', glyph: '⟱', key: 'KeyE', combatOnly: true },
  guard: { label: 'Garder (maintenir)', glyph: '🛡', key: 'KeyG', combatOnly: true },
  drink: { label: 'Avaler la mixture', glyph: '🍃', key: 'KeyB', combatOnly: true },
  switch: { label: 'Changer d’arme', glyph: '⇄', key: 'KeyR', combatOnly: false },
};

export const TOUCH_ACTION_IDS = Object.keys(TOUCH_ACTIONS) as TouchAction[];
export const DEFAULT_TOUCH_SLOTS: TouchAction[] = ['dodge', 'attack', 'heavy', 'guard', 'drink', 'switch'];

export interface GameSettings {
  quality: GraphicsQuality;
  /** Volumes entre 0 et 1. */
  music: number;
  sfx: number;
  /** Sensibilité de la caméra (glisser à la souris ou au doigt), 0,4 à 2. */
  sensitivity: number;
  /** Verrouiller automatiquement l'ennemi le plus proche au premier coup reçu. */
  autoLock: boolean;
  /** Caméra large (soulslike) ou épaule rapprochée (TPS mobile). */
  cameraMode: CameraMode;
  /** Taille des contrôles tactiles (0.8 à 1.6). */
  touchScale: number;
  /** Taille du HUD (0.8 à 1.4). */
  hudScale: number;
  touchSlots: TouchAction[];
  /** Le joueur a explicitement choisi son mode caméra. */
  cameraChosen?: boolean;
}

const KEY = 'terre-rouge.settings.v1';

/** Téléphones et tablettes : qualité moyenne par défaut, sinon haute. */
const DEFAULTS: GameSettings = {
  quality: typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'medium' : 'high',
  // Musique en retrait des bruitages (retour joueur : trop forte à 0,55).
  music: 0.35,
  sfx: 0.9,
  sensitivity: 1,
  // Sur mobile, le verrouillage auto gêne la caméra tactile ; le joueur peut l'activer.
  autoLock: !(typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches),
  // Vue par-dessus l'épaule par défaut, sur ordinateur comme sur mobile (demande joueur).
  cameraMode: 'shoulder',
  touchScale: 1,
  hudScale: 1,
  touchSlots: [...DEFAULT_TOUCH_SLOTS],
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

  setTouchSlot(index: number, action: TouchAction) {
    if (index < 0 || index >= DEFAULT_TOUCH_SLOTS.length || !TOUCH_ACTION_IDS.includes(action)) return;
    const slots = [...this.settings().touchSlots];
    const previous = slots.indexOf(action);
    if (previous >= 0) slots[previous] = slots[index];
    slots[index] = action;
    this.update({ touchSlots: slots });
  }

  resetTouchSlots() {
    this.update({ touchSlots: [...DEFAULT_TOUCH_SLOTS] });
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
    // Caméra : l'ancien défaut « large » enregistré sans choix du joueur passe à l'épaule.
    if (raw && !raw.cameraChosen) delete raw.cameraMode;
    const settings: GameSettings = { ...DEFAULTS, ...(raw ?? {}) };
    settings.touchSlots = normalizeTouchSlots(raw?.touchSlots);
    return settings;
  } catch {
    return { ...DEFAULTS };
  }
}

function normalizeTouchSlots(value: unknown): TouchAction[] {
  if (!Array.isArray(value) || value.length !== DEFAULT_TOUCH_SLOTS.length) return [...DEFAULT_TOUCH_SLOTS];
  if (value.some((action) => !TOUCH_ACTION_IDS.includes(action as TouchAction))) return [...DEFAULT_TOUCH_SLOTS];
  if (new Set(value).size !== value.length) return [...DEFAULT_TOUCH_SLOTS];
  return value as TouchAction[];
}

function save(settings: GameSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* stockage indisponible */ }
}
