/**
 * Where a pack's files come from and go to (docs/proposals/editor.md §3.2, §3.6): the
 * sources and sinks of `core/contracts.ts`. The node-fs adapter (`nodeFs.node.ts`) is
 * for tests and is not exported here.
 */

import type { PackSource } from '../core/contracts';

export type { FileChange, FileEntry, PackSink, PackSource } from '../core/contracts';
export { applyChanges, isDelete, planChanges, type FolderBackend, type WritePlan } from './changes';
export { openDirInputSource } from './dirInput';
export { downloadBlob, downloadBytes, zipFileName } from './download';
export { describeIoError, PackIoError, type PackIoErrorCode } from './errors';
export {
  ensurePermission,
  FsAccessSink,
  FsAccessSource,
  fromNativeHandle,
  isFsAccessSupported,
  openFsAccessSource,
  pickFsAccessPack,
  type FsDirectoryHandle,
  type FsMode,
  type FsPermission,
} from './fsAccess';
export { MemoryPack, type MemoryFiles } from './memory';
export { comparePaths, isPackPath, normalizeEntryName, packPathProblem } from '../core/paths';
export { pickFiles, pickFolderPack, pickZipPack } from './pickers';
export { buildZip, openZipSource, ZipSink, type ZipFile, type ZipInput } from './zip';

/** Every file of a source, read: path → bytes (for tests and for copying a pack). */
export async function readAll(source: PackSource): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const { path } of await source.list()) files.set(path, await source.read(path));
  return files;
}
