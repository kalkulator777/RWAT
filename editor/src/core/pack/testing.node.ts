/**
 * Test helpers of the pack model (Node only): a pack source and sink in memory, and the
 * repository's files read from disk — the example pack (CC0), the MVP recipe's
 * overrides. The real sources and sinks (folder, zip, node-fs) are io/'s.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileChange, FileEntry, PackSink, PackSource, PackSourceKind } from '../contracts';

/** The repository's root folder. */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The example pack's folder (R11). */
export const EXAMPLE_PACK = join(REPO_ROOT, 'run', 'rwat_packs', 'RwatExamplePack');

/** Every file under a folder by its '/'-separated path inside it, in path order. */
export function readTree(folder: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(relative(folder, path).split(sep).join('/'), new Uint8Array(readFileSync(path)));
    }
  };
  walk(folder);
  return files;
}

/** The JSON files of a folder (`.json`, `.mcmeta`) as text, by path. */
export function jsonTexts(folder: string): Map<string, string> {
  const decoder = new TextDecoder();
  const texts = new Map<string, string>();
  if (!existsSync(folder)) return texts;
  for (const [path, bytes] of readTree(folder)) {
    if (path.endsWith('.json') || path.endsWith('.mcmeta')) texts.set(path, decoder.decode(bytes));
  }
  return texts;
}

/** A pack source over files in memory; counts its reads so a test can tell what was read lazily. */
export class MemorySource implements PackSource {
  readonly reads: string[] = [];

  constructor(
    private readonly files: Map<string, Uint8Array>,
    readonly name = 'memory',
    readonly kind: PackSourceKind = 'memory',
    readonly writable = false,
  ) {}

  list(): Promise<FileEntry[]> {
    return Promise.resolve([...this.files].map(([path, bytes]) => ({ path, size: bytes.length })));
  }

  read(path: string): Promise<Uint8Array> {
    this.reads.push(path);
    const bytes = this.files.get(path);
    return bytes === undefined ? Promise.reject(new Error(`no file ${path}`)) : Promise.resolve(bytes.slice());
  }
}

/** A sink that keeps what it was given; writing it applies the changes to `files`. */
export class MemorySink implements PackSink {
  readonly writes: FileChange[][] = [];

  constructor(readonly files = new Map<string, Uint8Array>()) {}

  write(changes: FileChange[]): Promise<void> {
    this.writes.push(changes);
    for (const change of changes) {
      if ('delete' in change) this.files.delete(change.path);
      else this.files.set(change.path, change.bytes);
    }
    return Promise.resolve();
  }
}

const encoder = new TextEncoder();

/** Files from texts: `{ 'pack.mcmeta': '{…}' }`. */
export function filesOf(texts: Record<string, string | Uint8Array>): Map<string, Uint8Array> {
  return new Map(Object.entries(texts).map(([path, text]) => [path, typeof text === 'string' ? encoder.encode(text) : text]));
}
