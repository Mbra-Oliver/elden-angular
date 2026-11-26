import * as T from 'three';
import { AsyncWorldService } from './async-world.service';

const MAX_MESSAGES = 40;

/**
 * Couche 3D du monde partagé : messages au sol (signes tracés au kaolin
 * blanc, comme les marques d'argile des sanctuaires). Une seule instanciation
 * préallouée, reconstruite seulement quand les données de zone changent.
 * Les fantômes et taches de sang des anciens joueurs ont été retirés.
 */
export class AsyncWorld3D {
  private readonly runes: T.InstancedMesh<T.PlaneGeometry, T.MeshBasicMaterial>;
  private readonly runeTexture: T.CanvasTexture;
  private readonly object = new T.Object3D();
  private revision = -1;
  private clock = 0;

  constructor(private readonly scene: T.Scene, private readonly world: AsyncWorldService) {
    this.runeTexture = this.makeRuneTexture();
    this.runes = new T.InstancedMesh(new T.PlaneGeometry(11, 11),
      new T.MeshBasicMaterial({
        map: this.runeTexture, transparent: true, depthWrite: false, color: '#f1ebdd',
      }), MAX_MESSAGES);
    this.runes.count = 0;
    this.runes.frustumCulled = false;
    this.runes.renderOrder = 2;
    scene.add(this.runes);
  }

  /** Compilés par World3D.addLayer au chargement (pas d'à-coup à la première apparition). */
  get warmables(): T.Object3D[] {
    return [this.runes];
  }

  get textures(): T.Texture[] {
    return [this.runeTexture];
  }

  update(dt: number) {
    if (this.world.revision !== this.revision) this.rebuild();
    if (this.runes.count === 0) return;
    this.clock += dt;
    // Le kaolin ne luit pas : à peine une respiration pour qu'on le remarque.
    this.runes.material.opacity = 0.8 + (0.5 + Math.sin(this.clock * 2.4) * 0.5) * 0.12;
  }

  dispose() {
    this.scene.remove(this.runes);
    this.runes.geometry.dispose();
    this.runes.material.dispose();
    this.runes.dispose();
    this.runeTexture.dispose();
  }

  private rebuild() {
    this.revision = this.world.revision;
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
