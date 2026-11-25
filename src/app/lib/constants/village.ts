export const BATTLE = { x: 655, y: 355, name: 'Acte I · 1824 · Le gué du Pra' };
export const CROSSING = { x: 390, y: 350, name: 'Gué du Pra' };

export const VILLAGE_STOPS = [
  { x: 820, y: 780, name: 'Place du Goli' },
  { x: 1110, y: 580, name: 'Cour de l’Adjanou' },
] as const;

export const CLEARING = { x: 1472, y: 792, name: 'Ancienne retenue' };
export const GATE = { x: 1280, y: 792, name: 'Vanne de l’ancienne retenue' };

// Les dialogues sont en JSON : src/app/lib/data/dialogues.json (moteur : services/dialogue-tree.ts).
export type { Dialogue, DialogueChoice } from '../services/dialogue-tree';
