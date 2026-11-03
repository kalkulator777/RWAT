import { Color, LineBasicMaterial, LineDashedMaterial, LineSegments, Mesh, MeshBasicMaterial, Object3D, Points, PointsMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { OverlayShape } from '../core/contracts';
import { SELECTION_COLOR } from './modelScene';
import { disposeLayer, layerObject, OVERLAY_STYLES, overlayStyle, POINT_SIZE, shapeObject } from './overlays';

function find<T>(root: Object3D, type: new (...args: never[]) => T): T[] {
  const found: T[] = [];
  root.traverse((o) => {
    if (o instanceof type) found.push(o);
  });
  return found;
}

function vertices(segments: LineSegments): number {
  return segments.geometry.getAttribute('position').count;
}

const zone: OverlayShape = { shape: 'rect', min: [-5, 1.3, -1], max: [5, 9, 1], style: 'zone', link: { kind: 'zone', type: 't', index: 1 } };

describe('the overlays', () => {
  it('draw a box as its twelve edges and a see-through fill, over the model', () => {
    const box = shapeObject({ shape: 'box', min: [0, 0, 0], max: [1, 2, 3], style: 'door' }, false);
    const [edges] = find(box, LineSegments);
    expect(vertices(edges as LineSegments)).toBe(24);
    const [fill] = find(box, Mesh);
    const material = (fill as Mesh).material as MeshBasicMaterial;
    expect([material.transparent, material.depthTest, material.opacity]).toEqual([true, false, OVERLAY_STYLES.door?.fill]);
    expect((fill as Mesh).position.toArray()).toEqual([0.5, 1, 1.5]);
  });

  it('lay a rectangle and a circle flat at their height', () => {
    const rect = shapeObject(zone, false);
    const [outline] = find(rect, LineSegments);
    const ys = new Set<number>();
    const position = (outline as LineSegments).geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) ys.add(position.getY(i));
    expect([...ys].map((y) => Math.fround(y))).toEqual([Math.fround(1.3)]);
    expect(vertices(outline as LineSegments)).toBe(8);
    const circle = shapeObject({ shape: 'circle', centre: [1, 2, 3], radius: 2.5, style: 'reach' }, false);
    const [disc] = find(circle, Mesh);
    expect((disc as Mesh).position.toArray()).toEqual([1, 2, 3]);
    expect(find(circle, LineSegments)[0]?.material).toBeInstanceOf(LineDashedMaterial);
  });

  it('draw a polygon as its closed outline and a fill on its plane, and a point as a dot of one size', () => {
    // an L-shaped floor piece at y = 1.25, not convex
    const points: [number, number, number][] = [
      [0, 1.25, 0],
      [4, 1.25, 0],
      [4, 1.25, 1],
      [1, 1.25, 1],
      [1, 1.25, 3],
      [0, 1.25, 3],
    ];
    const polygon = shapeObject({ shape: 'polygon', points, style: 'piece' }, false);
    const [outline] = find(polygon, LineSegments);
    expect(vertices(outline as LineSegments)).toBe(12);
    const [fill] = find(polygon, Mesh);
    const geometry = (fill as Mesh).geometry;
    // six corners make four triangles, every one of them inside the L (none across its notch)
    expect(geometry.getIndex()?.count).toBe(12);
    const index = geometry.getIndex()!;
    const position = geometry.getAttribute('position');
    let area = 0;
    for (let t = 0; t < index.count; t += 3) {
      const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      area += Math.abs((position.getX(b) - position.getX(a)) * (position.getZ(c) - position.getZ(a)) - (position.getX(c) - position.getX(a)) * (position.getZ(b) - position.getZ(a))) / 2;
      for (const i of [a, b, c]) expect(position.getY(i)).toBe(1.25);
    }
    expect(area).toBeCloseTo(4 + 2, 9);
    expect(find(shapeObject({ shape: 'polygon', points: points.slice(0, 2), style: 'piece' }, false), Mesh)).toHaveLength(0);

    const point = shapeObject({ shape: 'point', at: [1, 2, 3], style: 'seat' }, false);
    const [dot] = find(point, Points);
    expect((dot as Points).geometry.getAttribute('position').array).toEqual(new Float32Array([1, 2, 3]));
    const material = (dot as Points).material as PointsMaterial;
    expect([material.size, material.sizeAttenuation, material.depthTest]).toEqual([POINT_SIZE, false, false]);
    const layer = layerObject('marks', [{ shape: 'point', at: [0, 0, 0], style: 'seat' }], () => false);
    disposeLayer(layer);
    expect(layer.children).toHaveLength(0);
  });

  it('end an arrow and an arc in a head pointing the way they go', () => {
    const arrow = shapeObject({ shape: 'arrow', from: [0, 0, 0], to: [0, 0, 2], style: 'door' }, false);
    const [cone] = find(arrow, Mesh);
    const up = new Vector3(0, 1, 0).applyQuaternion((cone as Mesh).quaternion);
    expect(up.toArray().map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 1]);
    expect((cone as Mesh).position.z).toBeCloseTo(2 - 0.15, 9);
    const arc = shapeObject({ shape: 'arc', centre: [0, 0, 0], axis: [0, 1, 0], from: [1, 0, 0], degrees: 90, style: 'travel' }, false);
    const [arcHead] = find(arc, Mesh);
    const tip = new Vector3(0, 1, 0).applyQuaternion((arcHead as Mesh).quaternion);
    expect(tip.x).toBeCloseTo(-1, 6);
    // the head ends at the arc's end, a quarter round +Y from +X: −Z
    expect((arcHead as Mesh).position.clone().add(tip.multiplyScalar(0.1)).toArray().map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, -1]);
    expect(find(shapeObject({ shape: 'arrow', from: [1, 1, 1], to: [1, 1, 1], style: 'x' }, false), Mesh)).toHaveLength(0);
  });

  it('draw an unknown style as the default, and a selected shape in the selection colour with more fill', () => {
    expect(overlayStyle('no-such-style')).toBe(OVERLAY_STYLES.default);
    const plain = (find(shapeObject(zone, false), Mesh)[0] as Mesh).material as MeshBasicMaterial;
    const chosen = (find(shapeObject(zone, true), Mesh)[0] as Mesh).material as MeshBasicMaterial;
    expect(chosen.color.equals(new Color(SELECTION_COLOR))).toBe(true);
    expect(chosen.opacity).toBeGreaterThan(plain.opacity);
    expect(((find(shapeObject(zone, true), LineSegments)[0] as LineSegments).material as LineBasicMaterial).color.getHex()).toBe(SELECTION_COLOR);
  });

  it('build a layer with the selected links marked, and free it', () => {
    const door: OverlayShape = { shape: 'box', min: [0, 0, 0], max: [1, 1, 1], style: 'door', link: { kind: 'door', type: 't', index: 0 } };
    const layer = layerObject('floor', [zone, door], (link) => link.kind === 'door');
    expect(layer.name).toBe('overlay:floor');
    expect(layer.children).toHaveLength(2);
    const doorLines = (find(layer.children[1] as Object3D, LineSegments)[0] as LineSegments).material as LineBasicMaterial;
    expect(doorLines.color.getHex()).toBe(SELECTION_COLOR);
    disposeLayer(layer);
    expect(layer.children).toHaveLength(0);
  });
});
