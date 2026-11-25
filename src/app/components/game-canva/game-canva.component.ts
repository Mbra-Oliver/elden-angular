import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  HostListener,
  NgZone,
  OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';
import type { Game } from 'phaser';
import type { World3D } from '../../lib/engine/world-3d';
import { VIEWPORT } from '../../lib/constants/terrain-constant';
import { SPRITE_MANIFEST } from '../../lib/constants/sprite-config';
import { AssetLoaderService } from '../../lib/engine/asset-loader.service';
import { EnvironmentService } from '../../lib/engine/environment.service';
import { GameLoopService } from '../../lib/services/game-loop.service';
import { GameStateService } from '../../lib/services/game-state.service';
import { RendererService } from '../../lib/services/renderer.service';
import { CombatHudComponent } from '../combat-hud/combat-hud.component';
import { DialogueBoxComponent } from '../dialogue-box/dialogue-box.component';
import { EquipmentStore } from '../../lib/entities/player/equipment.store';
import { KeyHintComponent } from '../key-hint/key-hint.component';
import { SliceHudComponent } from '../slice-hud/slice-hud.component';
import { SliceService } from '../../lib/slice/slice.service';
import { SocialHudComponent } from '../social-hud/social-hud.component';
import { AsyncWorldService } from '../../lib/social/async-world.service';
import { InputDeviceService, PAD } from '../../lib/services/input-device.service';

@Component({
  selector: 'app-game-canva',
  imports: [CombatHudComponent, DialogueBoxComponent, KeyHintComponent, SocialHudComponent, SliceHudComponent],
  templateUrl: './game-canva.component.html',
  styleUrl: './game-canva.component.css',
})
export class GameCanvaComponent implements AfterViewInit, OnDestroy {
  @ViewChild('viewport') viewport!: ElementRef<HTMLDivElement>;

  readonly gameState = inject(GameStateService);
  readonly equipment = inject(EquipmentStore);
  private readonly slice = inject(SliceService);
  readonly engineStatus = signal<'loading' | 'ready' | 'failed'>('loading');
  private readonly renderer = inject(RendererService);
  private readonly loop = inject(GameLoopService);
  private readonly zone = inject(NgZone);
  private readonly assets = inject(AssetLoaderService);
  private readonly environment = inject(EnvironmentService);
  private readonly social = inject(AsyncWorldService);
  /** Manette : A interagit / choix 1, X choix 2 (le clavier passe par onKeydown). */
  private readonly offPad = inject(InputDeviceService).onPadPressed((button) => {
    const dialogue = this.gameState.dialogue();
    const choice = dialogue?.choices[button === PAD.A ? 0 : button === PAD.X ? 1 : -1];
    if (choice) this.gameState.choose(choice);
    else if (button === PAD.A && this.gameState.canTalk()) this.gameState.talk();
  });
  private game?: Game;
  private world?: World3D;
  private destroyed = false;
  private warming = false;

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    const dialogue = this.gameState.dialogue();
    const choice = dialogue?.choices[event.code === 'Digit1' ? 0 : event.code === 'Digit2' ? 1 : -1];
    if (choice && !event.repeat) {
      event.preventDefault();
      this.gameState.choose(choice);
      return;
    }
    // Grayboxing : matériaux gris, grille de 50 unités, collisions visibles.
    if (event.code === 'KeyG' && !event.repeat && this.world) {
      event.preventDefault();
      const on = this.world.toggleGraybox();
      this.slice.say(on ? 'Graybox activé (G pour revenir)' : 'Graybox désactivé');
      return;
    }
    // Tranche verticale : objets, portes, levier passent avant les dialogues.
    if (event.code === 'KeyF' && !event.repeat && this.slice.interact()) {
      event.preventDefault();
      return;
    }
    if (event.code === 'KeyF' && !event.repeat && this.gameState.canTalk()) {
      event.preventDefault();
      this.gameState.talk();
    }
  }

  ngAfterViewInit(): void {
    void this.loadEngine();
  }

  private async loadEngine() {
    try {
      const [Phaser, { World3D }, { addSharedWorldLayers }] = await Promise.all([
        import('phaser/dist/phaser.esm.js'),
        import('../../lib/engine/world-3d'),
        import('../../lib/social/scene-layers'),
        // Les textures du sol doivent être prêtes avant la première image :
        // sinon le terrain 2400×1600 est repeint et renvoyé au GPU en plein combat.
        this.assets.load(SPRITE_MANIFEST),
      ]);
      if (this.destroyed) return;

      this.zone.runOutsideAngular(() => {
        this.game = new Phaser.Game({
          type: Phaser.CANVAS,
          parent: this.viewport.nativeElement,
          width: VIEWPORT.WIDTH,
          height: VIEWPORT.HEIGHT,
          banner: false,
          audio: { noAudio: true },
          input: { keyboard: false, mouse: false, touch: false, gamepad: false },
          render: { antialias: true, transparent: true, clearBeforeRender: false },
          callbacks: {
            preBoot: (game: Game) => {
              game.events.on(Phaser.Core.Events.POST_RENDER, () => {
                if (!this.destroyed && !this.warming) this.loop.render();
              });
            },
            postBoot: (game: Game) => {
              if (this.destroyed) return;
              game.canvas.setAttribute('role', 'img');
              game.canvas.setAttribute('aria-label', 'Terrain de jeu vu du dessus');
              Object.assign(game.canvas.style, { width: '100%', height: '100%', display: 'block' });
              let world: World3D | undefined;
              try {
                world = new World3D(this.viewport.nativeElement);
                game.canvas.setAttribute('aria-hidden', 'true');
                Object.assign(game.canvas.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
              } catch (error) {
                console.warn('WebGL indisponible, vue 2D utilisée.', error);
              }
              this.renderer.init(game.canvas);
              if (!world) {
                this.engineStatus.set('ready');
                return;
              }
              this.world = world;
              // Ni logique ni rendu tant que les shaders ne sont pas compilés.
              this.warming = true;
              // Couches d'abord, préchauffage ensuite : tout ce qui sera affiché
              // en jeu est compilé pendant l'écran de chargement.
              const prepared = world;
              void (async () => {
                await this.gameState.attachLayers(prepared);
                addSharedWorldLayers(prepared, this.social);
                await prepared.warmUp(this.environment.groundCanvas());
              })().finally(() => {
                if (this.destroyed) return;
                this.gameState.setWorld3D(prepared);
                this.social.attach();
                this.warming = false;
                this.zone.run(() => this.engineStatus.set('ready'));
              });
            },
          },
          scene: { update: (_time: number, delta: number) => { if (!this.warming) this.loop.update(delta); } },
        });
      });
    } catch (error) {
      if (this.destroyed) return;
      console.error('Impossible de charger Phaser', error);
      this.engineStatus.set('failed');
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.offPad();
    this.social.detach();
    this.gameState.stopGame();
    this.gameState.setWorld3D(null);
    this.world?.dispose();
    this.game?.destroy(true);
  }
}
