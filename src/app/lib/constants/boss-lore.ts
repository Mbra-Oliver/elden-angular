/**
 * Lore des boss, aligné sur le brouillon « L'Ombre du Tabouret d'Or »
 * (royaume asante, 1817–1824). Toutes les chaînes affichées en jeu pour les
 * boss (nom, bannière de phase, réplique) viennent d'ici : si l'histoire
 * change, c'est le seul fichier à réécrire.
 *
 * [À VÉRIFIER] Les détails culturels (asafo, noms de jour, rôle des abosom)
 * sont écrits de mémoire et doivent être relus par une personne akan.
 */

export type BossId = 'duelist' | 'guardian' | 'champion'
  | 'sentinel' | 'hunter' | 'harvester' | 'oracle' | 'berserker'
  | 'tideholder' | 'ashafo' | 'ironmouth' | 'nightblade';
export type BossPhase = 1 | 2 | 3;
export type BossForm = 'human' | 'guardian';

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
    epithet: 'Porte-glaive de Ntim Gyakari',
    chapter: 'Chapitre 1 · 1701 · La crête de Feyiase',
    lore: [
      'Badu Ofosu est l’afenasoafo, le porte-glaive du roi du Denkyira : il porte l’afena royal aux audiences et il exécute ses sentences. Quand l’armée s’effondre à Feyiase et que Ntim Gyakari est sur le point d’être pris, il refuse de fuir : il tient seul la crête pour couvrir la retraite des derniers fidèles.',
      'Ce n’est pas un furieux. C’est un vétéran froid, qui jauge son adversaire, économise ses gestes et cherche à briser son rythme. Il porte le batakari de guerre teint à l’indigo, couvert de talismans cousus, et la calotte de cuir à disque d’or de sa charge. Dans la main droite, l’afena du roi, sabre à lame large et poignée dorée ; dans la gauche, un long mousquet de traite.',
      'À mi-combat, quand il comprend que le duel est à mort, il brise la crosse de son mousquet contre la roche et prend l’afena à deux mains.',
    ],
    phases: {
      1: {
        title: 'Le maître d’armes',
        line: '« Approche, Asante. Je t’ai entendu venir depuis le ravin. »',
        design: 'Il garde ses distances : tir de mousquet (1,2 s de visée, 2,5 s de rechargement), double faucheuse, jugement retardé, feinte à la crosse, revers de crosse si on reste dans son dos.',
      },
      2: {
        title: 'La fureur du dernier bastion',
        line: 'Il fracasse la crosse de son mousquet contre la roche et prend l’afena à deux mains.',
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

  sentinel: {
    name: 'La Sentinelle de la digue',
    epithet: 'Gardienne du dernier seuil',
    chapter: 'Épreuve · Le seuil noyé',
    lore: [
      'Avant la retenue, une sentinelle veillait sur le passage où l’eau change de nom. On lui parlait sans la regarder.',
      'Elle frappe le sol pour annoncer sa colère, puis laisse l’eau monter d’un cran à chaque blessure.',
    ],
    phases: {
      1: { title: 'Le seuil fermé', line: '« Le passage est compté. »', design: 'Pinces, ruée, vague courte.' },
      2: { title: 'L’eau répond', line: 'La digue gémit sous une seconde vague.', design: 'Double vague et combo de pinces.' },
      3: { title: 'Le nom retrouvé', line: '« Je me souviens maintenant. »', design: 'Tourbillon, vague enchaînée sur la ruée.' },
    },
    thresholds: [0.66, 0.33],
  },

  hunter: {
    name: 'Osei Kwantwi',
    epithet: 'Chasseur du Pra',
    chapter: 'Épreuve · La piste du gué',
    lore: [
      'Osei connaît chaque sentier du fleuve et ne court jamais deux fois de la même manière.',
      'Il teste la garde du joueur par charges courtes, puis punit les esquives trop tôt.',
    ],
    phases: {
      1: { title: 'Le premier pas', line: '« Je t’ai suivi depuis l’autre rive. »', design: 'Sabre, crosse, charge.' },
      2: { title: 'La piste se referme', line: '« Tu cours déjà moins vite. »', design: 'Combo de trois coups et charge enchaînée.' },
      3: { title: 'La dernière piste', line: '« Il n’y a plus de sortie. »', design: 'Moulinet circulaire et charges répétées.' },
    },
    thresholds: [0.66, 0.33],
  },

  harvester: {
    name: 'Kwame Adjei',
    epithet: 'Faucheur des rizières',
    chapter: 'Épreuve · Les champs coupés',
    lore: [
      'Kwame tient une faux courbe dont le tranchant suit le mouvement du poignet plus que de l’épaule.',
      'Il fauche les jambes, puis relève la lame pour tracer des sillons de lumière.',
    ],
    phases: {
      1: { title: 'La lame basse', line: '« Les herbes ne demandent pas pardon. »', design: 'Fauche, jugement retardé, faux coups.' },
      2: { title: 'Le sillon', line: 'Le sol s’illumine sous la faux.', design: 'Sillon d’étincelles et faux bond.' },
      3: { title: 'La moisson', line: '« Rien ne repousse ici. »', design: 'Moulinet de quatre coups et estocade.' },
    },
    thresholds: [0.66, 0.33],
  },

  oracle: {
    name: 'Abena Nyame',
    epithet: 'Voix du tabouret',
    chapter: 'Épreuve · La chambre des nœuds',
    lore: [
      'Abena parle au nom d’un tabouret vide et tire ses réponses d’un mousquet à canon long.',
      'Ses tirs sont lents, mais chaque détonation désigne la place où elle veut vous voir.',
    ],
    phases: {
      1: { title: 'La question', line: '« Reste où tu es. Je décide. »', design: 'Tir long, jugement retardé, feinte.' },
      2: { title: 'La réponse', line: 'La poudre éclaire son visage.', design: 'Tirs croisés, estocade, faux départs.' },
      3: { title: 'Le verdict', line: '« Le tabouret a parlé. »', design: 'Tir, bond, moulinet court.' },
    },
    thresholds: [0.7, 0.35],
  },

  berserker: {
    name: 'Yaw Ataa',
    epithet: 'Fureur du tambour',
    chapter: 'Épreuve · Le tambour sans peau',
    lore: [
      'Yaw frappe en cadence, comme si un tambour invisible lui dictait ses pas.',
      'Il encaisse pour frapper plus fort ; le rythme s’accélère quand sa garde cède.',
    ],
    phases: {
      1: { title: 'Le battement', line: '« Un. Deux. Frappe. »', design: 'Slam, charge, combo court.' },
      2: { title: 'Le déchaînement', line: 'Le tambour oublie la mesure.', design: 'Balayage, moulinet, charge.' },
      3: { title: 'La dernière mesure', line: '« Encore ! Encore ! »', design: 'Toutes les armes, récupérations courtes.' },
    },
    thresholds: [0.6, 0.28],
  },

  tideholder: {
    name: 'Le Porteur de crue',
    epithet: 'Esprit du débordement',
    chapter: 'Épreuve · Le fleuve à revers',
    lore: [
      'Le Porteur marche dans l’eau jusqu’aux épaules et soulève la rivière d’un geste du coude.',
      'Il ne poursuit pas : il attend que la crue vienne à vous.',
    ],
    phases: {
      1: { title: 'La montée', line: 'L’eau entoure vos chevilles.', design: 'Vague simple, pince, ruée.' },
      2: { title: 'Le débord', line: 'La crue entre dans la poitrine.', design: 'Double vague, combo, charge.' },
      3: { title: 'Le retour au fleuve', line: '« Rends-moi mon nom. »', design: 'Tourbillon et vague enchaînée.' },
    },
    thresholds: [0.66, 0.33],
  },

  ashafo: {
    name: 'Nana Kweku Asafo',
    epithet: 'Tambour de la compagnie',
    chapter: 'Épreuve · Le drapeau trempé',
    lore: [
      'Kweku porte le drapeau de sa compagnie trempé dans la crue du Pra.',
      'Chaque chant appelle un pas différent : le sien reste toujours une demi-mesure en avance.',
    ],
    phases: {
      1: { title: 'Le chant court', line: '« Suivez le drapeau. »', design: 'Sabre, combo, charge.' },
      2: { title: 'Le refrain', line: 'Les tambours répondent du gué.', design: 'Balayage, charge enchaînée.' },
      3: { title: 'Le chant de guerre', line: '« Le fleuve entendra notre nom. »', design: 'Moulinet et combo sans répit.' },
    },
    thresholds: [0.66, 0.33],
  },

  ironmouth: {
    name: 'Le Bouche-de-fer',
    epithet: 'Masque de la retenue',
    chapter: 'Épreuve · La chambre basse',
    lore: [
      'Un masque de fer scelle la bouche de ce gardien ; on ne l’entend qu’avant le coup.',
      'Il charge en aveugle, puis laisse le masque résonner pour annoncer la vague.',
    ],
    phases: {
      1: { title: 'Le masque', line: 'Un seul bruit : le fer.', design: 'Pince, charge, slam.' },
      2: { title: 'La résonance', line: 'Le masque hurle sous la voûte.', design: 'Double vague et combo.' },
      3: { title: 'La fente', line: 'Le fer se brise enfin.', design: 'Balayage, vague, ruée.' },
    },
    thresholds: [0.64, 0.3],
  },

  nightblade: {
    name: 'Kofi Nsunu',
    epithet: 'Lame de la nuit',
    chapter: 'Épreuve · Le sentier sans lune',
    lore: [
      'Nsunu frappe les yeux fermés, guidé par le bruit du pagne et le souffle de sa cible.',
      'Il change de main entre chaque feinte et punit quiconque anticipe trop tôt.',
    ],
    phases: {
      1: { title: 'Le pas muet', line: '« Je t’entends respirer. »', design: 'Sabre, feinte, revers.' },
      2: { title: 'L’ombre courte', line: 'La lame change de main.', design: 'Estocade, bond, faux coup.' },
      3: { title: 'La nuit fermée', line: '« Ne regarde pas. Écoute. »', design: 'Moulinet, jugement, combo.' },
    },
    thresholds: [0.68, 0.34],
  },
};

export const BOSS_FORM: Record<BossId, BossForm> = {
  duelist: 'human', champion: 'human',
  guardian: 'guardian', sentinel: 'guardian', tideholder: 'guardian', ironmouth: 'guardian',
  hunter: 'human', harvester: 'human', oracle: 'human', berserker: 'human', ashafo: 'human', nightblade: 'human',
};
