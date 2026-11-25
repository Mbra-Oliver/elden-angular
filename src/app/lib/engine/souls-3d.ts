import * as T from 'three';
import { PALETTE } from '../constants/landscape';
import { FOYERS } from '../constants/souls-world';
import type { CaurisStash } from '../services/souls-loop.service';

/**
 * Vue 3D de la boucle soulslike : le foyer du gué (les feux du Goli et de la
 * digue sont posés par slice-3d.ts) et la tache de cauris laissée à la mort,
 * signalée par une colonne de lumière visible de loin.
 */
export class Souls3D {
  private readonly root = new T.Group();
  private readonly flame: T.Mesh;
  private readonly beacon = new T.Group();
  private readonly shaft: T.Mesh<T.CylinderGeometry, T.MeshBasicMaterial>;
  private readonly shells: T.InstancedMesh;
  private time = 0;

  constructor(private readonly scene: T.Scene, private readonly stash: () => CaurisStash | null) {
    const foyer = FOYERS.gue;
    const fire = new T.Group();
    fire.position.set(foyer.x, 0, foyer.y);
    const stone = new T.MeshStandardMaterial({ color: PALETTE.stone, roughness: 1, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      const rock = new T.Mesh(new T.DodecahedronGeometry(2.3, 0), stone);
      rock.position.set(Math.cos(a) * 7, 1.2, Math.sin(a) * 7);
      fire.add(rock);
    }
    const wood = new T.MeshStandardMaterial({ color: PALETTE.wood, roughness: 1, flatShading: true });
    for (let i = 0; i < 3; i++) {
      const log = new T.Mesh(new T.CylinderGeometry(0.9, 0.9, 11, 5), wood);
      log.rotation.set(Math.PI / 2 - 0.35, i * 2.1, 0);
      log.position.y = 2.2;
      fire.add(log);
    }
    this.flame = new T.Mesh(new T.ConeGeometry(3.6, 11, 6),
      new T.MeshBasicMaterial({ color: PALETTE.ember, transparent: true, opacity: 0.88, depthWrite: false }));
    this.flame.position.y = 7;
    this.flame.userData['bloom'] = true;
    fire.add(this.flame);
    this.root.add(fire);

    // Tache de cauris : coquillages au sol + colonne de lumière.
    this.shaft = new T.Mesh(new T.CylinderGeometry(5, 9, 150, 10, 1, true),
      new T.MeshBasicMaterial({
        color: '#bff3df', transparent: true, opacity: 0.22, depthWrite: false,
        blending: T.AdditiveBlending, side: T.DoubleSide, fog: false,
      }));
    this.shaft.position.y = 75;
    this.shaft.userData['bloom'] = true;
    this.shells = new T.InstancedMesh(new T.SphereGeometry(1, 6, 4),
      new T.MeshStandardMaterial({ color: '#f1e9d2', emissive: '#5e8f80', roughness: 0.6 }), 14);
    const place = new T.Object3D();
    for (let i = 0; i < 14; i++) {
      const a = i * 2.39;
      const d = 1.5 + (i % 5) * 1.6;
      place.position.set(Math.cos(a) * d, 0.6, Math.sin(a) * d);
      place.scale.set(1.3, 0.6, 0.9);
      place.rotation.y = a;
      place.updateMatrix();
      this.shells.setMatrixAt(i, place.matrix);
    }
    this.beacon.add(this.shaft, this.shells);
    this.root.add(this.beacon);
    scene.add(this.root);
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    const flicker = 0.85 + Math.sin(t * 17) * 0.1 + Math.sin(t * 7.3) * 0.08;
    this.flame.scale.set(flicker, flicker * 1.15, flicker);
    const stash = this.stash();
    this.beacon.visible = !!stash;
    if (stash) {
      this.beacon.position.set(stash.x, 0, stash.y);
      this.shaft.material.opacity = 0.16 + Math.sin(t * 2.4) * 0.06;
      this.shaft.rotation.y = t * 0.4;
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((object) => {
      if (object instanceof T.Mesh) {
        object.geometry.dispose();
        (object.material as T.Material).dispose();
      }
    });
  }
}
