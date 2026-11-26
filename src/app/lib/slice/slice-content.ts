import type { Dialogue } from '../services/dialogue-tree';
import type { AttackData } from '../interfaces/AttackData';
import type { EnemyKind, ItemId } from './slice-map';

/**
 * Contenu de la tranche verticale : ennemis, statistiques, armes, objets et
 * leur lore fragmenté, accroche d'ouverture.
 * [SUPPOSITION] Tous les chiffres sont des premières valeurs, non testées en
 * partie : à régler après quelques essais.
 */

// ------------------------------------------------------------------ ENNEMIS

export interface EnemyConfig {
  name: string;
  hp: number;
  radius: number;
  speed: number;
  /** Distance d'éveil, et distance au-delà de laquelle il rentre à son poste. */
  aggro: number;
  leash: number;
  /** Ne bronche que sous un coup lourd ou spécial (noyé). */
  heavyPoise: boolean;
  cowries: number;
}

export const ENEMIES: Record<EnemyKind, EnemyConfig> = {
  pilleur: { name: 'Pilleur', hp: 46, radius: 11, speed: 122, aggro: 250, leash: 560, heavyPoise: false, cowries: 60 },
  fusilier: { name: 'Fusilier du conseil', hp: 34, radius: 11, speed: 96, aggro: 330, leash: 600, heavyPoise: false, cowries: 75 },
  noye: { name: 'Noyé de la digue', hp: 112, radius: 15, speed: 58, aggro: 190, leash: 420, heavyPoise: true, cowries: 140 },
  // Chapitre 1 (1701). [SUPPOSITION] Combat sec : deux coups tuent l'éclaireur, deux coups de sa lance tuent Kwadwo.
  eclaireur: { name: 'Éclaireur du Denkyira', hp: 20, radius: 11, speed: 128, aggro: 210, leash: 520, heavyPoise: false, cowries: 40 },
  lancier: { name: 'Lancier du Denkyira', hp: 42, radius: 11, speed: 104, aggro: 240, leash: 420, heavyPoise: false, cowries: 70 },
  tireur: { name: 'Tireur du Denkyira', hp: 26, radius: 11, speed: 70, aggro: 380, leash: 520, heavyPoise: false, cowries: 80 },
  garde: { name: 'Garde d’élite du Denkyira', hp: 190, radius: 15, speed: 70, aggro: 230, leash: 380, heavyPoise: true, cowries: 300 },
};

export interface EnemyMove {
  windup: number; // ms d'anticipation lisible
  active: number; // ms où le coup touche
  recover: number; // ms vulnérable après le coup
  damage: number;
  reach: number; // px depuis le bord du corps
  /** 'arc' devant l'ennemi, 'ring' tout autour (frappe au sol). */
  shape: 'arc' | 'ring' | 'shot';
  lunge?: number; // px/s pendant l'impact
}

export const ENEMY_MOVES: Record<'slash' | 'slash2' | 'shot' | 'butt' | 'claw' | 'slam' | 'spear' | 'longshot' | 'club' | 'bash', EnemyMove> = {
  // Pilleur : deux coups de coupe-coupe rapides (le second suit si le premier touche ou non).
  slash: { windup: 380, active: 120, recover: 260, damage: 13, reach: 30, shape: 'arc', lunge: 210 },
  slash2: { windup: 210, active: 120, recover: 620, damage: 11, reach: 30, shape: 'arc', lunge: 160 },
  // Fusilier : visée longue (ligne rouge), la ligne se fige 260 ms avant le coup.
  shot: { windup: 1050, active: 40, recover: 1900, damage: 24, reach: 400, shape: 'shot' },
  butt: { windup: 360, active: 110, recover: 520, damage: 10, reach: 24, shape: 'arc', lunge: 140 },
  // Noyé : griffe lente et frappe au sol circulaire.
  claw: { windup: 560, active: 150, recover: 520, damage: 17, reach: 34, shape: 'arc', lunge: 120 },
  slam: { windup: 900, active: 140, recover: 900, damage: 27, reach: 50, shape: 'ring' },
  // Lance du Denkyira : estoc avec élan (deux coups tuent le héros).
  spear: { windup: 620, active: 110, recover: 620, damage: 55, reach: 40, shape: 'arc', lunge: 230 },
  // Tireur posté : 4 s pour recharger, c'est le moment de le déloger.
  longshot: { windup: 1400, active: 40, recover: 4000, damage: 36, reach: 430, shape: 'shot' },
  // Garde d'élite : massue cloutée lente et coup de bouclier rapide.
  club: { windup: 950, active: 150, recover: 950, damage: 40, reach: 36, shape: 'arc', lunge: 90 },
  bash: { windup: 360, active: 120, recover: 620, damage: 16, reach: 26, shape: 'arc', lunge: 280 },
};

export type EnemyMoveId = keyof typeof ENEMY_MOVES;
export const SHOT_LOCK_MS = 260;

// ------------------------------------------------------------- PROGRESSION

export type StatId = 'vigueur' | 'souffle' | 'force' | 'adresse' | 'sunsum';

export const STATS: Record<StatId, { name: string; effect: string }> = {
  vigueur: { name: 'Vigueur', effect: '+12 PV max' },
  souffle: { name: 'Souffle', effect: '+8 endurance max' },
  force: { name: 'Force', effect: '+8 % dégâts à la lance' },
  adresse: { name: 'Adresse', effect: '+10 % dégâts à l’arc, +5 % à l’afena' },
  // Identifiant « sunsum » gardé pour les sauvegardes ; affiché « Courage » (akokoduro).
  sunsum: { name: 'Courage', effect: '+15 % d’ardeur, attaques spéciales plus fortes' },
};

export const STAT_ORDER: readonly StatId[] = ['vigueur', 'souffle', 'force', 'adresse', 'sunsum'];

/** Coût en cauris pour passer du niveau `level` au suivant. */
export function levelCost(level: number) {
  // Échelle des cauris de la boucle soulslike (jarres 5–24, boss 600+).
  return Math.round(180 * Math.pow(1.15, level - 1));
}

/** Jauge « ardeur » (l'élan des chants de guerre asafo) : remplie en frappant, vidée par les attaques spéciales. */
export const SPIRIT = {
  max: 100,
  perMeleeHit: 9,
  perArrowHit: 6,
  specialCost: 45,
};

// ------------------------------------------------------------------- ARMES

/** Afena : épée courte à lame en feuille. Plus rapide, moins d'allonge. */
export const AFENA_COMBO: AttackData[] = [
  { damage: 9, staminaCost: 5, duration: 280, range: 0.9, windup: 80, active: 55, chain: 170 },
  { damage: 10, staminaCost: 5, duration: 300, range: 0.95, windup: 85, active: 60, chain: 185 },
  { damage: 16, staminaCost: 8, duration: 470, range: 1.05, windup: 150, active: 80, chain: 360 },
];
export const AFENA_HEAVY: AttackData = { damage: 26, staminaCost: 20, duration: 560, range: 1.2, windup: 230, active: 90, chain: 450 };

export type SpecialId = 'percee' | 'tourbillon' | 'volee';

export interface SpecialInfo { name: string; description: string }

export const SPECIALS: Record<SpecialId, SpecialInfo & { attack?: AttackData }> = {
  // Lance : percée d'élan, longue allonge, réutilise l'animation de riposte.
  percee: {
    name: 'Percée du gué',
    description: 'Élan en avant, lance tendue : traverse la garde.',
    attack: { damage: 36, staminaCost: 0, duration: 420, range: 2.6, windup: 60, active: 170 },
  },
  // Afena : tour complet sur soi, touche tout autour.
  tourbillon: {
    name: 'Tourbillon de feuilles',
    description: 'Ama tourne sur elle-même : touche tous les ennemis autour.',
    attack: { damage: 24, staminaCost: 0, duration: 620, range: 1.5, windup: 140, active: 300 },
  },
  // Arc : trois flèches en éventail.
  volee: { name: 'Volée de trois', description: 'Trois flèches en éventail, une seule tirée du carquois.' },
};

// ------------------------------------------------------------------- OBJETS

export interface ItemInfo {
  name: string;
  effect: string;
  /** Lore fragmenté : chaque objet raconte un morceau de ce qu'on ne dit pas. */
  lore: string;
}

export const ITEMS: Record<ItemId, ItemInfo> = {
  piquet: {
    name: 'Piquet neuf',
    effect: 'Objet de lore',
    lore: 'Bois de teck fraîchement taillé, enfoncé dans le lit du canal. Une marque au fer rouge sur la tête : trois traits et un cercle. Yao a vu les mêmes sur la planche. On ne taille pas un piquet neuf pour réparer : on le taille pour détourner.',
  },
  poids: {
    name: 'Poids à peser l’or',
    effect: '+250 cauris',
    lore: 'Petit laiton : deux crocodiles qui partagent un seul ventre et se disputent pourtant la nourriture. Les anciens du conseil le posaient sur la balance pour rappeler qu’ils mangeaient du même ventre que le village. Celui-ci a été jeté dans les herbes.',
  },
  batakari: {
    name: 'Batakari aux talismans',
    effect: 'Armure : −15 % de dégâts subis',
    lore: 'Tunique de guerre couverte de sachets de cuir cousus. Un porteur de Kumasi l’a laissée là en 1874, roulée sous une termitière. Un des sachets est vide : on dit qu’il contenait le nom de celui qui devait revenir.',
  },
  perle: {
    name: 'Perle bleue de la retenue',
    effect: 'Courage +1',
    lore: 'Perle de verre bleu, trouvée dans la boue. Kwabena en portait une pareille au poignet le soir du gué. Le chant dit qu’il l’a jetée dans la retenue pour que le Gardien sache qui l’avait enfermé, et qu’un jour quelqu’un de sa lignée vienne répondre de son nom.',
  },
  afena: {
    name: 'Afena du porteur d’Ampem',
    effect: 'Nouvelle arme : afena (R pour changer)',
    lore: 'Épée courte à lame en forme de feuille. Le porteur qui suivait Okomfo Ampem l’a perdue en 1824, la nuit où la chambre a été noyée. Le pommeau est usé d’un seul côté : il la tenait de la main gauche, pour garder la droite sur le prêtre.',
  },
  calebasse: {
    name: 'Calebasse fêlée de Kwabena',
    effect: '+1 poignée de feuilles pour la mixture',
    lore: 'Calebasse recousue avec de la ficelle de raphia. Gravée d’une corde à trois nœuds. Kwabena y gardait du vin de palme pour ceux qui tenaient la corde du gué. Kofi Brempong y a bu le premier.',
  },
};

// ----------------------------------------------------------- DIALOGUES & HOOK

/** Accroche de 30 secondes avant le duel du gué (passable). */
export const HOOK_LINES: readonly string[] = [
  'Gué du Pra, 1824. La nuit où le fleuve a monté.',
  'Derrière Kwabena Ofori, quarante familles de la lignée de Pokou fuient la guerre.',
  'Devant lui, Kofi Brempong, capitaine asafo. Ses ordres : ne laisser passer personne.',
  'Kwabena tient la corde du gué. Kofi tient son sabre.',
];

export const SLICE_DIALOGUES: Record<string, Dialogue> = {
  'gate-blocked': {
    speaker: 'Yao',
    text: 'La vanne ne bouge plus. Les hommes de mon père ont bloqué le contrepoids depuis les chambres de la vieille digue, là où se dresse le grand fromager mort. Le chemin passe par la plaine des termitières, au sud. Ils ont engagé des fusiliers et des pillards revenus de la guerre. Et dans les chambres, l’eau est partie : quelque chose marche dans la boue.',
    choices: [{ label: 'Partir vers la vieille digue', action: 'expedition' }],
  },
};

/** Texte du journal pendant l'expédition. */
export const EXPEDITION_JOURNAL = {
  plain: 'Traverse la plaine des termitières jusqu’aux chambres de la vieille digue, sous le grand fromager. Les termitières arrêtent les balles des fusiliers.',
  dungeon: 'Les chambres sont à sec. Trouve le levier du canal au fond de la galerie nord. Une porte barrée de l’intérieur pourrait te ramener au feu.',
  done: 'Le passage de la digue est ouvert. Redescends vers la vanne : Yao t’attend.',
};
