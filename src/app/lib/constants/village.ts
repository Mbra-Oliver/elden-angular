export const BATTLE = { x: 655, y: 355, name: 'Prologue · Le passage de l’Ouest' };
export const CROSSING = { x: 390, y: 350, name: 'Gué de l’Ouest' };

export const VILLAGE_STOPS = [
  { x: 820, y: 780, name: 'Place du Goli' },
  { x: 1110, y: 580, name: 'Cour de l’Adjanou' },
] as const;

export const CLEARING = { x: 1472, y: 792, name: 'Ancienne retenue' };
export const GATE = { x: 1280, y: 792, name: 'Vanne de l’ancienne retenue' };

export interface DialogueChoice {
  label: string;
  next?: string;
  action?: 'cross' | 'leave' | 'seal' | 'expose';
}

export interface Dialogue {
  speaker: string;
  text: string;
  choices: DialogueChoice[];
}

export const DIALOGUES: Record<string, Dialogue> = {
  crossing: {
    speaker: 'Kwadwo',
    text: 'On m’a dit de ramener des traîtres. Mon frère est là, au milieu de l’eau, avec deux enfants sur les bras. Donne-moi un bout de la corde. Je tiendrai ce côté pendant que tu traverses.',
    choices: [{ label: 'Lui confier la corde et guider les familles', action: 'cross' }],
  },
  kouame: {
    speaker: 'Kouamé',
    text: 'Le Goli devait commencer au coucher du soleil. On a rangé les tambours quand l’eau du puits a pris la couleur du fer. Le conseil accuse Yao d’avoir fendu la digue avec sa houe. Sa mère est morte ce matin sans avoir pu lui parler. Si on le chasse, il ne pourra même pas lui dire adieu.',
    choices: [
      { label: 'Qu’est-ce que tu as vu, toi ?', next: 'doubt' },
      { label: 'Qu’est-ce que cette corde fait là ?', next: 'shelter' },
    ],
  },
  doubt: {
    speaker: 'Kouamé',
    text: 'J’ai reconnu sa houe, oui. Mais elle était plantée dans le talus, comme un repère. En dessous, j’ai entendu frapper trois fois. Le vieux carnet d’Ama parle de ce bruit. Va montrer le carnet à Aya.',
    choices: [{ label: 'Porter le carnet à Aya', action: 'leave' }],
  },
  shelter: {
    speaker: 'Kouamé',
    text: 'C’est un bout de la corde du gué. J’ai grandi avec l’histoire d’Ama terrassant son ennemi. Son carnet dit autre chose. Kwadwo a lâché son arme et pris l’autre bout de la corde. Personne ne raconte jamais sa part. Montre le carnet à Aya.',
    choices: [{ label: 'Aller parler à Aya', action: 'leave' }],
  },
  aya: {
    speaker: 'Aya',
    text: 'Yao avait aperçu des piquets neufs dans le lit du canal. Il a utilisé sa houe pour marquer la brèche avant de remonter une enfant tombée dans le fossé. Dans sa manche, j’ai trouvé cette planche. Approche-la de la lampe.',
    choices: [
      { label: 'Examiner la planche', next: 'mark' },
      { label: 'Que dit sa sœur ?', next: 'oya' },
    ],
  },
  oya: {
    speaker: 'Aya',
    text: 'Yao est ici avec sa petite sœur. Le conseil a demandé le silence jusqu’à ce que les familles quittent la cour de l’Adjanou. Sa sœur veut parler elle-même. Elle dit que des hommes du conseil creusaient déjà là-bas hier soir.',
    choices: [{ label: 'Examiner la planche', next: 'mark' }],
  },
  mark: {
    speaker: 'Aya',
    text: 'Le sceau du conseil. Ils ont détourné l’eau vers leurs parcelles et mis à sec la chambre sous la digue. Regarde le carnet : Ama l’avait noyée pour y enfermer ce qu’elle appelait la Veille. Depuis, la corde du gué servait à vérifier le niveau de l’eau. Tant qu’elle restait mouillée au troisième nœud, la Veille dormait.',
    choices: [{ label: 'Retrouver Yao à la vanne', action: 'leave' }],
  },
  gate: {
    speaker: 'Yao',
    text: 'Mon père a fait ouvrir le canal. Je l’ai entendu ordonner qu’on retire les piquets. Si on taille la planche pour remplacer le levier cassé, on peut rouvrir la vanne tout de suite. Le sceau va partir avec les copeaux, mais l’eau affaiblira la Veille. Sinon, je peux dégager la vanne à la main pendant que tu l’occupes. Ça prendra plus longtemps. À toi de choisir ce qu’on risque.',
    choices: [
      { label: 'Tailler la planche et rouvrir la vanne', action: 'seal' },
      { label: 'Garder le sceau comme preuve', action: 'expose' },
    ],
  },
};
