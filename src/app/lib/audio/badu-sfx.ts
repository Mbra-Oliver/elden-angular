import type { SfxOutput } from './combat-sfx';

/**
 * Bruiterie de Badu Ofosu (chapitre 1), synthétisée en Web Audio comme le
 * reste des sons du jeu (aucun fichier) : pas lourds dans la terre humide,
 * cliquetis des amulettes et de l'insigne, sifflement grave de la hache,
 * souffle rauque, déclic du chien du mousquet, détonation sèche et sourde,
 * sifflement d'oreille quand la balle frôle le joueur, raclement du fer sur
 * la roche, crosse qui éclate contre la pierre.
 * [SUPPOSITION] Niveaux et timbres à régler à l'écoute.
 */
export class BaduSfx {
  private noise?: AudioBuffer;
  private owner?: AudioContext;
  private voices = 0;

  constructor(private readonly output: () => SfxOutput | null) {}

  /** Pas lourd : sourd + succion de boue. */
  step(level = 1) {
    const o = this.ready();
    if (!o) return;
    const t = o.context.currentTime;
    this.tone(o, t, 62 * this.jitter(), 0.16, 0.5 * level, 'sine', 38);
    this.band(o, t + 0.02, 0.12, 420, 1.8, 0.12 * level);
  }

  /** Amulettes de cuir et pièces de l'insigne qui s'entrechoquent quand il pivote. */
  clink() {
    const o = this.ready();
    if (!o) return;
    const t = o.context.currentTime;
    for (let i = 0; i < 3; i++) {
      this.tone(o, t + i * 0.045 + Math.random() * 0.02, (2600 + Math.random() * 1800), 0.09, 0.05, 'triangle');
    }
  }

  /** Hache qui fend l'air : souffle grave et long, plus lourd que les sabres. */
  axe(strength = 1) {
    const o = this.ready();
    if (!o) return;
    const t = o.context.currentTime;
    const src = this.source(o);
    const filter = o.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(220, t);
    filter.frequency.exponentialRampToValueAtTime(900 * this.jitter(), t + 0.22);
    filter.frequency.exponentialRampToValueAtTime(160, t + 0.5);
    const gain = this.env(o, t, 0.02, 0.5, 0.55 * strength);
    src.connect(filter).connect(gain).connect(o.destination);
    src.start(t);
    src.stop(t + 0.6);
  }

  /** Souffle rauque / grognement (armement, essoufflement, cri). */
  grunt(level = 1, seconds = 0.5) {
    const o = this.ready();
    if (!o) return;
    const t = o.context.currentTime;
    this.band(o, t, seconds, 480 * this.jitter(), 3, 0.22 * level);
    this.tone(o, t, 95 * this.jitter(), seconds, 0.12 * level, 'sawtooth', 70);
  }

  /** Déclic métallique du chien du mousquet. */
  cock() {
    const o = this.ready();
    if (!o) return;
    const t = o.context.currentTime;
    this.band(o, t, 0.025, 3200, 6, 0.35);
    this.band(o, t + 0.07, 0.02, 2400, 6, 0.28);
  }

  /** Sifflement d'air pendant la visée (1,2 s). */
  hiss(seconds = 1.2) {
    const o = this.ready();
    if (!o) return;
    const t = o.context.currentTime;
    this.band(o, t, seconds, 5200, 2.5, 0.05, seconds * 0.8);
  }

  /** Détonation sèche et sourde, longue queue. */
  shot() {
    const o = this.ready();
    if (!o) return;
    const t = o.context.currentTime;
    this.band(o, t, 0.08, 1800, 0.7, 0.9);
    this.band(o, t + 0.02, 1.4, 260, 0.8, 0.45);
    this.tone(o, t, 48, 0.6, 0.8, 'sine', 30);
  }

  /** Sifflement d'oreille : la balle est passée tout près. */
  earRing() {
    const o = this.ready();
    if (!o) return;
    const t = o.context.currentTime;
    this.tone(o, t + 0.05, 3400, 1.8, 0.045, 'sine');
  }

  /** Fer de hache traîné sur la roche (une fraction de seconde, répétée pendant la course). */
  scrape() {
    const o = this.ready();
    if (!o) return;
    const t = o.context.currentTime;
    this.band(o, t, 0.14, 2200 * this.jitter(), 4, 0.12);
    this.band(o, t, 0.14, 700, 2, 0.08);
  }

  /** Crosse qui éclate contre la pierre (transition de phase). */
  crack() {
    const o = this.ready();
    if (!o) return;
    const t = o.context.currentTime;
    this.band(o, t, 0.12, 1300, 1, 0.7);
    this.band(o, t + 0.04, 0.3, 400, 1.2, 0.4);
    this.tone(o, t, 70, 0.3, 0.5, 'sine', 40);
  }

  // ── primitives

  private ready(): SfxOutput | null {
    const out = this.output();
    if (!out || this.voices > 20) return null;
    if (!this.noise || this.owner !== out.context) {
      const length = out.context.sampleRate;
      this.noise = out.context.createBuffer(1, length, out.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.owner = out.context;
    }
    return out;
  }

  private jitter() {
    return 0.93 + Math.random() * 0.14;
  }

  private source(o: SfxOutput) {
    const src = o.context.createBufferSource();
    src.buffer = this.noise!;
    src.loop = true;
    this.voices++;
    src.onended = () => { this.voices--; };
    return src;
  }

  private env(o: SfxOutput, t: number, attack: number, seconds: number, level: number) {
    const gain = o.context.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    return gain;
  }

  private band(o: SfxOutput, t: number, seconds: number, freq: number, q: number, level: number, attack = 0.004) {
    const src = this.source(o);
    const filter = o.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    src.connect(filter).connect(this.env(o, t, attack, seconds, level)).connect(o.destination);
    src.start(t, Math.random() * 0.5);
    src.stop(t + seconds + 0.05);
  }

  private tone(o: SfxOutput, t: number, freq: number, seconds: number, level: number, type: OscillatorType, endFreq?: number) {
    const osc = o.context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + seconds);
    this.voices++;
    osc.onended = () => { this.voices--; };
    osc.connect(this.env(o, t, 0.005, seconds, level)).connect(o.destination);
    osc.start(t);
    osc.stop(t + seconds + 0.05);
  }
}
