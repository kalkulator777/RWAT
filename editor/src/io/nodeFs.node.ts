/**
 * A pack folder on the disk through Node's fs: the stand-in for File System Access in
 * the unit tests and in the Playwright tests, which run in Node. Not part of the site
 * (the `.node.ts` suffix keeps it out of the browser program, see
 * docs/proposals/editor.md §3.2); nothing the site imports may import it.
 *
 * It lists regular files and folders only (a symbolic link is skipped, so a link cannot
 * point the reader out of the pack) and writes the way {@link FsAccessSink} does.
 */

import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { FileChange, FileEntry, PackSink, PackSource } from '../core/contracts';
import { applyChanges, type FolderBackend } from './changes';
import { PackIoError, pathsSummary, wrapIoError } from './errors';
import { comparePaths, packPathProblem, parentPath } from '../core/paths';

async function listFolder(root: string, prefix: string, entries: FileEntry[], unsafe: string[]): Promise<void> {
  const here = prefix === '' ? root : join(root, ...prefix.slice(0, -1).split('/'));
  for (const item of await readdir(here, { withFileTypes: true })) {
    const path = prefix + item.name;
    if (!item.isFile() && !item.isDirectory()) continue;
    if (packPathProblem(path) !== null) {
      unsafe.push(path);
    } else if (item.isDirectory()) {
      await listFolder(root, `${path}/`, entries, unsafe);
    } else {
      entries.push({ path, size: (await stat(join(here, item.name))).size });
    }
  }
}

/** A folder of the disk as a pack source (kind `node`); writes back through {@link NodeFsSink}. */
export class NodeFsSource implements PackSource {
  readonly kind = 'node';
  readonly writable = true;
  readonly name: string;
  private readonly root: string;

  constructor(folder: string) {
    this.root = resolve(folder);
    this.name = basename(this.root);
  }

  async list(): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    const unsafe: string[] = [];
    try {
      await listFolder(this.root, '', entries, unsafe);
    } catch (error) {
      throw wrapIoError(error);
    }
    if (unsafe.length > 0) {
      throw new PackIoError('unsafe-path', `${this.name} has files that are not paths inside a pack: ${pathsSummary(unsafe)}`, unsafe);
    }
    return entries.sort((a, b) => comparePaths(a.path, b.path));
  }

  async read(path: string): Promise<Uint8Array> {
    if (packPathProblem(path) !== null) throw new PackIoError('unsafe-path', `Not a path inside the pack: ${JSON.stringify(path)}`, [path]);
    try {
      return new Uint8Array(await readFile(join(this.root, ...path.split('/'))));
    } catch (error) {
      throw wrapIoError(error, path);
    }
  }

  sink(): NodeFsSink {
    return new NodeFsSink(this.root);
  }
}

class NodeBackend implements FolderBackend {
  constructor(private readonly root: string) {}

  private at(path: string): string {
    return join(this.root, ...path.split('/'));
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    try {
      await mkdir(this.at(parentPath(path)), { recursive: true });
      await writeFile(this.at(path), bytes);
    } catch (error) {
      throw wrapIoError(error, path, true);
    }
  }

  async removeFile(path: string): Promise<boolean> {
    try {
      if (!(await stat(this.at(path))).isFile()) return false;
      await rm(this.at(path));
      return true;
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'ENOENT') return false;
      throw wrapIoError(error, path, true);
    }
  }

  async removeFolderIfEmpty(path: string): Promise<boolean> {
    try {
      await rmdir(this.at(path)); // refuses a folder that holds anything
      return true;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'ENOENT' || code === 'ENOTEMPTY' || code === 'ENOTDIR' || code === 'EEXIST') return false;
      throw wrapIoError(error, path, true);
    }
  }
}

/** Writes changes into a disk folder: deletions, files (`pack.mcmeta` last), then the folders the deletions emptied go. */
export class NodeFsSink implements PackSink {
  private readonly root: string;

  constructor(folder: string) {
    this.root = resolve(folder);
  }

  write(changes: FileChange[]): Promise<void> {
    return applyChanges(new NodeBackend(this.root), changes);
  }
}
