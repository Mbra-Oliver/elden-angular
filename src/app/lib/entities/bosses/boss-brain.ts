import { BOSS_CONFIG } from '../../constants/boss.config-constant';
import type { BossPhase } from '../../constants/boss-lore';
import type { BossAttackType } from '../../interfaces/BossAttackData';
import type { PlayerState } from '../../interfaces/PlayerData';

type Attack = Exclude<BossAttackType, 'none'>;

/**
 * Distance (centre à centre) d'où chaque attaque peut réellement toucher.
 * Le boss ne lance une attaque que dans cette fourchette : fini les coups
 * dans le vide déclenchés à 190 px. Les valeurs restent un peu en dessous
 * de la vraie portée (cf. checkBossAttack) pour qu'un joueur immobile soit
 * touché, et qu'un joueur qui recule pendant la préparation puisse s'en sortir.
 */
const S = BOSS_CONFIG.size;
export const ATTACK_REACH: Record<Attack, { min: number; max: number }> = {
  slash: { min: 0, max: S * 1.75 }, // touche jusqu'à ~137
  combo: { min: 0, max: S * 1.65 }, // ~143 + pas en avant à chaque coup
  slam: { min: 0, max: S * 1.35 }, // onde de rayon 112
  sweep: { min: 0, max: S * 1.0 }, // moulinet de rayon 86
  surge: { min: 0, max: S * 3.1 }, // anneau jusqu'à ~260
  tide: { min: 0, max: S * 3.1 },
  charge: { min: S * 1.5, max: S * 6.5 }, // il faut de l'élan, et rester dans l'arène
};

export function inReach(attack: Attack, distance: number) {
  const reach = ATTACK_REACH[attack];
  return distance >= reach.min && distance <= reach.max;
}

/** Plus court temps de préparation laissé au joueur, même enchaîné en phase 3 (ms). */
export const MIN_WINDUP = 340;

/** Pause tournoyante entre deux attaques, par phase (ms) : plus courte quand il s'énerve. */
const BREATHER: Record<BossPhase, [number, number]> = {
  1: [700, 1150],
  2: [450, 820],
  3: [260, 540],
};

/** Distance de garde pendant qu'il tourne autour du joueur. */
const STALK_RING = { duelist: 140, guardian: 165 };

export type BrainMode = 'approach' | 'stalk' | 'retreat';

/** Mouvement voulu par le cerveau pour cette frame (direction unitaire + vitesse relative). */
export interface Intent {
  dirX: number;
  dirY: number;
  speed: number;
  /** true : il est temps de lancer l'attaque prévue. */
  attack: boolean;
}

/**
 * Cerveau du boss pendant l'état « chase » : décide s'il s'approche pour
 * frapper, tourne autour du joueur en gardant ses distances, ou recule.
 * Aucun nouvel état d'animation : tout se joue en marche ('chase'), le
 * rig 3D anime déjà la marche à partir du déplacement.
 */
export class BossBrain {
  mode: BrainMode = 'approach';
  private timer = 0;
  /** Sens de rotation autour du joueur (+1 horaire, -1 anti-horaire). */
  private orbit = 1;
  private orbitFlip = 0;
  /** Temps passé à poursuivre sans atteindre la portée (anti-fuite). */
  pursuit = 0;
  /** Temps passé bloqué contre un obstacle. */
  stuck = 0;

  reset() {
    this.mode = 'approach';
    this.timer = 0;
    this.pursuit = 0;
    this.stuck = 0;
    this.orbit = Math.random() < 0.5 ? 1 : -1;
    this.orbitFlip = 0;
  }

  /** Souffle après une attaque : il tourne autour du joueur avant de revenir. */
  breathe(phase: BossPhase) {
    const [low, high] = BREATHER[phase];
    this.mode = 'stalk';
    this.timer = low + Math.random() * (high - low);
    this.orbit = Math.random() < 0.5 ? 1 : -1;
    this.orbitFlip = 500 + Math.random() * 700;
    this.pursuit = 0;
    this.stuck = 0;
  }

  /** Recul bref (après une riposte encaissée ou quand le joueur colle). */
  retreat(ms: number) {
    this.mode = 'retreat';
    this.timer = ms;
    this.stuck = 0;
  }

  /** Le joueur le frappe pendant qu'il tourne : il cesse d'attendre. */
  provoke() {
    if (this.mode === 'stalk') this.timer = Math.min(this.timer, 120);
  }

  /** Inverse le sens de rotation (mur, bord de l'arène). */
  flipOrbit() {
    this.orbit = -this.orbit;
    this.orbitFlip = 600 + Math.random() * 600;
  }

  /**
   * @param dx,dy vecteur boss → joueur
   * @param pending attaque prévue (portée à atteindre)
   */
  think(
    deltaMs: number,
    dx: number,
    dy: number,
    distance: number,
    pending: Attack,
    player: PlayerState,
    duelist: boolean,
  ): Intent {
    const len = distance || 1;
    const nx = dx / len;
    const ny = dy / len;

    if (this.mode === 'retreat') {
      this.timer -= deltaMs;
      if (this.timer <= 0) this.mode = 'stalk';
      return { dirX: -nx, dirY: -ny, speed: 1.15, attack: false };
    }

    if (this.mode === 'stalk') {
      this.timer -= deltaMs;
      // Ouvertures du joueur : il soigne, il est à bout de souffle, ou il
      // tire de loin. Le boss arrête d'attendre (la préparation reste normale).
      const opening = player === 'drinking' || player === 'exhausted' ||
        (player === 'shooting' && distance > 150);
      if (opening || this.timer <= 0) {
        this.mode = 'approach';
        this.pursuit = 0;
      } else {
        // Le joueur se colle à lui : il se dégage plutôt que de le laisser
        // frapper dans son dos.
        if (distance < 46) {
          this.retreat(320);
          return { dirX: -nx, dirY: -ny, speed: 1.15, attack: false };
        }
        this.orbitFlip -= deltaMs;
        if (this.orbitFlip <= 0) this.flipOrbit();
        const ring = duelist ? STALK_RING.duelist : STALK_RING.guardian;
        // Tangente (tourner) + correction radiale (garder la distance).
        const radial = Math.max(-1, Math.min(1, (distance - ring) / 60));
        const tx = -ny * this.orbit;
        const ty = nx * this.orbit;
        const mx = tx + nx * radial * 1.4;
        const my = ty + ny * radial * 1.4;
        const m = Math.hypot(mx, my) || 1;
        return { dirX: mx / m, dirY: my / m, speed: 0.42, attack: false };
      }
    }

    // Approche : rejoindre la portée exacte de l'attaque prévue.
    const reach = ATTACK_REACH[pending];
    if (distance < reach.min) {
      // Trop près pour prendre de l'élan (charge) : il recule d'abord.
      return { dirX: -nx, dirY: -ny, speed: 0.9, attack: false };
    }
    if (distance <= reach.max) return { dirX: nx, dirY: ny, speed: 0, attack: true };
    this.pursuit += deltaMs;
    // Ralentit en arrivant pour ne pas dépasser sa portée.
    const speed = distance - reach.max < 40 ? 0.7 : 1;
    return { dirX: nx, dirY: ny, speed, attack: false };
  }
}
