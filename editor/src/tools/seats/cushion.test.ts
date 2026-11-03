import { describe, expect, it } from 'vitest';
import { exampleModel } from '../../model/testing.node';
import { CUSHION_SIZE, isCushion, levelFaceAt, placeAt, spotsOf } from './cushion';

const shunter = await exampleModel('shunter');
const CHAIRS = 'INTERIOR_CHAIRS_LCG_IL';

describe('a click on the model', () => {
  it('on a cushion puts the chair in the middle of its top, as the OBJ writes it', () => {
    expect(placeAt(shunter, CHAIRS, [1.6, 2.1, -0.75])).toEqual([1.65, 2.1, -0.8]);
    expect(placeAt(shunter, CHAIRS, [1.84, 2.1, -0.99])).toEqual([1.65, 2.1, -0.8]);
    expect(placeAt(shunter, CHAIRS, [3.1, 2.1, 0.62])).toEqual([2.95, 2.1, 0.8]);
    const face = levelFaceAt(shunter, CHAIRS, [1.6, 2.1, -0.75]);
    expect(face).toEqual({ object: CHAIRS, up: true, minX: 1.45, minZ: -1, maxX: 1.85, maxZ: -0.6, y: 2.1 });
    expect(face !== null && isCushion(face)).toBe(true);
  });

  it('on a larger level face takes the point clicked at the face’s height; elsewhere the point itself', () => {
    // the long hood's top: 7.2 blocks long, no cushion
    const hood = levelFaceAt(shunter, 'HOODS', [-3.1234, 3.3, 0.2]);
    expect(hood?.y).toBe(3.3);
    expect((hood?.maxX ?? 0) - (hood?.minX ?? 0)).toBeGreaterThan(CUSHION_SIZE);
    expect(placeAt(shunter, 'HOODS', [-3.1234, 3.3, 0.2])).toEqual([-3.123, 3.3, 0.2]);
    // the chair's backrest, a side of it: no level face there
    expect(levelFaceAt(shunter, CHAIRS, [1.93, 2.4, -0.7])).toBeNull();
    expect(placeAt(shunter, CHAIRS, [1.93, 2.4123, -0.7])).toEqual([1.93, 2.412, -0.7]);
  });
});

describe('the cushions of a model', () => {
  it('are its small level faces’ middles, the shunter’s two chairs among them', () => {
    const spots = spotsOf(shunter);
    expect(spots).toContainEqual([1.65, 2.1, -0.8]);
    expect(spots).toContainEqual([2.95, 2.1, 0.8]);
    expect(spots.some(([x, y]) => x === -3 && y === 3.3)).toBe(false);
    expect(spotsOf(shunter)).toBe(spots);
    expect(spotsOf(null)).toEqual([]);
  });
});
