/**
 * Listening from the tab (docs/proposals/editor.md §2.4 item 4): reads a pack's Ogg files
 * and hands them to the page's audition (audio/audition.ts). A sound event of the game or of
 * a `sounds.json` cannot be played — the editor has no game assets — and a missing or
 * unreadable file says so; neither throws, the reason goes to {@link listenError} for the
 * tab to show. Everything here runs from a click, which is the user gesture WebAudio wants.
 */

import { signal } from '@preact/signals';
import { audition, AuditionError } from '../../audio/audition';
import type { Levels } from '../../audio/levels';
import { parseRef } from '../../audio/ref';
import type { Pack } from '../../core/pack';
import type { LoopDecl } from './model';

/** Why the last sound did not play, as an i18n key and its params; null when it did. */
export const listenError = signal<{ key: string; params: Record<string, string> } | null>(null);

/** The pack file of a reference, or the reason it cannot be played (set into {@link listenError}). */
function fileOf(pack: Pack, ref: string, declaring: string): string | null {
  const parsed = parseRef(ref, declaring);
  if (parsed.file === null) {
    listenError.value = { key: 'sounds.error.event', params: { ref } };
    return null;
  }
  if (!pack.has(parsed.file)) {
    listenError.value = { key: 'sounds.error.missing', params: { file: parsed.file } };
    return null;
  }
  return parsed.file;
}

function failed(error: unknown, file: string): void {
  if (error instanceof AuditionError) {
    listenError.value = { key: error.code === 'unsupported' ? 'sounds.error.unsupported' : 'sounds.error.decode', params: { file, detail: error.message } };
  } else {
    listenError.value = { key: 'sounds.error.decode', params: { file, detail: error instanceof Error ? error.message : String(error) } };
  }
}

/** Plays a file of the pack once, as the game plays a one-shot (a door, a joint, a lever). */
export async function playRef(pack: Pack, ref: string, declaring: string, levels: Levels): Promise<void> {
  listenError.value = null;
  const file = fileOf(pack, ref, declaring);
  if (file === null) return;
  try {
    await audition.playOnce(file, await pack.bytes(file), levels);
  } catch (error) {
    failed(error, file);
  }
}

/**
 * Starts a loop: its lead-in once (when it is a file of the pack), then the loop, as the
 * engine does. `main` has to be a file; a `start` or `stop` that is an event or missing is
 * left out (the game would play it, the editor cannot). A signal repeats its one file.
 */
export async function playLoopOf(pack: Pack, id: string, decl: LoopDecl, declaring: string, levels: Levels, signalLoop: boolean): Promise<void> {
  listenError.value = null;
  if (decl.main === undefined) return;
  const main = fileOf(pack, decl.main, declaring);
  if (main === null) return;
  const optional = async (ref: string | undefined): Promise<{ key: string; bytes: Uint8Array } | null> => {
    const parsed = ref === undefined ? null : parseRef(ref, declaring);
    if (parsed?.file == null || !pack.has(parsed.file)) return null;
    return { key: parsed.file, bytes: await pack.bytes(parsed.file) };
  };
  try {
    const [start, stop] = await Promise.all([optional(decl.start), optional(decl.stop)]);
    await audition.playLoop(
      id,
      { main, ...(start && { start: start.key }), ...(stop && { stop: stop.key }) },
      { main: await pack.bytes(main), ...(start && { start: start.bytes }), ...(stop && { stop: stop.bytes }) },
      levels,
      signalLoop,
    );
  } catch (error) {
    failed(error, main);
  }
}

/** Stops everything the tab started (the pack closes, another wagon opens, the tab is left). */
export function stopListening(): void {
  audition.stopAll();
  listenError.value = null;
}
