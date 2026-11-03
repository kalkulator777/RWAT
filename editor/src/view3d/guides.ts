/**
 * The guides of the 3D view (docs/proposals/editor.md §3.8), each a layer that can be
 * switched off: the grid on the railhead — whole blocks, and the 1/16 the floor snaps to
 * once the view is close enough to tell its lines apart — the OBJ frame's axes, the rails,
 * and the wagon type's frame: its collision hull, its bogie pivots and its coupler points.
 * Where they go is ./frame.ts's business; here they become lines.
 */

import { Box3, BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineDashedMaterial, LineSegments, type Material } from 'three';
import type { Vec3 } from '../core/contracts';
import { frameGuides, RAIL_Z, RAILHEAD_OBJ_Y, type WagonFrame } from './frame';
import { boxEdges } from './overlayGeometry';

/** The guide layers, as the view's layer switches name them. */
export type GuideLayer = 'grid' | 'axes' | 'rails' | 'frame';

export const GUIDE_LAYERS: readonly GuideLayer[] = ['grid', 'axes', 'rails', 'frame'];

/** The colours of the OBJ frame's axes, as Blender draws X and Y-up's other two. */
export const AXIS_COLORS = { x: '#e03131', y: '#2f9e44', z: '#1c7ed6' } as const;

/** The finest grid step, blocks: the floor's snap (`floorgen.CELL`). */
export const GRID_STEP = 1 / 16;
/** The fine grid shows from this many screen pixels a block: its lines 4 px apart. */
export const MINOR_GRID_MIN_PX = 64;
/** How far the grid reaches past the model, blocks. */
const GRID_MARGIN = 2;
/** How high the pivot and coupler marks stand over the railhead. */
const MARK_HEIGHT = 1.2;
const MARK_HALF = 0.15;

function segments(pairs: readonly (readonly [Vec3, Vec3])[], material: Material): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pairs.flat(2), 3));
  const lines = new LineSegments(geometry, material);
  if (material instanceof LineDashedMaterial) lines.computeLineDistances();
  return lines;
}

function lineMaterial(color: string, opacity = 1): LineBasicMaterial {
  return new LineBasicMaterial({ color, transparent: opacity < 1, opacity });
}

/** The extent the grid and the rails cover: the model's box with a margin, in whole blocks, never less than a car's room. */
export function gridExtent(model: Box3): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const box = model.isEmpty() ? new Box3().setFromArray([-6, 0, -3, 6, 0, 3]) : model;
  return {
    minX: Math.floor(Math.min(box.min.x, -6) - GRID_MARGIN),
    maxX: Math.ceil(Math.max(box.max.x, 6) + GRID_MARGIN),
    minZ: Math.floor(Math.min(box.min.z, -3) - GRID_MARGIN),
    maxZ: Math.ceil(Math.max(box.max.z, 3) + GRID_MARGIN),
  };
}

/** The lines of a grid on the railhead, every `step` blocks, skipping the whole blocks when `minorOnly`. */
export function gridLines(extent: ReturnType<typeof gridExtent>, step: number, minorOnly: boolean): [Vec3, Vec3][] {
  const y = RAILHEAD_OBJ_Y;
  const pairs: [Vec3, Vec3][] = [];
  const perBlock = Math.round(1 / step);
  for (let i = Math.round(extent.minX / step); i <= Math.round(extent.maxX / step); i++) {
    if (minorOnly && i % perBlock === 0) continue;
    pairs.push([
      [i * step, y, extent.minZ],
      [i * step, y, extent.maxZ],
    ]);
  }
  for (let i = Math.round(extent.minZ / step); i <= Math.round(extent.maxZ / step); i++) {
    if (minorOnly && i % perBlock === 0) continue;
    pairs.push([
      [extent.minX, y, i * step],
      [extent.maxX, y, i * step],
    ]);
  }
  return pairs;
}

export class Guides {
  readonly root = new Group();
  readonly layers: Readonly<Record<GuideLayer, Group>> = { grid: new Group(), axes: new Group(), rails: new Group(), frame: new Group() };
  private minor: LineSegments | null = null;
  private minorWanted = false;

  constructor() {
    this.root.name = 'guides';
    for (const layer of GUIDE_LAYERS) {
      this.layers[layer].name = `guide:${layer}`;
      this.root.add(this.layers[layer]);
    }
    this.update(new Box3(), null);
  }

  /** Rebuilds the guides around the model's box and for the type's frame (null: no type known, no frame). */
  update(model: Box3, frame: WagonFrame | null): void {
    for (const layer of GUIDE_LAYERS) this.clear(this.layers[layer]);
    const extent = gridExtent(model);
    const y = RAILHEAD_OBJ_Y;

    const grid = this.layers.grid;
    grid.add(segments(gridLines(extent, 1, false), lineMaterial('#7a828e', 0.45)));
    this.minor = segments(gridLines(extent, GRID_STEP, true), lineMaterial('#7a828e', 0.14));
    this.minor.visible = this.minorWanted;
    grid.add(this.minor);

    const axes = this.layers.axes;
    axes.add(
      segments(
        [
          [
            [extent.minX, y, 0],
            [extent.maxX, y, 0],
          ],
        ],
        lineMaterial(AXIS_COLORS.x, 0.6),
      ),
      segments(
        [
          [
            [0, y, extent.minZ],
            [0, y, extent.maxZ],
          ],
        ],
        lineMaterial(AXIS_COLORS.z, 0.6),
      ),
      segments([[[0, 0, 0], [1, 0, 0]]], lineMaterial(AXIS_COLORS.x)),
      segments([[[0, 0, 0], [0, 1, 0]]], lineMaterial(AXIS_COLORS.y)),
      segments([[[0, 0, 0], [0, 0, 1]]], lineMaterial(AXIS_COLORS.z)),
    );

    this.layers.rails.add(
      segments(
        [-RAIL_Z, RAIL_Z].map((z): [Vec3, Vec3] => [
          [extent.minX, y, z],
          [extent.maxX, y, z],
        ]),
        lineMaterial('#3d434c'),
      ),
    );

    if (frame !== null) {
      const guides = frameGuides(frame);
      const mark = (x: number): [Vec3, Vec3][] => [
        [
          [x, y, 0],
          [x, y + MARK_HEIGHT, 0],
        ],
        [
          [x - MARK_HALF, y, 0],
          [x + MARK_HALF, y, 0],
        ],
        [
          [x, y, -MARK_HALF],
          [x, y, MARK_HALF],
        ],
      ];
      this.layers.frame.add(
        segments(boxEdges(guides.hull.min, guides.hull.max), new LineDashedMaterial({ color: '#868e96', dashSize: 0.2, gapSize: 0.12 })),
        segments(guides.pivots.flatMap(mark), lineMaterial('#d6336c')),
        segments(guides.couplers.flatMap(mark), lineMaterial('#0ca678')),
      );
    }
  }

  /** Shows the 1/16 grid or not (the view decides by how many pixels a block spans). */
  setMinorGrid(visible: boolean): void {
    this.minorWanted = visible;
    if (this.minor !== null) this.minor.visible = visible;
  }

  /** True while the 1/16 grid is shown. */
  get minorGrid(): boolean {
    return this.minorWanted;
  }

  setVisible(layer: GuideLayer, visible: boolean): void {
    this.layers[layer].visible = visible;
  }

  private clear(group: Group): void {
    for (const child of group.children) {
      if (child instanceof LineSegments) {
        (child.geometry as BufferGeometry).dispose();
        (child.material as Material).dispose();
      }
    }
    group.clear();
  }

  dispose(): void {
    for (const layer of GUIDE_LAYERS) this.clear(this.layers[layer]);
  }
}
