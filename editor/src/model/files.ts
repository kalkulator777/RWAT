/**
 * The pack's files as the model client reads them on the main thread and hands them to
 * the worker (./client.ts): bytes, whether a file is there, and a stamp the cache tells
 * one state of a file from another by (./cache.ts). Two adapters: a {@link PackSource}
 * as it was opened (tests, a pack only viewed) and the open pack with its edits — known
 * by its shape ({@link EditedPack}), so this module needs nothing of core/pack.
 */

import type { PackSource } from '../core/contracts';
import type { Stamp } from './cache';

/** The pack's files for the model client. */
export interface ModelFiles {
  /** True when the pack has the file now. */
  has(path: string): boolean | Promise<boolean>;
  /** The file's bytes now; rejects when there is no such file. */
  read(path: string): Promise<Uint8Array>;
  /** A stamp that changes whenever the file's bytes do, a missing file included (a cache key, compared with `===`). */
  stamp(path: string): Stamp;
}

/** The stamp of a file that isn't there. */
export const MISSING: Stamp = 'missing';

/**
 * The files of a source as it lists them, read as they are; their stamps are their sizes
 * (a source the editor doesn't write does not change under it).
 */
export async function sourceFiles(source: PackSource): Promise<ModelFiles> {
  const sizes = new Map((await source.list()).map((entry) => [entry.path, entry.size]));
  return {
    has: (path) => sizes.has(path),
    read: (path) => source.read(path),
    stamp: (path) => sizes.get(path) ?? MISSING,
  };
}

/** The open pack with its edits, by the shape of core/pack `Pack` (the methods the model reads). */
export interface EditedPack {
  has(path: string): boolean;
  /** The file's bytes as saving would write them. */
  bytes(path: string): Promise<Uint8Array>;
  /** What saving would do to the file: `unchanged` keeps the bytes it was opened with. */
  status(path: string): string;
  /** Grows with every change: a key for what the pack holds. */
  readonly version: number;
}

/**
 * The files of the open pack as they stand. A file as it was opened has one stamp for as
 * long as it stays so; a file edited, put in or replaced is stamped with the pack's
 * version, so any later change to the pack reads it again — a model whose files are
 * being edited is read again after each edit, the rest stay cached.
 */
export function packFiles(pack: EditedPack): ModelFiles {
  return {
    has: (path) => pack.has(path),
    read: (path) => pack.bytes(path),
    stamp: (path) => {
      if (!pack.has(path)) return MISSING;
      return pack.status(path) === 'unchanged' ? 'opened' : `edited ${pack.version}`;
    },
  };
}
