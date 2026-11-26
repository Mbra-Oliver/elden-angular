import { computed, inject, Injectable, signal } from '@angular/core';
import type { StoryBeatId } from '../narrative/story-beats';
import { PLAYER_CONFIG } from '../constants/player.config-constant';
import { TerrainCollisionService } from '../engine/terrain-collision.service';
import { EquipmentStore } from '../entities/player/equipment.store';
import { PlayerEntity } from '../entities/player/player.entity';
import { PlayerStore } from '../entities/player/player.store';
import { EnemiesService } from '../slice/enemies.service';
import {
  BRIDGE_PUSH, COVER_TRUNKS, PROLOGUE_SPAWNS,
  CAMP, CREST_GATE_X, DUEL_TRIGGER, FOREST, INSPECT_RADIUS, PROLOGUE_DUEL, PROLOGUE_AREA, REMAINS, SOLIDS, START, TRAIL,
  inPrologue, walkable, LOOKOUT, type Remains, type RemainsId, type Spot,
} from './prologue-map';

/** Ouverture : défile seule (≈ 4,6 s par ligne), Espace pour passer. */
export const PROLOGUE_INTRO: readonly string[] = [
  'Chapitre 1 · La crête de Feyiase',
  'Feyiase, 1701. Les Asante d’Osei Tutu se lèvent contre le Denkyira, à qui ils payaient tribut depuis des décennies.',
  'Kwadwo Ofori, guerrier de l’arrière-garde, n’a plus que sa lance. Sa sœur portera la lignée dont naîtra un jour Abla Pokou.',
  'Une décharge de plomb l’a jeté dans la boue. Quand il rouvre les yeux, la colonne est passée.',
  'Devant lui brûle l’autel de mémoire. À l’est, sur la crête, les feux du campement.',
];

/** Indications du premier combat (séquence 1), affichées discrètement (touches selon l'appareil). */
export const FIRST_FIGHT_HINT = 'combat';
/** Avertissement de Kwadwo avant la ravine, où le tireur posté couvre le lancier. */
export const RAVINE_HINT = 'ravine';
export const RAVINE_LINE = 'Kwadwo : « Un mousquetaire du Denkyira tient le rocher au-dessus de la ravine. ' +
  'Quand sa mèche rougeoie, je dois mettre un tronc entre lui et moi : il lui faut du temps pour bourrer sa charge. »';
/** Durée de la poudre de kaolin sur la lame (s). */
export const KAOLIN_SECONDS = 30;
/** Rupture de garde multipliée pendant le kaolin. [SUPPOSITION] */
export const KAOLIN_POISE = 1.8;

/** Fin : à l'arrivée au camp, avant le gué de 1824. */
export const PROLOGUE_OUTRO: readonly string[] = [
  'À Feyiase, en 1701, le joug du Denkyira fut brisé.',
  'Mais dans l’ombre des victoires naissent les querelles de succession qui déchireront bientôt le sang des frères…',
  'Kwadwo plante sa lame dans la terre de la crête. L’aube se lève sur la forêt.',
  'Fin du chapitre 1.',
]

/** Taille du carquois quand l'arc est trouvé. [SUPPOSITION] */
const START_ARROWS = 6;
/** Poignées de feuilles transmises par le blessé pour la mixture. [SUPPOSITION] */
const MIXTURE_GIFT = 3;
const LINE_SECONDS = 4.6;

/**
 * Prologue 1701 : réveil, lecture des restes (F), arrivée au camp. Les
 * soldats du Denkyira sont ceux d'EnemiesService (mêmes profils que la
 * tranche) ; la boucle soulslike gère foyers, mort et cauris.
 */
@Injectable({ providedIn: 'root' })
export class PrologueService {
  private readonly terrain = inject(TerrainCollisionService);
  private readonly equipment = inject(EquipmentStore);
  private readonly player = inject(PlayerEntity);
  private readonly playerStore = inject(PlayerStore);
  private readonly enemies = inject(EnemiesService);

  /** Ligne d'ouverture (ou de fin) affichée, null quand on joue. */
  readonly line = signal<number | null>(null);
  readonly lines = signal<readonly string[]>(PROLOGUE_INTRO);
  /** Ce qu'on peut faire avec F à cet endroit (examiner un reste, pousser le tronc). */
  readonly prompt = signal<{ label: string; remains?: Remains; bridge?: boolean } | null>(null);
  onStory?: (id: StoryBeatId, focus?: { x: number; y: number }) => void;
  /** Indication du premier combat (null : masquée). */
  readonly hint = signal<string | null>(null);
  /** Poudre de kaolin : possédée, et secondes restantes sur la lame. */
  readonly kaolin = signal<{ owned: boolean; left: number }>({ owned: false, left: 0 });
  /** Le tronc du raccourci est poussé : pont vers l'autel de départ. */
  bridged = false;
  /** Le blessé a transmis ses feuilles à écraser (sans elles, pas de soin). */
  mixtureGiven = false;
  /** L'arc de l'archer tombé a été ramassé. */
  bowFound = false;
  /** Kwadwo a avalé de la mixture pendant le chapitre (trophée « L'Éternel » perdu). */
  healed = false;
  /** Nombre d'entrées dans le duel contre Badu (trophée du premier coup). */
  duelTries = 0;
  /** Carte de lecture ouverte après F. */
  readonly reading = signal<Remains | null>(null);
  /** Arrivée au camp et fin lue : la partie passe à 1824. */
  readonly finished = signal(false);
  /** Objectif affiché : un peu plus loin sur le sentier, puis le camp. */
  readonly goal = signal<{ x: number; y: number; name: string }>(this.goalFrom(START));

  /** Le porte-hache du Denkyira est tombé : le chemin du camp est libre. */
  championDown = false;
  /** Où il est tombé (le corps reste sur la crête). */
  championSpot: { x: number; y: number; yaw: number } | null = null;

  private readonly read = signal(new Set<RemainsId>());
  readonly relicBonus = computed(() => Math.min(3, Math.floor(this.read().size / 2)));
  private lineTime = 0;
  private readingUntil = 0;
  private outro = false;
  private hinted = false;
  private ravineHinted = false;
  private hintUntil = 0;

  constructor() {
    this.terrain.addRegion(PROLOGUE_AREA);
    this.terrain.addBlocker((x, y, radius) => {
      if (!inPrologue(x, y, 40)) return false;
      if (!walkable(x, y, radius, this.bridged)) return true;
      if (!this.championDown && x + radius > CREST_GATE_X) return true;
      return SOLIDS.some((s) => (x - s.x) ** 2 + (y - s.y) ** 2 < (s.r + radius) ** 2);
    }, false);
    // Les armes ne butent que sur les rochers et les troncs, pas sur la rivière ni les bords de carte.
    this.terrain.addWeaponBlocker((x, y, radius) => inPrologue(x, y, 40) &&
      SOLIDS.some((s) => (x - s.x) ** 2 + (y - s.y) ** 2 < (s.r + radius) ** 2));
    // Les troncs de la ravine arrêtent les balles du tireur.
    this.enemies.cover = COVER_TRUNKS.map((c) => ({ x: c.x - c.r, y: c.y - c.r, w: c.r * 2, h: c.r * 2 }));
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (event) => {
        if (event.code === 'KeyT' && !event.repeat) this.applyKaolin();
      });
    }
  }

  /** Touche T : enduire la lame de kaolin (une seule poudre). */
  applyKaolin() {
    const k = this.kaolin();
    if (!k.owned || k.left > 0 || this.blocking()) return;
    this.kaolin.set({ owned: false, left: KAOLIN_SECONDS });
    this.equipment.say('Lame enduite de kaolin');
  }

  /** Multiplicateur de rupture de garde des coups du héros. */
  poiseBonus() {
    return this.kaolin().left > 0 ? KAOLIN_POISE : 1;
  }

  /** Nouvelle partie : rien n'est lu, l'ouverture se lance. */
  begin() {
    this.read.set(new Set());
    this.bridged = false;
    this.mixtureGiven = false;
    this.bowFound = false;
    this.healed = false;
    this.duelTries = 0;
    this.hinted = false;
    this.ravineHinted = false;
    this.hint.set(null);
    this.kaolin.set({ owned: false, left: 0 });
    this.championDown = false;
    this.championSpot = null;
    this.finished.set(false);
    this.outro = false;
    this.reading.set(null);
    this.prompt.set(null);
    this.lines.set(PROLOGUE_INTRO);
    this.line.set(0);
    this.lineTime = 0;
  }

  /** Reprise sans ouverture (mort, continuer). */
  resume() {
    this.finished.set(false);
    this.outro = false;
    this.reading.set(null);
    this.line.set(null);
  }

  /** Équipement d'un soldat de 1701 : afena, lance, arc, flèches et mixture de soin. */
  equip() {
    // Rien que sa lance : l'arc se trouve sur un archer tombé, les feuilles auprès du blessé.
    this.equipment.setOwned(this.bowFound ? ['spear', 'bow'] : ['spear']);
    this.equipment.setWeapon('spear');
    this.equipment.setMaxArrows(START_ARROWS);
    this.equipment.setMaxMixture(this.mixtureGiven ? MIXTURE_GIFT : 0);
    const stamina = PLAYER_CONFIG.maxStamina + this.relicBonus() * 8;
    this.playerStore.update({ maxStamina: stamina, stamina });
    this.equipment.refill();
  }

  placeAtStart() {
    this.place(START, 1, -0.3);
  }

  place(at: Spot, facingX = 1, facingY = 0) {
    const half = PLAYER_CONFIG.size / 2;
    this.playerStore.update({
      x: at.x - half, y: at.y - half, vx: 0, vy: 0, facingX, facingY, state: 'idle', stateTimer: 0,
    });
  }

  /** Texte plein écran en cours : le monde attend. */
  blocking() {
    return this.line() !== null;
  }

  skipLine() {
    const line = this.line();
    if (line === null) return;
    this.lineTime = 0;
    if (line + 1 < this.lines().length) {
      this.line.set(line + 1);
    } else {
      this.line.set(null);
      if (this.outro) this.finished.set(true);
    }
  }

  update(dt: number) {
    if (this.line() !== null) {
      this.lineTime += dt;
      if (this.lineTime > LINE_SECONDS) this.skipLine();
      return;
    }
    const x = this.player.centerX;
    const y = this.player.centerY;
    const open = this.reading();
    if (open && (performance.now() > this.readingUntil || Math.hypot(open.x - x, open.y - y) > 70)) this.reading.set(null);
    const goal = this.goalFrom({ x, y });
    if (goal.x !== this.goal().x || goal.y !== this.goal().y) this.goal.set(goal);
    const k = this.kaolin();
    if (k.left > 0) {
      const left = Math.max(0, k.left - dt);
      if (Math.ceil(left) !== Math.ceil(k.left)) this.kaolin.set({ ...k, left });
      else k.left = left;
    }
    // Premier contact : discrètes indications de combat quand l'éclaireur est proche.
    const scout = PROLOGUE_SPAWNS[0];
    if (!this.hinted && Math.hypot(scout.x - x, scout.y - y) < 240) {
      this.hinted = true;
      this.hint.set(FIRST_FIGHT_HINT);
      this.hintUntil = performance.now() + 7000;
    }
    // Entrée de la ravine : Kwadwo repère le tireur avant d'être à sa portée.
    const spearman = PROLOGUE_SPAWNS[1];
    if (!this.ravineHinted && this.hint() === null && Math.hypot(spearman.x - x, spearman.y - y) < 300) {
      this.ravineHinted = true;
      this.hint.set(RAVINE_HINT);
      this.hintUntil = performance.now() + 9000;
    }
    if (this.hint() && performance.now() > this.hintUntil) this.hint.set(null);
    const nearest = REMAINS.find((r) => Math.hypot(r.x - x, r.y - y) < INSPECT_RADIUS) ?? null;
    const bridge = !this.bridged && Math.hypot(BRIDGE_PUSH.x - x, BRIDGE_PUSH.y - y) < 40;
    const current = this.prompt();
    if (bridge) {
      if (!current?.bridge) this.prompt.set({ label: 'Pousser le tronc', bridge: true });
    } else if (nearest?.id !== current?.remains?.id || (!nearest && current)) {
      this.prompt.set(nearest ? { label: nearest.label, remains: nearest } : null);
    }
    if (!this.outro && this.championDown && Math.hypot(CAMP.x - x, CAMP.y - y) < CAMP.r && this.playerStore.getData().state !== 'dead') {
      this.outro = true;
      this.prompt.set(null);
      this.reading.set(null);
      this.lines.set(PROLOGUE_OUTRO);
      this.line.set(0);
      this.lineTime = 0;
    }
  }

  /** Sol sous la caméra (relief du chapitre 1), 0 hors de la carte. */
  cameraFloor(x: number, z: number) {
    return inPrologue(x, z, 200) ? this.terrain.groundAt(x, z) : 0;
  }

  /** Sur le promontoire : la caméra recule et monte pour dévoiler la vallée. */
  atLookout() {
    return Math.hypot(LOOKOUT.x - this.player.centerX, LOOKOUT.y - this.player.centerY) < LOOKOUT.r + 10;
  }

  /** Le héros est entré sur la crête alors que le porte-hache la tient encore. */
  duelDue() {
    if (this.championDown || this.blocking()) return false;
    return Math.hypot(PROLOGUE_DUEL.x - this.player.centerX, PROLOGUE_DUEL.y - this.player.centerY) < DUEL_TRIGGER;
  }

  /** Fin du chapitre (après la mort de Badu) : texte plein écran, puis l'acte suivant. */
  startOutro() {
    if (this.outro) return;
    this.outro = true;
    this.prompt.set(null);
    this.reading.set(null);
    this.lines.set(PROLOGUE_OUTRO);
    this.line.set(0);
    this.lineTime = 0;
  }

  /** Touche F : examine le reste à portée. Renvoie vrai si pris. */
  interact(): boolean {
    const prompt = this.prompt();
    if (!prompt || this.blocking()) return false;
    const state = this.playerStore.getData().state;
    if (state !== 'idle' && state !== 'moving') return false;
    if (prompt.bridge) {
      // Le tronc bascule par-dessus le ravin : raccourci vers l'autel de mémoire.
      this.bridged = true;
      this.prompt.set(null);
      this.equipment.say('Le tronc bascule : un pont vers l’autel de mémoire');
      this.onStory?.('bridge-glance', BRIDGE_PUSH);
      return true;
    }
    const target = prompt.remains!;
    if (!this.read().has(target.id)) {
      const next = new Set(this.read());
      next.add(target.id);
      this.read.set(next);
      if (target.gives?.bow) {
        this.bowFound = true;
        this.equipment.setOwned(['spear', 'bow']);
      }
      if (target.gives?.arrows) this.equipment.addArrows(target.gives.arrows);
      if (target.gives?.mixtureGift) {
        this.mixtureGiven = true;
        this.equipment.setMaxMixture(MIXTURE_GIFT);
        this.equipment.addMixture(MIXTURE_GIFT);
      }
      if (target.gives?.mixture) this.equipment.addMixture(target.gives.mixture);
      if (target.gives?.kaolin) {
        this.kaolin.set({ owned: true, left: 0 });
      }
      const maxStamina = PLAYER_CONFIG.maxStamina + this.relicBonus() * 8;
      const player = this.playerStore.getData();
      if (player.maxStamina < maxStamina) {
        this.playerStore.update({ maxStamina, stamina: Math.min(maxStamina, player.stamina + 8) });
      }
    }
    this.reading.set(target);
    this.readingUntil = performance.now() + 11000;
    if (target.id === 'tambourinaire') this.onStory?.('drummer', target);
    return true;
  }

  closeReading() {
    this.reading.set(null);
  }

  /** Lecture page à page (mobile) : la fiche reste ouverte tant qu'on la tapote. */
  holdReading(ms = 11000) {
    if (this.reading()) this.readingUntil = performance.now() + ms;
  }

  /** Repos à un feu du prologue : flèches de départ rendues. */
  onRest() {
    this.equipment.setMaxArrows(Math.max(START_ARROWS, this.equipment.getData().maxArrows));
    this.equipment.refill();
  }

  hasRead(id: RemainsId) {
    return this.read().has(id);
  }

  private goalFrom({ x, y }: Spot): { x: number; y: number; name: string } {
    let best = 0;
    let bestDistance = Infinity;
    TRAIL.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDistance) { bestDistance = d; best = i; }
    });
    const next = TRAIL[Math.min(TRAIL.length - 1, best + 2)];
    return { x: next.x, y: next.y, name: 'Gagner la crête' };
  }

  /** Tronc ou feuillage entre le héros et la caméra (raccourcit le bras de caméra). */
  blocksCamera(x: number, z: number, y: number) {
    if (!inPrologue(x, z, 200)) return false;
    for (const tree of FOREST) {
      const d2 = (x - tree.x) ** 2 + (z - tree.y) ** 2;
      if (d2 < (tree.r + 6) ** 2) return true;
      // Couronne : à partir de 55 % de la hauteur (même valeur que prologue-3d.ts).
      if (y > tree.height * 0.55 && d2 < (tree.r * 3.2) ** 2) return true;
    }
    return false;
  }
}
