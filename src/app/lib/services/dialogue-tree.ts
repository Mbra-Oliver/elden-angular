import data from '../data/dialogues.json';

/**
 * Arbres de dialogue stockés en JSON (src/app/lib/data/dialogues.json).
 *
 * - `if` : conditions sur les drapeaux de partie ; toutes doivent être vraies.
 *   Une valeur `false` est satisfaite par un drapeau absent.
 * - `set` : drapeaux posés quand le joueur prend ce choix.
 * - `variants` : textes de remplacement ; le premier dont les conditions
 *   sont remplies remplace `text`.
 * Les choix dont les conditions ne sont pas remplies sont masqués.
 */
export type FlagValue = string | number | boolean | null;
export type Flags = Readonly<Record<string, FlagValue>>;
export type Conditions = Readonly<Record<string, FlagValue>>;

export type DialogueAction = 'cross' | 'leave' | 'seal' | 'expose' | 'expedition';

export interface DialogueChoice {
  label: string;
  next?: string;
  action?: DialogueAction;
  if?: Conditions;
  set?: Conditions;
}

export interface Dialogue {
  speaker: string;
  text: string;
  choices: DialogueChoice[];
  variants?: { if: Conditions; text: string }[];
}

export const DIALOGUES = (data as unknown as { nodes: Record<string, Dialogue> }).nodes;

export function conditionsMet(conditions: Conditions | undefined, flags: Flags) {
  if (!conditions) return true;
  return Object.entries(conditions).every(([key, expected]) =>
    expected === false ? !flags[key] : flags[key] === expected);
}

/** Nœud prêt à afficher : variante de texte choisie, choix filtrés. */
export function resolveDialogue(id: string, flags: Flags, nodes: Record<string, Dialogue> = DIALOGUES): Dialogue | null {
  const node = nodes[id];
  if (!node) return null;
  const variant = node.variants?.find((v) => conditionsMet(v.if, flags));
  return {
    speaker: node.speaker,
    text: variant?.text ?? node.text,
    choices: node.choices.filter((choice) => conditionsMet(choice.if, flags)),
  };
}
