/**
 * Node only (tests): the example pack's models as the preview gets them, built from the
 * repository's files and the engine's own reading of them.
 *
 * The moving things of a model come from the golden cases of `ModelParts`
 * (fixtures/golden/model_parts/, `example-pack-<name>`): what the engine says of the
 * example pack's OBJ, written out by the reference. Until ports/modelParts.ts (agent A3.1)
 * is merged this stands in for it; after the merge the tests may build them with the port
 * instead. The rest is read with the ports: the wagon type (ports/wagonType), the `.anim`
 * frames (ports/anim), the textures the MTL names (ports/mtl).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import conventions from '../../../schema/obj-conventions.json';
import type { LoadedModel, OverlayShape, Vec3, ViewApi } from '../core/contracts';
import { parse as parseAnim } from '../ports/anim';
import { folderOf, parse as parseMtl, resolve } from '../ports/mtl';
import { loadModel, CORNER_FLOATS } from '../ports/obj';
import type { Control, ControlKind, CouplerShown } from '../ports/objectRole';
import { parseWagonType, type WagonType } from '../ports/wagonType';
import { EXAMPLE_PACK, GOLDEN_DIR } from '../testing/repo.node';
import type { PreviewSubject } from './controller';
import { liverySwaps } from './livery';
import type { MovingPart, PartRole, Place, PreviewParts } from './parts';
import { objDirection } from './pose';

/** The example pack's wagons. */
export type ExampleWagon = 'coach' | 'shunter' | 'gondola';

const NAMESPACE = 'rwat_example';

interface GoldenControl {
  key: string;
  kind: ControlKind;
  group: string;
  label: string | null;
  flags: string[];
  offset: number;
  range: [number, number];
  interior: boolean;
  pivot: Vec3 | null;
  axis: Vec3;
  degrees: number;
  slide: Vec3;
  box_min: Vec3;
  box_max: Vec3;
}

interface GoldenParts {
  parts: { object: string; place: Place; front: boolean; owner: string | null; index: number; light: [number, boolean, boolean, boolean] }[];
  light_groups: string[];
  controls: GoldenControl[];
  door_leaves: GoldenControl[];
  doors: { id: string; objects: string[] }[];
  couplers: { front: boolean; shown: CouplerShown; pivot: Vec3 }[];
  lamps: { at: Vec3; group: number; invert: boolean }[];
  headlights: { at: Vec3; dir_z: number; radius: number; rgb: string; group: number; invert: boolean }[];
}

interface ModelDeclaration {
  obj: string;
  animations?: Record<string, string>;
  liveries?: Record<string, string>;
}

/** A pack file's path inside the pack → its place on disk. */
function onDisk(packPath: string): string {
  return join(EXAMPLE_PACK, ...packPath.split('/'));
}

function packText(packPath: string): string {
  return readFileSync(onDisk(packPath), 'utf8');
}

/** `stock/coach/coach.obj` of the example pack's namespace → `assets/rwat_example/stock/coach/coach.obj`. */
export function assetPath(ref: string): string {
  return `assets/${NAMESPACE}/${ref}`;
}

/** The model declaration of an example wagon. */
export function declaration(name: ExampleWagon): ModelDeclaration {
  return JSON.parse(packText(assetPath(`wagon_models/${name}.json`))) as ModelDeclaration;
}

/** The example wagon's OBJ, as the pack has it. */
export function objText(name: ExampleWagon): string {
  return packText(assetPath(declaration(name).obj));
}

/** The corners of every face of every part of `object` in file order, OBJ frame, as ports/obj keeps them. */
export function cornersOf(obj: string, object: string): Vec3[] {
  const corners: Vec3[] = [];
  for (const part of loadModel(obj).parts) {
    if (part.object !== object) continue;
    for (let at = 0; at < part.quads.length; at += CORNER_FLOATS) corners.push([part.quads[at]!, part.quads[at + 1]!, part.quads[at + 2]!]);
  }
  return corners;
}

/** The control a golden list writes out, as ports/objectRole holds one (its slide back in the OBJ frame). */
function role(c: GoldenControl): Control {
  const gauge = conventions.control_kinds.find((entry) => entry.kind === c.kind)?.gauge ?? false;
  const flag = (name: string): boolean => c.flags.includes(name);
  return {
    kind: c.kind,
    gauge,
    id: Number(/(\d+)$/.exec(c.key)?.[1] ?? '0'),
    key: c.key,
    group: c.group,
    label: c.label,
    toggle: flag('TOGGLE'),
    press: flag('PRESS'),
    invert: flag('INVERT'),
    hide: flag('HIDE'),
    noTouch: flag('NOTOUCH'),
    global: flag('GLOBAL'),
    offset: c.offset,
    rangeMin: c.range[0],
    rangeMax: c.range[1],
    slide: [...objDirection(c.slide)],
  };
}

function moving(c: GoldenControl): MovingPart {
  return {
    role: role(c),
    interior: c.interior,
    pivot: c.pivot,
    axis: c.axis,
    degrees: c.degrees,
    slide: c.slide,
    boxMin: c.box_min,
    boxMax: c.box_max,
  };
}

/** The engine's reading of an example wagon's model (golden `model_parts`, `example-pack-<name>`) and its `.anim` frames. */
export function exampleParts(name: ExampleWagon): PreviewParts {
  const file = JSON.parse(readFileSync(join(GOLDEN_DIR, 'model_parts', 'parts.json'), 'utf8')) as {
    cases: { id: string; expected: GoldenParts }[];
  };
  const found = file.cases.find((c) => c.id === `example-pack-${name}`);
  if (found === undefined) throw new Error(`golden model_parts has no example-pack-${name}`);
  const e = found.expected;
  const tracks = new Map<string, readonly Float32Array[]>();
  for (const anim of Object.values(declaration(name).animations ?? {})) {
    for (const [object, frames] of parseAnim(packText(assetPath(anim)))) if (frames.length > 0) tracks.set(object, frames);
  }
  return {
    parts: e.parts.map(
      (p): PartRole => ({
        object: p.object,
        place: p.place,
        front: p.front,
        owner: p.owner,
        index: p.index,
        light: { group: p.light[0], fullbright: p.light[1], interior: p.light[2], invert: p.light[3] },
      }),
    ),
    lightGroups: e.light_groups,
    controls: e.controls.map(moving),
    doorLeaves: e.door_leaves.map(moving),
    doors: e.doors,
    couplers: e.couplers,
    lamps: e.lamps,
    headlights: e.headlights.map((h) => ({ at: h.at, dirZ: h.dir_z, radius: h.radius, rgb: parseInt(h.rgb, 16), group: h.group, invert: h.invert })),
    tracks,
  };
}

/** The example wagon's type, as the engine reads it. */
export function exampleType(name: ExampleWagon): WagonType {
  return parseWagonType(`${NAMESPACE}:${name}`, JSON.parse(readFileSync(join(EXAMPLE_PACK, 'data', NAMESPACE, 'wagon_types', `${name}.json`), 'utf8')));
}

/** The textures the example wagon's MTL files name, pack paths, in their order (`IrStockModel.materialTextures`). */
export function baseTextures(name: ExampleWagon): string[] {
  const obj = declaration(name).obj;
  const folder = folderOf(obj);
  const textures: string[] = [];
  for (const library of loadModel(objText(name)).materialLibraries) {
    const mtl = resolve(folder, library);
    if (mtl === null) continue;
    for (const map of parseMtl(packText(assetPath(mtl))).values()) {
      const texture = resolve(folder, map);
      if (texture !== null && !textures.includes(assetPath(texture))) textures.push(assetPath(texture));
    }
  }
  return textures;
}

/** Every PNG of the example pack's models, pack paths. */
function pngs(): string[] {
  const found: string[] = [];
  const walk = (packPath: string): void => {
    for (const entry of readdirSync(onDisk(packPath))) {
      const child = `${packPath}/${entry}`;
      if (statSync(onDisk(child)).isDirectory()) walk(child);
      else if (entry.endsWith('.png')) found.push(child);
    }
  };
  walk(assetPath('stock'));
  return found.sort();
}

/** A stand-in for a decoded texture: Node has no `ImageBitmap`; tests only tell them apart. */
export function fakeBitmap(packPath: string): ImageBitmap {
  return { path: packPath, width: 1, height: 1, close: () => undefined } as unknown as ImageBitmap;
}

/** The example wagon as the model worker would hand it over: no geometry (the preview needs none), every texture of the pack's models. */
export function exampleModel(name: ExampleWagon): LoadedModel {
  return {
    id: `${NAMESPACE}:${name}`,
    parts: [],
    objects: [],
    textures: Object.fromEntries(pngs().map((path) => [path, fakeBitmap(path)])),
    problems: [],
  };
}

/** Everything the preview is given for an example wagon. */
export function exampleSubject(name: ExampleWagon): PreviewSubject {
  const decl = declaration(name);
  return {
    model: exampleModel(name),
    parts: exampleParts(name),
    type: exampleType(name),
    liveries: liverySwaps(assetPath(decl.obj), decl.liveries ?? {}, baseTextures(name), (path) => existsSync(onDisk(path))),
  };
}

/** A 3D view that draws nothing and remembers what it was told (`ViewApi`, editor.md §3.13). */
export interface RecordingView extends ViewApi {
  /** Every call, in order: the method and the object or layer it was about. */
  readonly calls: { method: keyof ViewApi; object?: string }[];
  /** The models shown, in order. */
  readonly shown: (LoadedModel | null)[];
  /** Each object's transform as last set (null: rest). */
  readonly transforms: Map<string, Float32Array | null>;
  readonly visible: Map<string, boolean>;
  readonly lit: Map<string, boolean>;
  readonly overlays: Map<string, OverlayShape[]>;
  display: 'roles' | 'textured' | 'lit' | null;
  /** Forgets the calls so far (where the objects stand stays). */
  clearCalls(): void;
}

export function recordingView(): RecordingView {
  const calls: { method: keyof ViewApi; object?: string }[] = [];
  const view: RecordingView = {
    calls,
    shown: [],
    transforms: new Map(),
    visible: new Map(),
    lit: new Map(),
    overlays: new Map(),
    display: null,
    clearCalls() {
      calls.length = 0;
    },
    show(model) {
      calls.push({ method: 'show' });
      view.shown.push(model);
      // a model shown anew stands at rest, everything shown, nothing lit by the preview
      view.transforms.clear();
      view.visible.clear();
      view.lit.clear();
    },
    setDisplay(mode) {
      calls.push({ method: 'setDisplay' });
      view.display = mode;
    },
    setTransform(object, matrix) {
      calls.push({ method: 'setTransform', object });
      view.transforms.set(object, matrix === null ? null : Float32Array.from(matrix));
    },
    setVisible(object, visible) {
      calls.push({ method: 'setVisible', object });
      view.visible.set(object, visible);
    },
    setLit(object, lit) {
      calls.push({ method: 'setLit', object });
      view.lit.set(object, lit);
    },
    overlay(layer, shapes) {
      calls.push({ method: 'overlay', object: layer });
      view.overlays.set(layer, shapes);
    },
    onPick() {
      return () => undefined;
    },
  };
  return view;
}
