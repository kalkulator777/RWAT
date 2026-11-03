/**
 * The pack model (editor.md §3.5–3.6): the pack's files as a source lists them, what
 * the journal's ops did to them, and what saving writes.
 *
 * - **Index and reads.** Opening lists the source and reads every JSON file (`.json`,
 *   `.mcmeta`): the tree, the pairs of types and models and the names need them. Every
 *   other file is read when asked for (`bytes`, `text`).
 * - **Edits only through ops.** The pack is the journal's {@link OpTarget}: `apply` changes
 *   one file and returns the ops that undo it. JSON values are never changed in place
 *   (core/json/value.ts), so a value handed out stays as it was.
 * - **Saving.** A file whose bytes or JSON value are as opened is not written. A changed
 *   JSON file is its own text with only the changed places edited (core/json/edit.ts),
 *   so an edit undone writes nothing and an edit of one field changes only its line.
 * - **A generated pack** (with tools/ir2rwat.py's `RWAT_CONVERSION.txt`) is opened for
 *   viewing only: it is edited through its recipe (editor.md §1.5), so every op is refused.
 * - **A pack zipped in its folder** (`MyPack/pack.mcmeta`) is opened from that folder, with
 *   a warning: the mod reads `pack.mcmeta` at the root only. Paths in the model are always
 *   from the pack's root; {@link Pack.root} is the folder in the source.
 */

import type { FileChange, Op, OpTarget, PackSink, PackSource, Problem } from '../contracts';
import { dumpBytes } from '../json/dump';
import { editJson } from '../json/edit';
import { JsonSyntaxError, parseJson, putMember } from '../json/parse';
import { PointerError, formatPointer, parsePointer } from '../json/pointer';
import { ValuePathError, deepEqual, insertIn, isJsonObject, removeIn, setIn } from '../json/value';
import { packPathProblem } from '../paths';
import {
  CONVERSION_MARKER,
  type Declaration,
  type FileKind,
  MCMETA,
  SUPPORTED_FORMAT,
  classify,
  fileKind,
  findPackRoot,
} from './layout';

/** Why the pack refused to open or an op was refused. */
export type PackErrorCode =
  /** No `pack.mcmeta` anywhere in what was opened. */
  | 'not-a-pack'
  /** `pack.mcmeta` in two folders side by side: two packs. */
  | 'several-packs'
  /** A generated pack: edited through its recipe. */
  | 'read-only'
  | 'no-file'
  /** A rename onto a file that exists. */
  | 'file-exists'
  /** A JSON op on a file that is not JSON (by its name). */
  | 'not-json'
  /** A JSON op on a file whose text is not JSON. */
  | 'broken-json'
  /** The op's inverse needs bytes not read yet: `prepare` the ops first (`Journal.run`). */
  | 'not-loaded'
  /** The pointer names no place the op can change. */
  | 'bad-target'
  /** The value is not JSON: undefined, NaN, a function, a class instance. */
  | 'bad-value'
  /** A rename that would make a JSON file binary or the other way round. */
  | 'kind-change'
  /** A `putFile` or `renameFile` target that is no path inside the pack (`../x`, `/x`, `a//b`). */
  | 'bad-path';

export class PackError extends Error {
  constructor(
    readonly code: PackErrorCode,
    message: string,
    /** The file the op named. */
    readonly path?: string,
  ) {
    super(message);
    this.name = 'PackError';
  }
}

/** One file's bytes as read or put, read once and shared by every state that holds them. */
interface Base {
  readonly kind: FileKind;
  /** The source path whose bytes these are (read when first needed); null for bytes put by an op or written by a save. */
  readonly origin: string | null;
  bytes?: Uint8Array;
  /** JSON and text: the bytes decoded as UTF-8, a BOM kept. */
  text?: string;
  /** JSON: the value of the text. */
  value?: unknown;
  /** JSON: why the text is not JSON. */
  error?: JsonSyntaxError;
  loading?: Promise<void>;
}

/** A file as it stands: its bytes and, for JSON, its value (the bytes' value until an op changes it). */
interface Content {
  readonly base: Base;
  readonly value: unknown;
}

/** A path of the pack: what the source had there (null: nothing) and what is there now (null: deleted). */
interface FileRecord {
  original: Base | null;
  current: Content | null;
}

/** What a file is to the save: as opened, changed, created or deleted. */
export type FileStatus = 'unchanged' | 'changed' | 'new' | 'deleted';

/** A type and a model paired by their id (pack-layout.json: nothing else links them); either may be missing. */
export interface StockEntry {
  id: string;
  /** The type's file, null for a model without a type. */
  type: string | null;
  /** The model's file, null for a type without a model. */
  model: string | null;
}

/** A name from the lang files: its text and the file that gives it. */
export interface NameEntry {
  value: string;
  file: string;
}

/** `pack.mcmeta` as the engine reads it (`pack/RwatPackMeta`), without the warnings: those are checks/'. */
export interface PackMeta {
  /** Minecraft's `pack` section, as it stands; undefined when missing. */
  pack: unknown;
  /** The `rwat` block when it is an object, else null. */
  rwat: Record<string, unknown> | null;
  /** `rwat.format` when it is a whole number of 1 or more; 1 when the block or the key is missing (the engine assumes it); null otherwise. */
  format: number | null;
  /** True when no format is written and the engine assumes {@link SUPPORTED_FORMAT}. */
  formatAssumed: boolean;
  /** True when the engine loads a pack of this format. */
  supported: boolean;
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const encoder = new TextEncoder();

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** A copy of a JSON value that is checked to be one: plain objects, arrays, strings, finite numbers, booleans, null. */
function jsonValue(value: unknown, file: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => jsonValue(item, file));
  if (value !== null && typeof value === 'object') {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      const copy: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) putMember(copy, key, jsonValue(item, file));
      return copy;
    }
  }
  throw new PackError('bad-value', `not a JSON value: ${typeof value === 'object' ? Object.prototype.toString.call(value) : typeof value}`, file);
}

function fillBase(base: Base, bytes: Uint8Array): void {
  base.bytes = bytes;
  if (base.kind === 'binary') return;
  base.text = decoder.decode(bytes);
  if (base.kind !== 'json') return;
  try {
    base.value = parseJson(base.text);
  } catch (error) {
    if (!(error instanceof JsonSyntaxError)) throw error;
    base.error = error;
  }
}

function newBase(kind: FileKind, bytes: Uint8Array): Base {
  const base: Base = { kind, origin: null };
  fillBase(base, bytes);
  return base;
}

export class Pack implements OpTarget {
  private readonly records = new Map<string, FileRecord>();
  private changeCount = 0;

  private constructor(
    readonly source: PackSource,
    /** The pack's folder in the source: `''`, or `MyPack/` when it was zipped inside a folder. */
    readonly root: string,
    /** True for a pack tools/ir2rwat.py generated: viewing only. */
    readonly generated: boolean,
  ) {}

  /**
   * Opens a pack: lists the source, finds the pack's root and reads its JSON files.
   * Throws {@link PackError} `not-a-pack` or `several-packs`; a source's own read errors
   * pass through.
   */
  static async open(source: PackSource): Promise<Pack> {
    const entries = await source.list();
    const found = findPackRoot(entries.map((entry) => entry.path));
    if ('problem' in found) {
      if (found.problem === 'several-packs') {
        throw new PackError('several-packs', `several packs in one source: ${found.roots.join(', ')}; open each by itself`);
      }
      throw new PackError('not-a-pack', `no ${MCMETA} in ${source.name}: not a pack`);
    }
    const { root } = found;
    const paths = entries.filter((entry) => entry.path.startsWith(root)).map((entry) => entry.path.slice(root.length));
    const pack = new Pack(source, root, paths.includes(CONVERSION_MARKER));
    const bases = new Map<string, Base>();
    for (const path of paths) bases.set(path, { kind: fileKind(path), origin: root + path });
    await Promise.all([...bases.values()].filter((base) => base.kind === 'json').map((base) => pack.loadBase(base)));
    for (const [path, base] of bases) pack.records.set(path, { original: base, current: { base, value: base.value } });
    return pack;
  }

  /** True when every op is refused: a generated pack. */
  get readOnly(): boolean {
    return this.generated;
  }

  /** Grows with every change an op made: a cheap key for caches of what the pack holds. */
  get version(): number {
    return this.changeCount;
  }

  // ------------------------------------------------------------ reading

  /** Every file the pack has now, in path order. */
  paths(): string[] {
    return [...this.records].filter(([, record]) => record.current !== null).map(([path]) => path).sort();
  }

  has(path: string): boolean {
    return this.records.get(path)?.current != null;
  }

  private currentOf(path: string): Content {
    const current = this.records.get(path)?.current;
    if (current == null) throw new PackError('no-file', `no file ${path}`, path);
    return current;
  }

  /** How the file is held, by its name. */
  kind(path: string): FileKind {
    return fileKind(path);
  }

  /** True when the file's bytes are in memory (JSON always; others once read). */
  isLoaded(path: string): boolean {
    return this.currentOf(path).base.bytes !== undefined;
  }

  /**
   * The JSON value of a file as it stands; undefined for a missing file, one that is not
   * JSON by its name or whose text is not JSON. Never change it in place: it is shared.
   */
  json(path: string): unknown {
    const current = this.records.get(path)?.current;
    return current?.base.kind === 'json' ? current.value : undefined;
  }

  /** Why a JSON file's text is not JSON, or null. */
  jsonError(path: string): JsonSyntaxError | null {
    return this.records.get(path)?.current?.base.error ?? null;
  }

  private loadBase(base: Base): Promise<void> {
    if (base.bytes !== undefined) return Promise.resolve();
    base.loading ??= this.source.read(base.origin as string).then((bytes) => fillBase(base, bytes));
    return base.loading;
  }

  /** Reads the files' bytes now (and what they were opened as). */
  async load(paths: Iterable<string>): Promise<void> {
    const reads: Promise<void>[] = [];
    for (const path of paths) {
      const record = this.records.get(path);
      if (record?.current != null) reads.push(this.loadBase(record.current.base));
      if (record?.original != null) reads.push(this.loadBase(record.original));
    }
    await Promise.all(reads);
  }

  /** The file's bytes as saving would write them. */
  async bytes(path: string): Promise<Uint8Array> {
    return this.output(this.currentOf(path));
  }

  /** The file's text (UTF-8) as saving would write it. */
  async text(path: string): Promise<string> {
    return decoder.decode(await this.output(this.currentOf(path)));
  }

  private async output(current: Content): Promise<Uint8Array> {
    const { base } = current;
    if (base.kind === 'json' && base.text !== undefined && base.error === undefined && !deepEqual(current.value, base.value)) {
      return encoder.encode(editJson(base.text, base.value, current.value).text);
    }
    await this.loadBase(base);
    return base.bytes as Uint8Array;
  }

  // ------------------------------------------------------------ declarations

  /** The declarations and lang files the pack has now, in path order. */
  declarations(): Declaration[] {
    return this.paths()
      .map(classify)
      .filter((declaration): declaration is Declaration => declaration !== null);
  }

  /** Types and models paired by id, in id order; a type without a model or a model without a type has null on the other side (D4). */
  stock(): StockEntry[] {
    const byId = new Map<string, StockEntry>();
    for (const declaration of this.declarations()) {
      if (declaration.kind !== 'wagon_type' && declaration.kind !== 'wagon_model') continue;
      const id = declaration.id as string;
      const entry = byId.get(id) ?? { id, type: null, model: null };
      if (declaration.kind === 'wagon_type') entry.type = declaration.path;
      else entry.model = declaration.path;
      byId.set(id, entry);
    }
    return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** The rail styles by id, in id order. */
  railStyles(): { id: string; file: string }[] {
    return this.declarations()
      .filter((declaration) => declaration.kind === 'rail_model')
      .map((declaration) => ({ id: declaration.id as string, file: declaration.path }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /** The languages the lang files are in: `en_us`, `ru_ru`. */
  langs(): string[] {
    return [...new Set(this.declarations().flatMap((declaration) => (declaration.kind === 'lang' ? [declaration.lang as string] : [])))].sort();
  }

  /**
   * The names of a language: every string key of its lang files across namespaces (as
   * Minecraft merges them), with the file each comes from; of one key in two files, the
   * later file by path wins.
   */
  names(lang: string): Map<string, NameEntry> {
    const names = new Map<string, NameEntry>();
    for (const declaration of this.declarations()) {
      if (declaration.kind !== 'lang' || declaration.lang !== lang) continue;
      const value = this.json(declaration.path);
      if (!isJsonObject(value)) continue;
      for (const [key, text] of Object.entries(value)) if (typeof text === 'string') names.set(key, { value: text, file: declaration.path });
    }
    return names;
  }

  /** `pack.mcmeta`: the `pack` section, the `rwat` block and its format. */
  meta(): PackMeta {
    const mcmeta = this.json(MCMETA);
    const pack = isJsonObject(mcmeta) ? mcmeta.pack : undefined;
    if (!isJsonObject(mcmeta) || !Object.hasOwn(mcmeta, 'rwat')) {
      return { pack, rwat: null, format: SUPPORTED_FORMAT, formatAssumed: true, supported: true };
    }
    const rwat = isJsonObject(mcmeta.rwat) ? mcmeta.rwat : null;
    if (rwat === null) return { pack, rwat, format: null, formatAssumed: false, supported: false };
    if (!Object.hasOwn(rwat, 'format')) return { pack, rwat, format: SUPPORTED_FORMAT, formatAssumed: true, supported: true };
    const format = rwat.format;
    if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) {
      return { pack, rwat, format: null, formatAssumed: false, supported: false };
    }
    return { pack, rwat, format, formatAssumed: false, supported: format <= SUPPORTED_FORMAT };
  }

  /** What opening found: the pack zipped in a folder, files whose text is not JSON. */
  problems(): Problem[] {
    const problems: Problem[] = [];
    if (this.root !== '') {
      const folder = this.root.slice(0, -1);
      problems.push({
        severity: 'warning',
        source: 'loader',
        code: 'pack.in-folder',
        params: { folder },
        text: `the pack sits in the folder ${folder}: the mod reads ${MCMETA} at the pack's root only and would skip it as it is; opened from that folder`,
        at: [{ kind: 'file', file: MCMETA }],
      });
    }
    for (const path of this.paths()) {
      const error = this.jsonError(path);
      if (error !== null) {
        problems.push({
          severity: 'error',
          source: 'loader',
          code: 'pack.broken-json',
          params: { error: error.code, offset: error.offset },
          text: `${path}: ${error.message}`,
          at: [{ kind: 'file', file: path }],
        });
      }
    }
    return problems;
  }

  // ------------------------------------------------------------ edits

  private setCurrent(path: string, current: Content | null): void {
    const record = this.records.get(path) ?? { original: null, current: null };
    record.current = current;
    if (record.original === null && current === null) this.records.delete(path);
    else this.records.set(path, record);
    this.changeCount++;
  }

  /**
   * Applies one op (the journal's {@link OpTarget}) and returns the ops that undo it.
   * Throws {@link PackError}, having changed nothing.
   */
  apply(op: Op): Op[] {
    if (this.generated) throw new PackError('read-only', `the pack was generated by ir2rwat: edit its recipe instead`, op.file);
    switch (op.op) {
      case 'set':
      case 'remove':
      case 'insert':
        return this.applyJson(op);
      case 'putFile':
        this.requirePackPath(op.file);
        return this.putFile(op.file, op.bytes);
      case 'deleteFile': {
        const undo = this.restoreOps(op.file, this.currentOf(op.file));
        this.setCurrent(op.file, null);
        return undo;
      }
      case 'renameFile':
        this.requirePackPath(op.to);
        return this.renameFile(op.file, op.to);
    }
  }

  /** A file the pack will hold is named by a normal pack path, so a save can never write outside the pack. */
  private requirePackPath(path: string): void {
    const problem = packPathProblem(path);
    if (problem !== null) throw new PackError('bad-path', `${JSON.stringify(path)} is not a path inside the pack (${problem})`, path);
  }

  private applyJson(op: Extract<Op, { at: string }>): Op[] {
    const current = this.currentOf(op.file);
    const { base } = current;
    if (base.kind !== 'json') throw new PackError('not-json', `${op.file} is not a JSON file`, op.file);
    if (base.error !== undefined) throw new PackError('broken-json', `${op.file}: ${base.error.message}`, op.file);
    const file = op.file;
    try {
      const segments = parsePointer(op.at);
      if (op.op === 'set') {
        const { root, previous } = setIn(current.value, segments, jsonValue(op.value, file));
        this.setCurrent(file, { base, value: root });
        return [previous.exists ? { op: 'set', file, at: op.at, value: previous.value } : { op: 'remove', file, at: op.at }];
      }
      if (op.op === 'remove') {
        const { root, value, index } = removeIn(current.value, segments);
        this.setCurrent(file, { base, value: root });
        return [index === null ? { op: 'set', file, at: op.at, value } : { op: 'insert', file, at: formatPointer([...segments.slice(0, -1), index]), value }];
      }
      const { root, index } = insertIn(current.value, segments, jsonValue(op.value, file));
      this.setCurrent(file, { base, value: root });
      return [{ op: 'remove', file, at: formatPointer([...segments.slice(0, -1), index]) }];
    } catch (error) {
      if (error instanceof PointerError || error instanceof ValuePathError) throw new PackError('bad-target', `${file}: ${error.message}`, file);
      throw error;
    }
  }

  /** The ops that bring a file back to this content: its bytes put again, and its JSON value when it differs from them. */
  private restoreOps(file: string, content: Content): Op[] {
    const { base } = content;
    if (base.bytes === undefined) throw new PackError('not-loaded', `${file} is not read yet: prepare the ops first`, file);
    const ops: Op[] = [{ op: 'putFile', file, bytes: base.bytes }];
    if (base.kind === 'json' && base.error === undefined && !deepEqual(content.value, base.value)) {
      ops.push({ op: 'set', file, at: '', value: content.value });
    }
    return ops;
  }

  private putFile(file: string, bytes: Uint8Array): Op[] {
    const old = this.records.get(file)?.current ?? null;
    const undo: Op[] = old === null ? [{ op: 'deleteFile', file }] : this.restoreOps(file, old);
    const base = newBase(fileKind(file), bytes.slice());
    this.setCurrent(file, { base, value: base.value });
    return undo;
  }

  private renameFile(file: string, to: string): Op[] {
    const current = this.currentOf(file);
    if (this.has(to)) throw new PackError('file-exists', `${to} exists already`, to);
    if (fileKind(to) !== current.base.kind) throw new PackError('kind-change', `${file} → ${to} would change how the file is read`, to);
    this.setCurrent(to, current);
    this.setCurrent(file, null);
    return [{ op: 'renameFile', file: to, to: file }];
  }

  /**
   * Reads what the ops' inverses will need: the bytes of every file a `putFile` replaces
   * or a `deleteFile` removes, following the renames among the ops.
   */
  async prepare(ops: readonly Op[]): Promise<void> {
    const put: Base = { kind: 'binary', origin: null, bytes: new Uint8Array() };
    const view = new Map<string, Base | null>();
    const baseAt = (path: string): Base | null => (view.has(path) ? (view.get(path) as Base | null) : (this.records.get(path)?.current?.base ?? null));
    const needed = new Set<Base>();
    const need = (path: string): void => {
      const base = baseAt(path);
      if (base !== null) needed.add(base);
      const original = this.records.get(path)?.original;
      if (original != null) needed.add(original);
    };
    for (const op of ops) {
      if (op.op === 'putFile') {
        need(op.file);
        view.set(op.file, put);
      } else if (op.op === 'deleteFile') {
        need(op.file);
        view.set(op.file, null);
      } else if (op.op === 'renameFile') {
        view.set(op.to, baseAt(op.file));
        view.set(op.file, null);
      }
    }
    await Promise.all([...needed].map((base) => this.loadBase(base)));
  }

  // ------------------------------------------------------------ saving

  private sameBytes(a: Base, b: Base): boolean {
    if (a === b || (a.origin !== null && a.origin === b.origin)) return true;
    return a.bytes !== undefined && b.bytes !== undefined && bytesEqual(a.bytes, b.bytes);
  }

  /** What saving would do to the file. */
  status(path: string): FileStatus {
    const record = this.records.get(path);
    if (record === undefined) throw new PackError('no-file', `no file ${path}`, path);
    const { original, current } = record;
    if (original === null) return 'new';
    if (current === null) return 'deleted';
    if (!this.sameBytes(current.base, original)) return 'changed';
    const valueChanged = current.base.kind === 'json' && current.value !== current.base.value && !deepEqual(current.value, current.base.value);
    return valueChanged ? 'changed' : 'unchanged';
  }

  /** The files saving would write or delete, in path order: the "dirty" files. */
  dirtyPaths(): string[] {
    return [...this.records.keys()].filter((path) => this.status(path) !== 'unchanged').sort();
  }

  /**
   * What saving writes: each dirty file's bytes, or its deletion. Paths are the pack's;
   * `inSource` puts the pack's folder in front of them, for writing back into the source
   * a pack zipped in its folder came from.
   */
  async changes(options: { inSource?: boolean } = {}): Promise<FileChange[]> {
    const prefix = options.inSource === true ? this.root : '';
    const changes: FileChange[] = [];
    for (const path of this.dirtyPaths()) {
      const current = this.records.get(path)?.current ?? null;
      changes.push(current === null ? { path: prefix + path, delete: true } : { path: prefix + path, bytes: await this.output(current) });
    }
    return changes;
  }

  /** Every file of the pack as it stands, in path order: for a zip of the whole pack. */
  async snapshot(): Promise<FileChange[]> {
    const files: FileChange[] = [];
    for (const path of this.paths()) files.push({ path, bytes: await this.output(this.currentOf(path)) });
    return files;
  }

  /**
   * Saves: writes the changes (or, `whole`, every file) to the sink, then takes what was
   * written as the pack's new state as opened, so nothing is dirty and the next save
   * writes only what changes after it. Returns what was written.
   */
  async save(sink: PackSink, options: { inSource?: boolean; whole?: boolean } = {}): Promise<FileChange[]> {
    const dirty = this.dirtyPaths();
    const outputs = new Map<string, Uint8Array>();
    for (const path of dirty) {
      const current = this.records.get(path)?.current ?? null;
      if (current !== null) outputs.set(path, await this.output(current));
    }
    const prefix = options.inSource === true ? this.root : '';
    const changes: FileChange[] =
      options.whole === true
        ? (await this.snapshot()).map((change) => ({ ...change, path: prefix + change.path }))
        : dirty.map((path) => {
            const bytes = outputs.get(path);
            return bytes === undefined ? { path: prefix + path, delete: true } : { path: prefix + path, bytes };
          });
    await sink.write(changes);
    for (const path of dirty) {
      const record = this.records.get(path) as FileRecord;
      const bytes = outputs.get(path);
      if (bytes === undefined || record.current === null) {
        this.records.delete(path);
        continue;
      }
      const base = newBase(record.current.base.kind, bytes);
      // the written text reads as the value (editJson checks it): keep the value itself, so comparing it is cheap
      if (base.kind === 'json' && base.error === undefined) base.value = record.current.value;
      record.original = base;
      record.current = { base, value: base.value };
    }
    this.changeCount++;
    return changes;
  }
}

/** The op that creates (or replaces) a JSON file holding the value, written as the tools write new files (core/json/dump.ts). */
export function putJson(file: string, value: unknown): Op {
  return { op: 'putFile', file, bytes: dumpBytes(value) };
}
