/**
 * A sound reference of a model declaration and what the engine makes of it
 * (`client/sound/SoundSet.java`): a path ending in `.ogg` is an Ogg Vorbis file of the
 * packs (`ns:path`, no namespace = the declaring pack's), anything else is the id of a
 * sound event of some `sounds.json` (the game's own with an explicit `minecraft:`; one
 * without a namespace is the declaring pack's event, not the game's). Pure.
 */

import { resourceFile } from '../checks/loader';
import { childPointer, isJsonObject } from '../core/json';

/** What a reference names. */
export interface SoundRef {
  /** `file`: an Ogg file; `event`: a sound event. */
  kind: 'file' | 'event';
  /** The namespace the engine reads the reference in (explicit, else the declaring one). */
  namespace: string;
  /** The path inside the namespace: of the file, or the event's name. */
  path: string;
  /** For a file, its pack path under `assets/`; for an event, `null`. */
  file: string | null;
  /** `ns:path`: the event's id, or the file's resource location. */
  id: string;
}

/** True if a sound reference names a file rather than a sound event (`SoundSet.isFile`). */
export function isFile(ref: string): boolean {
  return ref.endsWith('.ogg');
}

/** The reference as the engine reads it in the namespace of the declaring pack. */
export function parseRef(ref: string, declaring: string): SoundRef {
  const colon = ref.indexOf(':');
  const namespace = colon < 0 ? declaring : ref.slice(0, colon) || 'minecraft';
  const path = colon < 0 ? ref : ref.slice(colon + 1);
  const file = isFile(ref);
  return { kind: file ? 'file' : 'event', namespace, path, file: file ? resourceFile(ref, declaring) : null, id: `${namespace}:${path}` };
}

/**
 * A file of the pack written as a reference: the path alone in the declaring namespace,
 * `ns:path` in another. `null` for a file outside `assets/<ns>/`.
 */
export function refOfFile(file: string, declaring: string): string | null {
  const match = /^assets\/([^/]+)\/(.+)$/.exec(file);
  if (match === null) return null;
  const [, namespace = '', path = ''] = match;
  return namespace === declaring ? path : `${namespace}:${path}`;
}

/** The Ogg files of a pack (every `.ogg` under `assets/`), in path order. */
export function oggFiles(paths: readonly string[]): string[] {
  return paths.filter((path) => path.startsWith('assets/') && isFile(path)).sort();
}

/** One reference of a `sounds` object: where it is and which part of the sound it is. */
export interface DeclaredRef {
  /** Pointer in the model declaration: `/sounds/idle/main`, `/sounds/doors/door_l`, `/sounds/controls/THROTTLE_1/move`. */
  pointer: string;
  ref: string;
  /** The key of `sounds` it is under (`idle`, `doors`, `controls`, …). */
  key: string;
  /** For a loop `start`, `main` or `stop`; for a control `move` or `engage`; for a door its key; else null. */
  part: string | null;
}

/** Every sound reference a (JSON) `sounds` value names, in the declaration's order; values of the wrong type are left to the schema. */
export function declaredRefs(sounds: unknown): DeclaredRef[] {
  const out: DeclaredRef[] = [];
  if (!isJsonObject(sounds)) return out;
  const push = (pointer: string, ref: unknown, key: string, part: string | null): void => {
    if (typeof ref === 'string' && ref !== '') out.push({ pointer, ref, key, part });
  };
  for (const [key, value] of Object.entries(sounds)) {
    const here = childPointer('/sounds', key);
    if (key === 'doors') {
      if (isJsonObject(value)) for (const [door, ref] of Object.entries(value)) push(childPointer(here, door), ref, key, door);
    } else if (key === 'controls') {
      if (!isJsonObject(value)) continue;
      for (const [control, pair] of Object.entries(value)) {
        if (isJsonObject(pair)) for (const part of ['move', 'engage']) push(childPointer(childPointer(here, control), part), pair[part], key, part);
      }
    } else if (isJsonObject(value)) {
      for (const part of ['start', 'main', 'stop']) push(childPointer(here, part), value[part], key, part);
    } else {
      push(here, value, key, null);
    }
  }
  return out;
}
