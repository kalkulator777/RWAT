/**
 * Where the suggestions get their Python (docs/proposals/editor.md §3.9, §3.12): the page's
 * bridge to `tools/floorgen.py` and `tools/ir2rwat.py` in Pyodide (../../ir/bridge.ts).
 * It is asked for when a suggestion is asked for, never earlier — the bridge itself loads
 * Pyodide (about 13 MB) with its first call — so opening a tool starts nothing.
 *
 * Tests give their own ({@link useSuggestBridge}): the real Python in Node, or a stand-in.
 */

import { pythonBridge, type PythonBridge } from '../../ir/bridge';

/** What the suggestions use of the bridge: the three calls, and the progress of the loading. */
export type SuggestBridge = Pick<PythonBridge, 'suggestFloor' | 'modelDoors' | 'rewriteReferences' | 'progress' | 'onProgress'>;

let given: SuggestBridge | null = null;

/** The bridge the suggestions call: the page's, unless a test gave another. */
export function suggestBridge(): SuggestBridge {
  return given ?? pythonBridge();
}

/** Makes the suggestions call `bridge` (a test's); null gives the page's back. */
export function useSuggestBridge(bridge: SuggestBridge | null): void {
  given = bridge;
}
