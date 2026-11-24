import * as T from 'three';
import type { Actor3D } from './world-3d';

/**
 * Animations de combat des boss en 3D.
 *
 * Chaque attaque suit le même découpage, celui des principes classiques de
 * l'animation : anticipation (windup, le corps s'arme à l'opposé du coup),
 * impact (attacking, mouvement très rapide en easing sortant), suivi et
 * récupération (recover, le corps dépasse puis se relâche, lourd et lisible).
 * L'avancement de chaque état arrive dans `pose.phase` (0 → 1) et la hitbox
 * n'est active que pendant la partie « impact » (voir isBossHitActive).
 */

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInCubic = (t: number) => t * t * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
/** Anticipation : se prépare vite puis tient, avec un léger tremblement à la fin. */
const coil = (t: number, now: number) => easeOutCubic(clamp01(t / 0.8)) + (t > 0.8 ? Math.sin(now * 0.09) * 0.03 : 0);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Forme minimale d'un combattant humain construit par World3D.makeFighter. */
export interface FighterRig {
  root: T.Group;
  torso: T.Group;
  arms: T.Group[];
  legs: T.Group[];
}

interface Joints {
  torsoX: number; torsoY: number; torsoZ: number; lift: number; lunge: number;
  armL: [number, number, number]; armR: [number, number, number];
  legL?: number; legR?: number;
}

/**
 * Pose du capitaine (combattant humain). Appelé après l'animation de base
 * de World3D, qui gère déjà la marche : on n'écrase les articulations que
 * dans les états de combat.
 */
export function animateDuelist(f: FighterRig, pose: Actor3D, now: number) {
  const k = clamp01(pose.phase);
  const attack = pose.attack ?? 'none';
  const phase = pose.bossPhase ?? 1;
  const j: Joints = {
    torsoX: 0, torsoY: 0, torsoZ: 0, lift: 0, lunge: 0,
    armL: [-0.2, 0, 0.12], armR: [-0.55, 0, -0.14],
  };

  switch (pose.state) {
    case 'idle': {
      // Garde : arme pointée vers le joueur, respiration plus courte à chaque phase.
      const breath = Math.sin(now * (0.0032 + phase * 0.0012));
      j.lift = breath * 0.45 - 0.6 * phase;
      j.torsoX = 0.08 * phase;
      if (phase === 3) j.torsoZ = Math.sin(now * 0.05) * 0.015;
      break;
    }
    case 'chase':
      return; // la marche de base suffit
    case 'windup':
      windupPose(j, attack, coil(k, now));
      break;
    case 'attacking':
      strikePose(j, attack, k, pose.step ?? 0, now);
      break;
    case 'recover': {
      const b = 1 - easeOutCubic(k);
      const heavy = attack === 'slam' || attack === 'sweep' ? 1.25 : 1;
      const breath = Math.sin(now * 0.014) * 0.7 * b;
      j.torsoX = 0.55 * b * heavy;
      j.lift = -2.6 * b * heavy + breath;
      j.armR = [lerp(-0.55, attack === 'slam' ? -0.35 : 0.35, b), 0, -0.14];
      j.armL = [lerp(-0.2, 0.25, b), 0, lerp(0.12, 0.4, b)];
      break;
    }
    case 'hurt': {
      const b = 1 - k;
      j.torsoX = -0.45 * b;
      j.torsoZ = 0.25 * b;
      j.lunge = -5 * b;
      j.armR = [0.4 * b - 0.55 * (1 - b), 0, -0.4 * b];
      break;
    }
    case 'shift': {
      // Tombe à genou, puis se relève torse ouvert : le « cri » de la nouvelle phase.
      const tremble = Math.sin(now * 0.08) * 0.04;
      if (k < 0.45) {
        const e = easeOutCubic(k / 0.45);
        j.lift = -7 * e;
        j.torsoX = 0.75 * e + tremble;
        j.armR = [0.25 * e, 0, -0.14];
        j.legL = -1.25 * e;
        j.legR = 0.45 * e;
      } else {
        const r = easeOutBack((k - 0.45) / 0.55);
        j.lift = -7 * (1 - r) + 1.2 * r;
        j.torsoX = 0.75 * (1 - r) - 0.38 * r + tremble;
        j.armR = [-0.7 * r, 0, -0.14 - 1.5 * r];
        j.armL = [-0.6 * r, 0, 0.12 + 1.5 * r];
        j.legL = -1.25 * (1 - r);
        j.legR = 0.45 * (1 - r);
      }
      break;
    }
    default:
      return;
  }

  f.torso.position.y = 16 + j.lift;
  f.torso.rotation.set(j.torsoX, j.torsoY, j.torsoZ);
  f.arms[0].rotation.set(...j.armL);
  f.arms[1].rotation.set(...j.armR);
  if (j.legL !== undefined) f.legs[0].rotation.x = j.legL;
  if (j.legR !== undefined) f.legs[1].rotation.x = j.legR;
  if (j.lunge) {
    f.root.position.x += pose.facingX * j.lunge;
    f.root.position.z += pose.facingY * j.lunge;
  }
}

/** Anticipation : chaque attaque s'arme dans la direction opposée au coup. */
function windupPose(j: Joints, attack: string, e: number) {
  switch (attack) {
    case 'slam': // arme levée à deux mains au-dessus de la tête, dos cambré
      j.armR = [-0.55 - 2.1 * e, 0, -0.14];
      j.armL = [-0.2 - 2.2 * e, 0, 0.12 - 0.3 * e];
      j.torsoX = -0.32 * e;
      j.lift = 1.6 * e;
      break;
    case 'charge': // accroupi, arme couchée comme une lance, appui arrière
      j.lift = -4.2 * e;
      j.torsoX = 0.55 * e;
      j.armR = [-0.55 - 0.85 * e, 0, -0.14];
      j.legL = -0.65 * e;
      j.legR = 0.5 * e;
      j.lunge = -4 * e;
      break;
    case 'sweep': // grand enroulement du buste, bras écartés
      j.torsoY = -1.45 * e;
      j.armR = [-1.1 * e, 0, -0.14 - 1.1 * e];
      j.armL = [-0.2, 0, 0.12 + 1.2 * e];
      j.lift = -2.2 * e;
      j.torsoX = 0.15 * e;
      break;
    case 'combo':
      j.torsoY = -0.55 * e;
      j.armR = [-0.55 + 0.75 * e, 0, -0.14 - 0.4 * e];
      j.lift = -1.2 * e;
      break;
    default: // slash : buste tourné, lame ramenée derrière l'épaule
      j.torsoY = -0.95 * e;
      j.torsoX = -0.12 * e;
      j.armR = [-0.55 + 1.15 * e, 0, -0.14 - 0.5 * e];
      j.lift = -1.5 * e;
  }
}

/** Impact puis suivi : départ explosif (easeOutExpo), dépassement, retour lent. */
function strikePose(j: Joints, attack: string, k: number, step: number, now: number) {
  const snap = easeOutExpo(clamp01(k / 0.3));
  const settle = easeInOut(clamp01((k - 0.3) / 0.7));
  switch (attack) {
    case 'slam': {
      const hit = easeInCubic(clamp01(k / 0.22));
      j.armR = [lerp(-2.65, -0.15, hit), 0, -0.14];
      j.armL = [lerp(-2.4, -0.1, hit), 0, -0.18];
      j.torsoX = lerp(-0.32, 0.65, hit) - 0.1 * settle;
      j.lift = lerp(1.6, -4.2, hit) + 1.2 * settle;
      j.lunge = 4 * hit;
      break;
    }
    case 'charge': {
      const run = Math.sin(now * 0.032);
      j.torsoX = 0.6;
      j.lift = -2 + Math.abs(run) * 0.8;
      j.armR = [-1.45, 0, -0.14];
      j.armL = [-0.9, 0, 0.3];
      j.legL = run * 0.95;
      j.legR = -run * 0.95;
      break;
    }
    case 'sweep': {
      const spin = easeInOut(k);
      j.torsoY = -1.45 + spin * (TAU + 1.45);
      j.armR = [-1.15, 0, -1.3];
      j.armL = [-0.2, 0, 1.3];
      j.lift = -2.2 + Math.sin(k * Math.PI) * 1.2;
      j.torsoX = 0.15;
      break;
    }
    case 'combo': {
      const local = (k * 3) % 1;
      const s = easeOutExpo(clamp01(local / 0.35));
      const back = easeInOut(clamp01((local - 0.35) / 0.65));
      if (step >= 2) { // troisième coup : frappe verticale qui conclut
        const hit = easeInCubic(clamp01(local / 0.3));
        j.armR = [lerp(-2.4, -0.2, hit), 0, -0.14];
        j.armL = [lerp(-2.2, -0.1, hit), 0, 0];
        j.torsoX = lerp(-0.25, 0.6, hit);
        j.lift = lerp(1.2, -3.6, hit);
        j.lunge = 5 * hit;
      } else { // aller puis retour : la lame change de côté à chaque coup
        const dir = step === 0 ? 1 : -1;
        j.torsoY = lerp(-0.7 * dir, 0.9 * dir, s) - 0.15 * dir * back;
        j.armR = [-1.25, 0.2 * dir, -0.14 + 0.65 * dir * (2 * s - 1)];
        j.torsoX = 0.18 * s;
        j.lift = -1.4;
        j.lunge = 6 * s - 2 * back;
      }
      break;
    }
    default: { // slash
      j.torsoY = lerp(-0.95, 1.05, snap) - 0.3 * settle;
      j.torsoX = 0.28 * snap - 0.1 * settle;
      j.armR = [lerp(0.6, -1.7, snap) + 0.4 * settle, 0, lerp(-0.64, 0.7, snap) - 0.2 * settle];
      j.lift = -1.5 - 0.8 * snap + 1.4 * settle;
      j.lunge = 7 * snap - 2.5 * settle;
    }
  }
}

/** Couleurs du cœur du Gardien : plus vif à chaque nœud rompu. */
const GUARDIAN_CORE = [
  { color: '#6cd3ba', emissive: '#27756c' },
  { color: '#7fe3f0', emissive: '#2a8ca0' },
  { color: '#d8fbff', emissive: '#58c6ff' },
];

/** Le Gardien noyé : carapace, six pattes, deux pinces articulées et ses vagues. */
export class GuardianRig {
  readonly root = new T.Group();
  /** Anneaux d'eau, en coordonnées monde (hors du root qui pivote). */
  readonly rings = new T.Group();
  private readonly body = new T.Group();
  private readonly lid = new T.Group();
  private readonly legs: T.Group[] = [];
  private readonly pincers: { arm: T.Group; jaw: T.Group; side: number }[] = [];
  private readonly coreMaterial: T.MeshStandardMaterial;
  private readonly shellMaterial: T.MeshStandardMaterial;
  private readonly ringMeshes: T.Mesh<T.RingGeometry, T.MeshBasicMaterial>[] = [];
  private readonly aura: T.Mesh<T.RingGeometry, T.MeshBasicMaterial>;

  constructor(material: (color: string) => T.MeshStandardMaterial) {
    this.shellMaterial = material('#56645a');
    const claw = material('#9c9c75');
    this.coreMaterial = new T.MeshStandardMaterial({ color: '#6cd3ba', emissive: '#27756c' });
    this.body.position.y = 10;
    this.root.add(this.body);

    const shell = new T.Mesh(new T.IcosahedronGeometry(22, 1), this.shellMaterial);
    // Ventre bas et plat ; la plaque dorsale couvre le cœur tant qu'elle est fermée.
    shell.position.set(0, -2, -4);
    shell.scale.set(0.95, 0.32, 1.23);
    this.body.add(shell);
    // Plaque dorsale séparée : elle se soulève quand la carapace s'ouvre.
    this.lid.position.set(0, 6, 14); // charnière à l'avant : la plaque se relève vers l'arrière
    this.body.add(this.lid);
    const plate = new T.Mesh(new T.IcosahedronGeometry(17, 1), this.shellMaterial);
    plate.position.set(0, 2, -15);
    plate.scale.set(0.95, 0.42, 1.1);
    this.lid.add(plate);
    const core = new T.Mesh(new T.IcosahedronGeometry(10, 0), this.coreMaterial);
    core.position.set(0, 3, 0);
    core.scale.set(0.74, 0.65, 1.25);
    this.body.add(core);
    for (const side of [-1, 1]) {
      const eye = new T.Mesh(new T.SphereGeometry(1.6, 6, 4), this.coreMaterial);
      eye.position.set(side * 5, 4, 19);
      this.body.add(eye);
    }

    const legGeometry = new T.DodecahedronGeometry(7, 0);
    for (const side of [-1, 1]) {
      for (let leg = 0; leg < 3; leg++) {
        const pivot = new T.Group();
        pivot.position.set(side * 12, -4, leg * 11 - 13);
        const mesh = new T.Mesh(legGeometry, this.shellMaterial);
        mesh.position.set(side * 6, -1, 0);
        mesh.scale.set(1.48, 0.59, 0.78);
        pivot.add(mesh);
        this.body.add(pivot);
        this.legs.push(pivot);
      }
      // Pince : bras qui pivote à l'épaule, mâchoire mobile au bout.
      const arm = new T.Group();
      arm.position.set(side * 10, -1, 14);
      const forearm = new T.Mesh(new T.ConeGeometry(5, 15, 5), claw);
      forearm.rotation.x = Math.PI / 2;
      forearm.position.z = 7;
      arm.add(forearm);
      const jaw = new T.Group();
      jaw.position.set(-side * 2, 1.5, 13);
      const jawMesh = new T.Mesh(new T.ConeGeometry(2.6, 10, 4), claw);
      jawMesh.rotation.x = Math.PI / 2;
      jawMesh.position.z = 4.5;
      jaw.add(jawMesh);
      arm.add(jaw);
      arm.rotation.z = side * 0.18;
      this.body.add(arm);
      this.pincers.push({ arm, jaw, side });
    }

    for (let i = 0; i < 2; i++) {
      const ring = new T.Mesh(new T.RingGeometry(0.86, 1.03, 64),
        new T.MeshBasicMaterial({ color: '#9bd7c6', transparent: true, depthWrite: false, opacity: 0.55 }));
      ring.rotation.x = -Math.PI / 2;
      this.ringMeshes.push(ring);
      this.rings.add(ring);
    }
    this.aura = new T.Mesh(new T.RingGeometry(20, 30, 48),
      new T.MeshBasicMaterial({ color: '#a8f3ff', transparent: true, depthWrite: false, opacity: 0 }));
    this.aura.rotation.x = -Math.PI / 2;
    this.aura.position.y = 0.6;
    this.root.add(this.aura);
  }

  update(pose: Actor3D, now: number) {
    const k = clamp01(pose.phase);
    const attack = pose.attack ?? 'none';
    const phase = (pose.bossPhase ?? 1) as 1 | 2 | 3;
    this.root.position.set(pose.x, 0, pose.y);

    let pitch = 0, roll = 0, twist = 0, lift = Math.sin(now * 0.004) * 0.6;
    let reach = 0, spread = 0, jaw = 0.15, lid = 0, legSwing = 0.1, glow = 0.8 + phase * 0.35;
    let snapLeft = 0, snapRight = 0;

    switch (pose.state) {
      case 'chase':
        legSwing = 0.38 + phase * 0.06;
        roll = Math.sin(now * 0.02) * 0.06;
        break;
      case 'windup': {
        const e = coil(k, now);
        if (attack === 'slam') { pitch = -0.55 * e; lift += 6 * e; reach = -1.1 * e; jaw = 0.15 + 0.5 * e; }
        else if (attack === 'charge') { lift -= 3 * e; pitch = 0.12 * e; reach = -0.25 * e; legSwing = 0.2; }
        else if (attack === 'sweep') { twist = -0.9 * e; spread = 0.9 * e; lift -= 2 * e; }
        else if (attack === 'combo') { reach = -0.5 * e; jaw = 0.15 + 0.55 * e; pitch = -0.1 * e; }
        else { // surge / tide : il s'enfonce, le cœur pulse
          const beats = attack === 'tide' ? 2 : 1;
          lift -= 3.2 * e;
          lid = -0.25 * e * (0.5 + 0.5 * Math.sin(k * Math.PI * 2 * beats * 3));
          glow += 2.2 * e * (0.6 + 0.4 * Math.sin(now * 0.03));
        }
        break;
      }
      case 'attacking': {
        if (attack === 'slam') {
          const hit = easeInCubic(clamp01(k / 0.4));
          pitch = lerp(-0.55, 0.28, hit); lift += lerp(6, -2.5, hit); reach = lerp(-1.1, 0.55, hit); jaw = 0.65 - 0.5 * hit;
        } else if (attack === 'charge') {
          legSwing = 0.7; pitch = 0.16; lift -= 1.5; reach = 0.35; roll = Math.sin(now * 0.04) * 0.08;
        } else if (attack === 'sweep') {
          twist = -0.9 + easeInOut(k) * (TAU + 0.9); spread = 0.95; lift += Math.sin(k * Math.PI) * 2; legSwing = 0.5;
        } else if (attack === 'combo') {
          const local = (k * 3) % 1;
          const s = easeOutExpo(clamp01(local / 0.3));
          const step = pose.step ?? 0;
          const side = step === 0 ? -1 : step === 1 ? 1 : 0;
          twist = side * 0.28 * s;
          if (side <= 0) snapLeft = s;
          if (side >= 0) snapRight = s;
          reach = -0.5;
        } else { // vague : bond qui chasse l'eau
          lift += Math.sin(k * Math.PI) * 5;
          lid = -0.5 * Math.sin(k * Math.PI);
          glow += 1.5 * (1 - k);
        }
        break;
      }
      case 'recover': {
        const b = 1 - easeOutCubic(k);
        if (pose.exposed) {
          // Carapace ouverte, cœur à nu : la fenêtre punissable doit se voir de loin.
          const close = easeInCubic(clamp01((k - 0.75) / 0.25));
          lid = -0.95 * (1 - close);
          glow += 2.6 * (1 - close) * (0.75 + 0.25 * Math.sin(now * 0.02));
          lift -= 2.5;
          legSwing = 0.03;
        } else if (attack === 'slam') {
          pitch = 0.28 * b; reach = 0.55 * b; lift -= 2.5 * b; // pinces plantées dans la vase
        } else {
          lift -= 1.5 * b; pitch = 0.1 * b;
        }
        break;
      }
      case 'hurt':
        pitch = -0.2 * (1 - k);
        roll = Math.sin(now * 0.09) * 0.1 * (1 - k);
        break;
      case 'shift': {
        // Le nœud cède : il se cabre en tremblant, puis retombe.
        const tremble = Math.sin(now * 0.085) * 0.07;
        if (k < 0.6) {
          const e = easeOutCubic(k / 0.6);
          pitch = -0.85 * e + tremble; lift += 8 * e; reach = -1.3 * e; spread = 0.7 * e; jaw = 0.8 * e;
          glow += 3.5 * e;
        } else {
          const d = easeInCubic((k - 0.6) / 0.4);
          pitch = lerp(-0.85, 0.15, d); lift += lerp(8, -1.5, d); reach = lerp(-1.3, 0.3, d); spread = 0.7 * (1 - d);
          glow += 3.5 * (1 - d);
        }
        break;
      }
    }

    // Orientation : suit le regard, sauf pendant le tourbillon qui ajoute un tour complet.
    const facing = Math.atan2(pose.facingX, pose.facingY);
    this.root.rotation.y = facing + twist;
    this.body.position.y = 10 + lift;
    this.body.rotation.set(pitch, 0, roll);
    this.lid.rotation.x = -lid;
    this.legs.forEach((leg, i) => {
      leg.rotation.y = Math.sin(now * 0.022 + i * 2.3) * legSwing;
      leg.rotation.z = (i < 3 ? -1 : 1) * (pose.state === 'recover' && pose.exposed ? 0.35 : 0);
    });
    for (const { arm, jaw: jawGroup, side } of this.pincers) {
      const snap = side < 0 ? snapLeft : snapRight;
      arm.rotation.set(reach - snap * 0.55, -side * snap * 0.35, side * (0.18 + spread));
      // Mâchoire ouverte pendant l'armement, claquée à l'impact.
      jawGroup.rotation.y = side * (snap > 0 ? 0.6 * (1 - snap) : jaw);
    }

    const core = GUARDIAN_CORE[phase - 1];
    this.coreMaterial.color.set(core.color);
    this.coreMaterial.emissive.set(core.emissive);
    this.coreMaterial.emissiveIntensity = glow;
    this.shellMaterial.emissive.set(phase === 3 ? '#16303a' : '#000000');

    const auraStrength = pose.state === 'shift' ? Math.sin(k * Math.PI) : phase === 3 ? 0.15 : 0;
    this.aura.material.opacity = auraStrength * 0.6;
    this.aura.scale.setScalar(1 + (pose.state === 'shift' ? k * 1.6 : 0.05 * Math.sin(now * 0.006)));

    const radii = pose.waveRadii ?? [];
    this.ringMeshes.forEach((ring, i) => {
      const radius = radii[i];
      ring.visible = radius !== undefined;
      if (radius === undefined) return;
      ring.position.set(pose.x, 1.5 + i * 0.2, pose.y);
      ring.scale.set(radius, radius, 1);
      ring.material.opacity = 0.68 - k * 0.3;
    });
  }

  hide() {
    this.ringMeshes.forEach((ring) => { ring.visible = false; });
  }
}
