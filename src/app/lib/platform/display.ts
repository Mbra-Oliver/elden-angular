import { QUALITY_SCALE, currentSettings } from './settings.service';

/** Plafond de densité : au-delà, les téléphones chauffent sans gain visible en low poly. */
export const MAX_DEVICE_PIXEL_RATIO = 1.5;

/** Écran tactile principal (téléphone, tablette) : contrôles virtuels affichés. */
export function isTouchDevice(): boolean {
  if (typeof matchMedia === 'undefined') return false;
  return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
}

/** Densité de pixels plafonnée, multipliée par l'échelle de la qualité choisie. */
export function devicePixelRatioCapped(): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const cap = isTouchDevice() ? Math.min(MAX_DEVICE_PIXEL_RATIO, 1.25) : MAX_DEVICE_PIXEL_RATIO;
  return Math.min(dpr, cap) * QUALITY_SCALE[currentSettings().quality];
}

/**
 * Rapport de pixels du rendu du jeu, dont le tampon interne fait
 * baseWidth × baseHeight : on l'agrandit jusqu'à la taille réellement
 * affichée (élément `host`), sous le plafond de densité.
 */
export function renderPixelRatio(host: HTMLElement | null, baseWidth: number): number {
  const shown = host?.clientWidth || (typeof window === 'undefined' ? baseWidth : window.innerWidth);
  return Math.max(0.5, (shown / baseWidth) * devicePixelRatioCapped());
}
