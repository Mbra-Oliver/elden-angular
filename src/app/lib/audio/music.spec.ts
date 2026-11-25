import { Instruments } from './instruments';
import { MusicTrack } from './music-track';
import { THEMES, ThemeId } from './themes';
import { ZONE_THEMES } from './music-director.service';

function offline(seconds: number) {
  const ac = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
  const noise = ac.createBuffer(1, 44100, 44100);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return { ac, inst: new Instruments(ac as unknown as AudioContext, noise) };
}

/** Énergie des aigus (différence d'échantillons), là où les couches se distinguent du bourdon. */
function brightness(buffer: AudioBuffer, from: number, to: number) {
  const data = buffer.getChannelData(0);
  const start = Math.floor(from * buffer.sampleRate) + 1;
  const end = Math.min(data.length, Math.floor(to * buffer.sampleRate));
  let sum = 0;
  for (let i = start; i < end; i++) sum += (data[i] - data[i - 1]) ** 2;
  return Math.sqrt(sum / Math.max(1, end - start));
}

function rms(buffer: AudioBuffer, from: number, to: number) {
  const data = buffer.getChannelData(0);
  const start = Math.floor(from * buffer.sampleRate);
  const end = Math.min(data.length, Math.floor(to * buffer.sampleRate));
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, end - start));
}

async function render(id: ThemeId, phase: 1 | 2 | 3, seconds = 4) {
  const { ac, inst } = offline(seconds);
  const track = new MusicTrack(THEMES[id], ac as unknown as AudioContext, inst, ac.destination, null, 0, phase, new Map());
  track.output.gain.value = 1;
  track.schedule(seconds);
  return ac.startRendering();
}

describe('Musique adaptative', () => {
  it('donne un thème à chaque zone musicale sauf le silence', () => {
    for (const [zone, theme] of Object.entries(ZONE_THEMES)) {
      if (zone === 'silence') expect(theme).toBeNull();
      else expect(THEMES[theme!]).toBeDefined();
    }
  });

  it('déclare un niveau par stem pour chaque phase', () => {
    for (const theme of Object.values(THEMES)) {
      for (const phase of [1, 2, 3] as const) expect(theme.layers[phase].length).toBe(theme.stems.length);
    }
  });

  it('ouvre les couches du boss de phase en phase', () => {
    const layers = THEMES['boss-duelist'].layers;
    const total = (phase: 1 | 2 | 3) => layers[phase].reduce((a, b) => a + b, 0);
    expect(total(1)).toBeLessThan(total(2));
    expect(total(2)).toBeLessThan(total(3));
  });

  it('joue plus fort en phase 3 qu’en phase 1', async () => {
    const calm = await render('boss-duelist', 1);
    const fury = await render('boss-duelist', 3);
    expect(rms(calm, 1, 4)).toBeGreaterThan(0.001);
    expect(rms(fury, 1, 4)).toBeGreaterThan(rms(calm, 1, 4));
    expect(brightness(fury, 1, 4)).toBeGreaterThan(brightness(calm, 1, 4) * 1.5);
  });

  it('reste sans saturation', async () => {
    const buffer = await render('boss-guardian', 3);
    const data = buffer.getChannelData(0);
    let peak = 0;
    for (const sample of data) peak = Math.max(peak, Math.abs(sample));
    expect(peak).toBeLessThan(1.5);
  });

  it('fond la piste jusqu’au silence', async () => {
    const { ac, inst } = offline(5);
    const track = new MusicTrack(THEMES.village, ac as unknown as AudioContext, inst, ac.destination, null, 0, 1, new Map());
    track.output.gain.value = 1;
    track.schedule(5);
    track.stop(1);
    const buffer = await ac.startRendering();
    expect(rms(buffer, 4, 5)).toBeLessThan(0.002);
  });
});
