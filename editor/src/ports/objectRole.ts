/**
 * What an OBJ object's name says the object does, in the Immersive Railroading convention
 * the packs use (docs/proposals/editor.md §4.1): control kind and number, flags, group,
 * label, offset, range, slide, hinge degrees, light group, door leaf, coupler head.
 *
 * Ported from `convention/ObjectRole.java` (`parse`, `door`, `coupled`, `hasToken`).
 * Golden: fixtures/golden/object_role/. The regular expressions come from
 * schema/obj-conventions.json, written the same for Java, JavaScript and Python; the order
 * of the kinds and the rules around them are code, as in Java. Case matters everywhere.
 *
 * Numbers are floats in Java: they come through {@link parseJavaFloat}, which rounds to a
 * float, and a text Java refuses falls back to the same default.
 *
 * `ObjectRole.objectName` — the name an `o`/`g` line gives — is not here but in ./obj.ts
 * (`objectName`), where the OBJ is read: the one port of that rule.
 */

import conventions from '../../../schema/obj-conventions.json';
import { parseJavaFloat } from './javaNumbers';

/**
 * What a control drives or shows, in the order Java tries them: more specific names first
 * (`GAUGE_THROTTLE_1` is a gauge, not a `THROTTLE`). The names are the `kind` of
 * `control_kinds` in schema/obj-conventions.json, which holds each one's expression.
 */
export const CONTROL_KINDS = [
  'GAUGE_SPEED',
  'GAUGE_THROTTLE',
  'GAUGE_REVERSER',
  'GAUGE_TRAIN_BRAKE',
  'GAUGE_INDEPENDENT_BRAKE',
  'BRAKE_PRESSURE',
  'GAUGE_OTHER',
  'THROTTLE_BRAKE',
  'THROTTLE',
  'REVERSER',
  'TRAIN_BRAKE',
  'INDEPENDENT_BRAKE',
  'HANDBRAKE',
  'BELL',
  'WHISTLE',
  'HORN',
  'ENGINE_START',
  'WIDGET',
  'WINDOW',
  'DOOR',
] as const;

export type ControlKind = (typeof CONTROL_KINDS)[number];

/** One control, as its objects' names declare it. */
export interface Control {
  kind: ControlKind;
  /** True for a readout (moves by itself), false for something a player works. */
  gauge: boolean;
  /** The number in the name, held at int range (`Integer.MAX_VALUE` for digits too many). */
  id: number;
  /** `<KIND>_<n>` as written: the identity of the control's objects. */
  key: string;
  /** The control group it sets or reads: `_CG_<name>`, else `key`. */
  group: string;
  label: string | null;
  toggle: boolean;
  press: boolean;
  invert: boolean;
  hide: boolean;
  noTouch: boolean;
  global: boolean;
  offset: number;
  rangeMin: number;
  rangeMax: number;
  /** Slide at full travel (`TL_<f>_<axis>`), blocks, in the OBJ frame. */
  slide: [number, number, number];
}

/** What a name says. An object with no role has `control` null and `NO_ROLE`'s other fields. */
export interface ObjectRole {
  control: Control | null;
  /** The swing of the control's hinge marker (`<KEY>_ROT[_<degrees>]`) at full travel, or null if the object is no marker. */
  pivotDegrees: number | null;
  lightGroup: string | null;
  lightInvert: boolean;
  fullbright: boolean;
  headlight: boolean;
  /** The lamp colour `0xRRGGBB` (white if the name gives none). */
  rgb: number;
}

export type CouplerShown = 'COUPLED' | 'UNCOUPLED' | 'ALWAYS';

/** A coupler head object: at the front end or the rear, and when it is drawn. */
export interface Coupled {
  front: boolean;
  shown: CouplerShown;
}

/** An object with no role in the convention. */
export const NO_ROLE: ObjectRole = Object.freeze({
  control: null,
  pivotDegrees: null,
  lightGroup: null,
  lightInvert: false,
  fullbright: false,
  headlight: false,
  rgb: 0xffffff,
});

const WHITE = 0xffffff;
const INT_MAX = 2147483647;

function compile(source: string): RegExp {
  return new RegExp(source, 'u');
}

function byId(list: readonly { id: string; regex: string }[], id: string): RegExp {
  const found = list.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`schema/obj-conventions.json has no ${id}`);
  return compile(found.regex);
}

const KIND_PATTERNS: readonly { kind: ControlKind; gauge: boolean; pattern: RegExp }[] = CONTROL_KINDS.map((kind) => {
  const entry = conventions.control_kinds.find((candidate) => candidate.kind === kind);
  if (entry === undefined) throw new Error(`schema/obj-conventions.json has no control kind ${kind}`);
  return { kind, gauge: entry.gauge, pattern: compile(entry.regex) };
});

const COPY_SUFFIX = compile(conventions.naming.copy_suffix.regex);
const CG = byId(conventions.control_modifiers, 'CG');
const LABEL = byId(conventions.control_modifiers, 'LABEL');
const OFFSET = byId(conventions.control_modifiers, 'OFFSET');
const RANGE = new RegExp(byId(conventions.control_modifiers, 'RANGE').source, 'gu');
const SLIDE = new RegExp(byId(conventions.control_modifiers, 'TL').source, 'gu');
const LCG = byId(conventions.lights, 'LCG');
const RGB = byId(conventions.lights, 'RGB');
const HEADLIGHT = byId(conventions.lights, 'HEADLIGHT');
const COUPLED = (() => {
  const role = conventions.roles.find((entry) => entry.id === 'coupler_head');
  const source = role?.match.regex;
  if (source === undefined) throw new Error('schema/obj-conventions.json has no coupler_head role');
  return compile(source);
})();

/** IR's flag test: `_T_` inside, `T_` at the start or `_T` at the end, or the name is `T`. */
export function hasToken(name: string, token: string): boolean {
  return name.includes(`_${token}_`) || name.startsWith(`${token}_`) || name.endsWith(`_${token}`) || name === token;
}

/** The name without Blender's copy suffix (`.001`). */
function normalized(objectName: string): string {
  return objectName.replace(COPY_SUFFIX, '');
}

/** A number from a name as a float, or `fallback` where Java's `Float.parseFloat` refuses it. */
function floatOr(text: string | undefined, fallback: number): number {
  const value = text === undefined ? null : parseJavaFloat(text);
  return value === null ? fallback : Math.fround(value);
}

/** The number of a control from the digits of its name; digits too many for an int hold `Integer.MAX_VALUE`. */
function number(digits: string): number {
  const value = Number(digits);
  return value > INT_MAX ? INT_MAX : value;
}

function control(name: string, door: boolean): Control | null {
  for (const { kind, gauge, pattern } of KIND_PATTERNS) {
    if ((kind === 'DOOR') !== door) continue;
    const m = pattern.exec(name);
    if (m === null) continue;
    const key = `${m[1] ?? ''}_${m[2] ?? ''}`;
    let rangeMin = 0;
    let rangeMax = 1;
    for (const range of name.matchAll(RANGE)) {
      rangeMin = floatOr(range[1], 0);
      rangeMax = floatOr(range[2], 1);
    }
    const slide: [number, number, number] = [0, 0, 0];
    for (const tl of name.matchAll(SLIDE)) {
      slide['XYZ'.indexOf(tl[2] ?? 'X')] = floatOr(tl[1], 0);
    }
    const label = LABEL.exec(name);
    const offset = OFFSET.exec(name);
    return {
      kind,
      gauge,
      id: number(m[2] ?? '0'),
      key,
      group: CG.exec(name)?.[1] ?? key,
      label: label === null ? null : (label[1] ?? '').replaceAll('^', ' '),
      toggle: hasToken(name, 'TOGGLE'),
      press: hasToken(name, 'PRESS'),
      invert: hasToken(name, 'INVERT'),
      hide: hasToken(name, 'HIDE'),
      noTouch: hasToken(name, 'NOTOUCH') || hasToken(name, 'NOINTERACT'),
      global: hasToken(name, 'GLOBAL'),
      offset: offset === null ? 0 : floatOr(offset[1], 0),
      rangeMin,
      rangeMax,
      slide,
    };
  }
  return null;
}

/** The number after the `ROT` token (`…_ROT_90` gives 90), 0 if there is none. */
function degreesAfterRot(name: string): number {
  const tokens = name.split('_');
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === 'ROT') return floatOr(tokens[i + 1], 0);
  }
  return 0;
}

function read(objectName: string, door: boolean): ObjectRole {
  // case matters, as in IR (group names like BgL, Door1)
  const name = normalized(objectName);
  const found = control(name, door);
  // NaN degrees ("ROT_NaN") do not make a marker: Java's `pivot()` is "not NaN"
  let pivotDegrees: number | null = null;
  if (found !== null && name.includes(`${found.key}_ROT`)) {
    const degrees = degreesAfterRot(name);
    pivotDegrees = Number.isNaN(degrees) ? null : degrees;
  }
  const lightGroup = LCG.exec(name)?.[1] ?? null;
  const rgb = RGB.exec(name);
  const headlight = HEADLIGHT.test(name);
  const fullbright = hasToken(name, 'FULLBRIGHT');
  if (found === null && lightGroup === null && !headlight && !fullbright) return NO_ROLE;
  return {
    control: found,
    pivotDegrees,
    lightGroup,
    lightInvert: hasToken(name, 'LINVERT'),
    fullbright,
    headlight,
    rgb: rgb === null ? WHITE : parseInt(rgb[1] ?? 'ffffff', 16),
  };
}

/**
 * Read one object name. Never returns a door leaf: a leaf is worked through its wagon
 * type's door, not as a cab control (see {@link door}).
 *
 * Java: `ObjectRole.parse`.
 */
export function parseRole(objectName: string): ObjectRole {
  return read(objectName, false);
}

/**
 * Read an object name as a door leaf: its `DOOR_<n>` key, flags, hinge
 * (`DOOR_<n>_ROT_<degrees>`) and slide (`TL_<f>_<axis>`), the way {@link parseRole} reads a
 * cab control; null if the name is not a door's.
 *
 * Java: `ObjectRole.door`.
 */
export function door(objectName: string): ObjectRole | null {
  const role = read(objectName, true);
  return role.control !== null ? role : null;
}

/**
 * Read an object name as a coupler head (`COUPLED_FRONT_<n>`, `COUPLED_REAR_<n>`); null if
 * it is none. `HIDE` shows the head while the value is not 1 (hanging free), with `INVERT`
 * while it is coupled; without `HIDE` it shows either way.
 *
 * Java: `ObjectRole.coupled`.
 */
export function coupled(objectName: string): Coupled | null {
  const name = normalized(objectName);
  const head = COUPLED.exec(name);
  if (head === null) return null;
  const shown: CouplerShown = !hasToken(name, 'HIDE') ? 'ALWAYS' : hasToken(name, 'INVERT') ? 'COUPLED' : 'UNCOUPLED';
  return { front: head[1] === 'FRONT', shown };
}

/** True if a head shown so is drawn at an end that is (or is not) `isCoupled`. Java: `Coupled.Shown.at`. */
export function headShownAt(shown: CouplerShown, isCoupled: boolean): boolean {
  return shown === 'ALWAYS' || (shown === 'COUPLED') === isCoupled;
}
