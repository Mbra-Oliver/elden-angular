import type { AudioEngineService } from './audio-engine.service';

/** Intervalle du coup de fontomfrom au menu (s). */
const DRUM_EVERY = 10;

/**
 * Ambiance sonore du menu principal, synthétisée : vent dans les arbres,
 * crépitement du brasero et un coup grave de fontomfrom toutes les 10 s.
 * Branchée sur le bus « ambience » (réglage Bruitages).
 */
export class MenuAmbience {
  private readonly out: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private timer = 0;
  private nextDrum = 0;
  private nextCrackle = 0;
  private stopped = false;

  constructor(private readonly ctx: AudioContext, private readonly noise: AudioBuffer, bus: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
    this.out.connect(bus);
    this.wind();
    this.nextDrum = ctx.currentTime + 2.5;
    this.nextCrackle = ctx.currentTime + 0.2;
    // Petit ordonnanceur : on planifie 0,5 s d'avance.
    this.timer = window.setInterval(() => this.schedule(), 120);
  }

  static start(audio: AudioEngineService): MenuAmbience | null {
    const ctx = audio.unlock();
    const noise = audio.noiseBuffer();
    const bus = audio.bus('ambience');
    return ctx && noise && bus ? new MenuAmbience(ctx, noise, bus) : null;
  }

  /** Fondu de sortie (la musique du prologue prend le relais). */
  stop(fade = 1.2) {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, fade / 4);
    window.setTimeout(() => {
      this.sources.forEach((s) => { try { s.stop(); } catch { /* déjà arrêté */ } });
      this.out.disconnect();
    }, fade * 1000 + 200);
  }

  /** Deux couches de bruit filtré, modulées lentement : rafales dans la canopée. */
  private wind() {
    for (const [freq, level, rate] of [[420, 0.16, 0.07], [1300, 0.05, 0.13]] as const) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const band = this.ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = freq;
      band.Q.value = 0.6;
      const gain = this.ctx.createGain();
      gain.gain.value = level;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = this.ctx.createGain();
      depth.gain.value = level * 0.8;
      lfo.connect(depth).connect(gain.gain);
      const sweep = this.ctx.createGain();
      sweep.gain.value = freq * 0.35;
      lfo.connect(sweep).connect(band.frequency);
      src.connect(band).connect(gain).connect(this.out);
      src.start();
      lfo.start();
      this.sources.push(src, lfo);
    }
  }

  private schedule() {
    const horizon = this.ctx.currentTime + 0.5;
    while (this.nextCrackle < horizon) {
      this.crackle(this.nextCrackle);
      this.nextCrackle += 0.04 + Math.random() * Math.random() * 0.5;
    }
    while (this.nextDrum < horizon) {
      this.drum(this.nextDrum);
      this.nextDrum += DRUM_EVERY;
    }
  }

  /** Brindille qui éclate : un grain de bruit très court, aigu. */
  private crackle(time: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800 + Math.random() * 2500;
    const gain = this.ctx.createGain();
    const peak = 0.05 + Math.random() * (Math.random() < 0.12 ? 0.22 : 0.06);
    gain.gain.setValueAtTime(peak, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.012 + Math.random() * 0.03);
    src.connect(hp).connect(gain).connect(this.out);
    src.start(time, Math.random() * 1.5, 0.06);
  }

  /** Fontomfrom lointain : peau grave qui tombe en hauteur, plus un souffle de bois. */
  private drum(time: number) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(92, time);
    osc.frequency.exponentialRampToValueAtTime(41, time + 0.5);
    const body = this.ctx.createGain();
    body.gain.setValueAtTime(0.0001, time);
    body.gain.exponentialRampToValueAtTime(0.75, time + 0.012);
    body.gain.exponentialRampToValueAtTime(0.0001, time + 2.4);
    const low = this.ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 260;
    osc.connect(body).connect(low).connect(this.out);
    osc.start(time);
    osc.stop(time + 2.5);

    const hit = this.ctx.createBufferSource();
    hit.buffer = this.noise;
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 180;
    band.Q.value = 1.4;
    const thump = this.ctx.createGain();
    thump.gain.setValueAtTime(0.3, time);
    thump.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    hit.connect(band).connect(thump).connect(this.out);
    hit.start(time, 0, 0.2);
  }
}
