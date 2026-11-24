export interface AttackData {
  damage: number;
  staminaCost: number;
  duration: number;
  range: number;
  windup: number;
  active: number;
  /**
   * Instant (ms depuis le début) à partir duquel une attaque tamponnée
   * enchaîne directement sur la suivante, pendant la récupération.
   */
  chain?: number;
}
