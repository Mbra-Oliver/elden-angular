export interface AdinkraSign {
  glyph: string;
  name: string;
  meaning: string;
}

export const ADINKRA: Record<string, AdinkraSign> = {
  sankofa: { glyph: '◉', name: 'Sankofa', meaning: 'revenir chercher ce qui fut oublié' },
  akofena: { glyph: '⋔', name: 'Akofena', meaning: 'l’épée d’État, le courage' },
  gye: { glyph: '◇', name: 'Gye Nyame', meaning: 'rien n’est au-dessus du Créateur' },
  nyansapo: { glyph: '⌘', name: 'Nyansapo', meaning: 'la sagesse noue les mots' },
  woniantwaa: { glyph: '⊗', name: 'Woniantwaa', meaning: 'le pont entre les vivants et les ancêtres' },
};

const BY_ENTRY: Record<string, keyof typeof ADINKRA> = {
  'remains:kwasi': 'akofena',
  'remains:traces': 'woniantwaa',
  'remains:fusil': 'akofena',
  'remains:archer': 'nyansapo',
  'remains:ruisseau': 'gye',
  'remains:ligne': 'akofena',
  'remains:gourde': 'gye',
  'remains:tambours': 'nyansapo',
  'remains:awale': 'nyansapo',
  'remains:sanctuaire': 'gye',
  'remains:talisman': 'sankofa',
  'remains:tambourinaire': 'woniantwaa',
  'item:afena': 'akofena',
  'item:perle': 'sankofa',
  'item:calebasse': 'woniantwaa',
  'boss:champion': 'akofena',
};

export const ANCESTRAL_THREAD: Record<string, string> = {
  'remains:talisman': 'Kwadwo Ofori · 1701',
  'remains:tambourinaire': 'Kwadwo Ofori · 1701',
  'remains:gourde': 'Kwadwo Ofori · 1701',
  'item:perle': 'Kwabena Ofori · 1824',
  'item:calebasse': 'Ama Serwaa · 1874',
  'item:afena': 'Le fil passe de Kwadwo à Ama Serwaa',
};

export const THREAD_LINE = 'Kwadwo Ofori (1701) → Kwabena Ofori (1824) → Ama Serwaa (1874)';

export function adinkraFor(id: string): AdinkraSign | undefined {
  const key = BY_ENTRY[id];
  return key ? ADINKRA[key] : undefined;
}
