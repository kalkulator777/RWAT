import { Box3, LineDashedMaterial, LineSegments, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { WHEEL_LINE } from '../ports/objFrame';
import { RAILHEAD_OBJ_Y, type WagonFrame } from './frame';
import { GRID_STEP, gridExtent, gridLines, Guides } from './guides';

const COACH: WagonFrame = {
  length: 20,
  bogies: [7, -7],
  couplerReach: [10.25, 10.25],
  hull: { minX: -1.7, minY: 0.4, minZ: -10, maxX: 1.7, maxY: 4.7, maxZ: 10 },
};

function points(lines: LineSegments): number[][] {
  const position = lines.geometry.getAttribute('position');
  return Array.from({ length: position.count }, (_, i) => [position.getX(i), position.getY(i), position.getZ(i)]);
}

describe('the guides', () => {
  it('reach past the model in whole blocks, never less than a car', () => {
    expect(gridExtent(new Box3())).toEqual({ minX: -8, maxX: 8, minZ: -5, maxZ: 5 });
    expect(gridExtent(new Box3(new Vector3(-10.3, 0, -1.5), new Vector3(10.3, 4, 1.5)))).toEqual({ minX: -13, maxX: 13, minZ: -5, maxZ: 5 });
  });

  it('draw the grid on the railhead every block, and the 1/16 between the blocks only', () => {
    const extent = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
    const major = gridLines(extent, 1, false);
    expect(major).toHaveLength(6);
    for (const [a, b] of major) expect([a[1], b[1]]).toEqual([RAILHEAD_OBJ_Y, RAILHEAD_OBJ_Y]);
    const minor = gridLines(extent, GRID_STEP, true);
    // 33 lines a way at 1/16, of which the 3 on whole blocks are the major grid's
    expect(minor).toHaveLength(2 * (33 - 3));
    expect(minor.some(([a]) => a[0] === 0.5)).toBe(true);
    expect(minor.some(([a]) => a[0] === 0 && a[2] === -1)).toBe(false);
  });

  it('lay the rails at ±0.8125 on the railhead, and the frame only once the type is known', () => {
    const guides = new Guides();
    const rails = guides.layers.rails.children[0] as LineSegments;
    expect(new Set(points(rails).map((p) => p[2]))).toEqual(new Set([-WHEEL_LINE, WHEEL_LINE]));
    expect(guides.layers.frame.children).toHaveLength(0);
    guides.update(new Box3(new Vector3(-10, 0, -1.5), new Vector3(10, 4, 1.5)), COACH);
    const [hull, pivots, couplers] = guides.layers.frame.children as LineSegments[];
    expect(hull?.material).toBeInstanceOf(LineDashedMaterial);
    expect(Math.min(...points(hull as LineSegments).map((p) => p[0] as number))).toBe(-10);
    expect(Math.max(...points(hull as LineSegments).map((p) => p[2] as number))).toBeCloseTo(1.7, 6);
    expect(new Set(points(pivots as LineSegments).filter((p) => (p[1] as number) > 0.5).map((p) => p[0]))).toEqual(new Set([-7, 7]));
    expect(new Set(points(couplers as LineSegments).filter((p) => (p[1] as number) > 0.5).map((p) => p[0]))).toEqual(new Set([-10.25, 10.25]));
  });

  it('switch the fine grid and each layer on and off', () => {
    const guides = new Guides();
    expect(guides.minorGrid).toBe(false);
    guides.setMinorGrid(true);
    guides.update(new Box3(), null);
    expect(guides.layers.grid.children[1]?.visible).toBe(true);
    guides.setVisible('axes', false);
    expect(guides.layers.axes.visible).toBe(false);
    guides.dispose();
    expect(guides.layers.grid.children).toHaveLength(0);
  });
});
