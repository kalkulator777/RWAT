/**
 * A kept session made live again (editor.md M5): the pack opened from its base as it was
 * when the session began, the journal's commands applied again in order, undo and redo as
 * they were, and the save point where it was.
 *
 * - The commands applied (committed and done) and then the undone ones in redo order are
 *   run, and the undone ones undone again: the journal ends with the same commands to undo
 *   and to redo, its depth deciding again which are committed.
 * - **A copy** (a zip, a pack the editor made: the base never changes) — the pack takes the
 *   state at the save point as its saved state when the replay passes it, as the save did;
 *   with no save point to reach, what differs from the base is what is unsaved.
 * - **A folder** (its files are what the saves wrote) — every file a save wrote or deleted
 *   takes what the folder holds now as its saved state (`Pack.rebase`), whatever the save
 *   point: the folder is the truth of what was saved, also after a save that failed halfway.
 */

import type { PackSink, PackSource } from '../contracts';
import { Journal, type JournalState } from '../journal/journal';
import { Pack } from '../pack/pack';

export interface ReplayOptions {
  /** The journal's save point as kept; null: none to reach. */
  savePoint: number | null;
  /** The undo depth of the journal (the default's when left out). */
  depth?: number;
  /**
   * A folder: the pack paths a save wrote or deleted, and what the folder holds at each
   * now (null: no file). Left out for a copy.
   */
  folder?: { paths: readonly string[]; read: (path: string) => Promise<Uint8Array | null> };
}

/** A sink that writes nothing: saving into it only takes the pack as it stands as its saved state. */
const NOWHERE: PackSink = { write: () => Promise.resolve() };

/** Opens the pack from the source and replays the journal (see the module's comment). Rejects as the opening or a command does. */
export async function replaySession(source: PackSource, state: JournalState, options: ReplayOptions): Promise<{ pack: Pack; journal: Journal }> {
  const pack = await Pack.open(source);
  const journal = new Journal(pack, options.depth === undefined ? {} : { depth: options.depth });
  const redo = [...state.undone].reverse();
  const commands = [...state.committed, ...state.done, ...redo];
  const savePoint = options.savePoint !== null && options.savePoint <= commands.length ? options.savePoint : null;
  const reach = async (): Promise<void> => {
    if (options.folder === undefined) await pack.save(NOWHERE);
    journal.markSaved();
  };
  if (savePoint === 0) await reach();
  for (const [i, command] of commands.entries()) {
    await journal.run(command);
    journal.endCoalescing();
    if (i + 1 === savePoint) await reach();
  }
  for (let i = 0; i < redo.length; i++) journal.undo();
  if (options.folder !== undefined) {
    for (const path of options.folder.paths) await pack.rebase(path, await options.folder.read(path));
  }
  return { pack, journal };
}
