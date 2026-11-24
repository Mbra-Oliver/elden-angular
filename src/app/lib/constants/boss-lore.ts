/**
 * Lore des boss, aligné sur le brouillon « L'Ombre du Tabouret d'Or »
 * (royaume asante, 1817–1824). Toutes les chaînes affichées en jeu pour les
 * boss (nom, bannière de phase, réplique) viennent d'ici : si l'histoire
 * change, c'est le seul fichier à réécrire.
 *
 * [À VÉRIFIER] Les détails culturels (asafo, noms de jour, rôle des abosom)
 * sont écrits de mémoire et doivent être relus par une personne akan.
 */

export type BossId = 'duelist' | 'guardian';
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
  duelist: {
    name: 'Kofi Brempong',
    epithet: 'Capitaine asafo du gué',
    chapter: 'Chapitre 5 · Le gué du Pra en crue',
    lore: [
      'Kofi Brempong commande une compagnie asafo de Cape Coast. Sa compagnie a son drapeau, ses chants et ses morts, et il connaît chacun d’eux par son nom. Son nom dit qu’il est né un vendredi.',
      'En 1824, des rumeurs disent que l’Asante prépare un massacre sur la côte. Kofi a reçu l’ordre de tenir le gué du Pra et de n’y laisser passer aucun homme de Kumasi. Il ne sait pas encore que ces rumeurs viennent d’Okomfo Ampem, ni que les fusils qu’on lui a promis sortent du même marché.',
      'Il se bat au sabre et à la crosse de son mousquet de traite, les pieds dans l’eau qui monte. Il ne cherche pas la gloire : il veut rentrer avec autant d’hommes qu’il en a emmené. C’est pour cela qu’il finit par baisser son arme, quand il comprend qui l’a trompé.',
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
    chapter: 'Chapitre 2 · Le lac des adieux',
    lore: [
      'Sur la rive du lac Bosomtwe, on raconte que les âmes des morts viennent dire adieu avant de partir. Une créature de pierre et d’eau gardait ce passage pour qu’aucun vivant ne les dérange. Les anciens ne lui donnaient pas de nom, seulement des offrandes. Ce n’est pas un dieu : c’est un gardien au service du lac.',
      'Okomfo Ampem a volé son nom secret et l’a noué dans une corde à trois nœuds. Tant que les nœuds tiennent, le Gardien obéit et frappe ceux qui approchent. Chaque nœud qui cède lui rend une part de sa colère, et une part de lui-même.',
      'Il ne faut pas le tuer mais le libérer. Quand le troisième nœud tombe, le Gardien retourne sous l’eau, et la rive redevient silencieuse.',
    ],
    phases: {
      1: {
        title: 'Premier nœud · La rive des adieux',
        line: '« Il frappe trois fois avant de se lever. » — Nana Yaa Dufie',
        design: 'Pinces écrasées au sol, ruée, vague circulaire. Après la vague, sa carapace s’ouvre : c’est la fenêtre pour frapper.',
      },
      2: {
        title: 'Deuxième nœud · L’eau se soulève',
        line: 'Le lac répond à son appel. Deux vagues, puis une troisième qui ne vient pas.',
        design: 'Double vague (deux esquives à rythmer), combo de pinces. La carapace ne s’ouvre qu’après la double vague.',
      },
      3: {
        title: 'Troisième nœud · Le nom volé',
        line: '« Rends-lui son nom, et il rentrera chez lui. » — Akua Serwaa',
        design: 'Tourbillon sur lui-même, vague enchaînée sur une ruée. Plus agressif, mais chaque ouverture dure aussi longtemps.',
      },
    },
    thresholds: [0.66, 0.33],
  },
};
