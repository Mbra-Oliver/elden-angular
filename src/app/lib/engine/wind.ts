import * as T from 'three';
import { HUTS, WATER, sceneryRandom } from '../constants/scenery';
import { WORLD } from '../constants/terrain-constant';

/**
 * Vent stylisé calculé dans le vertex shader : pans de pagne, bandes
 * d'étoffe nouées aux pieux et herbe
 * ondulent sans aucune mise à jour de géométrie côté CPU. Un seul uniform de
 * temps partagé par tous les matériaux, avancé par WindLayer.
 */
export const WIND = {
  time: { value: 0 },
  /** Force globale (0 = calme, 1 = brise, 2 = rafales). */
  strength: { value: 1 },
};

export interface WindOptions {
  /** Hauteur locale (axe Y) où le tissu est attaché : aucun mouvement. */
  anchor: number;
  /** Hauteur locale de l'extrémité libre : mouvement maximal. */
  tip: number;
  /** Amplitude en unités de monde à l'extrémité. */
  amplitude: number;
  /** Poids du déplacement sur X et Z locaux (Z = normale d'un plan). */
  sway: [number, number];
  /** Ondulation le long du tissu (0 pour l'herbe, ~1 pour une bande d'étoffe). */
  ripple?: number;
  speed?: number;
}

/** Greffe le vent dans le vertex shader d'un matériau standard / lambert / basic. */
export function applyWind(material: T.Material, options: WindOptions) {
  const ripple = options.ripple ?? 0;
  const speed = options.speed ?? 1;
  const key = `wind:${options.anchor}:${options.tip}:${options.amplitude}:${options.sway}:${ripple}:${speed}`;
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uWindTime'] = WIND.time;
    shader.uniforms['uWindStrength'] = WIND.strength;
    const f = (n: number) => n.toFixed(4);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uWindTime;
uniform float uWindStrength;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float windMask = clamp((position.y - ${f(options.anchor)}) / (${f(options.tip - options.anchor)}), 0.0, 1.0);
  windMask *= windMask;
  vec4 windWorld = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    windWorld = instanceMatrix * windWorld;
  #endif
  windWorld = modelMatrix * windWorld;
  float windPhase = windWorld.x * 0.031 + windWorld.z * 0.023;
  float windT = uWindTime * ${f(speed)};
  float gust = 0.65 + 0.35 * sin(windT * 0.37 + windPhase * 0.4);
  float wave = sin(windT * 2.1 + windPhase) + 0.45 * sin(windT * 3.7 + windPhase * 1.9);
  wave += ${f(ripple)} * sin(windT * 6.0 - position.y * 0.55 + windPhase);
  float windAmount = wave * gust * uWindStrength * ${f(options.amplitude)} * windMask;
  transformed.x += windAmount * ${f(options.sway[0])};
  transformed.z += windAmount * ${f(options.sway[1])} + abs(windAmount) * ${f(options.sway[1] * 0.35)};
}`);
  };
  material.needsUpdate = true;
  return material;
}

/** Nom des pans de tissu (pagne rejeté sur l'épaule) que la course soulève. */
export const WIND_CLOTH = 'wind-cloth';

/** Touffes d'herbe instanciées sur tout le terrain, hors eau et cases. */
export function plantGrass(scene: T.Scene, tufts = 1100) {
  const blades: number[] = [];
  const random = sceneryRandom(4471);
  for (let b = 0; b < 5; b++) {
    const angle = b * 2.4;
    const ox = Math.cos(angle) * (0.6 + b * 0.5);
    const oz = Math.sin(angle) * (0.6 + b * 0.5);
    const height = 3.2 + random() * 2.6;
    const lean = (random() - 0.5) * 1.6;
    const wx = Math.cos(angle + 1.57) * 0.7;
    const wz = Math.sin(angle + 1.57) * 0.7;
    blades.push(ox - wx, 0, oz - wz, ox + wx, 0, oz + wz, ox + lean, height, oz + lean * 0.5);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(blades, 3));
  geometry.computeVertexNormals();
  const material = applyWind(new T.MeshLambertMaterial({ side: T.DoubleSide }),
    { anchor: 0, tip: 6, amplitude: 1.3, sway: [1, 0.6], speed: 1.1 });
  const grass = new T.InstancedMesh(geometry, material, tufts);
  const place = new T.Object3D();
  const palette = ['#7d8f4f', '#93995a', '#67793f', '#a29a5e'].map((c) => new T.Color(c));
  const blocked = (x: number, y: number) =>
    WATER.some((w) => x > w.x - 6 && x < w.x + w.w + 6 && y > w.y - 6 && y < w.y + w.h + 6) ||
    HUTS.some(([hx, hy, r]) => (x - hx) ** 2 + (y - hy - 5) ** 2 < (r + 4) ** 2);
  let count = 0;
  for (let attempt = 0; attempt < tufts * 3 && count < tufts; attempt++) {
    // Regroupées en plaques : plus naturel qu'une répartition uniforme.
    const patch = Math.floor(random() * 140);
    const px = sceneryRandom(patch * 97 + 3)() * WORLD.WIDTH;
    const py = sceneryRandom(patch * 61 + 11)() * WORLD.HEIGHT;
    const x = px + (random() - 0.5) * 150;
    const y = py + (random() - 0.5) * 110;
    if (x < 0 || y < 0 || x > WORLD.WIDTH || y > WORLD.HEIGHT || blocked(x, y)) continue;
    place.position.set(x, 0, y);
    place.rotation.set(0, random() * Math.PI * 2, 0);
    place.scale.set(0.9 + random() * 0.5, 0.75 + random() * 0.45, 0.9 + random() * 0.5);
    place.updateMatrix();
    grass.setMatrixAt(count, place.matrix);
    grass.setColorAt(count, palette[count % palette.length]);
    count++;
  }
  grass.count = count;
  grass.name = 'wind-grass';
  scene.add(grass);
  return grass;
}

/**
 * Couche de scène : avance le temps du vent et soulève vers l'arrière le pan
 * de pagne rejeté sur l'épaule quand son porteur court (un calcul CPU par pan).
 */
export class WindLayer {
  private readonly cloths: { mesh: T.Object3D; last: T.Vector3; lift: number }[] = [];
  private readonly scratch = new T.Vector3();
  private readonly back = new T.Vector3();
  private readonly turn = new T.Quaternion();

  constructor(scene: T.Scene) {
    scene.traverse((object) => {
      if (object.name === WIND_CLOTH) {
        this.cloths.push({ mesh: object, last: object.getWorldPosition(new T.Vector3()), lift: 0 });
      }
    });
  }

  update(dt: number) {
    WIND.time.value += dt;
    if (dt <= 0) return;
    for (const cloth of this.cloths) {
      const now = cloth.mesh.getWorldPosition(this.scratch);
      const parent = cloth.mesh.parent;
      let lift = 0;
      if (parent) {
        // Vitesse projetée sur l'arrière du porteur : le pan se soulève.
        this.back.set(0, 0, -1).applyQuaternion(parent.getWorldQuaternion(this.turn));
        const vx = (now.x - cloth.last.x) / dt;
        const vz = (now.z - cloth.last.z) / dt;
        lift = Math.max(0, -(vx * this.back.x + vz * this.back.z)) / 220;
      }
      cloth.lift += (Math.min(lift, 0.8) - cloth.lift) * (1 - Math.exp(-6 * dt));
      cloth.mesh.rotation.x = 0.12 + cloth.lift;
      cloth.last.copy(now);
    }
  }

  dispose() {
    this.cloths.length = 0;
  }
}
