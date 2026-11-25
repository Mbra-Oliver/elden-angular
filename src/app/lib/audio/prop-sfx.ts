import type { DebrisStyle } from '../constants/destructibles.config-constant';

/**
 * Sons du décor qui casse, synthétisés (aucun fichier) :
 * - terre cuite / calebasse : éclat aigu + petits cliquetis de tessons ;
 * - bois, raphia, paille : craquement sec + bruit filtré ;
 * - terre banchée, latérite : grondement sourd qui s'effrite.
 *
 * Un coup qui ne casse pas joue une version courte et plus douce. Même
 * limite de voix que les sons de combat : au-delà, le son est ignoré.
 */
export interface PropSfxOutput {
  context: AudioContext;
  destination: AudioNode;
  noise: AudioBuffer;
}

const MAX_VOICES = 10;

export class PropSfx {
  private voices = 0;

  constructor(private readonly output: () => PropSfxOutput | null) {}

  play(style: DebrisStyle, broken: boolean, strength: number) {
    const out = this.output();
    if (!out || this.voices >= MAX_VOICES) return;
    const p = 0.93 + Math.random() * 0.14;
    const s = Math.min(1.4, Math.max(0.3, strength)) * (broken ? 1 : 0.45);
    const t = out.context.currentTime;
    switch (style) {
      case 'shard':
        this.noise(out, t, broken ? 0.16 : 0.07, 'highpass', 2200 * p, 0.7, 0.5 * s);
        this.noise(out, t, 0.09, 'bandpass', 900 * p, 2, 0.35 * s);
        if (broken) {
          // Tessons qui retombent.
          for (let i = 0; i < 4; i++) {
            this.tone(out, t + 0.05 + i * 0.045 + Math.random() * 0.03, (1800 + Math.random() * 1600) * p, 0.05, 0.08 * s);
          }
        }
        break;
      case 'splinter':
      case 'straw':
        this.noise(out, t, broken ? 0.22 : 0.08, 'bandpass', (style === 'straw' ? 2600 : 1400) * p, 1.2, 0.5 * s);
        this.tone(out, t, 140 * p, 0.12, 0.3 * s, 'triangle');
        break;
      case 'clod':
        this.noise(out, t, broken ? 0.55 : 0.16, 'lowpass', 520 * p, 0.8, 0.75 * s);
        this.tone(out, t, 70 * p, broken ? 0.35 : 0.14, 0.5 * s, 'sine');
        break;
    }
  }

  private noise(out: PropSfxOutput, t: number, duration: number, type: BiquadFilterType,
    frequency: number, q: number, gain: number) {
    const { context: ctx } = out;
    const src = ctx.createBufferSource();
    src.buffer = out.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(amp).connect(out.destination);
    this.start(src, Math.random() * 0.3, t + duration + 0.02, t);
  }

  private tone(out: PropSfxOutput, t: number, frequency: number, duration: number, gain: number,
    type: OscillatorType = 'square') {
    const { context: ctx } = out;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.6, t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp).connect(out.destination);
    this.start(osc, null, t + duration + 0.02, t);
  }

  /** Démarre une source et libère sa voix à l'arrêt. `offset` : point de lecture dans le bruit. */
  private start(node: AudioScheduledSourceNode, offset: number | null, stop: number, at: number) {
    this.voices++;
    node.onended = () => { this.voices--; node.disconnect(); };
    if (offset !== null && node instanceof AudioBufferSourceNode) node.start(at, offset);
    else node.start(at);
    node.stop(stop);
  }
}
