import * as T from 'three';
import { WIND_CLOTH, applyWind } from './wind';

/**
 * Vêtements akan du XIXᵉ siècle posés sur le rig humanoïde partagé
 * (repère du torse : avant = +Z, droite = +X, le torse est à 16 du sol).
 *
 * - Toge : grand pagne (kente ou adinkra) enroulé autour du corps, le pan
 *   rejeté sur l'épaule gauche et tombant dans le dos. Seul ce pan suit le
 *   vent et la course. Les hommes laissent l'épaule et le flanc droits
 *   découverts ; les femmes nouent le pagne sous les bras (épaules nues) et
 *   portent un foulard de tête.
 * - Batakari : blouse de guerre évasée en bandes tissées, couverte de
 *   talismans de cuir cousus (portée par les capitaines asafo).
 *
 * Les pièces marquées `underBatakari` sont masquées quand le joueur porte le
 * batakari ramassé (equipment-3d) : elles le traverseraient.
 *
 * Les pièces ne reçoivent pas de contour (attack-readability-3d) : le contour
 * ne suivrait pas l'ondulation du vent et un cylindre ouvert le rend mal.
 */

export interface KentePalette {
  /** Couleur de chaîne des blocs « à rayures ». */
  base: string;
  /** Couleurs des blocs pleins tissés en trame, en alternance. */
  weft: string[];
  /** Fines rayures de chaîne. */
  stripe: string;
}

/** Kente du joueur : or, vert et rouge sur fond noir (couleurs courantes du kente ashanti). */
export const KENTE_PLAYER: KentePalette = { base: '#1d1712', weft: ['#d8a23a', '#2f6b4a', '#b0372a'], stripe: '#d8a23a' };

const textures = new Map<string, T.CanvasTexture>();

function canvasTexture(key: string, draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
  const cached = textures.get(key);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = T.NearestFilter;
  textures.set(key, texture);
  return texture;
}

/**
 * Kente : bandes étroites cousues bord à bord ; chaque bande alterne blocs à
 * rayures de chaîne et blocs pleins de trame, décalés d'une bande à l'autre.
 */
export function kenteTexture(p: KentePalette) {
  return canvasTexture(`kente:${p.base}:${p.weft.join()}:${p.stripe}`, (ctx, size) => {
    const strips = 8;
    const blocks = 6;
    const w = size / strips;
    const h = size / blocks;
    for (let s = 0; s < strips; s++) {
      for (let b = 0; b < blocks; b++) {
        const x = s * w;
        const y = b * h;
        if ((s + b) % 2 === 0) {
          ctx.fillStyle = p.base;
          ctx.fillRect(x, y, w, h);
          ctx.fillStyle = p.stripe;
          for (let i = 2; i < w; i += 4) ctx.fillRect(x + i, y, 1, h);
        } else {
          ctx.fillStyle = p.weft[(s + b) % p.weft.length];
          ctx.fillRect(x, y, w, h);
          ctx.fillStyle = p.base;
          for (let i = 3; i < h; i += 5) ctx.fillRect(x, y + i, w, 1);
          ctx.fillRect(x + w / 2 - 2, y + h / 2 - 2, 4, 4);
        }
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let s = 1; s < strips; s++) ctx.fillRect(s * w, 0, 1, size);
  });
}

/**
 * Adinkra : étoffe unie teinte, divisée en carrés par des bandes brodées,
 * chaque carré estampé d'un motif (ici des formes simples, pas un symbole précis).
 */
export function adinkraTexture(ground: string, ink = '#1b120c') {
  return canvasTexture(`adinkra:${ground}:${ink}`, (ctx, size) => {
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, size, size);
    const cells = 4;
    const c = size / cells;
    ctx.fillStyle = ink;
    for (let i = 0; i <= cells; i++) {
      ctx.fillRect(i * c - 1, 0, 2, size);
      ctx.fillRect(0, i * c - 1, size, 2);
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < cells; j++) {
        const cx = i * c + c / 2;
        const cy = j * c + c / 2;
        ctx.beginPath();
        if ((i + j) % 2 === 0) {
          ctx.arc(cx, cy, c * 0.22, 0, Math.PI * 2);
          ctx.moveTo(cx - c * 0.3, cy);
          ctx.lineTo(cx + c * 0.3, cy);
          ctx.moveTo(cx, cy - c * 0.3);
          ctx.lineTo(cx, cy + c * 0.3);
        } else {
          ctx.moveTo(cx - c * 0.25, cy - c * 0.2);
          ctx.quadraticCurveTo(cx, cy + c * 0.35, cx + c * 0.25, cy - c * 0.2);
        }
        ctx.stroke();
      }
    }
  });
}

/** Batakari : fines bandes tissées crème et indigo, cousues verticalement. */
function batakariTexture() {
  return canvasTexture('batakari', (ctx, size) => {
    const strips = 16;
    const w = size / strips;
    for (let s = 0; s < strips; s++) {
      ctx.fillStyle = s % 2 ? '#d6c6a0' : '#c2ad82';
      ctx.fillRect(s * w, 0, w, size);
      ctx.fillStyle = '#2b3a55';
      ctx.fillRect(s * w + w / 2 - 1, 0, 2, size);
    }
  });
}

function garment(geometry: T.BufferGeometry, material: T.Material, x: number, y: number, z: number) {
  const mesh = new T.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.userData['outline'] = true;
  return mesh;
}

/**
 * Toge akan : pagne enroulé jusqu'à mi-mollet, pan sur l'épaule gauche qui
 * retombe dans le dos. `woman` : noué sous les bras et foulard de tête.
 */
export function attachToga(torso: T.Object3D, texture: T.Texture, wearer: 'man' | 'woman' = 'man') {
  const cloth = new T.MeshStandardMaterial({ map: texture, roughness: 0.95, flatShading: true, side: T.DoubleSide });
  const group = new T.Group();
  group.name = 'akan-toga';

  // Enroulement autour du corps. Homme : le bord supérieur descend en
  // diagonale de l'épaule gauche (x < 0) vers l'aisselle droite (x > 0).
  // Femme : bord droit sous les aisselles.
  const wrap = new T.CylinderGeometry(5.8, 6.3, 14, 10, 4, true);
  const position = wrap.attributes['position'] as T.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) < 6.9) continue;
    position.setY(i, wearer === 'woman' ? 5.4 : 7 - Math.max(0, position.getX(i) + 1.5) * 0.95);
  }
  wrap.computeVertexNormals();
  const body = garment(wrap, cloth, 0, 1.5, 0);
  body.userData['underBatakari'] = true;
  group.add(body);

  // Bas du pagne jusqu'à mi-mollet : l'ourlet bouge un peu avec le vent.
  const skirtMaterial = applyWind(cloth.clone(),
    { anchor: 0, tip: -5.5, amplitude: 0.5, sway: [0.6, 0.4], speed: 1.2 });
  const skirt = new T.CylinderGeometry(6.3, 6.9, 5.5, 10, 2, true).translate(0, -2.75, 0);
  group.add(garment(skirt, skirtMaterial, 0, -5.5, 0));

  // Bande qui passe sur l'épaule gauche, de la poitrine au dos.
  const band = garment(new T.BoxGeometry(3.6, 1.2, 11.6), cloth, -3.3, 9.1, 0);
  band.userData['underBatakari'] = true;
  group.add(band);

  // Pan rejeté sur l'épaule : seule pièce soulevée par la course (WindLayer).
  const length = 13;
  const tail = new T.PlaneGeometry(4, length, 1, 5).translate(0, -length / 2, 0);
  const tailMesh = garment(tail, applyWind(cloth.clone(),
    { anchor: 0, tip: -length, amplitude: 1.1, sway: [0.3, -1], ripple: 0.5, speed: 1.3 }), -3.3, 9.4, -5.6);
  tailMesh.name = WIND_CLOTH;
  tailMesh.userData['underBatakari'] = true;
  tailMesh.rotation.x = 0.12;
  group.add(tailMesh);

  if (wearer === 'woman') {
    // Foulard noué sur la tête, dans le même pagne.
    const tie = garment(new T.CylinderGeometry(3.2, 3.6, 2.6, 9), cloth, 0, 12.7, -0.4);
    tie.rotation.x = -0.28;
    group.add(tie);
  }

  torso.add(group);
  return group;
}

/**
 * Batakari de capitaine asafo : blouse évasée à mi-cuisse, encolure ronde,
 * talismans de cuir (et quelques-uns gainés de rouge) cousus devant et derrière.
 */
export function attachBatakari(torso: T.Object3D) {
  const group = new T.Group();
  group.name = 'akan-batakari';
  const cloth = new T.MeshStandardMaterial({
    map: batakariTexture(), roughness: 0.95, flatShading: true, side: T.DoubleSide,
  });
  const smock = new T.CylinderGeometry(5.8, 8.2, 17, 10, 3, true);
  const hem = applyWind(cloth, { anchor: 2, tip: -8.5, amplitude: 0.45, sway: [0.5, 0.5], speed: 1.1 });
  group.add(garment(smock, hem, 0, 0, 0));
  // Épaules couvertes : petit cône plat qui ferme le haut de la blouse.
  const yoke = new T.CylinderGeometry(2.6, 5.9, 1.2, 10);
  group.add(garment(yoke, new T.MeshStandardMaterial({ map: batakariTexture(), roughness: 0.95, flatShading: true }), 0, 9, 0));

  const leather = new T.MeshStandardMaterial({ color: '#4a2f1c', roughness: 0.8, flatShading: true });
  const red = new T.MeshStandardMaterial({ color: '#9a2f26', roughness: 0.85, flatShading: true });
  const charm = new T.BoxGeometry(1.3, 1.6, 0.7);
  const rows: [number, number][] = [[6.5, 5.9], [3, 6.6], [-0.5, 7.2], [-4, 7.8]];
  let n = 0;
  for (const [y, radius] of rows) {
    for (const angle of [-0.75, -0.25, 0.25, 0.75]) {
      for (const face of [0, Math.PI]) {
        const a = angle + face;
        const box = garment(charm, n++ % 5 === 0 ? red : leather,
          Math.sin(a) * (radius + 0.2), y, Math.cos(a) * (radius + 0.2));
        box.rotation.y = a;
        group.add(box);
      }
    }
  }
  torso.add(group);
  return group;
}
