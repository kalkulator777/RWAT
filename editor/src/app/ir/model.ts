/**
 * The IR type's model in the 3D view (editor.md §2.6, step 3; §3.11): its OBJ, MTLs,
 * textures, liveries and animations read straight out of the IR zips — the entries the
 * converter found (ir/bridge `modelFiles`; TypeScript never looks for an IR path) or the
 * bytes it writes instead where it rewrites a path — by the model worker, as a pack's model
 * is (model/client `ModelLoader`), with the model declaration and the type the pack gets
 * (the override on top of what was derived). The view gets the type's frame, the preview
 * the model and the type, the objects tab the model, and the generated floor is drawn over
 * it: its zones, and dashed those it gave before the last "Перегенерировать пол".
 *
 * The wiring is on in the IR mode only (`active`); the pack's own (app/openModel.ts) is off
 * then, and each shows its model anew when its mode comes back.
 */

import { batch, effect, untracked, type ReadonlySignal } from '@preact/signals';
import { failedModel } from '../../checks/model/problems';
import type { LoadedModel, OverlayShape, Vec3, ViewApi } from '../../core/contracts';
import { isJsonObject } from '../../core/json';
import type { Entry } from '@zip.js/zip.js';
import { loadZipJs, NO_WORKERS } from '../../io/zipjs';
import type { ModelFile } from '../../ir/bridge';
import { MISSING, type ModelFiles } from '../../model/files';
import { loadWagonType } from '../../ports/wagonType';
import type { PreviewSubject } from '../../preview/controller';
import { wagonFrame } from '../../view3d/frame';
import type { ModelSource } from '../openModel';
import { modelLoading, modelProblems, openModel } from '../store';
import type { IrSession } from './session';
import { irOpenType, irSession, irShowFloor } from './state';

/** The overlay layer of the generated floor. */
export const FLOOR_LAYER = 'ir.floor';

type ZipEntry = Entry;

/** The entries of a zip by the zip's own name, its central directory read once a zip. */
const directories = new WeakMap<Blob, Promise<Map<string, ZipEntry>>>();

function entriesOf(zip: Blob): Promise<Map<string, ZipEntry>> {
  let known = directories.get(zip);
  if (known === undefined) {
    known = (async () => {
      const zipjs = await loadZipJs();
      const all = await new zipjs.ZipReader(new zipjs.BlobReader(zip), { ...NO_WORKERS, filenameValidation: 'tolerant' }).getEntries();
      return new Map(all.map((entry) => [entry.filename, entry]));
    })();
    directories.set(zip, known);
    known.catch(() => directories.delete(zip));
  }
  return known;
}

/** Reads one entry of a zip (its own name), inflating that one only. */
export async function readEntry(zip: Blob, name: string): Promise<Uint8Array> {
  const entry = (await entriesOf(zip)).get(name);
  if (entry === undefined || entry.directory) throw new Error(`no entry ${name} in the zip`);
  const zipjs = await loadZipJs();
  return entry.getData(new zipjs.Uint8ArrayWriter(), NO_WORKERS);
}

/**
 * A type's model files for the model client: the converted pack's paths, each read out of
 * its source zip (or the bytes the converter rewrites); stamped with the session (the zips
 * do not change under it).
 */
export function irModelFiles(files: readonly ModelFile[], zipOf: (source: number) => Blob | undefined, stamp: string): ModelFiles {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return {
    has: (path) => byPath.has(path),
    read: async (path) => {
      const file = byPath.get(path);
      if (file === undefined) throw new Error(`no file ${path} in the model`);
      if (file.bytes !== null) return file.bytes.slice();
      const zip = zipOf(file.source);
      if (zip === undefined) throw new Error(`no zip for source ${file.source}`);
      return readEntry(zip, file.entry);
    },
    stamp: (path) => (byPath.has(path) ? stamp : MISSING),
  };
}

/** The zones of a floor (`type.interior` as written: a list, or one zone in the old form) as flat rectangles at their floor, in a style. */
export function zoneShapes(zones: unknown, style: string, wagon: string | null): OverlayShape[] {
  const list = Array.isArray(zones) ? zones : isJsonObject(zones) ? [zones] : [];
  const shapes: OverlayShape[] = [];
  list.forEach((zone, index) => {
    if (!isJsonObject(zone) || !Array.isArray(zone.min) || !Array.isArray(zone.max) || zone.min.length !== 3 || zone.max.length !== 3) return;
    const shape: OverlayShape = { shape: 'rect', min: zone.min as Vec3, max: zone.max as Vec3, style };
    shapes.push(wagon === null ? shape : { ...shape, link: { kind: 'zone', type: wagon, index } });
  });
  return shapes;
}

/** What the IR model is wired to: the page's model loader (one of its own: its own three models), the view, the preview, the IR mode. */
export interface IrModelWiring {
  loader: ModelSource;
  view: ViewApi;
  preview: { load(subject: PreviewSubject | null): void };
  /** True in the IR mode. */
  active: ReadonlySignal<boolean>;
}

/** Follows the IR session, its open type and its edits, shows the type's model and floor, until the returned function is called. */
export function connectIrModel(wiring: IrModelWiring): () => void {
  const { loader, view, preview } = wiring;
  /** Grows with every reading asked for: an answer for an older one is dropped. */
  let generation = 0;
  let shown: { model: LoadedModel; typeKey: string } | null = null;
  /** True while the view shows another's model (the pack's mode was last), or might. */
  let stale = true;
  let lastSession: IrSession | null = null;

  const close = (): void => {
    if (shown !== null || stale) {
      view.show(null);
      view.setFrame(null);
      view.overlay(FLOOR_LAYER, []);
      preview.load(null);
      shown = null;
      stale = false;
    }
    batch(() => {
      openModel.value = null;
      modelProblems.value = [];
      modelLoading.value = false;
    });
  };

  const drawFloor = (session: IrSession, id: string): void => {
    const entry = session.floor(id);
    const wagon = `${session.namespace}:${id}`;
    const shapes = !irShowFloor.peek() || entry === undefined ? [] : [...zoneShapes(entry.previous, 'draft', null), ...zoneShapes(entry.floor?.interior, 'zone', wagon)];
    view.overlay(FLOOR_LAYER, shapes);
  };

  const follow = (session: IrSession | null, id: string | null): void => {
    if (session !== lastSession) {
      loader.clear();
      lastSession = session;
    }
    const layers = session === null || id === null ? null : session.layers(id);
    if (session === null || id === null || layers === null) {
      generation++;
      close();
      return;
    }
    session.ensureFloor(id);
    drawFloor(session, id);
    const namespace = session.namespace;
    const wagon = `${namespace}:${id}`;
    const declaration = layers.result.model;
    const typeJson = layers.result.type;
    const typeKey = JSON.stringify(typeJson);
    const gen = ++generation;
    modelLoading.value = true;
    void (async () => {
      let model: LoadedModel;
      const files = irModelFiles(await session.modelFiles(id).catch(() => []), (source) => session.sourceZip(source), `ir ${session.serial}`);
      try {
        model = await loader.load(files, { id: wagon, file: `assets/${namespace}/wagon_models/${id}.json`, declaration });
      } catch (error) {
        if (gen !== generation) return;
        close();
        modelProblems.value = [failedModel({ id: wagon, file: session.typeLink(id).file }, error)];
        return;
      }
      if (gen !== generation) return;
      if (stale) shown = null;
      stale = false;
      if (shown === null || shown.model !== model || shown.typeKey !== typeKey) {
        const type = loadWagonType(wagon, typeJson).type;
        if (shown?.model !== model) view.show(model);
        view.setFrame(type === null ? null : wagonFrame(type));
        preview.load({ model, type, textures: (paths) => loader.textures(files, paths) });
        shown = { model, typeKey };
      }
      batch(() => {
        openModel.value = model;
        modelProblems.value = model.problems;
        modelLoading.value = false;
      });
    })();
  };

  const pause = (): void => {
    generation++;
    if (!stale) view.overlay(FLOOR_LAYER, []);
    stale = true;
  };

  const stop = effect(() => {
    const on = wiring.active.value;
    const session = irSession.value;
    const id = irOpenType.value;
    void session?.revision.value;
    void irShowFloor.value;
    untracked(() => (on ? follow(session, id) : pause()));
  });

  return () => {
    stop();
    generation++;
  };
}
