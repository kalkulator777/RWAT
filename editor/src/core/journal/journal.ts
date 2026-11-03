/**
 * The journal of edits (editor.md §3.4–3.5): the pack changes only through commands
 * dispatched here, so undo, redo, the autosave of the session and the replay tests are
 * one mechanism.
 *
 * - A command is applied whole or not at all: when one of its ops fails, the ops before
 *   it are undone and the error goes to the caller.
 * - Undo applies the inverse ops the target gave for the command; redo applies the
 *   command again. Undo keeps {@link JOURNAL_DEPTH} commands; older ones stay in the
 *   journal as committed (they are part of what replays the session) but cannot be undone.
 * - Commands with the same `coalesceKey` that follow each other merge into one entry
 *   (a drag until the mouse is released, {@link Journal.endCoalescing}). A `set` of a
 *   place the entry already set replaces that op instead of adding one, so a long drag
 *   stays one op per handle.
 * - A new command clears what could be redone.
 *
 * The journal knows nothing about packs: it drives an {@link OpTarget} (the pack model).
 * Selection and preview are not edits and are not journaled.
 */

import type { Command, Op, OpTarget } from '../contracts';

export type { OpTarget };

/** The default number of commands undo goes back (§3.5). */
export const JOURNAL_DEPTH = 500;

/** One undoable entry: the command (merged, if it coalesced) and the ops that undo it. */
interface Entry {
  command: Command;
  inverse: Op[];
}

/** What the journal holds, oldest first: the form it is saved and restored in (./serialize.ts). */
export interface JournalState {
  /** Applied and no longer undoable (fell off the undo depth). */
  committed: Command[];
  /** Applied and undoable. */
  done: Command[];
  /** Undone and redoable, the next one to redo last. */
  undone: Command[];
}

function opFiles(op: Op): string[] {
  return op.op === 'renameFile' ? [op.file, op.to] : [op.file];
}

/** True when two ops may touch the same data: one file, and for JSON ops one place inside the other. */
function overlaps(a: Op, b: Op): boolean {
  const filesOfA = opFiles(a);
  if (!opFiles(b).some((file) => filesOfA.includes(file))) return false;
  if (!('at' in a) || !('at' in b)) return true;
  return a.at === b.at || a.at === '' || b.at === '' || a.at.startsWith(`${b.at}/`) || b.at.startsWith(`${a.at}/`);
}

export class Journal {
  private readonly committedList: Command[] = [];
  private readonly doneList: Entry[] = [];
  private readonly undoneList: Command[] = [];
  private coalescing: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly depth: number;

  constructor(
    private readonly target: OpTarget,
    options: { depth?: number } = {},
  ) {
    this.depth = options.depth ?? JOURNAL_DEPTH;
  }

  /**
   * Applies the ops in order and returns each one's inverse (in the order of the ops);
   * on a failure undoes what was applied and rethrows.
   */
  private applyEach(ops: readonly Op[]): Op[][] {
    const inverses: Op[][] = [];
    try {
      for (const op of ops) inverses.push(this.target.apply(op));
    } catch (error) {
      for (const inverse of inverses.reverse()) for (const op of inverse) this.target.apply(op);
      throw error;
    }
    return inverses;
  }

  /** Applies the ops and returns what undoes them all: each op's inverse, the last op's first. */
  private applyAll(ops: readonly Op[]): Op[] {
    return this.applyEach(ops).reverse().flat();
  }

  /** Applies a command and records it (merging it into the last entry when it coalesces). An empty command changes nothing and is not recorded. */
  dispatch(command: Command): void {
    if (command.ops.length === 0) return;
    const inverses = this.applyEach(command.ops);
    this.undoneList.length = 0;
    const last = this.doneList[this.doneList.length - 1];
    if (last !== undefined && command.coalesceKey !== undefined && command.coalesceKey === this.coalescing) {
      this.merge(last, command, inverses);
    } else {
      this.doneList.push({ command: { ...command, ops: [...command.ops] }, inverse: inverses.reverse().flat() });
      const dropped = this.doneList.length > this.depth ? this.doneList.shift() : undefined;
      if (dropped !== undefined) this.committedList.push(dropped.command);
    }
    this.coalescing = command.coalesceKey ?? null;
    this.notify();
  }

  /** {@link OpTarget.prepare} (reading what the inverse needs), then {@link dispatch}. */
  async run(command: Command): Promise<void> {
    await this.target.prepare?.(command.ops);
    this.dispatch(command);
  }

  /**
   * Merges a command into the entry before it. A `set` of the place the entry set last
   * (no op of the entry touches that place after it) replaces that op: the entry's
   * inverse already restores what the place held before the entry, so the new set needs
   * no inverse of its own, and it commutes with the ops between. Any other op is added,
   * its inverse put before the entry's.
   */
  private merge(entry: Entry, command: Command, inverses: Op[][]): void {
    const ops = [...entry.command.ops];
    const kept: Op[][] = [];
    command.ops.forEach((op, i) => {
      const earlier = op.op === 'set' ? ops.findLastIndex((other) => overlaps(other, op)) : -1;
      const same = ops[earlier];
      if (same?.op === 'set' && op.op === 'set' && same.file === op.file && same.at === op.at) {
        ops[earlier] = op;
      } else {
        ops.push(op);
        kept.push(inverses[i] as Op[]);
      }
    });
    entry.command = { ...command, ops };
    entry.inverse = [...kept.reverse().flat(), ...entry.inverse];
  }

  /** Undoes the last entry; returns its command, or null when there is nothing to undo. */
  undo(): Command | null {
    const entry = this.doneList[this.doneList.length - 1];
    if (entry === undefined) return null;
    this.applyAll(entry.inverse);
    this.doneList.pop();
    this.undoneList.push(entry.command);
    this.coalescing = null;
    this.notify();
    return entry.command;
  }

  /** Applies the last undone command again; returns it, or null when there is nothing to redo. */
  redo(): Command | null {
    const command = this.undoneList[this.undoneList.length - 1];
    if (command === undefined) return null;
    const inverse = this.applyAll(command.ops);
    this.undoneList.pop();
    this.doneList.push({ command, inverse });
    this.coalescing = null;
    this.notify();
    return command;
  }

  get canUndo(): boolean {
    return this.doneList.length > 0;
  }

  get canRedo(): boolean {
    return this.undoneList.length > 0;
  }

  /** Ends the current drag: the next command starts an entry of its own even with the same key. */
  endCoalescing(): void {
    this.coalescing = null;
  }

  /** The commands as they stand, oldest first (see {@link JournalState}). */
  state(): JournalState {
    return {
      committed: [...this.committedList],
      done: this.doneList.map((entry) => entry.command),
      undone: [...this.undoneList],
    };
  }

  /**
   * Replays a saved journal on a target that holds the pack as it was opened: the
   * committed and done commands are applied (only the done ones can be undone), the
   * undone ones wait for redo.
   */
  static async restore(target: OpTarget, state: JournalState, options: { depth?: number } = {}): Promise<Journal> {
    const journal = new Journal(target, options);
    for (const command of state.committed) {
      await target.prepare?.(command.ops);
      journal.applyAll(command.ops);
      journal.committedList.push(command);
    }
    for (const command of state.done) {
      await journal.run(command);
      journal.endCoalescing();
    }
    journal.undoneList.push(...state.undone);
    journal.notify();
    return journal;
  }

  /** Calls the listener after every change (dispatch, undo, redo, restore); returns the function that removes it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
