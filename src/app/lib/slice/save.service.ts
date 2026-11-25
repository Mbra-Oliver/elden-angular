import { Injectable } from '@angular/core';
import type { WeaponId } from '../constants/equipment.config-constant';
import type { StatId } from './slice-content';
import type { ItemId, RestId } from './slice-map';

export interface SaveData {
  version: 1;
  savedAt: number;
  /** Étape de l'Acte II (0 Kouamé, 1 Aya, 2 Yao et la digue). */
  visited: number;
  restPoint: RestId;
  stats: Record<StatId, number>;
  flags: string[];
  items: ItemId[];
  owned: WeaponId[];
  weapon: WeaponId;
}

const DB = 'terre-rouge';
const STORE = 'saves';
const SLOT = 'slice';

/**
 * Sauvegarde automatique dans IndexedDB (un seul emplacement).
 * Écrite aux points de repos, aux ramassages, au levier et aux portes.
 * Si IndexedDB est indisponible (navigation privée stricte), le jeu continue
 * sans sauvegarde.
 */
@Injectable({ providedIn: 'root' })
export class SaveService {
  private db: Promise<IDBDatabase | null> | null = null;

  private open(): Promise<IDBDatabase | null> {
    if (this.db) return this.db;
    this.db = new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return this.db;
  }

  async save(data: SaveData): Promise<boolean> {
    const db = await this.open();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, SLOT);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  async load(): Promise<SaveData | null> {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(SLOT);
      request.onsuccess = () => {
        const data = request.result as SaveData | undefined;
        resolve(data?.version === 1 ? data : null);
      };
      request.onerror = () => resolve(null);
    });
  }

  /** Stockage clé → valeur générique (autres systèmes : boucle soulslike…). */
  async put(key: string, value: unknown): Promise<boolean> {
    const db = await this.open();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  }

  async clear(): Promise<void> {
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(SLOT);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}
