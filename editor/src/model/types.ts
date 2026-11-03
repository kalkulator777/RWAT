/**
 * What the model worker is asked and how it reads the pack (docs/proposals/editor.md §3.4,
 * §3.11): the types shared by the worker (../workers/model.worker.ts, ./api.ts), the
 * pipeline (./build.ts) and its client on the main thread (./client.ts).
 *
 * The answer is a {@link LoadedModel} of core/contracts, as the view, the objects tab and
 * the preview read it: no type of its own here.
 */

import type { LoadedModel } from '../core/contracts';

/** What to load: one wagon model of the open pack. */
export interface ModelRequest {
  /** The model's id, `<namespace>:<name>`: its namespace is the one of unqualified paths in the declaration. */
  id: string;
  /** The declaration's pack path: `assets/<namespace>/wagon_models/<name>.json`. */
  file: string;
  /** The declaration's JSON value as it stands now (it may be edited and not saved). */
  declaration: unknown;
}

/**
 * How the worker reads the pack: the main thread holds the pack and answers (through a
 * comlink proxy). Paths are pack paths (`assets/<ns>/…`).
 */
export interface ModelReader {
  /** The file's bytes, or null when the pack has no such file. */
  read(path: string): Promise<Uint8Array | null>;
  /** True when the pack has the file (read nothing). */
  has(path: string): Promise<boolean>;
}

/** Turns a texture's bytes into a bitmap ready for the GPU; null for bytes that are no image. */
export type TextureDecoder = (bytes: Uint8Array, path: string) => Promise<ImageBitmap | null>;

/** The model worker's interface, as comlink exposes it (../workers/model.worker.ts). */
export interface ModelWorkerApi {
  /** Reads, parses and builds one model; its buffers and bitmaps are transferred, not copied. */
  load(request: ModelRequest, files: ModelReader): Promise<LoadedModel>;
  /** Decodes textures by pack path (a livery's, say); null for a missing or broken one. Bitmaps are transferred. */
  textures(paths: readonly string[], files: ModelReader): Promise<Record<string, ImageBitmap | null>>;
}
