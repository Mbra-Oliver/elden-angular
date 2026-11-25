import type { StingId } from '../audio/themes';

export type StoryBeatId =
  | 'opening'
  | 'vista'
  | 'drummer'
  | 'badu-entrance'
  | 'badu-phase'
  | 'badu-fall'
  | 'bridge-glance';

export interface StoryBeat {
  id: StoryBeatId;
  duration: number;
  letterbox: boolean;
  blocking: boolean;
  skippable: boolean;
  once: boolean;
  label: string;
  slow?: { scale: number; milliseconds: number };
  sting?: StingId;
}

export const STORY_BEATS: Record<StoryBeatId, StoryBeat> = {
  opening: {
    id: 'opening', duration: 10000, letterbox: true, blocking: false, skippable: true, once: true,
    label: 'Feyiase, avant l’aube',
  },
  vista: {
    id: 'vista', duration: 6000, letterbox: false, blocking: false, skippable: false, once: true,
    label: 'La déroute',
  },
  drummer: {
    id: 'drummer', duration: 8000, letterbox: true, blocking: true, skippable: true, once: true,
    label: 'Le dernier souffle du tambourinaire',
  },
  'badu-entrance': {
    id: 'badu-entrance', duration: 12000, letterbox: true, blocking: false, skippable: true, once: true,
    label: 'Badu Ofosu',
  },
  'badu-phase': {
    id: 'badu-phase', duration: 3000, letterbox: true, blocking: false, skippable: false, once: false,
    label: 'Le mousquet brisé', slow: { scale: 0.25, milliseconds: 3000 }, sting: 'phase',
  },
  'badu-fall': {
    id: 'badu-fall', duration: 8000, letterbox: true, blocking: false, skippable: true, once: false,
    label: 'La chute', slow: { scale: 0.38, milliseconds: 2400 }, sting: 'death',
  },
  'bridge-glance': {
    id: 'bridge-glance', duration: 1500, letterbox: false, blocking: false, skippable: false, once: true,
    label: 'Le tronc bascule',
  },
};

export interface StoryPoint { x: number; y: number }

export interface StoryShotContext {
  player: StoryPoint;
  boss?: StoryPoint;
  focus?: StoryPoint;
  sword?: StoryPoint;
}
