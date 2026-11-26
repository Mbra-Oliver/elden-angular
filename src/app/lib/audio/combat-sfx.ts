/**
 * Sons de combat synthétisés (Web Audio), sans aucun fichier à charger.
 *
 * Un coup qui porte superpose trois couches très courtes : un souffle d'air
 * (bruit filtré qui balaie), un impact (métallique, chair, esprit ou pierre)
 * et un grave sub-bass. Chaque déclenchement tire une petite variation de
 * hauteur (±7 %) et de volume pour casser la répétition mécanique.
 *
 * Coût : quelques nœuds natifs par son, libérés dès leur arrêt. Le bruit
 * blanc est généré une seule fois. Le contexte audio et le bus 'sfx' sont
 * fournis par le moteur audio partagé : rien ne sonne tant qu'il n'est pas
 * déverrouillé (null).
 */

export type ImpactMaterial = 'flesh' | 'spirit' | 'guard' | 'shell';
export type StrikeStyle = 'slash' | 'thrust' | 'slam';

export interface SfxOutput {
  context: AudioContext;
  destination: AudioNode;
}

/** Limite de voix simultanées : au-delà, le son est ignoré (pas de saturation). */
const MAX_VOICES = 24;

export class CombatSfx {
  private noise?: AudioBuffer;
  private noiseOwner?: AudioContext;
  private voices = 0;

  constructor(private readonly output: () => SfxOutput | null) {}

  /** Coup qui porte : whoosh + impact + sub. `strength` ≈ 0.5 (léger) à 1.6 (lourd). */
  hit(material: ImpactMaterial, style: StrikeStyle, strength: number) {
    const out = this.ready();
    if (!out) return;
    const p = this.pitch();
    const s = Math.min(1.8, Math.max(0.3, strength));
    const heavy = style === 'slam' || s > 1.2;
    this.whoosh(out, s * 0.45, heavy ? 0.75 * p : p);
    switch (material) {
      case 'guard': this.metal(out, s, p); break;
      case 'shell': this.metal(out, s * 0.7, p * 0.62); this.thud(out, s * 0.7, p); break;
      case 'spirit': this.thud(out, s * 0.8, p * 1.1); this.splash(out, s, p); break;
      default: this.thud(out, s, p); break;
    }
    this.sub(out, s * (heavy ? 1 : 0.6), p);
  }

  /**
   * L'arme bute sur le décor : « tok » sec du fer dans le bois ou la terre,
   * court tintement du fer, sans le souffle d'un coup qui porte.
   */
  glance(surface: 'wood' | 'earth' | 'thatch', strength = 1) {
    const out = this.ready();
    if (!out) return;
    const p = this.pitch();
    const s = Math.min(1.4, Math.max(0.3, strength));
    this.thud(out, s * (surface === 'thatch' ? 0.45 : 0.75), p * (surface === 'wood' ? 1.35 : 0.9));
    this.metal(out, s * (surface === 'earth' ? 0.32 : 0.22), p * 1.2, 0.18);
  }

  /** Coup donné dans le vide : le souffle seul, plus grave pour un coup lourd. */
  swing(heavy: boolean, strength = 1) {
    const out = this.ready();
    if (!out) return;
    const p = this.pitch();
    this.whoosh(out, (heavy ? 0.75 : 0.5) * strength, heavy ? 0.7 * p : 1.05 * p);
  }

  /** Attaque lourde d'un boss qui frappe le sol : grondement + sub long. */
  quake(strength = 1) {
    const out = this.ready();
    if (!out) return;
    const p = this.pitch();
    this.rumble(out, strength, p);
    this.sub(out, strength * 1.3, p * 0.85, 0.55);
  }

  /** Esquive parfaite : tintement clair (« parade »). */
  parry() {
    const out = this.ready();
    if (!out) return;
    const p = this.pitch(0.04);
    this.metal(out, 0.7, p * 1.5, 0.9);
    this.chime(out, p);
  }

  /**
   * Éclat avant une attaque imparable : « ting » aigu et sec, une note
   * haute qui glisse vers le haut et un souffle brillant, audible par-dessus
   * la mêlée sans masquer les impacts.
   */
  glint() {
    const out = this.ready();
    if (!out) return;
    const { context: ctx } = out;
    const t = ctx.currentTime;
    const p = this.pitch(0.03);
    for (const [freq, level, decay] of [[2349, 0.2, 0.5], [3520, 0.12, 0.32], [4699, 0.06, 0.18]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq * p * 0.94, t);
      osc.frequency.exponentialRampToValueAtTime(freq * p, t + 0.05);
      const env = this.envelope(ctx, t, level, 0.002, decay);
      osc.connect(env).connect(out.destination);
      this.play(osc, t, decay + 0.05);
    }
    this.noiseBurst(out, t, 0.12, 'highpass', 6500, 0.8, 0.12, 0.002);
  }

  /** Roulade : frottement court contre le sol. */
  roll() {
    const out = this.ready();
    if (!out) return;
    const t = out.context.currentTime;
    const p = this.pitch(0.1);
    this.noiseBurst(out, t, 0.24, 'lowpass', 900 * p, 0.6, 0.16, 0.02);
  }

  /**
   * Un tireur commence à viser : claquement sec du chien qu'on arme, puis
   * grésillement de la mèche. `level` : 0 (loin) à 1 (tout près).
   */
  musketAim(level = 1) {
    const out = this.ready();
    if (!out || level <= 0.02) return;
    const t = out.context.currentTime;
    const p = this.pitch(0.05);
    this.noiseBurst(out, t, 0.025, 'highpass', 2600 * p, 1.2, 0.5 * level, 0.001);
    this.noiseBurst(out, t + 0.07, 0.03, 'bandpass', 1800 * p, 2, 0.4 * level, 0.001);
    this.noiseBurst(out, t + 0.12, 0.55, 'highpass', 5200 * p, 0.6, 0.07 * level, 0.04);
  }

  /**
   * Détonation du mousquet : claquement de poudre, souffle grave et écho qui
   * roule dans la forêt. `level` : 0 (loin) à 1 (tout près) ; de loin, le
   * claquement s'adoucit et l'écho domine.
   */
  musketShot(level = 1) {
    const out = this.ready();
    if (!out || level <= 0.02) return;
    const t = out.context.currentTime;
    const p = this.pitch(0.06);
    const near = Math.min(1, level);
    this.noiseBurst(out, t, 0.05, 'highpass', 1400 * p, 0.7, 1.1 * near * near, 0.001);
    this.noiseBurst(out, t, 0.3, 'lowpass', 900 * p, 0.8, 1.0 * near, 0.002);
    this.sub(out, 1.2 * near, p * 0.7, 0.4);
    this.noiseBurst(out, t + 0.08, 1.1, 'lowpass', 520 * p, 0.6, 0.35 * Math.max(0.3, near), 0.06);
  }

  // ─── Couches ───────────────────────────────────────────────────────────

  private whoosh(out: SfxOutput, gain: number, pitch: number) {
    const { context: ctx } = out;
    const t = ctx.currentTime;
    const dur = 0.2 / Math.sqrt(pitch);
    const src = this.noiseSource(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(380 * pitch, t);
    band.frequency.exponentialRampToValueAtTime(2400 * pitch, t + dur * 0.55);
    band.frequency.exponentialRampToValueAtTime(700 * pitch, t + dur);
    const env = this.envelope(ctx, t, gain, 0.05, dur);
    src.connect(band).connect(env).connect(out.destination);
    this.play(src, t, dur + 0.05);
  }

  private metal(out: SfxOutput, gain: number, pitch: number, length = 0.45) {
    const { context: ctx } = out;
    const t = ctx.currentTime;
    // Partiels inharmoniques : timbre de lame qui sonne.
    const partials: [number, number, number][] = [[620, 0.5, 1], [1043, 0.34, 0.8], [1720, 0.22, 0.55], [2683, 0.14, 0.35]];
    for (const [freq, level, decay] of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq * pitch;
      const env = this.envelope(ctx, t, gain * level * 0.55, 0.002, length * decay);
      osc.connect(env).connect(out.destination);
      this.play(osc, t, length * decay + 0.05);
    }
    // Claquement de contact.
    this.noiseBurst(out, t, 0.03, 'highpass', 3200 * pitch, 0.7, gain * 0.5, 0.001);
  }

  private thud(out: SfxOutput, gain: number, pitch: number) {
    const { context: ctx } = out;
    const t = ctx.currentTime;
    this.noiseBurst(out, t, 0.11, 'lowpass', 1300 * pitch, 0.8, gain * 0.75, 0.002);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(70 * pitch, t + 0.12);
    const env = this.envelope(ctx, t, gain * 0.6, 0.002, 0.14);
    osc.connect(env).connect(out.destination);
    this.play(osc, t, 0.18);
  }

  /** Éclaboussure d'eau (le Gardien est un esprit d'eau). */
  private splash(out: SfxOutput, gain: number, pitch: number) {
    const { context: ctx } = out;
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const at = t + 0.01 + i * 0.035 + Math.random() * 0.02;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f = (700 + Math.random() * 600) * pitch;
      osc.frequency.setValueAtTime(f, at);
      osc.frequency.exponentialRampToValueAtTime(f * 2.2, at + 0.05);
      const env = this.envelope(ctx, at, gain * 0.16, 0.002, 0.06);
      osc.connect(env).connect(out.destination);
      this.play(osc, at, 0.08);
    }
    this.noiseBurst(out, t, 0.2, 'bandpass', 2600 * pitch, 0.9, gain * 0.3, 0.01);
  }

  private sub(out: SfxOutput, gain: number, pitch: number, length = 0.26) {
    const { context: ctx } = out;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(78 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(36 * pitch, t + length);
    const env = this.envelope(ctx, t, Math.min(1, gain * 0.7), 0.004, length);
    osc.connect(env).connect(out.destination);
    this.play(osc, t, length + 0.05);
  }

  private rumble(out: SfxOutput, gain: number, pitch: number) {
    const t = out.context.currentTime;
    this.noiseBurst(out, t, 0.6, 'lowpass', 420 * pitch, 0.7, gain * 0.9, 0.006);
    this.noiseBurst(out, t, 0.09, 'bandpass', 1500 * pitch, 0.8, gain * 0.4, 0.002);
  }

  private chime(out: SfxOutput, pitch: number) {
    const { context: ctx } = out;
    const t = ctx.currentTime;
    for (const [freq, level] of [[1318, 0.16], [1976, 0.1], [2637, 0.06]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * pitch;
      const env = this.envelope(ctx, t, level, 0.004, 0.8);
      osc.connect(env).connect(out.destination);
      this.play(osc, t, 0.85);
    }
  }

  // ─── Outils ────────────────────────────────────────────────────────────

  private noiseBurst(out: SfxOutput, t: number, dur: number, type: BiquadFilterType, freq: number,
    q: number, gain: number, attack: number) {
    const ctx = out.context;
    const src = this.noiseSource(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = Math.min(freq, ctx.sampleRate / 2.2);
    filter.Q.value = q;
    const env = this.envelope(ctx, t, gain, attack, dur);
    src.connect(filter).connect(env).connect(out.destination);
    this.play(src, t, dur + 0.03);
  }

  /** Attaque linéaire courte puis chute exponentielle jusqu'au silence. */
  private envelope(ctx: AudioContext, t: number, peak: number, attack: number, decay: number) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return gain;
  }

  private noiseSource(ctx: AudioContext) {
    if (!this.noise || this.noiseOwner !== ctx) {
      const length = Math.floor(ctx.sampleRate * 1);
      this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseOwner = ctx;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    return src;
  }

  private play(node: AudioScheduledSourceNode, t: number, dur: number) {
    this.voices++;
    node.onended = () => { this.voices--; node.disconnect(); };
    // Départ aléatoire dans le bruit : deux souffles successifs ne sont jamais identiques.
    if (node instanceof AudioBufferSourceNode) node.start(t, Math.random() * 0.7);
    else node.start(t);
    node.stop(t + dur);
  }

  private ready() {
    if (this.voices > MAX_VOICES) return null;
    const out = this.output();
    if (!out || out.context.state !== 'running') return null;
    return out;
  }

  private pitch(spread = 0.07) {
    return 1 + (Math.random() * 2 - 1) * spread;
  }
}
