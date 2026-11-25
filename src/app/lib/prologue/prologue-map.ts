import { sceneryRandom } from '../constants/scenery';

/**
 * Prologue, 1701 : le champ de bataille de la guerre de libération asante
 * contre le Denkyira, sur la route de Feyiase.
 *
 * Kwadwo Ofori, soldat de l'arrière-garde (kyidom), a été assommé pendant
 * l'accrochage. Quand il se relève, la colonne est passée. Le chemin qu'elle
 * a laissé raconte le combat : morts des deux camps, mousquets jetés,
 * herbe brûlée, tambours abandonnés. Il le suit vers l'est jusqu'au camp.
 *
 * La carte vit à l'est du monde des actes I–II (x > 3400) : le brouillard
 * cache l'un à l'autre et rien n'est partagé. Repère : x vers l'est, y vers
 * le sud, en unités du sol (1 unité ≈ 6 cm, un homme ≈ 30 unités).
 * [SUPPOSITION] Toutes les positions, tailles et quantités sont des choix
 * de level design à valider en jeu.
 */

export interface Spot { x: number; y: number }
export interface Circle extends Spot { r: number }

/** Rectangle de la carte (bornes de déplacement quand on y est). */
export const PROLOGUE_AREA = { x: 3400, y: 100, w: 2900, h: 1400 };

export function inPrologue(x: number, y: number, margin = 0) {
  const a = PROLOGUE_AREA;
  return x > a.x - margin && x < a.x + a.w + margin && y > a.y - margin && y < a.y + a.h + margin;
}

/** Ligne médiane du sentier laissé par la colonne, de l'ouest (réveil) à l'est (camp). */
export const TRAIL: readonly Spot[] = [
  { x: 3530, y: 1250 },
  { x: 3760, y: 1170 },
  { x: 3980, y: 1010 },
  { x: 4220, y: 890 },
  { x: 4460, y: 810 },
  { x: 4700, y: 700 },
  { x: 4960, y: 570 },
  { x: 5200, y: 470 },
  { x: 5430, y: 390 },
  { x: 5640, y: 330 },
  { x: 5860, y: 290 },
  { x: 6080, y: 250 },
];

/** Demi-largeur praticable du sentier (herbes piétinées, sous-bois arraché). */
export const TRAIL_HALF = 62;
/**
 * Demi-largeur par tronçon : la ravine boueuse (séquence 2) et la montée
 * vers la crête (séquence 3) se resserrent.
 */
export const TRAIL_HALVES: readonly number[] = [62, 62, 46, 46, 62, 62, 62, 36, 46, 62, 62];

/** Embranchements de la séquence 2 : sanctuaire brisé (gauche) et raccourci (droite). */
export const BRANCHES: readonly { id: string; points: readonly Spot[]; half: number }[] = [
  { id: 'sanctuaire', points: [{ x: 4232, y: 880 }, { x: 4258, y: 770 }, { x: 4295, y: 660 }], half: 32 },
  {
    id: 'raccourci',
    points: [{ x: 4460, y: 830 }, { x: 4410, y: 1010 }, { x: 4160, y: 1170 }, { x: 3860, y: 1320 }, { x: 3590, y: 1425 }],
    half: 32,
  },
];
/** Pont du raccourci : le tronc poussé franchit le ravin jusqu'à l'autel de départ. */
export const BRIDGE = { points: [{ x: 3575, y: 1335 }, { x: 3588, y: 1428 }], half: 22 };
/** Où se tenir pour pousser le tronc (depuis le raccourci, au sud du ravin). */
export const BRIDGE_PUSH: Spot = { x: 3592, y: 1430 };

/** Clairières le long du sentier. */
export const CLEARINGS: readonly (Circle & { id: string })[] = [
  { id: 'reveil', x: 3540, y: 1240, r: 112 },
  { id: 'ruisseau', x: 4225, y: 885, r: 92 },
  { id: 'ligne', x: 4700, y: 700, r: 195 },
  { id: 'tambours', x: 5195, y: 475, r: 110 },
  { id: 'sanctuaire', x: 4300, y: 630, r: 70 },
  { id: 'rocher', x: 4410, y: 768, r: 30 },
  { id: 'raccourci', x: 3592, y: 1436, r: 42 },
  // Plateau rocheux avant la crête : second brasero (retour rapide au boss).
  { id: 'plateau', x: 5378, y: 418, r: 52 },
  { id: 'fromager', x: 4990, y: 600, r: 60 },
  // La crête : le porte-hache du Denkyira y garde l'abri du roi (combat de boss).
  { id: 'crete', x: 5640, y: 330, r: 262 },
  { id: 'camp', x: 6080, y: 250, r: 140 },
];

/** Ruisseau qui coupe le sentier (décor : on le passe à gué, il ne bloque pas). */
export const STREAM: readonly Spot[] = [
  { x: 4150, y: 560 }, { x: 4200, y: 720 }, { x: 4240, y: 880 }, { x: 4215, y: 1040 }, { x: 4260, y: 1260 },
];

/** Distance d'un point à la ligne brisée. */
export function distanceToPolyline(x: number, y: number, points: readonly Spot[]) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - a.x - dx * t, y - a.y - dy * t));
  }
  return best;
}

function distanceToSegment(x: number, y: number, a: Spot, b: Spot) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
}

/**
 * Vrai si un cercle (x, y, radius) tient entièrement dans le sentier, un
 * embranchement ou une clairière. `bridged` : le tronc du raccourci est poussé.
 */
export function walkable(x: number, y: number, radius = 0, bridged = false) {
  for (let i = 0; i < TRAIL.length - 1; i++) {
    if (distanceToSegment(x, y, TRAIL[i], TRAIL[i + 1]) + radius <= TRAIL_HALVES[i]) return true;
  }
  for (const branch of BRANCHES) {
    if (distanceToPolyline(x, y, branch.points) + radius <= branch.half) return true;
  }
  if (bridged && distanceToPolyline(x, y, BRIDGE.points) + radius <= BRIDGE.half) return true;
  return CLEARINGS.some((c) => Math.hypot(x - c.x, y - c.y) + radius <= c.r);
}

// ─── Récit du décor ─────────────────────────────────────────────────────────

export type RemainsId =
  | 'kwasi' | 'traces' | 'fusil' | 'archer' | 'ruisseau' | 'ligne' | 'gourde' | 'tambours' | 'awale'
  | 'sanctuaire' | 'talisman' | 'tambourinaire';

export interface Remains extends Spot {
  id: RemainsId;
  /** Libellé de l'invite (touche F). */
  label: string;
  title: string;
  text: string;
  /** Ce que l'on ramasse, s'il y a quelque chose. */
  gives?: { arrows?: number; bandji?: number; kaolin?: boolean; bow?: boolean; bandjiGift?: boolean };
  /** Parole d'un personnage (affichée comme une réplique). */
  speaker?: string;
}

/**
 * Restes que l'on peut examiner (F). Le reste du décor parle seul ; ces
 * points-là disent ce que Kwadwo comprend en les voyant.
 * [SUPPOSITION] Textes à faire relire par une personne akan ou un historien.
 */
export const REMAINS: readonly Remains[] = [
  {
    id: 'kwasi', x: 3575, y: 1205, label: 'Examiner le corps de Kwasi',
    title: 'Kwasi Boateng',
    text: 'Ton frère de lance, de la même compagnie de l’arrière-garde. Il t’a tiré sous le tronc quand la balle t’a jeté à terre, puis il est retourné au combat. Sa lance est brisée. La tienne est restée près de toi.',
  },
  {
    id: 'traces', x: 3735, y: 1185, label: 'Regarder les traces',
    title: 'Le passage de la colonne',
    text: 'Des centaines de pieds nus ont couché l’herbe, toutes vers l’est. Une gourde de poudre est tombée d’une ceinture sans que personne ne s’arrête. L’armée n’a pas attendu ses traînards.',
  },
  {
    id: 'fusil', x: 3965, y: 1040, label: 'Examiner le mousquet',
    title: 'Mousquet de traite',
    text: 'Un fusil à silex venu de la côte, échangé contre de l’or. Le soldat du Denkyira qui le portait n’a pas eu le temps de recharger. La platine est encore chaude.',
  },
  {
    id: 'archer', x: 4125, y: 930, label: 'Fouiller le carquois',
    title: 'Carquois d’un archer',
    text: 'Un archer de ta compagnie, tombé sur son arc. Quelqu’un est déjà passé fouiller les morts, mais l’arc est intact et il reste quatre flèches dans le carquois.',
    gives: { bow: true, arrows: 4 },
  },
  {
    id: 'ruisseau', x: 4245, y: 845, label: 'Regarder le ruisseau',
    title: 'Le gué du ruisseau',
    text: 'Les deux armées se sont battues dans l’eau jusqu’aux genoux. Des gourdes, des sandales et un tambour d’aisselle dérivent contre les racines.',
  },
  {
    id: 'ligne', x: 4690, y: 690, label: 'Examiner la ligne de fusiliers',
    title: 'La ligne qui a cédé',
    text: 'Ici, les fusiliers du Denkyira tenaient en rang. Les tonnelets de poudre ont brûlé l’herbe autour d’eux. Quand la ligne a cédé, ils ont jeté leurs fusils pour courir plus vite.',
  },
  {
    id: 'sanctuaire', x: 4290, y: 615, label: 'Ramasser la décoction',
    title: 'Décoction d’écorce amère',
    text: 'Sur l’autel forestier profané, une calebasse de décoction d’écorce amère, laissée en offrande. Elle referme les plaies.',
    gives: { bandji: 1 },
  },
  {
    id: 'talisman', x: 4322, y: 648, label: 'Examiner le talisman',
    title: 'Talisman de cuivre du Denkyira',
    text: 'Talisman portant le sceau de Ntim Gyakari. Pendant des décennies, l’or, les récoltes et les fils du royaume furent livrés en tribut au Denkyira. Ce soir, le tribut se paie par le sang.',
  },
  {
    id: 'tambourinaire', x: 5012, y: 618, label: 'S’approcher du blessé',
    title: 'Le tambourinaire agonisant',
    speaker: 'Le tambourinaire',
    text: '« Ofori… tu es vivant. Ils nous attendaient ici : la plupart des leurs étaient embusqués dans la gorge, et ils nous ont taillés en pièces avant de tomber à leur tour. La guerre est presque gagnée. Le Denkyira a fui, et les nôtres ont tous suivi Osei Tutu vers l’est. Moi, je n’irai pas plus loin. Prends ma gourde : c’est du Bandji, il te rendra des forces. Et cette poudre de kaolin pour ta lame. Sur la crête, le porte-hache de Ntim Gyakari refuse de plier… Il frappe comme la foudre. » Il ferme les yeux.',
    gives: { kaolin: true, bandjiGift: true },
  },
  {
    id: 'gourde', x: 4885, y: 615, label: 'Examiner la gourde',
    title: 'Gourde percée',
    text: 'Une gourde de porteur, percée d’une balle. Le vin de palme a coulé dans la boue. Rien à boire ici.',
  },
  {
    id: 'tambours', x: 5165, y: 445, label: 'Examiner les tambours',
    title: 'Les tambours parlants',
    text: 'La paire d’atumpan de l’avant-garde, abandonnée. L’un est crevé d’une balle. Ce sont eux que tu entendais : quelqu’un d’autre en joue maintenant, plus loin vers l’est.',
  },
  {
    id: 'awale', x: 5355, y: 448, label: 'Examiner le plateau',
    title: 'Un plateau d’awalé renversé',
    text: 'Les graines sont éparpillées dans la boue, au milieu d’un abri de feuilles écrasé. On racontera plus tard que le roi du Denkyira, Ntim Gyakari, jouait encore quand les guerriers d’Osei Tutu l’ont trouvé.',
  },
];

/** Distance d'examen (F). */
export const INSPECT_RADIUS = 34;

/** Arrivée : le camp de l'arrière-garde, sur la crête. */
export const CAMP: Spot & { r: number } = { x: 6090, y: 250, r: 70 };

/** Point de départ (sous le tronc couché, à côté de Kwasi). */
export const START: Spot = { x: 3530, y: 1262 };

/** Foyers du prologue (repos, point de retour). */
export const PROLOGUE_FOYERS = {
  // Petit brasero rituel entouré de cauris, une calebasse d'eau à côté.
  kyidom: { x: 3500, y: 1205, name: 'Autel de mémoire' },
  // Juste avant l'arène de Badu : moins de dix secondes entre la mort et le duel.
  tambours: { x: 5390, y: 410, name: 'Brasero de la crête' },
} as const;

/** Soldats du Denkyira restés en arrière (pillards et fusiliers de la slice). */
export const PROLOGUE_SPAWNS: readonly ({ kind: 'pilleur' | 'fusilier' | 'eclaireur' | 'lancier' | 'tireur' | 'garde' } & Spot)[] = [
  // Séquence 1 : l'éclaireur qui dépouille un mort, près d'une charge de porteur renversée.
  { kind: 'eclaireur', x: 3805, y: 1150 },
  // Séquence 2 : la ravine boueuse, un lancier devant, un tireur posté sur un rocher.
  { kind: 'lancier', x: 4305, y: 862 },
  { kind: 'tireur', x: 4410, y: 768 },
  // Un pillard sur l'autel profané (chemin de gauche).
  { kind: 'pilleur', x: 4300, y: 650 },
  // Campement avancé incendié, sur la ligne de fusiliers.
  { kind: 'fusilier', x: 4800, y: 640 },
  { kind: 'pilleur', x: 4640, y: 770 },
  // Séquence 3 : le garde d'élite bloque la montée vers la crête.
  { kind: 'garde', x: 5290, y: 445 },
];

/** Troncs brisés de la ravine : couverts contre le tir du mousquet (collision et ligne de vue). */
export const COVER_TRUNKS: readonly Circle[] = [
  { x: 4262, y: 888, r: 7 }, { x: 4330, y: 838, r: 7 }, { x: 4372, y: 860, r: 6 },
];
/** Grand fromager où s'adosse le tambourinaire. */
export const KAPOK: Circle = { x: 5040, y: 650, r: 18 };

// ─── Décor (positions générées une fois, partagées par la 3D et les collisions) ──

const rand = sceneryRandom(1701);

export interface PropSpot extends Spot { yaw: number; variant: number }

/** Arbres de forêt dense des deux côtés du sentier (r : rayon du tronc, couronne ≈ 3 r). */
export const FOREST: readonly (Circle & { height: number; seed: number })[] = (() => {
  const trees: (Circle & { height: number; seed: number })[] = [];
  const a = PROLOGUE_AREA;
  for (let i = 0; trees.length < 520 && i < 6000; i++) {
    const x = a.x + rand() * a.w;
    const y = a.y + rand() * a.h;
    const r = 7 + rand() * 9;
    // Lisière serrée près du sentier, sous-bois plus clair plus loin.
    const edge = distanceToPolyline(x, y, TRAIL) - TRAIL_HALF;
    // Le tronc reste hors du praticable (il peut mordre la lisière).
    if (walkable(x, y, -r * 0.6, true)) continue;
    if (edge > 260 && rand() < 0.55) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + r + 10)) continue;
    trees.push({ x, y, r, height: 95 + rand() * 120, seed: i });
  }
  return trees;
})();

const along = (count: number, spread: number, from = 0, to = 1): PropSpot[] =>
  Array.from({ length: count }, (_, i) => {
    const t = from + (to - from) * ((i + rand() * 0.8) / count);
    const f = t * (TRAIL.length - 1);
    const k = Math.min(TRAIL.length - 2, Math.floor(f));
    const a = TRAIL[k];
    const b = TRAIL[k + 1];
    const u = f - k;
    const nx = -(b.y - a.y);
    const ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    const side = (rand() * 2 - 1) * spread;
    return {
      x: a.x + (b.x - a.x) * u + nx / len * side,
      y: a.y + (b.y - a.y) * u + ny / len * side,
      yaw: rand() * Math.PI * 2,
      variant: Math.floor(rand() * 4),
    };
  });

const near = (c: Spot, count: number, radius: number): PropSpot[] =>
  Array.from({ length: count }, () => {
    const angle = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * radius;
    return { x: c.x + Math.cos(angle) * d, y: c.y + Math.sin(angle) * d, yaw: rand() * Math.PI * 2, variant: Math.floor(rand() * 4) };
  });

/**
 * Morts des deux camps. variant pair : soldat asante (batakari, pagne
 * indigo) ; impair : soldat du Denkyira (pagne rouille, ceinture de poudre).
 */
export const BODIES: readonly PropSpot[] = [
  ...along(16, 44, 0.08, 0.95),
  ...near(CLEARINGS[2], 9, 140),
  ...near(CLEARINGS[1], 3, 50),
];

/** Lances plantées ou couchées. */
export const SPEARS: readonly PropSpot[] = along(9, 44, 0.05, 0.95);
/** Mousquets jetés (surtout sur la ligne de fusiliers). */
export const MUSKETS: readonly PropSpot[] = [
  ...along(6, 40, 0.15, 0.9),
  ...Array.from({ length: 9 }, (_, i) => ({
    x: 4630 + i * 17 + rand() * 6, y: 610 + i * 9 + rand() * 10, yaw: 0.4 + rand() * 0.8, variant: i % 4,
  })),
];
/** Coupe-coupe et épées afena. */
export const BLADES: readonly PropSpot[] = along(8, 46, 0.1, 0.9);
/** Arcs brisés. */
export const BOWS: readonly PropSpot[] = [...along(4, 40, 0.1, 0.5), { x: 4118, y: 942, yaw: 1.2, variant: 0 }];
/** Plaques d'herbe brûlée (feu de poudre) et terre retournée. */
export const SCORCHES: readonly (PropSpot & { r: number })[] = [
  ...along(12, 40, 0.1, 0.95).map((p) => ({ ...p, r: 12 + rand() * 18 })),
  ...near(CLEARINGS[2], 10, 150).map((p) => ({ ...p, r: 16 + rand() * 22 })),
];
/** Fumées qui montent encore (feux de brousse allumés par la poudre). */
export const SMOKES: readonly Spot[] = [
  { x: 3880, y: 1120 }, { x: 4560, y: 860 }, { x: 4760, y: 600 }, { x: 4900, y: 760 },
  { x: 5310, y: 520 }, { x: 5760, y: 230 }, { x: 5520, y: 230 }, { x: 6230, y: 150 },
];
/** Tonnelets de poudre éventrés (ligne de fusiliers). */
export const KEGS: readonly PropSpot[] = near({ x: 4730, y: 670 }, 5, 70);
/** Gourdes, sandales, ceintures tombées. */
export const LITTER: readonly PropSpot[] = along(14, 44, 0, 1);

/** Gros obstacles (collision) : tronc couché du réveil, tambours, abri écrasé. */
export const FALLEN_TRUNK = { x: 3498, y: 1290, length: 120, yaw: 0.25, r: 11 };
export const SOLIDS: readonly Circle[] = [
  // Tronc couché : quelques cercles le long de l'axe.
  ...Array.from({ length: 6 }, (_, i) => {
    const t = (i / 5 - 0.5) * FALLEN_TRUNK.length;
    return { x: FALLEN_TRUNK.x + Math.cos(FALLEN_TRUNK.yaw) * t, y: FALLEN_TRUNK.y + Math.sin(FALLEN_TRUNK.yaw) * t, r: FALLEN_TRUNK.r };
  }),
  { x: 5150, y: 430, r: 12 },
  { x: 5172, y: 418, r: 10 },
  { x: 5345, y: 475, r: 12 },
  ...COVER_TRUNKS,
  KAPOK,
];

/** Trois guerriers asante tombés aux pieds de Badu, sur la crête. */
export const CREST_FALLEN: readonly PropSpot[] = [
  { x: 5690, y: 300, yaw: 0.4, variant: 0 }, { x: 5720, y: 350, yaw: 2.2, variant: 2 }, { x: 5665, y: 365, yaw: 4.1, variant: 0 },
];

/** Guerriers de l'arrière-garde au camp (silhouettes immobiles, autour des feux). */
export const CAMP_WARRIORS: readonly PropSpot[] = [
  { x: 6110, y: 210, yaw: 4.3, variant: 0 }, { x: 6140, y: 240, yaw: 4.0, variant: 1 },
  { x: 6080, y: 190, yaw: 4.7, variant: 2 }, { x: 6170, y: 200, yaw: 4.2, variant: 3 },
  { x: 6190, y: 270, yaw: 3.9, variant: 0 }, { x: 6130, y: 160, yaw: 4.6, variant: 1 },
];
export const CAMP_FIRES: readonly Spot[] = [{ x: 6150, y: 220 }, { x: 6210, y: 160 }];
/** Parasol de chef (kyinie) au camp : repère visible de loin. */
export const UMBRELLA: Spot = { x: 6180, y: 185 };

/** Arène du porte-hache, sur la crête (rayon un peu sous la clairière). */
export const PROLOGUE_DUEL = { x: 5640, y: 330, radius: 240 };
/** Le combat se déclenche quand le héros entre de cette distance dans l'arène. */
export const DUEL_TRIGGER = 215;
/** Tant que le porte-hache tient la crête, le sentier du camp est barré au-delà. */
export const CREST_GATE_X = 5895;

/**
 * Ambiance : fin d'après-midi enfumée, poudre et feux de brousse sous la
 * canopée. Brouillard plus dense qu'aux actes I–II (il cache aussi le reste
 * du monde, à plus de 1000 unités à l'ouest). [SUPPOSITION] valeurs à régler.
 */
export const PROLOGUE_MOOD = {
  // Crépuscule : ombres froides et sombres, soleil bas et rouge à l'est, derrière la crête :
  // on marche vers la lumière. Brume brun-rouge, moins dense pour voir les repères au loin.
  fog: '#3b2a25', fogDensity: 0.0022, background: '#2a1d1b', hemi: 0.95, sun: 3.1, sunColor: '#ff8f52',
  sunPosition: [520, 150, -170] as [number, number, number],
  hemiSky: '#c7906d', hemiGround: '#23262c',
};

/** Centre de la carte (collines lointaines). */
export const PROLOGUE_CENTER = { x: PROLOGUE_AREA.x + PROLOGUE_AREA.w / 2, y: PROLOGUE_AREA.y + PROLOGUE_AREA.h / 2 };
