import { computed, inject, Injectable, signal } from '@angular/core';
import {
  CHAPTER_FOYER, Chapter, FOYERS, Foyer, FoyerId, PROP_CAURIS, SAVE_KEY, SOULS,
} from '../constants/souls-world';
import { DestructiblesService } from '../engine/destructibles.service';
import { SaveService } from '../slice/save.service';

export interface CaurisStash { x: number; y: number; amount: number }

/** Ce qui survit à la mort et au rechargement de la page. */
export interface SoulsSave {
  foyer: FoyerId;
  chapter: Chapter;
  visited: number;
  cauris: number;
  stash: CaurisStash | null;
  lit: FoyerId[];
}

export interface SoulsPrompt { kind: 'rest'; foyer: Foyer; label: string }

/**
 * Boucle de mort et de progression façon soulslike :
 * - les cauris gagnés tombent là où Ama meurt ; il faut revenir les toucher
 *   avant de mourir à nouveau, sinon ils sont perdus ;
 * - les foyers soignent, remplissent les gourdes, sauvegardent et servent de
 *   point de retour ;
 * La sauvegarde passe par SaveService (IndexedDB, clé 'souls') ; les niveaux,
 * ennemis et raccourcis du donjon sont sauvegardés à part par la tranche.
 *
 * Le service ne connaît ni la caméra ni le rendu : la vue 3D lit son état.
 */
@Injectable({ providedIn: 'root' })
export class SoulsLoopService {
  private readonly destructibles = inject(DestructiblesService);
  private readonly saves = inject(SaveService);

  private readonly state = signal<SoulsSave>(this.fresh());
  /** Objets déjà comptés comme cassés (récompense une seule fois). */
  private seenBroken: boolean[] = [];

  readonly cauris = computed(() => this.state().cauris);
  readonly stash = computed(() => this.state().stash);
  readonly hasSave = signal(false);

  constructor() {
    void this.read().then((save) => this.hasSave.set(save !== null));
  }

  get data(): Readonly<SoulsSave> { return this.state(); }

  /** Nouvelle partie : tout repart de zéro et l'ancienne sauvegarde est remplacée. */
  newGame() {
    this.state.set(this.fresh());
    this.syncBroken();
    this.persist();
  }

  /** Reprend la dernière sauvegarde. Renvoie null s'il n'y en a pas. */
  async load(): Promise<SoulsSave | null> {
    const save = await this.read();
    if (!save) return null;
    this.state.set(save);
    this.syncBroken();
    return save;
  }

  isLit(id: FoyerId) { return this.state().lit.includes(id); }

  /** Foyer où Ama revient après une mort. */
  checkpoint(): { foyer: Foyer; chapter: Chapter; visited: number } {
    const s = this.state();
    return { foyer: FOYERS[s.foyer], chapter: s.chapter, visited: s.visited };
  }

  /** Nouveau chapitre : son premier foyer devient le point de retour. */
  enterChapter(chapter: Chapter, visited: number) {
    const foyer = CHAPTER_FOYER[chapter];
    this.patch({ chapter, visited, foyer, lit: this.withLit(foyer) });
  }

  /** Repos : le foyer s'allume, devient le point de retour, et la partie est sauvegardée. */
  rest(foyer: FoyerId, chapter: Chapter, visited: number) {
    const first = !this.isLit(foyer);
    this.patch({ foyer, chapter, visited, lit: this.withLit(foyer) });
    return first;
  }

  /** Ama tombe : tous ses cauris restent au sol ; une ancienne tache est perdue. */
  die(x: number, y: number): { dropped: number; lost: number } {
    const s = this.state();
    const lost = s.stash?.amount ?? 0;
    this.patch({ cauris: 0, stash: s.cauris > 0 ? { x, y, amount: s.cauris } : null });
    return { dropped: s.cauris, lost };
  }

  /** Contact avec la tache : renvoie le montant récupéré (0 sinon). */
  tryRecover(x: number, y: number): number {
    const stash = this.state().stash;
    if (!stash || Math.hypot(stash.x - x, stash.y - y) > SOULS.stashRadius) return 0;
    this.patch({ cauris: this.state().cauris + stash.amount, stash: null });
    return stash.amount;
  }

  earn(amount: number) {
    if (amount <= 0) return;
    // Pas de sauvegarde à chaque jarre : elle se fait au foyer et à la mort.
    this.state.update((s) => ({ ...s, cauris: s.cauris + amount }));
  }

  /** Dépense des cauris (montée de niveau au foyer, tranche verticale). */
  spend(amount: number): boolean {
    if (amount <= 0 || this.state().cauris < amount) return false;
    this.patch({ cauris: this.state().cauris - amount });
    return true;
  }

  /** Cauris trouvés dans les objets cassés depuis la dernière frame. */
  collectFromProps(): number {
    let total = 0;
    const props = this.destructibles.props;
    props.forEach((prop, index) => {
      const was = this.seenBroken[index] ?? false;
      if (prop.broken && !was) total += PROP_CAURIS[prop.kind] ?? 5;
      this.seenBroken[index] = prop.broken;
    });
    this.earn(total);
    return total;
  }

  /** Invite de repos près d'un foyer, hors combat. */
  promptAt(x: number, y: number): SoulsPrompt | null {
    for (const foyer of Object.values(FOYERS)) {
      if (Math.hypot(foyer.x - x, foyer.y - y) < SOULS.interactRadius) {
        return { kind: 'rest', foyer, label: this.isLit(foyer.id) ? 'Se reposer au foyer' : 'Allumer le foyer' };
      }
    }
    return null;
  }

  private syncBroken() {
    this.seenBroken = this.destructibles.props.map((prop) => prop.broken);
  }

  private withLit(id: FoyerId) {
    const lit = this.state().lit;
    return lit.includes(id) ? lit : [...lit, id];
  }

  private patch(partial: Partial<SoulsSave>) {
    this.state.update((s) => ({ ...s, ...partial }));
    this.persist();
  }

  private persist() {
    // IndexedDB indisponible : put() renvoie false et on joue sans sauvegarde.
    void this.saves.put(SAVE_KEY, this.state()).then((ok) => { if (ok) this.hasSave.set(true); });
  }

  private async read(): Promise<SoulsSave | null> {
    const save = await this.saves.get<Partial<SoulsSave>>(SAVE_KEY);
    if (!save?.foyer || !(save.foyer in FOYERS) || !save.chapter) return null;
    return { ...this.fresh(), ...save } as SoulsSave;
  }

  private fresh(): SoulsSave {
    return {
      foyer: 'gue', chapter: 'battle', visited: 0, cauris: 0, stash: null, lit: ['gue'],
    };
  }
}
