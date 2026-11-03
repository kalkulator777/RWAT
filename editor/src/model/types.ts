/**
 * What the model worker is asked and what it answers (docs/proposals/editor.md §3.4, §3.11):
 * the types shared by the worker (../workers/model.worker.ts, ./api.ts), the pipeline
 * (./build.ts) and its client on the main thread (./client.ts).
 *
 * The answer is a {@link LoadedModel} of core/contracts, and more: {@link ParsedModel}
 * extends it, so whoever is written against the contract (view3d/) reads it as one, and
 * the preview and the objects tab find the rest — each part's texture and role, each
 * object's place, light and typed control, the materials with a texture, the model's
 * `skip` and the objects its `.anim`s move, what the engine makes of the model (controls with their
 * hinges, door leaves, animated doors and their `.anim` tracks, coupler heads, lamps,
 * headlights, bogies) and the liveries. Everything is in the OBJ frame but
 * {@link ParsedModel.engine}, which is the engine's own answer in the model frame.
 */

import type { LoadedModel, ObjectInfo, PartBuffers } from '../core/contracts';
import type { Light, ModelParts, Place } from '../ports/modelParts';
import type { Control } from '../ports/objectRole';

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

/** The triangles of one object × material pair, as {@link PartBuffers}, with what the view needs to draw them. */
export interface ModelPartBuffers extends PartBuffers {
  /** The pack path of the material's texture (a key of {@link LoadedModel.textures}); null for a material without one. */
  texture: string | null;
  /** The object's role in schema/obj-conventions.json for these faces (`body`, `control`, `untextured`, …). */
  role: string;
}

/** One object of the model, as {@link ObjectInfo}, with the engine's role of its parts. */
export interface ModelObject extends ObjectInfo {
  /**
   * The control (or door leaf) the object belongs to, typed: as the engine builds it — the
   * flags of all its objects merged, a widget the declaration names in `handbrake` turned
   * `HANDBRAKE` — or, when the engine built none for it (nothing of it drawn), as its name
   * reads (ports/objectRole `parseRole`, a group too long to travel dropped; `door` for a
   * leaf's object). Absent for an object of no control.
   */
  control?: Control;
  /** Where the engine draws it, or why not: the place of its first drawn part, else of its first part. */
  place: Place;
  /** Of the front bogie or end (a bogie frame, a wheelset, a coupler head). */
  front: boolean;
  /** What it belongs to, by name: a control's or leaf's key, an animated door's id, a wheelset's object; else null. */
  owner: string | null;
  /** Where that is in its list of {@link ParsedModel.engine}; −1 if it isn't in one. */
  index: number;
  /** How its faces are lit: the light group indexes {@link ModelParts.lightGroups}. */
  light: Light;
}

/** What the engine makes of a model, but each part's role (the objects carry those): model frame, floats. */
export type EngineParts = Omit<ModelParts, 'roles'>;

/** A model as the worker hands it over: a {@link LoadedModel} and more. */
export interface ParsedModel extends LoadedModel {
  parts: ModelPartBuffers[];
  objects: ModelObject[];
  /** The declaration's pack path (the request's). */
  file: string;
  /** The OBJ's pack path; null when the declaration names none that can be read. */
  obj: string | null;
  /** The engine's reading of the parts (./ports/modelParts.ts): null when the model can't be read. */
  engine: EngineParts | null;
  /**
   * Every material that has a texture → its texture's pack path: the `map_Kd` of the MTLs,
   * relative to the OBJ's folder, a path Minecraft takes (the file may be missing: it is
   * still a texture, the game draws its checker). A material not here draws nothing.
   */
  materials: Record<string, string>;
  /** The declaration's `skip`, as written: the name prefixes dropped besides `CARGO_FILL` (ports/modelParts `DEFAULT_SKIP_PREFIXES`). */
  skip: string[];
  /** Every object an `.anim` moves (a track with frames) → its door's id; an object two doors move goes with the later. */
  animated: Record<string, string>;
  /** Door id → object → the frames of its `.anim` track (16 floats each, row by row, OBJ frame), tracks with frames only. */
  animations: Record<string, Record<string, Float32Array[]>>;
  /** Livery id → base texture → the livery's own texture (pack paths); textures the livery doesn't carry stay base. */
  liveries: Record<string, Record<string, string>>;
}

/** The model worker's interface, as comlink exposes it (../workers/model.worker.ts). */
export interface ModelWorkerApi {
  /** Reads, parses and builds one model; its buffers and bitmaps are transferred, not copied. */
  load(request: ModelRequest, files: ModelReader): Promise<ParsedModel>;
  /** Decodes textures by pack path (a livery's, say); null for a missing or broken one. Bitmaps are transferred. */
  textures(paths: readonly string[], files: ModelReader): Promise<Record<string, ImageBitmap | null>>;
}
