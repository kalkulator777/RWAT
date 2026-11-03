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
 * it in Node and in workers. The model's types come from the ports that make them
 * (ports/modelParts, ports/objectRole, ports/wagonType), imported as types.
 */

import type { ModelParts, Role } from '../ports/modelParts';
import type { Control } from '../ports/objectRole';
import type { Hull } from '../ports/wagonType';

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

/** What the journal edits (the pack model implements it): the journal knows nothing else of the pack. */
export interface OpTarget {
  /**
   * Applies one op and returns the ops that undo it, in the order they are to be
   * applied. Throws, having changed nothing, when the op cannot be applied.
   */
  apply(op: Op): Op[];
  /** Readies what the ops need (reads the files whose bytes their inverse holds) before they are applied; the journal's `run` calls it. */
  prepare?(ops: readonly Op[]): Promise<void>;
}

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

/** The triangles of one object × material pair, ready for the GPU, with what the view needs to draw them. */
export interface PartBuffers {
  object: string;
  material: string;
  /** Three corners a triangle, `x, y, z` each, in the OBJ frame. */
  positions: Float32Array;
  normals: Float32Array;
  /** `u, v` a corner as the OBJ has them (V up): the view samples bitmaps decoded upside down (`imageOrientation: 'flipY'`). */
  uvs: Float32Array;
  /** The pack path of the material's texture (a key of {@link LoadedModel.textures}); null for a material without one. */
  texture: string | null;
  /** The role in schema/obj-conventions.json of these faces (`body`, `control`, `untextured`, …): the role of the pair's first run of faces. */
  role: string;
  /** False when the engine does not draw these faces (`HIDE`, the declaration's `skip`, no texture): the view shows them as a ghost. */
  drawn: boolean;
}

/** One object of a model as the objects tab lists it and the preview moves it. */
export interface ObjectInfo {
  name: string;
  /** Role id from schema/obj-conventions.json: of the object's first drawn part, else of its first part. */
  role: string;
  /**
   * The engine's role of that same part (ports/modelParts `Role`): where it is drawn or why
   * not, its end, what it belongs to and where that is in its list of {@link LoadedModel.engine},
   * how it is lit (the light group indexes `engine.lightGroups`).
   */
  engine: Role;
  /**
   * The control (or door leaf) the object belongs to: as the engine builds it — the flags of
   * all its objects merged, a widget the declaration names in `handbrake` turned `HANDBRAKE`
   * — or, when the engine built none for it (nothing of it drawn), as its name reads
   * (ports/objectRole, a group too long to travel dropped; `door` for a leaf's object).
   * Absent for an object of no control.
   */
  control?: Control;
  /** The light group's name, when the object is in one. */
  lightGroup?: string;
  /** Bounding box in the OBJ frame: [min, max]. */
  bbox: [Vec3, Vec3];
}

/** What the engine makes of a model but each part's role (its objects carry those): model frame, floats (ports/modelParts). */
export type EngineParts = Omit<ModelParts, 'roles'>;

/**
 * A wagon model as the model worker hands it over (buffers and bitmaps transferred, not
 * copied): geometry, roles and textures for the view; objects for the objects tab; what
 * moves and lights for the preview. Everything is in the OBJ frame but {@link engine},
 * which is the engine's own answer in the model frame. A model that can't be read comes
 * empty, with its finding in {@link problems}.
 */
export interface LoadedModel {
  /** The model's id `<namespace>:<name>`: the `model` of an object's {@link Link}. */
  id: string;
  /** The declaration's pack path: `assets/<namespace>/wagon_models/<name>.json`. */
  file: string;
  /** The OBJ's pack path; null when the declaration names none that can be read. */
  obj: string | null;
  parts: PartBuffers[];
  /** Each object once, in the order it first comes in the OBJ. */
  objects: ObjectInfo[];
  /** Decoded textures by pack path, the ones the parts use; null when the file is missing or broken. */
  textures: Record<string, ImageBitmap | null>;
  /**
   * Every material that has a texture → its texture's pack path: the `map_Kd` of the MTLs,
   * relative to the OBJ's folder, a path Minecraft takes (the file may be missing: it is
   * still a texture, the game draws its checker). A material not here draws nothing.
   */
  materials: Record<string, string>;
  /** The declaration's `skip`, as written: the name prefixes dropped besides `CARGO_FILL`. */
  skip: string[];
  /** Every object an `.anim` moves (a track with frames) → its door's id; an object two doors move goes with the later. */
  animated: Record<string, string>;
  /** Door id → object → the frames of its `.anim` track (16 floats each, row by row, OBJ frame), tracks with frames only. */
  animations: Record<string, Record<string, Float32Array[]>>;
  /** The engine's reading of the parts: null when the model can't be read. */
  engine: EngineParts | null;
  /** Livery id → base texture → the livery's own texture (pack paths); textures the livery doesn't carry stay base. */
  liveries: Record<string, Record<string, string>>;
  problems: Problem[];
}

/** What a wagon type's guides need, as plain data in the model frame (+Z forward): the view reads no pack JSON. */
export interface WagonFrame {
  /** Over buffers or couplers, blocks. */
  readonly length: number;
  /** Bogie pivots from the body's centre, + forward, front first (`WagonType.bogieOffsets`). */
  readonly bogies: readonly number[];
  /** From the body's centre to the front and the rear coupler point (`WagonType.couplerReach`). */
  readonly couplerReach: readonly [number, number];
  /** The solid collision hull (`WagonType.collidableHull`). */
  readonly hull: Hull;
}

/** How the view paints the model: flat role colours, the textures as in the game, or the textures at night with the lit objects glowing. */
export type DisplayMode = 'roles' | 'textured' | 'lit';

/** A shape the view draws over the model, in the OBJ frame. `style` names an overlay style of view3d. */
export type OverlayShape =
  | { shape: 'box'; min: Vec3; max: Vec3; style: string; link?: Link }
  /** Flat rectangle at y = min[1]. */
  | { shape: 'rect'; min: Vec3; max: Vec3; style: string; link?: Link }
  /** A closed outline through the points in order, filled where its style fills: a flat polygon (a floor piece) of three points or more. */
  | { shape: 'polygon'; points: Vec3[]; style: string; link?: Link }
  | { shape: 'arrow'; from: Vec3; to: Vec3; style: string; link?: Link }
  /** Arc around `axis` through `centre`, starting at `from`, sweeping `degrees` (right-hand rule). */
  | { shape: 'arc'; centre: Vec3; axis: Vec3; from: Vec3; degrees: number; style: string; link?: Link }
  /** Horizontal circle. */
  | { shape: 'circle'; centre: Vec3; radius: number; style: string; link?: Link }
  /** A marked point: a dot of one size on the screen however far it is (a snap, a seat's foot, a vertex). */
  | { shape: 'point'; at: Vec3; style: string; link?: Link };

/** What a click in the 3D view hit, and how it was clicked. */
export interface PickHit {
  /** The object drawn nearest under the pointer. */
  object?: string;
  /** Where the ray met it, OBJ frame. */
  point?: Vec3;
  /** Where no object is: the link of the nearest overlay shape that carries one. */
  link?: Link;
  shift: boolean;
  /** Ctrl, or ⌘ on a Mac. */
  ctrl: boolean;
  alt: boolean;
  /** A double click: this pick comes after those of its two clicks. */
  double: boolean;
}

/** What the camera shows: the free orbit or one of the fixed orthographic views — from the top, the side (+Z), the front (−X). */
export type CameraView = 'orbit' | 'top' | 'side' | 'front';

/** Where the pointer is, as a tool that takes the view's presses reads it ({@link ViewDragger}). */
export interface ViewPointer {
  /** The ray from the eye through the pointer, OBJ frame. */
  readonly origin: Vec3;
  /** The ray's direction, of length 1. */
  readonly direction: Vec3;
  /** How many blocks one CSS pixel spans at the camera's target: a tolerance in pixels made one in blocks. */
  readonly pixel: number;
  /** The camera's view: a tool may take the presses of some views only (the floor's, from the top). */
  readonly view: CameraView;
  readonly shift: boolean;
  /** Ctrl, or ⌘ on a Mac. */
  readonly ctrl: boolean;
  readonly alt: boolean;
}

/**
 * A tool that takes presses of the left button in the view instead of the camera: the
 * markup tools draw, move and stretch their shapes by dragging (docs/proposals/editor.md
 * §3.9). The view asks it at every press of the left button; a press it takes moves no
 * camera and, unless {@link click} gives it back, picks nothing. One at a time
 * ({@link ViewApi.setDragger}).
 */
export interface ViewDragger {
  /** The left button went down: true takes the press — its drag, and its click unless {@link click} gives it back. */
  press(at: ViewPointer): boolean;
  /** The pointer moved, the button held, once it is past the click's slop. */
  drag(at: ViewPointer): void;
  /** The button went up after a drag. */
  release(at: ViewPointer): void;
  /** The button went up where it went down: true if the tool took the click, false for the view's own (pick and select). */
  click(at: ViewPointer): boolean;
  /** The press ended without a release (the pointer was cancelled or lost). */
  cancel(): void;
  /** The pointer moves with no button held (null: it left the view): the CSS cursor to show, null for the view's own. */
  hover?(at: ViewPointer | null): string | null;
}

/**
 * The 3D view as the other modules drive it (§3.8). It draws and picks; it knows
 * nothing about doors, organs or pack JSON: the model pipeline shows a model, the preview
 * and tools tell it what to move, hide, light, paint and overlay, and a markup tool
 * turns its camera to the view it works in and takes the left button's presses.
 */
export interface ViewApi {
  /** Shows a model afresh (null: none): every object at rest, shown, unlit, in the model's own textures; the camera frames it. */
  show(model: LoadedModel | null): void;
  setDisplay(mode: DisplayMode): void;
  /** Lays a wireframe over the display, or takes it off. */
  setWireframe(on: boolean): void;
  /** The wagon type the model is paired with, for the guides (hull, bogie pivots, ends, couplers); null for none. */
  setFrame(frame: WagonFrame | null): void;
  /** Column-major 4×4 matrix in the OBJ frame (three.js `Matrix4.elements` order); null = rest pose. */
  setTransform(object: string, matrix4: Float32Array | null): void;
  setVisible(object: string, visible: boolean): void;
  setLit(object: string, lit: boolean): void;
  /**
   * The picture the parts of texture `path` are drawn with from now on, until the next
   * `show`: a bitmap upside down as the model's are (a livery's), or null for none (drawn
   * as missing). The model's own is `model.textures[path]`. The camera, the selection and
   * whatever the preview set stay as they are.
   */
  setTexture(path: string, bitmap: ImageBitmap | null): void;
  /** Replaces everything drawn in the layer; an empty list clears it. */
  overlay(layer: string, shapes: OverlayShape[]): void;
  /** Called with every click in the view; returns the function that removes the listener. */
  onPick(listener: (hit: PickHit) => void): () => void;
  /** Switches the camera to a view, or lines it up afresh if it is that view already (a markup tool works from the top). */
  setCamera(camera: CameraView): void;
  /** Gives the presses of the left button to a tool, or back to the camera (null). One tool at a time: the last set wins. */
  setDragger(dragger: ViewDragger | null): void;
}
