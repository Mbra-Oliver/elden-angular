import * as T from 'three';
import { bakeHuman, coloredGeometry } from './human-bake';
import { kwadwoOutfit } from './human-outfits';
import type { HumanoidRig } from './humanoid-rig';
import { devicePixelRatioCapped } from '../platform/display';

/**
 * Arrière-plan vivant du menu principal : la crête de Feyiase la nuit, une
 * afena plantée dans la terre rouge à côté d'un brasero, braises et fumée qui
 * dérivent, et Kwadwo Ofori agenouillé dans la cendre au fond du plan.
 * Scène autonome et légère (aucune ombre portée, une seule lumière dynamique)
 * : elle tient 60 images/s sur téléphone. Chargée à la demande (three.js reste
 * hors du bundle initial).
 *
 * [SUPPOSITION] Couleurs, positions et durées choisies à l'œil.
 */

const AFENA = new T.Vector3(0.3, 0, 0.05);
const BRAZIER = new T.Vector3(-0.55, 0, -1.25);
const KWADWO = new T.Vector3(-1.85, 0, -2.35);
/** Plan de repos : au ras du sol, l'afena au premier plan. */
const REST_EYE = new T.Vector3(1.25, 0.32, 2.05);
const REST_LOOK = new T.Vector3(-1.25, 0.6, -0.95);
/** Fin du travelling : face à Kwadwo, à hauteur de son regard. */
const END_EYE = new T.Vector3(-0.95, 0.92, -0.55);
const END_LOOK = new T.Vector3(-1.85, 0.62, -2.35);
const TRAVEL_SECONDS = 9.6;

const EMBERS = 140;

export class MenuScene3D {
  private readonly renderer: T.WebGLRenderer;
  private readonly scene = new T.Scene();
  private readonly camera = new T.PerspectiveCamera(42, 16 / 9, 0.05, 140);
  private readonly clock = new T.Clock();
  private readonly fireLight: T.PointLight;
  private readonly flames: T.Mesh[] = [];
  private readonly embers: T.Points;
  private readonly emberVelocity = new Float32Array(EMBERS * 3);
  private readonly emberLife = new Float32Array(EMBERS);
  private readonly smoke: T.Sprite[] = [];
  private readonly kwadwoChest: T.Object3D;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly pointer = new T.Vector2();
  private readonly look = new T.Vector3();
  private frame = 0;
  private time = 0;
  private travel: { t: number; done: () => void; path: T.CatmullRomCurve3 } | null = null;
  private travelled = false;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(devicePixelRatioCapped());
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    host.prepend(canvas);

    this.scene.background = new T.Color('#06070c');
    this.scene.fog = new T.FogExp2('#140c0b', 0.075);

    this.scene.add(new T.HemisphereLight('#3a4a6e', '#1a0c08', 0.55));
    const moon = new T.DirectionalLight('#9fb4e0', 0.55);
    moon.position.set(-8, 10, -14);
    this.scene.add(moon);
    // Lueur froide côté caméra : l'afena et Kwadwo ne sont pas que des silhouettes.
    const fill = new T.DirectionalLight('#6f7fae', 0.5);
    fill.position.set(4, 3, 6);
    this.scene.add(fill);
    this.fireLight = new T.PointLight('#ff8a3a', 9, 9, 1.7);
    this.fireLight.position.copy(BRAZIER).add(new T.Vector3(0, 0.55, 0));
    this.scene.add(this.fireLight);
    // Contre-jour de la vallée en flammes, rasant, derrière Kwadwo.
    const valley = new T.PointLight('#c2401c', 6, 30, 1.2);
    valley.position.set(-6, 1.2, -12);
    this.scene.add(valley);

    this.buildSky();
    this.buildRidge();
    this.buildAfena();
    this.buildBrazier();
    this.kwadwoChest = this.buildKwadwo();
    this.embers = this.buildEmbers();
    this.buildSmoke();

    this.camera.position.copy(REST_EYE);
    this.look.copy(REST_LOOK);
    this.camera.lookAt(this.look);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    window.addEventListener('pointermove', this.onPointer);
    window.addEventListener('resize', this.onResize);
    this.renderer.compile(this.scene, this.camera);
    this.loop();
  }

  /**
   * Travelling sans coupure de l'afena jusqu'à Kwadwo. `done` est appelé à
   * l'arrivée (le jeu prend alors la main).
   */
  travelToKwadwo(done: () => void) {
    if (this.travel || this.travelled) return;
    const from = this.camera.position.clone();
    const path = new T.CatmullRomCurve3([
      from,
      new T.Vector3(0.95, 0.42, 1.0),
      new T.Vector3(-0.35, 0.6, -0.2),
      END_EYE.clone(),
    ], false, 'centripetal');
    this.travel = { t: 0, done, path };
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    window.removeEventListener('pointermove', this.onPointer);
    window.removeEventListener('resize', this.onResize);
    this.scene.traverse((object) => {
      const mesh = object as T.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as T.Material | T.Material[] | undefined;
      (Array.isArray(material) ? material : material ? [material] : []).forEach((m) => m.dispose());
    });
    this.disposables.forEach((d) => d.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly onPointer = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    this.pointer.set(event.clientX / window.innerWidth - 0.5, event.clientY / window.innerHeight - 0.5);
  };

  /** Qualité changée dans les Paramètres, rotation : la densité est relue. */
  private readonly onResize = () => this.resize();

  private resize() {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(devicePixelRatioCapped());
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Écrans très allongés (20:9) : on garde le même cadrage vertical.
    this.camera.fov = width / height > 2 ? 38 : 42;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    this.animateFire(dt);
    this.animateEmbers(dt);
    this.animateSmoke(dt);
    // Respiration lourde de Kwadwo.
    this.kwadwoChest.scale.set(1 + Math.sin(this.time * 1.7) * 0.025, 1, 1 + Math.sin(this.time * 1.7) * 0.04);
    this.moveCamera(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private moveCamera(dt: number) {
    const travel = this.travel;
    if (travel) {
      travel.t = Math.min(1, travel.t + dt / TRAVEL_SECONDS);
      const k = travel.t < 0.5 ? 4 * travel.t ** 3 : 1 - (-2 * travel.t + 2) ** 3 / 2;
      travel.path.getPoint(k, this.camera.position);
      this.look.lerpVectors(REST_LOOK, END_LOOK, Math.min(1, k * 1.15));
      this.camera.lookAt(this.look);
      if (travel.t >= 1) {
        this.travel = null;
        this.travelled = true;
        travel.done();
      }
      return;
    }
    if (this.travelled) {
      // Arrivé : un souffle de caméra à l'épaule, le temps que le jeu prenne le relais.
      this.camera.position.y = END_EYE.y + Math.sin(this.time * 0.9) * 0.008;
      this.camera.lookAt(this.look);
      return;
    }
    // Plan de repos : dérive lente, légère parallaxe à la souris.
    const t = this.time;
    const target = new T.Vector3(
      REST_EYE.x + Math.sin(t * 0.13) * 0.09 + this.pointer.x * 0.18,
      REST_EYE.y + Math.sin(t * 0.21) * 0.025 - this.pointer.y * 0.06,
      REST_EYE.z + Math.cos(t * 0.11) * 0.06,
    );
    this.camera.position.lerp(target, 1 - Math.exp(-dt * 2));
    this.camera.lookAt(this.look);
  }

  // ------------------------------------------------------------------ DÉCOR

  private buildSky() {
    const count = 700;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(0.08 + Math.random() * 0.92);
      const r = 90;
      positions.set([r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)], i * 3);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    const stars = new T.Points(geometry, new T.PointsMaterial({
      color: '#d8dcf0', size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.75,
    }));
    this.scene.add(stars);

    // Lune naissante voilée par la fumée de poudre.
    const moonTexture = this.radialTexture('#f1ead2', 'rgba(241,234,210,0)', 0.35);
    const moon = new T.Sprite(new T.SpriteMaterial({ map: moonTexture, fog: false, transparent: true, opacity: 0.55, depthWrite: false }));
    moon.position.set(-24, 16, -60);
    moon.scale.setScalar(5);
    this.scene.add(moon);

    // Lueur de la vallée de Feyiase qui brûle, sous la ligne de crête.
    const glowTexture = this.radialTexture('rgba(255,110,40,0.9)', 'rgba(120,20,0,0)', 0);
    for (let i = 0; i < 7; i++) {
      const glow = new T.Sprite(new T.SpriteMaterial({
        map: glowTexture, fog: false, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.35 + Math.random() * 0.25,
      }));
      glow.position.set(-26 + i * 7 + Math.random() * 4, -1.5 + Math.random(), -42 - Math.random() * 10);
      glow.scale.set(14 + Math.random() * 10, 6 + Math.random() * 3, 1);
      this.scene.add(glow);
    }
  }

  private buildRidge() {
    const geometry = new T.PlaneGeometry(60, 60, 48, 48);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes['position'] as T.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Crête : le sol plonge au-delà de z = -9 vers la vallée.
      const drop = z < -8 ? -(((-z - 8) / 6) ** 2) * 3 : 0;
      const bumps = Math.sin(x * 0.9) * Math.cos(z * 0.7) * 0.06 + Math.sin(x * 2.7 + z * 1.9) * 0.025;
      const near = Math.hypot(x, z) < 4 ? 0.35 : 1;
      pos.setY(i, drop + bumps * near + (Math.abs(x) > 7 ? (Math.abs(x) - 7) * 0.18 : 0));
    }
    geometry.computeVertexNormals();
    const ground = new T.Mesh(geometry, new T.MeshStandardMaterial({ color: '#5b2a1b', roughness: 1, flatShading: true }));
    this.scene.add(ground);

    const rock = new T.MeshStandardMaterial({ color: '#3c302a', roughness: 0.95, flatShading: true });
    const rocks: [number, number, number, number][] = [
      [2.6, -1.8, 0.55, 0.3], [-3.6, -0.6, 0.7, 1.1], [3.4, -5.5, 1.1, 2.0], [-4.8, -6.2, 1.4, 0.4], [1.0, -7.5, 0.9, 2.6],
    ];
    for (const [x, z, s, r] of rocks) {
      const mesh = new T.Mesh(new T.DodecahedronGeometry(s, 0), rock);
      mesh.position.set(x, s * 0.35, z);
      mesh.rotation.set(r, r * 1.7, r * 0.4);
      mesh.scale.y = 0.6;
      this.scene.add(mesh);
    }

    // Arbres brisés, silhouettes contre la lueur.
    const bark = new T.MeshStandardMaterial({ color: '#1b1210', roughness: 1, flatShading: true });
    const trunks: [number, number, number, number][] = [
      [-5.5, -4, 5.5, 0.12], [4.6, -3.2, 3.6, -0.35], [-2.8, -9.5, 7, 0.05], [6.5, -9, 6.2, 0.08], [-8, -7.5, 4.2, -0.5],
    ];
    for (const [x, z, h, lean] of trunks) {
      const trunk = new T.Mesh(new T.CylinderGeometry(0.1, 0.22, h, 6), bark);
      trunk.position.set(x, h / 2 - 0.1, z);
      trunk.rotation.z = lean;
      this.scene.add(trunk);
    }

    // Débris de la bataille : bouclier fendu, tambour renversé.
    const wood = new T.MeshStandardMaterial({ color: '#4a2f1f', roughness: 0.9, flatShading: true });
    const shield = new T.Mesh(new T.CylinderGeometry(0.34, 0.34, 0.04, 9, 1, false, 0, Math.PI * 1.55), wood);
    shield.position.set(1.7, 0.03, -0.9);
    shield.rotation.set(0.1, 0.8, 0.05);
    this.scene.add(shield);
    const drum = new T.Mesh(new T.CylinderGeometry(0.26, 0.18, 0.7, 8, 1, true), wood);
    drum.position.set(-3.1, 0.2, -3.6);
    drum.rotation.set(Math.PI / 2, 0, 0.6);
    this.scene.add(drum);
  }

  /** Afena : lame courbe en feuille, poignée à deux boules, plantée de biais. */
  private buildAfena() {
    const shape = new T.Shape();
    shape.moveTo(-0.022, 0);
    shape.quadraticCurveTo(-0.07, 0.32, -0.02, 0.74);
    shape.quadraticCurveTo(0.03, 0.86, 0.085, 0.8);
    shape.quadraticCurveTo(0.09, 0.42, 0.022, 0);
    shape.closePath();
    const blade = new T.Mesh(
      new T.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }),
      new T.MeshStandardMaterial({ color: '#b9bcbf', metalness: 0.45, roughness: 0.3, flatShading: true }),
    );
    blade.position.z = -0.004;
    const brass = new T.MeshStandardMaterial({ color: '#a07a35', metalness: 0.7, roughness: 0.45, flatShading: true });
    const grip = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.15, 6), new T.MeshStandardMaterial({ color: '#2a1a12', roughness: 0.8 }));
    grip.position.y = -0.09;
    const knobA = new T.Mesh(new T.IcosahedronGeometry(0.045, 0), brass);
    knobA.position.y = -0.005;
    const knobB = new T.Mesh(new T.IcosahedronGeometry(0.055, 0), brass);
    knobB.position.y = -0.18;
    const sword = new T.Group();
    sword.add(blade, grip, knobA, knobB);
    // Plantée pointe en bas : la lame entre dans la terre.
    sword.rotation.set(0.12, 0.5, Math.PI + 0.1);
    sword.position.copy(AFENA).add(new T.Vector3(0, 0.62, 0));
    this.scene.add(sword);
  }

  /** Brasero rituel : coupe d'argile sur trois pierres, cauris, calebasse d'eau. */
  private buildBrazier() {
    const clay = new T.MeshStandardMaterial({ color: '#6b3a22', roughness: 1, flatShading: true });
    const bowl = new T.Mesh(new T.CylinderGeometry(0.3, 0.17, 0.2, 9, 1, true), clay);
    bowl.material.side = T.DoubleSide;
    bowl.position.copy(BRAZIER).add(new T.Vector3(0, 0.22, 0));
    this.scene.add(bowl);
    const stone = new T.MeshStandardMaterial({ color: '#2d2622', roughness: 1, flatShading: true });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const s = new T.Mesh(new T.DodecahedronGeometry(0.11, 0), stone);
      s.position.copy(BRAZIER).add(new T.Vector3(Math.cos(a) * 0.17, 0.07, Math.sin(a) * 0.17));
      this.scene.add(s);
    }
    const coals = new T.Mesh(new T.CircleGeometry(0.26, 9), new T.MeshBasicMaterial({ color: '#ff5a1a' }));
    coals.rotation.x = -Math.PI / 2;
    coals.position.copy(BRAZIER).add(new T.Vector3(0, 0.28, 0));
    this.scene.add(coals);

    const flameColors = ['#ffcf6a', '#ff8a2a', '#e5481a'];
    for (let i = 0; i < 5; i++) {
      const flame = new T.Mesh(new T.ConeGeometry(0.09 + (i % 3) * 0.03, 0.4, 5, 1, true),
        new T.MeshBasicMaterial({ color: flameColors[i % 3], transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
      const a = i * 2.4;
      flame.position.copy(BRAZIER).add(new T.Vector3(Math.cos(a) * 0.08, 0.46, Math.sin(a) * 0.08));
      flame.userData['phase'] = Math.random() * 10;
      this.flames.push(flame);
      this.scene.add(flame);
    }

    const cowrie = new T.MeshStandardMaterial({ color: '#ece1c6', roughness: 0.4 });
    const shell = new T.SphereGeometry(0.022, 6, 4);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const c = new T.Mesh(shell, cowrie);
      c.scale.set(1, 0.55, 1.5);
      c.position.copy(BRAZIER).add(new T.Vector3(Math.cos(a) * 0.48, 0.012, Math.sin(a) * 0.48));
      c.rotation.y = -a;
      this.scene.add(c);
    }
    const calabash = new T.Mesh(new T.SphereGeometry(0.13, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.62),
      new T.MeshStandardMaterial({ color: '#8a6a32', roughness: 0.7, flatShading: true, side: T.DoubleSide }));
    calabash.rotation.x = Math.PI;
    calabash.position.copy(BRAZIER).add(new T.Vector3(0.62, 0.11, 0.18));
    this.scene.add(calabash);
    const water = new T.Mesh(new T.CircleGeometry(0.11, 8), new T.MeshStandardMaterial({ color: '#1d2a33', metalness: 0.4, roughness: 0.1 }));
    water.rotation.x = -Math.PI / 2;
    water.position.copy(calabash.position).add(new T.Vector3(0, 0.005, 0));
    this.scene.add(water);
  }

  /** Kwadwo Ofori agenouillé (genou droit à terre), lance plantée à côté. */
  private buildKwadwo(): T.Object3D {
    const body = new T.Group();
    body.position.copy(KWADWO);
    body.rotation.y = 0.55;

    // Même corps humain que dans le jeu (human-body.ts), posé à genoux puis cuit
    // (genou droit dans la cendre, pied gauche à plat, buste penché, tête basse).
    const kneel = {
      skin: '#3d241a',
      outfit: (m: (color: string) => T.Material) => ({ ...kwadwoOutfit(m), wrap: { material: m('#3d1a12'), band: m('#2b1510'), flap: true, hem: 10 } }),
      knees: [1.5, 1.55] as [number, number],
      pose: (rig: HumanoidRig) => {
        rig.root.position.y = -6.6;
        rig.legs[0].rotation.x = -1.5;
        rig.legs[1].rotation.x = -0.15;
        rig.torso.rotation.x = 0.32;
        rig.torso.children[3].rotation.x = 0.35;
        rig.arms[0].rotation.set(-0.9, 0, -0.1);
        rig.arms[1].rotation.set(-0.35, 0, 0.3);
      },
    };
    const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });
    const scale = 0.068;
    const lower = new T.Mesh(coloredGeometry(bakeHuman({ ...kneel, bones: [0, 7, 8] })), material);
    const chest = new T.Mesh(coloredGeometry(bakeHuman({ ...kneel, bones: [1, 2, 3, 4, 5, 6] })), material);
    lower.scale.setScalar(scale);
    chest.scale.setScalar(scale);
    // La respiration (update) gonfle ce groupe, pas l'échelle du maillage.
    const breath = new T.Group();
    breath.add(chest);
    body.add(lower, breath);

    // Lance plantée, que sa main droite tient encore.
    const spear = new T.Group();
    const shaft = new T.Mesh(new T.CylinderGeometry(0.015, 0.015, 1.9, 5), new T.MeshStandardMaterial({ color: '#3b2516', roughness: 0.9 }));
    shaft.position.y = 0.95;
    const tip = new T.Mesh(new T.ConeGeometry(0.035, 0.22, 4), new T.MeshStandardMaterial({ color: '#8a8f94', metalness: 0.8, roughness: 0.35 }));
    tip.position.y = 2.0;
    spear.add(shaft, tip);
    spear.position.set(0.45, 0, 0.2);
    spear.rotation.z = -0.12;
    body.add(spear);

    // Bouclier de bois et de cuir, marqué par le plomb.
    const shield = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.035, 9), new T.MeshStandardMaterial({ color: '#5a3a22', roughness: 0.9, flatShading: true }));
    shield.position.set(-0.42, 0.28, 0.05);
    shield.rotation.set(0.2, 0, 1.25);
    body.add(shield);

    this.scene.add(body);
    return breath;
  }

  private buildEmbers(): T.Points {
    const positions = new Float32Array(EMBERS * 3);
    for (let i = 0; i < EMBERS; i++) this.respawnEmber(positions, i, true);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    const texture = this.radialTexture('rgba(255,200,120,1)', 'rgba(255,80,20,0)', 0.15);
    const points = new T.Points(geometry, new T.PointsMaterial({
      map: texture, color: '#ffae55', size: 0.06, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false,
    }));
    this.scene.add(points);
    return points;
  }

  private respawnEmber(positions: Float32Array, i: number, scatter = false) {
    // La plupart montent du brasero ; quelques-unes dérivent de la vallée en feu.
    const fromFire = Math.random() < 0.7;
    const x = fromFire ? BRAZIER.x + (Math.random() - 0.5) * 0.3 : -4 + Math.random() * 8;
    const z = fromFire ? BRAZIER.z + (Math.random() - 0.5) * 0.3 : -6 + Math.random() * 7;
    const y = fromFire ? 0.4 : Math.random() * 0.6;
    positions.set([x, scatter ? y + Math.random() * 2.5 : y, z], i * 3);
    this.emberVelocity.set([0.18 + Math.random() * 0.3, 0.25 + Math.random() * 0.4, (Math.random() - 0.5) * 0.1], i * 3);
    this.emberLife[i] = 3 + Math.random() * 4;
  }

  private animateEmbers(dt: number) {
    const attribute = this.embers.geometry.attributes['position'] as T.BufferAttribute;
    const positions = attribute.array as Float32Array;
    for (let i = 0; i < EMBERS; i++) {
      this.emberLife[i] -= dt;
      if (this.emberLife[i] <= 0 || positions[i * 3 + 1] > 3.2) {
        this.respawnEmber(positions, i);
        continue;
      }
      const sway = Math.sin(this.time * 1.3 + i) * 0.3;
      positions[i * 3] += (this.emberVelocity[i * 3] + sway) * dt;
      positions[i * 3 + 1] += this.emberVelocity[i * 3 + 1] * dt;
      positions[i * 3 + 2] += (this.emberVelocity[i * 3 + 2] + Math.cos(this.time + i) * 0.08) * dt;
    }
    attribute.needsUpdate = true;
  }

  private buildSmoke() {
    const texture = this.radialTexture('rgba(70,62,58,0.55)', 'rgba(40,34,32,0)', 0.1);
    for (let i = 0; i < 12; i++) {
      const sprite = new T.Sprite(new T.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0 }));
      sprite.userData['age'] = (i / 12) * 9;
      this.smoke.push(sprite);
      this.scene.add(sprite);
    }
  }

  private animateSmoke(dt: number) {
    for (const sprite of this.smoke) {
      const age = (sprite.userData['age'] = ((sprite.userData['age'] as number) + dt) % 9);
      const k = age / 9;
      sprite.position.set(BRAZIER.x + k * 1.6 + Math.sin(age) * 0.1, 0.55 + k * 2.8, BRAZIER.z - k * 0.6);
      sprite.scale.setScalar(0.35 + k * 1.9);
      (sprite.material as T.SpriteMaterial).opacity = Math.sin(k * Math.PI) * 0.45;
      sprite.material.rotation = age * 0.15;
    }
  }

  private animateFire(dt: number) {
    const t = this.time;
    const flicker = 0.75 + Math.sin(t * 9.1) * 0.08 + Math.sin(t * 23.7) * 0.06 + Math.random() * 0.1;
    this.fireLight.intensity = 9 * flicker;
    this.fireLight.position.x = BRAZIER.x + Math.sin(t * 7) * 0.03;
    for (const flame of this.flames) {
      const p = flame.userData['phase'] as number;
      const s = 0.8 + Math.sin(t * 11 + p) * 0.18 + Math.sin(t * 17.3 + p * 2) * 0.1;
      flame.scale.set(1 - (s - 0.8) * 0.5, s, 1 - (s - 0.8) * 0.5);
      flame.rotation.y += dt * 1.5;
    }
  }

  private radialTexture(inner: string, outer: string, hardness: number): T.Texture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(hardness, inner);
    gradient.addColorStop(1, outer);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    this.disposables.push(texture);
    return texture;
  }
}
