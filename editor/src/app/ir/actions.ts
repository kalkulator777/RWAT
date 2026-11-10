/**
 * What the author does to the IR session (editor.md §2.6, §2.7): open one — the IR zips and
 * a recipe, new or existing — with Pyodide loaded and the recipe derived under a progress
 * bar and the converter's log, cancelled at will; edit it through its journal; save the
 * recipe and its overrides; export the markup; make the pack for oneself. Failures go to
 * the shell's banner (app/store `failure`) in the interface's words, a converter's refusal
 * in its own (no traceback).
 */

import { batch } from '@preact/signals';
import type { Command, FileChange } from '../../core/contracts';
import { PackIoError, pickFsAccessPack, type PackSink, type PackSource } from '../../io';
import type { ConvertResult, LoadProgress } from '../../ir/bridge';
import { RecipeError } from '../../ir/recipe';
import { downloadZip, type DeliverZip } from '../session';
import { failure, irWork, selection } from '../store';
import { IrInputError } from './sources';
import { failureText, IrSession, makeBridge, type OpenRequest } from './session';
import { irConversion, irDialog, irLog, irOpenType, irSession, irTask, LOG_LINES, type IrTask } from './state';

/** How an import ended: opened (the recipe derived, or refused by the converter: said in the findings), cancelled, or not opened and why. */
export type ImportOutcome = { ok: true } | { ok: false; cancelled: true } | { ok: false; cancelled: false; key: string; params: Record<string, string | number> };

/** Appends lines to the log, keeping the last {@link LOG_LINES}. */
function log(lines: readonly string[]): void {
  if (lines.length === 0) return;
  const next = [...irLog.peek(), ...lines];
  irLog.value = next.length > LOG_LINES ? next.slice(next.length - LOG_LINES) : next;
}

/** Long work with its task signal: progress, lines heard, a cancel that aborts `signal`. */
function task(kind: IrTask['kind']): { signal: AbortSignal; onLog: (line: string) => void; onProgress: (progress: LoadProgress) => void; end: () => void } {
  const abort = new AbortController();
  const started = performance.now();
  irTask.value = { kind, progress: { stage: 'idle', loaded: 0, total: 0 }, lines: 0, last: '', started, cancel: () => abort.abort() };
  return {
    signal: abort.signal,
    onLog: (line) => {
      log([line]);
      const now = irTask.peek();
      if (now !== null) irTask.value = { ...now, lines: now.lines + 1, last: line };
    },
    onProgress: (progress) => {
      const now = irTask.peek();
      if (now !== null) irTask.value = { ...now, progress };
    },
    end: () => {
      irTask.value = null;
    },
  };
}

/** Makes the session the open one: the previous one ends, the top bar's undo, redo and save act on it, its first type opens. */
function show(session: IrSession): void {
  const before = irSession.peek();
  const first = session.typeIds()[0] ?? null;
  batch(() => {
    irSession.value = session;
    irWork.value = { journal: session.journal, revision: session.revision, openSave: () => (irDialog.value = 'save') };
    irOpenType.value = first;
    selection.value = first === null ? [{ kind: 'file', file: session.recipePath }] : [session.typeLink(first)];
    irConversion.value = null;
    failure.value = null;
  });
  if (before !== null && before !== session) before.dispose();
}

/**
 * Opens an IR session: the recipe's files and the zips (./sources.ts), then Pyodide (once
 * a worker, about 13 MB the first time, from the browser's cache after) and `derive`, the
 * progress and the log heard as they come. A recipe the converter refuses still opens:
 * its refusal is a finding, and the recipe can be mended and derived again.
 */
export async function importIr(request: OpenRequest): Promise<ImportOutcome> {
  const bridge = await makeBridge();
  let session: IrSession;
  try {
    session = await IrSession.open(request, bridge);
  } catch (error) {
    bridge.cancel();
    if (error instanceof IrInputError) return { ok: false, cancelled: false, key: error.key, params: error.params };
    if (error instanceof PackIoError) return { ok: false, cancelled: false, key: 'ir.error.read', params: { detail: error.message } };
    return { ok: false, cancelled: false, key: 'ir.error.unknown', params: { detail: error instanceof Error ? error.message : String(error) } };
  }
  irLog.value = [];
  const work = task('import');
  const stop = session.onProgress(work.onProgress);
  try {
    await session.derive({ signal: work.signal, onLog: work.onLog });
  } catch (error) {
    session.dispose();
    if (failureText(error).cancelled) return { ok: false, cancelled: true };
    return { ok: false, cancelled: false, key: 'ir.error.unknown', params: { detail: failureText(error).text } };
  } finally {
    stop();
    work.end();
  }
  show(session);
  return { ok: true };
}

/** Derives the open recipe again (after its own keys changed: `recipeStale`); the types' floors are generated anew as they are looked at. */
export async function rederive(): Promise<void> {
  const session = irSession.value;
  if (session === null) return;
  const work = task('derive');
  const stop = session.onProgress(work.onProgress);
  try {
    await session.derive({ signal: work.signal, onLog: work.onLog });
    const open = irOpenType.peek();
    if (open !== null && session.derivedOf(open) === undefined) irOpenType.value = session.typeIds()[0] ?? null;
  } catch (error) {
    if (failureText(error).cancelled) failure.value = { key: 'ir.error.derive-cancelled', params: {} };
    else failure.value = { key: 'ir.error.unknown', params: { detail: failureText(error).text } };
  } finally {
    stop();
    work.end();
  }
}

/** Applies a command of the IR forms to the session; one the recipe model refuses changes nothing and is said in the banner. */
export async function runIr(command: Command): Promise<boolean> {
  const session = irSession.value;
  if (session === null) return false;
  failure.value = null;
  try {
    await session.run(command);
    return true;
  } catch (error) {
    const detail = error instanceof RecipeError ? error.message : error instanceof Error ? error.message : String(error);
    failure.value = { key: 'ir.error.edit', params: { detail } };
    return false;
  }
}

/** Makes a command of the recipe model and runs it ({@link runIr}); one it refuses to make (a place no override has) is said in the banner too. */
export function runIrMade(make: () => Command): Promise<boolean> {
  let command: Command;
  try {
    command = make();
  } catch (error) {
    failure.value = { key: 'ir.error.edit', params: { detail: error instanceof Error ? error.message : String(error) } };
    return Promise.resolve(false);
  }
  return runIr(command);
}

/** Opens a type of the session: the view shows it, the inspector edits it. */
export function openType(id: string): void {
  const session = irSession.value;
  if (session === null) return;
  batch(() => {
    irOpenType.value = id;
    selection.value = [session.typeLink(id)];
  });
}

/** Ends the session (its worker stopped); the IR mode is empty again. */
export function closeIr(): void {
  const session = irSession.value;
  batch(() => {
    irSession.value = null;
    irWork.value = null;
    irOpenType.value = null;
    irConversion.value = null;
    irLog.value = [];
  });
  session?.dispose();
}

/** Saves the recipe's changed files: into its folder, or as a zip of the markup handed to `deliver`. Returns whether it saved. */
export async function saveIr(target: 'folder' | 'zip', deliver: DeliverZip = downloadZip): Promise<boolean> {
  const session = irSession.value;
  if (session === null) return false;
  failure.value = null;
  try {
    if (target === 'folder') await session.saveToFolder();
    else await session.saveToZip(deliver);
    return true;
  } catch (error) {
    failure.value = { key: 'ir.error.save', params: { detail: error instanceof Error ? error.message : String(error) } };
    return false;
  }
}

/** A folder to write a pack into: what it holds, and how to write there. */
export interface PackFolder {
  source: PackSource;
  sink: PackSink;
}

/** Asks for a folder through File System Access (Chromium), for writing. */
async function pickPackFolder(): Promise<PackFolder | null> {
  const folder = await pickFsAccessPack('readwrite');
  return folder === null ? null : { source: folder, sink: folder.sink() };
}

/** Where "Готовый пак для себя" puts the pack: a zip handed over, or a folder of its own in a folder the author picks (Chromium). */
export type PackTarget = { kind: 'zip'; deliver?: DeliverZip } | { kind: 'folder'; pick?: () => Promise<PackFolder | null> };

/** The changes that put a converted pack into `<pack_dir>/` of a folder, replacing what an earlier conversion left there; null when the folder there is not one the converter wrote. */
export async function packFolderChanges(folder: PackSource, name: string, files: readonly { path: string; bytes: Uint8Array }[]): Promise<FileChange[] | null> {
  const prefix = `${name}/`;
  const there = (await folder.list()).map((entry) => entry.path).filter((path) => path.startsWith(prefix));
  if (there.length > 0 && !there.includes(`${prefix}RWAT_CONVERSION.txt`)) return null;
  const written = new Set(files.map((file) => `${prefix}${file.path}`));
  const changes: FileChange[] = there.filter((path) => !written.has(path)).map((path) => ({ path, delete: true }));
  // pack.mcmeta last, as the converter writes it: a folder left half-written is no pack
  const ordered = [...files].sort((a, b) => Number(a.path === 'pack.mcmeta') - Number(b.path === 'pack.mcmeta'));
  for (const file of ordered) changes.push({ path: `${prefix}${file.path}`, bytes: file.bytes });
  return changes;
}

/**
 * "Готовый пак для себя": the whole conversion of the recipe as it stands, in a worker of
 * its own, with the log and a cancel; the pack handed over as `<pack_dir>.zip` or written
 * into a folder. The result (and the converter's report) is in {@link irConversion};
 * null when cancelled or nothing could start.
 */
export async function convertIr(target: PackTarget): Promise<ConvertResult | null> {
  const session = irSession.value;
  if (session === null) return null;
  failure.value = null;
  let folder: PackFolder | null = null;
  if (target.kind === 'folder') {
    try {
      folder = await (target.pick ?? pickPackFolder)();
    } catch (error) {
      failure.value = { key: 'ir.error.save', params: { detail: error instanceof Error ? error.message : String(error) } };
      return null;
    }
    if (folder === null) return null;
  }
  const work = task('convert');
  const started = performance.now();
  let result: ConvertResult;
  try {
    result = await session.convert(target.kind === 'zip' ? 'zip' : 'files', { signal: work.signal, onLog: work.onLog, onProgress: work.onProgress });
  } catch (error) {
    work.end();
    const said = failureText(error);
    if (!said.cancelled) failure.value = { key: 'ir.error.unknown', params: { detail: said.text } };
    return null;
  }
  work.end();
  let written: string | null = null;
  try {
    const pack = result.pack;
    if (pack?.kind === 'zip') {
      await (target.kind === 'zip' ? (target.deliver ?? downloadZip) : downloadZip)(pack.bytes, pack.name);
      written = pack.name;
    } else if (pack?.kind === 'files' && folder !== null) {
      const changes = await packFolderChanges(folder.source, pack.name, pack.files);
      if (changes === null) {
        failure.value = { key: 'ir.error.not-converted-folder', params: { folder: `${folder.source.name}/${pack.name}` } };
      } else {
        await folder.sink.write(changes);
        written = `${folder.source.name}/${pack.name}`;
      }
    }
  } catch (error) {
    failure.value = { key: 'ir.error.save', params: { detail: error instanceof Error ? error.message : String(error) } };
  }
  irConversion.value = { result, ms: performance.now() - started, written };
  return result;
}
