/**
 * The overlays of the 3D view (core/contracts `OverlayShape`, `ViewApi.overlay`): what the
 * markup tools and the preview draw over the model — floor zones and pieces, doors, chairs
 * and their reach, hinge arcs, headlight cones, marked points — as three.js lines, dots and
 * see-through fills in the OBJ frame. Overlays are drawn through the model (no depth
 * test): markup inside a car stays visible from outside.
 *
 * A shape's `style` names one of {@link OVERLAY_STYLES}; a name the table lacks is drawn in
 * the `default` style. A shape whose link is selected is drawn in the selection's colour
 * with a stronger fill.
 */

import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  ShapeUtils,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import type { Link, OverlayShape, Vec3 } from '../core/contracts';
import { arcEndTangent, arcPoints, boxEdges, circlePoints, length, normalize, ordered, polygonAxes, polygonNormal, rectCorners, sub } from './overlayGeometry';
import { SELECTION_COLOR } from './modelScene';

/** How a style draws: its colour, the opacity of its fill (0: lines only) and whether its lines are dashed. */
export interface OverlayStyle {
  readonly color: string;
  readonly fill: number;
  readonly dashed: boolean;
}

/**
 * The overlay styles by name. The names are what the tools and the preview pass as
 * `style`; one they need and do not find here is added here (view3d owns the look).
 */
export const OVERLAY_STYLES: Readonly<Record<string, OverlayStyle>> = Object.freeze({
  default: { color: '#f76707', fill: 0.12, dashed: false },
  /** A floor zone as declared. */
  zone: { color: '#2f9e44', fill: 0.14, dashed: false },
  /** A piece of floor where a player's centre can stand (`FloorRegion`). */
  piece: { color: '#37b24d', fill: 0.28, dashed: false },
  /** Where a shut inner door cuts the floor. */
  cut: { color: '#e03131', fill: 0.3, dashed: false },
  /** The bridge an open inner door lays across. */
  bridge: { color: '#1c7ed6', fill: 0.28, dashed: false },
  /** A piece from which a door is walked out of. */
  exit: { color: '#f08c00', fill: 0.3, dashed: false },
  /** A cab's area; a car's other cabs take the shades after it (tools/floor `CAB_STYLES`). */
  cab: { color: '#7048e8', fill: 0.18, dashed: false },
  'cab-2': { color: '#ae3ec9', fill: 0.18, dashed: false },
  'cab-3': { color: '#3b5bdb', fill: 0.18, dashed: false },
  'cab-4': { color: '#9c36b5', fill: 0.18, dashed: false },
  /** Zones nobody reaches. */
  unreachable: { color: '#c92a2a', fill: 0.12, dashed: true },
  door: { color: '#e8590c', fill: 0.1, dashed: false },
  'door-inner': { color: '#ae3ec9', fill: 0.1, dashed: false },
  /** A driver's chair. */
  seat: { color: '#1971c2', fill: 0.25, dashed: false },
  /** How far a driver reaches from the chair. */
  reach: { color: '#1971c2', fill: 0.06, dashed: true },
  headlight: { color: '#f59f00', fill: 0.2, dashed: false },
  lamp: { color: '#f59f00', fill: 0.35, dashed: false },
  /** A cabin lamp the preview lights (preview/scene `LAMP_STYLE`, a small circle): bright on the night's dark background. */
  'preview.lamp': { color: '#ffe066', fill: 0.55, dashed: false },
  /** A headlight the preview lights (preview/scene `HEADLIGHT_STYLE`, an arrow the way it shines). */
  'preview.headlight': { color: '#fff3bf', fill: 0, dashed: false },
  /** A hinge: its axis. */
  pivot: { color: '#d6336c', fill: 0, dashed: false },
  /** The travel of a hinge or a slide. */
  travel: { color: '#d6336c', fill: 0, dashed: true },
  /** A suggestion not yet taken (`tools/suggest`). */
  draft: { color: '#495057', fill: 0.08, dashed: true },
  warning: { color: '#e67700', fill: 0.15, dashed: false },
  error: { color: '#e03131', fill: 0.15, dashed: false },
  /** The arrow of a driver's chair that drives forward, and of one that drives backward (tools/seats). */
  'seats.forward': { color: '#099268', fill: 0, dashed: false },
  'seats.back': { color: '#e64980', fill: 0, dashed: false },
  /** A headlight's cone or a cabin lamp of the light group chosen (tools/lights). */
  'lights.chosen': { color: '#f03e3e', fill: 0.3, dashed: false },
});

/** The style a name stands for; `default` for one the table lacks. */
export function overlayStyle(name: string): OverlayStyle {
  return OVERLAY_STYLES[name] ?? (OVERLAY_STYLES.default as OverlayStyle);
}

/** Overlays draw after the model and over it. */
const LINE_ORDER = 30;
const FILL_ORDER = 29;
/** A point's dot, CSS pixels across whatever its distance. */
export const POINT_SIZE = 9;

interface Look {
  readonly color: string | number;
  readonly fill: number;
  readonly dashed: boolean;
}

function lookOf(shape: OverlayShape, selected: boolean): Look {
  const style = overlayStyle(shape.style);
  return selected ? { color: SELECTION_COLOR, fill: Math.min(0.45, Math.max(0.2, style.fill * 2)), dashed: style.dashed } : style;
}

function lines(pairs: readonly (readonly [Vec3, Vec3])[], look: Look): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pairs.flat(2), 3));
  const common = { color: look.color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 };
  const material = look.dashed ? new LineDashedMaterial({ ...common, dashSize: 0.12, gapSize: 0.08 }) : new LineBasicMaterial(common);
  const segments = new LineSegments(geometry, material);
  if (look.dashed) segments.computeLineDistances();
  segments.renderOrder = LINE_ORDER;
  return segments;
}

/** A polyline as segments; closed back to its start when `loop`. */
function polyline(points: readonly Vec3[], loop: boolean): [Vec3, Vec3][] {
  const pairs: [Vec3, Vec3][] = [];
  for (let i = 0; i + 1 < points.length; i++) pairs.push([points[i] as Vec3, points[i + 1] as Vec3]);
  if (loop && points.length > 2) pairs.push([points.at(-1) as Vec3, points[0] as Vec3]);
  return pairs;
}

function fillMaterial(look: Look): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: look.color, transparent: true, opacity: look.fill, depthTest: false, depthWrite: false, side: DoubleSide });
}

function fill(geometry: BufferGeometry, look: Look): Mesh {
  const mesh = new Mesh(geometry, fillMaterial(look));
  mesh.renderOrder = FILL_ORDER;
  return mesh;
}

/** The fill of a flat polygon: its outline triangulated on the plane it lies in. */
function polygonFill(points: readonly Vec3[]): BufferGeometry {
  const [u, v] = polygonAxes(polygonNormal(points));
  const triangles = ShapeUtils.triangulateShape(
    points.map((p) => new Vector2(p[u], p[v])),
    [],
  );
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points.flat(), 3));
  geometry.setIndex(triangles.flat());
  return geometry;
}

/** A cone at `tip` pointing along `direction`, `size` long. */
function head(tip: Vec3, direction: Vec3, size: number, look: Look): Mesh {
  const cone = new Mesh(new ConeGeometry(size * 0.35, size, 12), new MeshBasicMaterial({ color: look.color, depthTest: false, depthWrite: false, transparent: true }));
  const along = new Vector3(...normalize(direction));
  cone.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), along));
  // the cone's centre is half its length behind the tip
  cone.position.set(...tip).addScaledVector(along, -size / 2);
  cone.renderOrder = LINE_ORDER;
  return cone;
}

/** The three.js objects of one shape. */
export function shapeObject(shape: OverlayShape, selected: boolean): Object3D {
  const look = lookOf(shape, selected);
  const group = new Group();
  switch (shape.shape) {
    case 'box': {
      const [min, max] = ordered(shape.min, shape.max);
      group.add(lines(boxEdges(min, max), look));
      if (look.fill > 0) {
        const size = sub(max, min);
        const box = fill(new BoxGeometry(Math.max(size[0], 1e-4), Math.max(size[1], 1e-4), Math.max(size[2], 1e-4)), look);
        box.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
        group.add(box);
      }
      break;
    }
    case 'rect': {
      const corners = rectCorners(shape.min, shape.max);
      group.add(lines(polyline(corners, true), look));
      if (look.fill > 0) {
        const [min, max] = ordered(shape.min, shape.max);
        const plane = fill(new PlaneGeometry(Math.max(max[0] - min[0], 1e-4), Math.max(max[2] - min[2], 1e-4)), look);
        plane.rotation.x = -Math.PI / 2;
        plane.position.set((min[0] + max[0]) / 2, shape.min[1], (min[2] + max[2]) / 2);
        group.add(plane);
      }
      break;
    }
    case 'polygon': {
      group.add(lines(polyline(shape.points, true), look));
      if (look.fill > 0 && shape.points.length >= 3) group.add(fill(polygonFill(shape.points), look));
      break;
    }
    case 'point': {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(shape.at, 3));
      const dot = new Points(geometry, new PointsMaterial({ color: look.color, size: POINT_SIZE, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true }));
      dot.renderOrder = LINE_ORDER;
      group.add(dot);
      break;
    }
    case 'circle': {
      group.add(lines(polyline(circlePoints(shape.centre, shape.radius), true), look));
      if (look.fill > 0) {
        const disc = fill(new CircleGeometry(shape.radius, 64), look);
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(...shape.centre);
        group.add(disc);
      }
      break;
    }
    case 'arrow': {
      const along = sub(shape.to, shape.from);
      const size = Math.min(0.3, length(along) * 0.3);
      group.add(lines([[shape.from, shape.to]], look));
      if (size > 0) group.add(head(shape.to, along, size, look));
      break;
    }
    case 'arc': {
      const points = arcPoints(shape.centre, shape.axis, shape.from, shape.degrees);
      group.add(lines(polyline(points, false), look));
      const tangent = arcEndTangent(shape.centre, shape.axis, shape.from, shape.degrees);
      const radius = length(sub(shape.from, shape.centre));
      const size = Math.min(0.2, radius * 0.3);
      if (size > 0 && length(tangent) > 0) group.add(head(points.at(-1) as Vec3, tangent, size, look));
      break;
    }
  }
  group.userData.style = shape.style;
  return group;
}

/** One overlay layer as three.js objects; `isSelected` says which links are selected. */
export function layerObject(layer: string, shapes: readonly OverlayShape[], isSelected: (link: Link) => boolean): Group {
  const group = new Group();
  group.name = `overlay:${layer}`;
  for (const shape of shapes) group.add(shapeObject(shape, shape.link !== undefined && isSelected(shape.link)));
  return group;
}

/** Frees the GPU's copies of a layer's objects. */
export function disposeLayer(group: Object3D): void {
  group.traverse((object) => {
    if (object instanceof Mesh || object instanceof LineSegments || object instanceof Points) {
      (object.geometry as BufferGeometry).dispose();
      (object.material as Material).dispose();
    }
  });
  group.clear();
}
