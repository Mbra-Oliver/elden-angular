import type { AudioEngineService } from '../../lib/audio/audio-engine.service';

/**
 * Petit « bip » de machine à écrire synthétisé en Web Audio (bus 'ui') :
 * aucune voix enregistrée à télécharger. Chaque locuteur a sa hauteur, et
 * chaque lettre varie un peu pour éviter l'effet mitraillette.
 */
export class TypewriterVoice {
  private base = 220;

  constructor(private readonly audio: AudioEngineService) {}

  setSpeaker(name: string) {
    let hash = 0;
    for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    this.base = 170 + (hash % 9) * 18;
  }

  blip(char: string) {
    const ctx = this.audio.context;
    const bus = this.audio.bus('ui');
    if (!ctx || !bus || ctx.state !== 'running') return;
    const code = char.toLowerCase().charCodeAt(0);
    const vowel = 'aeiouyéèêàâôîû'.includes(char.toLowerCase());
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = vowel ? 'triangle' : 'square';
    osc.frequency.setValueAtTime(this.base * (1 + ((code % 7) - 3) * 0.035), t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vowel ? 0.07 : 0.035, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    osc.connect(gain).connect(bus);
    osc.start(t);
    osc.stop(t + 0.05);
  }
}
