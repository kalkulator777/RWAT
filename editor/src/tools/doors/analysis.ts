/**
 * What the doors tool draws over the model (docs/proposals/editor.md §3.9), worked out by
 * the ports of the engine's own rules at every edit:
 *
 * - each door's box as the file has it (an inner door in a colour of its own);
 * - its axis and which way is out (`WagonType.Door.axis`, `outward`: thin across the car a
 *   side door, thin along it an end door; out to the side of the centre it lies on), an
 *   arrow from its inner face through the leaf;
 * - its inner face, towards the car's middle (`innerFace`): where the floor has to end for
 *   a hull or gangway door to be walked through;
 * - for a hull or gangway door, its span less 0.1 at each end (`RiderWalk.DOOR_SPAN_INSET`)
 *   in front of the inner face, a body's half-width deep: where a rider walks out through
 *   it (`FloorCheck.walkablePieces`);
 * - for an inner door, the bridge it lays open (`FloorCheck.bridge`, ±0.6 past its faces):
 *   in the warning colour when the floor reaches it on one side only or on none — a bridge
 *   beside the aisle, which the floor check does not see when the rooms behind it have doors
 *   of their own (`ExamplePackLoadTest`, "salon_arch off the aisle");
 * - which leaves each door moves: the centre of each leaf the model moves by name, at the
 *   door whose box holds it (`WagonType.doorHolding`, ±0.1; ../../preview/doors `leafDoor`),
 *   and each piece an `.anim` moves, at the door named as it (`animatedDoor`); a leaf or an
 *   animation no door takes, in the warning colour;
 * - the floor zones, as the edges snap to them.
 *
 * Boxes are drawn from the file even when the type does not load; the leaves and the
 * bridges' floor need the type as the engine reads it. The ports work in the engine's model
 * frame (ports/objFrame); the shapes are turned back into the OBJ frame the view and the
 * file use. Pure: no DOM, no signals.
 */

import type { LoadedModel, Link, OverlayShape, Vec3 } from '../../core/contracts';
import { bridge } from '../../ports/floorCheck';
import { Cut, type FloorRegion } from '../../ports/floorRegion';
import { box as modelBox, toObj } from '../../ports/objFrame';
import { DOOR_SPAN_INSET, PLAYER_HALF_WIDTH } from '../../ports/riderWalk';
import { Door, type WagonType } from '../../ports/wagonType';
import { animatedDoor, leafDoor } from '../../preview/doors';
import { planFromModel } from '../floor/analysis';
import { zonesOf, type PlanRect } from '../floor/zones';
import { doorLink, doorsOf, type DoorBox, type DoorEntry } from './doors';

/** The tool's overlay layers, in drawing order. */
export const DOORS_LAYERS = ['doors.zones', 'doors.spans', 'doors.bridges', 'doors.faces', 'doors.boxes', 'doors.axes', 'doors.leaves'] as const;

export type DoorsLayer = (typeof DOORS_LAYERS)[number];

/** How far the arrow of a door's way out reaches past its outer face, blocks. */
export const ARROW_OUT = 0.6;

/** Where a door's bridge meets the floor, with every door between zones shut: on both sides of its leaf, on one, on none. */
export type BridgeReach = 'both' | 'one' | 'none';

/** Which way a door leads out of the car. */
export type DoorOut = 'left' | 'right' | 'front' | 'rear';

/** A door that moves something of the model: a leaf moved by name, or an `.anim`'s pieces. */
export interface DoorMover {
  /** The leaf's key (`DOOR_5`), or the animation's id (`salon_door`). */
  readonly name: string;
  readonly kind: 'leaf' | 'anim';
  /** Its objects, in the model's order. */
  readonly objects: readonly string[];
  /** The type's door it moves with, −1 for none. */
  readonly door: number;
  /** Where it is, OBJ frame: a leaf's centre (of its drawn faces), or the centre of each piece of an animation. */
  readonly points: readonly Vec3[];
}

/** What the tool shows of one door. */
export interface DoorInfo {
  readonly index: number;
  readonly entry: DoorEntry;
  /** The door as the engine reads it (model frame), null when its box cannot be read. */
  readonly door: Door | null;
  /** In which wall it stands: a side wall (thin across the car) or an end wall (thin along it). */
  readonly wall: 'side' | 'end' | null;
  /** Which way is out: the left side (+z of the OBJ frame), the right (−z), the front end (−x), the rear (+x). */
  readonly out: DoorOut | null;
  /** The box across the wall, blocks. */
  readonly thickness: number;
  /** The box along the wall, blocks. */
  readonly width: number;
  /** Where its bridge meets the floor (an inner door of a type that loads), else null. */
  readonly bridge: BridgeReach | null;
}

/** What the tool shows of the open wagon's doors. */
export interface DoorsPicture {
  readonly doors: readonly DoorInfo[];
  /** What the model moves with the doors: leaves by name, then animations; empty while the model or the type is not there. */
  readonly movers: readonly DoorMover[];
  /** The shapes of each layer. */
  readonly layers: Readonly<Record<DoorsLayer, OverlayShape[]>>;
}

function emptyLayers(): Record<DoorsLayer, OverlayShape[]> {
  return Object.fromEntries(DOORS_LAYERS.map((layer) => [layer, []])) as unknown as Record<DoorsLayer, OverlayShape[]>;
}

/** The engine's door of a file's entry (model frame), or null when its box cannot be read. */
export function engineDoor(entry: DoorEntry): Door | null {
  const box = entry.box;
  if (box === null) return null;
  const [minX, minY, minZ, maxX, maxY, maxZ] = modelBox([box.minX, box.minY, box.minZ], [box.maxX, box.maxY, box.maxZ]);
  return new Door(entry.id ?? '', minX, minY, minZ, maxX, maxY, maxZ, entry.inner, entry.fixed, entry.connecting, entry.group);
}

/** Which way is out for a door. */
function outOf(door: Door): DoorOut {
  // the model's +X is the OBJ's +Z, the left side; its +Z, forward, the OBJ's −X
  if (door.axis() === 0) return door.outward() > 0 ? 'left' : 'right';
  return door.outward() > 0 ? 'front' : 'rear';
}

/** A point of the model frame given by its value along a door's axis, along its wall and up: in the OBJ frame. */
function at(door: Door, across: number, along: number, y: number): Vec3 {
  return door.axis() === 0 ? toObj(across, y, along) : toObj(along, y, across);
}

/** A plan rectangle of the model frame, across the door's wall [a0, a1] and along it [b0, b1], in the OBJ frame. */
function planAt(door: Door, a0: number, a1: number, b0: number, b1: number): PlanRect {
  const [acrossLo, acrossHi] = [Math.min(a0, a1), Math.max(a0, a1)];
  const [alongLo, alongHi] = [Math.min(b0, b1), Math.max(b0, b1)];
  return door.axis() === 0 ? planFromModel(acrossLo, alongLo, acrossHi, alongHi) : planFromModel(alongLo, acrossLo, alongHi, acrossHi);
}

function rect(plan: PlanRect, y: number, style: string, link: Link): OverlayShape {
  return { shape: 'rect', min: [plan.minX, y, plan.minZ], max: [plan.maxX, y, plan.maxZ], style, link };
}

/** The floor with every door between zones shut (`Interior.region(margin, doors, 0)`), as the floor check walks it; null without one. */
export function shutFloor(type: WagonType): FloorRegion | null {
  return type.interior?.region(PLAYER_HALF_WIDTH, type.doors, 0) ?? null;
}

/**
 * Where an open inner door's bridge meets the floor with every door between zones shut
 * (`shut`, {@link shutFloor} of the type): the pieces it touches on the near side of its
 * leaf and on the far side, as the floor check tells them apart (a piece ending at or
 * before the leaf's cut is on the near side).
 */
export function bridgeReach(type: WagonType, index: number, shut: FloorRegion | null = shutFloor(type)): BridgeReach | null {
  const door = type.doors[index];
  if (door === undefined || !door.inner || shut === null) return null;
  const [minX, minZ, maxX, maxZ] = bridge(door);
  const cut = Cut.shut(door, PLAYER_HALF_WIDTH);
  let near = false;
  let far = false;
  for (const piece of shut.pieces) {
    if (!piece.touches(minX, minZ, maxX, maxZ)) continue;
    const end = door.axis() === 0 ? piece.maxX : piece.maxZ;
    if (end <= (door.axis() === 0 ? cut.minX : cut.minZ) + 1.0e-6) near = true;
    else far = true;
  }
  return near && far ? 'both' : near || far ? 'one' : 'none';
}

/** What the model moves with the doors of `type`: each leaf moved by name at the door holding its centre, each animation at the door of its id. */
export function moversOf(model: LoadedModel, type: WagonType): DoorMover[] {
  const engine = model.engine;
  if (engine === null) return [];
  const leaves = engine.doorLeaves.map((leaf, i): DoorMover => {
    const centre = [0, 1, 2].map((a) => ((leaf.boxMin[a] as number) + (leaf.boxMax[a] as number)) / 2) as Vec3;
    return {
      name: leaf.role.key,
      kind: 'leaf',
      objects: model.objects.filter((o) => o.engine.place === 'DOOR_LEAF' && o.engine.index === i).map((o) => o.name),
      door: leafDoor(type, leaf.boxMin, leaf.boxMax),
      points: [toObj(...centre)],
    };
  });
  const animations = engine.doors.map((anim): DoorMover => ({
    name: anim.id,
    kind: 'anim',
    objects: anim.objects,
    door: animatedDoor(type, anim.id),
    points: anim.objects.flatMap((name) => {
      const object = model.objects.find((o) => o.name === name);
      if (object === undefined) return [];
      const [lo, hi] = object.bbox;
      return [[(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] as Vec3];
    }),
  }));
  return [...leaves, ...animations];
}

/**
 * The picture of a wagon type's doors: `typeJson` as the file has it (its doors are drawn
 * even when the type does not load), `type` as the engine reads it (null: it does not),
 * `model` as the view shows it (null: not read yet).
 */
export function doorsPicture(wagon: string, typeJson: unknown, type: WagonType | null, model: LoadedModel | null): DoorsPicture {
  const layers = emptyLayers();
  const entries = doorsOf(typeJson);
  // the type's doors are the file's, one for one, when it loads; the shut floor is measured once
  const loaded = type !== null && type.doors.length === entries.length ? type : null;
  let shut: FloorRegion | null | undefined;
  const doors: DoorInfo[] = entries.map((entry, index) => {
    const door = engineDoor(entry);
    const link = doorLink(wagon, index);
    const box: DoorBox | null = entry.box;
    if (door === null || box === null) return { index, entry, door, wall: null, out: null, thickness: 0, width: 0, bridge: null };
    const style = entry.inner ? 'door-inner' : 'door';
    layers['doors.boxes'].push({ shape: 'box', min: [box.minX, box.minY, box.minZ], max: [box.maxX, box.maxY, box.maxZ], style, link });

    const out = door.outward();
    const side = door.axis() === 0;
    const [lo, hi] = side ? [door.minX, door.maxX] : [door.minZ, door.maxZ];
    const along = (door.spanMin() + door.spanMax()) / 2;
    const middle = (door.minY + door.maxY) / 2;
    layers['doors.axes'].push({ shape: 'arrow', from: at(door, door.innerFace(), along, middle), to: at(door, door.outerFace() + out * ARROW_OUT, along, middle), style, link });

    const face = door.innerFace();
    layers['doors.faces'].push({
      shape: 'polygon',
      points: [at(door, face, door.spanMin(), door.minY), at(door, face, door.spanMax(), door.minY), at(door, face, door.spanMax(), door.maxY), at(door, face, door.spanMin(), door.maxY)],
      style: 'doors.face',
      link,
    });

    const foot = box.minY;
    let reach: BridgeReach | null = null;
    if (entry.inner) {
      if (loaded !== null) {
        shut ??= shutFloor(loaded);
        reach = bridgeReach(loaded, index, shut);
      }
      const [bMinX, bMinZ, bMaxX, bMaxZ] = bridge(door);
      layers['doors.bridges'].push(rect(planFromModel(bMinX, bMinZ, bMaxX, bMaxZ), foot, reach === null || reach === 'both' ? 'bridge' : 'warning', link));
    } else if (door.spanMax() - door.spanMin() - 2 * DOOR_SPAN_INSET > 0) {
      const plan = planAt(door, face, face - out * PLAYER_HALF_WIDTH, door.spanMin() + DOOR_SPAN_INSET, door.spanMax() - DOOR_SPAN_INSET);
      layers['doors.spans'].push(rect(plan, foot, 'exit', link));
    }
    return { index, entry, door, wall: side ? 'side' : 'end', out: outOf(door), thickness: hi - lo, width: door.spanMax() - door.spanMin(), bridge: reach };
  });

  const movers = model === null || type === null ? [] : moversOf(model, type);
  for (const mover of movers) {
    const link: Link = mover.door >= 0 ? doorLink(wagon, mover.door) : { kind: 'object', model: model?.id ?? wagon, name: mover.objects[0] ?? mover.name };
    for (const point of mover.points) layers['doors.leaves'].push({ shape: 'point', at: point, style: mover.door >= 0 ? 'doors.leaf' : 'warning', link });
  }

  for (const zone of zonesOf(typeJson)) {
    if (zone !== null) layers['doors.zones'].push({ shape: 'rect', min: [zone.minX, zone.minY, zone.minZ], max: [zone.maxX, zone.minY, zone.maxZ], style: 'zone' });
  }
  return { doors, movers, layers };
}

/** What the model moves with door `index`. */
export function moversOfDoor(picture: DoorsPicture, index: number): DoorMover[] {
  return picture.movers.filter((mover) => mover.door === index);
}
