import type { World3D } from '../engine/world-3d';
import { WindLayer } from '../engine/wind';
import { AsyncWorld3D } from './async-world-3d';
import type { AsyncWorldService } from './async-world.service';

/**
 * Couches 3D du monde partagé et du vent. Module chargé à la demande avec
 * world-3d pour que three.js reste hors du bundle initial.
 */
export function addSharedWorldLayers(world: World3D, social: AsyncWorldService) {
  world.addLayer((scene) => new AsyncWorld3D(scene, social));
  world.addLayer((scene) => new WindLayer(scene));
}
