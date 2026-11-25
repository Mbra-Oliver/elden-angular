import { Instruments, midi } from './instruments';

/**
 * Thèmes musicaux procéduraux. Chaque thème est découpé en « stems »
 * (couches verticales) qui jouent toujours ensemble, en mesure, et dont seul
 * le volume change : la phase 2 d'un boss ouvre une couche, la phase 3 la
 * suivante. Les stems peuvent aussi être remplacés par des fichiers
 * (OGG/Opus, repli MP3) via `file`, sans toucher au reste du moteur.
 *
 * Écriture : mesure de 12 croches (12/8, ressenti ternaire), échelle
 * pentatonique mineure sombre. La ligne de cloche reprend le motif de
 * cloche en 12/8 courant en Afrique de l'Ouest (x.x.xx.x.x.x).
 */

export type ThemeId = 'village' | 'river' | 'depths' | 'dawn' | 'boss-duelist' | 'boss-guardian' | 'feyiase' | 'boss-badu';
export type StingId = 'boss-intro' | 'phase' | 'death';

export interface StepContext {
  inst: Instruments;
  /** Sortie du stem (son gain porte le niveau de couche). */
  out: AudioNode;
  time: number;
  /** Index de croche depuis le début du morceau. */
  step: number;
  /** Croche dans la mesure (0..stepsPerBar-1). */
  beat: number;
  bar: number;
  stepSeconds: number;
  /** Aléatoire reproductible, propre au stem. */
  random: () => number;
}

export interface StemSpec {
  id: string;
  /** Joue les notes d'une croche. */
  step?: (c: StepContext) => void;
  /** Son continu démarré avec le morceau ; renvoie son arrêt. */
  hold?: (inst: Instruments, out: AudioNode, time: number) => (at: number) => void;
  /** Base d'un fichier audio en boucle (sans extension) qui remplace la synthèse. */
  file?: string;
}

export interface ThemeSpec {
  id: ThemeId;
  stepSeconds: number;
  stepsPerBar: number;
  stems: StemSpec[];
  /** Niveau de chaque stem selon la phase (exploration : une seule phase). */
  layers: Record<1 | 2 | 3, number[]>;
  /** Nappe d'ambiance (bus ambience), indépendante des couches. */
  ambience?: (inst: Instruments, out: AudioNode, time: number) => (at: number) => void;
  /** Notes de corde pincée à pré-calculer au chargement. */
  plucks: { notes: number[]; sustain: number };
  /** Vrai : chargé seulement à l'approche de l'arène. */
  lazy?: boolean;
}

/** Pentatonique mineure (D, F, G, A, C) sur deux octaves à partir de `root`. */
const pentatonic = (root: number) => [0, 3, 5, 7, 10, 12, 15, 17, 19, 22].map((i) => root + i);
const BELL = new Set([0, 2, 4, 5, 7, 9, 11]);

const D3 = 50;
const C3 = 48;
const VILLAGE_NOTES = pentatonic(D3 + 12);
const RIVER_NOTES = pentatonic(C3 + 12);
const DUEL_NOTES = pentatonic(D3);
const GUARDIAN_NOTES = pentatonic(C3 - 2);

const pick = <T>(list: T[], random: () => number) => list[Math.floor(random() * list.length)];

/**
 * Phrases de tambour parlant (croche, degré, glissando). Les glissandos
 * montants/descendants imitent des syllabes tonales, sans prétendre dire un
 * texte réel en twi.
 */
const DRUM_CALLS: [number, number, number][][] = [
  [[0, 1, 1.3], [2, 1, 1.3], [3, 0, 0.8], [6, 1, 1.25], [9, 0, 0.85]],
  [[0, 0, 1.4], [1, 1, 1.2], [4, 1, 0.9], [6, 0, 1.3], [8, 1, 1.15], [10, 0, 0.8]],
  [[0, 1, 0.85], [3, 1, 1.3], [5, 0, 1.25], [6, 0, 0.8], [9, 1, 1.35]],
  [[0, 0, 1.35], [2, 0, 1.35], [4, 1, 0.8], [7, 1, 1.2], [9, 0, 1.3], [10, 0, 1.1], [11, 1, 0.75]],
];

function drumCall(c: StepContext, root: number, level: number, variant = c.bar) {
  for (const [beat, degree, bend] of DRUM_CALLS[variant % DRUM_CALLS.length]) {
    if (beat !== c.beat) continue;
    const freq = root * (degree ? 1.5 : 1);
    c.inst.talkingDrum(c.out, c.time, freq, {
      level, decay: 0.28, from: bend > 1 ? 1 : bend + 0.25, to: bend > 1 ? bend : 1, glide: c.stepSeconds * 0.8,
      pan: degree ? 0.25 : -0.2,
    });
  }
}

// ---------------------------------------------------------------- exploration

const village: ThemeSpec = {
  id: 'village',
  stepSeconds: 0.34,
  stepsPerBar: 12,
  plucks: { notes: VILLAGE_NOTES, sustain: 0.997 },
  layers: { 1: [1, 1, 1], 2: [1, 1, 1], 3: [1, 1, 1] },
  stems: [
    { id: 'bourdon', hold: (inst, out, t) => inst.drone(out, t, midi(D3 - 12), { cutoff: 260, level: 0.16 }) },
    {
      id: 'seperewa',
      // Rares notes isolées, parfois une courte figure de trois notes.
      step: (c) => {
        if (c.random() > 0.075) return;
        const start = Math.floor(c.random() * 6);
        const figure = c.random() < 0.3 ? 3 : 1;
        for (let i = 0; i < figure; i++) {
          c.inst.pluck(c.out, c.time + i * c.stepSeconds, VILLAGE_NOTES[start + i], 0.26 - i * 0.05, 0.997, c.random() - 0.5);
        }
      },
    },
    {
      id: 'tambour-lointain',
      // Un appel de tambour au loin toutes les huit mesures.
      step: (c) => {
        if (c.bar % 8 === 5) drumCall(c, midi(D3 - 5), 0.12, c.bar >> 3);
      },
    },
  ],
  ambience: (inst, out, t) => inst.bed(out, t, { freq: 520, q: 0.6, rate: 0.07, level: 0.11, flutter: 0.13 }),
};

const river: ThemeSpec = {
  id: 'river',
  stepSeconds: 0.38,
  stepsPerBar: 12,
  plucks: { notes: RIVER_NOTES, sustain: 0.997 },
  layers: { 1: [1, 1], 2: [1, 1], 3: [1, 1] },
  stems: [
    { id: 'bourdon', hold: (inst, out, t) => inst.drone(out, t, midi(C3 - 12), { cutoff: 220, level: 0.15, breath: 0.03 }) },
    {
      id: 'seperewa',
      step: (c) => {
        if (c.random() > 0.05) return;
        c.inst.pluck(c.out, c.time, pick(RIVER_NOTES.slice(2, 9), c.random), 0.24, 0.997, c.random() * 0.8 - 0.4);
      },
    },
  ],
  // Eau du Pra : bande plus haute, frémissement plus rapide.
  ambience: (inst, out, t) => inst.bed(out, t, { freq: 950, q: 0.9, rate: 0.19, level: 0.13, flutter: 0.9 }),
};

/** Souterrains (digue, chambres) : presque rien, des gouttes et un grave. */
const depths: ThemeSpec = {
  id: 'depths',
  stepSeconds: 0.42,
  stepsPerBar: 12,
  plucks: { notes: RIVER_NOTES.slice(5), sustain: 0.99 },
  layers: { 1: [1, 1], 2: [1, 1], 3: [1, 1] },
  stems: [
    { id: 'bourdon', hold: (inst, out, t) => inst.drone(out, t, midi(C3 - 14), { cutoff: 160, level: 0.2, breath: 0.02, fifth: false }) },
    {
      id: 'gouttes',
      step: (c) => {
        if (c.random() < 0.06) c.inst.pluck(c.out, c.time, pick(RIVER_NOTES.slice(5), c.random), 0.14, 0.99, c.random() * 1.4 - 0.7);
        if (c.bar % 6 === 2 && c.beat === 0) c.inst.atumpan(c.out, c.time, midi(C3 - 17), true, 0.18);
      },
    },
  ],
  ambience: (inst, out, t) => inst.bed(out, t, { freq: 300, q: 1.4, rate: 0.04, level: 0.08 }),
};

const dawn: ThemeSpec = {
  id: 'dawn',
  stepSeconds: 0.3,
  stepsPerBar: 12,
  plucks: { notes: VILLAGE_NOTES, sustain: 0.997 },
  layers: { 1: [1, 1], 2: [1, 1], 3: [1, 1] },
  stems: [
    { id: 'bourdon', hold: (inst, out, t) => inst.drone(out, t, midi(D3), { cutoff: 600, level: 0.12, breath: 0.06 }) },
    {
      id: 'seperewa',
      step: (c) => {
        if (c.beat % 3 === 0 && c.random() < 0.45) {
          c.inst.pluck(c.out, c.time, pick(VILLAGE_NOTES.slice(3), c.random), 0.22, 0.997, c.random() - 0.5);
        }
        if (c.beat === 0 && c.bar % 2 === 0) c.inst.bell(c.out, c.time, 1100, 0.05);
      },
    },
  ],
};

// ---------------------------------------------------------------- boss

/** Couche 1 : bourdon + pas lourds de l'atumpan (mâle sur 1, femelle sur 7). */
function foundation(root: number, cutoff: number): StemSpec {
  return {
    id: 'fondation',
    hold: (inst, out, t) => inst.drone(out, t, midi(root - 12), { cutoff, level: 0.15, breath: 0.08 }),
    step: (c) => {
      if (c.beat === 0) c.inst.atumpan(c.out, c.time, midi(root - 14), true, 0.55);
      if (c.beat === 6) c.inst.atumpan(c.out, c.time, midi(root - 14), false, 0.42);
      if (c.beat === 9 && c.bar % 2 === 1) c.inst.atumpan(c.out, c.time, midi(root - 14), true, 0.3);
    },
  };
}

/** Couche 2 : cloche en 12/8 + tambours parlants qui « répondent ». */
function talking(root: number): StemSpec {
  return {
    id: 'tambours-parlants',
    step: (c) => {
      if (BELL.has(c.beat)) c.inst.bell(c.out, c.time, 880, c.beat === 0 ? 0.11 : 0.07, 0.3);
      drumCall(c, midi(root - 2), 0.3);
    },
  };
}

/** Couche 3 : ostinato de seperewa, hochet sur chaque croche, roulements d'atumpan. */
function fury(root: number, notes: number[], ostinato: number[]): StemSpec {
  return {
    id: 'fureur',
    step: (c) => {
      const accent = c.beat % 3 === 0;
      c.inst.noiseBurst(c.out, c.time, { level: accent ? 0.07 : 0.035, decay: accent ? 0.07 : 0.04, pan: 0.35 });
      const degree = ostinato[(c.step) % ostinato.length];
      if (degree >= 0) c.inst.pluck(c.out, c.time, notes[degree], accent ? 0.3 : 0.2, 0.994, -0.3);
      if (c.beat >= 9 && c.bar % 2 === 1) {
        c.inst.atumpan(c.out, c.time, midi(root - 14), c.beat % 2 === 0, 0.32 + (c.beat - 9) * 0.06, c.beat % 2 ? 0.2 : -0.2);
      }
    },
  };
}

const duelist: ThemeSpec = {
  id: 'boss-duelist',
  // Croche ≈ 0,227 s : noire pointée à 88.
  stepSeconds: 60 / 88 / 3,
  stepsPerBar: 12,
  plucks: { notes: DUEL_NOTES, sustain: 0.994 },
  layers: { 1: [1, 0.35, 0], 2: [1, 1, 0.4], 3: [1, 1, 1] },
  stems: [
    foundation(D3, 380),
    talking(D3),
    fury(D3, DUEL_NOTES, [0, -1, 3, 2, -1, 4, 0, -1, 3, 5, -1, 4, 0, -1, 2, 3, -1, 1, 0, -1, 3, 4, 6, 4]),
  ],
};

const guardian: ThemeSpec = {
  id: 'boss-guardian',
  lazy: true,
  // Plus lent, plus lourd : l'esprit de l'eau.
  stepSeconds: 60 / 76 / 3,
  stepsPerBar: 12,
  plucks: { notes: GUARDIAN_NOTES, sustain: 0.996 },
  layers: { 1: [1, 0.3, 0], 2: [1, 1, 0.35], 3: [1, 1, 1] },
  stems: [
    foundation(C3 - 2, 300),
    talking(C3 - 2),
    fury(C3 - 2, GUARDIAN_NOTES, [0, -1, -1, 2, -1, 1, 0, -1, -1, 4, -1, 3, 0, -1, -1, 2, -1, 5, 6, -1, 4, 3, -1, 1]),
  ],
  ambience: (inst, out, t) => inst.bed(out, t, { freq: 700, q: 1.1, rate: 0.11, level: 0.07, flutter: 0.6 }),
};

// ---------------------------------------------------------------- chapitre 1 (1701)

/**
 * Feyiase, après la bataille : pas de musique. Le vent dans les hautes
 * branches, des corbeaux au loin, et un fontomfrom crevé qui résonne très
 * sourdement, à intervalles irréguliers.
 */
const feyiase: ThemeSpec = {
  id: 'feyiase',
  stepSeconds: 0.5,
  stepsPerBar: 12,
  plucks: { notes: RIVER_NOTES.slice(5), sustain: 0.99 },
  layers: { 1: [1, 1], 2: [1, 1], 3: [1, 1] },
  stems: [
    {
      id: 'fontomfrom-creve',
      step: (c) => {
        if ((c.bar % 3 === 0 && c.beat === 0) || (c.bar % 7 === 4 && c.beat === 5)) {
          c.inst.atumpan(c.out, c.time, midi(C3 - 21), true, 0.08 + c.random() * 0.04, -0.3);
        }
      },
    },
    {
      id: 'corbeaux',
      step: (c) => {
        if (c.random() < 0.012) {
          const pan = c.random() * 1.6 - 0.8;
          for (let i = 0; i < 2 + Math.floor(c.random() * 2); i++) {
            c.inst.noiseBurst(c.out, c.time + i * 0.24, { level: 0.03, decay: 0.12, freq: 1100 + c.random() * 300, q: 7, pan });
          }
        }
      },
    },
  ],
  // Vent dans les hautes branches : grave, large, en rafales lentes (pas de frémissement d'eau).
  ambience: (inst, out, t) => inst.bed(out, t, { freq: 240, q: 0.35, rate: 0.03, level: 0.06 }),
};

/** Fontomfrom lourd : grosse caisse royale sur les temps forts, réponses graves. */
function fontomfrom(root: number): StemSpec {
  return {
    id: 'fontomfrom',
    hold: (inst, out, t) => inst.drone(out, t, midi(root - 12), { cutoff: 220, level: 0.16, breath: 0.1, fifth: false }),
    step: (c) => {
      if (c.beat === 0 || c.beat === 6) c.inst.atumpan(c.out, c.time, midi(root - 17), true, 0.75);
      if (c.beat === 3 || c.beat === 9) c.inst.atumpan(c.out, c.time, midi(root - 15), false, 0.42);
      if (c.beat === 11 && c.bar % 2) c.inst.atumpan(c.out, c.time, midi(root - 17), true, 0.5, 0.2);
    },
  };
}

/**
 * Duel de la crête : percussions lourdes et oppressantes, cordes graves
 * minimalistes ; à mi-vie (mousquet brisé), les tambours deviennent frénétiques.
 */
const badu: ThemeSpec = {
  id: 'boss-badu',
  stepSeconds: 60 / 96 / 3,
  stepsPerBar: 12,
  plucks: { notes: GUARDIAN_NOTES, sustain: 0.993 },
  layers: { 1: [1, 0.55, 0], 2: [1, 1, 1], 3: [1, 1, 1] },
  stems: [
    fontomfrom(C3 - 2),
    {
      id: 'cordes-graves',
      hold: (inst, out, t) => inst.drone(out, t, midi(C3 - 14), { cutoff: 420, level: 0.12, breath: 0.04, fifth: true }),
      step: (c) => {
        if (c.beat === 0 && c.bar % 2 === 0) c.inst.swell(c.out, c.time, c.stepSeconds * 10, 0.12);
        drumCall(c, midi(C3 - 4), 0.22);
      },
    },
    fury(C3 - 2, GUARDIAN_NOTES, [0, -1, 0, 3, -1, 2, 0, -1, 0, 4, 3, 2, 0, -1, 0, 3, -1, 5, 6, 5, 4, 3, 2, 1]),
  ],
};

export const THEMES: Record<ThemeId, ThemeSpec> = {
  village, river, depths, dawn, 'boss-duelist': duelist, 'boss-guardian': guardian, feyiase, 'boss-badu': badu,
};

/** Courts motifs joués hors mesure, par-dessus la musique. */
export function playSting(id: StingId, inst: Instruments, out: AudioNode, time: number) {
  const root = midi(D3 - 14);
  if (id === 'boss-intro') {
    inst.swell(out, time, 1.4, 0.18);
    inst.atumpan(out, time + 1.4, root, true, 0.9);
    inst.atumpan(out, time + 1.62, root, false, 0.7);
    inst.bell(out, time + 1.4, 700, 0.14);
    inst.talkingDrum(out, time + 1.9, midi(D3 - 2), { level: 0.4, from: 1, to: 1.4, glide: 0.25, decay: 0.45 });
  } else if (id === 'phase') {
    inst.atumpan(out, time, root, true, 0.8, -0.2);
    inst.atumpan(out, time + 0.14, root, true, 0.65, 0.2);
    inst.swell(out, time, 0.5, 0.1);
  } else {
    inst.talkingDrum(out, time, root * 1.4, { level: 0.6, from: 1, to: 0.55, glide: 1.4, decay: 1.8, click: 0.4 });
    inst.bell(out, time + 0.05, 520, 0.08);
  }
}
