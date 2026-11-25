import { Injectable } from '@angular/core';

/** Bus de mixage partagés par la musique, l'ambiance et les bruitages. */
export type AudioBus = 'music' | 'ambience' | 'sfx' | 'ui';

/** Coupure du passe-bas quand le son est « étouffé » au maximum (Hz). */
const MUFFLED_CUTOFF = 520;
const OPEN_CUTOFF = 20000;

/**
 * Un seul AudioContext pour tout le jeu.
 *
 *   music ──┐
 *           ├─ passe-bas (inventaire, PV bas) ─┐
 *   ambience┘                                  ├─ master ─ compresseur ─ sortie
 *   sfx ───────────────────────────────────────┤
 *   ui  ───────────────────────────────────────┘
 *
 * Les navigateurs refusent de démarrer l'audio sans geste de l'utilisateur :
 * `unlock()` doit être appelé dans le gestionnaire du clic « Nouvelle partie ».
 * Avant ça, `context` et `bus()` renvoient null et tout appel audio est ignoré.
 */
@Injectable({ providedIn: 'root' })
export class AudioEngineService {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muffleFilter: BiquadFilterNode | null = null;
  private readonly buses = new Map<AudioBus, GainNode>();
  private readonly levels: Record<AudioBus, number> = { music: 0.55, ambience: 0.5, sfx: 0.9, ui: 0.7 };
  private noise: AudioBuffer | null = null;
  private readonly onVisibility = () => {
    if (!this.ctx) return;
    if (document.hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  };

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Horloge audio (s). 0 tant que le contexte n'existe pas. */
  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /**
   * Crée (ou réveille) le contexte. À appeler de façon synchrone dans un
   * gestionnaire de clic ou de touche, sinon le navigateur le laisse suspendu.
   */
  unlock(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state !== 'running') void this.ctx.resume();
      return this.ctx;
    }
    const Ctor: typeof AudioContext | undefined = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    const ctx = new Ctor({ latencyHint: 'interactive' });
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 12;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;
    compressor.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(compressor);

    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = OPEN_CUTOFF;
    muffle.Q.value = 0.7;
    muffle.connect(master);

    for (const name of ['music', 'ambience', 'sfx', 'ui'] as AudioBus[]) {
      const gain = ctx.createGain();
      gain.gain.value = this.levels[name];
      gain.connect(name === 'music' || name === 'ambience' ? muffle : master);
      this.buses.set(name, gain);
    }

    this.ctx = ctx;
    this.master = master;
    this.muffleFilter = muffle;
    document.addEventListener('visibilitychange', this.onVisibility);
    void ctx.resume();
    return ctx;
  }

  /** Point d'entrée des sons : connecter les sources sur ce nœud. */
  bus(name: AudioBus): GainNode | null {
    return this.buses.get(name) ?? null;
  }

  /** Volume d'un bus entre 0 et 1, avec un court lissage pour éviter les clics. */
  setVolume(name: AudioBus | 'master', value: number) {
    const level = Math.max(0, Math.min(1, value));
    if (name !== 'master') this.levels[name] = level;
    const node = name === 'master' ? this.master : this.buses.get(name);
    if (node && this.ctx) node.gain.setTargetAtTime(level, this.ctx.currentTime, 0.05);
  }

  /**
   * Étouffe musique et ambiance : 0 = son clair, 1 = derrière un mur.
   * La coupure suit une courbe exponentielle (perçue comme linéaire).
   */
  muffle(amount: number, timeConstant = 0.18) {
    if (!this.ctx || !this.muffleFilter) return;
    const a = Math.max(0, Math.min(1, amount));
    const cutoff = OPEN_CUTOFF * Math.pow(MUFFLED_CUTOFF / OPEN_CUTOFF, a);
    const filter = this.muffleFilter;
    filter.frequency.setTargetAtTime(cutoff, this.ctx.currentTime, timeConstant);
    filter.Q.setTargetAtTime(0.7 + a * 2.2, this.ctx.currentTime, timeConstant);
  }

  /** Deux secondes de bruit blanc, partagées (vent, eau, clics de peau, shakers). */
  noiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noise) {
      const length = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  dispose() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.muffleFilter = null;
    this.noise = null;
    this.buses.clear();
  }
}
