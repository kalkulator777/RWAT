/**
 * A call of the Python tools under way, as the interface shows it: how far Pyodide's
 * loading is (the first call of a page waits for about 13 MB), and a way to stop it. One
 * helper for the three suggestions, so each shows the same progress and the same cancel.
 *
 * Stopping is the bridge's: an aborted signal stops its worker (Pyodide can't be
 * interrupted otherwise), and the call fails as `cancelled`.
 */

import { signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type { LoadProgress } from '../../ir/bridge';
import type { SuggestBridge } from './bridge';

/** A call under way. */
export interface Running {
  /** The loading of Pyodide and the tools: `idle` → `download` → `start` → `ready` (then the work itself). */
  readonly progress: ReadonlySignal<LoadProgress>;
  /** Stops the call: it fails as `cancelled`. */
  cancel(): void;
}

/**
 * Runs `work` with a {@link Running} put in `slot` while it lasts (null before and after).
 * `work` hands the signal on to the bridge's call.
 */
export async function runWithProgress<T>(bridge: SuggestBridge, slot: Signal<Running | null>, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const abort = new AbortController();
  const progress = signal<LoadProgress>(bridge.progress);
  const stop = bridge.onProgress((next) => {
    progress.value = next;
  });
  slot.value = { progress, cancel: () => abort.abort() };
  try {
    return await work(abort.signal);
  } finally {
    stop();
    slot.value = null;
  }
}
