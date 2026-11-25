import * as T from 'three';
import type { TracePoint } from './async-world.backend';
import { AsyncWorldService, TRACE_STEP } from './async-world.service';

const MAX_STAINS = 16;
const MAX_MESSAGES = 40;
const WHITE_GHOSTS = 3;
const GHOST_PAUSE = 2.5; // s d'absence entre deux boucles

interface Phantom {
  root: T.Group;
  body: T.Group;
  legs: T.Group[];
  walk: number;
}

/**
 * Couche 3D du monde asynchrone : taches de sang (disques rouges), messages
 * (signes tracés au kaolin blanc, comme les marques d'argile des sanctuaires), fantômes blancs qui rejouent d'autres passages et
 * fantôme rouge qui rejoue une mort. Tout est préalloué : instanciation pour
 * les marques au sol, quatre silhouettes réutilisées, aucune allocation par
 * image.
 */
export class AsyncWorld3D {
  private readonly group = new T.Group();
  private readonly stains: T.InstancedMesh<T.CircleGeometry, T.MeshBasicMaterial>;
  private readonly runes: T.InstancedMesh<T.PlaneGeometry, T.MeshBasicMaterial>;
  private readonly runeTexture: T.CanvasTexture;
  private readonly whiteMaterial = new T.MeshBasicMaterial({
    color: '#e9f3ff', transparent: true, opacity: 0.3, depthWrite: false, blending: T.AdditiveBlending,
  });
  private readonly redMaterial = new T.MeshBasicMaterial({
    color: '#ff3b2a', transparent: true, opacity: 0.45, depthWrite: false, blending: T.AdditiveBlending,
  });
  private readonly whites: Phantom[] = [];
  private readonly red: Phantom;
  private readonly offsets: number[] = [];
  private readonly object = new T.Object3D();
  private revision = -1;
  private clock = 0;

  constructor(private readonly scene: T.Scene, private readonly world: AsyncWorldService) {
    this.stains = new T.InstancedMesh(new T.CircleGeometry(6, 14),
      new T.MeshBasicMaterial({ color: '#b0120c', transparent: true, opacity: 0.75, depthWrite: false }), MAX_STAINS);
    this.runeTexture = this.makeRuneTexture();
    this.runes = new T.InstancedMesh(new T.PlaneGeometry(11, 11),
      new T.MeshBasicMaterial({
        map: this.runeTexture, transparent: true, depthWrite: false, color: '#f1ebdd',
      }), MAX_MESSAGES);
    for (const mesh of [this.stains, this.runes]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }
    for (let i = 0; i < WHITE_GHOSTS; i++) this.whites.push(this.makePhantom(this.whiteMaterial));
    this.red = this.makePhantom(this.redMaterial);
    scene.add(this.group);
  }

  update(dt: number) {
    this.clock += dt;
    if (this.world.revision !== this.revision) this.rebuild();
    const pulse = 0.5 + Math.sin(this.clock * 2.4) * 0.5;
    this.stains.material.opacity = 0.55 + pulse * 0.3;
    // Le kaolin ne luit pas : à peine une respiration pour qu'on le remarque.
    this.runes.material.opacity = 0.8 + pulse * 0.12;

    this.whites.forEach((phantom, i) => {
      const ghost = this.world.ghosts[i];
      if (!ghost || ghost.path.length < 2) {
        phantom.root.visible = false;
        return;
      }
      const length = (ghost.path.length - 1) * TRACE_STEP;
      const t = (this.clock + this.offsets[i]) % (length + GHOST_PAUSE);
      if (t > length) {
        phantom.root.visible = false;
        return;
      }
      const fade = Math.min(1, t / 0.6, (length - t) / 0.6);
      this.pose(phantom, ghost.path, t, dt);
      phantom.root.visible = true;
      phantom.root.scale.setScalar(0.94 + fade * 0.06);
    });

    const replay = this.world.replay;
    if (!replay || replay.stain.path.length < 2) {
      this.red.root.visible = false;
      return;
    }
    const path = replay.stain.path;
    const length = (path.length - 1) * TRACE_STEP;
    const t = (performance.now() - replay.startedAt) / 1000;
    if (t > length + 1.6) {
      this.world.replay = null;
      this.red.root.visible = false;
      return;
    }
    this.pose(this.red, path, Math.min(t, length), dt);
    // Chute finale : le fantôme bascule puis s'efface.
    const fall = T.MathUtils.clamp((t - length) / 0.5, 0, 1);
    this.red.body.rotation.x = fall * 1.45;
    this.red.body.position.y = 0;
    this.redMaterial.opacity = 0.5 * (1 - T.MathUtils.clamp((t - length - 0.7) / 0.9, 0, 1));
    this.red.root.visible = true;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((object) => {
      if (object instanceof T.Mesh) object.geometry.dispose();
    });
    this.stains.material.dispose();
    this.runes.material.dispose();
    this.runeTexture.dispose();
    this.whiteMaterial.dispose();
    this.redMaterial.dispose();
  }

  private rebuild() {
    this.revision = this.world.revision;
    const stains = this.world.stains.slice(-MAX_STAINS);
    stains.forEach((stain, i) => {
      this.object.position.set(stain.x, 0.32, stain.y);
      this.object.rotation.set(-Math.PI / 2, 0, (i * 2.39) % (Math.PI * 2));
      this.object.scale.set(1 + (i % 3) * 0.12, 0.8 + (i % 2) * 0.25, 1);
      this.object.updateMatrix();
      this.stains.setMatrixAt(i, this.object.matrix);
    });
    this.stains.count = stains.length;
    this.stains.instanceMatrix.needsUpdate = true;

    const messages = this.world.messages.slice(-MAX_MESSAGES);
    messages.forEach((message, i) => {
      this.object.position.set(message.x, 0.38, message.y);
      this.object.rotation.set(-Math.PI / 2, 0, (i * 1.13) % (Math.PI * 2));
      this.object.scale.setScalar(1);
      this.object.updateMatrix();
      this.runes.setMatrixAt(i, this.object.matrix);
    });
    this.runes.count = messages.length;
    this.runes.instanceMatrix.needsUpdate = true;

    // Décalages pour que les fantômes ne marchent pas tous en même temps.
    this.offsets.length = 0;
    this.world.ghosts.forEach((ghost, i) => {
      this.offsets.push(i * 7.3 + (ghost.path.length % 11));
    });
  }

  private pose(phantom: Phantom, path: TracePoint[], t: number, dt: number) {
    const f = t / TRACE_STEP;
    const i = Math.min(path.length - 2, Math.floor(f));
    const a = path[i];
    const b = path[i + 1];
    const k = f - i;
    const x = a.x + (b.x - a.x) * k;
    const y = a.y + (b.y - a.y) * k;
    const moved = Math.hypot(x - phantom.root.position.x, y - phantom.root.position.z);
    phantom.root.position.set(x, 0, y);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const facing = Math.hypot(dx, dy) > 1 ? Math.atan2(dx, dy) : Math.atan2(a.fx, a.fy);
    const turn = facing - phantom.root.rotation.y;
    phantom.root.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * (1 - Math.exp(-10 * dt));
    phantom.walk += Math.min(moved, 6) * 0.22;
    const swing = Math.sin(phantom.walk) * Math.min(1, moved * 2);
    phantom.legs[0].rotation.x = swing * 0.7;
    phantom.legs[1].rotation.x = -swing * 0.7;
    const action = (k < 0.5 ? a : b).a;
    phantom.body.rotation.x = action === 2 ? 0.9 : action === 1 ? -0.25 : 0;
    phantom.body.position.y = action === 2 ? -5 : Math.abs(swing) * 0.5;
  }

  private makePhantom(material: T.Material): Phantom {
    const root = new T.Group();
    const body = new T.Group();
    const add = (parent: T.Group, geometry: T.BufferGeometry, x: number, y: number, z: number) => {
      const mesh = new T.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.renderOrder = 3;
      parent.add(mesh);
      return mesh;
    };
    root.add(body);
    add(body, new T.CylinderGeometry(4.6, 3.6, 15, 7), 0, 21, 0);
    add(body, new T.SphereGeometry(3.3, 8, 6), 0, 32, 0.4);
    const spear = add(body, new T.CylinderGeometry(0.45, 0.45, 34, 5), 5.5, 22, 4);
    spear.rotation.x = Math.PI / 2 - 0.35;
    const legs: T.Group[] = [];
    for (const side of [-1, 1]) {
      const leg = new T.Group();
      leg.position.set(side * 2.4, 14, 0);
      add(leg, new T.CylinderGeometry(1.5, 1.1, 13, 5), 0, -6.5, 0);
      root.add(leg);
      legs.push(leg);
    }
    root.visible = false;
    this.group.add(root);
    return { root, body, legs, walk: 0 };
  }

  private makeRuneTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    // Glyphe inspiré des motifs adinkra : spirale et quatre branches.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 3.2; a += 0.2) {
      const r = 2 + a * 1.6;
      const px = 32 + Math.cos(a) * r;
      const py = 32 + Math.sin(a) * r;
      if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      ctx.moveTo(32 + Math.cos(a) * 20, 32 + Math.sin(a) * 20);
      ctx.lineTo(32 + Math.cos(a) * 27, 32 + Math.sin(a) * 27);
    }
    ctx.stroke();
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    return texture;
  }
}
