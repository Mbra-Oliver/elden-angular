import type { BossState } from '../../constants/boss.config-constant';

/**
 * Machine à états finis du boss : transitions autorisées depuis chaque état.
 * BossEntity.enter() signale toute transition absente de cette table.
 *
 *   idle ──► chase ──► windup ──► attacking ──► recover ──► chase …
 *              ▲  (poursuite,      (anticipation  (frames      (punissable)
 *              │   placement)       lisible)       actives)
 *   hurt / stunned (équilibre rompu) ──► chase
 *   shift (changement de phase, intouchable) ──► windup | chase
 *
 * Pas d'état « patrouille » : chaque boss attend seul dans son arène
 * (idle), jusqu'à l'entrée du joueur.
 */
export const BOSS_TRANSITIONS: Record<BossState, readonly BossState[]> = {
  idle: ['chase', 'windup', 'hurt', 'stunned', 'shift', 'dead'],
  chase: ['idle', 'windup', 'hurt', 'stunned', 'shift', 'dead'],
  windup: ['attacking', 'hurt', 'stunned', 'shift', 'dead'],
  attacking: ['recover', 'windup', 'hurt', 'stunned', 'shift', 'dead'],
  recover: ['windup', 'chase', 'idle', 'hurt', 'stunned', 'shift', 'dead'],
  hurt: ['chase', 'idle', 'stunned', 'shift', 'dead'],
  stunned: ['chase', 'idle', 'hurt', 'shift', 'dead'],
  shift: ['windup', 'chase', 'dead'],
  dead: [],
};
