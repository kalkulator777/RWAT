import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadWagonType } from '../ports/wagonType';
import { EXAMPLE_PACK } from '../testing/repo.node';
import { frameGuides, RAIL_Z, RAILHEAD_OBJ_Y, wagonFrame } from './frame';

function exampleType(id: string) {
  const json: unknown = JSON.parse(readFileSync(join(EXAMPLE_PACK, 'data', 'rwat_example', 'wagon_types', `${id}.json`), 'utf8'));
  const { type } = loadWagonType(`rwat_example:${id}`, json);
  if (type === null) throw new Error(`the example pack's ${id} does not load`);
  return type;
}

describe('the guides of the OBJ frame', () => {
  it('put the railhead where the wheel treads bottom out, and the rails on the wheel line', () => {
    expect(RAILHEAD_OBJ_Y).toBeCloseTo(-0.03, 12);
    expect(RAIL_Z).toBe(0.8125);
  });

  it("take the coach's pivots, ends, couplers and hull from the port, turned into the OBJ frame", () => {
    const coach = exampleType('coach');
    const guides = frameGuides(wagonFrame(coach));
    // bogies [7, -7] (+ forward) are at x = -7 (front, towards -X) and +7
    expect(guides.pivots).toEqual([-7, 7]);
    expect(guides.ends).toEqual([-10, 10]);
    expect(guides.couplers[0]).toBeCloseTo(-coach.couplerReach(true), 12);
    expect(guides.couplers[1]).toBeCloseTo(coach.couplerReach(false), 12);
    // the hull: ±1.7 across, y 0.4…4.7 in the model frame, so −0.03625…4.26375 in the OBJ
    expect(guides.hull.min[0]).toBe(-10);
    expect(guides.hull.max[0]).toBe(10);
    expect(guides.hull.min[1]).toBeCloseTo(-0.03625, 9);
    expect(guides.hull.max[1]).toBeCloseTo(4.26375, 9);
    expect(guides.hull.min[2]).toBe(-1.7);
    expect(guides.hull.max[2]).toBe(1.7);
  });

  it('turn a coupler offset outward at each end', () => {
    const frame = { ...wagonFrame(exampleType('coach')), couplerReach: [10.5, 10.25] as const };
    expect(frameGuides(frame).couplers).toEqual([-10.5, 10.25]);
  });
});
