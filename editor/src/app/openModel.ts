/**
 * The open model (docs/proposals/editor.md §3.4, §3.11): which wagon is open, its model
 * read in the model worker, shown in the 3D view with its type's frame for the guides,
 * handed to the preview, and the findings of its reading among the checks.
 *
 * - The wagon is the one the selection points at — its type's or its model's file, a field
 *   of them, one of its objects; while the selection points at nothing of a wagon the
 *   open one stays open (the view's and the checks' own clicks select other things); a pack
 *   with one wagon opens it at once. Another pack starts with none.
 * - Its model is read when it opens and again after every edit of the pack, a moment after
 *   the last of a run (typing into a form): the loader's cache (model/client
 *   `ModelLoader`) answers at once for a model none of whose files changed, so only an
 *   edit of the model's own files reads it again, and only then is it shown anew. An edit
 *   of the type only gives the view the new frame and the preview the new type.
 * - A model that can't be read comes empty with its finding (model/build); a worker that
 *   fails is one finding too.
 *
 * The rules are the modules': what a wagon is (core/pack `stock`), what a type is
 * (ports/wagonType), the guides' frame (view3d/frame). This only wires them.
 */

import { batch, effect, untracked } from '@preact/signals';
import type { Link, Problem, ViewApi } from '../core/contracts';
import type { Pack, StockEntry } from '../core/pack';
import { packFiles, type ModelFiles } from '../model/files';
import type { ModelRequest, ParsedModel } from '../model/types';
import { loadWagonType } from '../ports/wagonType';
import type { PreviewSubject } from '../preview/controller';
import { wagonFrame, type WagonFrame } from '../view3d/frame';
import { modelLoading, modelProblems, openModel, openWagon, pack, revision, selection } from './store';

/** How long after the last of a run of edits the open model is read again, ms (as long as the checks wait, checks/live.ts). */
export const RELOAD_DELAY_MS = 150;

/** What of the model loader (model/client `ModelLoader`) the shell uses. */
export interface ModelSource {
  load(files: ModelFiles, request: ModelRequest): Promise<ParsedModel>;
  textures(files: ModelFiles, paths: readonly string[]): Promise<Record<string, ImageBitmap | null>>;
  /** Forgets every model read (another pack). */
  clear(): void;
}

/** What the open model is wired to. */
export interface ModelWiring {
  loader: ModelSource;
  view: ViewApi;
  /** Gives the view the open wagon's frame for the guides (null: none). */
  setFrame(frame: WagonFrame | null): void;
  /** The preview (preview/store `preview`). */
  preview: { load(subject: PreviewSubject | null): void };
  /** How long after an edit the model is read again, ms. */
  delayMs?: number;
}

/** The wagon (`namespace:id`) the links point at: through its type's or model's file or a field of them, or one of its objects; null when they point at none. */
export function stockIdOf(links: readonly Link[], stock: readonly StockEntry[]): string | null {
  for (const link of links) {
    if (link.kind === 'file' || link.kind === 'field') {
      const entry = stock.find((candidate) => candidate.model === link.file || candidate.type === link.file);
      if (entry !== undefined) return entry.id;
    } else if (link.kind === 'object') {
      if (stock.some((candidate) => candidate.id === link.model)) return link.model;
    }
  }
  return null;
}

/**
 * The wagon to open: the one the links point at; else the one open now, while the pack
 * still has it; else the pack's only wagon with a model; else none.
 */
export function wagonToOpen(links: readonly Link[], stock: readonly StockEntry[], open: string | null): string | null {
  const pointed = stockIdOf(links, stock);
  if (pointed !== null) return pointed;
  if (open !== null && stock.some((entry) => entry.id === open)) return open;
  const models = stock.filter((entry) => entry.model !== null);
  return models.length === 1 ? models[0]!.id : null;
}

/** The finding of a model the worker failed to read (not the model's fault: the worker's). */
function failed(wagon: string, file: string, error: unknown): Problem {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    severity: 'error',
    source: 'model',
    code: 'model.failed',
    params: { model: wagon, error: detail },
    text: `model ${wagon} could not be read: ${detail}`,
    at: [{ kind: 'file', file }],
  };
}

/**
 * Follows the pack, the selection and the edits, opens the wagon they say and shows its
 * model, until the returned function is called.
 */
export function connectModel(wiring: ModelWiring): () => void {
  const { loader, view, preview } = wiring;
  const delay = wiring.delayMs ?? RELOAD_DELAY_MS;
  let lastPack: Pack | null = null;
  let lastWagon: string | null = null;
  let lastRevision = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Grows with every reading asked for: an answer for an older one is dropped. */
  let generation = 0;
  /** The model shown, and the type JSON it was shown with. */
  let shown: { model: ParsedModel; typeKey: string } | null = null;

  const closeModel = (): void => {
    if (shown !== null) {
      shown = null;
      view.show(null);
      wiring.setFrame(null);
      preview.load(null);
    }
    batch(() => {
      openModel.value = null;
      modelProblems.value = [];
      modelLoading.value = false;
    });
  };

  const show = (model: ParsedModel, entry: StockEntry, typeJson: unknown, typeKey: string, files: ModelFiles): void => {
    const type = entry.type === null ? null : loadWagonType(entry.id, typeJson).type;
    if (shown === null || shown.model !== model || shown.typeKey !== typeKey) {
      if (shown?.model !== model) view.show(model);
      wiring.setFrame(type === null ? null : wagonFrame(type));
      preview.load({ model, type, textures: (paths) => loader.textures(files, paths) });
      shown = { model, typeKey };
    }
    batch(() => {
      openModel.value = model;
      modelProblems.value = model.problems;
      modelLoading.value = false;
    });
  };

  const read = (open: Pack, wagon: string): void => {
    const entry = open.stock().find((candidate) => candidate.id === wagon);
    const gen = ++generation;
    if (entry === undefined || entry.model === null) {
      closeModel();
      return;
    }
    const request: ModelRequest = { id: wagon, file: entry.model, declaration: open.json(entry.model) };
    const typeJson = entry.type === null ? undefined : open.json(entry.type);
    const typeKey = JSON.stringify(typeJson) ?? '';
    const files = packFiles(open);
    modelLoading.value = true;
    loader.load(files, request).then(
      (model) => {
        if (gen === generation) show(model, entry, typeJson, typeKey, files);
      },
      (error: unknown) => {
        if (gen !== generation) return;
        closeModel();
        modelProblems.value = [failed(wagon, request.file, error)];
      },
    );
  };

  const follow = (open: Pack | null, links: readonly Link[], rev: number): void => {
    const samePack = open === lastPack;
    const wagon = open === null ? null : wagonToOpen(links, open.stock(), samePack ? lastWagon : null);
    if (openWagon.peek() !== wagon) openWagon.value = wagon;
    if (samePack && wagon === lastWagon && rev === lastRevision) return; // the selection moved within the wagon
    const edited = samePack && wagon === lastWagon;
    if (!samePack) {
      // nothing of the pack before stays: not its models, not the one shown
      loader.clear();
      generation++;
      closeModel();
    }
    lastPack = open;
    lastWagon = wagon;
    lastRevision = rev;
    clearTimeout(timer);
    timer = undefined;
    if (open === null || wagon === null) {
      generation++;
      closeModel();
    } else if (edited) {
      timer = setTimeout(() => read(open, wagon), delay);
    } else {
      read(open, wagon);
    }
  };

  const stop = effect(() => {
    const rev = revision.value;
    const open = pack.value;
    const links = selection.value;
    untracked(() => follow(open, links, rev));
  });

  return () => {
    stop();
    clearTimeout(timer);
    generation++;
  };
}
