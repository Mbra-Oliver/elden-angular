/**
 * Lore des boss, aligné sur le brouillon « L'Ombre du Tabouret d'Or »
 * (royaume asante, 1817–1824). Toutes les chaînes affichées en jeu pour les
 * boss (nom, bannière de phase, réplique) viennent d'ici : si l'histoire
 * change, c'est le seul fichier à réécrire.
 *
 * [À VÉRIFIER] Les détails culturels (asafo, noms de jour, rôle des abosom)
 * sont écrits de mémoire et doivent être relus par une personne akan.
 */

export type BossId = 'duelist' | 'guardian' | 'champion';
export type BossPhase = 1 | 2 | 3;

export interface BossPhaseLore {
  /** Titre court affiché dans la bannière de transition. */
  title: string;
  /** Réplique ou citation affichée sous le titre. */
  line: string;
  /** Ce que la phase change dans le combat (pour le design, pas affiché). */
  design: string;
}

export interface BossLore {
  name: string;
  epithet: string;
  /** Chapitre de l'histoire où le boss apparaît. */
  chapter: string;
  /** Texte de fond, pour un codex ou un écran de chargement. */
  lore: string[];
  phases: Record<BossPhase, BossPhaseLore>;
  /** Seuils de PV (ratio) qui déclenchent les phases 2 et 3. */
  thresholds: [number, number];
}

export const BOSS_LORE: Record<BossId, BossLore> = {
  // Chapitre 1 (prologue, 1701) : personnage inventé ; le roi Ntim Gyakari reste hors champ.
  champion: {
    name: 'Badu Ofosu',
    epithet: 'Porte-hache de Ntim Gyakari',
    chapter: 'Chapitre 1 · 1701 · La crête de Feyiase',
    lore: [
      'Badu Ofosu est le porte-insigne et le bourreau du roi du Denkyira. Quand l’armée s’effondre à Feyiase et que Ntim Gyakari est sur le point d’être pris, il refuse de fuir : il tient seul la crête pour couvrir la retraite des derniers fidèles.',
      'Ce n’est pas un furieux. C’est un vétéran froid, qui jauge son adversaire, économise ses gestes et cherche à briser son rythme. Dans la main droite, une hache de guerre au large fer courbe, manche cerclé de laiton ; dans la gauche, un long mousquet de traite.',
      'À mi-combat, quand il comprend que le duel est à mort, il brise la crosse de son mousquet contre la roche et prend sa hache à deux mains.',
    ],
    phases: {
      1: {
        title: 'Le maître d’armes',
        line: '« Approche, Asante. Je t’ai entendu venir depuis le ravin. »',
        design: 'Il garde ses distances : tir de mousquet (1,2 s de visée, 2,5 s de rechargement), double faucheuse, jugement retardé, feinte à la crosse, revers de crosse si on reste dans son dos.',
      },
      2: {
        title: 'La fureur du dernier bastion',
        line: 'Il fracasse la crosse de son mousquet contre la roche et prend sa hache à deux mains.',
        design: 'Il traque sans relâche : sillon d’étincelles, chute du roi, moulinet de quatre coups (puis 1,5 s d’essoufflement), estocade brise-garde, feinte du bond.',
      },
      // Pas de troisième phase : seuil négatif, jamais atteint.
      3: {
        title: 'La fureur du dernier bastion',
        line: '',
        design: 'Inutilisé.',
      },
    },
    thresholds: [0.5, -1],
  },

  duelist: {
    name: 'Kofi Brempong',
    epithet: 'Capitaine asafo du gué',
    chapter: 'Acte I · 1824 · Le gué du Pra en crue',
    lore: [
      'Kofi Brempong commande une compagnie asafo de Cape Coast. Sa compagnie a son drapeau, ses chants et ses morts, et il connaît chacun d’eux par son nom. Son nom dit qu’il est né un vendredi.',
      'En 1824, des rumeurs disent qu’une armée de Kumasi va traverser le Pra pour frapper la côte. Kofi a reçu l’ordre de tenir le gué et de n’y laisser passer personne. Il ne sait pas encore que ces rumeurs viennent d’Okomfo Ampem, ni que ceux qui arrivent sont les familles de Kwabena Ofori, de la lignée de Pokou, qui fuient la guerre comme leur aïeule a fui avant eux.',
      'Il se bat au sabre et à la crosse de son mousquet de traite, les pieds dans l’eau qui monte. Il ne cherche pas la gloire : il veut rentrer avec autant d’hommes qu’il en a emmené. C’est pour cela qu’il finit par baisser son arme et tenir la corde du gué, quand il comprend qui l’a trompé.',
    ],
    phases: {
      1: {
        title: 'Le drapeau de la compagnie',
        line: '« Personne ne traverse. Ce sont les ordres. »',
        design: 'Combat discipliné : coup de sabre, coup de crosse au sol, charge à travers le gué. Longues fenêtres de punition.',
      },
      2: {
        title: 'La poudre mouillée',
        line: '« La crue a noyé ma poudre. Il me reste le sabre. »',
        design: 'Il lâche le mousquet : enchaînements de trois coups, charges suivies d’un coup immédiat. Plus rapide.',
      },
      3: {
        title: 'Le chant de l’asafo',
        line: '« Chantez, mes frères ! Que le fleuve nous entende ! »',
        design: 'Il chante le chant de sa compagnie : moulinet circulaire, charge enchaînée sur un combo. Récupérations courtes.',
      },
    },
    thresholds: [0.66, 0.33],
  },

  guardian: {
    name: 'Le Gardien noyé',
    epithet: 'Esprit lié par Okomfo Ampem',
    chapter: 'Acte II · 1874 · L’ancienne retenue',
    lore: [
      'Les anciens racontaient qu’une créature de pierre et d’eau gardait les gués du Pra, là où les morts traversent pour la dernière fois. Ils ne lui donnaient pas de nom, seulement des offrandes. Ce n’est pas un dieu : c’est un gardien au service du fleuve.',
      'En 1824, Okomfo Ampem a volé son nom secret et l’a noué dans une corde à trois nœuds. Kwabena n’a pas pu le libérer : il l’a noyé sous la digue que les familles du gué ont bâtie, et la corde du gué sert depuis à surveiller l’eau. En 1874, le conseil du village détourne le canal, la chambre s’assèche, et le Gardien se réveille, toujours lié.',
      'Ama Serwaa ne doit pas le tuer mais le libérer. Chaque nœud qui cède lui rend une part de sa colère, et une part de lui-même. Quand le troisième tombe, le Gardien retourne au fleuve.',
    ],
    phases: {
      1: {
        title: 'Premier nœud · La chambre asséchée',
        line: '« Il frappe trois fois avant de se lever. » — Nana Yaa Dufie',
        design: 'Pinces écrasées au sol, ruée, vague circulaire. Après la vague, sa carapace s’ouvre : c’est la fenêtre pour frapper.',
      },
      2: {
        title: 'Deuxième nœud · L’eau se soulève',
        line: 'L’eau de la retenue répond à son appel. Deux vagues, puis une troisième qui ne vient pas.',
        design: 'Double vague (deux esquives à rythmer), combo de pinces. La carapace ne s’ouvre qu’après la double vague.',
      },
      3: {
        title: 'Troisième nœud · Le nom volé',
        line: '« Rends-lui son nom, et il rentrera chez lui. » — chant de Kwabena',
        design: 'Tourbillon sur lui-même, vague enchaînée sur une ruée. Plus agressif, mais chaque ouverture dure aussi longtemps.',
      },
    },
    thresholds: [0.66, 0.33],
  },
};
