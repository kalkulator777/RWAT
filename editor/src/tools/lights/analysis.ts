/**
 * What the lights tool shows of the open model (docs/proposals/editor.md §2.4, §3.9;
 * pack-capabilities §5 "Свет"), as the engine reads it (`ModelParts`, ports/modelParts —
 * the model worker's `engine`, model frame, turned into the OBJ frame here):
 *
 * - each headlight as a cone out of its lens the way it shines — forward from the front
 *   half of the model, backward from the rear half, whichever half its lens is in (the
 *   engine's rule: the way is not set by the pack) —, its colour (`_0X<RRGGBB>`) told in
 *   the inspector. The cone is a sign of the way, not of the beam's size;
 * - each cabin lamp (a glowing island of a group that also lights something inside) as a
 *   point;
 * - the light groups (`_LCG_`) with what each lights: its headlights, lamps and objects,
 *   whether it lights the inside, which of them burn while it is off (`LINVERT`).
 *
 * The group chosen has its headlights and lamps in a colour of their own. Nothing here is
 * written to the pack. Pure: no DOM, no signals.
 */

import type { LoadedModel, OverlayShape, Vec3 } from '../../core/contracts';
import type { EngineParts } from '../../core/contracts';
import type { Headlight, Lamp } from '../../ports/modelParts';
import { objDirection, objPoint } from '../../preview/pose';

/** The tool's overlay layers, in drawing order. */
export const LIGHT_LAYERS = ['lights.lamps', 'lights.headlights'] as const;

export type LightLayer = (typeof LIGHT_LAYERS)[number];

/** The overlay style of the chosen group's headlights and lamps (view3d overlays). */
export const CHOSEN_STYLE = 'lights.chosen';

/** How long a headlight's cone is drawn, blocks (the preview's beam arrow is as long). */
export const CONE_LENGTH = 1.5;
/** How wide the cone opens: its radius at the far end over its length, past the lens's own. */
const CONE_SPREAD = 0.2;
/** A lens is drawn at least this big, blocks of radius. */
const MIN_LENS = 0.05;
/** The corners of a cone's end ring. */
const RING = 16;
/** The radius of a lamp's circle, blocks. */
export const LAMP_RADIUS = 0.12;

/** The chosen group: an index of the model's light groups, or {@link NO_GROUP} for the lights of no group. */
export type GroupChoice = number | null;

/** The lights of no group: they shine always. */
export const NO_GROUP = -1;

/** A headlight as the tool shows it. */
export interface HeadlightView {
  readonly index: number;
  /** The middle of its lens, OBJ frame. */
  readonly lens: Vec3;
  /** Which way it shines, OBJ frame: forward (−X) or backward (+X). */
  readonly way: Vec3;
  readonly forward: boolean;
  /** Its colour as `#rrggbb`. */
  readonly colour: string;
  readonly group: number;
  /** Burns while its group is off (`LINVERT`). */
  readonly invert: boolean;
}

/** A light group as the tool shows it. */
export interface GroupView {
  /** Its index in the model's light groups, {@link NO_GROUP} for the lights of none. */
  readonly index: number;
  /** Its name (`_LCG_<name>`); null for the lights of no group. */
  readonly name: string | null;
  /** Its headlights and cabin lamps, by index. */
  readonly headlights: readonly number[];
  readonly lamps: readonly number[];
  /** The objects it lights, in the model's order. */
  readonly objects: readonly string[];
  /** It lights the inside: one of its objects is in the cabin lamps' light (`INTERIOR`). */
  readonly interior: boolean;
  /** Its objects that burn while it is off (`LINVERT`). */
  readonly inverted: readonly string[];
}

/** What the tool shows of a model's lights. */
export interface LightsPicture {
  readonly headlights: readonly HeadlightView[];
  /** The cabin lamps, OBJ frame, with their group. */
  readonly lamps: readonly { readonly at: Vec3; readonly group: number; readonly invert: boolean }[];
  /** The model's light groups in its order; the lights of no group last, when there are any. */
  readonly groups: readonly GroupView[];
  readonly layers: Readonly<Record<LightLayer, OverlayShape[]>>;
}

/** A colour `0xRRGGBB` as `#rrggbb`. */
export function colourOf(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
}

function plus(a: Vec3, b: Vec3, scale: number): Vec3 {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

/** A headlight as the tool shows it: the engine's lens and way turned into the OBJ frame. */
export function headlightView(headlight: Headlight, index: number): HeadlightView {
  return {
    index,
    lens: objPoint([headlight.x, headlight.y, headlight.z]),
    way: objDirection([0, 0, headlight.dirZ]),
    forward: headlight.dirZ > 0,
    colour: colourOf(headlight.rgb),
    group: headlight.group,
    invert: headlight.invert,
  };
}

/** The shapes of a headlight's cone: its axis, two triangles across each other and the ring at its end. */
export function coneShapes(headlight: Headlight, style: string): OverlayShape[] {
  const view = headlightView(headlight, 0);
  const end = plus(view.lens, view.way, CONE_LENGTH);
  const radius = Math.max(headlight.radius, MIN_LENS) + CONE_LENGTH * CONE_SPREAD;
  // the way is along X: the ring lies in the plane of Y and Z
  const up: Vec3 = [0, 1, 0];
  const side: Vec3 = [0, 0, 1];
  const ring: Vec3[] = [];
  for (let i = 0; i < RING; i++) {
    const a = (2 * Math.PI * i) / RING;
    ring.push(plus(plus(end, up, radius * Math.cos(a)), side, radius * Math.sin(a)));
  }
  return [
    { shape: 'arrow', from: view.lens, to: end, style },
    { shape: 'polygon', points: [view.lens, plus(end, side, radius), plus(end, side, -radius)], style },
    { shape: 'polygon', points: [view.lens, plus(end, up, radius), plus(end, up, -radius)], style },
    { shape: 'polygon', points: ring, style },
  ];
}

function lampShapes(lamp: Lamp, style: string): OverlayShape[] {
  const at = objPoint([lamp.x, lamp.y, lamp.z]);
  return [
    { shape: 'point', at, style },
    { shape: 'circle', centre: at, radius: LAMP_RADIUS, style },
  ];
}

/** The model's light groups and what each lights; the lights of no group last, when there are any. */
export function groupViews(model: LoadedModel, engine: EngineParts): GroupView[] {
  const group = (index: number, name: string | null): GroupView => {
    const objects = model.objects.filter((o) => o.engine.light.group === index && (index >= 0 || o.engine.light.fullbright));
    return {
      index,
      name,
      headlights: engine.headlights.flatMap((h, i) => (h.group === index ? [i] : [])),
      lamps: engine.lamps.flatMap((l, i) => (l.group === index ? [i] : [])),
      objects: objects.map((o) => o.name),
      interior: index >= 0 && objects.some((o) => o.engine.light.interior),
      inverted: objects.filter((o) => o.engine.light.invert).map((o) => o.name),
    };
  };
  const groups = engine.lightGroups.map((name, i) => group(i, name));
  const none = group(NO_GROUP, null);
  if (none.headlights.length > 0 || none.lamps.length > 0 || none.objects.length > 0) groups.push(none);
  return groups;
}

function emptyLayers(): Record<LightLayer, OverlayShape[]> {
  return Object.fromEntries(LIGHT_LAYERS.map((layer) => [layer, []])) as unknown as Record<LightLayer, OverlayShape[]>;
}

/** The picture of a model's lights, `chosen` the group whose lights are drawn in their own colour (null: none). */
export function lightsPicture(model: LoadedModel, chosen: GroupChoice): LightsPicture {
  const layers = emptyLayers();
  const engine = model.engine;
  if (engine === null) return { headlights: [], lamps: [], groups: [], layers };
  const styleOf = (group: number, plain: string): string => (chosen !== null && group === chosen ? CHOSEN_STYLE : plain);
  engine.headlights.forEach((h) => layers['lights.headlights'].push(...coneShapes(h, styleOf(h.group, 'headlight'))));
  engine.lamps.forEach((l) => layers['lights.lamps'].push(...lampShapes(l, styleOf(l.group, 'lamp'))));
  return {
    headlights: engine.headlights.map(headlightView),
    lamps: engine.lamps.map((l) => ({ at: objPoint([l.x, l.y, l.z]), group: l.group, invert: l.invert })),
    groups: groupViews(model, engine),
    layers,
  };
}

/**
 * The light group an object of the model is about: the group it is lit by, else the one a
 * control of it switches — a control group's value is the light group's of the same name
 * (a headlight's switch, the shutter over its lens); null for an object of neither.
 */
export function groupOfObject(model: LoadedModel, object: string): number | null {
  const info = model.objects.find((o) => o.name === object);
  if (info === undefined) return null;
  if (info.engine.light.group >= 0) return info.engine.light.group;
  const switched = info.control === undefined ? -1 : (model.engine?.lightGroups.indexOf(info.control.group) ?? -1);
  return switched >= 0 ? switched : null;
}
