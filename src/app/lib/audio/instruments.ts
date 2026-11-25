/**
 * Instruments synthétisés, sans aucun fichier audio.
 *
 * Inspirations (timbres approchés, pas des imitations exactes) :
 * - atumpan : paire de grands tambours parlants akan, « mâle » grave et
 *   « femelle » plus aigu, attaque sèche puis glissando de membrane ;
 * - tambour parlant à aisselle (donno) : hauteur qui monte ou descend pendant
 *   la note, comme une syllabe tonale ;
 * - seperewa : harpe-luth akan, ici en corde pincée Karplus-Strong ;
 * - dawuro / gankogui : cloche de fer, partiels inharmoniques ;
 * - ntrowa : hochet de calebasse, bruit filtré court.
 */

/** Petit générateur pseudo-aléatoire reproductible (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fréquence d'une note MIDI. */
export const midi = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

/** Enveloppe percussive : montée très courte puis décroissance exponentielle. */
function hit(param: AudioParam, time: number, level: number, decay: number, attack = 0.004) {
  param.setValueAtTime(0.0001, time);
  param.linearRampToValueAtTime(level, time + attack);
  param.exponentialRampToValueAtTime(0.0001, time + attack + decay);
}

export class Instruments {
  private readonly plucks = new Map<string, AudioBuffer>();

  constructor(private readonly ac: AudioContext, private readonly noise: AudioBuffer) {}

  /**
   * Pré-calcule les cordes pincées d'un thème (quelques ms par note). Fait au
   * moment du `prepare()` pour ne pas bloquer le fil audio en plein combat.
   */
  preparePlucks(notes: number[], sustain: number) {
    for (const note of notes) this.pluckBuffer(note, sustain);
  }

  /** Corde pincée façon seperewa (Karplus-Strong rendu dans un AudioBuffer). */
  pluck(out: AudioNode, time: number, note: number, level = 0.4, sustain = 0.996, pan = 0) {
    const source = this.ac.createBufferSource();
    source.buffer = this.pluckBuffer(note, sustain);
    const gain = this.ac.createGain();
    gain.gain.value = level;
    source.connect(gain);
    this.panned(gain, out, pan);
    source.start(time);
  }

  private pluckBuffer(note: number, sustain: number): AudioBuffer {
    const key = `${note}:${sustain}`;
    const cached = this.plucks.get(key);
    if (cached) return cached;

    const rate = this.ac.sampleRate;
    const seconds = sustain > 0.997 ? 3.2 : 2.2;
    const length = Math.floor(rate * seconds);
    const buffer = this.ac.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    const period = Math.max(2, Math.round(rate / midi(note)));
    const ring = new Float32Array(period);
    // Bruit pré-filtré : attaque de doigt plutôt que de médiator.
    let previous = 0;
    for (let i = 0; i < period; i++) {
      previous = previous * 0.55 + (Math.random() * 2 - 1) * 0.45;
      ring[i] = previous;
    }
    let index = 0;
    let peak = 0;
    for (let i = 0; i < length; i++) {
      const current = ring[index];
      const next = ring[(index + 1) % period];
      ring[index] = sustain * 0.5 * (current + next);
      data[i] = current;
      peak = Math.max(peak, Math.abs(current));
      index = (index + 1) % period;
    }
    // Normalise et éteint la fin pour éviter un clic.
    const scale = peak > 0 ? 0.9 / peak : 1;
    const fade = Math.floor(rate * 0.25);
    for (let i = 0; i < length; i++) {
      const tail = i > length - fade ? (length - i) / fade : 1;
      data[i] *= scale * tail;
    }
    this.plucks.set(key, buffer);
    return buffer;
  }

  /**
   * Tambour parlant : sinus dont la hauteur glisse de `from` à `to` (en
   * multiples de `freq`), plus un claquement de peau.
   */
  talkingDrum(out: AudioNode, time: number, freq: number, opts: {
    level?: number; decay?: number; from?: number; to?: number; glide?: number; click?: number; pan?: number;
  } = {}) {
    const { level = 0.5, decay = 0.35, from = 1.25, to = 1, glide = 0.09, click = 0.25, pan = 0 } = opts;
    const osc = this.ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * from, time);
    osc.frequency.exponentialRampToValueAtTime(freq * to, time + glide);
    const overtone = this.ac.createOscillator();
    overtone.type = 'triangle';
    overtone.frequency.setValueAtTime(freq * from * 1.52, time);
    overtone.frequency.exponentialRampToValueAtTime(freq * to * 1.52, time + glide);

    const body = this.ac.createGain();
    hit(body.gain, time, level, decay);
    const ring = this.ac.createGain();
    hit(ring.gain, time, level * 0.18, decay * 0.45);
    osc.connect(body);
    overtone.connect(ring);
    ring.connect(body);
    this.panned(body, out, pan);
    osc.start(time);
    overtone.start(time);
    osc.stop(time + decay + 0.1);
    overtone.stop(time + decay + 0.1);
    if (click > 0) this.noiseBurst(out, time, { level: level * click, decay: 0.025, freq: 1800, q: 1.2, pan });
  }

  /** Atumpan : grand tambour grave, `male` grave, sinon « femelle » une quarte au-dessus. */
  atumpan(out: AudioNode, time: number, root: number, male: boolean, level = 0.7, pan = 0) {
    const freq = male ? root : root * 1.335;
    this.talkingDrum(out, time, freq, { level, decay: male ? 0.7 : 0.5, from: 1.5, to: 1, glide: 0.06, click: 0.35, pan });
  }

  /** Cloche de fer (dawuro) : trois partiels inharmoniques, très courte. */
  bell(out: AudioNode, time: number, freq = 900, level = 0.12, pan = 0) {
    const gain = this.ac.createGain();
    hit(gain.gain, time, level, 0.32, 0.002);
    const filter = this.ac.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 500;
    gain.connect(filter);
    this.panned(filter, out, pan);
    for (const [ratio, weight] of [[1, 1], [2.76, 0.45], [5.4, 0.2]] as const) {
      const osc = this.ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * ratio;
      const partial = this.ac.createGain();
      partial.gain.value = weight;
      osc.connect(partial).connect(gain);
      osc.start(time);
      osc.stop(time + 0.4);
    }
  }

  /** Hochet (ntrowa) ou claquement : bruit passe-bande très court. */
  noiseBurst(out: AudioNode, time: number, opts: { level?: number; decay?: number; freq?: number; q?: number; pan?: number } = {}) {
    const { level = 0.08, decay = 0.05, freq = 6000, q = 0.8, pan = 0 } = opts;
    const source = this.ac.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ac.createGain();
    hit(gain.gain, time, level, decay, 0.002);
    source.connect(filter).connect(gain);
    this.panned(gain, out, pan);
    const offset = Math.random() * (this.noise.duration - 0.3);
    source.start(time, offset, decay + 0.05);
  }

  /** Montée de souffle filtré (annonce un boss, une phase). */
  swell(out: AudioNode, time: number, seconds: number, level = 0.25) {
    const source = this.ac.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = this.ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.5;
    filter.frequency.setValueAtTime(180, time);
    filter.frequency.exponentialRampToValueAtTime(2400, time + seconds);
    const gain = this.ac.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + seconds * 0.92);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + seconds + 0.12);
    source.connect(filter).connect(gain).connect(out);
    source.start(time);
    source.stop(time + seconds + 0.2);
  }

  /**
   * Bourdon sombre, continu : deux dents de scie désaccordées + sous-octave,
   * passe-bas qui respire lentement. Renvoie une fonction d'arrêt.
   */
  drone(out: AudioNode, time: number, root: number, opts: { cutoff?: number; breath?: number; level?: number; fifth?: boolean } = {}) {
    const { cutoff = 420, breath = 0.045, level = 0.22, fifth = true } = opts;
    const filter = this.ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 1.1;
    const gain = this.ac.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + 2.5);
    filter.connect(gain).connect(out);

    const lfo = this.ac.createOscillator();
    lfo.frequency.value = breath;
    const depth = this.ac.createGain();
    depth.gain.value = cutoff * 0.45;
    lfo.connect(depth).connect(filter.frequency);

    const voices: OscillatorNode[] = [lfo];
    const voice = (type: OscillatorType, freq: number, detune: number, weight: number) => {
      const osc = this.ac.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const g = this.ac.createGain();
      g.gain.value = weight;
      osc.connect(g).connect(filter);
      voices.push(osc);
    };
    voice('sawtooth', root, -7, 0.5);
    voice('sawtooth', root, 6, 0.5);
    voice('sine', root / 2, 0, 0.9);
    if (fifth) voice('triangle', root * 1.5, 3, 0.22);
    for (const osc of voices) osc.start(time);

    return (at: number) => {
      gain.gain.cancelScheduledValues(at);
      gain.gain.setTargetAtTime(0.0001, at, 0.4);
      for (const osc of voices) osc.stop(at + 2.5);
    };
  }

  /**
   * Nappe de bruit (vent dans les herbes, eau qui court). Boucle continue,
   * renvoie une fonction d'arrêt.
   */
  bed(out: AudioNode, time: number, opts: { freq: number; q: number; rate: number; level: number; flutter?: number }) {
    const source = this.ac.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = this.ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = opts.freq;
    filter.Q.value = opts.q;
    const gain = this.ac.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(opts.level, time + 3);
    source.connect(filter).connect(gain).connect(out);

    const lfo = this.ac.createOscillator();
    lfo.frequency.value = opts.rate;
    const sweep = this.ac.createGain();
    sweep.gain.value = opts.freq * 0.4;
    lfo.connect(sweep).connect(filter.frequency);
    const oscs = [lfo];
    if (opts.flutter) {
      const flutter = this.ac.createOscillator();
      flutter.frequency.value = opts.flutter;
      const amount = this.ac.createGain();
      amount.gain.value = opts.level * 0.35;
      flutter.connect(amount).connect(gain.gain);
      oscs.push(flutter);
    }
    source.start(time, Math.random() * this.noise.duration);
    for (const osc of oscs) osc.start(time);

    return (at: number) => {
      gain.gain.cancelScheduledValues(at);
      gain.gain.setTargetAtTime(0.0001, at, 0.5);
      source.stop(at + 3);
      for (const osc of oscs) osc.stop(at + 3);
    };
  }

  private panned(node: AudioNode, out: AudioNode, pan: number) {
    if (pan === 0 || !this.ac.createStereoPanner) {
      node.connect(out);
      return;
    }
    const panner = this.ac.createStereoPanner();
    panner.pan.value = pan;
    node.connect(panner).connect(out);
  }
}
