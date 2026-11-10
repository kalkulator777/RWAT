/**
 * @zip.js/zip.js, loaded on first use: the library is a chunk of its own, so the
 * editor's first screen does not pay for it (the budget of §3.11), and a page that
 * never opens or saves a zip never fetches it.
 *
 * Every call into the library passes `useWebWorkers: false`: compression and
 * decompression go through the browser's own `CompressionStream` (off the main thread
 * anyway), and no worker script has to be found, served and precached.
 */

type ZipJs = typeof import('@zip.js/zip.js');

let loading: Promise<ZipJs> | undefined;

/** The zip.js module. */
export function loadZipJs(): Promise<ZipJs> {
  loading ??= import('@zip.js/zip.js').catch((error: unknown) => {
    loading = undefined; // a chunk that failed to load (offline) is tried again next time
    throw error;
  });
  return loading;
}

/** Options for every reader and writer of this module. */
export const NO_WORKERS = { useWebWorkers: false } as const;
