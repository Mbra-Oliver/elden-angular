import type * as T from 'three';
import type { Outfit } from './human-body';

/**
 * Tenues posées sur le corps humain commun (human-body.ts). Même corps pour
 * tous, seule la tenue change. Époque et culture : pagnes, cuir, coton teint ;
 * ni cape, ni armure de métal.
 * [SUPPOSITION] Couleurs choisies à l'œil.
 */

type Material = (color: string) => T.Material;

/** Kwadwo Ofori (1701) : pagne brun noué, bandoulière, brassards, sandales, crâne ras, scarifications. */
export function kwadwoOutfit(m: Material): Outfit {
  return {
    wrap: { material: m('#a7743f'), band: m('#8a5a30'), flap: true, hem: 10.0 },
    strap: m('#6e3a1f'),
    cuffs: m('#7f4122'),
    sandals: m('#5e321c'),
    hair: m('#17100d'),
    scars: m('#8d5b45'),
  };
}

/** Badu Ofosu : pagne de guerre sombre à pan rouge, ceinture, bandoulière, bracelets, scarifications. */
export function baduOutfit(m: Material, loincloth: T.Material): Outfit {
  return {
    wrap: { material: loincloth, band: m('#6e1f17'), flap: true, hem: 9.6 },
    belt: m('#2e1d13'),
    strap: m('#2e1d13'),
    armbands: m('#2e1d13'),
    cuffs: m('#2e1d13'),
    sandals: m('#2e1d13'),
    hair: m('#17100d'),
    scars: m('#2a1610'),
  };
}

/** Pagne simple d'une couleur donnée (villageois, figurants). */
export function plainOutfit(m: Material, cloth: string, accent?: string): Outfit {
  return {
    wrap: { material: m(cloth), band: accent ? m(accent) : undefined, hem: 10.6 },
    hair: m('#17100d'),
  };
}

/** Variantes des soldats et adversaires (même corps, tenue propre). */
export type SoldierKind = 'pilleur' | 'fusilier' | 'noye' | 'eclaireur' | 'lancier' | 'tireur' | 'garde';

export function soldierOutfit(m: Material, kind: SoldierKind, cloth: T.Material): Outfit {
  const leather = m('#3c2a1d');
  const hair = m('#17100d');
  switch (kind) {
    case 'eclaireur':
      // Éclaireur : pagne court, brassards, pieds nus (léger et rapide).
      return { wrap: { material: cloth, hem: 11.4 }, cuffs: leather, hair };
    case 'lancier':
      // Lancier : pagne, bandoulière, bracelets de bras.
      return { wrap: { material: cloth, flap: true, hem: 10.2 }, strap: leather, armbands: m('#6b5a3a'), sandals: leather, hair };
    case 'tireur':
    case 'fusilier':
      // Tireur : ceinture de poudre (gourdes et poire posées par slice-3d), bandoulière de balles.
      return { wrap: { material: cloth, hem: 10.4 }, belt: leather, strap: m('#2e1f15'), sandals: leather, hair };
    case 'garde':
      // Garde d'élite : pagne long, ceinture et bracelets, sandales.
      return { wrap: { material: cloth, flap: true, hem: 9.2, band: m('#6e1f17') }, belt: leather, armbands: leather, cuffs: leather,
        sandals: leather, hair, scars: m('#5a3628') };
    case 'pilleur':
      return { wrap: { material: cloth, hem: 10.8 }, cuffs: leather, hair };
    case 'noye':
      return { wrap: { material: cloth, hem: 9.6 } };
  }
}
