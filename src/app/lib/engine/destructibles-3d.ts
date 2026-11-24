import * as T from 'three';
import {
  DESTRUCTIBLE_KINDS,
  type DebrisStyle,
  type DestructibleKind,
} from '../constants/destructibles.config-constant';
import { sceneryRandom } from '../constants/scenery';
import type { DestructiblesService } from './destructibles.service';

/**
 * Vue 3D du décor destructible.
 *
 * Budget : un InstancedMesh par (type d'objet × pièce), un pour les gravats,
 * un pour les éclats. ~20 draw calls en tout, quel que soit le nombre
 * d'objets. Aucune allocation par frame : les éclats viennent d'un pool fixe
 * et seules les matrices des objets qui tremblent sont recalculées.
 */

interface Part {
  geometry: T.BufferGeometry;
  local: T.Matrix4;
  accent: boolean;
}

interface KindBatch {
  kind: DestructibleKind;
  ids: number[]; // index d'instance → id d'objet
  meshes: { mesh: T.InstancedMesh; part: Part }[];
}

const DEBRIS = 320;
const RUBBLE_PER_PROP = 3;
const WOBBLE_TIME = 0.55;
const GRAVITY = 260;

const tmpMatrix = new T.Matrix4();
const tmpWorld = new T.Matrix4();
const tmpQuat = new T.Quaternion();
const tmpEuler = new T.Euler();
const tmpPos = new T.Vector3();
const tmpScale = new T.Vector3();
const tmpColor = new T.Color();
const tmpAxis = new T.Vector3();
const tilt = new T.Quaternion();
const ZERO = new T.Matrix4().makeScale(0, 0, 0);

function local(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  return new T.Matrix4().compose(new T.Vector3(x, y, z),
    new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(1, 1, 1));
}

function scaled(geometry: T.BufferGeometry, x: number, y: number, z: number) {
  geometry.scale(x, y, z);
  return geometry;
}

/** Formes simples, low-poly, cohérentes avec le reste de la scène (flat shading). */
function partsFor(kind: DestructibleKind): Part[] {
  const { radius: r, height: h } = DESTRUCTIBLE_KINDS[kind];
  switch (kind) {
    case 'pot':
      return [
        { geometry: scaled(new T.SphereGeometry(1, 9, 6), r, h * 0.48, r), local: local(0, h * 0.45, 0), accent: false },
        { geometry: new T.CylinderGeometry(r * 0.42, r * 0.55, h * 0.25, 9), local: local(0, h * 0.88, 0), accent: true },
      ];
    case 'calabash':
      return [
        { geometry: scaled(new T.SphereGeometry(1, 8, 6), r, h * 0.5, r), local: local(0, h * 0.42, 0), accent: false },
        { geometry: new T.SphereGeometry(r * 0.38, 6, 4), local: local(0, h * 0.95, 0), accent: true },
      ];
    case 'basket':
      return [
        { geometry: new T.CylinderGeometry(r, r * 0.78, h * 0.72, 10), local: local(0, h * 0.36, 0), accent: false },
        // Tas d'ignames au sommet.
        { geometry: scaled(new T.DodecahedronGeometry(1, 0), r * 0.85, h * 0.32, r * 0.85), local: local(0, h * 0.78, 0), accent: true },
      ];
    case 'jar':
      return [
        { geometry: scaled(new T.SphereGeometry(1, 10, 7), r, h * 0.5, r), local: local(0, h * 0.48, 0), accent: false },
        { geometry: new T.CylinderGeometry(r * 0.45, r * 0.6, h * 0.2, 10), local: local(0, h * 0.95, 0), accent: true },
      ];
    case 'firewood':
      return [-1, 0, 1].map((i): Part => ({
        geometry: new T.CylinderGeometry(2.6, 2.6, r * 2, 6),
        local: local(i * 4.6, i === 0 ? 7.4 : 2.8, 0, 0, 0, Math.PI / 2 + i * 0.08),
        accent: i !== 0,
      })).concat([{
        geometry: new T.CylinderGeometry(2.4, 2.4, r * 1.8, 6), local: local(0, 2.6, 4.2, 0, 0.3, Math.PI / 2), accent: false,
      }]);
    case 'barricade':
      return [
        { geometry: new T.BoxGeometry(r * 2, h * 0.82, 3), local: local(0, h * 0.41, 0), accent: false },
        { geometry: new T.BoxGeometry(r * 2.1, 2.4, 4.2), local: local(0, h * 0.62, 0.4), accent: true },
        // Pointes des pieux.
        { geometry: new T.ConeGeometry(2, h * 0.24, 4), local: local(-r * 0.55, h * 0.94, 0), accent: true },
        { geometry: new T.ConeGeometry(2, h * 0.24, 4), local: local(r * 0.55, h * 0.94, 0), accent: true },
      ];
    case 'wall':
      return [
        { geometry: new T.BoxGeometry(r * 1.98, h, 11), local: local(0, h / 2, 0), accent: false },
        { geometry: new T.BoxGeometry(r * 2.04, 2.6, 13), local: local(0, h + 1.1, 0), accent: true },
      ];
    case 'stone':
      return [
        { geometry: new T.BoxGeometry(r * 1.96, h, 15), local: local(0, h / 2, 0), accent: false },
        { geometry: scaled(new T.DodecahedronGeometry(1, 0), r * 0.7, 5, 6), local: local(r * 0.3, h + 1.5, 1), accent: true },
      ];
  }
}

const DEBRIS_SHAPE: Record<DebrisStyle, [number, number, number]> = {
  shard: [2.2, 0.7, 1.8],
  splinter: [0.8, 0.8, 4.6],
  clod: [2.6, 2.0, 2.4],
  straw: [0.4, 0.4, 3.4],
};

export class Destructibles3D {
  private readonly group = new T.Group();
  private readonly batches: KindBatch[] = [];
  private readonly slot = new Map<number, { batch: KindBatch; index: number }>();
  private readonly rubble: T.InstancedMesh;
  private readonly debris: T.InstancedMesh;
  private readonly material = new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true });

  // État d'animation côté vue (indépendant du gel de la boucle de jeu).
  private time = 0;
  private readonly hitTime: Float32Array;
  private readonly hitStrength: Float32Array;
  private readonly wobbling = new Set<number>();
  private revision = -1;

  // Pool d'éclats : position, vitesse, rotation, vie.
  private readonly dPos = new Float32Array(DEBRIS * 3);
  private readonly dVel = new Float32Array(DEBRIS * 3);
  private readonly dRot = new Float32Array(DEBRIS * 3);
  private readonly dSpin = new Float32Array(DEBRIS * 3);
  private readonly dSize = new Float32Array(DEBRIS * 3);
  private readonly dLife = new Float32Array(DEBRIS);
  private nextDebris = 0;
  private liveDebris = 0;
  private readonly random = sceneryRandom(90211);

  constructor(private readonly scene: T.Scene, private readonly service: DestructiblesService) {
    const props = service.props;
    this.hitTime = new Float32Array(props.length).fill(-10);
    this.hitStrength = new Float32Array(props.length);

    for (const kind of Object.keys(DESTRUCTIBLE_KINDS) as DestructibleKind[]) {
      const ids = props.filter((p) => p.kind === kind).map((p) => p.id);
      if (!ids.length) continue;
      const batch: KindBatch = { kind, ids, meshes: [] };
      for (const part of partsFor(kind)) {
        const mesh = new T.InstancedMesh(part.geometry, this.material, ids.length);
        mesh.frustumCulled = false; // les instances couvrent toute la carte
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        batch.meshes.push({ mesh, part });
        this.group.add(mesh);
      }
      ids.forEach((id, index) => this.slot.set(id, { batch, index }));
      this.batches.push(batch);
    }

    this.rubble = new T.InstancedMesh(new T.DodecahedronGeometry(1, 0), this.material, props.length * RUBBLE_PER_PROP);
    this.rubble.frustumCulled = false;
    this.debris = new T.InstancedMesh(new T.TetrahedronGeometry(1, 0), this.material, DEBRIS);
    this.debris.frustumCulled = false;
    this.debris.instanceMatrix.setUsage(T.DynamicDrawUsage);
    for (let i = 0; i < DEBRIS; i++) {
      this.debris.setMatrixAt(i, ZERO);
      this.debris.setColorAt(i, tmpColor.set('#000000'));
    }
    this.group.add(this.rubble, this.debris);
    this.scene.add(this.group);
    this.rebuild();
  }

  update(dt: number) {
    this.time += dt;
    for (const event of this.service.drainEvents()) {
      this.hitTime[event.id] = this.time;
      this.hitStrength[event.id] = event.strength;
      this.wobbling.add(event.id);
      this.spawnDebris(event.id, event.dirX, event.dirY, event.broken ? 1 : event.strength * 0.4);
    }
    if (this.service.revision !== this.revision) {
      this.revision = this.service.revision;
      this.rebuild();
    } else {
      for (const id of this.wobbling) this.writeProp(id);
      this.flush();
    }
    for (const id of this.wobbling) {
      if (this.time - this.hitTime[id] > WOBBLE_TIME) this.wobbling.delete(id);
    }
    if (this.liveDebris > 0) this.stepDebris(dt);
  }

  private rebuild() {
    for (const prop of this.service.props) this.writeProp(prop.id);
    for (const batch of this.batches) {
      for (const { mesh } of batch.meshes) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.rubble.instanceMatrix.needsUpdate = true;
    if (this.rubble.instanceColor) this.rubble.instanceColor.needsUpdate = true;
    this.flush();
  }

  private flush() {
    for (const batch of this.batches) {
      for (const { mesh } of batch.meshes) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private writeProp(id: number) {
    const prop = this.service.props[id];
    const where = this.slot.get(id);
    if (!where) return;
    const kind = DESTRUCTIBLE_KINDS[prop.kind];
    const damage = 1 - prop.hp / prop.maxHp;
    const cracked = damage >= 0.5;

    // Tremblement amorti dans la direction du coup, plus un léger affaissement
    // permanent quand l'objet est fissuré.
    const age = this.time - this.hitTime[id];
    const shake = age < WOBBLE_TIME
      ? Math.sin(age * 42) * Math.exp(-age * 7) * 0.26 * this.hitStrength[id] : 0;
    const lean = (cracked ? 0.07 : 0) + shake;
    tmpAxis.set(prop.hitDirY, 0, -prop.hitDirX);
    if (tmpAxis.lengthSq() < 0.01) tmpAxis.set(1, 0, 0);
    tilt.setFromAxisAngle(tmpAxis.normalize(), -lean);
    tmpQuat.setFromEuler(tmpEuler.set(0, prop.rot + id * 0.7 * (kind.solid ? 0 : 1), 0));
    tmpQuat.premultiply(tilt);
    tmpPos.set(prop.x, 0, prop.y);
    tmpWorld.compose(tmpPos, tmpQuat, tmpScale.set(1, cracked ? 0.94 : 1, 1));

    for (const { mesh, part } of where.batch.meshes) {
      if (prop.broken) mesh.setMatrixAt(where.index, ZERO);
      else mesh.setMatrixAt(where.index, tmpMatrix.multiplyMatrices(tmpWorld, part.local));
      tmpColor.set(part.accent ? kind.accent : kind.color).multiplyScalar(cracked ? 0.74 : 1 - damage * 0.3);
      mesh.setColorAt(where.index, tmpColor);
    }

    // Gravats : visibles seulement une fois l'objet brisé.
    const seed = sceneryRandom(id * 7919 + 13);
    for (let k = 0; k < RUBBLE_PER_PROP; k++) {
      const index = id * RUBBLE_PER_PROP + k;
      const angle = seed() * Math.PI * 2;
      const spread = seed() * prop.radius * 0.9;
      const size = prop.radius * (0.28 + seed() * 0.22);
      if (!prop.broken) {
        this.rubble.setMatrixAt(index, ZERO);
      } else {
        tmpQuat.setFromEuler(tmpEuler.set(seed() * 3, seed() * 3, seed() * 3));
        tmpPos.set(prop.x + Math.cos(angle) * spread, size * 0.25, prop.y + Math.sin(angle) * spread);
        this.rubble.setMatrixAt(index, tmpMatrix.compose(tmpPos, tmpQuat, tmpScale.set(size, size * 0.4, size * 0.85)));
      }
      this.rubble.setColorAt(index, tmpColor.set(k === 0 ? kind.accent : kind.color).multiplyScalar(0.8));
    }
  }

  private spawnDebris(id: number, dirX: number, dirY: number, amount: number) {
    const prop = this.service.props[id];
    const kind = DESTRUCTIBLE_KINDS[prop.kind];
    const count = Math.max(2, Math.round(kind.debrisCount * amount));
    const [sx, sy, sz] = DEBRIS_SHAPE[kind.debris];
    const r = this.random;
    for (let n = 0; n < count; n++) {
      const i = this.nextDebris;
      this.nextDebris = (this.nextDebris + 1) % DEBRIS;
      if (this.dLife[i] <= 0) this.liveDebris++;
      const angle = r() * Math.PI * 2;
      const push = 40 + r() * 70;
      this.dPos[i * 3] = prop.x + Math.cos(angle) * prop.radius * 0.5;
      this.dPos[i * 3 + 1] = kind.height * (0.3 + r() * 0.6);
      this.dPos[i * 3 + 2] = prop.y + Math.sin(angle) * prop.radius * 0.5;
      // Les éclats partent surtout dans le sens du coup.
      this.dVel[i * 3] = dirX * push + Math.cos(angle) * 45;
      this.dVel[i * 3 + 1] = 60 + r() * 90;
      this.dVel[i * 3 + 2] = dirY * push + Math.sin(angle) * 45;
      for (let a = 0; a < 3; a++) {
        this.dRot[i * 3 + a] = r() * 6;
        this.dSpin[i * 3 + a] = (r() - 0.5) * 18;
      }
      const s = 0.7 + r() * 0.7;
      this.dSize[i * 3] = sx * s;
      this.dSize[i * 3 + 1] = sy * s;
      this.dSize[i * 3 + 2] = sz * s;
      this.dLife[i] = 1.1 + r() * 0.9;
      this.debris.setColorAt(i, tmpColor.set(r() < 0.5 ? kind.color : kind.accent));
    }
    if (this.debris.instanceColor) this.debris.instanceColor.needsUpdate = true;
  }

  private stepDebris(dt: number) {
    let live = 0;
    for (let i = 0; i < DEBRIS; i++) {
      if (this.dLife[i] <= 0) continue;
      this.dLife[i] -= dt;
      if (this.dLife[i] <= 0) {
        this.debris.setMatrixAt(i, ZERO);
        continue;
      }
      live++;
      const p = i * 3;
      this.dVel[p + 1] -= GRAVITY * dt;
      this.dPos[p] += this.dVel[p] * dt;
      this.dPos[p + 1] += this.dVel[p + 1] * dt;
      this.dPos[p + 2] += this.dVel[p + 2] * dt;
      const floor = this.dSize[p + 1] * 0.5;
      if (this.dPos[p + 1] < floor) {
        // Rebond mou puis glissade : les éclats restent un instant au sol.
        this.dPos[p + 1] = floor;
        this.dVel[p + 1] *= -0.28;
        this.dVel[p] *= 0.55;
        this.dVel[p + 2] *= 0.55;
        this.dSpin[p] *= 0.5;
        this.dSpin[p + 2] *= 0.5;
      }
      for (let a = 0; a < 3; a++) this.dRot[p + a] += this.dSpin[p + a] * dt;
      const fade = Math.min(1, this.dLife[i] / 0.35);
      tmpQuat.setFromEuler(tmpEuler.set(this.dRot[p], this.dRot[p + 1], this.dRot[p + 2]));
      tmpPos.set(this.dPos[p], this.dPos[p + 1], this.dPos[p + 2]);
      tmpScale.set(this.dSize[p] * fade, this.dSize[p + 1] * fade, this.dSize[p + 2] * fade);
      this.debris.setMatrixAt(i, tmpMatrix.compose(tmpPos, tmpQuat, tmpScale));
    }
    this.liveDebris = live;
    this.debris.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const batch of this.batches) {
      for (const { mesh } of batch.meshes) {
        mesh.geometry.dispose();
        mesh.dispose();
      }
    }
    this.rubble.geometry.dispose();
    this.rubble.dispose();
    this.debris.geometry.dispose();
    this.debris.dispose();
    this.material.dispose();
  }
}
