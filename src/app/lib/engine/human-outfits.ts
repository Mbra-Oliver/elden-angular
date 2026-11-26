import type * as T from 'three';
import type { Outfit } from './human-body';

/**
 * Tenues posées sur le corps humain commun (human-body.ts). Même corps pour
 * tous, seule la tenue change. Époque et culture : pagnes, cuir, coton teint ;
 * ni cape, ni armure de métal.
 * [SUPPOSITION] Couleurs choisies à l'œil.
 */

type Material = (color: string) => T.Material;

export function kwadwoOutfit(m: Material): Outfit {
  return {
    wrap: { material: m('#cf9f2e'), band: m('#efe0a2'), flap: true, hem: 10.0 },
    strap: m('#5b2f17'),
    cuffs: m('#b07b25'),
    sandals: m('#5b3218'),
    hair: m('#17100d'),
    scars: m('#9c6248'),
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
  const leather = m('#241b16');
  const hair = m('#17100d');
  const band = m(kind === 'noye' ? '#2f6b62' : '#a53428');
  switch (kind) {
    case 'eclaireur':
      // Éclaireur : pagne court, brassards, pieds nus (léger et rapide).
      return { wrap: { material: cloth, band, hem: 11.4 }, cuffs: leather, hair };
    case 'lancier':
      // Lancier : pagne, bandoulière, bracelets de bras.
      return { wrap: { material: cloth, band, flap: true, hem: 10.2 }, strap: leather, armbands: m('#5d4a32'), sandals: leather, hair };
    case 'tireur':
    case 'fusilier':
      // Tireur : ceinture de poudre (gourdes et poire posées par slice-3d), bandoulière de balles.
      return { wrap: { material: cloth, band, hem: 10.4 }, belt: leather, strap: m('#1f1610'), sandals: leather, hair };
    case 'garde':
      // Garde d'élite : pagne long, ceinture et bracelets, sandales.
      return { wrap: { material: cloth, band, flap: true, hem: 9.2 }, belt: leather, armbands: leather, cuffs: leather,
        sandals: leather, hair, scars: m('#4a2a20') };
    case 'pilleur':
      return { wrap: { material: cloth, band, hem: 10.8 }, cuffs: leather, hair };
    case 'noye':
      return { wrap: { material: cloth, band, hem: 9.6 } };
  }
}
