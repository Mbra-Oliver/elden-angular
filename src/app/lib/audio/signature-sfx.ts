import { inject, Injectable } from '@angular/core';
import { AudioEngineService } from './audio-engine.service';
import type { SfxOutput } from './combat-sfx';

/** Signature sonore du brasero et de l'épigraphe : crépitement, kora, fontomfrom. */
@Injectable({ providedIn: 'root' })
export class SignatureSfx {
  private readonly audio = inject(AudioEngineService);
  private noise?: AudioBuffer;
  private owner?: AudioContext;

  /** Repos au brasero : bois qui crépite, puis deux cordes de kora/balafon. */
  rest() {
    const out = this.output();
    if (!out) return;
    const t = out.context.currentTime;
    for (let i = 0; i < 7; i++) {
      this.band(out, t + i * 0.055 + Math.random() * 0.03, 0.045, 900 + Math.random() * 2400, 2.4,
        0.09 + Math.random() * 0.05);
    }
    this.pluck(out, t + 0.18, 392, 1.6, 0.16);
    this.pluck(out, t + 0.52, 587.33, 1.9, 0.12);
  }

  /** Unique frappe de fontomfrom, jouée au premier geste sur l'épigraphe. */
  epigraph() {
    const out = this.output();
    if (!out) return;
    const t = out.context.currentTime;
    this.pluck(out, t, 72, 2.6, 0.42, 'sine');
    this.band(out, t, 0.42, 260, 1.1, 0.24, 0.008);
  }

  private output(): SfxOutput | null {
    const context = this.audio.context;
    const destination = this.audio.bus('sfx');
    if (!context || !destination) return null;
    if (!this.noise || this.owner !== context) {
      this.noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.owner = context;
    }
    return { context, destination };
  }

  private pluck(out: SfxOutput, at: number, frequency: number, seconds: number, level: number, type: OscillatorType = 'triangle') {
    const osc = out.context.createOscillator();
    const gain = out.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, at);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.985, at + seconds);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    osc.connect(gain).connect(out.destination);
    osc.start(at);
    osc.stop(at + seconds + 0.05);
  }

  private band(out: SfxOutput, at: number, seconds: number, frequency: number, q: number, level: number, attack = 0.004) {
    const src = out.context.createBufferSource();
    src.buffer = this.noise!;
    const filter = out.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = out.context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    src.connect(filter).connect(gain).connect(out.destination);
    src.start(at, Math.random() * 0.4);
    src.stop(at + seconds + 0.05);
  }
}
