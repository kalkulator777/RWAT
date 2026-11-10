/**
 * What a pack's files were when the session last looked (editor.md M5): every file's
 * size, and a SHA-256 of every JSON file. A session over a folder (or over a zip or folder
 * the user opens again) compares it with what is there before its edits replay, and says
 * which files changed instead of replaying over them silently.
 *
 * Only JSON is hashed: it is read when a pack opens anyway, and it is what the journal's
 * edits are made of. An asset is compared by its size: hashing hundreds of megabytes of
 * textures to restore a session is not worth it; an asset changed to the same size is not
 * noticed (the session never writes an asset it did not change).
 */

import type { PackSource } from '../contracts';
import { fileKind } from '../pack/layout';

export interface FileMark {
  size: number;
  /** SHA-256 of the bytes, hex; JSON files only. */
  sha256?: string;
}

/** The files of a source by path. */
export interface Fingerprint {
  files: Record<string, FileMark>;
}

/** The SHA-256 of the bytes as lower-case hex. */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The fingerprint of everything the source lists. */
export async function fingerprintOf(source: PackSource): Promise<Fingerprint> {
  const files: Record<string, FileMark> = {};
  for (const { path, size } of await source.list()) {
    files[path] = fileKind(path) === 'json' ? { size, sha256: await sha256(await source.read(path)) } : { size };
  }
  return { files };
}

/** How a source differs from the fingerprint it had. */
export interface FingerprintChanges {
  added: string[];
  removed: string[];
  changed: string[];
}

/** The files added, removed and changed since `was`, each in path order; all empty when nothing changed. */
export function compareFingerprints(was: Fingerprint, now: Fingerprint): FingerprintChanges {
  const changes: FingerprintChanges = { added: [], removed: [], changed: [] };
  for (const [path, mark] of Object.entries(now.files)) {
    const old = was.files[path];
    if (old === undefined) changes.added.push(path);
    else if (old.size !== mark.size || old.sha256 !== mark.sha256) changes.changed.push(path);
  }
  for (const path of Object.keys(was.files)) if (!(path in now.files)) changes.removed.push(path);
  for (const list of [changes.added, changes.removed, changes.changed]) list.sort();
  return changes;
}

/** True when nothing was added, removed or changed. */
export function isUnchanged(changes: FingerprintChanges): boolean {
  return changes.added.length === 0 && changes.removed.length === 0 && changes.changed.length === 0;
}
