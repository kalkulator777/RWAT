/**
 * The state of «Переименовать и переписать ссылки» in the checks tab (docs/proposals/editor.md
 * §2.1, M6): the plan worked out and shown (./rename.ts `planRename`; no Python), then, on
 * «Применить», the converter's `rewrite_references` (through the bridge, so Pyodide loads only
 * now, and only when an OBJ or an MTL has a line to rewrite) and one command of the journal.
 *
 * The pack may change between the plan and the button: the plan is worked out again and shown
 * again, nothing is applied from a plan that is not the pack's now.
 */

import { signal, type ReadonlySignal } from '@preact/signals';
import type { Command } from '../../core/contracts';
import type { Pack } from '../../core/pack';
import { suggestBridge, type SuggestBridge } from './bridge';
import { explain, type Said } from './failure';
import { planRename, referenceCount, renameCommand, type RenamePlan } from './rename';
import { runWithProgress, type Running } from './run';

/** What the repair reads of the pack. */
export type RepairPack = Pick<Pack, 'paths' | 'has' | 'json' | 'text' | 'bytes' | 'version'>;

/** Applies a command that renames and puts files (app/session `run`); false when it was refused. */
export type RunCommand = (command: Command) => Promise<boolean>;

/** Where the repair stands. */
export type RepairState =
  | { readonly phase: 'idle' }
  /** The plan is shown; `changed`: the pack changed since the last one the author saw, so this is a new list. */
  | { readonly phase: 'plan'; readonly plan: RenamePlan; readonly changed: boolean }
  | { readonly phase: 'done'; readonly files: number; readonly refs: number }
  | { readonly phase: 'failed'; readonly said: Said };

/** The repair of one tab. */
export interface Repair {
  readonly state: ReadonlySignal<RepairState>;
  /** The call to the converter under way, or null. */
  readonly running: ReadonlySignal<Running | null>;
  /** Works out and shows what renaming would do. */
  review(pack: RepairPack): Promise<void>;
  /** Does the plan shown. Returns whether it was done. */
  apply(pack: RepairPack): Promise<boolean>;
  /** Stops the call under way. */
  cancel(): void;
  /** Closes the plan or the report. */
  dismiss(): void;
}

/** @param bridge the Python bridge ({@link suggestBridge} when left out) */
export function createRepair(run: RunCommand, bridge: () => SuggestBridge = suggestBridge): Repair {
  const state = signal<RepairState>({ phase: 'idle' });
  const running = signal<Running | null>(null);

  /** A failure shown; a call the author stopped leaves the plan as it was. */
  const failed = (error: unknown): void => {
    const said = explain(error);
    if (said !== null) state.value = { phase: 'failed', said };
  };

  const repair: Repair = {
    state,
    running,
    async review(pack) {
      try {
        state.value = { phase: 'plan', plan: await planRename(pack), changed: false };
      } catch (error) {
        failed(error);
      }
    },
    async apply(pack) {
      const now = state.peek();
      if (now.phase !== 'plan' || running.peek() !== null) return false;
      try {
        if (now.plan.version !== pack.version) {
          state.value = { phase: 'plan', plan: await planRename(pack), changed: true };
          return false;
        }
        const plan = now.plan;
        const rewritten = new Map<string, Uint8Array>();
        if (plan.texts.length > 0) {
          await runWithProgress(bridge(), running, async (signal) => {
            for (const text of plan.texts) {
              const out = await bridge().rewriteReferences(await pack.bytes(text.file), text.keyword, text.moved, { signal });
              if (out !== null) rewritten.set(text.file, out);
            }
          });
        }
        if (pack.version !== plan.version) {
          state.value = { phase: 'plan', plan: await planRename(pack), changed: true };
          return false;
        }
        const command = renameCommand(plan, rewritten);
        if (!(await run(command))) return false;
        state.value = { phase: 'done', files: plan.renames.length, refs: referenceCount(plan) };
        return true;
      } catch (error) {
        failed(error);
        return false;
      }
    },
    cancel() {
      running.peek()?.cancel();
    },
    dismiss() {
      state.value = { phase: 'idle' };
    },
  };
  return repair;
}
