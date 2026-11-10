/**
 * What a save writes, file by file (editor.md §2.5, step 3): the new, changed and deleted
 * files with the lines each gains and loses, and the difference of one file's text.
 * Binary files (textures, sounds) are listed without lines and are not read for it.
 */

import { fileKind, type FileKind, type Pack } from '../../core/pack';
import { diffLines, splitLines, type LineDiff } from './diff';

export type ChangeStatus = 'new' | 'changed' | 'deleted';

export interface ChangeItem {
  path: string;
  status: ChangeStatus;
  kind: FileKind;
  /** Lines added and removed (text and JSON files); null for binary files. */
  added: number | null;
  removed: number | null;
  /** False when the texts differ too much to be compared line by line: the counts are the whole changed middle. */
  exact: boolean;
}

const decoder = new TextDecoder();

/** The texts before and after the save: null for a side with no file. */
export async function changeTexts(pack: Pack, path: string): Promise<{ before: string | null; after: string | null }> {
  const original = await pack.originalBytes(path);
  return {
    before: original === null ? null : decoder.decode(original),
    after: pack.has(path) ? await pack.text(path) : null,
  };
}

/** The difference of a text file's lines (an absent side is empty); null for a binary file. */
export async function changeDiff(pack: Pack, path: string): Promise<LineDiff | null> {
  if (fileKind(path) === 'binary') return null;
  const { before, after } = await changeTexts(pack, path);
  return diffLines(before ?? '', after ?? '');
}

/** The files the save writes or deletes, in path order. */
export async function listChanges(pack: Pack): Promise<ChangeItem[]> {
  const items: ChangeItem[] = [];
  for (const path of pack.dirtyPaths()) {
    const status = pack.status(path) as ChangeStatus;
    const kind = fileKind(path);
    if (kind === 'binary') {
      items.push({ path, status, kind, added: null, removed: null, exact: true });
      continue;
    }
    const { before, after } = await changeTexts(pack, path);
    if (before === null || after === null) {
      const lines = splitLines(before ?? after ?? '').length;
      items.push({ path, status, kind, added: after === null ? 0 : lines, removed: before === null ? 0 : lines, exact: true });
      continue;
    }
    const diff = diffLines(before, after);
    items.push({ path, status, kind, added: diff.added, removed: diff.removed, exact: diff.lines !== null });
  }
  return items;
}
