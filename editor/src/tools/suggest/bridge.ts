/**
 * Where the suggestions get their Python (docs/proposals/editor.md §3.9, §3.12): the page's
 * bridge to `tools/floorgen.py` and `tools/ir2rwat.py` in Pyodide (../../ir/bridge.ts).
 * It is asked for when a suggestion is asked for, never earlier: the bridge's client is
 * imported with the first call (so it stays out of the page's first script, as the site's
 * start asks), and the bridge itself loads Pyodide (about 13 MB) with its first call — so
 * opening a tool starts nothing.
 *
 * Tests give their own ({@link useSuggestBridge}): the real Python in Node, or a stand-in.
 */

import type { LoadProgress, PythonBridge } from '../../ir/bridge';

/** What the suggestions use of the bridge: the three calls, and the progress of the loading. */
export type SuggestBridge = Pick<PythonBridge, 'suggestFloor' | 'modelDoors' | 'rewriteReferences' | 'progress' | 'onProgress'>;

const IDLE: LoadProgress = { stage: 'idle', loaded: 0, total: 0 };

/**
 * The page's bridge ({@link pythonBridge}) as the suggestions see it, its module imported by
 * the first call. The progress listeners given before it is there hear it once it is.
 */
function lazyPageBridge(): SuggestBridge {
  let loaded: PythonBridge | null = null;
  let loading: Promise<PythonBridge> | null = null;
  const listeners = new Set<(progress: LoadProgress) => void>();
  const load = (): Promise<PythonBridge> =>
    (loading ??= import('../../ir/bridge').then(({ pythonBridge }) => {
      const bridge = pythonBridge();
      bridge.onProgress((progress) => {
        for (const listener of listeners) listener(progress);
      });
      loaded = bridge;
      return bridge;
    }));
  return {
    get progress() {
      return loaded?.progress ?? IDLE;
    },
    onProgress(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    suggestFloor: async (obj, options, doors, call) => (await load()).suggestFloor(obj, options, doors, call),
    modelDoors: async (obj, animated, call) => (await load()).modelDoors(obj, animated, call),
    rewriteReferences: async (raw, keyword, moved, call) => (await load()).rewriteReferences(raw, keyword, moved, call),
  };
}

let given: SuggestBridge | null = null;
let page: SuggestBridge | null = null;

/** The bridge the suggestions call: the page's, unless a test gave another. */
export function suggestBridge(): SuggestBridge {
  return given ?? (page ??= lazyPageBridge());
}

/** Makes the suggestions call `bridge` (a test's); null gives the page's back. */
export function useSuggestBridge(bridge: SuggestBridge | null): void {
  given = bridge;
}
