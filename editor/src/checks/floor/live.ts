/**
 * The floor check's findings kept up to date with the pack (docs/proposals/editor.md §3.10),
 * as checks/live.ts keeps the pack's: checked at once when another pack opens and
 * {@link CHECK_DELAY_MS} after the last of a run of edits otherwise.
 *
 * Unlike the pack's, a pass goes type by type and gives the page back between them once a
 * slice has run {@link SLICE_MS}: the most complex types of MVP take tens of milliseconds
 * each (some 350 ms for all of them), and the main thread is never held longer than one
 * type (§3.11: no task over 100 ms). The types are taken as they stand when the pass
 * starts (the pack never changes a value in place, so they stay what they were), each
 * from ./problems.ts' cache while its value is the same — after an edit only the edited
 * type is checked again. A pass that a newer one overtakes gives up; the findings change
 * once a pass is through.
 */

import { effect, signal, untracked, type ReadonlySignal } from '@preact/signals';
import type { Problem } from '../../core/contracts';
import type { Pack } from '../../core/pack';
import { CHECK_DELAY_MS } from '../live';
import { typeFloorProblems } from './problems';

/** How long a slice of a pass runs before it gives the page back, ms. */
export const SLICE_MS = 8;

export interface FloorSources {
  pack: ReadonlySignal<Pack | null>;
  /** Grows with every change of the (mutable) pack. */
  revision: ReadonlySignal<number>;
}

export interface FloorOptions {
  delayMs?: number;
  sliceMs?: number;
  /** Gives the page back (a macrotask by default). */
  yieldToPage?: () => Promise<void>;
}

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A signal of the floor check's findings of the pack the sources hold; `dispose` stops it (tests). */
export function liveFloorFindings(sources: FloorSources, options: FloorOptions = {}): ReadonlySignal<Problem[]> & { dispose(): void } {
  const delay = options.delayMs ?? CHECK_DELAY_MS;
  const slice = options.sliceMs ?? SLICE_MS;
  const yieldToPage = options.yieldToPage ?? macrotask;
  const out = signal<Problem[]>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPack: Pack | null | undefined;
  /** Grows with every pass asked for: an older one gives up. */
  let generation = 0;

  const pass = async (pack: Pack | null, run: number): Promise<void> => {
    if (pack === null) {
      out.value = [];
      return;
    }
    const types = pack.stock().flatMap((entry) =>
      entry.type === null || pack.jsonError(entry.type) !== null ? [] : [{ id: entry.id, file: entry.type, value: pack.json(entry.type) }],
    );
    const found: Problem[] = [];
    let started = performance.now();
    for (const [i, type] of types.entries()) {
      found.push(...typeFloorProblems(type.id, type.file, type.value));
      if (i + 1 < types.length && performance.now() - started >= slice) {
        await yieldToPage();
        if (run !== generation) return;
        started = performance.now();
      }
    }
    if (run === generation) out.value = found;
  };

  const stop = effect(() => {
    void sources.revision.value;
    const pack = sources.pack.value;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const run = ++generation;
    if (pack !== lastPack) {
      lastPack = pack;
      untracked(() => void pass(pack, run));
    } else {
      timer = setTimeout(() => {
        timer = undefined;
        void pass(pack, run);
      }, delay);
    }
  });

  return Object.assign(out, {
    dispose(): void {
      stop();
      generation++;
      if (timer !== undefined) clearTimeout(timer);
    },
  });
}
