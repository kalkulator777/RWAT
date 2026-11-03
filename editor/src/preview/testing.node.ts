/**
 * Node only (tests): the example pack's models as the preview gets them — read by the
 * model pipeline as the model worker reads them (model/testing.node) — their wagon types
 * as the engine reads them, and a stand-in of the 3D view that remembers what it is told.
 */

import type { DisplayMode, LoadedModel, OverlayShape, Vec3, ViewApi, WagonFrame } from '../core/contracts';
import { assetPath, exampleApi, exampleModel, exampleReader, packText, type ExampleWagon } from '../model/testing.node';
import { CORNER_FLOATS, loadModel } from '../ports/obj';
import { parseWagonType, type WagonType } from '../ports/wagonType';
import type { PreviewSubject } from './controller';

export { assetPath, exampleModel, fakeBitmap, packText, type ExampleWagon } from '../model/testing.node';

const NAMESPACE = 'rwat_example';

/** The example wagon's model declaration, as the pack has it. */
function declaration(name: ExampleWagon): { obj: string } {
  return JSON.parse(packText(assetPath(`wagon_models/${name}.json`))) as { obj: string };
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

/** The example wagon's type, as the engine reads it. */
export function exampleType(name: ExampleWagon): WagonType {
  return parseWagonType(`${NAMESPACE}:${name}`, JSON.parse(packText(`data/${NAMESPACE}/wagon_types/${name}.json`)));
}

/** Everything the preview is given for an example wagon; `asked` records each list of textures it asks to decode. */
export async function exampleSubject(name: ExampleWagon, asked: string[][] = []): Promise<PreviewSubject> {
  const reader = await exampleReader();
  return {
    model: await exampleModel(name),
    type: exampleType(name),
    textures: (paths) => {
      asked.push([...paths]);
      return exampleApi.textures(paths, reader);
    },
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
  /** Each texture's picture as last set (null: none). */
  readonly textures: Map<string, ImageBitmap | null>;
  display: DisplayMode | null;
  wireframe: boolean;
  frame: WagonFrame | null;
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
    textures: new Map(),
    display: null,
    wireframe: false,
    frame: null,
    clearCalls() {
      calls.length = 0;
    },
    show(model) {
      calls.push({ method: 'show' });
      view.shown.push(model);
      // a model shown anew stands at rest, everything shown, nothing lit by the preview, in its own textures
      view.transforms.clear();
      view.visible.clear();
      view.lit.clear();
      view.textures.clear();
    },
    setDisplay(mode) {
      calls.push({ method: 'setDisplay' });
      view.display = mode;
    },
    setWireframe(on) {
      calls.push({ method: 'setWireframe' });
      view.wireframe = on;
    },
    setFrame(frame) {
      calls.push({ method: 'setFrame' });
      view.frame = frame;
    },
    setTexture(path, bitmap) {
      calls.push({ method: 'setTexture', object: path });
      view.textures.set(path, bitmap);
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
