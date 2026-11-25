import { Injectable, signal } from '@angular/core';

export type TrophyId = 'eternel' | 'premier-coup';

export interface Trophy {
  id: TrophyId;
  name: string;
  description: string;
}

/**
 * Trophées (succès) du jeu, gardés sur l'appareil (localStorage).
 * [SUPPOSITION] Le nom du second trophée est provisoire : la phrase de la
 * personne qui le décrivait a été coupée.
 */
export const TROPHIES: Record<TrophyId, Trophy> = {
  eternel: {
    id: 'eternel',
    name: 'L’Éternel',
    description: 'Finir le chapitre 1 sans jamais boire de Bandji.',
  },
  'premier-coup': {
    id: 'premier-coup',
    name: 'Du premier coup',
    description: 'Vaincre Badu Ofosu sans tomber une seule fois face à lui.',
  },
};

const STORAGE_KEY = 'trophees';

@Injectable({ providedIn: 'root' })
export class TrophyService {
  /** Trophées obtenus sur cet appareil. */
  readonly unlocked = signal<readonly TrophyId[]>(this.read());
  /** Trophée qui vient d'être obtenu (annonce à l'écran), null sinon. */
  readonly toast = signal<Trophy | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;
  /** Trophées obtenus en même temps : annoncés l'un après l'autre. */
  private readonly queue: Trophy[] = [];

  has(id: TrophyId) {
    return this.unlocked().includes(id);
  }

  /** Débloque un trophée ; renvoie vrai s'il est nouveau (et l'annonce). */
  unlock(id: TrophyId): boolean {
    if (this.has(id)) return false;
    const next = [...this.unlocked(), id];
    this.unlocked.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Stockage indisponible (navigation privée) : le trophée vaut pour la session.
    }
    this.queue.push(TROPHIES[id]);
    if (!this.toast()) this.next();
    return true;
  }

  private next() {
    const trophy = this.queue.shift() ?? null;
    this.toast.set(trophy);
    clearTimeout(this.toastTimer);
    if (trophy) this.toastTimer = setTimeout(() => this.next(), 5000);
  }

  private read(): TrophyId[] {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(raw) ? raw.filter((id): id is TrophyId => id in TROPHIES) : [];
    } catch {
      return [];
    }
  }
}
