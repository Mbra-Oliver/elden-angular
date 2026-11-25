import { computed, inject, Injectable, signal } from '@angular/core';
import { BOW_POWER_SHOT, WEAPONS, type WeaponId } from '../constants/equipment.config-constant';
import { TerrainCollisionService } from '../engine/terrain-collision.service';
import { EquipmentStore } from '../entities/player/equipment.store';
import { PlayerEntity } from '../entities/player/player.entity';
import { PlayerStore } from '../entities/player/player.store';
import { ArrowService, type ArrowHit, type ArrowTarget } from '../entities/projectiles/arrow.service';
import { EnemiesService, type Enemy } from './enemies.service';
import { ProgressionStore } from './progression.store';
import { SaveService, type SaveData } from './save.service';
import {
  ENEMIES, EXPEDITION_JOURNAL, HOOK_LINES, ITEMS, SPECIALS, SPIRIT, STATS, type SpecialId, type StatId,
} from './slice-content';
import {
  circleHitsRect, DOORS, DUNGEON, DUNGEON_ENTRANCE, DUNGEON_WALLS, inRect, ITEM_PLACEMENTS, LEVER, MOUNDS,
  REST_POINTS, type DoorId, type ItemPlacement, type Rect, type RestId,
} from './slice-map';

export interface Prompt { label: string; x: number; y: number }

type Interactable =
  | { kind: 'item'; item: ItemPlacement; x: number; y: number }
  | { kind: 'door'; id: DoorId; x: number; y: number }
  | { kind: 'lever'; x: number; y: number };

const INTERACT_RADIUS = 46;

/**
 * Chef d'orchestre de la tranche verticale : carte (murs, portes, levier),
 * ennemis de terrain, points de repos, objets, progression, attaques
 * spéciales, accroche d'ouverture et sauvegarde automatique.
 *
 * GameStateService ne l'appelle qu'à travers quelques points d'accroche
 * (update, objectif, flèches, mort/reprise) pour rester lisible par les
 * autres chantiers.
 */
@Injectable({ providedIn: 'root' })
export class SliceService {
  readonly progression = inject(ProgressionStore);
  readonly enemies = inject(EnemiesService);
  private readonly saves = inject(SaveService);
  private readonly terrain = inject(TerrainCollisionService);
  private readonly player = inject(PlayerEntity);
  private readonly playerStore = inject(PlayerStore);
  private readonly equipment = inject(EquipmentStore);
  private readonly arrows = inject(ArrowService);

  /** Accroche : index de la ligne affichée, null quand elle est finie. */
  readonly hookLine = signal<number | null>(null);
  private hookTime = 0;
  /** Menu du feu (repos, niveaux) ouvert : le jeu est en pause. */
  readonly restMenu = signal<RestId | null>(null);
  /** Carte d'objet ramassé (nom, effet, lore). */
  readonly pickup = signal<{ name: string; effect: string; lore: string } | null>(null);
  private pickupUntil = 0;
  readonly prompt = signal<Prompt | null>(null);
  readonly notice = signal<string | null>(null);
  private noticeUntil = 0;
  readonly inDungeon = signal(false);
  readonly hasSave = signal(false);
  /** Vrai pendant l'Acte II hors duel : la carte de la tranche est active. */
  private fieldActive = false;

  private readonly openDoors = new Set<DoorId>();
  private spinBase = 0;
  private specialPressed = false;
  private readonly arrowScratch: { targets: ArrowTarget[]; enemies: Enemy[] } = { targets: [], enemies: [] };

  /** Murs + portes fermées (collision, ligne de tir, flèches). */
  private solids: Rect[] = [...DUNGEON_WALLS, ...DOORS.map((d) => d.rect)];

  readonly blocking = computed(() => this.hookLine() !== null || this.restMenu() !== null);

  readonly stage = computed(() => {
    const flags = this.progression.flags();
    if (!flags.has('metYao')) return 'yao';
    if (!flags.has('lever')) return this.inDungeon() ? 'dungeon' : 'plain';
    return 'done';
  });

  constructor() {
    this.enemies.walls = () => this.solids;
    this.enemies.onKill = (enemy) => {
      const reward = ENEMIES[enemy.kind].cowries;
      this.progression.addCowries(reward);
      this.say(`+${reward} cauris`);
    };
    this.terrain.addBlocker((x, y, radius) => {
      if (x < 600 - radius) return false;
      if (this.solids.some((rect) => circleHitsRect(x, y, radius, rect))) return true;
      return MOUNDS.some((m) => (x - m.x) ** 2 + (y - m.y) ** 2 < (radius + m.r * 0.85) ** 2);
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (event) => {
        if (event.code === 'KeyC' && !event.repeat) this.specialPressed = true;
      });
    }
    void this.refreshSave();
  }

  // ------------------------------------------------------ CYCLE DE VIE

  /** Nouvelle partie : tout repart de zéro et l'accroche se lance. */
  newGame() {
    this.progression.reset();
    this.openDoors.clear();
    this.syncDoors();
    this.enemies.respawnAll();
    this.restMenu.set(null);
    this.pickup.set(null);
    this.fieldActive = false;
    this.equipment.setOwned(['spear', 'bow']);
    this.hookLine.set(0);
    this.hookTime = 0;
  }

  skipHook() {
    const line = this.hookLine();
    if (line === null) return;
    this.hookTime = 0;
    this.hookLine.set(line + 1 < HOOK_LINES.length ? line + 1 : null);
  }

  /** Passage à l'Acte II (après le gué) : premier feu et première sauvegarde. */
  enterActTwo() {
    this.progression.restPoint.set('goli');
    this.applyLoadout();
    void this.save(0);
  }

  /** Points de vie, endurance, armes et mixtures selon la progression. */
  applyLoadout() {
    const maxHp = this.progression.maxHp();
    const maxStamina = this.progression.maxStamina();
    this.playerStore.update({ maxHp, hp: maxHp, maxStamina, stamina: maxStamina });
    const items = this.progression.items();
    const owned: WeaponId[] = items.includes('afena') ? ['spear', 'afena', 'bow'] : ['spear', 'bow'];
    this.equipment.setOwned(owned);
    this.equipment.setMaxMixture(3 + (items.includes('calebasse') ? 1 : 0));
    this.equipment.refill();
  }

  /** Reprise (mort ou chargement) : ennemis à leur poste, portes selon la progression. */
  resetWorld() {
    this.enemies.respawnAll();
    this.syncDoors();
    this.applyLoadout();
  }

  setFieldActive(active: boolean) {
    this.fieldActive = active;
    if (!active) this.prompt.set(null);
  }

  // ---------------------------------------------------------- BOUCLE

  /** Accroche : fait défiler les lignes ; renvoie vrai tant qu'elle bloque le jeu. */
  tickHook(dt: number) {
    if (this.hookLine() === null) return false;
    this.hookTime += dt;
    if (this.hookTime > 4.2) this.skipHook();
    return true;
  }

  update(dt: number, inCombat: boolean) {
    const now = performance.now();
    if (this.pickup() && now > this.pickupUntil) this.pickup.set(null);
    if (this.notice() && now > this.noticeUntil) this.notice.set(null);
    this.handleSpecial();
    if (!this.fieldActive || inCombat) return;

    const px = this.player.centerX;
    const py = this.player.centerY;
    this.inDungeon.set(inRect(px, py, DUNGEON, -4));
    this.enemies.update(dt, this.player.special === 'tourbillon');
    this.prompt.set(this.describe(this.nearest(px, py)));
  }

  /** Après la mise à jour du joueur : rotation du tourbillon, cible des coups. */
  aimTarget(): { x: number; y: number } | undefined {
    if (!this.fieldActive) return undefined;
    const enemy = this.enemies.nearestEngaged(125);
    return enemy ? { x: enemy.x, y: enemy.y } : undefined;
  }

  spinFacing() {
    const data = this.playerStore.getData();
    if (this.player.special !== 'tourbillon' || data.state !== 'attacking') return;
    const attack = SPECIALS.tourbillon.attack!;
    const elapsed = attack.duration - data.stateTimer;
    const t = Math.max(0, Math.min(1, (elapsed - attack.windup) / attack.active));
    const angle = this.spinBase + t * Math.PI * 2;
    this.playerStore.update({ facingX: Math.cos(angle), facingY: Math.sin(angle) });
  }

  // ------------------------------------------------- ATTAQUES SPÉCIALES

  private handleSpecial() {
    if (!this.specialPressed) return;
    this.specialPressed = false;
    const data = this.playerStore.getData();
    if (data.state !== 'idle' && data.state !== 'moving') return;
    const weapon = this.equipment.getData().weapon;
    const id: SpecialId = weapon === 'bow' ? 'volee' : weapon === 'afena' ? 'tourbillon' : 'percee';
    if (this.progression.spirit() < SPIRIT.specialCost) {
      this.say(`Ardeur insuffisante (${SPECIALS[id].name})`);
      return;
    }
    if (id === 'volee' && this.equipment.getData().arrows <= 0) {
      this.say('Plus de flèches');
      return;
    }
    this.progression.spendSpirit();
    const length = Math.hypot(data.facingX, data.facingY) || 1;
    const fx = data.facingX / length;
    const fy = data.facingY / length;
    this.say(SPECIALS[id].name);

    if (id === 'volee') {
      this.equipment.consumeArrow();
      const damage = BOW_POWER_SHOT.damage * 0.75;
      for (const spread of [-0.2, 0, 0.2]) {
        const c = Math.cos(spread);
        const s = Math.sin(spread);
        const dx = fx * c - fy * s;
        const dy = fx * s + fy * c;
        this.arrows.fire(this.player.centerX + dx * 16, this.player.centerY + dy * 16, dx, dy,
          BOW_POWER_SHOT.arrowSpeed, damage, BOW_POWER_SHOT.maxDistance);
      }
      return;
    }

    const attack = SPECIALS[id].attack!;
    this.player.special = id;
    this.spinBase = Math.atan2(fy, fx);
    const lunge = id === 'percee' ? 760 : 90;
    this.playerStore.update({
      state: 'attacking',
      attackType: id === 'percee' ? 'counter' : 'heavy',
      stateTimer: attack.duration,
      vx: fx * lunge, vy: fy * lunge,
      comboCount: 0, comboTimer: 0,
    });
  }

  // --------------------------------------------------------- FLÈCHES

  /** Cibles des flèches hors duel (null si la carte n'est pas active). */
  arrowTargets(): ArrowTarget[] | null {
    if (!this.fieldActive) return null;
    this.enemies.arrowTargets(this.arrowScratch);
    return this.arrowScratch.targets;
  }

  arrowBlocked = (x: number, y: number) =>
    this.fieldActive && x > 1890 && this.solids.some((rect) => inRect(x, y, rect));

  onArrowHit(hit: ArrowHit) {
    const enemy = hit.index !== undefined ? this.arrowScratch.enemies[hit.index] : undefined;
    if (!enemy) return;
    this.enemies.damageEnemy(enemy, this.arrowDamage(hit.damage), hit.dirX, hit.dirY, hit.damage > 15);
  }

  arrowDamage(base: number) {
    this.progression.gainSpirit(SPIRIT.perArrowHit);
    return base * this.progression.bowMultiplier();
  }

  /** Multiplicateur de dégâts au corps à corps (boss compris). */
  meleeDamage(base: number) {
    this.progression.gainSpirit(SPIRIT.perMeleeHit * (this.player.special ? 0 : 1));
    const weapon = this.equipment.getData().weapon;
    const weaponBonus = weapon === 'afena' ? this.progression.afenaMultiplier() : this.progression.spearMultiplier();
    return base * weaponBonus * (this.player.special ? this.progression.specialMultiplier() : 1);
  }

  // ---------------------------------------------------- INTERACTIONS

  private nearest(px: number, py: number): Interactable | null {
    const options: Interactable[] = [];
    for (const item of ITEM_PLACEMENTS) {
      if (!this.progression.items().includes(item.id)) options.push({ kind: 'item', item, x: item.x, y: item.y });
    }
    for (const door of DOORS) {
      if (this.openDoors.has(door.id)) continue;
      const r = door.rect;
      options.push({ kind: 'door', id: door.id, x: r.x + r.w / 2, y: r.y + r.h / 2 });
    }
    if (this.progression.has('metYao') && !this.progression.has('lever')) {
      options.push({ kind: 'lever', x: LEVER.x, y: LEVER.y });
    }
    let best: Interactable | null = null;
    let bestDistance = INTERACT_RADIUS;
    for (const option of options) {
      const distance = Math.hypot(option.x - px, option.y - py);
      if (distance < bestDistance) { best = option; bestDistance = distance; }
    }
    return best;
  }

  private describe(target: Interactable | null): Prompt | null {
    if (!target) return null;
    const label = target.kind === 'item' ? `Ramasser · ${ITEMS[target.item.id].name}`
      : target.kind === 'lever' ? 'Actionner le levier du canal'
      : DOORS.find((d) => d.id === target.id)!.name;
    return { label, x: target.x, y: target.y };
  }

  /** Touche F : renvoie vrai si la tranche a pris l'interaction. */
  interact(): boolean {
    if (!this.fieldActive || this.blocking()) return false;
    const player = this.playerStore.getData();
    if (player.state !== 'idle' && player.state !== 'moving') return false;
    const target = this.nearest(this.player.centerX, this.player.centerY);
    if (!target) return false;
    if (target.kind === 'item') this.take(target.item);
    else if (target.kind === 'lever') this.pullLever();
    else this.tryDoor(target.id);
    return true;
  }

  /**
   * Repos à un foyer (appelé par la boucle soulslike, qui gère F, le soin et
   * le point de retour) : les ennemis reviennent, la progression s'applique
   * et le menu des niveaux s'ouvre.
   */
  onRest(id: string) {
    if (id in REST_POINTS) this.progression.restPoint.set(id as RestId);
    this.applyLoadout();
    this.enemies.respawnAll();
    this.arrows.reset();
    this.restMenu.set((id in REST_POINTS ? id : "goli") as RestId);
    void this.save();
  }

  closeRestMenu() {
    this.restMenu.set(null);
  }

  levelUp(stat: StatId) {
    if (!this.progression.levelUp(stat)) {
      this.say(this.progression.stats()[stat] >= 20 ? `${STATS[stat].name} au maximum` : 'Pas assez de cauris');
      return;
    }
    this.applyLoadout();
    this.say(`${STATS[stat].name} ${this.progression.stats()[stat]}`);
    void this.save();
  }

  private take(item: ItemPlacement) {
    this.progression.addItem(item.id);
    const info = ITEMS[item.id];
    if (item.id === 'poids') this.progression.addCowries(250);
    if (item.id === 'perle') this.progression.bumpStat('sunsum');
    if (item.id === 'afena') {
      this.equipment.setOwned(['spear', 'afena', 'bow']);
    }
    if (item.id === 'calebasse') {
      this.equipment.setMaxMixture(4);
      this.equipment.refill();
    }
    this.pickup.set(info);
    this.pickupUntil = performance.now() + 9000;
    void this.save();
  }

  private pullLever() {
    this.progression.setFlag('lever');
    this.openDoors.add('passage');
    this.syncDoors();
    this.say('Le canal gronde. Le passage de la digue s’ouvre à l’ouest.', 3200);
    void this.save();
  }

  private tryDoor(id: DoorId) {
    const door = DOORS.find((d) => d.id === id)!;
    if (!door.opensFrom(this.player.centerX, this.player.centerY)) {
      this.say(door.lockedText, 2600);
      return;
    }
    this.openDoors.add(id);
    this.progression.setFlag(`door:${id}`);
    this.syncDoors();
    this.say('Raccourci ouvert : le feu de la digue est juste derrière.', 2600);
    void this.save();
  }

  isDoorOpen(id: DoorId) {
    return this.openDoors.has(id);
  }

  private syncDoors() {
    for (const door of DOORS) {
      if (this.progression.has(`door:${door.id}`) || (door.id === 'passage' && this.progression.has('lever'))) {
        this.openDoors.add(door.id);
      }
    }
    this.solids = [...DUNGEON_WALLS, ...DOORS.filter((d) => !this.openDoors.has(d.id)).map((d) => d.rect)];
  }

  say(text: string, milliseconds = 1600) {
    this.notice.set(text);
    this.noticeUntil = performance.now() + milliseconds;
  }

  // ------------------------------------------------- OBJECTIF / JOURNAL

  /** Objectif de l'expédition (null : laisser l'objectif du village). */
  objective(): { x: number; y: number; name: string } | null {
    const stage = this.stage();
    if (stage === 'plain') return DUNGEON_ENTRANCE;
    if (stage === 'dungeon') return LEVER;
    return null;
  }

  journal(): string | null {
    const stage = this.stage();
    return stage === 'yao' ? null : EXPEDITION_JOURNAL[stage];
  }

  startExpedition() {
    this.progression.setFlag('metYao');
    void this.save();
  }

  // --------------------------------------------------------- SAUVEGARDE

  private visitedRef = 2;

  snapshot(visited = this.visitedRef): SaveData {
    return {
      version: 1,
      savedAt: Date.now(),
      visited,
      restPoint: this.progression.restPoint() ?? 'goli',
      stats: { ...this.progression.stats() },
      flags: [...this.progression.flags()],
      items: [...this.progression.items()],
      owned: [...this.equipment.getData().owned],
      weapon: this.equipment.getData().weapon,
    };
  }

  /** Mémorise l'étape du village pour les sauvegardes suivantes. */
  setVisited(visited: number) {
    this.visitedRef = visited;
  }

  async save(visited?: number) {
    if (visited !== undefined) this.visitedRef = visited;
    const ok = await this.saves.save(this.snapshot());
    if (ok) {
      this.hasSave.set(true);
      this.say('Sauvegarde', 900);
    }
  }

  async refreshSave() {
    this.hasSave.set(!!(await this.saves.load()));
  }

  loadSave() {
    return this.saves.load();
  }

  /** Applique une sauvegarde (Continuer ou reprise après la mort). */
  restore(data: SaveData) {
    this.progression.reset();
    this.progression.stats.set({ ...data.stats });
    this.progression.flags.set(new Set(data.flags));
    this.progression.items.set([...data.items]);
    this.progression.restPoint.set(data.restPoint);
    this.visitedRef = data.visited;
    this.openDoors.clear();
    this.syncDoors();
    this.hookLine.set(null);
    this.restMenu.set(null);
    this.applyLoadout();
    if (data.owned.includes(data.weapon)) this.equipment.setWeapon(data.weapon);
    this.enemies.respawnAll();
  }

  /** Continuer : recharge la progression de la tranche (clé 'slice' d'IndexedDB). */
  async loadProgress(): Promise<boolean> {
    const data = await this.saves.load();
    if (data) this.restore(data);
    return !!data;
  }

  /** Apparence de l'équipement (batakari, teinte de lame, spéciale prête). */
  look(): { batakari: boolean; tier: 0 | 1 | 2; ready: boolean } {
    const force = this.progression.stats().force;
    return {
      batakari: this.progression.items().includes('batakari'),
      tier: force >= 8 ? 2 : force >= 4 ? 1 : 0,
      ready: this.progression.spirit() >= SPIRIT.specialCost,
    };
  }

    weaponName(id: WeaponId) {
    return WEAPONS[id].name;
  }
}
