/**
 * Types shared between the editor's modules (docs/proposals/editor.md §3.13).
 *
 * Agents of one stage write their modules against these types without waiting for
 * each other: I/O produces {@link PackSource}s and consumes {@link FileChange}s, the
 * pack model and journal speak in {@link Op}s and {@link Command}s, checks produce
 * {@link Problem}s, the model pipeline hands the view a {@link LoadedModel}, and the
 * view is driven through {@link ViewApi}. Only the conductor (or an agent it names)
 * changes this file; a module that needs more says so in its report.
 *
 * Types only: no code, no DOM, three or Preact imports, so core/ and ports/ can use
 * it in Node and in workers.
 */

// ---------------------------------------------------------------- files

/** One file of a pack as a source lists it: a path and its size, nothing read yet. */
export interface FileEntry {
  /** Path inside the pack, '/'-separated, no leading '/': `assets/ns/wagon_models/coach.json`. */
  path: string;
  /** Size in bytes. */
  size: number;
}

/** Where a pack is read from (io/). */
export type PackSourceKind = 'fs-access' | 'dir-input' | 'zip' | 'memory' | 'node';

/**
 * A pack's files, read lazily: `list()` builds the index without reading contents,
 * `read()` reads one file. A source does not know what the files mean.
 */
export interface PackSource {
  readonly kind: PackSourceKind;
  /** True when changes can be written back in place (a folder opened through File System Access). */
  readonly writable: boolean;
  /** What the user picked: the folder's or the zip's name. */
  readonly name: string;
  list(): Promise<FileEntry[]>;
  /** The file's bytes; rejects when there is no such file. */
  read(path: string): Promise<Uint8Array>;
}

/** One file to write or delete when saving. */
export type FileChange = { path: string; bytes: Uint8Array } | { path: string; delete: true };

/** Where a pack is saved to: a folder in place, a zip download, memory in tests. */
export interface PackSink {
  write(changes: FileChange[]): Promise<void>;
}

// ---------------------------------------------------------------- edits

/** RFC 6901 JSON Pointer into one file's JSON value: `''` is the whole value, `/doors/0/min`. */
export type JsonPointer = string;

/**
 * One change to the pack, as data. Every op has an inverse, which is how the journal
 * undoes it. `file` is a pack path as in {@link FileEntry.path}.
 */
export type Op =
  /** Set the value at `at`, creating the member when the parent object lacks it. */
  | { op: 'set'; file: string; at: JsonPointer; value: unknown }
  /** Remove the object member or array element at `at`. */
  | { op: 'remove'; file: string; at: JsonPointer }
  /** Insert into an array before the element `at` names (`/doors/2`), or at the end (`/doors/-`). */
  | { op: 'insert'; file: string; at: JsonPointer; value: unknown }
  /** Create the file or replace its bytes as a whole (assets, new declarations). */
  | { op: 'putFile'; file: string; bytes: Uint8Array }
  | { op: 'deleteFile'; file: string }
  | { op: 'renameFile'; file: string; to: string };

/** A signed set of ops applied at once: one entry in undo and redo. */
export interface Command {
  /** i18n key of what the command does, shown in the journal tab. */
  label: string;
  /** Values for the label's placeholders. */
  labelParams?: Record<string, string | number>;
  ops: Op[];
  /** Commands with the same key that follow each other merge into one (a drag until the mouse is released). */
  coalesceKey?: string;
}

// ---------------------------------------------------------------- links and problems

/**
 * What a selection or a problem points at. The selection is one `Link[]` signal that
 * the tree, the view, the objects tab, the checks tab and the inspector all read and write.
 */
export type Link =
  | { kind: 'file'; file: string }
  | { kind: 'field'; file: string; at: JsonPointer }
  /** An object of a model's OBJ, by the model's id and the object's name. */
  | { kind: 'object'; model: string; name: string }
  /** A floor zone, door or driver's seat of a wagon type, by the type's id and its index in the file. */
  | { kind: 'zone' | 'door' | 'seat'; type: string; index: number };

export type Severity = 'error' | 'warning' | 'info';

export type ProblemSource = 'schema' | 'loader' | 'floor' | 'model' | 'converter';

/**
 * A value a finding's text is built from: a number (may be `Infinity` or `NaN` where the
 * engine's line says so, as in `SEAT_NOT_SITTABLE`), a string (a door's id) or a list of
 * integers (zone indices, as `zones` of `ZONES_UNREACHABLE`).
 */
export type ProblemParam = string | number | number[];

/** One finding of the checks (§3.10). */
export interface Problem {
  severity: Severity;
  source: ProblemSource;
  /** Stable id the interface translates by: `floor.zone-too-narrow`, `schema.unknown-key`, … */
  code: string;
  /** The values the translated text is built from, by name. */
  params: Record<string, ProblemParam>;
  /** English, as the engine or the tool says it (golden-checked where ported). */
  text: string;
  /** Where the problem is; clicking the finding selects these. */
  at: Link[];
}

/** What a floor finding is about: the type's floor or cab as a whole, or one of its zones, doors or chairs. */
export type FloorSubject = 'floor' | 'zone' | 'door' | 'seat' | 'cab';

/**
 * One finding of the floor check as the engine makes it (`kinematics/FloorFinding.java`)
 * and its port returns it (ports/floorCheck, golden `floor_check`); checks/ turns it into
 * a {@link Problem} with source `floor` and a link to the zone, door or chair.
 */
export interface FloorFinding {
  /** Stable name of the kind of thing found, as in Java: `ZONE_TOO_NARROW`, `ZONES_UNREACHABLE`, … */
  code: string;
  subject: FloorSubject;
  /**
   * The zone, door or chair: its index in the type's `interior`, `doors` or `cab.seats`;
   * −1 for the floor or the cab as a whole and for zones in the plural (`ZONES_UNREACHABLE`
   * lists them in `params.zones`).
   */
  index: number;
  /** Name → value in the order the line uses them; places and sizes in the OBJ frame. */
  params: Record<string, ProblemParam>;
  /** The engine's line, word for word as the type registry logs it and `/rwat packs` shows it. */
  text: string;
}

// ---------------------------------------------------------------- model pipeline → view

/** A point or direction in the OBJ frame: Y up, X along the track, front −X, +Z the left side. */
export type Vec3 = [number, number, number];

/** The triangles of one object × material pair, ready for the GPU. */
export interface PartBuffers {
  object: string;
  material: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
}

/** One object of a model as the objects tab lists it. */
export interface ObjectInfo {
  name: string;
  /** Role id from schema/obj-conventions.json. */
  role: string;
  /** The organ the object belongs to, as ports/objectRole parses it. */
  control?: unknown;
  lightGroup?: string;
  /** Bounding box in the OBJ frame: [min, max]. */
  bbox: [Vec3, Vec3];
}

/** A parsed model as the model worker hands it over (buffers transferred, not copied). */
export interface LoadedModel {
  id: string;
  parts: PartBuffers[];
  objects: ObjectInfo[];
  /** Decoded textures by pack path; null when the file is missing or broken. */
  textures: Record<string, ImageBitmap | null>;
  problems: Problem[];
}

/** A shape the view draws over the model, in the OBJ frame. `style` names an overlay style of view3d. */
export type OverlayShape =
  | { shape: 'box'; min: Vec3; max: Vec3; style: string; link?: Link }
  /** Flat rectangle at y = min[1]. */
  | { shape: 'rect'; min: Vec3; max: Vec3; style: string; link?: Link }
  | { shape: 'arrow'; from: Vec3; to: Vec3; style: string; link?: Link }
  /** Arc around `axis` through `centre`, starting at `from`, sweeping `degrees` (right-hand rule). */
  | { shape: 'arc'; centre: Vec3; axis: Vec3; from: Vec3; degrees: number; style: string; link?: Link }
  /** Horizontal circle. */
  | { shape: 'circle'; centre: Vec3; radius: number; style: string; link?: Link };

/** What the 3D view hit under the pointer. */
export interface PickHit {
  object?: string;
  point?: Vec3;
}

/**
 * The 3D view as the other modules drive it (§3.8). It draws and picks; it knows
 * nothing about doors, organs or pack JSON: preview and tools tell it what to move,
 * hide, light and overlay.
 */
export interface ViewApi {
  show(model: LoadedModel | null): void;
  setDisplay(mode: 'roles' | 'textured' | 'lit'): void;
  /** Column-major 4×4 matrix in the OBJ frame (three.js `Matrix4.elements` order); null = rest pose. */
  setTransform(object: string, matrix4: Float32Array | null): void;
  setVisible(object: string, visible: boolean): void;
  setLit(object: string, lit: boolean): void;
  /** Replaces everything drawn in the layer; an empty list clears it. */
  overlay(layer: string, shapes: OverlayShape[]): void;
  /** Returns the function that removes the listener. */
  onPick(listener: (hit: PickHit) => void): () => void;
}
