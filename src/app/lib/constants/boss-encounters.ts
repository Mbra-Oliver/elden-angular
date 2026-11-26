import type { MusicZone } from '../audio/music-director.service';
import { FORD_DUEL, SLUICE_DUEL, type DuelArena } from '../engine/duel-fog';
import { PROLOGUE_DUEL } from '../prologue/prologue-map';
import type { BossForm, BossId } from './boss-lore';

export type EncounterId = 'ford' | 'sluice' | BossId;

export interface EncounterConfig {
  boss: BossId;
  form: BossForm;
  name: string;
  arena: DuelArena;
  music: MusicZone;
  hp: number;
}

export const ENCOUNTERS: Record<EncounterId, EncounterConfig> = {
  ford: { boss: 'duelist', form: 'human', name: 'Kofi Brempong', arena: FORD_DUEL, music: 'duel-ford', hp: 148 },
  sluice: { boss: 'guardian', form: 'guardian', name: 'Le Gardien de la retenue', arena: SLUICE_DUEL, music: 'duel-sluice', hp: 300 },
  champion: { boss: 'champion', form: 'human', name: 'Badu Ofosu', arena: PROLOGUE_DUEL, music: 'duel-badu', hp: 170 },
  duelist: { boss: 'duelist', form: 'human', name: 'Kofi Brempong', arena: FORD_DUEL, music: 'duel-ford', hp: 148 },
  guardian: { boss: 'guardian', form: 'guardian', name: 'Le Gardien de la retenue', arena: SLUICE_DUEL, music: 'duel-sluice', hp: 300 },

  sentinel: { boss: 'sentinel', form: 'guardian', name: 'La Sentinelle de la digue', arena: SLUICE_DUEL, music: 'duel-sluice', hp: 280 },
  hunter: { boss: 'hunter', form: 'human', name: 'Osei Kwantwi', arena: FORD_DUEL, music: 'duel-ford', hp: 170 },
  harvester: { boss: 'harvester', form: 'human', name: 'Kwame Adjei', arena: FORD_DUEL, music: 'duel-ford', hp: 190 },
  oracle: { boss: 'oracle', form: 'human', name: 'Abena Nyame', arena: PROLOGUE_DUEL, music: 'duel-badu', hp: 160 },
  berserker: { boss: 'berserker', form: 'human', name: 'Yaw Ataa', arena: PROLOGUE_DUEL, music: 'duel-ford', hp: 220 },
  tideholder: { boss: 'tideholder', form: 'guardian', name: 'Le Porteur de crue', arena: SLUICE_DUEL, music: 'duel-sluice', hp: 320 },
  ashafo: { boss: 'ashafo', form: 'human', name: 'Nana Kweku Asafo', arena: FORD_DUEL, music: 'duel-ford', hp: 200 },
  ironmouth: { boss: 'ironmouth', form: 'guardian', name: 'Le Bouche-de-fer', arena: SLUICE_DUEL, music: 'duel-sluice', hp: 300 },
  nightblade: { boss: 'nightblade', form: 'human', name: 'Kofi Nsunu', arena: PROLOGUE_DUEL, music: 'duel-badu', hp: 180 },
};

export const OFFICIAL_BOSS_RUSH: readonly EncounterId[] = ['ford', 'sluice'];

export const DEV_BOSS_RUSH: readonly EncounterId[] = [
  'ford', 'sluice', 'champion',
  'sentinel', 'hunter', 'harvester', 'oracle', 'berserker',
  'tideholder', 'ashafo', 'ironmouth', 'nightblade',
];
