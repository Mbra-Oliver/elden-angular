import { ENEMIES, ENEMY_MOVES, type EnemyMoveId } from './slice-content';
import type { EnemyKind } from './slice-map';

/** Ce que le verrouillage lit d'un ennemi de terrain (sous-ensemble de Enemy). */
export interface LockEnemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  state: string;
  engaged: boolean;
  move: EnemyMoveId | null;
  aimX: number;
  aimY: number;
}

/** Position du joueur et cap de la caméra (voir World3D.heading). */
export interface LockView {
  px: number;
  py: number;
  heading: number;
}

/**
 * [SUPPOSITION] Réglages du verrouillage, premières valeurs à régler en jeu.
 * Distances en px du monde, temps en secondes.
 */
export const LOCK_TUNING = {
  /** Portée de prise de cible au bouton. */
  acquireRange: 340,
  /** Portée élargie pour un ennemi qui attaque ou vient de frapper. */
  threatRange: 460,
  /** Au-delà, la cible est perdue (après la tolérance ci-dessous). */
  dropRange: 470,
  /** Temps hors de portée toléré avant de lâcher ou de changer (évite le clignotement en limite). */
  dropGrace: 0.4,
  /** Coût d'un radian d'écart avec la caméra (un ennemi dans le dos ≈ +350 px). */
  angleCost: 110,
  /** Bonus d'un ennemi engagé, d'un ennemi qui attaque, de celui qui vient de frapper. */
  engagedBonus: 60,
  attackBonus: 320,
  hitBonus: 380,
  /** Un coup reçu reste « récent » ce temps. */
  hitMemory: 0.6,
  /** Menace au corps à corps qui justifie un changement automatique. */
  meleeThreat: 120,
  /** Délai minimal entre deux changements automatiques, et après un choix manuel. */
  autoCooldown: 1.0,
  manualCooldown: 1.6,
} as const;

const angleTo = (e: LockEnemy, view: LockView) => {
  const angle = Math.atan2(e.x - view.px, e.y - view.py) - view.heading;
  return Math.atan2(Math.sin(angle), Math.cos(angle));
};
const distanceTo = (e: LockEnemy, view: LockView) => Math.hypot(e.x - view.px, e.y - view.py);

/**
 * L'ennemi prépare ou porte un coup qui vise le joueur : estoc ou taille à
 * portée, ou mousquet pointé sur lui.
 */
export function isThreatening(e: LockEnemy, view: LockView): boolean {
  if (e.state !== 'windup' && e.state !== 'active') return false;
  if (!e.move) return false;
  const move = ENEMY_MOVES[e.move];
  const d = distanceTo(e, view);
  if (move.shape === 'shot') {
    if (d < 1 || d > move.reach + 40) return false;
    return ((view.px - e.x) * e.aimX + (view.py - e.y) * e.aimY) / d > 0.94;
  }
  return d < ENEMIES[e.kind].radius + move.reach + 70;
}

/**
 * Verrouillage de cible hors duel. Il choisit la menace la plus pressante
 * plutôt que le seul ennemi en face de la caméra, retient qui vient de
 * frapper, passe tout seul à la cible suivante quand la sienne tombe ou
 * s'éloigne, et se tourne vers un ennemi qui attaque dans le dos si la cible
 * actuelle ne fait rien. Un temps de repos évite qu'il saute d'une cible à
 * l'autre, et un choix manuel est respecté un moment.
 */
export class TargetLock {
  /** Ennemi verrouillé, null : caméra libre. */
  id: number | null = null;
  private lastHitBy: number | null = null;
  private hitAge = Infinity;
  private outside = 0;
  private cooldown = 0;

  /** Note l'auteur d'un coup reçu (même sans verrou : il servira au verrouillage automatique). */
  noteHit(enemyId: number) {
    this.lastHitBy = enemyId;
    this.hitAge = 0;
  }

  release() {
    this.id = null;
    this.outside = 0;
  }

  /** Score de priorité : plus il est bas, plus l'ennemi mérite d'être cadré. */
  score(e: LockEnemy, view: LockView): number {
    let score = distanceTo(e, view) + Math.abs(angleTo(e, view)) * LOCK_TUNING.angleCost;
    if (e.engaged) score -= LOCK_TUNING.engagedBonus;
    if (isThreatening(e, view)) score -= LOCK_TUNING.attackBonus;
    if (this.recentHitter(e.id)) score -= LOCK_TUNING.hitBonus;
    return score;
  }

  /** Meilleure cible disponible, ou null. `engagedOnly` : pas d'ennemi encore endormi. */
  best(enemies: readonly LockEnemy[], view: LockView, engagedOnly = false, exclude: number | null = null) {
    let best: LockEnemy | null = null;
    let bestScore = Infinity;
    for (const e of enemies) {
      if (e.state === 'dead' || e.id === exclude) continue;
      if (engagedOnly && !e.engaged) continue;
      const d = distanceTo(e, view);
      const urgent = isThreatening(e, view) || this.recentHitter(e.id);
      if (d > (urgent ? LOCK_TUNING.threatRange : LOCK_TUNING.acquireRange)) continue;
      const score = this.score(e, view);
      if (score < bestScore) { best = e; bestScore = score; }
    }
    return best;
  }

  /** Bouton de verrouillage : prend la meilleure cible. Renvoie false s'il n'y a personne. */
  acquire(enemies: readonly LockEnemy[], view: LockView): boolean {
    const target = this.best(enemies, view);
    if (!target) return false;
    this.id = target.id;
    this.outside = 0;
    this.cooldown = LOCK_TUNING.manualCooldown;
    return true;
  }

  /** Verrouillage automatique au coup reçu : l'agresseur d'abord, sinon la meilleure menace. */
  acquireAttacker(enemies: readonly LockEnemy[], view: LockView): boolean {
    const hitter = this.lastHitBy !== null && this.recentHitter(this.lastHitBy)
      ? enemies.find((e) => e.id === this.lastHitBy && e.state !== 'dead') : undefined;
    if (hitter && distanceTo(hitter, view) < LOCK_TUNING.threatRange) {
      this.id = hitter.id;
      this.outside = 0;
      this.cooldown = LOCK_TUNING.autoCooldown;
      return true;
    }
    return this.acquire(enemies, view);
  }

  /** Cible voisine à l'écran : 1 à droite, -1 à gauche, avec retour au bout de la file. */
  cycle(direction: number, enemies: readonly LockEnemy[], view: LockView) {
    const current = enemies.find((e) => e.id === this.id);
    if (!current) return;
    const from = angleTo(current, view);
    const others = enemies
      .filter((e) => e.id !== current.id && e.state !== 'dead' && distanceTo(e, view) < LOCK_TUNING.dropRange - 40)
      // À l'écran, la droite correspond à un angle plus petit (voir World3D.heading).
      .map((e) => ({ e, offset: -direction * Math.atan2(Math.sin(angleTo(e, view) - from), Math.cos(angleTo(e, view) - from)) }));
    if (!others.length) return;
    const ahead = others.filter((o) => o.offset > 0.02).sort((a, b) => a.offset - b.offset);
    // Rien de ce côté : on repart de l'autre bout (le plus éloigné dans l'autre sens).
    const next = ahead[0] ?? others.sort((a, b) => a.offset - b.offset)[0];
    this.id = next.e.id;
    this.outside = 0;
    this.cooldown = LOCK_TUNING.manualCooldown;
  }

  /**
   * Avance d'une image : renvoie l'ennemi cadré (ou null). Gère la mort de
   * la cible, la sortie de portée et les changements automatiques.
   */
  update<E extends LockEnemy>(dt: number, enemies: readonly E[], view: LockView): E | null {
    this.hitAge += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.id === null) return null;
    let current = enemies.find((e) => e.id === this.id);

    // Cible tombée : on passe à la menace suivante encore au combat, sans lâcher la caméra.
    if (!current || current.state === 'dead') {
      return this.retarget(enemies, view, current?.id ?? null);
    }

    // Trop loin : un court délai, puis la cible suivante ou caméra libre.
    if (distanceTo(current, view) > LOCK_TUNING.dropRange) {
      this.outside += dt;
      if (this.outside > LOCK_TUNING.dropGrace) return this.retarget(enemies, view, current.id);
    } else {
      this.outside = 0;
    }

    // Changement automatique : seulement si la cible actuelle ne menace pas.
    if (this.cooldown <= 0 && !isThreatening(current, view)) {
      const threat = this.pressingThreat(enemies, view, current);
      if (threat) {
        this.id = threat.id;
        this.cooldown = LOCK_TUNING.autoCooldown;
        current = threat;
      }
    }
    return current;
  }

  private retarget<E extends LockEnemy>(enemies: readonly E[], view: LockView, exclude: number | null): E | null {
    const next = this.best(enemies, view, true, exclude) as E | null;
    this.outside = 0;
    if (!next) {
      this.id = null;
      return null;
    }
    this.id = next.id;
    this.cooldown = LOCK_TUNING.autoCooldown;
    return next;
  }

  /**
   * Un autre ennemi presse le joueur pendant que la cible ne fait rien :
   * celui qui vient de frapper, ou un coup de corps à corps qui se prépare
   * tout près (souvent dans le dos). Un tir lointain ne détourne la caméra
   * que si la cible actuelle est elle-même loin.
   */
  private pressingThreat<E extends LockEnemy>(enemies: readonly E[], view: LockView, current: E): E | null {
    const currentDistance = distanceTo(current, view);
    let best: E | null = null;
    let bestDistance = Infinity;
    for (const e of enemies) {
      if (e.id === current.id || e.state === 'dead') continue;
      const d = distanceTo(e, view);
      const shot = !!e.move && ENEMY_MOVES[e.move].shape === 'shot';
      const hitter = this.recentHitter(e.id) && this.hitAge < 0.3;
      const melee = !shot && isThreatening(e, view) && d < LOCK_TUNING.meleeThreat && d + 30 < currentDistance;
      const allowed = (hitter && (!shot || currentDistance > 150)) || melee;
      if (allowed && d < bestDistance) { best = e; bestDistance = d; }
    }
    return best;
  }

  private recentHitter(id: number) {
    return this.lastHitBy === id && this.hitAge < LOCK_TUNING.hitMemory;
  }
}
