import { Injectable, signal } from '@angular/core';

/**
 * Précharge et met en cache les images du jeu.
 *
 * - `load(manifest)` charge toutes les images en parallèle.
 * - Une image manquante n'interrompt PAS le chargement : elle est marquée
 *   absente, et `get()` renvoie `null` → les entités retombent sur un rendu
 *   en formes (fallback). On peut donc jouer avant d'avoir les vrais sprites.
 */
@Injectable({ providedIn: 'root' })
export class AssetLoaderService {
  private cache = new Map<string, HTMLImageElement>();

  // Progression de chargement (0 → 1), exposée pour l'écran "Loading…".
  readonly progress = signal(0);
  readonly ready = signal(false);

  /** Charge un ensemble d'images { clé: url }. Résout toujours (jamais reject). */
  async load(manifest: Record<string, string>): Promise<void> {
    this.ready.set(false);
    this.progress.set(0);

    const entries = Object.entries(manifest);
    if (entries.length === 0) {
      this.progress.set(1);
      this.ready.set(true);
      return;
    }

    let done = 0;
    await Promise.all(
      entries.map(([key, url]) =>
        this.loadOne(key, url).finally(() => {
          done++;
          this.progress.set(done / entries.length);
        }),
      ),
    );

    this.ready.set(true);
  }

  private loadOne(key: string, url: string): Promise<void> {
    if (this.cache.has(key)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.cache.set(key, img);
        resolve();
      };
      img.onerror = () => {
        // Asset absent : on ne bloque pas, fallback formes utilisé.
        console.warn(`[AssetLoader] Sprite introuvable: "${key}" (${url})`);
        resolve();
      };
      img.src = url;
    });
  }

  /** Renvoie l'image en cache, ou null si absente (→ fallback). */
  get(key: string): HTMLImageElement | null {
    return this.cache.get(key) ?? null;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }
}
