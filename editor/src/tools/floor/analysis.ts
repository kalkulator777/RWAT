/**
 * What the floor tool draws over the model (docs/proposals/editor.md §3.9), worked out by
 * the ports of the engine's own logic at every edit:
 *
 * - the zones as the file has them (a zone that holds no place a player fits — the floor
 *   check's `ZONE_TOO_NARROW` — in the warning colour);
 * - the pieces of the floor a player's centre stands on (`FloorRegion`, ports/floorRegion)
 *   with the doors shut, open or as the preview has them;
 * - where a shut inner door stands across the floor (`FloorRegion.Cut.shut`: the floor's
 *   pieces stop at it), and the bridge an open one lays across it (`FloorCheck.bridge`);
 * - for each hull and gangway door, the pieces a rider walks out through it from
 *   (`FloorCheck.walkablePieces`), an arrow to the door;
 * - each driver's cab (`CabArea`) in a shade of its own;
 * - the zones nobody walks to (`ZONES_UNREACHABLE`), hatched.
 *
 * The ports work in the engine's model frame (ports/objFrame); the shapes are turned back
 * into the OBJ frame the view and the file use. Each layer is drawn on the floor under it:
 * the highest zone's `min.y` there. Pure: no DOM, no signals.
 */

import type { FloorFinding, Link, OverlayShape, Vec3 } from '../../core/contracts';
import { cabArea } from '../../ports/cabArea';
import { bridge, findings as floorFindings, walkablePieces } from '../../ports/floorCheck';
import { Cut, type Piece } from '../../ports/floorRegion';
import { toObj } from '../../ports/objFrame';
import { PLAYER_HALF_WIDTH } from '../../ports/riderWalk';
import type { Door, WagonType } from '../../ports/wagonType';
import { cabStyle } from '../common/styles';
import { zoneLink, zonesOf, type PlanRect, type ZoneBox } from './zones';

/** Which doors stand open for the drawing of the floor: none, all, or those the preview opened. */
export type DoorState = 'closed' | 'open' | 'preview';

export const DOOR_STATES: readonly DoorState[] = ['closed', 'open', 'preview'];

/** The tool's overlay layers, in drawing order. */
export const FLOOR_LAYERS = ['floor.cabs', 'floor.pieces', 'floor.exits', 'floor.cuts', 'floor.bridges', 'floor.unreachable', 'floor.zones'] as const;

export type FloorLayer = (typeof FLOOR_LAYERS)[number];


/** The space between the strokes of the hatching, blocks along the car. */
const HATCH_STEP = 0.3;
/** A stroke's width, blocks. */
const HATCH_WIDTH = 0.02;

/** What the tool shows of the open wagon's floor. */
export interface FloorPicture {
  /** The zones as the file has them, OBJ frame; null for one that cannot be read. */
  readonly zones: readonly (ZoneBox | null)[];
  /** What the floor check finds (ports/floorCheck), in the engine's order. */
  readonly findings: readonly FloorFinding[];
  /** The open-door bits the pieces are drawn with. */
  readonly openMask: number;
  /** The shapes of each layer. */
  readonly layers: Readonly<Record<FloorLayer, OverlayShape[]>>;
  /** How many pieces of floor a player's centre stands on, with the doors as drawn. */
  readonly pieces: number;
  /** How many driver's cabs the floor has. */
  readonly cabs: number;
  /** The zones nobody walks to, by index. */
  readonly unreachable: readonly number[];
}

/** The open-door bits of a state: none, every door (the first 32), or the preview's. */
export function openMaskOf(state: DoorState, doors: number, preview: number | null): number {
  if (state === 'closed') return 0;
  if (state === 'preview') return preview ?? 0;
  let bits = 0;
  for (let i = 0; i < Math.min(doors, 32); i++) bits |= 1 << i;
  return bits;
}

/** A box of the model frame's plan (`minX, minZ, maxX, maxZ`) as a plan of the OBJ frame. */
export function planFromModel(minX: number, minZ: number, maxX: number, maxZ: number): PlanRect {
  return { minX: -maxZ, minZ: minX, maxX: -minZ, maxZ: maxX };
}

/** The floor's height at a point of the OBJ plan: the highest zone over it, else the lowest zone; 0 with none. */
export function floorAt(zones: readonly (ZoneBox | null)[], x: number, z: number): number {
  let over = Number.NEGATIVE_INFINITY;
  let lowest = Number.POSITIVE_INFINITY;
  for (const zone of zones) {
    if (zone === null) continue;
    lowest = Math.min(lowest, zone.minY);
    if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) over = Math.max(over, zone.minY);
  }
  if (over > Number.NEGATIVE_INFINITY) return over;
  return lowest < Number.POSITIVE_INFINITY ? lowest : 0;
}

function rect(plan: PlanRect, y: number, style: string, link?: Link): OverlayShape {
  const shape: OverlayShape = { shape: 'rect', min: [plan.minX, y, plan.minZ], max: [plan.maxX, y, plan.maxZ], style };
  if (link !== undefined) shape.link = link;
  return shape;
}

function centre(plan: PlanRect): [number, number] {
  return [(plan.minX + plan.maxX) / 2, (plan.minZ + plan.maxZ) / 2];
}

/** A piece of the region as a rectangle on the floor under it. */
function pieceRect(zones: readonly (ZoneBox | null)[], piece: Piece, style: string, link?: Link): OverlayShape {
  const plan = planFromModel(piece.minX, piece.minZ, piece.maxX, piece.maxZ);
  const [x, z] = centre(plan);
  return rect(plan, floorAt(zones, x, z), style, link);
}

/** Thin diagonal strokes across a zone's plan, at its floor. */
export function hatch(zone: ZoneBox, style: string, link?: Link): OverlayShape[] {
  const strokes: OverlayShape[] = [];
  const y = zone.minY;
  // strokes along x − z = c, c from the corner (minX, maxZ) to the corner (maxX, minZ)
  const first = Math.ceil((zone.minX - zone.maxZ) / HATCH_STEP) * HATCH_STEP;
  for (let c = first; c <= zone.maxX - zone.minZ; c += HATCH_STEP) {
    const from = Math.max(zone.minX, zone.minZ + c);
    const to = Math.min(zone.maxX, zone.maxZ + c);
    if (to - from < HATCH_WIDTH) continue;
    const points: Vec3[] = [
      [from, y, from - c],
      [to, y, to - c],
      [to - HATCH_WIDTH, y, to - c],
      [from - HATCH_WIDTH, y, from - c],
    ];
    const stroke: OverlayShape = { shape: 'polygon', points, style };
    if (link !== undefined) stroke.link = link;
    strokes.push(stroke);
  }
  return strokes;
}

/** The middle of a door's box on the OBJ plan, at its foot. */
function doorFoot(door: Door): Vec3 {
  return toObj((door.minX + door.maxX) / 2, door.minY, (door.minZ + door.maxZ) / 2);
}

function emptyLayers(): Record<FloorLayer, OverlayShape[]> {
  return Object.fromEntries(FLOOR_LAYERS.map((layer) => [layer, []])) as unknown as Record<FloorLayer, OverlayShape[]>;
}

/**
 * The picture of a wagon type's floor: `typeJson` as the file has it (its zones are drawn
 * even when the type does not load), `type` as the engine reads it (null: it does not),
 * the doors open as `state` says (`preview`: the preview's open-door bits).
 */
export function floorPicture(wagon: string, typeJson: unknown, type: WagonType | null, state: DoorState, preview: number | null): FloorPicture {
  const zones = zonesOf(typeJson);
  const layers = emptyLayers();
  const found = type === null ? [] : floorFindings(type);
  const narrow = new Set(found.filter((f) => f.code === 'ZONE_TOO_NARROW').map((f) => f.index));
  const unreachable = found.find((f) => f.code === 'ZONES_UNREACHABLE')?.params.zones;
  const unreached = Array.isArray(unreachable) ? unreachable : [];
  const doors = type?.doors ?? [];
  const openMask = openMaskOf(state, doors.length, preview);
  let pieces = 0;
  let cabs = 0;

  zones.forEach((zone, i) => {
    if (zone === null) return;
    const link = zoneLink(wagon, i);
    layers['floor.zones'].push(rect(zone, zone.minY, narrow.has(i) ? 'warning' : 'zone', link));
    if (unreached.includes(i)) {
      layers['floor.unreachable'].push(rect(zone, zone.minY, 'unreachable'), ...hatch(zone, 'unreachable'));
    }
  });

  const interior = type?.interior ?? null;
  if (type !== null && interior !== null) {
    const region = interior.region(PLAYER_HALF_WIDTH, doors, openMask);
    pieces = region.pieces.length;
    for (const piece of region.pieces) layers['floor.pieces'].push(pieceRect(zones, piece, 'piece'));
    doors.forEach((door, d) => {
      const link: Link = { kind: 'door', type: wagon, index: d };
      if (door.inner) {
        if (!door.open(openMask, d)) {
          // where it stands across the floor, whether or not a zone reaches it there
          const cut = Cut.shut(door, PLAYER_HALF_WIDTH);
          const plan = planFromModel(cut.minX, cut.minZ, cut.maxX, cut.maxZ);
          layers['floor.cuts'].push(rect(plan, floorAt(zones, ...centre(plan)), 'cut', link));
          return;
        }
        const [minX, minZ, maxX, maxZ] = bridge(door);
        const plan = planFromModel(minX, minZ, maxX, maxZ);
        layers['floor.bridges'].push(rect(plan, floorAt(zones, ...centre(plan)), 'bridge', link));
        return;
      }
      const exits = walkablePieces(door, region);
      if (exits.length === 0) return;
      const foot = doorFoot(door);
      let nearest: [number, number] | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const p of exits) {
        const piece = region.pieces[p] as Piece;
        layers['floor.exits'].push(pieceRect(zones, piece, 'exit', link));
        const [x, z] = centre(planFromModel(piece.minX, piece.minZ, piece.maxX, piece.maxZ));
        const distance = Math.hypot(x - foot[0], z - foot[2]);
        if (distance < nearestDistance) {
          nearest = [x, z];
          nearestDistance = distance;
        }
      }
      if (nearest !== null) {
        const y = floorAt(zones, nearest[0], nearest[1]);
        layers['floor.exits'].push({ shape: 'arrow', from: [nearest[0], y, nearest[1]], to: [foot[0], y, foot[2]], style: 'exit', link });
      }
    });
    const area = cabArea(type);
    cabs = area.cabs();
    area.region?.pieces.forEach((piece, p) => {
      const cab = area.cabOfPiece[p] ?? -1;
      if (cab >= 0) layers['floor.cabs'].push(pieceRect(zones, piece, cabStyle(cab)));
    });
  }
  return { zones, findings: found, openMask, layers, pieces, cabs, unreachable: unreached };
}
