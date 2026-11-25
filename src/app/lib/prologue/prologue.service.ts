import { inject, Injectable, signal } from '@angular/core';
import { PLAYER_CONFIG } from '../constants/player.config-constant';
import { TerrainCollisionService } from '../engine/terrain-collision.service';
import { EquipmentStore } from '../entities/player/equipment.store';
import { PlayerEntity } from '../entities/player/player.entity';
import { PlayerStore } from '../entities/player/player.store';
import {
  CAMP, FOREST, INSPECT_RADIUS, PROLOGUE_AREA, REMAINS, SOLIDS, START, TRAIL,
  inPrologue, walkable, type Remains, type RemainsId, type Spot,
} from './prologue-map';

/** Ouverture : défile seule (≈ 4,6 s par ligne), Espace pour passer. */
export const PROLOGUE_INTRO: readonly string[] = [
  'Feyiase, 1701. Les Asante d’Osei Tutu se lèvent contre le Denkyira, à qui ils payaient tribut.',
  'Kwadwo Ofori marche dans l’arrière-garde, le kyidom. Sa sœur portera la lignée dont naîtra un jour Abla Pokou.',
  'Une balle de mousquet l’a jeté à terre au bord du sentier.',
  'Quand il rouvre les yeux, la colonne est passée. Loin vers l’est, les tambours parlent encore.',
];

/** Fin : à l'arrivée au camp, avant le gué de 1824. */
export const PROLOGUE_OUTRO: readonly string[] = [
  'Kwadwo rejoint l’arrière-garde à la tombée du jour. Devant, le Denkyira est vaincu.',
  'L’Asante ne paiera plus de tribut. Une confédération est née, et avec elle un royaume.',
  'Kwadwo garde sa lance. Ses neveux la porteront après lui, comme le veut la lignée des mères.',
  'Cent vingt-trois ans plus tard, au bord du Pra…',
];

/** Taille du carquois au réveil : quelques flèches seulement. [SUPPOSITION] */
const START_ARROWS = 6;
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

  /** Ligne d'ouverture (ou de fin) affichée, null quand on joue. */
  readonly line = signal<number | null>(null);
  readonly lines = signal<readonly string[]>(PROLOGUE_INTRO);
  /** Reste à portée (invite F). */
  readonly prompt = signal<Remains | null>(null);
  /** Carte de lecture ouverte après F. */
  readonly reading = signal<Remains | null>(null);
  /** Arrivée au camp et fin lue : la partie passe à 1824. */
  readonly finished = signal(false);
  /** Objectif affiché : un peu plus loin sur le sentier, puis le camp. */
  readonly goal = signal<{ x: number; y: number; name: string }>(this.goalFrom(START));

  private readonly read = new Set<RemainsId>();
  private lineTime = 0;
  private readingUntil = 0;
  private outro = false;

  constructor() {
    this.terrain.addRegion(PROLOGUE_AREA);
    this.terrain.addBlocker((x, y, radius) => {
      if (!inPrologue(x, y, 40)) return false;
      if (!walkable(x, y, radius)) return true;
      return SOLIDS.some((s) => (x - s.x) ** 2 + (y - s.y) ** 2 < (s.r + radius) ** 2);
    });
  }

  /** Nouvelle partie : rien n'est lu, l'ouverture se lance. */
  begin() {
    this.read.clear();
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

  /** Équipement d'un soldat de 1701 : lance, arc et quelques flèches, Bandji. */
  equip() {
    this.equipment.setOwned(['spear', 'bow']);
    this.equipment.setWeapon('spear');
    this.equipment.setMaxArrows(START_ARROWS);
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
    const nearest = REMAINS.find((r) => Math.hypot(r.x - x, r.y - y) < INSPECT_RADIUS) ?? null;
    if (nearest !== this.prompt()) this.prompt.set(nearest);
    if (!this.outro && Math.hypot(CAMP.x - x, CAMP.y - y) < CAMP.r && this.playerStore.getData().state !== 'dead') {
      this.outro = true;
      this.prompt.set(null);
      this.reading.set(null);
      this.lines.set(PROLOGUE_OUTRO);
      this.line.set(0);
      this.lineTime = 0;
    }
  }

  /** Touche F : examine le reste à portée. Renvoie vrai si pris. */
  interact(): boolean {
    const target = this.prompt();
    if (!target || this.blocking()) return false;
    const state = this.playerStore.getData().state;
    if (state !== 'idle' && state !== 'moving') return false;
    if (!this.read.has(target.id)) {
      this.read.add(target.id);
      if (target.gives?.arrows) this.equipment.addArrows(target.gives.arrows);
      if (target.gives?.bandji) this.equipment.addBandji(target.gives.bandji);
    }
    this.reading.set(target);
    this.readingUntil = performance.now() + 11000;
    return true;
  }

  closeReading() {
    this.reading.set(null);
  }

  /** Repos à un feu du prologue : flèches de départ rendues. */
  onRest() {
    this.equipment.setMaxArrows(Math.max(START_ARROWS, this.equipment.getData().maxArrows));
    this.equipment.refill();
  }

  hasRead(id: RemainsId) {
    return this.read.has(id);
  }

  private goalFrom({ x, y }: Spot): { x: number; y: number; name: string } {
    let best = 0;
    let bestDistance = Infinity;
    TRAIL.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDistance) { bestDistance = d; best = i; }
    });
    const next = TRAIL[Math.min(TRAIL.length - 1, best + 2)];
    return { x: next.x, y: next.y, name: 'Rejoindre l’armée' };
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
