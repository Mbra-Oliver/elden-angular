/**
 * Chargement des stems enregistrés : OGG/Opus en priorité, MP3 en repli
 * (Safari ancien ne décode pas toujours l'Opus). Une même URL n'est
 * téléchargée et décodée qu'une fois.
 */
const cache = new Map<string, Promise<AudioBuffer | null>>();

export function prefersOpus(): boolean {
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('audio');
  return probe.canPlayType('audio/ogg; codecs="opus"') !== '';
}

/** `base` sans extension, ex. `assets/audio/boss-guardian-1`. */
export function loadStem(ac: BaseAudioContext, base: string): Promise<AudioBuffer | null> {
  const cached = cache.get(base);
  if (cached) return cached;
  const extensions = prefersOpus() ? ['.ogg', '.mp3'] : ['.mp3'];
  const loading = (async () => {
    for (const extension of extensions) {
      try {
        const response = await fetch(base + extension);
        if (!response.ok) continue;
        return await ac.decodeAudioData(await response.arrayBuffer());
      } catch {
        // Format non décodable ici : on essaie le suivant.
      }
    }
    console.warn(`Stem audio introuvable : ${base} (.ogg/.mp3). Synthèse utilisée.`);
    return null;
  })();
  cache.set(base, loading);
  return loading;
}

