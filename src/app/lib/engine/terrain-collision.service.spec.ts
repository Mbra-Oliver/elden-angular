import { HUTS, TREES } from '../constants/scenery';
import { TerrainCollisionService } from './terrain-collision.service';

describe('TerrainCollisionService', () => {
  const terrain = new TerrainCollisionService();

  it('keeps long dashes out of a hut and lets diagonal motion slide along it', () => {
    const [x, y, radius] = HUTS[0];
    const hit = terrain.move(x - 82, y + 5, x + 82, y + 5, 10);
    expect(hit.x).toBeLessThanOrEqual(x - radius * 0.82 - 10);
    const slide = terrain.move(hit.x, hit.y, hit.x + 18, hit.y + 25, 10);
    expect(slide.y).toBeGreaterThan(hit.y + 15);
  });

  it('uses the same tree positions as the painted terrain', () => {
    const tree = TREES.find(({ x, y }) => x > 1800 && y > 100)!;
    const hit = terrain.move(tree.x - 49, tree.y + 3, tree.x + 50, tree.y + 3, 10);
    expect(hit.x).toBeLessThan(tree.x - tree.radius * 0.68);
  });

  it('blocks the banks but leaves the ford and the sluice bridge open', () => {
    expect(terrain.move(248, 270, 373, 270, 10).x).toBeLessThan(275);
    expect(terrain.move(248, 350, 373, 350, 19).x).toBeCloseTo(373);
    expect(terrain.move(1275, 701, 1365, 701, 10).x).toBeLessThan(1291);
    expect(terrain.move(1270, 792, 1365, 792, 19).x).toBeCloseTo(1365);
  });
});
