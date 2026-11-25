import type { AttackData } from '../interfaces/AttackData';

/**
 * Une attaque n'est pas « une animation qui fait mal » : le code découpe sa
 * durée en fenêtres précises, et la hitbox, le hitstop et l'animation lisent
 * toutes la même chronologie.
 *
 *   windup  : anticipation lisible par l'adversaire, aucune hitbox
 *   active  : frames actives, la hitbox est allumée (une seule touche)
 *   recover : récupération, punissable ; l'enchaînement s'ouvre à `chain`
 */
export type AttackSegment = 'windup' | 'active' | 'recover';

export interface AttackFrame {
  segment: AttackSegment;
  /** Avancement 0→1 dans le segment courant. */
  t: number;
  /** Hitbox allumée cette image. */
  hitbox: boolean;
  /** Un coup tamponné peut enchaîner dès maintenant. */
  canChain: boolean;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Où en est l'attaque, `elapsed` ms après son départ. */
export function attackFrame(attack: AttackData, elapsed: number): AttackFrame {
  const activeStart = attack.windup;
  const activeEnd = attack.windup + attack.active;
  const canChain = attack.chain !== undefined && elapsed >= attack.chain;
  if (elapsed < activeStart) {
    return { segment: 'windup', t: clamp01(elapsed / Math.max(1, attack.windup)), hitbox: false, canChain };
  }
  if (elapsed < activeEnd) {
    return { segment: 'active', t: clamp01((elapsed - activeStart) / Math.max(1, attack.active)), hitbox: true, canChain };
  }
  return {
    segment: 'recover',
    t: clamp01((elapsed - activeEnd) / Math.max(1, attack.duration - activeEnd)),
    hitbox: false,
    canChain,
  };
}

/** Événements d'animation émis au passage d'une frontière de segment. */
export type AttackEvent = 'windup-start' | 'active-start' | 'active-end' | 'end';

/**
 * Détecte les passages de segment d'une image à l'autre (sons de souffle,
 * traînée d'arme, VFX…) sans que chaque système refasse ses calculs.
 * `key` identifie une attaque (type + coup du combo) : une nouvelle clé
 * redémarre la chronologie même si l'attaque précédente n'était pas finie.
 */
export class AttackEventTracker {
  private key: string | null = null;
  private segment: AttackSegment | null = null;
  private readonly out: AttackEvent[] = [];

  update(key: string | null, frame: AttackFrame | null): readonly AttackEvent[] {
    this.out.length = 0;
    if (key === null || frame === null) {
      if (this.key !== null) this.out.push(...this.closing());
      this.key = null;
      this.segment = null;
      return this.out;
    }
    if (key !== this.key) {
      if (this.key !== null) this.out.push(...this.closing());
      this.key = key;
      this.segment = null;
      this.out.push('windup-start');
    }
    if (frame.segment !== this.segment) {
      if (frame.segment !== 'windup' && this.segment !== 'active' && this.segment !== 'recover') {
        this.out.push('active-start');
      }
      if (frame.segment === 'recover' && this.segment !== 'recover') this.out.push('active-end');
      this.segment = frame.segment;
    }
    return this.out;
  }

  private closing(): AttackEvent[] {
    if (this.segment === 'windup') return ['end'];
    if (this.segment === 'active') return ['active-end', 'end'];
    return ['end'];
  }
}
