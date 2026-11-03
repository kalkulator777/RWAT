/**
 * The driver's chairs of a wagon type as its file writes them (`cab.seats`, schema
 * `wagon_type.schema.json#/$defs/seat`), the commands that edit them and what the engine
 * makes of them. Everything is in the OBJ frame, as the file has it (`x-frame: obj`): a
 * chair's `at` is the top of its cushion, `yaw` which way the driver faces.
 *
 * - `cab.seats` is a list of `{at, yaw}`, at most {@link MAX_SEATS}. The old form, one chair
 *   as `cab.seat` (+ `cab.seat_yaw`), is read as a list of one and written as `seats` at the
 *   first edit; both at once are an error of the format (the type does not load): the
 *   chairs are `seats`', and the first edit takes the old keys away.
 * - A chair placed in a type without `cab` makes the cab (`{seats: [...]}`): the car can be
 *   driven then. Removing the last chair removes `seats`, leaving `cab: {}` — a cab
 *   without chairs, as the format has it.
 * - What the engine makes of them: the floor check's word on whether a chair can be sat
 *   down in (`SEAT_NOT_SITTABLE`, ports/floorCheck), the cab each is in (ports/cabArea), and
 *   where one stands to sit down — the nearest point of the floor a player's centre fits on
 *   (`FloorRegion.nearest`, as the engine's tests of the example pack measure it).
 */

import type { Command, FloorFinding, JsonPointer, Op, Vec3 } from '../../core/contracts';
import { isJsonObject } from '../../core/json';
import { cabArea } from '../../ports/cabArea';
import { findings } from '../../ports/floorCheck';
import { toObj } from '../../ports/objFrame';
import { PLAYER_HALF_WIDTH } from '../../ports/riderWalk';
import { MAX_SEATS, type WagonType } from '../../ports/wagonType';
import type { EditOptions, Place, PlaceFacts, PlaceKind } from './places';

const CAB: JsonPointer = '/cab';
const SEATS: JsonPointer = '/cab/seats';
const OLD_SEAT: JsonPointer = '/cab/seat';
const OLD_YAW: JsonPointer = '/cab/seat_yaw';

/** How the file writes its chairs. */
export type ChairsForm = 'no-cab' | 'none' | 'list' | 'old' | 'both';

function cabOf(typeJson: unknown): Record<string, unknown> | null {
  if (!isJsonObject(typeJson)) return null;
  return isJsonObject(typeJson.cab) ? typeJson.cab : null;
}

/** How the file writes its chairs: no cab, a cab without chairs, the list, the old one-chair form, or both forms at once (an error). */
export function chairsForm(typeJson: unknown): ChairsForm {
  const cab = cabOf(typeJson);
  if (cab === null) return 'no-cab';
  const list = Object.hasOwn(cab, 'seats');
  const old = Object.hasOwn(cab, 'seat');
  if (list && old) return 'both';
  if (old) return 'old';
  return list ? 'list' : 'none';
}

function vec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  return value.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (value as Vec3) : null;
}

function yawOf(value: unknown): number | null {
  if (value === undefined) return 0;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** One chair of `cab.seats`, or null when its `at` is not three numbers or its `yaw` no number. */
export function chairOf(value: unknown): Place | null {
  if (!isJsonObject(value)) return null;
  const at = vec3(value.at);
  const yaw = yawOf(value.yaw);
  return at === null || yaw === null ? null : { at, yaw };
}

/** The chairs as the file has them, as JSON: the list, the old chair as a list of one, nothing without. */
function chairsJson(typeJson: unknown): unknown[] {
  const cab = cabOf(typeJson);
  if (cab === null) return [];
  if (Array.isArray(cab.seats)) return cab.seats;
  if (Object.hasOwn(cab, 'seats')) return [];
  if (!Object.hasOwn(cab, 'seat')) return [];
  // the old form as one element of the list: its yaw only if the file wrote one
  return [Object.hasOwn(cab, 'seat_yaw') ? { at: cab.seat, yaw: cab.seat_yaw } : { at: cab.seat }];
}

/** The chairs of a type's JSON in the file's order; one that cannot be read is null. */
export function chairsOf(typeJson: unknown): (Place | null)[] {
  return chairsJson(typeJson).map(chairOf);
}

/** A chair's JSON as the tool writes it: `{at, yaw}`, the yaw always written. */
export function chairJson(place: Place): { at: number[]; yaw: number } {
  return { at: [...place.at], yaw: place.yaw };
}

/** The ops that leave only the list form before an edit addresses it: the old chair becomes `seats`, an old key beside `seats` goes. */
function listOps(file: string, typeJson: unknown): Op[] {
  const cab = cabOf(typeJson);
  const form = chairsForm(typeJson);
  if (cab === null || (form !== 'old' && form !== 'both')) return [];
  const ops: Op[] = [{ op: 'remove', file, at: OLD_SEAT }];
  if (Object.hasOwn(cab, 'seat_yaw')) ops.push({ op: 'remove', file, at: OLD_YAW });
  if (form === 'old') ops.push({ op: 'set', file, at: SEATS, value: chairsJson(typeJson) });
  return ops;
}

function command(label: string, params: Record<string, number>, ops: Op[], coalesceKey?: string): Command {
  const out: Command = { label, labelParams: params, ops };
  if (coalesceKey !== undefined) out.coalesceKey = coalesceKey;
  return out;
}

/** Adds a chair at the end of the list (chair `count`): the list made when there is none, the cab too. */
export function addChair(file: string, typeJson: unknown, place: Place, options: EditOptions = {}): Command {
  const chairs = chairsJson(typeJson);
  const json = chairJson(place);
  const form = chairsForm(typeJson);
  let ops: Op[];
  if (chairs.length >= MAX_SEATS) ops = [];
  else if (form === 'no-cab') ops = [{ op: 'set', file, at: CAB, value: { seats: [json] } }];
  else if (form === 'none' || (form === 'list' && !Array.isArray(cabOf(typeJson)?.seats))) ops = [{ op: 'set', file, at: SEATS, value: [json] }];
  else ops = [...listOps(file, typeJson), { op: 'insert', file, at: `${SEATS}/-`, value: json }];
  return command(options.label ?? 'tools.seats.cmd.add', { index: chairs.length }, ops, options.coalesceKey);
}

/**
 * Puts chair `index` where `place` says: its `at` written whole if it changed, its `yaw`
 * if it changed; no op for a chair already so. `label` names the gesture in the journal.
 */
export function setChair(file: string, typeJson: unknown, index: number, place: Place, options: EditOptions = {}): Command {
  const before = chairsJson(typeJson)[index];
  const ops: Op[] = [];
  if (before !== undefined) {
    const now = chairJson(place);
    const old = isJsonObject(before) ? before : {};
    const atChanged = JSON.stringify(old.at) !== JSON.stringify(now.at);
    // a chair that writes no yaw faces 0: it is written when it turns, not when it moves
    const yawChanged = (Object.hasOwn(old, 'yaw') ? old.yaw : 0) !== now.yaw;
    if (atChanged || yawChanged) {
      ops.push(...listOps(file, typeJson));
      if (!isJsonObject(before)) ops.push({ op: 'set', file, at: `${SEATS}/${index}`, value: now });
      else {
        if (atChanged) ops.push({ op: 'set', file, at: `${SEATS}/${index}/at`, value: now.at });
        if (yawChanged) ops.push({ op: 'set', file, at: `${SEATS}/${index}/yaw`, value: now.yaw });
      }
    }
  }
  return command(options.label ?? 'tools.seats.cmd.set', { index }, ops, options.coalesceKey);
}

/** Removes chair `index`; the last one takes `seats` (or the old `seat`) with it, the cab stays. */
export function removeChair(file: string, typeJson: unknown, index: number): Command {
  const chairs = chairsJson(typeJson);
  const out = command('tools.seats.cmd.remove', { index }, []);
  if (index < 0 || index >= chairs.length) return out;
  const form = chairsForm(typeJson);
  if (chairs.length > 1) out.ops = [...listOps(file, typeJson), { op: 'remove', file, at: `${SEATS}/${index}` }];
  else if (form === 'old') out.ops = listOps(file, typeJson).slice(0, -1);
  else out.ops = [...listOps(file, typeJson), { op: 'remove', file, at: SEATS }];
  return out;
}

/** Moves chair `from` to place `to` in the list (the first manned chair drives). */
export function reorderChair(file: string, typeJson: unknown, from: number, to: number): Command {
  const chairs = chairsJson(typeJson);
  const out = command('tools.seats.cmd.order', { from, to }, []);
  if (from === to || from < 0 || to < 0 || from >= chairs.length || to >= chairs.length) return out;
  out.ops = [...listOps(file, typeJson), { op: 'remove', file, at: `${SEATS}/${from}` }, { op: 'insert', file, at: `${SEATS}/${to}`, value: chairs[from] }];
  return out;
}

/** Where chair `index` is in the file: an element of `seats`, or the old `seat`. */
export function chairPointer(typeJson: unknown, index: number): JsonPointer {
  return chairsForm(typeJson) === 'old' ? OLD_SEAT : `${SEATS}/${index}`;
}

const FOUND = new WeakMap<WagonType, FloorFinding[]>();

/** What the floor check finds of a type (ports/floorCheck `findings`), worked out once a type. */
export function floorFindingsOf(type: WagonType): FloorFinding[] {
  let found = FOUND.get(type);
  if (found === undefined) {
    found = findings(type);
    FOUND.set(type, found);
  }
  return found;
}

/** What the engine makes of the chairs of a type that loads (model frame in, OBJ frame out). */
export function chairFacts(type: WagonType): PlaceFacts[] {
  const seats = type.cab?.seats ?? [];
  if (seats.length === 0) return [];
  const unsittable = new Set(floorFindingsOf(type).flatMap((f) => (f.code === 'SEAT_NOT_SITTABLE' ? [f.index] : [])));
  const area = cabArea(type);
  const interior = type.interior;
  const region = interior?.region(PLAYER_HALF_WIDTH) ?? null;
  return seats.map((seat, i) => {
    const spot = region?.nearest(seat.x, seat.z) ?? null;
    const floor = spot === null || interior === null ? NaN : interior.floorAt(spot[0], spot[1], PLAYER_HALF_WIDTH);
    const stand = spot === null || Number.isNaN(floor) ? null : toObj(spot[0], floor, spot[1]);
    return {
      stand,
      reach: spot === null ? Number.POSITIVE_INFINITY : Math.hypot(spot[0] - seat.x, spot[1] - seat.z),
      height: seat.y - floor,
      sittable: !unsittable.has(i),
      cab: area.cabOfChair(i),
    };
  });
}

/** The driver's chairs (`cab.seats`): the one kind of place so far. */
export const DRIVER_CHAIRS: PlaceKind = {
  id: 'driver',
  link: 'seat',
  limit: MAX_SEATS,
  title: 'tools.seats.kind.driver',
  drives: true,
  places: chairsOf,
  pointer: chairPointer,
  add: addChair,
  set: setChair,
  remove: removeChair,
  reorder: reorderChair,
  facts: chairFacts,
};
