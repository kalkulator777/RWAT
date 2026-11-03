/**
 * What every part of a wagon's OBJ is to the engine, in the Immersive Railroading
 * convention (SPEC §5.2, §6.12, §8–§9.5): port of `convention/ModelParts.java` (`of`,
 * `dropped`) with `convention/GroupName.java` (`fits`, `worksGroup`, `tooLong`, `fit`) and
 * the model's fields of `client/render/model/WagonModelDecl.java` (`parse`). Golden:
 * fixtures/golden/model_parts/ (reference Java). When a light shines is ./lights.ts.
 *
 * In: the OBJ's parts as ./obj.ts reads them ({@link Part}: object, material, whether the
 * material has a texture, the corners of the faces in the OBJ frame) and what the model's
 * declaration adds ({@link Declaration}). Out: each part's {@link Role} — where it is drawn
 * or why not, what it belongs to, how it is lit — and the model's moving things: the two
 * bogies with their wheelsets, the cab controls and the door leaves moved by name with
 * their hinges, the doors animated by `.anim`, the coupler heads with their pivots, the
 * light groups, the cabin lamps, the headlights.
 *
 * Geometry comes out as the engine places it: in the model frame (./objFrame.ts: the OBJ
 * turned a quarter about Y and lifted by `Y_LIFT`), in float, a bogie's wheelsets
 * bogie-local. The traps of the port (each closed by a golden case):
 * - floats: every operation the engine does in `float` is `Math.fround`ed after it; the
 *   corners' lift adds the float {@link Y_LIFT}, while a control's hinge is turned from
 *   ./pivotAxis.ts's double and lifted by the double `Y_LIFT` before it becomes a float;
 * - order: parts, controls, door leaves, doors, coupler heads and light groups come in
 *   the order of the file (the first part that names them);
 * - names: `HIDE`, the skipped prefixes, `BOGEY_*`, `INTERIOR` (prefix and token) and the
 *   `.anim` objects read the raw name; controls, lights and coupler heads read it without
 *   Blender's copy suffix `.001` (./objectRole.ts does that).
 *
 * Each part, in file order, goes to the first that takes it:
 * 1. `HIDE` anywhere in the raw name drops it (`HIDDEN`), unless it is a `WIDGET` control
 *    or a coupler head; a skipped prefix drops it too (`SKIPPED`);
 * 2. a coupler head is no bogie's; else a raw name starting `BOGEY_FRONT`/`BOGEY_REAR` is
 *    that bogie's, and with `_WHEEL_` in it one of its wheelsets (every corner counts);
 * 3. an object an `.anim` names, not a bogie's or a coupler head, moves with that door;
 * 4. a door leaf moved by name (./doorLeaves.ts) is built like a control; else an object
 *    of a control is that control's — flags merged, the first `…_ROT…` object the hinge;
 * 5. a part whose material has no texture is not drawn (`UNTEXTURED`);
 * 6. the rest: animated piece, control, leaf, coupler head, bogie frame, interior
 *    (`INTERIOR` raw prefix) or body.
 * Then the light rules for every drawn part but a wheelset. Pure.
 */

import conventions from '../../../schema/obj-conventions.json';
import type { Vec3 } from '../core/contracts';
import { DoorLeaves } from './doorLeaves';
import { of as lampIslands } from './lampIslands';
import { CORNER_FLOATS, type ObjModel } from './obj';
import { of as pivotAxis } from './pivotAxis';
import { coupled, hasToken, parseRole, type Control, type ControlKind, type CouplerShown, type ObjectRole } from './objectRole';
import { Y_LIFT as Y_LIFT_DOUBLE } from './objFrame';
import { asArray, asNumber, asString, at, describe, has, isObject, optionalArray, optionalObject, PackJsonError, required } from './packJson';

const f = Math.fround;

/** A limit of schema/obj-conventions.json `limits`, by the engine constant its `code` names. */
function limit(code: string): number {
  const found = conventions.limits.find((entry) => entry.code.includes(code));
  if (found === undefined) throw new Error(`schema/obj-conventions.json has no limit ${code}`);
  return found.value;
}

/**
 * Object-name prefixes that are never geometry in the IR convention (`ModelParts.DEFAULT_SKIP_PREFIXES`):
 * `CARGO_FILL` — the cargo at each load level; cargo isn't modelled, the wagon renders empty.
 */
export const DEFAULT_SKIP_PREFIXES: readonly string[] = ['CARGO_FILL'];

/** Rolling (tread) radius of every wheelset, blocks, as a float (`ModelParts.WHEEL_RADIUS`). */
export const WHEEL_RADIUS = f(limit('convention/ModelParts.java#WHEEL_RADIUS'));

/** The lift of the OBJ onto the railhead as a float, as the corners are placed (`ModelParts.Y_LIFT`). */
export const Y_LIFT = f(Y_LIFT_DOUBLE);

/** The longest control or light group name sent or kept (`GroupName.MAX_LENGTH`). */
export const MAX_GROUP_LENGTH = limit('convention/GroupName.java#MAX_LENGTH');

/** The largest float: an empty box starts at ±this (`Float.MAX_VALUE`). */
const MAX_FLOAT = f(3.4028234663852886e38);

/** 0.02 as a float: how far in front of its lens a headlight sits. */
const LENS_GAP = f(0.02);

/** The kinds that move the train's handles (`ControlValue.handle`): their groups never travel. */
const HANDLE_KINDS: ReadonlySet<ControlKind> = new Set<ControlKind>(['THROTTLE', 'REVERSER', 'TRAIN_BRAKE', 'INDEPENDENT_BRAKE']);

/** Whether each control kind is a gauge, from schema/obj-conventions.json `control_kinds` (`Kind.gauge`). */
const GAUGE_KIND = new Map<string, boolean>(conventions.control_kinds.map((entry) => [entry.kind, entry.gauge]));

// ---------------------------------------------------------------- in

/** One run of faces of the OBJ, as ./obj.ts reads it (`ModelParts.Part`). */
export interface Part {
  /** The object it belongs to (`o`/`g`), raw. */
  object: string;
  /** Its `usemtl`. */
  material: string;
  /** The material has a texture (`map_Kd`): the part can be drawn. */
  textured: boolean;
  /** Its faces, four corners each (a triangle repeats its last), `x, y, z` per corner, in file order, OBJ frame; read as floats. */
  corners: ArrayLike<number>;
}

/** What the model's declaration adds to its OBJ (`ModelParts.Declaration`). */
export interface Declaration {
  /** The bogie pivots, +forward, front first; null — measured from the bogie frames. */
  bogies: readonly number[] | null;
  /** Name prefixes dropped besides {@link DEFAULT_SKIP_PREFIXES}. */
  skip: readonly string[];
  /** Object → the id of the door whose `.anim` moves it. */
  animated: ReadonlyMap<string, string>;
  /** Control keys (`<KIND>_<n>`) that are the wagon's handbrake wheel. */
  handbrake: readonly string[];
}

/** A model declaring nothing but its OBJ (`Declaration.NONE`). */
export const NO_DECLARATION: Declaration = Object.freeze({ bogies: null, skip: [], animated: new Map<string, string>(), handbrake: [] });

// ---------------------------------------------------------------- out

/** Where a part is drawn, or why it isn't, in the engine's order: the first three aren't drawn (`ModelParts.Place`). */
export const PLACES = ['HIDDEN', 'SKIPPED', 'UNTEXTURED', 'BODY', 'INTERIOR', 'BOGIE', 'WHEEL', 'ANIMATED', 'DOOR_LEAF', 'CONTROL', 'COUPLER'] as const;

export type Place = (typeof PLACES)[number];

/** True if a part of this place is drawn (`Place.drawn`). */
export function drawn(place: Place): boolean {
  return PLACES.indexOf(place) >= PLACES.indexOf('BODY');
}

/** How a drawn part's faces are lit (SPEC §8; `ModelParts.Light`). */
export interface Light {
  /** Light group: an index into {@link ModelParts.lightGroups}; −1 none. */
  group: number;
  /** Glows at full brightness while lit. */
  fullbright: boolean;
  /** In the cabin lamps' light (the raw `INTERIOR` token). */
  interior: boolean;
  /** Lit while the group is off (`LINVERT`). */
  invert: boolean;
}

/** Lit as the world lights it (`Light.NONE`). */
export const NO_LIGHT: Light = Object.freeze({ group: -1, fullbright: false, interior: false, invert: false });

/** What one part is (`ModelParts.Role`). */
export interface Role {
  place: Place;
  /** Of the front bogie or end (a `BOGIE`, `WHEEL` or `COUPLER` part, or an untextured wheelset part). */
  front: boolean;
  /** What it belongs to, by name: a control's or leaf's key, an animated door's id, a wheelset's object (an untextured part too); else null. */
  owner: string | null;
  /** Where that is in its list (controls, door leaves, doors, couplers, the bogie's wheelsets); −1 if it isn't in one. */
  index: number;
  /** {@link NO_LIGHT} if not drawn, or a wheelset. */
  light: Light;
}

/** A wheelset: its axle in the OBJ frame (the middle of all its corners) and bogie-local (`ModelParts.Wheel`). */
export interface Wheel {
  object: string;
  /** OBJ x of the axle (along the car). */
  axleX: number;
  /** OBJ y of the axle. */
  axleY: number;
  /** Bogie-local height of the axle: `axleY + Y_LIFT`. */
  centerY: number;
  /** Bogie-local place of the axle along +Z: `−axleX − pivotZ`. */
  centerZ: number;
  radius: number;
}

/** A bogie: its pivot along the car (+forward, model frame) and its wheelsets in the order they come (`ModelParts.Bogie`). */
export interface Bogie {
  pivotZ: number;
  wheels: Wheel[];
}

/** A cab control or a door leaf moved by name, model frame (`ModelParts.Control`). */
export interface ModelControl {
  /** The control as all its objects' names together declare it. */
  role: Control;
  /** One of its objects has the raw `INTERIOR` token: drawn only near. */
  interior: boolean;
  /** The hinge; null if no object is its `…_ROT…` marker. */
  pivot: Vec3 | null;
  /** The hinge axis (unit), +Y without a marker. */
  axis: Vec3;
  /** The swing at full travel. */
  degrees: number;
  /** The slide at full travel (`TL_`), turned into the model frame. */
  slide: Vec3;
  /** The least corner of its drawn faces at rest. */
  boxMin: Vec3;
  /** The greatest corner. */
  boxMax: Vec3;
}

/** A door its `.anim` moves: its id and its drawn objects, in the order they come (`ModelParts.Door`). */
export interface AnimatedDoor {
  id: string;
  objects: string[];
}

/** A coupler head in one state: its end, when it shows, the pivot all its end's heads turn on (`ModelParts.Coupler`). */
export interface Coupler {
  front: boolean;
  shown: CouplerShown;
  pivot: Vec3;
}

/** A cabin lamp: the centre of a glowing island (model frame), its light group, `LINVERT` (`ModelParts.Lamp`). */
export interface Lamp {
  x: number;
  y: number;
  z: number;
  group: number;
  invert: boolean;
}

/**
 * A headlight (IR `LightFlare`): the centre of its lens face (model frame), which way it
 * shines along the model (`dirZ` +1 forward, −1 back), the lens radius, its colour
 * `0xRRGGBB`, light group (−1 none) and `LINVERT` (`ModelParts.Headlight`).
 */
export interface Headlight {
  x: number;
  y: number;
  z: number;
  dirZ: number;
  radius: number;
  rgb: number;
  group: number;
  invert: boolean;
}

/** The parts of one model (`ModelParts`). */
export interface ModelParts {
  /** Each part's role, in the order of the parts given. */
  roles: Role[];
  /** The light groups, in the order the drawn parts first name them: a {@link Light.group} indexes here. */
  lightGroups: string[];
  frontBogie: Bogie;
  rearBogie: Bogie;
  /** The cab controls with something drawn, in the order their objects first come. */
  controls: ModelControl[];
  /** The door leaves moved by name with something drawn, in the order their objects first come. */
  doorLeaves: ModelControl[];
  /** The doors their `.anim`s move, with a drawn piece, in the order those first come. */
  doors: AnimatedDoor[];
  /** The coupler heads drawn: the front end's, then the rear's, each in the order they first come. */
  couplers: Coupler[];
  /** The cabin lamps: the glowing islands of a group that also lights something inside. */
  lamps: Lamp[];
  headlights: Headlight[];
  /** The control and light groups named too long to travel, dropped; in order, each once. */
  droppedGroups: string[];
  /** How many parts aren't drawn: hidden, skipped, or untextured (a wheelset's aside). */
  skipped: number;
}

// ---------------------------------------------------------------- GroupName

/** `GroupName.fits`: the name can be a group on the wire — not empty, at most {@link MAX_GROUP_LENGTH} characters. */
export function groupFits(name: string | null): boolean {
  return name !== null && name.length > 0 && name.length <= MAX_GROUP_LENGTH;
}

/**
 * `GroupName.worksGroup`: working the control sets its group (a switch, a window, a
 * button) — not a handle lever, the handbrake wheel, a gauge or a door leaf.
 */
export function worksGroup(control: Control): boolean {
  return !control.gauge && control.kind !== 'HANDBRAKE' && control.kind !== 'DOOR' && !HANDLE_KINDS.has(control.kind);
}

/** `GroupName.tooLong`: the groups of a role too long to travel, in order — its control's, its light's. */
export function tooLongGroups(role: ObjectRole): string[] {
  const names: string[] = [];
  const control = role.control;
  if (control !== null && worksGroup(control) && !groupFits(control.group)) names.push(control.group);
  if (role.lightGroup !== null && !groupFits(role.lightGroup)) names.push(role.lightGroup);
  return names;
}

/**
 * `GroupName.fit`: the role without the groups too long to travel — a control keeps its
 * own key for a group and can't be worked (`NO_TOUCH`); a light lit by a group that is
 * never switched is off, an inverted one always on. The role itself if every group fits.
 */
export function fitGroups(role: ObjectRole): ObjectRole {
  let control = role.control;
  if (control !== null && worksGroup(control) && !groupFits(control.group)) {
    control = { ...control, group: control.key, noTouch: true };
  }
  let light = role.lightGroup;
  let invert = role.lightInvert;
  let fullbright = role.fullbright;
  let headlight = role.headlight;
  if (light !== null && !groupFits(light)) {
    light = null; // no group: lit always — so an inverted light only, the rest never
    fullbright &&= invert;
    headlight &&= invert;
    invert = false;
  }
  if (control === role.control && light === role.lightGroup) return role;
  return { control, pivotDegrees: role.pivotDegrees, lightGroup: light, lightInvert: invert, fullbright, headlight, rgb: role.rgb };
}

// ---------------------------------------------------------------- the declaration

/** The fields of a wagon model declaration the model is read by (`WagonModelDecl`). */
export interface ModelDeclaration {
  /** The OBJ, `ns:path`. */
  obj: string;
  /** Bogie pivots in the OBJ, +forward, front first; null — measured. */
  bogies: number[] | null;
  skip: string[];
  /** Door id (lower case) → its `.anim`, `ns:path`, in the file's order. */
  animations: Map<string, string>;
  /** Livery id → folder next to the OBJ, in the file's order. */
  liveries: Map<string, string>;
  handbrake: string[];
}

/** `WagonModelDecl.qualify`: `path` → `namespace:path`; an already qualified path is kept. */
export function qualify(namespace: string, path: string): string {
  return path.includes(':') ? path : `${namespace}:${path}`;
}

function strings(object: Record<string, unknown>, key: string): string[] {
  return (optionalArray(object, key, '') ?? []).map((value, i) => asString(value, at(key, i)));
}

function stringEntries(object: Record<string, unknown>, key: string): [string, string][] {
  const map = optionalObject(object, key, '');
  return map === null ? [] : Object.entries(map).map(([name, value]) => [name, asString(value, at(key, name))]);
}

/**
 * The model's fields of a declaration (`assets/<ns>/wagon_models/<name>.json`) as
 * `WagonModelDecl.parse` reads them, strictly: a missing or empty `obj`, a `null` or a
 * wrongly typed value throws {@link PackJsonError} with the engine's message. Unknown keys,
 * `sounds` and `sway` are not read here (the schema checks them).
 *
 * @param namespace the declaring file's namespace, for unqualified paths
 */
export function modelDeclaration(namespace: string, json: unknown): ModelDeclaration {
  if (!isObject(json)) throw new PackJsonError(`a wagon model declaration must be an object, got ${describe(json)}`);
  const object = json;
  const path = asString(required(object, 'obj', ''), 'obj');
  if (path === '') throw new PackJsonError("'obj' is empty");
  let bogies: number[] | null = null;
  if (has(object, 'bogies')) {
    const array = asArray(object.bogies, 'bogies');
    if (array.length === 0) throw new PackJsonError("'bogies' must list at least one pivot offset");
    bogies = array.map((value, i) => asNumber(value, at('bogies', i)));
  }
  const skip = strings(object, 'skip');
  const animations = new Map<string, string>();
  for (const [group, file] of stringEntries(object, 'animations')) animations.set(group.toLowerCase(), qualify(namespace, file));
  const liveries = new Map(stringEntries(object, 'liveries'));
  const handbrake = strings(object, 'handbrake');
  return { obj: qualify(namespace, path), bogies, skip, animations, liveries, handbrake };
}

// ---------------------------------------------------------------- from the files

/**
 * The parts of a read OBJ as {@link modelParts} takes them: each part's object and
 * material, whether `textured` says its material has a texture, and the positions of its
 * corners in order (`IrStockModel.corners`).
 */
export function partsOf(obj: ObjModel, textured: (material: string) => boolean): Part[] {
  return obj.parts.map((part) => {
    const corners = new Float32Array((part.quads.length / CORNER_FLOATS) * 3);
    for (let from = 0, to = 0; from < part.quads.length; from += CORNER_FLOATS, to += 3) {
      corners[to] = part.quads[from]!;
      corners[to + 1] = part.quads[from + 1]!;
      corners[to + 2] = part.quads[from + 2]!;
    }
    return { object: part.object, material: part.material, textured: textured(part.material), corners };
  });
}

/**
 * {@link Declaration.animated} from the doors' `.anim`s, in the declaration's order: every
 * object with a frame moves with its door; an object two doors move goes with the later
 * (`IrStockModel.loadAnimations`). A track without frames moves nothing.
 *
 * @param anims door id → its tracks (./anim.ts `parse`)
 */
export function animatedBy(anims: Iterable<readonly [string, ReadonlyMap<string, readonly unknown[]>]>): Map<string, string> {
  const animated = new Map<string, string>();
  for (const [door, tracks] of anims) {
    for (const [object, frames] of tracks) if (frames.length > 0) animated.set(object, door);
  }
  return animated;
}

// ---------------------------------------------------------------- the rule

/**
 * `ModelParts.dropped`: why a part is dropped before anything else, or null if it isn't —
 * `HIDE` in its raw name (`HIDDEN`), but a `WIDGET` control and a coupler head are not
 * hidden by it; or a skipped name prefix (`SKIPPED`).
 *
 * @param skipPrefixes {@link DEFAULT_SKIP_PREFIXES} and the declaration's `skip`
 */
export function dropped(object: string, skipPrefixes: readonly string[]): 'HIDDEN' | 'SKIPPED' | null {
  if (object.includes('HIDE')) {
    const widget = parseRole(object).control?.kind === 'WIDGET';
    if (!widget && coupled(object) === null) return 'HIDDEN';
  }
  return startsWithAny(object, skipPrefixes) ? 'SKIPPED' : null;
}

function startsWithAny(name: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => name.startsWith(prefix));
}

/** [minX, minY, minZ, maxX, maxY, maxZ] of nothing yet. */
function emptyBox(): number[] {
  return [MAX_FLOAT, MAX_FLOAT, MAX_FLOAT, -MAX_FLOAT, -MAX_FLOAT, -MAX_FLOAT];
}

/** Grow `box` by every corner of `corners` (floats). */
function bound(box: number[], corners: ArrayLike<number>): void {
  for (let i = 0; i + 2 < corners.length; i += 3) {
    box[0] = Math.min(box[0]!, corners[i]!);
    box[1] = Math.min(box[1]!, corners[i + 1]!);
    box[2] = Math.min(box[2]!, corners[i + 2]!);
    box[3] = Math.max(box[3]!, corners[i]!);
    box[4] = Math.max(box[4]!, corners[i + 1]!);
    box[5] = Math.max(box[5]!, corners[i + 2]!);
  }
}

/** Corners of the OBJ frame in the model frame: `(z, y + Y_LIFT, −x)`, in float. */
function toModel(corners: Float32Array): Float32Array {
  const model = new Float32Array(corners.length);
  for (let i = 0; i + 2 < corners.length; i += 3) {
    model[i] = corners[i + 2]!;
    model[i + 1] = corners[i + 1]! + Y_LIFT;
    model[i + 2] = -corners[i]!;
  }
  return model;
}

/** The corners as floats: a Float32Array as it is, anything else rounded. */
function floats(corners: ArrayLike<number>): Float32Array {
  return corners instanceof Float32Array ? corners : Float32Array.from(corners);
}

/**
 * Bogie pivots when the declaration gives none: the centre, along travel, of each bogie's
 * frame (wheelsets and `HIDE` objects aside, any material), as +forward offsets; 0 for a
 * bogie without objects.
 */
function measurePivots(parts: readonly { object: string; corners: Float32Array }[]): [number, number] {
  const frontX = [MAX_FLOAT, -MAX_FLOAT];
  const rearX = [MAX_FLOAT, -MAX_FLOAT];
  for (const { object, corners } of parts) {
    const range = object.startsWith('BOGEY_FRONT') ? frontX : object.startsWith('BOGEY_REAR') ? rearX : null;
    if (range === null || object.includes('_WHEEL_') || object.includes('HIDE')) continue;
    for (let i = 0; i + 2 < corners.length; i += 3) {
      range[0] = Math.min(range[0]!, corners[i]!);
      range[1] = Math.max(range[1]!, corners[i]!);
    }
  }
  // the OBJ front is −X: a bogie centred at OBJ x sits at −x along +forward (float sum, double half)
  const pivot = (range: number[]): number => (range[0]! <= range[1]! ? -f(range[0]! + range[1]!) / 2.0 : 0.0);
  return [pivot(frontX), pivot(rearX)];
}

/** One control's flags spread over its objects: IR reads them from any of them (`ControlBuilder.merge`). */
function merge(a: Control, b: Control): Control {
  const ranged = b.rangeMin !== 0 || b.rangeMax !== 1;
  return {
    kind: a.kind,
    gauge: a.gauge,
    id: a.id,
    key: a.key,
    group: a.group === a.key ? b.group : a.group,
    label: a.label ?? b.label,
    toggle: a.toggle || b.toggle,
    press: a.press || b.press,
    invert: a.invert || b.invert,
    hide: a.hide || b.hide,
    noTouch: a.noTouch || b.noTouch,
    global: a.global || b.global,
    offset: a.offset !== 0 ? a.offset : b.offset,
    rangeMin: ranged ? b.rangeMin : a.rangeMin,
    rangeMax: ranged ? b.rangeMax : a.rangeMax,
    slide: [b.slide[0] !== 0 ? b.slide[0] : a.slide[0], b.slide[1] !== 0 ? b.slide[1] : a.slide[1], b.slide[2] !== 0 ? b.slide[2] : a.slide[2]],
  };
}

/** A cab control or door leaf being gathered: its objects' flags, its hinge marker's corners, its drawn box. */
class ControlBuilder {
  role: Control | null = null;
  interior = false;
  /** The control's hinge marker: its first object named …_ROT…, all of whose faces count. */
  pivotObject: string | null = null;
  degrees = 0;
  readonly pivotCorners: number[][] = [];
  readonly box = emptyBox();
  drawn = false;
  index = -1;

  constructor(readonly key: string) {}

  add(objectRole: ObjectRole, object: string, corners: Float32Array): void {
    const control = objectRole.control as Control;
    this.role = this.role === null ? control : merge(this.role, control);
    this.interior ||= hasToken(object, 'INTERIOR');
    if (objectRole.pivotDegrees !== null && this.pivotObject === null) {
      // IR takes the first object of the control named …_ROT…
      this.pivotObject = object;
      this.degrees = objectRole.pivotDegrees;
    }
    if (object === this.pivotObject) {
      // every face of it, whatever its material: the corners in file order (PivotAxis)
      for (let i = 0; i + 2 < corners.length; i += 3) this.pivotCorners.push([corners[i]!, corners[i + 1]!, corners[i + 2]!]);
    }
  }

  /** The built control, or null if it has nothing drawn. */
  build(): ModelControl | null {
    const box = this.box;
    if (!this.drawn || box[0]! > box[3]! || this.role === null) return null;
    let pivot: Vec3 | null = null;
    let axis: Vec3 = [0, 1, 0];
    if (this.pivotCorners.length > 0) {
      const hinge = pivotAxis(this.pivotCorners);
      // OBJ → model frame: (x, y, z) → (z, y + lift, −x), the lift in double; axes turn alike
      pivot = [f(hinge.centre[2]), f(hinge.centre[1] + Y_LIFT_DOUBLE), f(-hinge.centre[0])];
      axis = [f(hinge.axis[2]), f(hinge.axis[1]), f(-hinge.axis[0])];
    }
    const slide: Vec3 = [this.role.slide[2], this.role.slide[1], -this.role.slide[0]];
    return {
      role: this.role,
      interior: this.interior,
      pivot,
      axis,
      degrees: this.degrees,
      slide,
      boxMin: [box[0]!, box[1]!, box[2]!],
      boxMax: [box[3]!, box[4]!, box[5]!],
    };
  }
}

/** One coupler head state being gathered: the box of its drawn faces, whether it draws any itself. */
class CouplerBuilder {
  readonly box = emptyBox();
  drawn = false;
  index = -1;

  constructor(
    readonly front: boolean,
    readonly shown: CouplerShown,
  ) {}
}

/** One wheelset: the span of all its corners, textured or not. */
class WheelBuilder {
  minX = MAX_FLOAT;
  maxX = -MAX_FLOAT;
  minY = MAX_FLOAT;
  maxY = -MAX_FLOAT;

  constructor(
    readonly object: string,
    readonly index: number,
  ) {}

  add(corners: Float32Array): void {
    for (let i = 0; i + 2 < corners.length; i += 3) {
      this.minX = Math.min(this.minX, corners[i]!);
      this.maxX = Math.max(this.maxX, corners[i]!);
      this.minY = Math.min(this.minY, corners[i + 1]!);
      this.maxY = Math.max(this.maxY, corners[i + 1]!);
    }
  }
}

/** One bogie being gathered: its pivot and its wheelsets by object. */
class BogieBuilder {
  readonly pivotZ: number;
  readonly wheels = new Map<string, WheelBuilder>();

  constructor(pivot: number) {
    this.pivotZ = f(pivot);
  }

  build(): Bogie {
    const wheels: Wheel[] = [];
    for (const wheel of this.wheels.values()) {
      const axleX = f(f(wheel.minX + wheel.maxX) / 2); // OBJ axle position along travel
      const axleY = f(f(wheel.minY + wheel.maxY) / 2); // OBJ axle height
      wheels.push({ object: wheel.object, axleX, axleY, centerY: f(axleY + Y_LIFT), centerZ: f(-axleX - this.pivotZ), radius: WHEEL_RADIUS });
    }
    return { pivotZ: this.pivotZ, wheels };
  }
}

type Target = ControlBuilder | CouplerBuilder | WheelBuilder | string | null;

/** A part's role before the lists are numbered: what it belongs to is still a builder. */
interface Pending {
  place: Place;
  front: boolean;
  owner: string | null;
  target: Target;
  light: Light;
}

/** A headlight from its lens object's faces (model frame): a front lamp (model +Z half) shines forward. */
function headlight(model: Float32Array, role: ObjectRole, group: number): Headlight {
  const box = emptyBox();
  bound(box, model);
  const [x0, y0, z0, x1, y1, z1] = box as [number, number, number, number, number, number];
  const forward = f(f(z0 + z1) * 0.5) >= 0;
  return {
    x: f(f(x0 + x1) * 0.5),
    y: f(f(y0 + y1) * 0.5),
    z: forward ? f(z1 + LENS_GAP) : f(z0 - LENS_GAP),
    dirZ: forward ? 1 : -1,
    radius: f(Math.max(f(x1 - x0), f(y1 - y0)) * 0.5),
    rgb: role.rgb,
    group,
    invert: role.lightInvert,
  };
}

/**
 * `ModelParts.of`: the parts of one model.
 *
 * @param parts the OBJ's parts, in file order
 * @param decl  what its declaration adds
 */
export function modelParts(parts: readonly Part[], decl: Declaration = NO_DECLARATION): ModelParts {
  const input = parts.map((part) => ({ object: part.object, material: part.material, textured: part.textured, corners: floats(part.corners) }));
  const skipPrefixes = [...DEFAULT_SKIP_PREFIXES, ...decl.skip];
  const pivots = decl.bogies ?? measurePivots(input);
  // bogie pivots: front first, +forward = model +Z
  const front = new BogieBuilder(pivots[0] ?? 0);
  const rear = new BogieBuilder(pivots[pivots.length - 1] ?? 0);
  const controlBuilders = new Map<string, ControlBuilder>();
  const leafBuilders = new Map<string, ControlBuilder>();
  const couplerBuilders = new Map<string, CouplerBuilder>();
  const doorObjects = new Map<string, Set<string>>();
  const lightGroups: string[] = [];
  const interiorGroups = new Set<number>();
  const lampCandidates: Lamp[] = [];
  const headlights: Headlight[] = [];
  const droppedGroups = new Set<string>();
  let skipped = 0;

  /** A drawn part's light, its group numbered on first sight. */
  const lightOf = (object: string, role: ObjectRole): Light => {
    let group = -1;
    if (role.lightGroup !== null) {
      group = lightGroups.indexOf(role.lightGroup);
      if (group < 0) {
        group = lightGroups.length;
        lightGroups.push(role.lightGroup);
      }
    }
    const interior = hasToken(object, 'INTERIOR');
    if (interior && group >= 0) interiorGroups.add(group);
    return { group, fullbright: role.fullbright, interior, invert: role.lightInvert };
  };

  const doorLeaves = DoorLeaves.of(
    input.map((part) => part.object),
    skipPrefixes,
    decl.animated.keys(),
  );

  /** Where one part goes, gathering what it adds to the model's controls, lights and lamps. */
  const place = (part: (typeof input)[number]): Pending => {
    const object = part.object;
    const parsed = parseRole(object);
    for (const name of tooLongGroups(parsed)) droppedGroups.add(name);
    const role = fitGroups(parsed);
    // a hidden switch-driven part (the ChME3 tail lamps) shows by its group, a coupler
    // head by its end's coupling (SPEC §6.12); other HIDE objects stay out
    const drop = dropped(object, skipPrefixes);
    if (drop !== null) {
      skipped++;
      return { place: drop, front: false, owner: null, target: null, light: NO_LIGHT };
    }
    const head = coupled(object);
    const bogie = head !== null ? null : object.startsWith('BOGEY_FRONT') ? front : object.startsWith('BOGEY_REAR') ? rear : null;
    let coupler: CouplerBuilder | null = null;
    if (head !== null) {
      const key = `${head.front}:${head.shown}`;
      coupler = couplerBuilders.get(key) ?? null;
      if (coupler === null) {
        coupler = new CouplerBuilder(head.front, head.shown);
        couplerBuilders.set(key, coupler);
      }
    }
    if (bogie !== null && object.includes('_WHEEL_')) {
      let wheel = bogie.wheels.get(object);
      if (wheel === undefined) {
        wheel = new WheelBuilder(object, bogie.wheels.size);
        bogie.wheels.set(object, wheel);
      }
      wheel.add(part.corners);
      return { place: part.textured ? 'WHEEL' : 'UNTEXTURED', front: bogie === front, owner: object, target: wheel, light: NO_LIGHT };
    }
    const doorId = bogie === null && coupler === null ? (decl.animated.get(object) ?? null) : null;
    // a door leaf moved by name is built like a control (SPEC §9.5); a DOOR_<n>
    // object the asset doesn't move is part of the body
    const leafRole = doorLeaves.leaf(object);
    let control: ControlBuilder | null = null;
    if (leafRole?.control != null) {
      control = builder(leafBuilders, leafRole.control.key);
    } else if (bogie === null && doorId === null && role.control !== null) {
      control = builder(controlBuilders, role.control.key);
    }
    // a pivot marker counts even without a texture
    control?.add(leafRole ?? role, object, part.corners);
    if (!part.textured) {
      skipped++;
      return { place: 'UNTEXTURED', front: false, owner: control !== null ? control.key : doorId, target: control, light: NO_LIGHT };
    }
    const light = lightOf(object, role);
    const model = bogie === null ? toModel(part.corners) : null;
    if (control !== null && model !== null) {
      control.drawn = true;
      bound(control.box, model);
    }
    if (coupler !== null && model !== null) bound(coupler.box, model);
    if (bogie === null && doorId === null && model !== null) {
      if (role.headlight) {
        headlights.push(headlight(model, role, light.group));
      } else if (role.fullbright && control === null) {
        for (const [x, y, z] of lampIslands(model)) lampCandidates.push({ x, y, z, group: light.group, invert: light.invert });
      }
    }
    if (doorId !== null) {
      let objects = doorObjects.get(doorId);
      if (objects === undefined) {
        objects = new Set();
        doorObjects.set(doorId, objects);
      }
      objects.add(object);
      return { place: 'ANIMATED', front: false, owner: doorId, target: doorId, light };
    }
    if (control !== null) return { place: leafRole !== null ? 'DOOR_LEAF' : 'CONTROL', front: false, owner: control.key, target: control, light };
    if (coupler !== null && head !== null) {
      coupler.drawn = true;
      return { place: 'COUPLER', front: head.front, owner: null, target: coupler, light };
    }
    if (bogie !== null) return { place: 'BOGIE', front: bogie === front, owner: null, target: null, light };
    return { place: object.startsWith('INTERIOR') ? 'INTERIOR' : 'BODY', front: false, owner: null, target: null, light };
  };

  const pending = input.map(place);

  // number the lists and give every part its place in them
  const controls: ModelControl[] = [];
  for (const b of controlBuilders.values()) {
    let built = b.build();
    if (built !== null && decl.handbrake.includes(b.key)) {
      // the declaration says this widget is the handbrake wheel (SPEC §5.3)
      built = { ...built, role: { ...built.role, kind: 'HANDBRAKE', gauge: GAUGE_KIND.get('HANDBRAKE') ?? false } };
    }
    if (built !== null) {
      b.index = controls.length;
      controls.push(built);
    }
  }
  const leaves: ModelControl[] = [];
  for (const b of leafBuilders.values()) {
    const built = b.build();
    if (built !== null) {
      b.index = leaves.length;
      leaves.push(built);
    }
  }
  const doorIds = [...doorObjects.keys()];
  const doors = [...doorObjects].map(([id, objects]) => ({ id, objects: [...objects] }));
  const couplers = buildCouplers([...couplerBuilders.values()]);
  // cabin lamps light the inside only if their group lights something inside
  // (ChME3/platzkart IL); buffer and bogie lamps (FBL, BgL) stay outdoors
  const lamps = lampCandidates.filter((lamp) => lamp.group >= 0 && interiorGroups.has(lamp.group));
  const roles = pending.map((p): Role => {
    const t = p.target;
    const index = t === null ? -1 : typeof t === 'string' ? doorIds.indexOf(t) : t.index;
    return { place: p.place, front: p.front, owner: p.owner, index, light: p.light };
  });
  return {
    roles,
    lightGroups,
    frontBogie: front.build(),
    rearBogie: rear.build(),
    controls,
    doorLeaves: leaves,
    doors,
    couplers,
    lamps,
    headlights,
    droppedGroups: [...droppedGroups],
    skipped,
  };
}

function builder(builders: Map<string, ControlBuilder>, key: string): ControlBuilder {
  let found = builders.get(key);
  if (found === undefined) {
    found = new ControlBuilder(key);
    builders.set(key, found);
  }
  return found;
}

/**
 * The coupler heads (SPEC §6.12), each state of each end, all of an end turning on one
 * pivot: on the centre line, at mid-height of the end's heads, at their inner end — where
 * the shank comes out of the frame.
 */
function buildCouplers(builders: readonly CouplerBuilder[]): Coupler[] {
  const built: Coupler[] = [];
  for (const atFront of [true, false]) {
    const box = emptyBox();
    for (const c of builders) {
      if (c.front !== atFront || !c.drawn) continue;
      for (let i = 0; i < 3; i++) {
        box[i] = Math.min(box[i]!, c.box[i]!);
        box[i + 3] = Math.max(box[i + 3]!, c.box[i + 3]!);
      }
    }
    if (box[0]! > box[3]!) continue; // no head at this end
    const pivot: Vec3 = [0, f(f(box[1]! + box[4]!) * 0.5), atFront ? box[2]! : box[5]!];
    for (const c of builders) {
      if (c.front !== atFront || !c.drawn) continue;
      c.index = built.length;
      built.push({ front: atFront, shown: c.shown, pivot: [...pivot] });
    }
  }
  return built;
}
