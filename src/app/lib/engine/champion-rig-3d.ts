import * as T from 'three';
import { BOSS_ATTACKS, shotAngles } from '../interfaces/BossAttackData';
import { BOSS_CONFIG } from '../constants/boss.config-constant';
import type { FighterRig } from './boss-rig-3d';
import { dressHuman } from './human-body';
import { baduOutfit } from './human-outfits';
import type { Actor3D } from './world-3d';

/**
 * Badu Ofosu, porte-hache de Ntim Gyakari (chapitre 1, 1701).
 *
 * Il réutilise le squelette humain du duelliste, mais pas ses poses : ce
 * module l'habille (torse nu scarifié, pagne de guerre sombre, coiffe de
 * cuir à l'insigne d'or terne, poire à poudre en corne), lui met la hache
 * dans la main droite et le mousquet dans la gauche, et anime son corps
 * (animateBadu) comme un vétéran lourd : genoux fléchis, bassin bas, souffle
 * visible, poids qui passe d'un appui à l'autre, épaules engagées dans
 * chaque coup, déséquilibre et effort après les frappes lourdes, regard
 * verrouillé sur le joueur.
 *
 * Mousquet : un filet de fumée noire et une lueur rouge à la platine
 * pendant la visée, éclair et nuage au départ, braise sur la ligne de tir.
 * À mi-vie, il le brise contre la roche (transition de phase).
 * [SUPPOSITION] Formes, couleurs et angles à valider en jeu.
 */

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInCubic = (t: number) => t * t * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
/** Armement : rapide puis tenu, avec un tremblement de muscles à la fin. */
const coil = (t: number, now: number) => easeOutCubic(clamp01(t / 0.75)) + (t > 0.75 ? Math.sin(now * 0.09) * 0.025 : 0);

/** Taille de Badu par rapport au héros (fiche : environ 1,25×). */
export const BADU_SCALE = 1.25;

type Vec3 = [number, number, number];
interface Joints {
  torsoX: number; torsoY: number; torsoZ: number; lift: number; lunge: number; side: number; hop: number;
  armL: Vec3; armR: Vec3; legL?: number; legR?: number; crouch: number; pitch: number;
}

/**
 * Pose de Badu, appelée après l'animation de base de World3D (marche).
 * `pose.phase` : avancement 0→1 de l'état courant.
 */
export function animateBadu(f: FighterRig, pose: Actor3D, now: number) {
  const k = clamp01(pose.phase);
  const attack = pose.attack ?? 'none';
  const two = (pose.bossPhase ?? 1) >= 2;
  // Souffle : lent et maîtrisé en phase 1, court et bruyant en phase 2.
  const breath = Math.sin(now * (two ? 0.0075 : 0.0034));
  const j: Joints = {
    torsoX: 0.14 + breath * 0.025, torsoY: 0, torsoZ: Math.sin(now * 0.0013) * 0.035, lift: -2.4 + breath * 0.5,
    lunge: 0, side: 0, hop: 0, crouch: 0.12, pitch: 0,
    // Garde : hache basse devant (droite), mousquet tenu contre la hanche (gauche) ;
    // en phase 2, les deux mains sur la hache.
    armR: [-0.75, 0, -0.22], armL: two ? [-0.95, 0, -0.42] : [-0.35, 0, 0.22],
  };
  f.root.rotation.order = 'YXZ';
  f.root.rotation.x = 0;

  switch (pose.state) {
    case 'chase': {
      // Marche lourde : buste penché, bassin bas ; en phase 2, posture animale.
      j.torsoX = two ? 0.42 : 0.2;
      j.lift = two ? -4.2 : -2.6;
      j.crouch = two ? 0.24 : 0.14;
      applyJoints(f, j, pose, true);
      return;
    }
    case 'windup':
      windup(j, attack, coil(k, now), k, now, two);
      break;
    case 'attacking':
      strike(j, attack, k, pose.step ?? 0, now, two);
      break;
    case 'recover':
      recover(j, attack, k, now);
      break;
    case 'hurt':
    case 'stunned': {
      const b = 1 - k;
      j.torsoX = -0.5 * b;
      j.torsoZ = 0.3 * b * Math.sin(now * 0.05);
      j.lunge = -6 * b;
      j.armR = [0.3 * b - 0.75 * (1 - b), 0, -0.5 * b];
      j.armL = [0.2 * b - 0.35 * (1 - b), 0, 0.5 * b];
      break;
    }
    case 'shift':
      breakMusket(j, k, now);
      break;
    case 'dead':
      fall(f, j, k, now);
      break;
    default: // idle : garde active
      break;
  }
  applyJoints(f, j, pose, false);
}

/** En marche (walking), on garde le balancier des jambes de la démarche de base. */
function applyJoints(f: FighterRig, j: Joints, pose: Actor3D, walking: boolean) {
  f.torso.position.y = 16 + j.lift;
  f.torso.rotation.set(j.torsoX, j.torsoY, walking ? f.torso.rotation.z : j.torsoZ);
  f.arms[0].rotation.set(...j.armL);
  f.arms[1].rotation.set(...j.armR);
  // Genoux fléchis : la jambe se raccourcit, le corps descend d'autant.
  f.legs[0].scale.y = Math.min(f.legs[0].scale.y, 1 - j.crouch);
  f.legs[1].scale.y = Math.min(f.legs[1].scale.y, 1 - j.crouch);
  if (j.legL !== undefined) f.legs[0].rotation.x = j.legL;
  if (j.legR !== undefined) f.legs[1].rotation.x = j.legR;
  const fx = pose.facingX;
  const fy = pose.facingY;
  f.root.position.x += fx * j.lunge - fy * j.side;
  f.root.position.z += fy * j.lunge + fx * j.side;
  f.root.position.y += j.hop;
  f.root.rotation.x += j.pitch;
}

/** Anticipation : le corps s'arme à l'opposé du coup, l'appui passe sur la jambe arrière. */
function windup(j: Joints, attack: string, e: number, k: number, now: number, two: boolean) {
  switch (attack) {
    case 'shot': // il plante la hache et épaule le mousquet, buste de profil
      j.armR = [lerp(-0.75, 0.3, e), 0, lerp(-0.22, -0.45, e)];
      j.armL = [lerp(-0.35, -1.5, e), 0, lerp(0.22, 0.18, e)];
      j.torsoY = 0.45 * e;
      j.torsoX = 0.05;
      j.lift = -3;
      j.lunge = -4 * easeOutCubic(clamp01(k / 0.3));
      break;
    case 'reap': // épaule droite ramenée loin en arrière, poids sur l'appui arrière
      j.torsoY = -1.15 * e;
      j.torsoX = 0.18;
      j.armR = [-1.15, 0, -0.25 - 0.95 * e];
      j.armL = two ? [-1.0, 0, -0.6] : [-0.45, 0, 0.35];
      j.lift = -2.4 - 1.6 * e;
      j.lunge = -3 * e;
      j.crouch = 0.2;
      break;
    case 'judgment':
    case 'feint': // même armement : hache levée haut à deux mains (la feinte s'annule à 0,4 s)
      if (attack === 'feint' && two) { // feinte du bond : il fléchit comme pour sauter
        j.lift = -2.4 - 4.5 * e;
        j.torsoX = 0.2 + 0.45 * e;
        j.armR = [-0.75 - 0.6 * e, 0, -0.3];
        j.armL = [-0.95 - 0.6 * e, 0, -0.5];
        j.crouch = 0.12 + 0.22 * e;
        break;
      }
      j.armR = [lerp(-0.75, -2.75, e), 0, -0.12];
      j.armL = [lerp(two ? -0.95 : -0.35, -2.55, e), 0, 0.05];
      j.torsoX = lerp(0.14, -0.38, e);
      j.lift = lerp(-2.4, 0.8, e);
      j.crouch = 0.05;
      break;
    case 'backhand': // le buste s'enroule, la crosse part vers l'arrière
      j.torsoY = 0.75 * e;
      j.armL = [-0.6, 0, 0.22 - 0.6 * e];
      j.lift = -2.8;
      break;
    case 'furrow': // accroupi, hache traînée derrière lui, fer contre la roche
      j.lift = -2.4 - 3.4 * e;
      j.torsoX = 0.14 + 0.5 * e;
      j.armR = [0.55 * e - 0.75 * (1 - e), 0, -0.35];
      j.armL = [0.4 * e - 0.95 * (1 - e), 0, -0.2];
      j.crouch = 0.12 + 0.15 * e;
      j.lunge = -3 * e;
      break;
    case 'leap': // flexion profonde, cri : les bras partent en arrière
      j.lift = -2.4 - 6 * e;
      j.torsoX = 0.14 + 0.55 * e;
      j.armR = [-0.75 + 0.9 * e, 0, -0.3];
      j.armL = [-0.95 + 1.0 * e, 0, -0.3];
      j.crouch = 0.12 + 0.28 * e;
      break;
    case 'mill': { // la hache tournoie une fois au-dessus de la tête
      const spin = k * TAU;
      j.armR = [-2.7, 0, -0.2 + Math.sin(spin) * 0.6];
      j.armL = [-2.5, 0, 0.1 + Math.sin(spin) * 0.6];
      j.torsoY = Math.sin(spin) * 0.35;
      j.torsoX = -0.2;
      j.lift = -1.5;
      break;
    }
    case 'thrust': // hache ramenée contre la hanche, pointe en avant
      j.armR = [-0.9, 0, -0.05];
      j.armL = [-1.05, 0, -0.55];
      j.torsoY = -0.55 * e;
      j.lift = -3.6 * e - 2.4;
      j.lunge = -3.5 * e;
      j.crouch = 0.2;
      break;
  }
}

/** Impact : départ explosif, l'arme fend l'air, le corps suit le coup puis se reprend. */
function strike(j: Joints, attack: string, k: number, step: number, now: number, two: boolean) {
  const snap = easeOutExpo(clamp01(k / 0.3));
  const settle = easeInOut(clamp01((k - 0.3) / 0.7));
  switch (attack) {
    case 'shot': { // recul du coup : épaule et buste repoussés
      const kick = Math.sin(clamp01(k / 0.4) * Math.PI);
      j.armR = [0.3, 0, -0.45];
      j.armL = [-1.5 + 0.6 * kick, 0, 0.18];
      j.torsoY = 0.45;
      j.torsoX = 0.05 - 0.28 * kick;
      j.lift = -3;
      j.lunge = -4 - 3 * kick;
      break;
    }
    case 'reap': { // deux balayages : droite-gauche puis gauche-droite
      const local = (k * 2) % 1;
      const s = easeOutExpo(clamp01((local - 0.15) / 0.35));
      const dir = step === 0 ? 1 : -1;
      j.torsoY = lerp(-1.15 * dir, 1.1 * dir, s);
      j.armR = [-1.2, 0, -0.2 + 0.9 * dir * (2 * s - 1)];
      j.armL = two ? [-1.0, 0, -0.6] : [-0.45, 0, 0.35];
      j.lift = -3.6 + 0.8 * s;
      j.lunge = 7 * s;
      j.crouch = 0.22;
      break;
    }
    case 'judgment': { // la hache tombe : tout le poids du corps suit
      const hit = easeInCubic(clamp01(k / 0.25));
      j.armR = [lerp(-2.75, -0.1, hit), 0, -0.12];
      j.armL = [lerp(-2.55, 0, hit), 0, 0];
      j.torsoX = lerp(-0.38, 0.85, hit);
      j.lift = lerp(0.8, -6, hit);
      j.lunge = 7 * hit;
      j.crouch = 0.25 * hit;
      break;
    }
    case 'feint': {
      // Il annule l'abattage : pas de côté, puis coup de crosse horizontal (P1)
      // ou estoc à la hache (P2).
      const drop = easeOutCubic(clamp01(k / 0.4));
      const s = easeOutExpo(clamp01((k - 0.4) / 0.3));
      if (two) {
        j.armR = [lerp(-1.35, -1.6, s), 0, -0.05];
        j.armL = [lerp(-1.55, -1.6, s), 0, -0.5];
        j.torsoY = lerp(-0.5, 0.25, s);
        j.lunge = 12 * s;
        j.lift = -4;
      } else {
        j.armR = [lerp(-2.75, -0.6, drop), 0, -0.3];
        j.armL = [-1.3, 0, lerp(0.9, -0.7, s)];
        j.torsoY = lerp(0.7, -0.9, s);
        j.lift = lerp(0.8, -3, drop);
        j.lunge = 5 * s;
      }
      j.torsoZ = -0.15 * drop * (1 - s);
      break;
    }
    case 'backhand': { // rotation rapide du buste, la crosse frappe dans le dos
      j.torsoY = lerp(0.75, -2.3, snap) + 0.4 * settle;
      j.armL = [-0.6, 0, -0.4 + 1.6 * snap];
      j.lift = -3;
      break;
    }
    case 'furrow': {
      if (k < 0.8) { // course, fer qui racle la roche
        const run = Math.sin(now * 0.034);
        j.torsoX = 0.6;
        j.lift = -4 + Math.abs(run) * 1;
        j.armR = [0.55, 0, -0.35];
        j.armL = [0.4, 0, -0.2];
        j.legL = run * 1.0;
        j.legR = -run * 1.0;
      } else { // uppercut : la hache remonte d'un coup
        const up = easeOutExpo(clamp01((k - 0.8) / 0.15));
        j.armR = [lerp(0.55, -2.6, up), 0, -0.2];
        j.armL = [lerp(0.4, -2.3, up), 0, -0.1];
        j.torsoX = lerp(0.6, -0.35, up);
        j.lift = lerp(-4, 1, up);
      }
      break;
    }
    case 'leap': { // vol, hache au-dessus de la tête, puis écrasement
      const air = clamp01(k / 0.72);
      if (k < 0.72) {
        j.hop = Math.sin(air * Math.PI) * 30;
        j.armR = [-2.8, 0, -0.1];
        j.armL = [-2.6, 0, 0];
        j.torsoX = -0.3;
        j.lift = 0;
        j.legL = -0.6;
        j.legR = 0.3;
      } else {
        const hit = easeOutExpo(clamp01((k - 0.72) / 0.12));
        j.armR = [lerp(-2.8, -0.1, hit), 0, -0.1];
        j.armL = [lerp(-2.6, 0, hit), 0, 0];
        j.torsoX = lerp(-0.3, 0.8, hit);
        j.lift = lerp(0, -6.5, hit);
        j.crouch = 0.3 * hit;
      }
      break;
    }
    case 'mill': { // 2 diagonales, 1 circulaire, 1 écrasement
      const local = (k * 4) % 1;
      const s = easeOutExpo(clamp01((local - 0.15) / 0.35));
      if (step < 2) {
        const dir = step === 0 ? 1 : -1;
        j.torsoY = lerp(-0.9 * dir, 0.9 * dir, s);
        j.armR = [lerp(-2.4, -0.4, s), 0, 0.6 * dir * (1 - s)];
        j.armL = [lerp(-2.2, -0.5, s), 0, -0.3];
        j.lunge = 5 * s;
      } else if (step === 2) {
        j.torsoY = -0.8 + easeInOut(local) * (TAU + 0.8);
        j.armR = [-1.3, 0, -1.2];
        j.armL = [-1.2, 0, -0.9];
      } else {
        const hit = easeInCubic(clamp01(local / 0.3));
        j.armR = [lerp(-2.7, -0.1, hit), 0, -0.1];
        j.armL = [lerp(-2.5, 0, hit), 0, 0];
        j.torsoX = lerp(-0.3, 0.8, hit);
        j.lift = lerp(0.5, -6, hit);
        j.lunge = 6 * hit;
      }
      j.crouch = 0.2;
      break;
    }
    case 'thrust': { // estoc direct, tout le corps derrière le fer
      j.armR = [lerp(-0.9, -1.6, snap), 0, -0.05];
      j.armL = [lerp(-1.05, -1.6, snap), 0, -0.5];
      j.torsoY = lerp(-0.55, 0.3, snap);
      j.torsoX = 0.3 * snap;
      j.lunge = 14 * snap - 4 * settle;
      j.lift = -4;
      j.crouch = 0.25;
      break;
    }
  }
}

/** Récupération : effort visible après les coups lourds, rechargement après le tir. */
function recover(j: Joints, attack: string, k: number, now: number) {
  const b = 1 - easeOutCubic(k);
  switch (attack) {
    case 'shot': { // il verse la poudre et tasse la balle à la baguette
      const ram = Math.sin(now * 0.014);
      j.armL = [-0.2, 0, 0.12];
      j.armR = [-1.25 + 0.35 * ram, 0, 0.55];
      j.torsoX = 0.3;
      j.torsoY = 0.3;
      j.lift = -3;
      break;
    }
    case 'judgment': // la hache s'est enfoncée : déséquilibre, il l'arrache du sol
    case 'leap': {
      const pull = easeInOut(clamp01((k - 0.45) / 0.55));
      j.torsoX = lerp(0.85, 0.2, pull);
      j.lift = lerp(-6, -2.4, pull);
      j.armR = [lerp(-0.1, -0.75, pull), 0, -0.12];
      j.armL = [lerp(0, -0.95, pull), 0, 0];
      j.torsoZ = 0.12 * Math.sin(k * Math.PI);
      j.crouch = 0.25 * (1 - pull);
      break;
    }
    case 'mill': { // essoufflé : courbé sur le manche, le souffle soulève les épaules
      const gasp = Math.sin(now * 0.018);
      j.torsoX = 0.95 * (1 - easeInCubic(clamp01((k - 0.8) / 0.2))) + 0.1;
      j.lift = -5.5 + gasp * 1.3;
      j.armR = [0.15, 0, -0.35];
      j.armL = [0.1, 0, 0.35];
      j.crouch = 0.3;
      break;
    }
    default:
      j.torsoX = 0.14 + 0.45 * b;
      j.lift = -2.4 - 2 * b + Math.sin(now * 0.012) * 0.6 * b;
      break;
  }
}

/** Transition de phase : il brise la crosse de son mousquet contre la roche, puis rugit. */
function breakMusket(j: Joints, k: number, now: number) {
  if (k < 0.42) {
    const raise = easeOutCubic(clamp01(k / 0.25));
    const smash = easeInCubic(clamp01((k - 0.25) / 0.17));
    j.armL = [lerp(-0.35, -2.6, raise) + 2.5 * smash, 0, 0.3];
    j.armR = [-0.5, 0, -0.3];
    j.torsoX = -0.3 * raise + 0.8 * smash;
    j.torsoZ = -0.2 * raise;
    j.lift = -2.4 - 4 * smash;
  } else {
    const roar = easeOutBack(clamp01((k - 0.5) / 0.4));
    const tremble = Math.sin(now * 0.09) * 0.04;
    j.armR = [-0.8 * roar, 0, -0.2 - 1.3 * roar];
    j.armL = [-0.6 * roar, 0, 0.2 + 1.4 * roar];
    j.torsoX = 0.6 * (1 - roar) - 0.35 * roar + tremble;
    j.lift = -6 * (1 - roar) + 0.5 * roar;
  }
}

/** Mort : il lâche la hache, pose un genou à terre face à l'ouest, puis s'effondre. */
function fall(f: FighterRig, j: Joints, k: number, now: number) {
  const stagger = easeOutCubic(clamp01(k / 0.15));
  const kneel = easeInOut(clamp01((k - 0.12) / 0.25));
  const fallDown = easeInCubic(clamp01((k - 0.62) / 0.2));
  const tremble = k < 0.62 ? Math.sin(now * 0.06) * 0.03 : 0;
  j.lunge = -5 * stagger;
  j.torsoX = lerp(-0.35 * stagger, 0.45, kneel) + tremble;
  j.lift = -7.5 * kneel;
  j.legL = -1.3 * kneel;
  j.legR = 0.5 * kneel;
  j.crouch = 0;
  j.armR = [lerp(-0.75, 0.2, stagger), 0, -0.25];
  j.armL = [lerp(-0.35, 0.15, stagger), 0, 0.25];
  j.pitch = 1.38 * fallDown;
  j.hop = -3 * fallDown;
}

type Weapon = 'axe' | 'musket';
const SMOKE = 28;

/** Habillage, armes et effets du mousquet. */
export class ChampionGear {
  private readonly rightHand = new T.Group();
  private readonly leftHand = new T.Group();
  private readonly axe = new T.Group();
  private readonly musket = new T.Group();
  private readonly brokenMusket = new T.Group();
  private readonly outfit = new T.Group();
  private readonly crest = new T.Group();
  /** Tenue skinnée de Badu (null sur un rig sans corps skinné). */
  private dress: T.Group | null = null;
  private readonly fx = new T.Group();
  private readonly smoke: { sprite: T.Sprite; life: number; vx: number; vy: number; vz: number }[] = [];
  private readonly trails: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>[] = [];
  private readonly flash: T.Sprite;
  private readonly fuse: T.Sprite;
  private readonly muzzle = new T.Vector3();
  private readonly lock = new T.Vector3();
  private readonly materials: T.Material[] = [];
  private readonly skin: T.MeshStandardMaterial;
  private readonly loincloth: T.MeshStandardMaterial;
  private readonly swapped: { mesh: T.Mesh; original: T.Material | T.Material[]; replacement: T.Material }[] = [];
  private active = false;
  /** Hache lâchée à la mort : elle tombe de la main et reste au sol. */
  private droppedAxe?: T.Group;
  private readonly dropFrom = new T.Vector3();
  private trailLife = 0;
  private lastShot = false;
  private puffClock = 0;
  private next = 0;

  constructor(private readonly scene: T.Scene, private readonly rig: FighterRig, private readonly staff: T.Object3D | undefined) {
    const flat = (color: string, extra: Partial<T.MeshStandardMaterialParameters> = {}) =>
      this.mat(new T.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...extra }));
    const wood = flat('#3b2618');
    const iron = flat('#3f3e3a', { roughness: 0.55, metalness: 0.35 });
    const brass = flat('#8e6d34', { roughness: 0.55, metalness: 0.2 });
    const leather = flat('#2e1d13');
    const gold = flat('#a88a3e', { roughness: 0.45, metalness: 0.45, emissive: '#2a1a05' });
    this.skin = flat('#4e2e22');
    this.loincloth = flat('#4a2418');
    const add = (parent: T.Object3D, geometry: T.BufferGeometry, material: T.Material,
      x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const mesh = new T.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      parent.add(mesh);
      return mesh;
    };

    // Les armes partent des mains et pointent vers l'avant (axe +y local).
    for (const [hand, arm] of [[this.rightHand, rig.arms[1]], [this.leftHand, rig.arms[0]]] as const) {
      hand.position.set(0, -8.5, 0.5);
      hand.rotation.x = Math.PI / 2 - 0.18;
      arm.add(hand);
    }

    // Hache de guerre akan : manche sombre cerclé de laiton, large fer courbe à double tranchant.
    add(this.axe, new T.CylinderGeometry(0.75, 0.9, 46, 6), wood, 0, 15, 0);
    for (const y of [4, 12, 22, 30]) add(this.axe, new T.CylinderGeometry(0.95, 0.95, 1, 6), brass, 0, y, 0);
    const blade = new T.Shape();
    blade.moveTo(0, -4);
    blade.quadraticCurveTo(10, -9, 12, 0);
    blade.quadraticCurveTo(10, 9, 0, 4);
    blade.lineTo(0, -4);
    const fer = new T.ExtrudeGeometry(blade, { depth: 0.8, bevelEnabled: false });
    add(this.axe, fer, iron, 0.6, 34, -0.4, 0, 0, Math.PI / 2);
    add(this.axe, fer, iron, -0.6, 34, 0.4, 0, Math.PI, Math.PI / 2).scale.setScalar(0.7);
    add(this.axe, new T.CylinderGeometry(0.4, 0.4, 0.25, 6), brass, 0, 34, 0.9, Math.PI / 2, 0, 0);
    add(this.axe, new T.CylinderGeometry(0.95, 0.95, 1, 6), brass, 0, 32, 0);
    this.rightHand.add(this.axe);

    // Mousquet à silex de traite, tenu de la main gauche.
    const barrel = add(this.musket, new T.CylinderGeometry(0.55, 0.6, 32, 6), iron, 0, 16, 1.2);
    barrel.userData['muzzle'] = true;
    add(this.musket, new T.BoxGeometry(1.8, 15, 2.4), wood, 0, 3, 0.4);
    add(this.musket, new T.BoxGeometry(2.2, 6, 3.4), wood, 0, -6, 0, 0.25, 0, 0);
    add(this.musket, new T.BoxGeometry(1.2, 2.2, 1.6), brass, 0, 6, 2.4);
    add(this.musket, new T.BoxGeometry(0.5, 2.4, 0.7), iron, 0.95, 9.5, 2.1, 0, 0, -0.4);
    add(this.musket, new T.TorusGeometry(1.5, 0.18, 4, 8, Math.PI), iron, 0, 0.5, 3.1, 0, 0, Math.PI);
    add(this.musket, new T.CylinderGeometry(0.12, 0.12, 26, 4), brass, 0, 14, -1.1);
    this.leftHand.add(this.musket);
    // Mousquet brisé, jeté au sol pendant la transition (posé par update).
    add(this.brokenMusket, new T.CylinderGeometry(0.55, 0.6, 30, 6), iron, 0, 0.6, 0, 0, 0, Math.PI / 2);
    add(this.brokenMusket, new T.BoxGeometry(2, 1.6, 6), wood, -4, 0.8, 4, 0, 0.8, 0);
    add(this.brokenMusket, new T.BoxGeometry(2.2, 1.6, 4), wood, 8, 0.8, -5, 0, -0.4, 0);
    this.brokenMusket.visible = false;
    scene.add(this.brokenMusket);

    // Tenue (même corps humain que tous, human-body.ts) : torse nu scarifié,
    // pagne de guerre sombre à pan rouge, ceinture et bandoulière de cuir.
    // Kofi garde la sienne sur le même rig : on bascule l'une ou l'autre (setActive).
    if (rig.body) {
      this.dress = dressHuman(rig.body, baduOutfit((color) => flat(color), this.loincloth), true);
    }
    // Poire à poudre en corne et bourse à balles, à la ceinture.
    add(this.outfit, new T.ConeGeometry(0.75, 4.2, 6), flat('#c9b38a'), 3.05, -0.9, 0.9, 0.3, 0, 1.2);
    add(this.outfit, new T.SphereGeometry(1.0, 6, 5), leather, -2.95, -0.5, 1.0);
    // Coiffe de peau sombre à l'insigne d'or terne (pivote avec le regard, comme la tête).
    this.crest.position.set(0, 11, 0.5);
    add(this.crest, new T.CylinderGeometry(1.62, 1.72, 1.7, 9), leather, 0, 1.75, -0.35).scale.z = 1.22;
    add(this.crest, new T.BoxGeometry(1.3, 1.4, 0.3), gold, 0, 1.85, 1.75);
    rig.torso.add(this.outfit, this.crest);

    // Effets : fumée noire, éclair de bouche, lueur de la platine, braise sur la ligne de tir.
    const puff = this.softTexture();
    for (let i = 0; i < SMOKE; i++) {
      const sprite = new T.Sprite(this.mat(new T.SpriteMaterial({
        map: puff, color: i % 3 ? '#16110e' : '#2e1810', transparent: true, depthWrite: false, opacity: 0,
      })));
      sprite.visible = false;
      this.fx.add(sprite);
      this.smoke.push({ sprite, life: 0, vx: 0, vy: 0, vz: 0 });
    }
    const glow = (color: string) => {
      const sprite = new T.Sprite(this.mat(new T.SpriteMaterial({
        map: puff, color, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0,
      })));
      sprite.userData['bloom'] = true;
      this.fx.add(sprite);
      return sprite;
    };
    this.flash = glow('#ff7a2e');
    this.fuse = glow('#ff2a12');
    for (let i = 0; i < 3; i++) {
      const trail = new T.Mesh(new T.PlaneGeometry(1, 1), this.mat(new T.MeshBasicMaterial({
        color: '#ff5a1e', transparent: true, depthWrite: false, opacity: 0, side: T.DoubleSide, blending: T.AdditiveBlending,
      })));
      trail.userData['bloom'] = true;
      trail.visible = false;
      this.fx.add(trail);
      this.trails.push(trail);
    }
    scene.add(this.fx);
    this.setActive(false);
  }

  /** Objets à rendre visibles le temps de compiler leurs shaders. */
  get warmables(): T.Object3D[] {
    return [this.rightHand, this.leftHand, this.outfit, this.crest, this.fx, this.brokenMusket, ...(this.dress ? [this.dress] : [])];
  }

  /** true : le rig du duelliste devient Badu (sinon Kofi retrouve son bâton et sa tenue). */
  setActive(on: boolean) {
    if (on === this.active && this.swapped.length) return;
    this.active = on;
    for (const part of [this.rightHand, this.leftHand, this.outfit, this.crest, this.fx]) part.visible = on;
    if (this.dress) this.dress.visible = on;
    if (this.rig.body) this.rig.body.outfit.visible = !on;
    if (!on) this.brokenMusket.visible = false;
    if (this.staff) this.staff.visible = !on;
    this.rig.root.scale.setScalar(on ? BADU_SCALE : 1);
    // Torse nu, pagne sombre ; le batakari de Kofi disparaît.
    if (!this.swapped.length) {
      const [chest, hips] = this.rig.torso.children as T.Mesh[];
      this.swapped.push({ mesh: chest, original: chest.material, replacement: this.skin });
      this.swapped.push({ mesh: hips, original: hips.material, replacement: this.loincloth });
    }
    for (const s of this.swapped) s.mesh.material = on ? s.replacement : s.original;
    // Le batakari est ajouté au rig après ce module : on le cherche à chaque bascule.
    for (const h of this.rig.torso.children) if (h.name === 'akan-batakari') h.visible = !on;
  }

  /**
   * @param pose pose de Badu (null : Kofi ou pas de combat)
   * @param target position du héros, pour le regard verrouillé
   */
  update(pose: Actor3D | null, now: number, dt: number, target?: { x: number; y: number }) {
    this.setActive(!!pose);
    if (!pose) {
      this.lastShot = false;
      return;
    }
    const two = (pose.bossPhase ?? 1) >= 2;
    const k = pose.phase;
    // Le mousquet disparaît quand il le brise (transition), et ne revient plus.
    const broken = two && !(pose.state === 'shift' && k < 0.42);
    this.musket.visible = !broken && !(pose.state === 'dead' && k > 0.2);
    this.axe.visible = !(pose.state === 'dead' && k > 0.15);
    this.dropAxe(pose, k);
    if (pose.state === 'shift' && k >= 0.42 && !this.brokenMusket.visible) {
      this.brokenMusket.visible = true;
      this.brokenMusket.position.set(pose.x + pose.facingY * 18 + pose.facingX * 10, 0, pose.y - pose.facingX * 18 + pose.facingY * 10);
      this.brokenMusket.rotation.y = Math.atan2(pose.facingX, pose.facingY) + 0.9;
    }
    // Mains sur la hache (phase 2) : la main gauche rejoint le manche.
    this.leftHand.visible = !broken || pose.state === 'shift';

    this.rig.root.updateMatrixWorld(true);
    // Le mousquet reste à peu près horizontal (épaulé ou tenu au repos).
    this.musket.rotation.x = -(this.rig.arms[0].rotation.x + 0.55 + this.rig.torso.rotation.x);
    // Regard verrouillé sur le joueur (tête et coiffe pivotent, dans la limite du cou).
    if (target) {
      const yaw = Math.atan2(target.x - pose.x, target.y - pose.y);
      const body = this.rig.root.rotation.y + this.rig.torso.rotation.y;
      const turn = Math.atan2(Math.sin(yaw - body), Math.cos(yaw - body));
      this.crest.rotation.y += (Math.max(-1.1, Math.min(1.1, turn)) - this.crest.rotation.y) * (1 - Math.exp(-10 * dt));
      this.rig.torso.children[3].rotation.y = this.crest.rotation.y;
    }

    this.muzzle.set(0, 32, 1.2);
    this.musket.localToWorld(this.muzzle);
    this.lock.set(0, 6, 2.4);
    this.musket.localToWorld(this.lock);
    const aiming = pose.attack === 'shot' && pose.state === 'windup';
    const firing = pose.attack === 'shot' && pose.state === 'attacking';

    // Visée : la platine rougeoie, un filet de fumée noire rampe le long du canon.
    this.fuse.position.copy(this.lock);
    this.fuse.scale.setScalar(aiming ? 4 + 2 * Math.sin(now * 0.04) : 0.01);
    this.fuse.material.opacity = aiming ? 0.6 + 0.4 * clamp01(k / 0.8) : 0;
    this.puffClock -= dt;
    if (aiming && this.puffClock <= 0) {
      this.puffClock = 0.05;
      this.emit(this.muzzle.x, this.muzzle.y, this.muzzle.z, (Math.random() - 0.5) * 5, -3, (Math.random() - 0.5) * 5, 1.3);
    }
    if (firing && !this.lastShot) {
      this.flash.position.copy(this.muzzle);
      this.flash.material.opacity = 1;
      this.flash.scale.setScalar(30);
      for (let i = 0; i < 12; i++) {
        this.emit(this.muzzle.x, this.muzzle.y, this.muzzle.z,
          pose.facingX * 34 + (Math.random() - 0.5) * 20, 4 + Math.random() * 6, pose.facingY * 34 + (Math.random() - 0.5) * 20, 2.4);
      }
      const angles = shotAngles(pose.bossPhase ?? 1);
      const length = BOSS_ATTACKS.shot.range * BOSS_CONFIG.size;
      this.trails.forEach((trail, i) => {
        const angle = angles[i];
        trail.visible = angle !== undefined;
        if (angle === undefined) return;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const fx = pose.facingX * c - pose.facingY * s;
        const fy = pose.facingX * s + pose.facingY * c;
        trail.position.set(pose.x + fx * length / 2, 1.2 + i * 0.05, pose.y + fy * length / 2);
        trail.rotation.set(-Math.PI / 2, 0, Math.atan2(-fy, fx));
        trail.scale.set(length, 3.2, 1);
        trail.material.opacity = 0.9;
      });
      this.trailLife = 1;
    }
    this.lastShot = firing;

    this.flash.material.opacity = Math.max(0, this.flash.material.opacity - dt * 7);
    this.trailLife = Math.max(0, this.trailLife - dt * 0.6);
    for (const trail of this.trails) {
      if (!trail.visible) continue;
      trail.material.opacity = 0.9 * this.trailLife * (0.75 + 0.25 * Math.sin(now * 0.03));
      trail.material.color.setRGB(1, 0.25 + 0.2 * this.trailLife, 0.08);
      if (this.trailLife <= 0) trail.visible = false;
    }
    for (const puff of this.smoke) {
      if (puff.life <= 0) continue;
      puff.life -= dt;
      const p = puff.sprite.position;
      p.x += puff.vx * dt;
      p.y = Math.max(2, p.y + puff.vy * dt);
      p.z += puff.vz * dt;
      puff.vx *= 1 - dt * 1.5;
      puff.vz *= 1 - dt * 1.5;
      const age = Math.max(0, puff.life);
      puff.sprite.scale.setScalar(6 + (1 - Math.min(1, age)) * 16);
      puff.sprite.material.opacity = Math.min(0.78, age * 0.6);
      puff.sprite.visible = puff.life > 0;
    }
  }

  /** La hache glisse des doigts au début de la mort, tombe et rebondit sur le sol. */
  private dropAxe(pose: Actor3D, k: number) {
    const dead = pose.state === 'dead';
    if (!dead) {
      if (this.droppedAxe) this.droppedAxe.visible = false;
      return;
    }
    if (!this.droppedAxe) {
      this.droppedAxe = this.axe.clone();
      this.scene.add(this.droppedAxe);
    }
    const axe = this.droppedAxe;
    if (k <= 0.15) {
      axe.visible = false;
      this.axe.getWorldPosition(this.dropFrom);
      return;
    }
    axe.visible = true;
    const t = clamp01((k - 0.15) / 0.13);
    const bounce = Math.sin(clamp01((k - 0.28) / 0.08) * Math.PI) * 2.5;
    const ground = 1.2 + bounce;
    axe.position.set(this.dropFrom.x + pose.facingY * 10, lerp(this.dropFrom.y, ground, t * t), this.dropFrom.z - pose.facingX * 10);
    axe.rotation.set(lerp(0.3, Math.PI / 2, t), Math.atan2(pose.facingX, pose.facingY) + 0.6, lerp(0, 0.2, t));
    axe.scale.setScalar(BADU_SCALE);
  }

  dispose() {
    this.scene.remove(this.fx, this.brokenMusket);
    if (this.droppedAxe) this.scene.remove(this.droppedAxe);
    this.materials.forEach((material) => material.dispose());
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) {
    const puff = this.smoke[this.next];
    this.next = (this.next + 1) % this.smoke.length;
    puff.life = life;
    puff.vx = vx;
    puff.vy = vy;
    puff.vz = vz;
    puff.sprite.position.set(x, y, z);
    puff.sprite.visible = true;
  }

  private softTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, '#ffffffff');
    g.addColorStop(1, '#ffffff00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(canvas);
  }

  private mat<M extends T.Material>(material: M) {
    this.materials.push(material);
    return material;
  }
}

/** Arme tenue (utile aux traînées d'arme de BossFx). */
export function baduWeapon(pose: Actor3D): Weapon {
  return pose.attack === 'shot' && pose.state !== 'chase' ? 'musket' : 'axe';
}
