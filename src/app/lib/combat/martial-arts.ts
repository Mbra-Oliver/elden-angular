/**
 * Arts martiaux d'Ama : gardes, prises et techniques de la lance et de
 * l'afena, sous forme de poses clés lues par engine/martial-arts-3d.ts.
 *
 * Sources de mouvement (synthèse, pas de reproduction de formes précises) :
 * - Lance chinoise (qiang) : garde moyenne (zhong ping), la main arrière tient
 *   le talon contre la hanche, la main avant guide sans serrer ; le coup
 *   d'estoc (zha) part des hanches, la main arrière pousse la hampe qui
 *   coulisse dans la main avant, avec une vrille finale ; le petit cercle de
 *   pointe (lan / na) écarte l'arme adverse juste avant l'estoc ; l'estoc à
 *   une main lâche la main avant pour l'allonge maximale.
 * - Sōjutsu / bōjutsu : la hampe est une arme à deux bouts ; les mains
 *   glissent pour changer d'allonge, le talon frappe en remontant (gyaku),
 *   la garde change de côté en un pas.
 * - Lance européenne (HEMA) : prise large pour les frappes descendantes,
 *   le poids du corps tombe avec la frappe.
 * - Lances d'Afrique de l'Ouest : lance de chasse portée d'une main à
 *   l'équilibre, lame large qui sert aussi à trancher.
 * - Épée courte à une main (afena, sabre court) : pied et épaule de l'arme
 *   devant, main libre qui protège la poitrine ou part en arrière pour
 *   l'équilibre dans la fente.
 *
 * Repère des poses : « repère du regard » (racine du joueur tournée vers où
 * il regarde), +z devant, +y en haut, x < 0 côté bras/jambe d'indice 0.
 * Pour la lance, le côté x < 0 mène (pied et main avant), la main d'arme
 * (indice 1, x > 0) tient le talon ; pour l'afena c'est l'inverse.
 *
 * Canaux :
 *   corps  rX rY rZ (buste, rY relatif au regard), tY (hauteur du buste),
 *          hY (rotation des hanches = garde de profil)
 *   jambes lLx lLz lRx lRz (pas, fente, écart)
 *   arme   hx hy hz (main d'arme), yw pt ro (cap, inclinaison, vrille de
 *          l'arme), gm go (où chaque main tient le fût), kM kO (main sur
 *          l'arme 0→1)
 *   main libre  oX oY oZ oE (épaule, coude) quand elle lâche l'arme
 *   poids  wT wL wF : part du buste, des jambes et du bras libre prise à
 *          l'animateur de base (0 = on laisse la marche, les esquives… faire)
 */

export const ART_CHANNELS = [
  'rX', 'rY', 'rZ', 'tY', 'hY',
  'lLx', 'lLz', 'lRx', 'lRz',
  'hx', 'hy', 'hz', 'yw', 'pt', 'ro', 'gm', 'go', 'kM', 'kO',
  'oX', 'oY', 'oZ', 'oE',
  'wT', 'wL', 'wF',
] as const;
export type ArtChannel = typeof ART_CHANNELS[number];
export type ArtPose = Partial<Record<ArtChannel, number>>;

export interface Technique {
  /** Fin de l'anticipation (fin du windup). */
  a: ArtPose;
  /** Fin de l'impact (fin des frames actives). */
  s: ArtPose;
  /** Petit cercle de pointe pendant l'anticipation (lan / na), en radians. */
  circle?: number;
}

export interface WeaponArt {
  /** Bornes du fût où une main peut tenir (coordonnée le long de l'arme, 0 = origine de l'arme). */
  gripMin: number;
  gripMax: number;
  /** +1 : la main libre tient plus près de la pointe ; -1 : plus près du pommeau. */
  order: 1 | -1;
  /** Écart minimal entre les deux mains. */
  minGap: number;
  rest: ArtPose;
  guard: ArtPose;
  sprint: ArtPose;
  roll: ArtPose;
  exhausted: ArtPose;
  dead: ArtPose;
  techniques: Record<string, Technique>;
}

/** Bras libre en garde : main ouverte devant la poitrine. */
const CHECK_HAND: ArtPose = { oX: -1.0, oY: 0.4, oZ: -0.2, oE: -1.5 };

/**
 * Lance (hampe de 45, lame de 22,5 à 27). Combo : estoc → talon montant
 * avec changement de garde → estoc fendu à une main.
 */
export const SPEAR_ART: WeaponArt = {
  gripMin: -22, gripMax: 18, order: 1, minGap: 2.6,
  // Hors combat : garde de marche, relâchée. Les deux mains sur le fût (main
  // d'arme à la hanche près du talon, main avant à hauteur de poitrine), lance
  // inclinée pointe devant, hanches à demi de profil, pieds légèrement décalés.
  // La marche reprend les jambes (voir 'moving' dans martial-arts-3d.ts).
  rest: { rX: 0.06, rY: 0.28, rZ: 0, tY: -0.4, hY: 0.42,
    lLx: -0.12, lLz: -0.08, lRx: 0.1, lRz: 0.08,
    hx: 2, hy: 16, hz: -0.5, yw: -0.12, pt: 0.26, ro: 0, gm: -18.5, go: -7, kM: 1, kO: 1,
    oX: 0, oY: 0, oZ: 0, oE: -0.2, wT: 0.7, wL: 1, wF: 0 },
  // Garde moyenne de profil : talon à la hanche, pointe à hauteur de gorge.
  guard: { rX: 0.12, rY: 0.35, rZ: 0, tY: -0.8, hY: 0.5,
    lLx: -0.42, lLz: -0.12, lRx: 0.36, lRz: 0.12,
    hx: 1.5, hy: 16.5, hz: -1.5, yw: -0.14, pt: 0.17, ro: 0, gm: -19.5, go: -6, kM: 1, kO: 1,
    ...CHECK_HAND, wT: 1, wL: 1, wF: 1 },
  // Course : lance de chasse portée d'une main à l'équilibre, pointe devant.
  sprint: { hY: 0, wT: 0, wL: 0, wF: 0,
    hx: 5.4, hy: 15.5, hz: 1.5, yw: 0.04, pt: 0.12, ro: 0, gm: -4, kM: 1, kO: 0 },
  // Roulade : lance serrée contre le corps, mains rapprochées.
  roll: { hY: 0, wT: 0, wL: 0, wF: 0,
    hx: 3, hy: 17, hz: 2, yw: 0, pt: 0.95, gm: -10, go: -3, kM: 1, kO: 1 },
  // À bout de souffle : pointe vers le sol.
  exhausted: { hY: 0.2, wT: 0, wL: 0, wF: 0,
    hx: 3.5, hy: 15, hz: 3, yw: -0.05, pt: -0.5, gm: -14, go: -3, kM: 1, kO: 1 },
  dead: { hY: 0, wT: 0, wL: 0, wF: 0,
    hx: 4, hy: 13, hz: 3, yw: 0.1, pt: -0.9, gm: -10, kM: 1, kO: 0 },
  techniques: {
    // 1. Lan-na-zha : le poids recule, la pointe décrit un petit cercle qui
    //    écarte l'arme adverse, puis les hanches se ferment et la main
    //    arrière pousse la hampe qui coulisse dans la main avant.
    light0: {
      a: { hY: 0.6, rY: 0.45, rX: 0.02, tY: -1.2, lLx: -0.35, lRx: 0.42,
        hx: 2.6, hy: 16.5, hz: -4, yw: -0.12, pt: 0.2, gm: -19.5, go: -6 },
      s: { hY: 0.25, rY: 0.1, rX: 0.28, tY: -1.6, lLx: -0.7, lLz: -0.1, lRx: 0.62, lRz: 0.1,
        hx: 0.5, hy: 18.8, hz: 6.5, yw: -0.04, pt: 0.06, ro: 1.3, gm: -19.5, go: -6 },
      circle: 0.14,
    },
    // 2. Talon montant : les mains glissent vers le milieu, la lance bascule
    //    (pointe en arrière), le talon remonte vers le menton pendant que le
    //    pied arrière passe devant : changement de garde.
    light1: {
      a: { hY: 0.2, rY: 0.05, rX: -0.05, tY: -1, lLx: -0.2, lRx: 0.3,
        hx: 2.5, hy: 17, hz: 3, yw: 0, pt: 2.72, ro: 0.4, gm: -5, go: 6 },
      s: { hY: -0.25, rY: -0.25, rX: 0.18, tY: -0.6, lLx: 0.35, lLz: -0.08, lRx: -0.45, lRz: 0.08,
        hx: 1, hy: 20.5, hz: 7, yw: 0, pt: 3.5, ro: 0.4, gm: -4, go: 6 },
    },
    // 3. Estoc fendu à une main : les mains reprennent le talon en arrière
    //    (garde du chat, poids derrière), puis grande fente, la main avant
    //    lâche et part en arrière, l'épaule d'arme jetée vers l'avant.
    light2: {
      a: { hY: 0.75, rY: 0.45, rX: -0.08, tY: -1.6, lLx: -0.22, lRx: 0.4,
        hx: 2.8, hy: 16.2, hz: -4.5, yw: -0.1, pt: 0.14, ro: 0, gm: -21.5, go: -8, kO: 1 },
      s: { hY: 0.05, rY: -0.3, rX: 0.38, tY: -2.2, lLx: -0.95, lLz: -0.12, lRx: 0.8, lRz: 0.1,
        hx: 1.5, hy: 18.5, hz: 11, yw: 0.02, pt: 0.03, ro: 1.6, gm: -21.5, go: -8, kO: 0,
        oX: 0.9, oY: -0.2, oZ: -0.6, oE: -0.3 },
    },
    // Lourde : roue au-dessus de la tête en prise large, puis frappe
    //    descendante, le corps tombe avec la hampe (bassin bas, fente).
    heavy: {
      a: { hY: 0.3, rY: 0.25, rX: -0.32, tY: 1.2, lLx: -0.25, lRx: 0.25,
        hx: 1.5, hy: 27.5, hz: -1, yw: 0.1, pt: 2.1, gm: -18, go: -4 },
      s: { hY: 0.25, rY: 0.05, rX: 0.42, tY: -2.4, lLx: -0.8, lLz: -0.22, lRx: 0.65, lRz: 0.22,
        hx: 2, hy: 15.5, hz: 4.5, yw: -0.05, pt: -0.22, gm: -18, go: -6 },
    },
    // Riposte / Percée : la lance serrée pendant la volte, estoc vrillé à la sortie.
    counter: {
      a: { hY: 0.55, rY: 0.4, rX: 0, tY: -1.2, lLx: -0.3, lRx: 0.45,
        hx: 2.5, hy: 17, hz: -3, yw: -0.1, pt: 0.1, gm: -20, go: -10 },
      s: { hY: 0.1, rY: -0.1, rX: 0.28, tY: -1.8, lLx: -0.9, lRx: 0.8,
        hx: 1.5, hy: 18.8, hz: 10, yw: 0, pt: 0.04, ro: 1.5, gm: -20, go: -10 },
    },
  },
};

/**
 * Afena : épée courte à une main (poignée de -1,7 à 1,7, pointe à 13,8).
 * Garde côté arme devant ; combo : taille descendante → revers horizontal
 * → estoc en fente ; lourde à deux mains ; riposte = tourbillon.
 */
export const AFENA_ART: WeaponArt = {
  gripMin: -1.7, gripMax: 1.2, order: -1, minGap: 2.4,
  rest: { hY: 0, wT: 0, wL: 0, wF: 0,
    hx: 5.6, hy: 15.5, hz: 1.5, yw: 0.1, pt: -1.15, ro: 1.57, gm: 0.6, go: -1.7, kM: 1, kO: 0,
    oX: 0, oY: 0, oZ: 0, oE: -0.2 },
  guard: { rX: 0.1, rY: -0.25, rZ: 0, tY: -0.6, hY: -0.45,
    lLx: 0.32, lLz: -0.1, lRx: -0.38, lRz: 0.1,
    hx: 2.4, hy: 18, hz: 10, yw: -0.15, pt: 0.5, ro: 0, gm: 0.6, go: -1.7, kM: 1, kO: 0,
    ...CHECK_HAND, wT: 1, wL: 1, wF: 1 },
  sprint: { hY: 0, wT: 0, wL: 0, wF: 0,
    hx: 5.4, hy: 16, hz: 0, yw: 0.1, pt: -0.9, ro: 1.57, gm: 0.6, kM: 1, kO: 0 },
  roll: { hY: 0, wT: 0, wL: 0, wF: 0,
    hx: 3, hy: 18, hz: 4, yw: 0, pt: 0.9, gm: 0.6, kM: 1, kO: 0 },
  exhausted: { hY: -0.2, wT: 0, wL: 0, wF: 0,
    hx: 4.5, hy: 15.5, hz: 4, yw: 0, pt: -1.0, gm: 0.6, kM: 1, kO: 0 },
  dead: { hY: 0, wT: 0, wL: 0, wF: 0,
    hx: 4.5, hy: 13, hz: 3, yw: 0.2, pt: -1.4, gm: 0.6, kM: 1, kO: 0 },
  techniques: {
    // 1. Taille descendante en diagonale : lame armée haut à l'extérieur,
    //    les hanches tournent et la lame finit bas à l'intérieur.
    light0: {
      a: { hY: -0.15, rY: 0.35, rX: -0.1, tY: 0, lRx: -0.3, lLx: 0.3,
        hx: 5, hy: 27, hz: 1.5, yw: 0.6, pt: 1.9, ro: 0.5 },
      s: { hY: -0.6, rY: -0.5, rX: 0.35, tY: -1.4, lRx: -0.65, lRz: 0.12, lLx: 0.5, lLz: -0.1,
        hx: -1.5, hy: 15.5, hz: 8.5, yw: -0.75, pt: -0.55, ro: 0.5 },
    },
    // 2. Revers horizontal : lame à plat à gauche, puis balayage vers la droite.
    light1: {
      a: { hY: -0.75, rY: -0.55, rX: 0.15, tY: -1, lRx: -0.45, lLx: 0.4,
        hx: -1.5, hy: 19, hz: 7.5, yw: -1.5, pt: 0.15, ro: 1.57 },
      s: { hY: -0.25, rY: 0.25, rX: 0.2, tY: -0.8, lRx: -0.5, lLx: 0.38,
        hx: 6, hy: 20.5, hz: 6.5, yw: 1.35, pt: 0.05, ro: 1.57 },
    },
    // 3. Estoc en fente : main libre tendue devant pour mesurer, puis
    //    grande fente, la main libre part en arrière pour l'équilibre.
    light2: {
      a: { hY: -0.5, rY: -0.1, rX: -0.05, tY: -1.5, lRx: -0.25, lLx: 0.38,
        hx: 5, hy: 19, hz: 0, yw: -0.05, pt: 0.06, ro: 1.57,
        oX: -1.3, oY: 0.2, oZ: -0.1, oE: -0.3 },
      s: { hY: -0.85, rY: -0.55, rX: 0.4, tY: -2.3, lRx: -0.95, lRz: 0.1, lLx: 0.82, lLz: -0.1,
        hx: 0.3, hy: 18, hz: 15.2, yw: 0, pt: 0.02, ro: 1.57,
        oX: 1.0, oY: -0.3, oZ: -0.7, oE: -0.2 },
    },
    // Lourde : taille à deux mains de haut en bas, épaules de face.
    heavy: {
      a: { hY: -0.3, rY: 0, rX: -0.32, tY: 1.2, lRx: -0.25, lLx: 0.25,
        hx: 0.8, hy: 29, hz: 0, yw: 0, pt: 1.95, ro: 0, kO: 1 },
      s: { hY: -0.2, rY: 0.2, rX: 0.45, tY: -2.4, lRx: -0.8, lRz: 0.2, lLx: 0.65, lLz: -0.2,
        hx: 0.3, hy: 16, hz: 9.8, yw: -0.05, pt: -0.55, ro: 0, kO: 1 },
    },
    // Riposte / Tourbillon : lame à plat, bras tendu pendant la volte.
    counter: {
      a: { hY: -0.75, rY: -0.55, rX: 0.1, tY: -1, lRx: -0.4, lLx: 0.4,
        hx: -1.5, hy: 19, hz: 7, yw: -1.5, pt: 0.1, ro: 1.57 },
      s: { hY: -0.2, rY: 0.3, rX: 0.15, tY: -1.2, lRx: -0.5, lLx: 0.4,
        hx: 6.5, hy: 20, hz: 5.5, yw: 1.45, pt: 0, ro: 1.57 },
    },
  },
};
