import { AttackData } from '../interfaces/AttackData';

export type WeaponId = 'spear' | 'bow';

export interface WeaponInfo {
  id: WeaponId;
  name: string;
  description: string;
}

/** Les deux armes d'Ama. La lance reprend le combo de corps à corps existant. */
export const WEAPONS: Record<WeaponId, WeaponInfo> = {
  spear: {
    id: 'spear',
    name: 'Lance',
    description: 'Corps à corps : combo rapide (Espace) et coup lourd (E).',
  },
  bow: {
    id: 'bow',
    name: 'Arc',
    description: 'À distance : tir rapide (Espace) ou tir bandé (E). Chaque tir consomme une flèche.',
  },
};

/** Tir d'arc : windup = temps pour bander l'arc, la flèche part à la fin du windup. */
export interface BowShotData extends AttackData {
  arrowSpeed: number; // px / s
  maxDistance: number; // px avant que la flèche tombe au sol
}

export const BOW_QUICK_SHOT: BowShotData = {
  damage: 9, staminaCost: 8, duration: 420, range: 0, windup: 230, active: 0,
  arrowSpeed: 640, maxDistance: 520,
};

export const BOW_POWER_SHOT: BowShotData = {
  damage: 24, staminaCost: 18, duration: 820, range: 0, windup: 620, active: 0,
  arrowSpeed: 900, maxDistance: 700,
};

/**
 * Hypothèses de réglage (à ajuster) : carquois de 12 flèches, 3 gourdes de
 * Bandji rendant chacune 45 PV. Les flèches qui manquent leur cible tombent
 * au sol et peuvent être ramassées en marchant dessus.
 */
export const EQUIPMENT_CONFIG = {
  maxArrows: 12,
  arrowHitRadius: 10, // marge de collision ajoutée autour de la cible
  arrowPickupRadius: 22,
  groundArrowLifetime: 30, // secondes avant qu'une flèche au sol disparaisse

  maxBandji: 3,
  bandjiHeal: 45,
  drinkDuration: 1100, // ms, le joueur est immobile et vulnérable
  drinkHealAt: 0.6, // fraction de la gorgée où le soin s'applique
};
