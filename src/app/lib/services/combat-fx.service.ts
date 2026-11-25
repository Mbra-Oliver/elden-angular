import { inject, Injectable } from '@angular/core';
import { AudioEngineService } from '../audio/audio-engine.service';
import { CombatSfx, type ImpactMaterial, type StrikeStyle } from '../audio/combat-sfx';

export type { ImpactMaterial, StrikeStyle };

/**
 * Événements visuels de combat, consommés par la vue 3D (CombatFx3D).
 * Coordonnées du plan de jeu : x, y (= z en 3D).
 */
export type FxEvent =
  | { type: 'hit'; x: number; y: number; height: number; dirX: number; dirY: number;
      material: ImpactMaterial; style: StrikeStyle; strength: number; target: 'boss' | 'player' }
  | { type: 'dust'; x: number; y: number; dirX: number; dirY: number; amount: number }
  | { type: 'decal'; x: number; y: number; radius: number; kind: 'crack' | 'scorch' | 'wet' }
  | { type: 'flash'; x: number; y: number; height: number; color: string; intensity: number; duration: number }
  | { type: 'shake'; axis: 'horizontal' | 'vertical'; strength: number };

const MAX_QUEUE = 48;

/**
 * Point d'entrée unique du « game feel » : la logique de jeu signale ce qui
 * se passe (un coup porte, une roulade, une esquive parfaite…) et ce service
 * déclenche le son tout de suite et met en file l'effet visuel pour la
 * prochaine image 3D. Sans vue 3D (repli 2D), la file est simplement bornée.
 */
@Injectable({ providedIn: 'root' })
export class CombatFxService {
  private readonly audio = inject(AudioEngineService);
  private readonly queue: FxEvent[] = [];
  readonly sfx = new CombatSfx(() => {
    const context = this.audio.context;
    const destination = this.audio.bus('sfx');
    return context && destination ? { context, destination } : null;
  });

  /** Coup qui porte : étincelles / sang, flash, secousse et son superposé. */
  hit(event: Omit<Extract<FxEvent, { type: 'hit' }>, 'type'>) {
    this.push({ type: 'hit', ...event });
    // Taille / balayage : secousse horizontale. Estoc et coup écrasé : verticale.
    this.push({ type: 'shake', axis: event.style === 'slash' ? 'horizontal' : 'vertical',
      strength: event.strength * (event.material === 'guard' ? 0.55 : 1) });
    this.sfx.hit(event.material, event.style, event.strength);
  }

  swing(heavy: boolean) { this.sfx.swing(heavy); }

  dust(x: number, y: number, dirX: number, dirY: number, amount = 1, sound = true) {
    this.push({ type: 'dust', x, y, dirX, dirY, amount });
    if (sound) this.sfx.roll();
  }

  /** Esquive parfaite ou riposte : éclair de lumière bref + tintement. */
  parry(x: number, y: number, color = '#bff8ff') {
    this.push({ type: 'flash', x, y, height: 22, color, intensity: 5, duration: 0.14 });
    this.push({ type: 'shake', axis: 'horizontal', strength: 0.5 });
    this.sfx.parry();
  }

  /** Attaque lourde au sol : trace qui s'efface, secousse verticale, grondement. */
  quake(x: number, y: number, radius: number, kind: 'crack' | 'scorch' | 'wet', strength = 1) {
    this.push({ type: 'decal', x, y, radius, kind });
    this.push({ type: 'shake', axis: 'vertical', strength: 1.4 * strength });
    this.sfx.quake(strength);
  }

  /** Trace au sol seule (sans son ni secousse). */
  mark(x: number, y: number, radius: number, kind: 'crack' | 'scorch' | 'wet') {
    this.push({ type: 'decal', x, y, radius, kind });
  }

  flash(x: number, y: number, color: string, intensity = 4, duration = 0.12, height = 24) {
    this.push({ type: 'flash', x, y, height, color, intensity, duration });
  }

  shake(axis: 'horizontal' | 'vertical', strength: number) {
    this.push({ type: 'shake', axis, strength });
  }

  /** Vide la file (appelé une fois par image par la vue 3D). */
  drain(handle: (event: FxEvent) => void) {
    for (const event of this.queue) handle(event);
    this.queue.length = 0;
  }

  reset() { this.queue.length = 0; }

  private push(event: FxEvent) {
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push(event);
  }
}
