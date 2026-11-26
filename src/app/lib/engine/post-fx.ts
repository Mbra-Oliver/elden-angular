import * as T from 'three';
import { POST_FX } from '../constants/immersion.config-constant';
import type { GraphicsQuality } from '../platform/settings.service';

/** Calque des objets qui brillent (bloom) et calque des occulteurs opaques. */
export const BLOOM_LAYER = 1;
const OCCLUDER_LAYER = 2;
/** Le calque de bloom est recalculé à cette cadence (s) : nouveaux effets, matériaux qui changent. */
const RESCAN_EVERY = 0.75;
/**
 * Images entre deux recalculs du halo selon la qualité (0 : pas de halo).
 * Le halo redessine toute la scène une seconde fois (occulteurs) : en
 * qualité moyenne on le recalcule une image sur deux et on réutilise le
 * tampon flouté entre-temps (invisible à 60 i/s) ; en basse, il est coupé.
 */
const BLOOM_INTERVAL: Record<GraphicsQuality, number> = { low: 0, medium: 2, high: 1 };

/**
 * Post-traitement léger, pensé pour le web :
 *
 * - Bloom sélectif : seuls les objets émissifs (flammes, reflets d'eau, étincelles,
 *   éclats, cœur du Gardien) brillent. La scène est rendue normalement à
 *   l'écran (antialiasing natif conservé), puis on rend en quart de
 *   résolution les occulteurs en noir et les émissifs par-dessus, on floute
 *   ce petit tampon et on l'ajoute à l'image.
 * - Vignette sombre qui bat comme un cœur quand le joueur passe sous 20 % de PV.
 *
 * Un seul quad plein écran fait la composition (bloom + vignette), avec un
 * mélange `ONE, ONE_MINUS_SRC_ALPHA`. Rien n'est alloué par image.
 *
 * Est émissif : un objet avec `userData.bloom = true`, des Points ou Sprites
 * en mélange additif, ou un matériau Standard dont l'émissif est vif.
 * `userData.bloom = false` exclut un objet.
 */
export class PostFx {
  private readonly bloomA: T.WebGLRenderTarget;
  private readonly bloomB: T.WebGLRenderTarget;
  private readonly black = new T.MeshBasicMaterial({ color: '#000000', fog: false });
  private readonly blur: T.ShaderMaterial;
  private readonly composite: T.ShaderMaterial;
  private readonly quad: T.Mesh;
  private readonly quadScene = new T.Scene();
  private readonly quadCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly clear = new T.Color();
  private readonly texel = new T.Vector2();
  private readonly glowing: T.Object3D[] = [];
  private rescan = 0;
  private vignette = 0;
  private time = 0;
  private bloomInterval = 1;
  private bloomFrame = 0;
  /** Le tampon de halo contient une image valide (sinon on le recalcule avant de l'afficher). */
  private bloomReady = false;

  /** Qualité graphique (Paramètres) : fréquence du halo. */
  setQuality(quality: GraphicsQuality) {
    const interval = BLOOM_INTERVAL[quality] ?? 1;
    if (interval === this.bloomInterval) return;
    this.bloomInterval = interval;
    this.bloomReady = false;
  }

  /** Rapport largeur/hauteur de l'écran de jeu (vignette ronde sur tout format). */
  setAspect(aspect: number) {
    this.composite.uniforms['aspect'].value = aspect;
  }

  /** Garde les tampons de bloom alignés sur le canvas quand le format change. */
  setSize(width: number, height: number) {
    const w = Math.max(1, Math.ceil(width / 4));
    const h = Math.max(1, Math.ceil(height / 4));
    if (w === this.bloomA.width && h === this.bloomA.height) return;
    this.bloomReady = false;
    this.bloomA.setSize(w, h);
    this.bloomB.setSize(w, h);
    this.texel.set(1 / w, 1 / h);
  }

  constructor(private readonly renderer: T.WebGLRenderer, width: number, height: number) {
    const options = { type: T.UnsignedByteType, depthBuffer: true };
    this.bloomA = new T.WebGLRenderTarget(Math.ceil(width / 4), Math.ceil(height / 4), options);
    this.bloomB = new T.WebGLRenderTarget(Math.ceil(width / 4), Math.ceil(height / 4), { ...options, depthBuffer: false });
    this.texel.set(1 / this.bloomA.width, 1 / this.bloomA.height);

    this.blur = new T.ShaderMaterial({
      uniforms: { map: { value: null }, direction: { value: new T.Vector2() }, texel: { value: this.texel } },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec2 direction; uniform vec2 texel;
        varying vec2 vUv;
        void main() {
          vec2 step = direction * texel;
          vec3 c = texture2D(map, vUv).rgb * 0.227;
          c += (texture2D(map, vUv + step * 1.385).rgb + texture2D(map, vUv - step * 1.385).rgb) * 0.316;
          c += (texture2D(map, vUv + step * 3.231).rgb + texture2D(map, vUv - step * 3.231).rgb) * 0.070;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.composite = new T.ShaderMaterial({
      uniforms: {
        bloom: { value: this.bloomA.texture }, strength: { value: POST_FX.bloomStrength },
        bloomOn: { value: 0 }, vignette: { value: 0 }, aspect: { value: width / height },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D bloom; uniform float strength; uniform float bloomOn;
        uniform float vignette; uniform float aspect;
        varying vec2 vUv;
        void main() {
          vec3 glow = texture2D(bloom, vUv).rgb * strength * bloomOn;
          vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
          float edge = smoothstep(0.32, 0.95, length(p));
          float a = clamp(edge * vignette, 0.0, 0.92);
          // Bord rouge très sombre plutôt que noir pur : on sent le sang battre.
          gl_FragColor = vec4(glow * (1.0 - a) + vec3(0.09, 0.0, 0.0) * a, a);
        }`,
      transparent: true, depthTest: false, depthWrite: false,
      blending: T.CustomBlending, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor,
    });
    this.quad = new T.Mesh(new T.PlaneGeometry(2, 2), this.composite);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /**
   * @param hpRatio PV du joueur (0 → 1), null hors partie
   * @param dt pas de temps réel (s)
   */
  render(scene: T.Scene, camera: T.Camera, hpRatio: number | null, dt: number) {
    const renderer = this.renderer;
    renderer.render(scene, camera);
    this.time += dt;
    this.rescan -= dt;
    if (this.rescan <= 0) {
      this.rescan = RESCAN_EVERY;
      this.scan(scene);
    }

    // Vignette : apparaît sous le seuil, plus forte à mesure que la vie fond.
    const low = hpRatio === null || hpRatio <= 0 ? 0
      : T.MathUtils.clamp((POST_FX.lowHpRatio - hpRatio) / POST_FX.lowHpRatio, 0, 1);
    const target = low > 0 ? 0.55 + low * 0.45 : 0;
    this.vignette += (target - this.vignette) * (1 - Math.exp(-4 * dt));
    const beat = Math.pow(Math.max(0, Math.sin(this.time * Math.PI * 2 * (1 + low * 0.5))), 6);
    const vignette = this.vignette * (0.82 + beat * 0.3);

    const bloomOn = this.bloomInterval > 0 && this.anyGlowVisible();
    if (!bloomOn) this.bloomReady = false;
    if (!bloomOn && vignette < 0.01) return;

    if (bloomOn && (!this.bloomReady || ++this.bloomFrame >= this.bloomInterval)) {
      this.bloomFrame = 0;
      this.renderBloom(scene, camera);
      this.bloomReady = true;
    }
    this.composite.uniforms['bloomOn'].value = bloomOn ? 1 : 0;
    this.composite.uniforms['vignette'].value = vignette;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
    renderer.autoClear = autoClear;
  }

  /**
   * À appeler pendant le préchauffage, objets cachés rendus visibles : les
   * émissifs rendus dans le tampon de bloom (espace linéaire, demi-flottant)
   * et le matériau noir des occulteurs sont des variantes de shader à part,
   * qui sinon se compileraient au premier éclat en plein combat.
   */
  warm(scene: T.Scene, camera: T.Camera) {
    this.scan(scene);
    this.rescan = RESCAN_EVERY;
    this.renderBloom(scene, camera);
    this.composite.uniforms['bloomOn'].value = 1;
    this.composite.uniforms['vignette'].value = 0;
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
    this.renderer.autoClear = autoClear;
  }

  private renderBloom(scene: T.Scene, camera: T.Camera) {
    const renderer = this.renderer;
    const background = scene.background;
    const mask = camera.layers.mask;
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    scene.background = null;
    renderer.setClearColor(0x000000, 1);

    // 1. Occulteurs opaques en noir (un seul matériau : pas de changement de shader).
    renderer.setRenderTarget(this.bloomA);
    renderer.clear();
    camera.layers.set(OCCLUDER_LAYER);
    scene.overrideMaterial = this.black;
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    // 2. Émissifs par-dessus, avec leur propre matériau, sans effacer la profondeur.
    camera.layers.set(BLOOM_LAYER);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = autoClear;

    camera.layers.mask = mask;
    scene.background = background;
    renderer.setClearColor(this.clear, clearAlpha);

    // 3. Flou séparable, deux passes de rayon croissant.
    this.quad.material = this.blur;
    for (const radius of [1, 2.2]) {
      this.blurPass(this.bloomA, this.bloomB, radius, 0);
      this.blurPass(this.bloomB, this.bloomA, 0, radius);
    }
    this.quad.material = this.composite;
  }

  private blurPass(from: T.WebGLRenderTarget, to: T.WebGLRenderTarget, x: number, y: number) {
    this.blur.uniforms['map'].value = from.texture;
    this.blur.uniforms['direction'].value.set(x, y);
    this.renderer.setRenderTarget(to);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  /** Classe les objets de la scène : émissifs (bloom) ou occulteurs opaques. */
  private scan(scene: T.Scene) {
    this.glowing.length = 0;
    scene.traverse((object) => {
      const glow = isGlowing(object);
      if (glow) {
        object.layers.enable(BLOOM_LAYER);
        this.glowing.push(object);
      } else object.layers.disable(BLOOM_LAYER);
      if (!glow && object instanceof T.Mesh && isOpaque(object.material)) object.layers.enable(OCCLUDER_LAYER);
      else object.layers.disable(OCCLUDER_LAYER);
    });
  }

  private anyGlowVisible() {
    for (const object of this.glowing) {
      let node: T.Object3D | null = object;
      while (node && node.visible) node = node.parent;
      if (!node) return true;
    }
    return false;
  }

  dispose() {
    this.bloomA.dispose();
    this.bloomB.dispose();
    this.black.dispose();
    this.blur.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
  }
}

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function isOpaque(material: T.Material | T.Material[]) {
  const m = Array.isArray(material) ? material[0] : material;
  return !!m && !m.transparent && m.depthWrite;
}

function isGlowing(object: T.Object3D) {
  const flag = object.userData['bloom'];
  if (flag !== undefined) return !!flag;
  if (!(object instanceof T.Mesh || object instanceof T.Points || object instanceof T.Sprite)) return false;
  const material = Array.isArray(object.material) ? object.material[0] : object.material;
  if (!material) return false;
  if ((object instanceof T.Points || object instanceof T.Sprite) && material.blending === T.AdditiveBlending) return true;
  if (material instanceof T.MeshStandardMaterial) {
    const e = material.emissive;
    return Math.max(e.r, e.g, e.b) * material.emissiveIntensity > 0.12;
  }
  return false;
}
