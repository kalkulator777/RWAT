/**
 * The Python worker (docs/proposals/editor.md §3.11, §3.12): Pyodide with the pack tools,
 * off the main thread. Everything it does is ../ir/python.ts; started by ../ir/bridge.ts
 * `PythonBridge` on the first call, one for the page, stopped to cancel.
 *
 * Pyodide is loaded from the site itself (`pyodide/<version>/`, copied there by the build,
 * vite.config.ts), never from a CDN: the bridge gives the folder's address. Its script is
 * imported from there at run time, not bundled. The progress counts the bytes of the files
 * fetched from that folder (the interpreter and the standard library) against their sizes.
 */

import { expose } from 'comlink';
import type { LoadProgress, StartOptions } from '../ir/bridge';
import { createPythonApi } from '../ir/python';

/** `fetch`, counting what comes from `folder` into `onBytes`, until the returned function puts the old one back. */
function countFetches(folder: string, onBytes: (bytes: number) => void): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await original(input, init);
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(folder) || response.body === null) return response;
    const counted = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          onBytes(chunk.byteLength);
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  return () => {
    globalThis.fetch = original;
  };
}

async function loadFromSite(options: StartOptions, onProgress: (progress: LoadProgress) => void) {
  const folder = options.indexURL;
  if (folder === undefined) throw new Error('no address of Pyodide given');
  // the scripts (*.mjs) are imported, not fetched: only the other files are counted
  const total = Object.entries(options.sizes ?? {})
    .filter(([name]) => !name.endsWith('.mjs'))
    .reduce((sum, [, size]) => sum + size, 0);
  let loaded = 0;
  onProgress({ stage: 'download', loaded, total });
  const restore = countFetches(folder, (bytes) => {
    loaded += bytes;
    onProgress({ stage: 'download', loaded, total });
  });
  try {
    const { loadPyodide } = (await import(/* @vite-ignore */ `${folder}pyodide.mjs`)) as typeof import('pyodide');
    return await loadPyodide({ indexURL: folder, checkAPIVersion: true });
  } finally {
    restore();
  }
}

expose(createPythonApi(loadFromSite));
