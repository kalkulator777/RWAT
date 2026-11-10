/**
 * Where the session is kept (editor.md §3.5, M5): a small key-value store. In the page it
 * is IndexedDB through idb-keyval, which keeps what the structured clone keeps — bytes,
 * Blobs, File System Access handles — as they are; the tests and a browser without
 * IndexedDB use the store in memory.
 */

import { createStore, del, get, set } from 'idb-keyval';

/** The part of a key-value store the session uses. */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** A store in memory: values are kept as given (a test can look at them). */
export class MemoryStore implements KeyValueStore {
  readonly values = new Map<string, unknown>();

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.values.get(key));
  }

  set(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

/** The IndexedDB database and object store of the editor's session. */
export const SESSION_DB = 'rwat-editor';
export const SESSION_OBJECTS = 'session';

/** The session's store in IndexedDB; null where the browser has none (or blocks it). */
export function indexedDbStore(): KeyValueStore | null {
  if (typeof indexedDB === 'undefined') return null;
  let objects: ReturnType<typeof createStore>;
  try {
    objects = createStore(SESSION_DB, SESSION_OBJECTS);
  } catch {
    return null;
  }
  return {
    get: (key) => get(key, objects),
    set: (key, value) => set(key, value, objects),
    delete: (key) => del(key, objects),
  };
}
