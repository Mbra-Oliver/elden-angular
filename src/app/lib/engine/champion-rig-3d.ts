import * as T from 'three';
import { BOSS_ATTACKS, shotAngles } from '../interfaces/BossAttackData';
import { BOSS_CONFIG } from '../constants/boss.config-constant';
import type { FighterRig } from './boss-rig-3d';
import { dressHuman } from './human-body';
import { baduOutfit } from './human-outfits';
import type { Actor3D } from './world-3d';
import { WEAPON_MATERIALS } from './equipment-3d';
import { type ArmSolution, type Limb, solveArm, splitArm, UPPER } from './arm-ik';

/**
 * Badu Ofosu, porte-glaive (afenasoafo) de Ntim Gyakari (chapitre 1, 1701).
 *
 * Un homme, pas un monstre : un officier de cour du Denkyira, grand et lourd,
 * en batakari de guerre indigo couvert de talismans, calotte de cuir à
 * disque d'or. Il a deux armes mais n'en tient jamais qu'une : l'afena du roi
 * (sabre akan à lame large, poignée à deux pommeaux dorés) au corps à corps,
 * le mousquet de traite pour tirer. L'autre est rangée dans son dos (mousquet
 * en bandoulière, afena au fourreau derrière la hanche droite) ; il change
 * d'arme d'un geste court (ranger, saisir). À mi-vie, il tire le mousquet,
 * le brise contre la roche, puis prend l'afena à deux mains.
 *
 * Proportions (1 unité ≈ 6 cm, héros ≈ 29 unités) : afena ≈ 85 cm, mousquet
 * ≈ 1,30 m, Badu ≈ 1,95 m (×1,12).
 *
 * Animation (animateBadu) : poses clés par attaque, et entre deux états un
 * fondu court (plus de saut de pose). Les appuis suivent le corps : la jambe
 * avant s'avance quand il fend, le poids recule quand il arme. En phase 2,
 * la main gauche rejoint la poignée par IK, quel que soit le geste.
 * [SUPPOSITION] Angles et durées réglés à l'œil sur captures, à valider en jeu.
 */

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInCubic = (t: number) => t * t * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
/** Armement : rapide puis tenu (lisible), avec un léger tremblement de muscles à la fin. */
const coil = (t: number, now: number) => easeOutCubic(clamp01(t / 0.7)) + (t > 0.7 ? Math.sin(now * 0.07) * 0.015 : 0);

/** Taille de Badu par rapport au héros : grand et lourd, mais humain (≈ 1,95 m). */
export const BADU_SCALE = 1.12;

/** Inclinaison de la main gauche sur l'avant-bras (même prise que le bâton de Kofi). */
const HAND_PITCH = Math.PI / 2 - 0.18;
/**
 * Prise du sabre : la lame part à ~65° de l'avant-bras (poignet neutre).
 * Angle absolu de la lame dans le plan du bras : 0 = vers le haut,
 * π/2 = devant, π = vers le bas ; φ = bras.x + coude + SWORD_PITCH + poignet.
 */
const SWORD_PITCH = 2.0;
/** Afena : pommeau arrière, poignée, pommeau avant, lame (axe +y de la main). */
const AFENA = { pommel: -2.2, guard: 1.35, base: 1.85, tip: 10.6 };
/** Mousquet : la main droite tient le poignet de la crosse (y = 0). */
const MUSKET = { butt: -6, muzzle: 13.6 };

/** Arme en main (l'autre est dans le dos). */
export type BaduHeld = 'afena' | 'musket' | 'none';
/** Changement d'arme : ranger (jusqu'à 0,4), saisir l'autre (jusqu'à 0,7), revenir en garde. */
const SWAP_MS = 560;
/** Main droite derrière la hanche (fourreau de l'afena) et au-dessus de l'épaule (canon du mousquet). */
const REACH_SHEATH: { arm: Vec3; elbow: number } = { arm: [0.6, 0, -0.35], elbow: -0.6 };
const REACH_SLING: { arm: Vec3; elbow: number } = { arm: [-2.75, 0, -0.3], elbow: -1.85 };

type Vec3 = [number, number, number];
interface Joints {
  torsoX: number; torsoY: number; torsoZ: number; lift: number; lunge: number; side: number; hop: number;
  armL: Vec3; armR: Vec3; elbowL: number; elbowR: number; wristR: number;
  legL: number; legR: number; crouch: number; pitch: number;
  /** 0 : mousquet porté canon en l'air ; 1 : épaulé, canon à l'horizontale. */
  aim: number;
}
const NUMS = ['torsoX', 'torsoY', 'torsoZ', 'lift', 'lunge', 'side', 'hop', 'elbowL', 'elbowR', 'wristR',
  'legL', 'legR', 'crouch', 'pitch', 'aim'] as const;

/** Fondu entre deux états : on part de la dernière pose réellement affichée. */
interface Memo {
  key: string; start: number; from: Joints; last: Joints; walking: boolean;
  /** Fente du coup précédent, gardée pendant la récupération puis reprise d'un pas en arrière. */
  carry: number;
  /** Arme en main, et changement d'arme en cours (début en ms, -1 : aucun). */
  held: BaduHeld;
  swapStart: number;
  swapTo: BaduHeld;
}
const memos = new WeakMap<FighterRig, Memo>();

function copyJoints(j: Joints): Joints {
  return { ...j, armL: [...j.armL], armR: [...j.armR] };
}

function blendJoints(from: Joints, to: Joints, t: number) {
  for (const key of NUMS) to[key] = lerp(from[key], to[key], t);
  for (let i = 0; i < 3; i++) {
    to.armL[i] = lerp(from.armL[i], to.armL[i], t);
    to.armR[i] = lerp(from.armR[i], to.armR[i], t);
  }
}

/** Durée du fondu (ms) selon l'état qui commence : le coup reste sec, le reste coule. */
function blendTime(state: string) {
  switch (state) {
    case 'attacking': return 70;
    case 'hurt': case 'stunned': return 60;
    case 'windup': return 140;
    case 'recover': return 160;
    case 'dead': return 120;
    default: return 220;
  }
}

/** Garde de repos : sabre bas devant (droite), mousquet canon en l'air (gauche) ; à deux mains en phase 2. */
function guard(two: boolean, breath: number, now: number): Joints {
  return {
    torsoX: (two ? 0.16 : 0.1) + breath * 0.02, torsoY: two ? -0.25 : 0, torsoZ: Math.sin(now * 0.0013) * 0.025,
    lift: (two ? -2.4 : -1.6) + breath * 0.4,
    lunge: 0, side: 0, hop: 0, crouch: two ? 0.12 : 0.08, pitch: 0,
    armR: two ? [-0.8, 0.15, -0.05] : [-0.45, 0, -0.2],
    elbowR: two ? -0.9 : -0.75,
    // Main gauche libre en phase 1 : un peu en avant, pour l'équilibre.
    armL: two ? [-0.6, 0, 0.3] : [-0.35, 0, 0.22],
    elbowL: two ? -1 : -0.8,
    wristR: two ? 0.35 : 0,
    legL: -0.22, legR: 0.2, aim: 0,
  };
}

/** Angle de lame d'une pose de garde. */
function guardBlade(g: Joints) {
  return g.armR[0] + g.elbowR + SWORD_PITCH + g.wristR;
}

/** Oriente la lame (angle absolu φ, voir SWORD_PITCH) par le poignet, dans sa limite. */
function blade(j: Joints, phi: number) {
  j.wristR = Math.max(-1.1, Math.min(1.1, phi - (j.armR[0] + j.elbowR + SWORD_PITCH)));
}

/**
 * Pose de Badu, appelée après l'animation de base de World3D (marche).
 * `pose.phase` : avancement 0→1 de l'état courant.
 */
export function animateBadu(f: FighterRig, pose: Actor3D, now: number) {
  const k = clamp01(pose.phase);
  const attack = pose.attack ?? 'none';
  const two = (pose.bossPhase ?? 1) >= 2;
  // Souffle : lent et maîtrisé en phase 1, court et lourd en phase 2.
  const breath = Math.sin(now * (two ? 0.0068 : 0.0034));
  const j = guard(two, breath, now);
  f.root.rotation.order = 'YXZ';
  f.root.rotation.x = 0;
  let walking = false;

  switch (pose.state) {
    case 'chase':
      // Marche de vétéran : buste droit, légèrement penché, garde tenue.
      walking = true;
      j.torsoX = two ? 0.24 : 0.16;
      j.lift = two ? -2.8 : -2;
      j.crouch = two ? 0.14 : 0.1;
      break;
    case 'windup':
      windup(j, attack, coil(k, now), k, two);
      break;
    case 'attacking':
      strike(j, attack, k, pose.step ?? 0, now, two);
      break;
    case 'recover':
      recover(j, attack, k, now, two);
      break;
    case 'hurt':
    case 'stunned': {
      // Recul : buste rejeté, un pas en arrière, la garde s'ouvre puis se referme.
      const b = Math.sin(clamp01(k / 0.9) * Math.PI) * (1 - k * 0.3);
      j.torsoX -= 0.45 * b;
      j.torsoZ = 0.12 * b;
      j.lunge = -5 * b;
      j.armR = [lerp(j.armR[0], 0.1, b), 0, lerp(j.armR[2], -0.5, b)];
      if (!two) j.armL = [lerp(j.armL[0], 0.1, b), 0, lerp(j.armL[2], 0.5, b)];
      j.legL = lerp(j.legL, 0.15, b);
      j.legR = lerp(j.legR, 0.45, b);
      break;
    }
    case 'shift':
      breakMusket(j, k, now);
      break;
    case 'dead':
      fall(j, k, now);
      break;
    default: // idle : garde, petit balancement de poids
      j.side = Math.sin(now * 0.0011) * 0.6;
      break;
  }

  // Fondu entre états : la nouvelle pose part de la dernière affichée.
  const key = `${pose.state}:${attack}:${two ? 2 : 1}`;
  let memo = memos.get(f);
  if (!memo) {
    memo = { key, start: now, from: copyJoints(j), last: copyJoints(j), walking, carry: 0,
      held: 'afena', swapStart: -1, swapTo: 'afena' };
    memos.set(f, memo);
  } else if (memo.key !== key) {
    memo.carry = pose.state === 'recover' ? Math.max(0, memo.last.lunge) : 0;
    memo.from = copyJoints(memo.last);
    memo.key = key;
    memo.start = now;
  }
  // Après une fente, il reste en avant puis revient en garde d'un pas.
  if (memo.carry) j.lunge += memo.carry * (1 - easeInOut(clamp01((k - 0.3) / 0.6)));
  const t = clamp01((now - memo.start) / blendTime(pose.state));
  if (t < 1) blendJoints(memo.from, j, easeInOut(t));
  swapWeapons(memo, j, pose, k, now, two);
  memo.last = copyJoints(j);
  memo.walking = walking;
  applyJoints(f, j, pose, walking);
}

/** Dernière visée du mousquet (lue par ChampionGear.update, après animateBadu). */
export function baduAim(f: FighterRig) {
  return memos.get(f)?.last.aim ?? 0;
}

/** Arme que Badu tient en main (lue par ChampionGear.update, après animateBadu). */
export function baduHeld(f: FighterRig): BaduHeld {
  return memos.get(f)?.held ?? 'afena';
}

/**
 * Une seule arme en main : le mousquet pour tirer (et recharger), l'afena
 * pour tout le reste. Quand il faut changer, la main droite range l'arme
 * tenue dans le dos puis saisit l'autre ; ce geste se superpose au bras
 * droit de la pose en cours. Pendant la transition de phase, c'est
 * breakMusket qui décide (il tire le mousquet, le brise, reprend l'afena).
 */
function swapWeapons(memo: Memo, j: Joints, pose: Actor3D, k: number, now: number, two: boolean) {
  if (pose.state === 'shift') {
    memo.held = k < 0.1 ? 'afena' : k < 0.42 ? 'musket' : k < 0.54 ? 'none' : 'afena';
    memo.swapStart = -1;
    return;
  }
  if (pose.state === 'dead') {
    memo.swapStart = -1;
    return;
  }
  const shooting = !two && pose.attack === 'shot' &&
    (pose.state === 'windup' || pose.state === 'attacking' || pose.state === 'recover');
  const want: BaduHeld = shooting ? 'musket' : 'afena';
  if (memo.swapStart < 0 && want !== memo.held && pose.state !== 'attacking') {
    memo.swapStart = now;
    memo.swapTo = want;
  }
  if (memo.swapStart < 0) return;
  const u = (now - memo.swapStart) / SWAP_MS;
  // Un coup qui part termine le geste aussitôt (la bonne arme est en main).
  if (u >= 1 || pose.state === 'attacking') {
    memo.held = memo.swapTo;
    memo.swapStart = -1;
    return;
  }
  // On range l'arme tenue (l'autre), puis on saisit celle qu'on veut.
  const from = memo.swapTo === 'musket' ? REACH_SHEATH : REACH_SLING;
  const to = memo.swapTo === 'musket' ? REACH_SLING : REACH_SHEATH;
  if (u >= 0.4 && memo.held !== 'none' && memo.held !== memo.swapTo) memo.held = 'none';
  if (u >= 0.7) memo.held = memo.swapTo;
  const w = Math.min(easeInOut(clamp01(u / 0.22)), 1 - easeInOut(clamp01((u - 0.78) / 0.22)));
  const m = easeInOut(clamp01((u - 0.4) / 0.3));
  const reach: Vec3 = [lerp(from.arm[0], to.arm[0], m), 0, lerp(from.arm[2], to.arm[2], m)];
  j.armR = [lerp(j.armR[0], reach[0], w), lerp(j.armR[1], 0, w), lerp(j.armR[2], reach[2], w)];
  j.elbowR = lerp(j.elbowR, lerp(from.elbow, to.elbow, m), w);
  j.wristR = lerp(j.wristR, 0, w);
  // Le buste accompagne la main dans le dos.
  j.torsoY += 0.3 * w;
}

function applyJoints(f: FighterRig, j: Joints, pose: Actor3D, walking: boolean) {
  f.torso.position.y = 16 + j.lift;
  f.torso.rotation.set(j.torsoX, j.torsoY, walking ? f.torso.rotation.z : j.torsoZ);
  f.arms[0].rotation.set(...j.armL);
  f.arms[1].rotation.set(...j.armR);
  const parts = partsOf(f);
  if (parts) {
    parts.elbows[0].rotation.set(j.elbowL, 0, 0);
    parts.elbows[1].rotation.set(j.elbowR, 0, 0);
    parts.sword.rotation.x = SWORD_PITCH + j.wristR;
  }
  // Genoux fléchis : la jambe se raccourcit, le corps descend d'autant.
  f.legs[0].scale.y = Math.min(f.legs[0].scale.y, 1 - j.crouch);
  f.legs[1].scale.y = Math.min(f.legs[1].scale.y, 1 - j.crouch);
  // En marche, les jambes gardent la démarche de base (pieds posés).
  if (!walking) {
    f.legs[0].rotation.x = j.legL;
    f.legs[1].rotation.x = j.legR;
  }
  const fx = pose.facingX;
  const fy = pose.facingY;
  f.root.position.x += fx * j.lunge - fy * j.side;
  f.root.position.z += fy * j.lunge + fx * j.side;
  f.root.position.y += j.hop;
  f.root.rotation.x += j.pitch;
}

/** Coudes (splitArm) et main d'épée créés par ChampionGear : absents sur un rig sans équipement. */
const partsMap = new WeakMap<FighterRig, { elbows: [T.Group, T.Group]; sword: T.Group }>();
function partsOf(f: FighterRig) {
  return partsMap.get(f);
}

/**
 * Anticipation : le corps s'arme à l'opposé du coup, le poids passe sur la
 * jambe arrière, puis la pose est tenue (c'est elle que le joueur lit).
 */
function windup(j: Joints, attack: string, e: number, k: number, two: boolean) {
  switch (attack) {
    case 'shot': // il tire le mousquet du dos, puis l'épaule : buste de profil, joue sur la crosse
      j.aim = easeInOut(clamp01((k - 0.25) / 0.45));
      j.armR = [lerp(-0.55, -1.2, j.aim), lerp(0, 0.18, j.aim), lerp(-0.1, 0.05, j.aim)];
      j.elbowR = lerp(-0.9, -1.25, j.aim);
      j.armL = [lerp(j.armL[0], -1.18, j.aim), lerp(0, -0.12, j.aim), lerp(j.armL[2], -0.06, j.aim)];
      j.torsoY = 0.42 * j.aim;
      j.torsoX = 0.03;
      j.lift = -1.8;
      j.lunge = -2.2 * easeOutCubic(clamp01(k / 0.3));
      j.legL = -0.3;
      j.legR = 0.28;
      break;
    case 'reap': // épaule droite ramenée loin en arrière, poids sur l'appui arrière
      j.torsoY = -1.0 * e;
      j.torsoX = 0.16;
      j.armR = [-1.0, 0, -0.35 - 0.75 * e];
      j.elbowR = -0.6 - 0.3 * e;
      blade(j, 1.0 + 0.2 * e);
      if (!two) j.armL = [-0.3, 0, 0.3];
      j.lift = -2 - 1.4 * e;
      j.lunge = -3 * e;
      j.crouch = 0.16;
      j.legL = -0.2 - 0.15 * e;
      j.legR = 0.25 + 0.15 * e;
      break;
    case 'judgment':
    case 'feint': // même armement : sabre levé haut (la feinte s'annule)
      if (attack === 'feint' && two) { // feinte du bond : il fléchit comme pour sauter
        j.lift = -2.4 - 3.5 * e;
        j.torsoX = 0.2 + 0.35 * e;
        j.armR = [-0.8 - 0.4 * e, 0, -0.2];
        j.elbowR = -0.9;
        blade(j, 0.6);
        j.crouch = 0.12 + 0.18 * e;
        j.legL = -0.4 * e;
        j.legR = 0.35 * e;
        break;
      }
      j.armR = [lerp(j.armR[0], -2.7, e), 0, lerp(j.armR[2], -0.1, e)];
      j.elbowR = lerp(j.elbowR, -0.35, e);
      blade(j, lerp(0.8, -0.7, e)); // lame dressée au-dessus de la tête, pointe en arrière
      if (!two) j.armL = [lerp(j.armL[0], -0.55, e), 0, 0.25];
      j.torsoX = lerp(j.torsoX, -0.22, e);
      j.lift = lerp(j.lift, 0.2, e);
      j.crouch = 0.04;
      j.legL = -0.3;
      j.legR = 0.3;
      break;
    case 'backhand': // le buste s'enroule, l'arme part vers l'arrière
      j.torsoY = 0.8 * e;
      j.armR = [-0.9, 0, -0.2 + 0.5 * e];
      blade(j, 1.1);
      j.lift = -2.4;
      j.legL = -0.1;
      j.legR = 0.1;
      break;
    case 'furrow': // accroupi, sabre bas derrière lui, pointe contre la roche
      j.lift = -2.4 - 2.4 * e;
      j.torsoX = 0.16 + 0.4 * e;
      j.torsoY = -0.35 * e;
      j.armR = [lerp(-0.85, 0.5, e), 0, -0.3];
      j.elbowR = lerp(-0.7, -0.15, e);
      blade(j, lerp(0.8, 3.4, e)); // pointe en bas, derrière lui
      j.crouch = 0.12 + 0.12 * e;
      j.lunge = -3 * e;
      j.legL = -0.45 * e;
      j.legR = 0.45 * e;
      break;
    case 'leap': // flexion profonde, les bras partent en arrière, puis haut
      j.lift = -2.4 - 4.5 * e;
      j.torsoX = 0.16 + 0.45 * e;
      j.armR = [-0.85 + 1.0 * e, 0, -0.25];
      j.elbowR = -0.4;
      blade(j, 1.6);
      j.crouch = 0.12 + 0.22 * e;
      j.legL = -0.35 * e;
      j.legR = 0.3 * e;
      break;
    case 'mill': { // le sabre décrit un cercle au-dessus de la tête, une fois
      const spin = easeInOut(k) * TAU;
      j.armR = [-2.55, 0, -0.15 + Math.sin(spin) * 0.45];
      j.elbowR = -0.5 + Math.cos(spin) * 0.2;
      blade(j, -1.2 + Math.sin(spin) * 0.4);
      j.torsoY = Math.sin(spin) * 0.3 - 0.2;
      j.torsoX = -0.1;
      j.lift = -1.6;
      j.legL = -0.3;
      j.legR = 0.3;
      break;
    }
    case 'thrust': // sabre ramené contre la hanche, pointe vers le joueur
      j.armR = [lerp(-0.45, 0.25, e), 0.2, -0.05];
      j.elbowR = lerp(-0.75, -1.5, e);
      blade(j, lerp(0.8, Math.PI / 2, e)); // pointe vers le joueur, à hauteur de hanche
      j.torsoY = -0.55 * e;
      j.lift = -2.4 - 1.8 * e;
      j.lunge = -3.5 * e;
      j.crouch = 0.18;
      j.legL = -0.35;
      j.legR = 0.35 + 0.1 * e;
      break;
  }
}

/** Impact : départ explosif, l'arme fend l'air, le corps suit le coup puis se reprend. */
function strike(j: Joints, attack: string, k: number, step: number, now: number, two: boolean) {
  const snap = easeOutExpo(clamp01(k / 0.3));
  const settle = easeInOut(clamp01((k - 0.3) / 0.7));
  switch (attack) {
    case 'shot': { // départ du coup : l'épaule encaisse le recul
      const kick = Math.sin(clamp01(k / 0.22) * Math.PI);
      const reload = easeInOut(clamp01((k - 0.45) / 0.55));
      j.aim = 1 - reload * 0.15;
      j.armR = [-1.2 + 0.25 * kick + reload * 0.35, 0.18 - reload * 0.08, 0.05];
      j.elbowR = -1.25 - 0.22 * kick + reload * 0.3;
      j.armL = [-1.18 + 0.22 * kick + reload * 0.35, -0.12 + reload * 0.06, -0.06];
      j.torsoY = 0.42 - reload * 0.12;
      j.torsoX = 0.03 - 0.16 * kick + reload * 0.06;
      j.lift = -1.8;
      j.lunge = -2.2 - 2.4 * kick;
      break;
    }
    case 'reap': { // deux balayages : droite→gauche puis gauche→droite, un pas à chacun
      const local = (k * 2) % 1;
      const s = easeOutExpo(clamp01((local - 0.15) / 0.35));
      const dir = step === 0 ? 1 : -1;
      j.torsoY = lerp(-1.0 * dir, 1.0 * dir, s);
      j.armR = [-1.25, 0, -0.2 + 0.85 * dir * (2 * s - 1)];
      j.elbowR = -0.25;
      blade(j, 1.3);
      if (!two) j.armL = [-0.3, 0, 0.3];
      j.lift = -3.4 + 0.8 * s;
      j.lunge = 19 * s;
      j.crouch = 0.18;
      j.legL = -0.2 - 0.35 * s;
      j.legR = 0.4;
      break;
    }
    case 'judgment': { // le sabre tombe, le corps plie derrière lui
      const hit = easeInCubic(clamp01(k / 0.25));
      j.armR = [lerp(-2.7, -0.55, hit), 0, -0.1];
      j.elbowR = lerp(-0.35, -0.1, hit);
      blade(j, lerp(-0.7, 2.0, hit));
      if (!two) j.armL = [-0.55 + 0.4 * hit, 0, 0.25];
      j.torsoX = lerp(-0.22, 0.6, hit);
      j.lift = lerp(0.2, -4.2, hit);
      j.lunge = 17 * hit;
      j.crouch = 0.2 * hit;
      j.legL = lerp(-0.3, -0.65, hit);
      j.legR = 0.4;
      break;
    }
    case 'feint': {
      // Il retient l'abattage : pas de côté, puis coupe horizontale (P1)
      // ou estoc à deux mains (P2).
      const drop = easeOutCubic(clamp01(k / 0.4));
      const s = easeOutExpo(clamp01((k - 0.4) / 0.3));
      if (two) {
        j.armR = [lerp(-1.2, -1.45, s), 0.1, -0.05];
        j.elbowR = lerp(-1.4, -0.1, s);
        blade(j, Math.PI / 2);
        j.torsoY = lerp(-0.5, 0.2, s);
        j.lunge = 21 * s;
        j.lift = -3.4;
        j.legL = -0.55 * s;
        j.legR = 0.45;
      } else {
        j.armR = [lerp(lerp(-2.7, -1.0, drop), -1.3, s), 0, lerp(-0.3, 0.9, drop) - 1.5 * s];
        j.elbowR = lerp(lerp(-0.35, -0.9, drop), -0.25, s);
        blade(j, lerp(lerp(-0.7, 1.2, drop), 1.4, s));
        j.armL = [-0.5, 0, 0.5 * s];
        j.torsoY = lerp(lerp(0, 0.6, drop), -0.8, s);
        j.lift = lerp(0.2, -2.6, drop);
        j.lunge = 10 * s;
        j.legL = -0.4 * s;
        j.legR = 0.35;
      }
      j.torsoZ = -0.12 * drop * (1 - s);
      j.side = 5 * drop * (1 - s);
      break;
    }
    case 'backhand': { // rotation du buste : revers de l'afena dans le dos
      j.torsoY = lerp(0.8, -2.2, snap) + 0.35 * settle;
      j.armR = [-1.1, 0, lerp(0.3, -1.0, snap)];
      j.elbowR = -0.4;
      blade(j, 1.2);
      j.lift = -2.6;
      j.legL = 0.15 * snap;
      j.legR = -0.15 * snap;
      break;
    }
    case 'furrow': {
      if (k < 0.8) { // course, pointe qui racle la roche
        const run = Math.sin(now * 0.032);
        j.torsoX = 0.5;
        j.torsoY = -0.3;
        j.lift = -3.4 + Math.abs(run) * 0.8;
        j.armR = [0.5, 0, -0.3];
        j.elbowR = -0.15;
        blade(j, 3.4);
        j.legL = run * 0.9;
        j.legR = -run * 0.9;
      } else { // remontée : la lame jaillit du sol
        const up = easeOutExpo(clamp01((k - 0.8) / 0.15));
        j.armR = [lerp(0.5, -2.5, up), 0, -0.2];
        j.elbowR = lerp(-0.15, -0.5, up);
        blade(j, lerp(3.4, -0.3, up));
        j.torsoX = lerp(0.5, -0.25, up);
        j.torsoY = lerp(-0.3, 0.2, up);
        j.lift = lerp(-3.4, 0.4, up);
        j.legL = -0.5;
        j.legR = 0.35;
      }
      break;
    }
    case 'leap': { // bond, sabre levé, puis abattage à la réception
      const air = clamp01(k / 0.72);
      if (k < 0.72) {
        j.hop = Math.sin(air * Math.PI) * 24;
        j.armR = [lerp(0.15, -2.7, easeOutCubic(clamp01(air / 0.4))), 0, -0.1];
        j.elbowR = -0.4;
        blade(j, lerp(1.6, -0.7, easeOutCubic(clamp01(air / 0.4))));
        j.torsoX = -0.25;
        j.lift = -0.5;
        j.legL = -0.7;
        j.legR = 0.35;
        j.crouch = 0.15;
      } else {
        const hit = easeOutExpo(clamp01((k - 0.72) / 0.12));
        j.armR = [lerp(-2.7, -0.55, hit), 0, -0.1];
        j.elbowR = lerp(-0.4, -0.1, hit);
        blade(j, lerp(-0.7, 2.0, hit));
        j.torsoX = lerp(-0.25, 0.6, hit);
        j.lift = lerp(-0.5, -4.6, hit);
        j.crouch = 0.25 * hit;
        j.legL = -0.6;
        j.legR = 0.45;
      }
      break;
    }
    case 'mill': { // deux diagonales, un tour complet, un abattage
      const local = (k * 4) % 1;
      const s = easeOutExpo(clamp01((local - 0.15) / 0.35));
      if (step < 2) {
        const dir = step === 0 ? 1 : -1;
        j.torsoY = lerp(-0.85 * dir, 0.85 * dir, s);
        j.armR = [lerp(-2.3, -0.7, s), 0, 0.55 * dir * (1 - s) - 0.15];
        j.elbowR = lerp(-0.6, -0.2, s);
        blade(j, lerp(-0.6, 1.9, s));
        j.lunge = 15 * s;
        j.legL = -0.2 - 0.3 * s;
        j.legR = 0.35;
      } else if (step === 2) {
        j.torsoY = -0.8 + easeInOut(local) * (TAU + 0.8);
        j.armR = [-1.35, 0, -1.05];
        j.elbowR = -0.2;
        blade(j, 1.4);
        j.legL = -0.3;
        j.legR = 0.3;
      } else {
        const hit = easeInCubic(clamp01(local / 0.3));
        j.armR = [lerp(-2.7, -0.55, hit), 0, -0.1];
        j.elbowR = lerp(-0.5, -0.1, hit);
        blade(j, lerp(-0.7, 2.0, hit));
        j.torsoX = lerp(-0.2, 0.6, hit);
        j.lift = lerp(0, -4.2, hit);
        j.lunge = 15 * hit;
        j.legL = -0.6 * hit;
        j.legR = 0.4;
      }
      j.crouch = 0.16;
      break;
    }
    case 'thrust': { // estoc direct, tout le corps derrière la pointe
      j.armR = [lerp(0.25, -1.4, snap), lerp(0.2, 0.05, snap), -0.05];
      j.elbowR = lerp(-1.5, -0.05, snap);
      blade(j, Math.PI / 2);
      j.torsoY = lerp(-0.55, 0.25, snap);
      j.torsoX = 0.25 * snap;
      j.lunge = 25 * snap - 5 * settle;
      j.lift = -3.4;
      j.crouch = 0.22;
      j.legL = -0.7 * snap + 0.2 * settle;
      j.legR = 0.5;
      break;
    }
  }
}

/** Récupération : effort visible après les coups lourds, rechargement après le tir. */
function recover(j: Joints, attack: string, k: number, now: number, two: boolean) {
  const back = easeInOut(clamp01((k - 0.35) / 0.65)); // 0 → 1 : retour en garde
  switch (attack) {
    case 'shot': { // il redresse le mousquet devant lui et recharge (main gauche : bourse → bouche du canon)
      j.aim = 1 - easeInOut(clamp01(k / 0.25));
      j.armR = [-0.6, 0.2, 0.15];
      j.elbowR = -1.0;
      j.torsoX = 0.22;
      j.torsoY = 0.25;
      j.lift = -2.2;
      break;
    }
    case 'judgment': // la lame a mordu la terre : il se redresse en la ramenant
    case 'leap': {
      const pull = easeInOut(clamp01((k - 0.4) / 0.6));
      const g = guard(two, 0, now);
      j.torsoX = lerp(0.6, g.torsoX, pull);
      j.lift = lerp(-4.4, g.lift, pull);
      j.armR = [lerp(-0.55, g.armR[0], pull), 0, lerp(-0.1, g.armR[2], pull)];
      j.elbowR = lerp(-0.1, g.elbowR, pull);
      blade(j, lerp(2.0, guardBlade(g), pull));
      j.torsoZ = 0.08 * Math.sin(k * Math.PI);
      j.crouch = lerp(0.22, g.crouch, pull);
      j.legL = lerp(-0.6, g.legL, pull);
      j.legR = lerp(0.4, g.legR, pull);
      break;
    }
    case 'mill': { // essoufflé : appuyé sur ses genoux, le souffle soulève les épaules
      const gasp = Math.sin(now * 0.016);
      const up = easeInOut(clamp01((k - 0.78) / 0.22));
      j.torsoX = lerp(0.65, 0.16, up);
      j.lift = lerp(-4.4 + gasp * 0.9, -2.4, up);
      j.armR = [lerp(-0.2, -0.8, up), 0, -0.3];
      j.elbowR = lerp(-0.5, -0.9, up);
      blade(j, lerp(2.9, 0.65, up)); // appuyé sur la lame, pointe au sol
      j.crouch = lerp(0.24, 0.12, up);
      j.legL = -0.3;
      j.legR = 0.3;
      break;
    }
    default: { // reprise d'appui : la garde revient, le souffle se voit
      const b = 1 - back;
      j.torsoX += 0.2 * b;
      j.lift += -1.2 * b + Math.sin(now * 0.012) * 0.4 * b;
      const target = guardBlade(j);
      j.armR = [lerp(-0.9, j.armR[0], back), 0, lerp(-0.1, j.armR[2], back)];
      blade(j, lerp(1.7, target, back));
      break;
    }
  }
}

/** Transition de phase : il brise la crosse de son mousquet contre la roche, puis rugit. */
function breakMusket(j: Joints, k: number, now: number) {
  if (k < 0.18) {
    // Il range l'afena derrière la hanche, puis tire le mousquet par-dessus l'épaule.
    const m = easeInOut(clamp01((k - 0.08) / 0.1));
    const w = easeInOut(clamp01(k / 0.05));
    j.armR = [lerp(j.armR[0], lerp(REACH_SHEATH.arm[0], REACH_SLING.arm[0], m), w), 0,
      lerp(j.armR[2], lerp(REACH_SHEATH.arm[2], REACH_SLING.arm[2], m), w)];
    j.elbowR = lerp(j.elbowR, lerp(REACH_SHEATH.elbow, REACH_SLING.elbow, m), w);
    j.torsoY = 0.3 * w;
  } else if (k < 0.42) {
    // Mousquet levé à deux mains au-dessus de la tête, puis abattu crosse contre la roche.
    const raise = easeOutCubic(clamp01((k - 0.18) / 0.12));
    const smash = easeInCubic(clamp01((k - 0.3) / 0.12));
    j.aim = smash;
    j.armR = [lerp(lerp(REACH_SLING.arm[0], -2.8, raise), -0.5, smash), 0, -0.15];
    j.elbowR = lerp(lerp(REACH_SLING.elbow, -0.5, raise), -0.3, smash);
    j.torsoX = -0.25 * raise * (1 - smash) + 0.65 * smash;
    j.torsoZ = -0.15 * raise * (1 - smash);
    j.lift = -1.6 - 3.2 * smash;
    j.legL = -0.4 * smash;
    j.legR = 0.3;
  } else if (k < 0.58) {
    // Mains vides : il se redresse et va chercher l'afena derrière sa hanche.
    const w = Math.min(easeInOut(clamp01((k - 0.42) / 0.05)), 1 - easeInOut(clamp01((k - 0.54) / 0.04)));
    j.armR = [lerp(-0.5, REACH_SHEATH.arm[0], w), 0, lerp(-0.15, REACH_SHEATH.arm[2], w)];
    j.elbowR = lerp(-0.3, REACH_SHEATH.elbow, w);
    j.torsoX = lerp(0.65, 0.2, easeInOut(clamp01((k - 0.42) / 0.16)));
    j.lift = lerp(-4.8, -3, easeInOut(clamp01((k - 0.42) / 0.16)));
    j.torsoY = 0.3 * w;
    j.legL = -0.3;
    j.legR = 0.3;
  } else {
    // Il se redresse, empoigne l'afena à deux mains et crie (pas de pose de bête).
    const roar = easeOutBack(clamp01((k - 0.58) / 0.34));
    const tremble = Math.sin(now * 0.08) * 0.03;
    j.armR = [lerp(-0.4, -0.85, roar), 0.15 * roar, lerp(-0.3, -0.05, roar)];
    j.elbowR = -0.9 * roar;
    blade(j, lerp(1.4, 0.65, roar));
    j.torsoX = 0.2 * (1 - roar) - 0.2 * roar + tremble;
    j.lift = -3 * (1 - roar) - 1.2 * roar;
    j.legL = -0.3;
    j.legR = 0.3;
  }
}

/** Mort : le sabre glisse de sa main, il pose un genou à terre, puis s'effondre. */
function fall(j: Joints, k: number, now: number) {
  const stagger = easeOutCubic(clamp01(k / 0.15));
  const kneel = easeInOut(clamp01((k - 0.12) / 0.25));
  const fallDown = easeInCubic(clamp01((k - 0.62) / 0.2));
  const tremble = k < 0.62 ? Math.sin(now * 0.06) * 0.025 : 0;
  j.lunge = -5 * stagger;
  j.torsoX = lerp(-0.3 * stagger, 0.4, kneel) + tremble;
  j.torsoY = 0;
  j.lift = -7.5 * kneel;
  j.legL = -1.3 * kneel;
  j.legR = 0.5 * kneel;
  j.crouch = 0;
  j.armR = [lerp(-0.55, 0.15, stagger), 0, -0.2];
  j.armL = [lerp(-0.2, 0.1, stagger), 0, 0.2];
  j.elbowR = -0.2;
  j.elbowL = -0.2;
  j.pitch = 1.38 * fallDown;
  j.hop = -3 * fallDown;
}

type Weapon = 'afena' | 'musket';
const SMOKE = 28;

/** Habillage, armes et effets du mousquet. */
export class ChampionGear {
  /** Prise de l'afena et prise du mousquet, toutes deux dans la main droite. */
  private readonly rightHand = new T.Group();
  private readonly musketHand = new T.Group();
  /** Rangements dans le dos : fourreau derrière la hanche droite, bandoulière en travers du dos. */
  private readonly swordBack = new T.Group();
  private readonly musketBack = new T.Group();
  private readonly afena = new T.Group();
  private readonly musket = new T.Group();
  private held: BaduHeld = 'afena';
  private readonly brokenMusket = new T.Group();
  private readonly outfit = new T.Group();
  private readonly crest = new T.Group();
  /** Tenue skinnée de Badu (null sur un rig sans corps skinné). */
  private dress: T.Group | null = null;
  private readonly limbs: [Limb, Limb];
  private readonly solution: ArmSolution = { shoulder: new T.Quaternion(), elbow: 0, reached: new T.Vector3() };
  private readonly fx = new T.Group();
  private readonly smoke: { sprite: T.Sprite; life: number; vx: number; vy: number; vz: number }[] = [];
  private readonly trails: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>[] = [];
  private readonly flash: T.Sprite;
  private readonly fuse: T.Sprite;
  private readonly muzzle = new T.Vector3();
  private readonly lock = new T.Vector3();
  private readonly grip = new T.Vector3();
  private readonly pole = new T.Vector3();
  private readonly fk = new T.Quaternion();
  private readonly materials: T.Material[] = [];
  private readonly skin: T.MeshStandardMaterial;
  private readonly loincloth: T.MeshStandardMaterial;
  private readonly swapped: { mesh: T.Mesh; original: T.Material | T.Material[]; replacement: T.Material }[] = [];
  private active = false;
  /** Arme lâchée à la mort : elle tombe de la main et reste au sol. */
  private dropped?: T.Group;
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
    const leather = flat('#2e1d13');
    // Or terne (feuille d'or sur bois) : poignée de l'afena royal, disque de la calotte.
    const gold = flat('#b8963f', { roughness: 0.4, metalness: 0.55, emissive: '#2a1a05' });
    // Lame de fer forgé claire : elle se lit contre le sol sombre de la crête.
    const steel = flat('#b9b6ab', { roughness: 0.35, metalness: 0.6 });
    this.skin = flat('#4e2e22');
    this.loincloth = flat('#2f2420');
    const add = (parent: T.Object3D, geometry: T.BufferGeometry, material: T.Material,
      x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const mesh = new T.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      parent.add(mesh);
      return mesh;
    };

    // Bras en deux os (épaule, coude) : le coude plie, la main gauche peut
    // rejoindre la poignée par IK. Le bâton de Kofi reste sur l'épaule.
    const keep = staff ? [staff] : [];
    this.limbs = [splitArm(rig.arms[0], -1, keep), splitArm(rig.arms[1], 1, keep)];
    partsMap.set(rig, { elbows: [this.limbs[0].elbow, this.limbs[1].elbow], sword: this.rightHand });

    // Les armes partent de la main droite et pointent vers l'avant (axe +y local).
    for (const [hand, pitch] of [[this.rightHand, SWORD_PITCH], [this.musketHand, HAND_PITCH]] as const) {
      hand.position.set(0, -8.5 + UPPER, 0.5);
      hand.rotation.x = pitch;
      this.limbs[1].elbow.add(hand);
    }

    this.afena.name = 'afena';
    this.musket.name = 'musket';
    this.buildAfena(add, gold, steel, wood);
    this.rightHand.add(this.afena);
    this.buildMusket(add, wood, iron);
    this.musketBack.add(this.musket);
    // Dans le dos (repère du buste, dos = -z) : le mousquet en bandoulière, canon
    // au-dessus de l'épaule droite ; l'afena dans un fourreau de cuir derrière la
    // hanche droite, poignée vers le haut (la main droite va la chercher).
    this.musketBack.position.set(-1.6, -0.6, -3.5);
    this.musketBack.rotation.set(0, Math.PI, 0.45);
    this.swordBack.position.set(3.1, -0.4, -2.1);
    this.swordBack.rotation.set(Math.PI - 0.4, 0, -0.18);
    const sheathLength = AFENA.tip - AFENA.base + 1;
    add(this.swordBack, new T.BoxGeometry(0.5, sheathLength, 2.1), leather, 0, AFENA.base + sheathLength / 2 - 0.4, -0.35);
    add(this.swordBack, new T.CylinderGeometry(0.62, 0.62, 0.4, 7), gold, 0, AFENA.base - 0.2, -0.1);
    // Sangle du mousquet en travers de la poitrine (épaule droite → hanche gauche).
    add(this.outfit, new T.BoxGeometry(0.35, 13, 0.25), leather, 0.2, 3.2, 2.75, 0.12, 0, -0.62);
    rig.torso.add(this.swordBack, this.musketBack);

    // Mousquet brisé, jeté au sol pendant la transition (posé par update).
    add(this.brokenMusket, new T.CylinderGeometry(0.3, 0.34, 13, 6), iron, 0, 0.4, 0, 0, 0, Math.PI / 2);
    add(this.brokenMusket, new T.BoxGeometry(1, 2, 5), wood, -3, 0.9, 3.5, 0, 0.8, 0);
    add(this.brokenMusket, new T.BoxGeometry(0.9, 0.9, 3.5), wood, 5, 0.5, -3, 0, -0.4, 0);
    this.brokenMusket.visible = false;
    scene.add(this.brokenMusket);

    // Tenue (même corps humain que tous, human-body.ts) : batakari de guerre
    // indigo à talismans, pagne sombre. Kofi garde la sienne sur le même rig :
    // on bascule l'une ou l'autre (setActive).
    if (rig.body) {
      this.dress = dressHuman(rig.body, baduOutfit((color) => flat(color), this.loincloth), true);
    }
    // Poire à poudre en corne et bourse à balles, à la ceinture, par-dessus la blouse.
    add(this.outfit, new T.ConeGeometry(0.6, 3.4, 6), flat('#c9b38a'), 3.9, -1.6, 1.6, 0.3, 0, 1.2);
    add(this.outfit, new T.SphereGeometry(0.85, 6, 5), leather, -3.9, -1.4, 1.4);
    // Calotte de cuir sombre, disque d'or sur le front (pivote avec le regard).
    this.crest.position.set(0, 11, 0.5);
    add(this.crest, new T.CylinderGeometry(1.55, 1.7, 1.3, 10), leather, 0, 1.6, -0.3).scale.z = 1.18;
    add(this.crest, new T.CylinderGeometry(0.62, 0.62, 0.22, 12), gold, 0, 1.55, 1.75, Math.PI / 2 - 0.15, 0, 0);
    rig.torso.add(this.outfit, this.crest);

    // Effets : fumée de poudre noire, éclair de bouche, lueur de la platine, braise sur la ligne de tir.
    const puff = this.softTexture();
    for (let i = 0; i < SMOKE; i++) {
      const sprite = new T.Sprite(this.mat(new T.SpriteMaterial({
        map: puff, color: i % 3 ? '#3a342e' : '#4a3f35', transparent: true, depthWrite: false, opacity: 0,
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
    this.flash = glow('#ff9a3e');
    this.fuse = glow('#ff6a1a');
    for (let i = 0; i < 3; i++) {
      const trail = new T.Mesh(new T.PlaneGeometry(1, 1), this.mat(new T.MeshBasicMaterial({
        color: '#ff8a3e', transparent: true, depthWrite: false, opacity: 0, side: T.DoubleSide, blending: T.AdditiveBlending,
      })));
      trail.userData['bloom'] = true;
      trail.visible = false;
      this.fx.add(trail);
      this.trails.push(trail);
    }
    scene.add(this.fx);
    this.setActive(false);
  }

  /**
   * Afena de guerre (≈ 85 cm) : lame de fer large qui s'évase vers la pointe et
   * se courbe côté tranchant, poignée de bois à deux pommeaux couverts d'or.
   * Plan de la lame : largeur selon z (tranchant vers le bas quand le bras pend),
   * épaisseur selon x.
   */
  private buildAfena(add: (p: T.Object3D, g: T.BufferGeometry, m: T.Material, x: number, y: number, z: number,
    rx?: number, ry?: number, rz?: number) => T.Mesh, gold: T.Material, steel: T.Material, wood: T.Material) {
    const { pommel, guard, base, tip } = AFENA;
    add(this.afena, new T.SphereGeometry(0.9, 8, 6), gold, 0, pommel, 0).scale.y = 0.78;
    add(this.afena, new T.CylinderGeometry(0.45, 0.5, guard - pommel - 1, 7), wood, 0, (pommel + guard) / 2, 0);
    for (const y of [pommel + 1.1, guard - 1.1]) add(this.afena, new T.CylinderGeometry(0.55, 0.55, 0.28, 7), gold, 0, y, 0);
    add(this.afena, new T.SphereGeometry(0.75, 8, 6), gold, 0, guard, 0).scale.y = 0.72;
    const shape = new T.Shape();
    const len = tip - base;
    // (x de la forme = largeur de lame, y = longueur)
    shape.moveTo(-0.38, 0);
    shape.lineTo(-0.52, len * 0.45);
    shape.quadraticCurveTo(-0.9, len * 0.82, -1.3, len * 0.9); // ventre côté tranchant
    shape.quadraticCurveTo(-1.0, len * 0.99, -0.1, len); // pointe arrondie, inclinée
    shape.quadraticCurveTo(0.62, len * 0.88, 0.52, len * 0.7); // dos qui s'élargit
    shape.lineTo(0.38, 0);
    shape.closePath();
    const depth = 0.22;
    const blade = new T.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.12, bevelSegments: 1, curveSegments: 6,
    });
    blade.translate(0, base, -depth / 2);
    blade.rotateY(Math.PI / 2);
    add(this.afena, blade, steel, 0, 0, 0);
    // Deux petits jours décoratifs près du talon (lames d'apparat akan), en sombre.
    for (const y of [base + 1.8, base + 3.3]) {
      add(this.afena, new T.CylinderGeometry(0.22, 0.22, 0.5, 6), WEAPON_MATERIALS.darkIron, 0, y, 0, 0, 0, Math.PI / 2);
    }
  }

  /**
   * Mousquet de traite (≈ 1,30 m) : crosse de bois sombre, canon de fer fin,
   * platine à silex sur le flanc, capucines de laiton. La main droite tient le
   * poignet de la crosse (y = 0), la gauche soutient le fût pour viser.
   */
  private buildMusket(add: (p: T.Object3D, g: T.BufferGeometry, m: T.Material, x: number, y: number, z: number,
    rx?: number, ry?: number, rz?: number) => T.Mesh, wood: T.Material, iron: T.Material) {
    const { butt, muzzle } = MUSKET;
    // Crosse : profil plat (x de la forme = hauteur selon z), épaisseur selon x.
    const stock = new T.Shape();
    stock.moveTo(-0.45, 0.6);
    stock.lineTo(-0.5, -1.2);
    stock.lineTo(-1.6, butt); // talon qui plonge
    stock.lineTo(0.55, butt);
    stock.lineTo(0.5, -1.2);
    stock.lineTo(0.45, 0.6);
    stock.closePath();
    const thick = 1;
    const stockGeometry = new T.ExtrudeGeometry(stock, { depth: thick, bevelEnabled: false });
    stockGeometry.translate(0, 0, -thick / 2);
    stockGeometry.rotateY(Math.PI / 2);
    add(this.musket, stockGeometry, wood, 0, 0, 0);
    // Fût sous le canon, canon, baguette.
    add(this.musket, new T.BoxGeometry(0.8, 9.6, 0.75), wood, 0, 4.8, -0.15);
    add(this.musket, new T.CylinderGeometry(0.27, 0.32, muzzle + 0.5, 7), WEAPON_MATERIALS.darkIron, 0, (muzzle - 0.5) / 2, 0.45);
    add(this.musket, new T.CylinderGeometry(0.09, 0.09, 9.4, 4), wood, 0, 5.2, -0.65);
    for (const y of [3.2, 6.6, 9.8]) add(this.musket, new T.CylinderGeometry(0.5, 0.5, 0.35, 7), WEAPON_MATERIALS.brass, 0, y, 0.15);
    // Platine à silex (flanc droit), chien, sous-garde.
    add(this.musket, new T.BoxGeometry(0.2, 2.2, 0.8), iron, 0.5, 0.1, 0.2);
    add(this.musket, new T.BoxGeometry(0.22, 0.9, 0.3), iron, 0.6, -0.6, 0.85, 0.5, 0, 0);
    add(this.musket, new T.TorusGeometry(0.7, 0.1, 4, 8, Math.PI), iron, 0, -0.8, -0.65, 0, Math.PI / 2, Math.PI);
  }

  /** Objets à rendre visibles le temps de compiler leurs shaders. */
  get warmables(): T.Object3D[] {
    return [this.rightHand, this.musketHand, this.swordBack, this.musketBack, this.outfit, this.crest, this.fx,
      this.brokenMusket, ...(this.dress ? [this.dress] : [])];
  }

  /**
   * Lame de l'afena en monde (traînée d'arme, éclat du télégraphe).
   * @returns false quand l'afena n'est pas en main : `tip` est alors la bouche du canon.
   */
  bladeSegment(base: T.Vector3, tip: T.Vector3): boolean {
    this.rig.root.updateMatrixWorld(true);
    if (this.held !== 'afena') {
      this.musket.localToWorld(base.set(0, 0, 0));
      this.musket.localToWorld(tip.set(0, MUSKET.muzzle, 0.45));
      return false;
    }
    this.afena.localToWorld(base.set(0, AFENA.base + 2, 0));
    this.afena.localToWorld(tip.set(0, AFENA.tip, 0));
    return true;
  }

  /** true : le rig du duelliste devient Badu (sinon Kofi retrouve son bâton et sa tenue). */
  setActive(on: boolean) {
    if (on === this.active && this.swapped.length) return;
    this.active = on;
    for (const part of [this.rightHand, this.musketHand, this.swordBack, this.musketBack, this.outfit, this.crest, this.fx]) {
      part.visible = on;
    }
    if (this.dress) this.dress.visible = on;
    if (this.rig.body) this.rig.body.outfit.visible = !on;
    if (!on) {
      this.brokenMusket.visible = false;
      // Kofi n'utilise pas les coudes : bras droits.
      for (const limb of this.limbs) limb.elbow.rotation.set(0, 0, 0);
    }
    if (this.staff) this.staff.visible = !on;
    this.rig.root.scale.setScalar(on ? BADU_SCALE : 1);
    if (!this.swapped.length) {
      const [chest, hips] = this.rig.torso.children as T.Mesh[];
      this.swapped.push({ mesh: chest, original: chest.material, replacement: this.skin });
      this.swapped.push({ mesh: hips, original: hips.material, replacement: this.loincloth });
    }
    for (const s of this.swapped) s.mesh.material = on ? s.replacement : s.original;
    // Le batakari de Kofi est ajouté au rig après ce module : on le cherche à chaque bascule.
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
    // Une seule arme en main, l'autre dans le dos (voir swapWeapons).
    const held = broken && baduHeld(this.rig) === 'musket' ? 'none' : baduHeld(this.rig);
    if (held !== this.held) {
      this.held = held;
      (held === 'afena' ? this.rightHand : this.swordBack).add(this.afena);
      (held === 'musket' ? this.musketHand : this.musketBack).add(this.musket);
    }
    const dead = pose.state === 'dead';
    this.musket.visible = !broken && !(dead && k > 0.15 && held === 'musket');
    this.afena.visible = !(dead && k > 0.15 && held === 'afena');
    this.dropWeapon(pose, k);
    if (pose.state === 'shift' && k >= 0.42 && !this.brokenMusket.visible) {
      this.brokenMusket.visible = true;
      this.brokenMusket.position.set(pose.x + pose.facingY * 18 + pose.facingX * 10, 0, pose.y - pose.facingX * 18 + pose.facingY * 10);
      this.brokenMusket.rotation.y = Math.atan2(pose.facingX, pose.facingY) + 0.9;
    }

    this.rig.root.updateMatrixWorld(true);
    // Mousquet en main : canon en l'air au repos, à l'horizontale une fois épaulé.
    const aim = baduAim(this.rig);
    if (held === 'musket') {
      const arm = this.rig.arms[1].rotation.x + this.limbs[1].elbow.rotation.x + this.rig.torso.rotation.x;
      this.musket.rotation.set(lerp(0.2, Math.PI / 2, aim) - (arm + HAND_PITCH), 0, 0);
    } else this.musket.rotation.set(0, 0, 0);

    // Main gauche par IK : sur la poignée de l'afena (phase 2), sous le fût
    // pour viser, entre la bourse et la bouche du canon pour recharger, sur le
    // canon pour briser l'arme.
    if (!dead) {
      this.rig.root.updateMatrixWorld(true);
      if (held === 'afena' && broken) {
        this.leftReach(this.afena, 0, AFENA.pommel + 1, 1);
      } else if (held === 'musket' && pose.state === 'shift') {
        this.leftReach(this.musket, 0, 8, clamp01((k - 0.18) / 0.06));
      } else if (held === 'musket' && pose.attack === 'shot' && pose.state === 'recover') {
        const cycle = 0.5 - 0.5 * Math.cos(now * 0.006);
        const w = clamp01(k / 0.15) * (1 - clamp01((k - 0.85) / 0.15));
        if (cycle < 0.5) this.leftReach(this.outfit, -3.9, -1.4 + 2 * cycle, 1.4, w);
        else this.leftReach(this.musket, 0, MUSKET.muzzle - 3 + 3 * (cycle - 0.5), 0, w);
      } else if (held === 'musket') {
        this.leftReach(this.musket, 0, 7, clamp01(aim * 1.6));
      }
    }

    // Regard verrouillé sur le joueur (tête et calotte pivotent, dans la limite du cou).
    if (target) {
      const yaw = Math.atan2(target.x - pose.x, target.y - pose.y);
      const body = this.rig.root.rotation.y + this.rig.torso.rotation.y;
      const turn = Math.atan2(Math.sin(yaw - body), Math.cos(yaw - body));
      this.crest.rotation.y += (Math.max(-1.1, Math.min(1.1, turn)) - this.crest.rotation.y) * (1 - Math.exp(-10 * dt));
      this.rig.torso.children[3].rotation.y = this.crest.rotation.y;
    }

    this.rig.root.updateMatrixWorld(true);
    this.muzzle.set(0, MUSKET.muzzle, 0.45);
    this.musket.localToWorld(this.muzzle);
    this.lock.set(0.6, 0.2, 0.9);
    this.musket.localToWorld(this.lock);
    const aiming = pose.attack === 'shot' && pose.state === 'windup' && held === 'musket';
    const firing = pose.attack === 'shot' && pose.state === 'attacking';

    // Visée : la platine rougeoie, un filet de fumée noire coule du canon (télégraphe du tir).
    this.fuse.position.copy(this.lock);
    this.fuse.scale.setScalar(aiming ? 2.5 + 1.2 * Math.sin(now * 0.04) : 0.01);
    this.fuse.material.opacity = aiming ? 0.5 + 0.4 * clamp01(k / 0.8) : 0;
    this.puffClock -= dt;
    if (aiming && this.puffClock <= 0) {
      this.puffClock = 0.08;
      this.emit(this.muzzle.x, this.muzzle.y, this.muzzle.z, (Math.random() - 0.5) * 4, -2, (Math.random() - 0.5) * 4, 1.1);
    }
    if (firing && !this.lastShot) {
      this.flash.position.copy(this.muzzle);
      this.flash.material.opacity = 1;
      this.flash.scale.setScalar(22);
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
        trail.scale.set(length, 2.4, 1);
        trail.material.opacity = 0.8;
      });
      this.trailLife = 1;
    }
    this.lastShot = firing;

    this.flash.material.opacity = Math.max(0, this.flash.material.opacity - dt * 7);
    this.trailLife = Math.max(0, this.trailLife - dt * 0.6);
    for (const trail of this.trails) {
      if (!trail.visible) continue;
      trail.material.opacity = 0.8 * this.trailLife * (0.75 + 0.25 * Math.sin(now * 0.03));
      trail.material.color.setRGB(1, 0.45 + 0.2 * this.trailLife, 0.18);
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
      puff.sprite.scale.setScalar(5 + (1 - Math.min(1, age)) * 14);
      puff.sprite.material.opacity = Math.min(0.7, age * 0.55);
      puff.sprite.visible = puff.life > 0;
    }
  }

  /**
   * IK du bras gauche vers le point (x, y, z) du repère d'un objet, mélangé à
   * la pose animée selon `weight`.
   */
  private leftReach(object: T.Object3D, x: number, y: number, z: number, weight = 1) {
    if (weight <= 0) return;
    const torso = this.rig.torso;
    object.localToWorld(this.grip.set(x, y, z));
    torso.worldToLocal(this.grip);
    // Le coude part vers le bas et vers l'extérieur gauche.
    this.pole.set(-0.8, -0.6, -0.2).normalize();
    solveArm(this.rig.arms[0].position, this.grip, this.pole, this.solution);
    const arm = this.rig.arms[0];
    this.fk.copy(arm.quaternion);
    arm.quaternion.copy(this.fk).slerp(this.solution.shoulder, weight);
    const elbow = this.limbs[0].elbow;
    elbow.rotation.set(lerp(elbow.rotation.x, this.solution.elbow, weight), 0, 0);
  }

  /** L'arme tenue glisse des doigts au début de la mort, tombe et rebondit sur le sol. */
  private dropWeapon(pose: Actor3D, k: number) {
    const dead = pose.state === 'dead';
    if (!dead) {
      if (this.dropped) this.dropped.visible = false;
      return;
    }
    const inHand = this.held === 'musket' ? this.musket : this.held === 'afena' ? this.afena : null;
    if (!inHand) return;
    if (!this.dropped || this.dropped.name !== inHand.name) {
      if (this.dropped) this.scene.remove(this.dropped);
      this.dropped = inHand.clone();
      this.dropped.name = inHand.name;
      this.scene.add(this.dropped);
    }
    const sword = this.dropped;
    if (k <= 0.15) {
      sword.visible = false;
      inHand.getWorldPosition(this.dropFrom);
      return;
    }
    sword.visible = true;
    const t = clamp01((k - 0.15) / 0.13);
    const bounce = Math.sin(clamp01((k - 0.28) / 0.08) * Math.PI) * 2;
    const ground = 0.9 + bounce;
    sword.position.set(this.dropFrom.x + pose.facingY * 8, lerp(this.dropFrom.y, ground, t * t), this.dropFrom.z - pose.facingX * 8);
    sword.rotation.set(lerp(0.3, Math.PI / 2, t), Math.atan2(pose.facingX, pose.facingY) + 0.6, lerp(0, Math.PI / 2, t));
    sword.scale.setScalar(BADU_SCALE);
  }

  dispose() {
    this.scene.remove(this.fx, this.brokenMusket);
    if (this.dropped) this.scene.remove(this.dropped);
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
  // (approximation sans le rig : le mousquet pendant tout le tir)
  return pose.attack === 'shot' && pose.state !== 'chase' ? 'musket' : 'afena';
}
