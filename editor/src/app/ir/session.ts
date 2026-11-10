/**
 * An IR session (editor.md §1.3, §2.6, §2.7; M6 A6.3): a conversion recipe and its
 * per-type overrides (ir/recipe `RecipeWorkspace`, the journal's target) over the IR zips
 * its `sources` name, and what the converter derives from them (ir/bridge `derive`), so
 * each type is seen as the pack gets it — its derived layer with the override on top
 * (ir/recipe `typeLayers`, the converter's merge ported) — and edited by the override's
 * rules without a round trip through Python. What only Python can say comes from the
 * bridge on demand: a type's generated floor for its current options (`floorFor`, about a
 * second or two a type), the zip entries its model is made of (`modelFiles`), the whole
 * conversion (`convert`).
 *
 * - **Its own worker.** The session keeps the recipe it derived in a bridge of its own
 *   (ir/bridge: a `PythonBridge` is one worker, and its `cancel` stops every call of it):
 *   a suggested floor cancelled in a pack's tools (the page's bridge) leaves the session
 *   alone. A full conversion runs in yet another, stopped when it ends, so a cancelled
 *   conversion leaves the session's derived recipe where it was. The bridge's client is
 *   imported with the first session (`import()`), never with the page's first script.
 * - **The floor** is generated once for a type that needs it (a passenger car, or a type
 *   whose override has `floor`) when the type is first looked at, and again only when the
 *   author asks ("Перегенерировать пол", {@link IrSession.regenerateFloor}): an edit of the
 *   floor's options or of the doors marks it stale. The zones it gave before are kept for
 *   the view to draw the difference.
 * - **Saving** writes the recipe's changed files: into the folder it was opened from
 *   (File System Access), or as a zip of the markup (ir/recipe `exportRecipe`: the recipe
 *   and its per-type files, no asset — R10). A recipe made in the editor is new until saved.
 *
 * What the session says of itself (findings: the schemas', the converter's, the floor
 * check's on what the pack gets) is {@link IrSession.problems}; the signals of the page's
 * session and the actions on it are ./state.ts and ./actions.ts.
 */

import { signal } from '@preact/signals';
import { typeFloorProblems } from '../../checks/floor/problems';
import type { Command, Link, Problem } from '../../core/contracts';
import { Journal } from '../../core/journal';
import { isJsonObject } from '../../core/json';
import { homeOf } from '../../core/session';
import type { Schema } from '../../core/schema';
import { FsAccessSource, type PackSource } from '../../io';
import type { ConvertResult, DeriveResult, GeneratedFloor, LoadProgress, ModelFile, PythonBridge } from '../../ir/bridge';
import {
  checkRecipe,
  effectiveOverride,
  exportRecipe,
  floorRuns,
  MergeError,
  RecipeError,
  RecipeWorkspace,
  typeLayers,
  type Derived,
  type JsonObject,
  type RecipeExport,
  type TypeLayers,
} from '../../ir/recipe';
import { baseName, checkZips, IrInputError, matchSources, type NamedBlob } from './sources';

/** What the session uses of a bridge to Python (ir/bridge `PythonBridge`). */
export type IrBridge = Pick<PythonBridge, 'start' | 'derive' | 'floorFor' | 'modelFiles' | 'closeDerived' | 'convert' | 'cancel' | 'progress' | 'onProgress' | 'memory'>;

/** Makes a bridge of its own — a Pyodide worker of its own — for a session or a conversion. */
export type BridgeMaker = () => Promise<IrBridge>;

/** The page's way: the bridge's client imported when first needed, a new worker each. */
const pageMaker: BridgeMaker = async () => new (await import('../../ir/bridge')).PythonBridge();

let maker: BridgeMaker = pageMaker;

/** Makes the sessions take their bridges from `make` (a test's: Pyodide in Node); null gives the page's back. */
export function useBridgeMaker(make: BridgeMaker | null): void {
  maker = make ?? pageMaker;
}

/** A bridge of its own (see {@link useBridgeMaker}). */
export function makeBridge(): Promise<IrBridge> {
  return maker();
}

/** How a failed call of the bridge reads for an author: the converter's own words (never the traceback), or that it was cancelled. */
export function failureText(error: unknown): { cancelled: boolean; text: string } {
  if (typeof error === 'object' && error !== null) {
    const failure = error as { kind?: unknown; text?: unknown; message?: unknown };
    if (failure.kind === 'cancelled') return { cancelled: true, text: '' };
    if (typeof failure.text === 'string' && failure.text !== '') return { cancelled: false, text: failure.text };
    if (typeof failure.message === 'string') return { cancelled: false, text: failure.message };
  }
  return { cancelled: false, text: String(error) };
}

/** What to open: where the recipe is, its path there, the zips the author picked; `fresh` for a recipe made in the editor (never saved). */
export interface OpenRequest {
  source: PackSource;
  recipePath: string;
  zips: readonly NamedBlob[];
  fresh?: boolean;
}

/** A type's floor as the generator last gave it, for the override's options then. */
export interface FloorEntry {
  /** What it was generated for: the override's `floor` and `type.doors`, as JSON. */
  readonly key: string;
  readonly status: 'running' | 'ready' | 'failed';
  /** The generator's answer; null while running or after a failure. */
  readonly floor: GeneratedFloor | null;
  /** The zones of the floor before this one (the view draws them dashed); null for none. */
  readonly previous: unknown;
  /** Why the call failed, in the converter's words; null when it did not. */
  readonly error: string | null;
  /** How long it took, ms. */
  readonly ms: number;
}

/** The keys of a recipe that change nothing of what `derive` says (its names and the overrides: the session merges those itself). */
const NOT_DERIVED = new Set(['overrides', 'overrides_dir', 'name', 'description', 'license', 'version', 'authors', 'out']);

/** The part of a recipe `derive` reads, as JSON: a change to it makes the derived layer stale. */
function deriveKey(recipe: JsonObject): string {
  return JSON.stringify(Object.fromEntries(Object.entries(recipe).filter(([key]) => !key.startsWith('_') && !NOT_DERIVED.has(key))));
}

/** A sink that writes nothing (a zip save hands the zip over itself). */
const NOWHERE = { write: () => Promise.resolve() };

/** A memo of one type's layers: valid while the layers' inputs are the same objects. */
interface LayersMemo {
  inputs: readonly unknown[];
  layers: TypeLayers | null;
  error: string | null;
}

let serial = 0;

export class IrSession {
  /** Grows with every change of the session: an edit, undo or redo, a save, a floor, a derive. */
  readonly revision = signal(0);
  /** A number of its own (the model files' stamp: another session's are other files). */
  readonly serial = ++serial;
  /** What the converter derives for every type (`derive`); null before it ran or when it refused. */
  derived: DeriveResult | null = null;
  /** Why `derive` refused, in the converter's words; null when it did not. */
  deriveError: string | null = null;
  private derivedWith: string | null = null;
  private readonly floors = new Map<string, FloorEntry>();
  private readonly floorCalls = new Map<string, number>();
  private readonly files = new Map<string, Promise<ModelFile[]>>();
  private readonly memo = new Map<string, LayersMemo>();
  private readonly unsubscribe: () => void;
  private closed = false;

  private constructor(
    readonly workspace: RecipeWorkspace,
    readonly journal: Journal,
    /** Where the recipe was opened from: a folder it is saved back into, or not. */
    readonly where: PackSource,
    /** The picked zips by the path the recipe's `sources[].zip` gives. */
    readonly sources: ReadonlyMap<string, NamedBlob>,
    /** Picked zips the recipe names nowhere (not used). */
    readonly unused: readonly string[],
    private readonly bridge: IrBridge,
  ) {
    this.unsubscribe = journal.subscribe(() => this.bump());
  }

  /**
   * Opens the recipe's files and matches the zips to its sources; nothing is derived yet
   * ({@link derive}). Rejects with {@link IrInputError}: no recipe there, a recipe that is
   * no JSON, a source the picks lack, a pick that is no zip.
   */
  static async open(request: OpenRequest, bridge: IrBridge): Promise<IrSession> {
    let workspace: RecipeWorkspace;
    try {
      workspace = await RecipeWorkspace.open(request.source, request.recipePath);
    } catch (error) {
      if (error instanceof RecipeError) throw new IrInputError('ir.error.no-recipe', { file: request.recipePath });
      throw error;
    }
    const broken = workspace.problems().find((problem) => problem.code === 'pack.broken-json' && problem.at.some((link) => 'file' in link && link.file === request.recipePath));
    if (broken !== undefined) throw new IrInputError('ir.error.recipe-json', { file: baseName(request.recipePath), detail: broken.text });
    if (request.fresh === true) await workspace.markUnsaved();
    const match = matchSources(workspace.recipe(), request.zips);
    if (match.missing.length > 0) throw new IrInputError('ir.error.missing-zips', { files: match.missing.map(baseName).join(', '), count: match.missing.length });
    await checkZips([...match.sources.values()]);
    return new IrSession(workspace, new Journal(workspace), request.source, match.sources, match.unused, bridge);
  }

  private bump(): void {
    this.revision.value++;
  }

  // ------------------------------------------------------------ the recipe

  get recipePath(): string {
    return this.workspace.recipePath;
  }

  /** The recipe's file name (`mvp.json`). */
  get recipeName(): string {
    return baseName(this.workspace.recipePath);
  }

  /** The recipe's namespace (the lang keys, the model's id). */
  get namespace(): string {
    const value = this.workspace.recipe().namespace;
    return typeof value === 'string' ? value : '';
  }

  /** The zips as the bridge takes them: by `sources[].zip`. */
  private zipBlobs(): Record<string, Blob> {
    return Object.fromEntries([...this.sources].map(([zip, pick]) => [zip, pick.blob]));
  }

  /** The zip of source `index` (the recipe's `sources[index]`), or undefined. */
  sourceZip(index: number): Blob | undefined {
    const sources = this.workspace.recipe().sources;
    const spec: unknown = Array.isArray(sources) ? sources[index] : undefined;
    return isJsonObject(spec) && typeof spec.zip === 'string' ? this.sources.get(spec.zip)?.blob : undefined;
  }

  /**
   * Asks the converter what it derives for every type of the recipe (once on import, and
   * again when the recipe's own keys changed: {@link recipeStale}). A refusal is kept in
   * {@link deriveError}, in the converter's words; a cancel rejects (and the session's
   * worker is stopped: derive it again).
   */
  async derive(options: { onLog?: (line: string) => void; signal?: AbortSignal } = {}): Promise<void> {
    const recipe = this.workspace.recipe();
    try {
      const derived = await this.bridge.derive({ recipe, recipeName: this.recipeName, sources: this.zipBlobs() }, options);
      this.derived = derived;
      this.deriveError = null;
    } catch (error) {
      const said = failureText(error);
      if (said.cancelled) throw error;
      this.derived = null;
      this.deriveError = said.text;
    }
    this.derivedWith = deriveKey(recipe);
    this.floors.clear();
    this.files.clear();
    this.memo.clear();
    this.bump();
  }

  /** True when the recipe's keys `derive` reads changed since it ran: the derived layer may be out of date. */
  get recipeStale(): boolean {
    return this.derivedWith !== null && this.derivedWith !== deriveKey(this.workspace.recipe());
  }

  /** The ids of the types the converter converts, in its order. */
  typeIds(): string[] {
    return this.derived === null ? [] : Object.keys(this.derived.derived);
  }

  /** What the converter derives for a type; undefined for none. */
  derivedOf(id: string): Derived | undefined {
    return this.derived?.derived[id];
  }

  /** True when the recipe gives the type an override: a per-type file, or an entry of its own `overrides`. */
  hasOverride(id: string): boolean {
    return this.workspace.override(id) !== undefined || this.workspace.inline(id) !== undefined;
  }

  /** The type id a link points at: through its per-type file, or a zone, door, chair or object of it; null for none. */
  typeOf(link: Link): string | null {
    const ids = this.typeIds();
    if (link.kind === 'file' || link.kind === 'field') {
      const stem = baseName(link.file).replace(/\.json$/, '');
      return ids.includes(stem) && this.workspace.overridePath(stem) === link.file ? stem : null;
    }
    const wagon = link.kind === 'object' ? link.model : link.type;
    const prefix = `${this.namespace}:`;
    return wagon.startsWith(prefix) && ids.includes(wagon.slice(prefix.length)) ? wagon.slice(prefix.length) : null;
  }

  /** The override the converter reads for a type: the recipe's own entry under the per-type file, comments dropped. */
  effective(id: string): JsonObject {
    return effectiveOverride(this.workspace.inline(id), this.workspace.override(id));
  }

  /**
   * The type's layers — derived, the override, what the pack gets — with its generated
   * floor where it has one; null for a type not derived, or one the converter would skip
   * for its override ({@link mergeError}). Kept while its inputs are the same values.
   */
  layers(id: string): TypeLayers | null {
    return this.memoOf(id)?.layers ?? null;
  }

  /** Why the converter would skip the type for its override (`MergeError`), or null. */
  mergeError(id: string): string | null {
    return this.memoOf(id)?.error ?? null;
  }

  private memoOf(id: string): LayersMemo | null {
    const derived = this.derivedOf(id);
    if (derived === undefined) return null;
    const floor = this.floors.get(id);
    const zones = floor?.status === 'ready' ? (floor.floor?.interior ?? null) : null;
    const inputs = [derived, this.workspace.override(id), this.workspace.inline(id), this.workspace.recipe().namespace, zones];
    const known = this.memo.get(id);
    if (known !== undefined && known.inputs.every((input, i) => input === inputs[i])) return known;
    let entry: LayersMemo;
    try {
      entry = { inputs, layers: typeLayers(this.workspace, id, derived, zones), error: null };
    } catch (error) {
      if (!(error instanceof MergeError)) throw error;
      entry = { inputs, layers: null, error: error.message };
    }
    this.memo.set(id, entry);
    return entry;
  }

  // ------------------------------------------------------------ edits

  /** Runs a command of the recipe through the session's journal (undo, redo); a refused one rejects as the recipe model says why. */
  run(command: Command): Promise<void> {
    return this.journal.run(command);
  }

  // ------------------------------------------------------------ the floor

  /** True when the converter runs the floor generator for the type (a passenger car, a `floor` given; not `floor: false`). */
  floorNeeded(id: string): boolean {
    const derived = this.derivedOf(id);
    return derived !== undefined && floorRuns(derived.category, this.effective(id));
  }

  /** What the generated floor depends on in the override: its `floor` and the doors it gives. */
  floorKey(id: string): string {
    const effective = this.effective(id);
    const type = effective.type;
    return JSON.stringify({ floor: effective.floor ?? null, doors: isJsonObject(type) ? (type.doors ?? null) : null });
  }

  /** The type's floor as last generated; undefined before the first. */
  floor(id: string): FloorEntry | undefined {
    return this.floors.get(id);
  }

  /** True when the floor was generated for other options or doors than the override has now: "Перегенерировать пол". */
  floorStale(id: string): boolean {
    const entry = this.floors.get(id);
    return entry !== undefined && entry.status !== 'running' && entry.key !== this.floorKey(id);
  }

  /** Generates the type's floor for the override as it stands (the converter's `plan`); the zones before stay as {@link FloorEntry.previous}. */
  async regenerateFloor(id: string): Promise<void> {
    if (this.closed || this.derivedOf(id) === undefined) return;
    const call = (this.floorCalls.get(id) ?? 0) + 1;
    this.floorCalls.set(id, call);
    const key = this.floorKey(id);
    const before = this.floors.get(id);
    const previous = before?.floor?.interior ?? before?.previous ?? null;
    this.floors.set(id, { key, status: 'running', floor: before?.floor ?? null, previous, error: null, ms: 0 });
    this.bump();
    const started = performance.now();
    let entry: FloorEntry;
    try {
      const floor = await this.bridge.floorFor(id, this.effective(id));
      entry = { key, status: 'ready', floor, previous, error: null, ms: performance.now() - started };
    } catch (error) {
      entry = { key, status: 'failed', floor: null, previous, error: failureText(error).text, ms: performance.now() - started };
    }
    if (this.closed || this.floorCalls.get(id) !== call) return; // a later call's answer counts
    this.floors.set(id, entry);
    this.bump();
  }

  /** Generates the type's floor if it needs one and has none yet (the first look at it). */
  ensureFloor(id: string): void {
    if (this.floorNeeded(id) && !this.floors.has(id)) void this.regenerateFloor(id);
  }

  // ------------------------------------------------------------ the model

  /** The files of the type's model as the conversion copies them, and the zip entries they are (asked once a type). */
  modelFiles(id: string): Promise<ModelFile[]> {
    let files = this.files.get(id);
    if (files === undefined) {
      files = this.bridge.modelFiles(id);
      this.files.set(id, files);
      files.catch(() => {
        if (this.files.get(id) === files) this.files.delete(id);
      });
    }
    return files;
  }

  // ------------------------------------------------------------ findings

  /** The link to a type: its per-type file (written or not yet). */
  typeLink(id: string): Extract<Link, { kind: 'file' }> {
    return { kind: 'file', file: this.workspace.overridePath(id) };
  }

  /**
   * Everything the session finds: the recipe's and the per-type files' schemas and their
   * per-type files for no type (ir/recipe `checkRecipe`), the converter's warnings and
   * errors as `derive` said them, the merge's warnings of each override, a floor the
   * generator refused, and the floor check (ports/floorCheck) on each type as the pack gets
   * it, where its floor is known. Each finding about a type points at it.
   */
  problems(schema: Schema | null): Problem[] {
    const problems: Problem[] = [];
    const recipeLink: Link = { kind: 'file', file: this.recipePath };
    const ids = this.typeIds();
    if (schema !== null) problems.push(...checkRecipe(schema, this.workspace, this.derived === null ? {} : { typeIds: ids }));
    else problems.push(...this.workspace.problems());
    const converter = (severity: Problem['severity'], code: string, text: string, at: Link[]): Problem => ({ severity, source: 'converter', code, params: { text }, text, at });
    const about = (text: string): Link[] => {
      const id = ids.find((candidate) => text.startsWith(`${candidate}:`));
      return id === undefined ? [recipeLink] : [this.typeLink(id)];
    };
    if (this.deriveError !== null) problems.push(converter('error', 'converter.refusal', this.deriveError, [recipeLink]));
    if (this.derived !== null) {
      for (const text of this.derived.errors) problems.push(converter('error', 'converter.error', text, about(text)));
      for (const text of this.derived.warnings) problems.push(converter('warning', 'converter.warning', text, about(text)));
      for (const [id, text] of Object.entries(this.derived.failed)) problems.push(converter('error', 'converter.error', `${id}: ${text}`, [this.typeLink(id)]));
    }
    const namespace = this.namespace;
    for (const id of ids) {
      const link = this.typeLink(id);
      const error = this.mergeError(id);
      if (error !== null) problems.push(converter('error', 'converter.error', `${id}: skipped — ${error}`, [link]));
      const layers = this.layers(id);
      if (layers === null) continue;
      for (const text of layers.result.warnings) problems.push(converter('warning', 'converter.warning', text, [link]));
      const floor = this.floors.get(id);
      if (floor?.status === 'ready' && floor.floor?.problem != null && this.floorNeeded(id)) {
        problems.push(converter('error', 'converter.error', `${id}: no generated floor — ${floor.floor.problem}`, [link, { kind: 'field', file: link.file, at: '/floor' }]));
      }
      if (floor?.status === 'failed') problems.push(converter('error', 'converter.error', `${id}: no generated floor — ${floor.error ?? ''}`, [link]));
      // the floor check on what the pack gets, once its floor is what the conversion writes
      if (this.floorNeeded(id) && floor?.status !== 'ready') continue;
      for (const problem of typeFloorProblems(`${namespace}:${id}`, link.file, layers.result.type)) {
        problems.push({ ...problem, at: [link, ...problem.at.map((at) => (at.kind === 'field' ? { ...at, at: `/type${at.at}` } : at))] });
      }
    }
    return problems;
  }

  // ------------------------------------------------------------ saving and the export

  /** How a save writes: into the folder the recipe was opened from (File System Access, writable), or as a zip of the markup. */
  get saveTarget(): 'folder' | 'zip' {
    const home = homeOf(this.where);
    return home instanceof FsAccessSource && home.writable ? 'folder' : 'zip';
  }

  /** The name a zip of the markup is handed over under: the recipe's (`mvp.json` → `mvp-recipe.zip`). */
  get zipName(): string {
    return `${this.recipeName.replace(/\.json$/, '')}-recipe.zip`;
  }

  /** Writes the changed files into the recipe's folder (only those); they become the state as opened. */
  async saveToFolder(): Promise<string[]> {
    const home = homeOf(this.where);
    if (!(home instanceof FsAccessSource)) throw new Error('the recipe was not opened from a folder it can be saved into');
    const written = await this.workspace.save(home.sink());
    this.journal.markSaved();
    this.bump();
    return written.map((change) => change.path);
  }

  /** The markup as a zip (`exportRecipe`) handed to `deliver`; the recipe's files count as saved after it. */
  async saveToZip(deliver: (zip: Uint8Array, name: string) => void | Promise<void>): Promise<RecipeExport> {
    const markup = await exportRecipe(this.workspace);
    await deliver(markup.zip, this.zipName);
    await this.workspace.save(NOWHERE);
    this.journal.markSaved();
    this.bump();
    return markup;
  }

  /** "Экспорт рецепта": the markup for sharing (no asset), and the IR zips the receiver needs besides. Saves nothing. */
  exportMarkup(): Promise<RecipeExport> {
    return exportRecipe(this.workspace);
  }

  /**
   * "Готовый пак для себя": the whole conversion of the recipe as it stands — the bytes
   * `python -I tools/ir2rwat.py <recipe> --out … [--zip]` writes from the same files — in a
   * worker of its own, stopped when it ends (a cancel stops only it).
   */
  async convert(output: 'zip' | 'files', options: { onLog?: (line: string) => void; signal?: AbortSignal; onProgress?: (progress: LoadProgress) => void } = {}): Promise<ConvertResult> {
    const bridge = await makeBridge();
    const stop = options.onProgress === undefined ? () => undefined : bridge.onProgress(options.onProgress);
    try {
      const recipe = await this.workspace.bytes(this.recipePath);
      const overrides: Record<string, Uint8Array> = {};
      for (const id of this.workspace.overrideIds()) overrides[id] = await this.workspace.bytes(this.workspace.overridePath(id));
      const call: { onLog?: (line: string) => void; signal?: AbortSignal } = {};
      if (options.onLog !== undefined) call.onLog = options.onLog;
      if (options.signal !== undefined) call.signal = options.signal;
      return await bridge.convert({ recipe, recipeName: this.recipeName, overrides, sources: this.zipBlobs(), output }, call);
    } finally {
      stop();
      bridge.cancel();
    }
  }

  // ------------------------------------------------------------ the end

  /** Ends the session: its journal no longer heard, its worker stopped (the recipe it derived and the zips' mounts with it). */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.bridge.cancel();
  }

  /** The session's bridge's loading of Pyodide, for a progress bar. */
  onProgress(listener: (progress: LoadProgress) => void): () => void {
    return this.bridge.onProgress(listener);
  }

  /** How far the session's bridge has loaded Pyodide. */
  get progress(): LoadProgress {
    return this.bridge.progress;
  }

  /** The size of the session's Python memory, bytes. */
  memory(): Promise<number> {
    return this.bridge.memory();
  }
}
