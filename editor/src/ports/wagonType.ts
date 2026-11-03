/**
 * A wagon type as the engine holds it, read from the pack's JSON as the engine reads it:
 * port of `stock/WagonTypeParser.java` (with the strict reading of `pack/PackJson.java`
 * it uses), `stock/WagonType.java` and the per-file steps of `pack/WagonTypeLoader.java`
 * (golden `fixtures/golden/wagon_type/`).
 *
 * The markup — the `interior` zones, the `doors` boxes, the `cab` chairs — is written in
 * the OBJ frame and turned into the engine's model frame here (./objFrame), so a
 * {@link WagonType} holds model-frame geometry only, as Java's does. Physics a pack leaves
 * out takes the engine's defaults (./stockDefaults).
 *
 * The parser says what the engine says, word for word: a key a section doesn't know is a
 * warning with the nearest known key as a hint; a `null` or a value of the wrong type, a
 * missing required field or impossible geometry is an error ({@link WagonTypeError}) and
 * the type does not load. The checks run in Java's order, so the first error and the
 * warnings before it are Java's.
 *
 * Input is the JSON value as `JSON.parse` gives it. Where Java quotes a number of the file
 * as written (`got the number 1.0`), this port has only the value and writes it as
 * JavaScript does (`the number 1`); the golden cases agree.
 */

import { FloorRegion, Cut, clamp } from './floorRegion';
import { javaDoubleToString } from './javaNumbers';
import { box as objBox, point as objPoint } from './objFrame';
import {
  type Brakes,
  type BrakeSystem,
  type Resistance,
  ADHESION,
  DEFAULT_BRAKE_SYSTEM,
  TRACTION_RAMP_S,
  brakeSystemByName,
  brakes as defaultBrakes,
  resistance as defaultResistance,
} from './stockDefaults';

export type { Brakes, Resistance } from './stockDefaults';

/** A point of the model frame: `[x, y, z]`. */
export type ModelPoint = [number, number, number];

// ---------------------------------------------------------------- numbers as Java writes them

/**
 * A number as a pack author wrote it, for the parser's errors (`WagonTypeParser.format`):
 * a whole number without `.0` (`9`, `-0` as `0`), anything else as Java's
 * `Double.toString` (`0.5`, `1.0E-5`).
 */
export function formatNumber(value: number): string {
  return Number.isInteger(value) && Math.abs(value) < 1.0e15 ? String(Math.trunc(value) + 0) : javaDoubleToString(value);
}

// ---------------------------------------------------------------- strict reading (PackJson)

/** What the loader says when a declaration can't load: the engine's `JsonSyntaxException`, its message as Java's. */
export class WagonTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WagonTypeError';
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function has(object: JsonObject, key: string): boolean {
  return Object.hasOwn(object, key);
}

/** The member `key` of an object, undefined when absent (never a prototype's). */
function get(object: JsonObject, key: string): unknown {
  return has(object, key) ? object[key] : undefined;
}

/** The path of `key` in the object at `where` (`PackJson.at`). */
export function at(where: string, key: string | number): string {
  if (typeof key === 'number') return `${where}[${key}]`;
  return where === '' ? key : `${where}.${key}`;
}

function lowerCase(text: string): string {
  return text.toLowerCase();
}

function bare(key: string): string {
  return key.replace(/[_\- ]/g, '');
}

/** Optimal string alignment distance: insertions, deletions, substitutions, neighbour swaps (`PackJson.distance`). */
function distance(a: string, b: string): number {
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) d.push(new Array<number>(b.length + 1).fill(0));
  const row = (i: number): number[] => d[i] as number[];
  for (let i = 0; i <= a.length; i++) row(i)[0] = i;
  for (let j = 0; j <= b.length; j++) row(0)[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      let best = Math.min(
        Math.min((row(i - 1)[j] as number) + 1, (row(i)[j - 1] as number) + 1),
        (row(i - 1)[j - 1] as number) + cost,
      );
      if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
        best = Math.min(best, (row(i - 2)[j - 2] as number) + 1);
      }
      row(i)[j] = best;
    }
  }
  return row(a.length)[b.length] as number;
}

/**
 * The known key `key` most likely is a typo of, or null if none is close (`PackJson.nearest`):
 * the fewest edits (a swap of two neighbours counts as one), at most about a third of the
 * known key's length (a key of one or two letters only case aside); or one contains the
 * other, underscores aside. Ties go to the key listed first.
 */
export function nearestKey(key: string, known: Iterable<string>): string | null {
  const lower = lowerCase(key);
  const keyBare = bare(lower);
  let best: string | null = null;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  for (const candidate of known) {
    const other = lowerCase(candidate);
    const otherBare = bare(other);
    const d = distance(lower, other);
    const allowed = other.length <= 2 ? 0 : Math.max(1, Math.trunc((other.length + 1) / 3));
    const close =
      d <= allowed || (keyBare.length >= 3 && otherBare.includes(keyBare)) || (otherBare.length >= 3 && keyBare.includes(otherBare));
    if (close && d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/** Warn about every key of `object` that `known` doesn't list, with the nearest known one as a hint (`PackJson.checkKeys`). */
function checkKeys(object: JsonObject, known: readonly string[], where: string, warnings: (text: string) => void): void {
  for (const key of Object.keys(object)) {
    if (known.includes(key)) continue;
    const hint = nearestKey(key, known);
    warnings(`unknown key '${at(where, key)}' (ignored)${hint !== null ? ` — did you mean '${at(where, hint)}'?` : ''}`);
  }
}

/** What a value is, for an error message: `null`, `the string "95"`, `an object` (`PackJson.describe`). */
export function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return `the number ${Object.is(value, -0) ? '-0' : String(value)}`;
  if (typeof value === 'string') return `the string "${value.length > 40 ? `${value.substring(0, 40)}…` : value}"`;
  return 'an object';
}

function wrongType(path: string, expected: string, found: unknown): WagonTypeError {
  return new WagonTypeError(`'${path}' must be ${expected}, got ${describe(found)}`);
}

function asObject(value: unknown, path: string): JsonObject {
  if (!isObject(value)) throw wrongType(path, 'an object', value);
  return value;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw wrongType(path, 'an array', value);
  return value as unknown[];
}

function asNumber(value: unknown, path: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw wrongType(path, 'a finite number', value);
}

function asString(value: unknown, path: string): string {
  if (typeof value === 'string') return value;
  throw wrongType(path, 'a string', value);
}

function asBool(value: unknown, path: string): boolean {
  if (typeof value === 'boolean') return value;
  throw wrongType(path, 'true or false', value);
}

function required(object: JsonObject, key: string, where: string): unknown {
  if (!has(object, key)) throw new WagonTypeError(`missing required field '${at(where, key)}'`);
  return object[key];
}

function optionalNumber(object: JsonObject, key: string, where: string, fallback: number): number {
  return has(object, key) ? asNumber(object[key], at(where, key)) : fallback;
}

function optionalBool(object: JsonObject, key: string, where: string, fallback: boolean): boolean {
  return has(object, key) ? asBool(object[key], at(where, key)) : fallback;
}

function optionalObject(object: JsonObject, key: string, where: string): JsonObject | null {
  return has(object, key) ? asObject(object[key], at(where, key)) : null;
}

function optionalArray(object: JsonObject, key: string, where: string): unknown[] | null {
  return has(object, key) ? asArray(object[key], at(where, key)) : null;
}

// ---------------------------------------------------------------- the type (WagonType)

/** Presence = the wagon produces tractive effort (`WagonType.Traction`). */
export interface Traction {
  readonly powerKw: number;
  readonly maxTractiveEffortKn: number;
  readonly adhesion: number;
  readonly rampS: number;
}

/** Where the couplers engage, each end's offset from the frame end, + outward (`WagonType.Couplers`). */
export interface Couplers {
  readonly front: number;
  readonly rear: number;
}

/** The solid collision hull in the model frame (`WagonType.Hull`). */
export interface Hull {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/**
 * A driver's chair in the model frame (`WagonType.Seat`): the point on top of the
 * cushion and which way the driver faces, `yaw` degrees (0 = model +Z forward, +90 =
 * towards −X), a `float` as in Java.
 */
export class Seat {
  readonly yaw: number;

  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
    yaw: number,
  ) {
    this.yaw = Math.fround(yaw);
  }

  /** This chair as seen in the pose frame — mirrored for a flipped wagon. */
  inFrame(flipped: boolean): Seat {
    return flipped ? new Seat(-this.x, this.y, -this.z, this.yaw + 180.0) : this;
  }

  /** True if the chair looks towards the model's rear (more than 90° off forward); square to the side counts as forward. */
  facesBack(): boolean {
    const off = (((this.yaw % 360.0) + 540.0) % 360.0) - 180.0;
    return Math.abs(off) > 90.0;
  }
}

/** Presence = the consist can be driven from here; its driver's chairs in the pack's order (`WagonType.Cab`). */
export interface Cab {
  readonly seats: readonly Seat[];
}

/** One box of floor in the model frame (`WagonType.Interior.Zone`). */
export class Zone {
  constructor(
    readonly minX: number,
    readonly minY: number,
    readonly minZ: number,
    readonly maxX: number,
    readonly maxY: number,
    readonly maxZ: number,
  ) {}

  /** True if a rider centred at (x, z) fits inside, `margin` off the walls. */
  holds(x: number, z: number, margin: number): boolean {
    return (
      x >= this.minX + margin - EPS &&
      x <= this.maxX - margin + EPS &&
      z >= this.minZ + margin - EPS &&
      z <= this.maxZ - margin + EPS
    );
  }

  /** (x, z) pulled inside, `margin` off the walls, feet on this floor. */
  clamp(x: number, z: number, margin: number): ModelPoint {
    return [clampAxis(x, this.minX, this.maxX, margin), this.minY, clampAxis(z, this.minZ, this.maxZ, margin)];
  }

  mirrored(): Zone {
    return new Zone(-this.maxX, this.minY, -this.maxZ, -this.minX, this.maxY, -this.minZ);
  }
}

const EPS = 1.0e-9;
/** Sets of shut doors' cuts kept at most. */
const MAX_SHUT = 64;

function clampAxis(value: number, min: number, max: number, margin: number): number {
  const lo = min + margin;
  const hi = max - margin;
  if (lo > hi) return (min + max) * 0.5;
  return clamp(value, lo, hi);
}

/**
 * The walkable floor (`WagonType.Interior`): one or more zones in the model frame, the
 * floor their union (./floorRegion). Doors between zones bridge a gap while open; shut,
 * one is wall even where the zones on its two sides touch.
 */
export class Interior {
  readonly zones: readonly Zone[];
  private cached: FloorRegion | null = null;
  private readonly shut = new Map<string, FloorRegion>();
  private mirror: Interior | null = null;

  constructor(zones: readonly Zone[]) {
    if (zones.length === 0) throw new RangeError('an interior needs at least one zone');
    this.zones = [...zones];
  }

  /**
   * Where a rider centred there fits, `margin` (the player's half-width) off every wall;
   * with `doors`, less each shut inner door's cut (bit i of `openMask` = door i open).
   */
  region(margin: number, doors?: readonly Door[], openMask = 0): FloorRegion {
    const cuts: Cut[] = [];
    doors?.forEach((door, i) => {
      if (door.inner && !door.open(openMask, i)) cuts.push(Cut.shut(door, margin));
    });
    if (cuts.length === 0) {
      if (this.cached === null || this.cached.margin !== margin) this.cached = FloorRegion.of(this.zones, margin);
      return this.cached;
    }
    const key = [margin, ...cuts.flatMap((c) => [c.minX, c.minZ, c.maxX, c.maxZ])].join(' ');
    let region = this.shut.get(key);
    if (region === undefined) {
      if (this.shut.size >= MAX_SHUT) this.shut.clear();
      region = FloorRegion.of(this.zones, margin, cuts);
      this.shut.set(key, region);
    }
    return region;
  }

  /** True if a rider centred at (x, z) stands on the floor, `margin` off every wall. */
  fits(x: number, z: number, margin: number): boolean {
    return this.region(margin).fits(x, z);
  }

  /** The lowest floor — where a rider is put when nothing better is known. */
  floorY(): number {
    let floor = Number.MAX_VALUE;
    for (const zone of this.zones) floor = Math.min(floor, zone.minY);
    return floor;
  }

  minX(): number {
    return Math.min(...this.zones.map((z) => z.minX));
  }

  maxX(): number {
    return Math.max(...this.zones.map((z) => z.maxX));
  }

  minZ(): number {
    return Math.min(...this.zones.map((z) => z.minZ));
  }

  maxZ(): number {
    return Math.max(...this.zones.map((z) => z.maxZ));
  }

  /**
   * Clamp a rider's feet to the walkable floor: the nearest point where they fit,
   * `margin` off every wall, y on the floor there; with `doors`, the shut doors between
   * zones standing across the floor. A floor no player fits anywhere gives the nearest
   * zone's midline.
   */
  clampFeet(local: readonly number[], margin: number, doors?: readonly Door[], openMask = 0): ModelPoint {
    const [x = NaN, , z = NaN] = local;
    const region = this.region(margin, doors, openMask);
    const spot = region.nearest(x, z);
    if (spot !== null) {
      const floor = this.floorUnder(spot[0], spot[1]);
      return [spot[0], Number.isNaN(floor) ? this.floorY() : floor, spot[1]];
    }
    let best: ModelPoint | null = null;
    let bestDist = Number.MAX_VALUE;
    for (const zone of this.zones) {
      const c = zone.clamp(x, z, region.margin);
      const d = Math.hypot(c[0] - x, c[2] - z);
      if (d < bestDist - EPS) {
        best = c;
        bestDist = d;
      }
    }
    return best as ModelPoint;
  }

  /** The floor under a rider centred at (x, z) — the highest zone under that point — or NaN if they don't fit there. */
  floorAt(x: number, z: number, margin: number): number {
    return this.fits(x, z, margin) ? this.floorUnder(x, z) : NaN;
  }

  /** The highest zone floor under the point (x, z), or NaN if no zone is. */
  private floorUnder(x: number, z: number): number {
    let floor = NaN;
    for (const zone of this.zones) {
      if (zone.holds(x, z, 0.0) && !(zone.minY <= floor)) floor = zone.minY;
    }
    return floor;
  }

  /** This floor as seen in the frame the wagon's pose puts it in: a flipped wagon is turned 180° about Y. */
  inFrame(flipped: boolean): Interior {
    if (!flipped) return this;
    if (this.mirror === null) {
      const mirror = new Interior(this.zones.map((zone) => zone.mirrored()));
      mirror.mirror = this;
      this.mirror = mirror;
    }
    return this.mirror;
  }
}

/**
 * One doorway in the model frame (`WagonType.Door`): the leaf's box, thin along the wall it
 * sits in (that thinnest horizontal extent is the wall normal, {@link axis}), on the side
 * of the body centre it faces ({@link outward}). `inner` sits between floor zones,
 * `fixed` is an always-open opening without a leaf, `connecting` is an end door onto the
 * gangway. Doors of one `group` (null = on its own) open together, names matched case aside.
 */
export class Door {
  readonly group: string | null;

  constructor(
    readonly id: string,
    readonly minX: number,
    readonly minY: number,
    readonly minZ: number,
    readonly maxX: number,
    readonly maxY: number,
    readonly maxZ: number,
    readonly inner = false,
    readonly fixed = false,
    readonly connecting = false,
    group: string | null = null,
  ) {
    this.group = group === null || group === '' ? null : group;
  }

  /** True if this door opens and closes together with `other` (same group, case aside). */
  groupedWith(other: Door): boolean {
    return this.group !== null && equalsIgnoreCase(this.group, other.group);
  }

  /** True for a way in from outside: neither between zones nor onto a gangway. */
  external(): boolean {
    return !this.inner && !this.connecting;
  }

  /** True if this doorway lets a rider through now, given the open-door bits. */
  open(openMask: number, index: number): boolean {
    return this.fixed || (index < 32 && ((openMask >> index) & 1) !== 0);
  }

  /** The face towards the wagon centre, along {@link axis}. */
  innerFace(): number {
    return this.axis() === 0 ? (this.outward() > 0 ? this.minX : this.maxX) : this.outward() > 0 ? this.minZ : this.maxZ;
  }

  /** The face away from the wagon centre, along {@link axis}. */
  outerFace(): number {
    return this.axis() === 0 ? (this.outward() > 0 ? this.maxX : this.minX) : this.outward() > 0 ? this.maxZ : this.minZ;
  }

  /** The wall normal: 0 = X (a side door), 2 = Z (an end door). */
  axis(): number {
    return this.maxX - this.minX <= this.maxZ - this.minZ ? 0 : 2;
  }

  /** +1 if the door faces the + side of its {@link axis}, −1 if the − side. */
  outward(): number {
    const centre = this.axis() === 0 ? this.minX + this.maxX : this.minZ + this.maxZ;
    return centre >= 0.0 ? 1 : -1;
  }

  /** Span along the wall, horizontally: Z for a side door, X for an end door. */
  spanMin(): number {
    return this.axis() === 0 ? this.minZ : this.minX;
  }

  spanMax(): number {
    return this.axis() === 0 ? this.maxZ : this.maxX;
  }

  /** This door as seen in the frame the wagon's pose puts it in: a flipped wagon's doors swap sides and ends. */
  inFrame(flipped: boolean): Door {
    return flipped
      ? new Door(this.id, -this.maxX, this.minY, -this.maxZ, -this.minX, this.maxY, -this.minZ,
          this.inner, this.fixed, this.connecting, this.group)
      : this;
  }
}

/** One code point's simple case mapping, as `Character.toUpperCase`/`toLowerCase`: a mapping to several is none. */
function simpleCase(codePoint: number, upper: boolean): number {
  const text = String.fromCodePoint(codePoint);
  const mapped = upper ? text.toUpperCase() : text.toLowerCase();
  const first = mapped.codePointAt(0);
  return first !== undefined && String.fromCodePoint(first).length === mapped.length ? first : codePoint;
}

/** `String.equalsIgnoreCase` of Java: the same length, and each code point equal upper- or lower-cased; null equals nothing. */
export function equalsIgnoreCase(a: string, b: string | null): boolean {
  if (b === null || a.length !== b.length) return false;
  const left = [...a];
  const right = [...b];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    const c1 = (left[i] as string).codePointAt(0) as number;
    const c2 = (right[i] as string).codePointAt(0) as number;
    if (c1 === c2) continue;
    const u1 = simpleCase(c1, true);
    const u2 = simpleCase(c2, true);
    if (u1 === u2 || simpleCase(u1, false) === simpleCase(u2, false)) continue;
    return false;
  }
  return true;
}

/** How far outside a door's box a model leaf's centre may lie and still be that door's. */
const LEAF_SLACK = 0.1;
/** Half the stock loading gauge, blocks — body half-width of the collision hull. */
const HULL_HALF_WIDTH = 1.7;
/** Hull floor in model space. */
const HULL_MIN_Y = 0.4;
/** Hull roof in model space. */
const HULL_MAX_Y = 4.7;

/** Declaration of one rolling-stock type in the model frame (`WagonType`). */
export class WagonType {
  constructor(
    readonly id: string,
    /** Over buffers/couplers, blocks. */
    readonly length: number,
    /** Bogie pivots relative to the body centre, + forward, front first. */
    readonly bogieOffsets: readonly number[],
    readonly massT: number,
    /** 0 = not declared: the wagon doesn't limit the train. */
    readonly maxSpeedKmh: number,
    readonly resistance: Resistance,
    /** null = unpowered. */
    readonly traction: Traction | null,
    /** null = no driver's seat. */
    readonly cab: Cab | null,
    readonly brakes: Brakes,
    /** null = not boardable for walking. */
    readonly interior: Interior | null,
    /** Order = door index the open-door bits are keyed by. */
    readonly doors: readonly Door[],
    readonly couplers: Couplers = { front: 0.0, rear: 0.0 },
  ) {}

  /** Distance from the body centre to the coupler point of the front or rear end, blocks. */
  couplerReach(front: boolean): number {
    return this.length / 2.0 + (front ? this.couplers.front : this.couplers.rear);
  }

  /**
   * The door a model part centred at (x, y, z) — model frame — belongs to: the first door
   * with a leaf whose box, grown by 0.1, holds that point; −1 if none.
   */
  doorHolding(x: number, y: number, z: number): number {
    return this.doors.findIndex(
      (d) =>
        !d.fixed &&
        x >= d.minX - LEAF_SLACK &&
        x <= d.maxX + LEAF_SLACK &&
        y >= d.minY - LEAF_SLACK &&
        y <= d.maxY + LEAF_SLACK &&
        z >= d.minZ - LEAF_SLACK &&
        z <= d.maxZ + LEAF_SLACK,
    );
  }

  /** The doors control group `group` works, as open-door bits: named after it or in its group, case aside; leaves only. */
  doorsWorkedBy(group: string): number {
    let bits = 0;
    for (let i = 0; i < this.doors.length && i < 32; i++) {
      const d = this.doors[i] as Door;
      if (!d.fixed && (equalsIgnoreCase(group, d.id) || equalsIgnoreCase(group, d.group))) bits |= 1 << i;
    }
    return bits;
  }

  /** The doors that open and close with door `index`, as open-door bits: it and its group's leaves; 0 for a fixed door or past 32. */
  doorsOpenedWith(index: number): number {
    const door = this.doors[index];
    if (index < 0 || door === undefined || index >= 32 || door.fixed) return 0;
    let bits = 0;
    for (let i = 0; i < this.doors.length && i < 32; i++) {
      const d = this.doors[i] as Door;
      if (!d.fixed && (i === index || d.groupedWith(door))) bits |= 1 << i;
    }
    return bits;
  }

  /** The doors with a leaf, as open-door bits (the first 32). */
  leafDoors(): number {
    let bits = 0;
    for (let i = 0; i < this.doors.length && i < 32; i++) {
      if (!(this.doors[i] as Door).fixed) bits |= 1 << i;
    }
    return bits;
  }

  /** This type's solid collision hull: the loading gauge's width and height, the type's length. */
  collidableHull(): Hull {
    const halfLen = this.length / 2.0;
    return { minX: -HULL_HALF_WIDTH, minY: HULL_MIN_Y, minZ: -halfLen, maxX: HULL_HALF_WIDTH, maxY: HULL_MAX_Y, maxZ: halfLen };
  }

  powered(): boolean {
    return this.traction !== null;
  }

  drivable(): boolean {
    return this.cab !== null;
  }

  /** True if a player can board and walk this wagon's interior. */
  boardable(): boolean {
    return this.interior !== null;
  }

  /** True if the interior is entered and left only through its doors: boardable with a way in from outside. */
  doorsOnly(): boolean {
    return this.boardable() && this.doors.some((door) => door.external());
  }

  /** Distance from the first (front) to the last bogie pivot, blocks. */
  wheelbase(): number {
    return (this.bogieOffsets[0] as number) - (this.bogieOffsets[this.bogieOffsets.length - 1] as number);
  }
}

// ---------------------------------------------------------------- the parser (WagonTypeParser)

/** Driver's chairs a cab may have at most. */
export const MAX_SEATS = 16;

/** The keys of a declaration's top level, in the engine's order (the order hints are tried in). */
export const KEYS = [
  'length',
  'bogies',
  'mass_t',
  'max_speed_kmh',
  'resistance',
  'traction',
  'brakes',
  'cab',
  'interior',
  'doors',
  'couplers',
  'aliases',
] as const;
export const RESISTANCE_KEYS = ['a', 'b', 'c', 'c_front'] as const;
export const TRACTION_KEYS = ['power_kw', 'max_tractive_effort_kn', 'adhesion', 'ramp_s'] as const;
export const BRAKES_KEYS = [
  'system',
  'train_kn',
  'independent_kn',
  'parking_kn',
  'apply_s',
  'release_s',
  'dynamic_kn',
  'dynamic_fade_kmh',
] as const;
/** Brake keys read but not modelled yet (roadmap R7): a pack that sets them is warned. */
export const RESERVED_BRAKES_KEYS = ['dynamic_kn', 'dynamic_fade_kmh'] as const;
/** The keys of `cab`; `seat`/`seat_yaw` are the older one-chair form. */
export const CAB_KEYS = ['seats', 'seat', 'seat_yaw'] as const;
export const SEAT_KEYS = ['at', 'yaw'] as const;
export const ZONE_KEYS = ['min', 'max'] as const;
export const DOOR_KEYS = ['id', 'min', 'max', 'inner', 'fixed', 'connecting', 'group'] as const;
export const COUPLERS_KEYS = ['front', 'rear'] as const;

/**
 * Parse one declaration as the engine does (`WagonTypeParser.parse`); `id` comes from the
 * file's place in the pack, not its body. `warnings` is told what the declaration says that
 * the engine ignores (unknown keys, reserved fields, an obsolete null group), each as the
 * engine words it. Throws {@link WagonTypeError} with the engine's message on a missing
 * required field, a null or wrongly typed value or impossible geometry; a value that is not
 * an object gets the loader's message (`WagonTypeLoader`).
 */
export function parseWagonType(id: string, json: unknown, warnings: (text: string) => void = () => undefined): WagonType {
  if (!isObject(json)) throw new WagonTypeError(`the file must be a JSON object {…}, got ${describe(json)}`);
  checkKeys(json, KEYS, '', warnings);
  const length = asNumber(required(json, 'length', ''), 'length');
  const bogieOffsets = bogies(json);
  const massT = asNumber(required(json, 'mass_t', ''), 'mass_t');
  if (!(massT > 0.0)) throw new WagonTypeError(`'mass_t' must be a positive number, got ${formatNumber(massT)}`);
  const maxSpeedKmh = amount(json, 'max_speed_kmh', '', 0.0);

  let resistance = defaultResistance(massT);
  const r = section(json, 'resistance', RESISTANCE_KEYS, warnings);
  if (r !== null) {
    resistance = {
      a: amount(r, 'a', 'resistance', resistance.a),
      b: amount(r, 'b', 'resistance', resistance.b),
      c: amount(r, 'c', 'resistance', resistance.c),
      cFront: amount(r, 'c_front', 'resistance', resistance.cFront),
    };
  }

  let traction: Traction | null = null;
  const t = section(json, 'traction', TRACTION_KEYS, warnings);
  if (t !== null) {
    traction = {
      powerKw: amount(t, 'power_kw', 'traction', NaN),
      maxTractiveEffortKn: amount(t, 'max_tractive_effort_kn', 'traction', NaN),
      adhesion: amount(t, 'adhesion', 'traction', ADHESION),
      rampS: amount(t, 'ramp_s', 'traction', TRACTION_RAMP_S),
    };
  }

  const c = section(json, 'cab', CAB_KEYS, warnings);
  const cab = c !== null ? readCab(c, warnings) : null;

  const b = section(json, 'brakes', BRAKES_KEYS, warnings) ?? {};
  for (const reserved of RESERVED_BRAKES_KEYS) {
    if (has(b, reserved)) {
      warnings(`'brakes.${reserved}' is reserved: the dynamic brake isn't modelled yet, the value is kept but does nothing`);
    }
  }
  const defaults = defaultBrakes(brakeSystem(b), massT, cab !== null);
  const brakes: Brakes = {
    trainKn: amount(b, 'train_kn', 'brakes', defaults.trainKn),
    independentKn: amount(b, 'independent_kn', 'brakes', defaults.independentKn),
    dynamicKn: amount(b, 'dynamic_kn', 'brakes', defaults.dynamicKn),
    dynamicFadeKmh: amount(b, 'dynamic_fade_kmh', 'brakes', defaults.dynamicFadeKmh),
    parkingKn: amount(b, 'parking_kn', 'brakes', defaults.parkingKn),
    applyS: amount(b, 'apply_s', 'brakes', defaults.applyS),
    releaseS: amount(b, 'release_s', 'brakes', defaults.releaseS),
  };

  const interior = readInterior(json, warnings);
  const doors = readDoors(json, warnings);

  let couplers: Couplers = { front: 0.0, rear: 0.0 };
  const k = section(json, 'couplers', COUPLERS_KEYS, warnings);
  if (k !== null) {
    couplers = { front: optionalNumber(k, 'front', 'couplers', 0.0), rear: optionalNumber(k, 'rear', 'couplers', 0.0) };
  }
  checkGeometry(length, bogieOffsets, couplers);

  return new WagonType(id, length, bogieOffsets, massT, maxSpeedKmh, resistance, traction, cab, brakes, interior, doors, couplers);
}

/**
 * Optional `aliases`: old type ids this declaration takes over (`WagonTypeParser.aliases`).
 * Throws {@link WagonTypeError} unless it is an array of strings.
 */
export function aliases(json: unknown): string[] {
  if (!isObject(json)) return [];
  const array = optionalArray(json, 'aliases', '');
  return array === null ? [] : array.map((alias, i) => asString(alias, at('aliases', i)));
}

/** What the loader makes of one declaration (`WagonTypeLoader`, per file): the type and its aliases, or the error. */
export interface LoadedType {
  /** null when the declaration does not load. */
  type: WagonType | null;
  aliases: string[];
  /** The loader's message without its `wagon type <id> not loaded: ` lead, or null. */
  error: string | null;
  /** What the parser tolerated, in order; those before the error too. */
  warnings: string[];
}

/** One declaration as the loader reads it: {@link parseWagonType}, then {@link aliases}, errors caught. */
export function loadWagonType(id: string, json: unknown): LoadedType {
  const warnings: string[] = [];
  try {
    const type = parseWagonType(id, json, (text) => warnings.push(text));
    return { type, aliases: aliases(json), error: null, warnings };
  } catch (e) {
    if (!(e instanceof WagonTypeError)) throw e;
    return { type: null, aliases: [], error: e.message, warnings };
  }
}

/**
 * The geometry must make a wagon (fix list D3): a positive length; bogie pivots strictly
 * front to back and inside the body; each coupler offset under `length/2` in size.
 */
function checkGeometry(length: number, bogieOffsets: readonly number[], couplers: Couplers): void {
  if (!(length > 0.0)) throw new WagonTypeError(`'length' must be a positive number of blocks, got ${formatNumber(length)}`);
  const half = length / 2.0;
  bogieOffsets.forEach((bogie, i) => {
    if (!(Math.abs(bogie) < half)) {
      throw new WagonTypeError(
        `'bogies[${i}]' = ${formatNumber(bogie)} is outside the body: a pivot must lie within ±length/2 = ±${formatNumber(half)}`,
      );
    }
    const before = bogieOffsets[i - 1];
    if (before !== undefined && !(bogie < before)) {
      throw new WagonTypeError(
        `'bogies' must run front to back, each pivot behind the one before: 'bogies[${i}]' = ${formatNumber(bogie)}` +
          ` is not behind 'bogies[${i - 1}]' = ${formatNumber(before)}`,
      );
    }
  });
  checkCoupler('front', couplers.front, half);
  checkCoupler('rear', couplers.rear, half);
}

function checkCoupler(end: string, offset: number, half: number): void {
  if (!(Math.abs(offset) < half)) {
    throw new WagonTypeError(`'couplers.${end}' = ${formatNumber(offset)} must be under length/2 = ${formatNumber(half)} in size`);
  }
}

/** The section object `key` with its keys checked, or null when absent. */
function section(json: JsonObject, key: string, keys: readonly string[], warnings: (text: string) => void): JsonObject | null {
  const object = optionalObject(json, key, '');
  if (object !== null) checkKeys(object, keys, key, warnings);
  return object;
}

/** The `brakes.system` named, or the default one. */
function brakeSystem(brakes: JsonObject): BrakeSystem {
  if (!has(brakes, 'system')) return DEFAULT_BRAKE_SYSTEM;
  const name = asString(brakes.system, 'brakes.system');
  const system = brakeSystemByName(name);
  if (system === null) throw new WagonTypeError(`unknown brake system 'brakes.system' = '${name}' (passenger, freight or ep)`);
  return system;
}

/** A physical amount: `fallback` if absent (NaN fallback = required), else a finite number ≥ 0. */
function amount(json: JsonObject, field: string, where: string, fallback: number): number {
  if (!has(json, field)) {
    if (Number.isNaN(fallback)) throw new WagonTypeError(`missing required field '${at(where, field)}'`);
    return fallback;
  }
  const value = asNumber(json[field], at(where, field));
  if (!(value >= 0.0)) throw new WagonTypeError(`'${at(where, field)}' must be a number ≥ 0, got ${formatNumber(value)}`);
  return value;
}

/** Optional `doors`: each leaf's box in the OBJ frame, turned into the model frame; order = door index. */
function readDoors(json: JsonObject, warnings: (text: string) => void): Door[] {
  const array = optionalArray(json, 'doors', '');
  if (array === null) return [];
  return array.map((element, i) => {
    const where = at('doors', i);
    const door = asObject(element, where);
    checkKeys(door, DOOR_KEYS, where, warnings);
    const id = asString(required(door, 'id', where), at(where, 'id'));
    const [minX, minY, minZ, maxX, maxY, maxZ] = objBox(vec3(door, 'min', where), vec3(door, 'max', where));
    const group = get(door, 'group');
    if (group === null) warnings(`'${at(where, 'group')}' is null: obsolete, leave the field out for a door on its own`);
    const inner = optionalBool(door, 'inner', where, false);
    const fixed = optionalBool(door, 'fixed', where, false);
    const connecting = optionalBool(door, 'connecting', where, false);
    const name = group === undefined || group === null ? null : asString(group, at(where, 'group'));
    return new Door(id, minX, minY, minZ, maxX, maxY, maxZ, inner, fixed, connecting, name);
  });
}

/** The `cab` section: optional chairs `seats` (OBJ frame, turned) or the older one-chair `seat`/`seat_yaw`. */
function readCab(cab: JsonObject, warnings: (text: string) => void): Cab {
  if (has(cab, 'seat') && has(cab, 'seats')) {
    throw new WagonTypeError("'cab' has both 'seat' and 'seats': list every chair in 'seats'");
  }
  if (has(cab, 'seat')) {
    const [x, y, z] = point(vec3(cab, 'seat', 'cab'));
    return { seats: [new Seat(x, y, z, optionalNumber(cab, 'seat_yaw', 'cab', 0.0))] };
  }
  const array = optionalArray(cab, 'seats', 'cab');
  if (array === null) return { seats: [] };
  if (array.length > MAX_SEATS) throw new WagonTypeError(`'cab.seats' lists more than ${MAX_SEATS} chairs`);
  const seats = array.map((element, i) => {
    const where = at('cab.seats', i);
    const seat = asObject(element, where);
    checkKeys(seat, SEAT_KEYS, where, warnings);
    const [x, y, z] = point(vec3(seat, 'at', where));
    return new Seat(x, y, z, optionalNumber(seat, 'yaw', where, 0.0));
  });
  return { seats };
}

/** Optional `interior`: one box or a list of floor zones, in the OBJ frame, turned. Absent → not walk-boardable. */
function readInterior(json: JsonObject, warnings: (text: string) => void): Interior | null {
  if (!has(json, 'interior')) return null;
  const element = json.interior;
  const zones: Zone[] = [];
  if (Array.isArray(element)) {
    element.forEach((item: unknown, i) => zones.push(zone(asObject(item, at('interior', i)), at('interior', i), warnings)));
    if (zones.length === 0) throw new WagonTypeError("'interior' lists no zones");
  } else if (isObject(element)) {
    zones.push(zone(element, 'interior', warnings));
  } else {
    throw wrongType('interior', 'an object {min, max} or an array of them', element);
  }
  return new Interior(zones);
}

function zone(box: JsonObject, where: string, warnings: (text: string) => void): Zone {
  checkKeys(box, ZONE_KEYS, where, warnings);
  const [minX, minY, minZ, maxX, maxY, maxZ] = objBox(vec3(box, 'min', where), vec3(box, 'max', where));
  return new Zone(minX, minY, minZ, maxX, maxY, maxZ);
}

/** A point `[x, y, z]` of the OBJ frame in the model frame. */
function point(obj: readonly [number, number, number]): ModelPoint {
  return objPoint(obj[0], obj[1], obj[2]);
}

function vec3(json: JsonObject, field: string, where: string): [number, number, number] {
  const path = at(where, field);
  const array = asArray(required(json, field, where), path);
  if (array.length !== 3) throw new WagonTypeError(`'${path}' must be a 3-element array [x, y, z]`);
  return [asNumber(array[0], at(path, 0)), asNumber(array[1], at(path, 1)), asNumber(array[2], at(path, 2))];
}

function bogies(json: JsonObject): number[] {
  const array = asArray(required(json, 'bogies', ''), 'bogies');
  if (array.length === 0) throw new WagonTypeError("'bogies' must list at least one pivot offset");
  return array.map((bogie, i) => asNumber(bogie, at('bogies', i)));
}
