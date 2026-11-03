import { describe, expect, it } from 'vitest';
import { exampleModel } from '../../model/testing.node';
import { boxModel } from '../../view3d/testModel.node';
import { floorUnder, vertexYNear } from './height';

/** A car of boxes: its floor slab, a seat on it, its roof, a guide skipped. */
const car = boxModel('test:car', [
  ['FLOOR', 'body', [-5, 1, -1.4], [5, 1.15, 1.4]],
  ['SEAT', 'interior', [-1, 1.15, 0.5], [0, 1.6, 1.4]],
  ['ROOF', 'body', [-5, 3.6, -1.4], [5, 3.75, 1.4]],
  ['GUIDE', 'skip', [-5, 2, -1], [5, 2.01, 1]],
]);

describe('a floor’s height from the model', () => {
  it('is the y of the vertex of the clicked object nearest the click, as the OBJ writes it', () => {
    expect(vertexYNear(car, 'FLOOR', [0.2, 1.149, 0.3])).toBe(1.15);
    expect(vertexYNear(car, 'FLOOR', [0.2, 1.01, 0.3])).toBe(1);
    expect(vertexYNear(car, 'NOPE', [0, 0, 0])).toBeNull();
  });

  it('under a new zone is the level surface with the most area: the floor before a seat, the lower before the roof', () => {
    expect(floorUnder(car, { minX: -2, minZ: -1, maxX: 1, maxZ: 1 })).toBe(1.15);
    // the seat's top alone under a small square, the floor's long faces over its middle
    expect(floorUnder(car, { minX: -0.6, minZ: 0.8, maxX: -0.4, maxZ: 1 })).toBe(1.15);
    expect(floorUnder(car, { minX: 20, minZ: 20, maxX: 21, maxZ: 21 })).toBeNull();
  });

  it('of the example coach’s saloon is its floor, 1.3', async () => {
    const coach = await exampleModel('coach');
    expect(floorUnder(coach, { minX: -1, minZ: -1, maxX: 1, maxZ: 1 })).toBe(1.3);
  });
});
