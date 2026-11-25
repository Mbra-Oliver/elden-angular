import { Instruments, seededRandom } from './instruments';
import { StepContext, ThemeSpec } from './themes';

/** Fondu à puissance constante (sinus/cosinus) d'un paramètre de gain. */
export function equalPowerFade(param: AudioParam, from: number, to: number, start: number, seconds: number) {
  // Segments linéaires plutôt qu'une courbe : ils ne lèvent jamais d'erreur
  // quand un fondu en interrompt un autre.
  const points = 10;
  const duration = Math.max(0.05, seconds);
  param.cancelScheduledValues(start);
  param.setValueAtTime(from, start);
  for (let i = 1; i <= points; i++) {
    const x = i / points;
    // Montée en sinus, descente en cosinus : deux fondus croisés gardent le niveau perçu.
    const shape = to > from ? Math.sin(x * Math.PI / 2) : 1 - Math.cos(x * Math.PI / 2);
    param.linearRampToValueAtTime(from + (to - from) * shape, start + duration * x);
  }
}

interface StemVoice {
  gain: GainNode;
  target: number;
  random: () => number;
  stopHold?: (at: number) => void;
  /** Boucle enregistrée qui remplace la synthèse de ce stem. */
  loop?: AudioBufferSourceNode;
}

/**
 * Un morceau en cours : ses stems, leur niveau et l'ordonnanceur de croches.
 * Tous les stems avancent sur la même horloge, même muets, pour rester en
 * mesure quand une couche s'ouvre.
 */
export class MusicTrack {
  readonly output: GainNode;
  private readonly ambience: GainNode | null;
  private readonly voices: StemVoice[];
  private readonly stopAmbience?: (at: number) => void;
  private nextTime: number;
  private step = 0;
  private stopped = false;

  constructor(
    readonly spec: ThemeSpec,
    private readonly ac: AudioContext,
    private readonly inst: Instruments,
    musicBus: AudioNode,
    ambienceBus: AudioNode | null,
    start: number,
    phase: 1 | 2 | 3,
    recordings: Map<string, AudioBuffer>,
  ) {
    this.output = ac.createGain();
    this.output.gain.value = 0;
    this.output.connect(musicBus);
    this.nextTime = start;

    const levels = spec.layers[phase];
    this.voices = spec.stems.map((stem, index) => {
      const gain = ac.createGain();
      const target = levels[index] ?? 0;
      gain.gain.value = target;
      gain.connect(this.output);
      const voice: StemVoice = { gain, target, random: seededRandom(index * 7919 + spec.id.length * 104729) };
      const recorded = stem.file ? recordings.get(stem.file) : undefined;
      if (recorded) {
        const loop = ac.createBufferSource();
        loop.buffer = recorded;
        loop.loop = true;
        loop.connect(gain);
        loop.start(start);
        voice.loop = loop;
      } else if (stem.hold) {
        voice.stopHold = stem.hold(inst, gain, start);
      }
      return voice;
    });

    if (spec.ambience && ambienceBus) {
      this.ambience = ac.createGain();
      this.ambience.gain.value = 0;
      this.ambience.connect(ambienceBus);
      this.stopAmbience = spec.ambience(inst, this.ambience, start);
    } else {
      this.ambience = null;
    }
  }

  get barSeconds() {
    return this.spec.stepSeconds * this.spec.stepsPerBar;
  }

  /** Début de la prochaine mesure (pour caler les changements de couche). */
  nextBarTime(after: number) {
    const stepsLeft = (this.spec.stepsPerBar - (this.step % this.spec.stepsPerBar)) % this.spec.stepsPerBar;
    let time = this.nextTime + stepsLeft * this.spec.stepSeconds;
    while (time < after) time += this.barSeconds;
    return time;
  }

  fade(to: number, seconds: number, at = this.ac.currentTime) {
    const from = this.output.gain.value;
    equalPowerFade(this.output.gain, from, to, at, seconds);
    if (this.ambience) equalPowerFade(this.ambience.gain, from, to, at, seconds);
  }

  /** Ouvre / ferme les couches pour une phase, calé sur la prochaine mesure. */
  setPhase(phase: 1 | 2 | 3, rampSeconds = 1.6) {
    const levels = this.spec.layers[phase];
    const at = this.nextBarTime(this.ac.currentTime + 0.05);
    this.voices.forEach((voice, index) => {
      const target = levels[index] ?? 0;
      if (target === voice.target) return;
      equalPowerFade(voice.gain.gain, voice.target, target, at, rampSeconds);
      voice.target = target;
    });
  }

  /** Programme toutes les croches jusqu'à `until` (horloge audio). */
  schedule(until: number) {
    if (this.stopped) return;
    const { stepSeconds, stepsPerBar } = this.spec;
    // Onglet resté en arrière-plan : on saute les croches perdues au lieu de les jouer d'un coup.
    if (this.nextTime < this.ac.currentTime - 0.2) {
      const missed = Math.ceil((this.ac.currentTime - this.nextTime) / stepSeconds);
      this.nextTime += missed * stepSeconds;
      this.step += missed;
    }
    while (this.nextTime < until) {
      const context: Omit<StepContext, 'out' | 'random'> = {
        inst: this.inst, time: this.nextTime, step: this.step,
        beat: this.step % stepsPerBar, bar: Math.floor(this.step / stepsPerBar), stepSeconds,
      };
      this.spec.stems.forEach((stem, index) => {
        const voice = this.voices[index];
        // Couche muette (et déjà éteinte) : rien à synthétiser.
        if (!stem.step || voice.loop || (voice.target < 0.01 && voice.gain.gain.value < 0.01)) {
          return;
        }
        stem.step({ ...context, out: voice.gain, random: voice.random });
      });
      this.nextTime += stepSeconds;
      this.step++;
    }
  }

  /** Coupe le morceau après un fondu ; les nœuds sont libérés à la fin. */
  stop(fadeSeconds: number) {
    if (this.stopped) return;
    const at = this.ac.currentTime;
    this.fade(0, fadeSeconds, at);
    this.stopped = true;
    const end = at + fadeSeconds;
    for (const voice of this.voices) {
      voice.stopHold?.(end);
      voice.loop?.stop(end + 0.1);
    }
    this.stopAmbience?.(end);
    setTimeout(() => {
      this.output.disconnect();
      this.ambience?.disconnect();
    }, (fadeSeconds + 3.5) * 1000);
  }

}
