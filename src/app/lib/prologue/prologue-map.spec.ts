import { TerrainCollisionService } from '../engine/terrain-collision.service';
import {
  BRIDGE, BRIDGE_PUSH, PROLOGUE_DUEL, CAMP, CLEARINGS, FOREST, PROLOGUE_AREA, PROLOGUE_FOYERS, PROLOGUE_SPAWNS, REMAINS, START, TRAIL, TRAIL_HALF,
  inPrologue, walkable,
} from './prologue-map';

describe('Prologue map (1701)', () => {
  it('keeps the start, every remains, foyer, spawn and the camp on walkable ground', () => {
    const spots = [START, CAMP, ...REMAINS, ...Object.values(PROLOGUE_FOYERS), ...PROLOGUE_SPAWNS];
    for (const spot of spots) {
      expect(walkable(spot.x, spot.y, 10)).withContext(JSON.stringify(spot)).toBeTrue();
      expect(inPrologue(spot.x, spot.y)).toBeTrue();
    }
  });

  it('never plants a tree trunk on the trail or in a clearing', () => {
    expect(FOREST.length).toBeGreaterThan(200);
    for (const tree of FOREST) {
      expect(walkable(tree.x, tree.y, 0, true)).toBeFalse();
      for (const c of CLEARINGS) expect(Math.hypot(tree.x - c.x, tree.y - c.y)).toBeGreaterThan(c.r);
    }
  });

  it('only links the shortcut to the memory altar once the trunk is pushed', () => {
    const middle = { x: (BRIDGE.points[0].x + BRIDGE.points[1].x) / 2, y: (BRIDGE.points[0].y + BRIDGE.points[1].y) / 2 };
    expect(walkable(middle.x, middle.y, 10)).toBeFalse();
    expect(walkable(middle.x, middle.y, 10, true)).toBeTrue();
    expect(walkable(BRIDGE_PUSH.x, BRIDGE_PUSH.y, 10)).toBeTrue();
  });

  it('keeps the crest brasero outside the duel arena but close to it (fast retry)', () => {
    const foyer = PROLOGUE_FOYERS.tambours;
    const d = Math.hypot(foyer.x - PROLOGUE_DUEL.x, foyer.y - PROLOGUE_DUEL.y);
    expect(d).toBeGreaterThan(PROLOGUE_DUEL.radius);
    expect(d).toBeLessThan(PROLOGUE_DUEL.radius + 60);
  });

  it('lets the hero walk the trail but not into the forest, outside the main world bounds', () => {
    const terrain = new TerrainCollisionService();
    terrain.addRegion(PROLOGUE_AREA);
    terrain.addBlocker((x, y, r) => inPrologue(x, y, 40) && !walkable(x, y, r));
    const [a, b] = TRAIL;
    const along = terrain.move(a.x, a.y, a.x + (b.x - a.x) * 0.5, a.y + (b.y - a.y) * 0.5, 10);
    expect(along.x).toBeGreaterThan(a.x + 50);
    // Plein sud depuis le sentier : la lisière arrête le héros.
    const p = TRAIL[4];
    const south = terrain.move(p.x, p.y, p.x, p.y + 300, 10);
    expect(south.y).toBeLessThan(p.y + TRAIL_HALF + 40);
  });
});
