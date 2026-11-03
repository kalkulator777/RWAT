/**
 * The models parsed lately (docs/proposals/editor.md §3.11): the last few in memory, the
 * oldest dropped when one more comes. An entry is good while every file it was read from
 * has the stamp it had then — the declaration edited, the OBJ or a texture replaced, a
 * missing file put in, and it is read again. Pure.
 */

/** What tells one state of a file from another: a revision, a hash, `missing`… compared with `===`. */
export type Stamp = string | number;

interface Entry<T> {
  value: T;
  /** The files the value was read from, with their stamps then. */
  files: ReadonlyMap<string, Stamp>;
}

/** The parsed models by key (the declaration's path), least recently used first. */
export class ModelCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  /** @param capacity how many models stay in memory: three (§3.11) */
  constructor(readonly capacity = 3) {
    if (!(capacity >= 1)) throw new RangeError(`a cache of ${capacity} models`);
  }

  /** How many models are kept. */
  get size(): number {
    return this.entries.size;
  }

  /** The keys kept, least recently used first. */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * The value of `key` if every file it was read from still has its stamp (it becomes the
   * most recently used); undefined if there is none, or if a file changed (it is dropped).
   *
   * @param stampOf the stamp a file has now
   */
  get(key: string, stampOf: (path: string) => Stamp): T | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    for (const [path, stamp] of entry.files) {
      if (stampOf(path) !== stamp) {
        this.entries.delete(key);
        return undefined;
      }
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /**
   * Keeps `value` under `key` as the most recently used, read from `files` (path → its
   * stamp when read); returns the values dropped to make room, oldest first.
   */
  put(key: string, files: ReadonlyMap<string, Stamp>, value: T): T[] {
    this.entries.delete(key);
    this.entries.set(key, { value, files: new Map(files) });
    const dropped: T[] = [];
    for (const [oldest, entry] of this.entries) {
      if (this.entries.size <= this.capacity) break;
      this.entries.delete(oldest);
      dropped.push(entry.value);
    }
    return dropped;
  }

  /** Forgets `key`. */
  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Forgets everything (another pack opened, the pack closed). */
  clear(): void {
    this.entries.clear();
  }
}
