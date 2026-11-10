/**
 * The page's IR session as signals (editor.md §3.4, §6.1; 2b): the session open, the type
 * open in it, the long work under way (Pyodide loading, `derive`, a conversion) with its
 * progress, the converter's log, the dialogs, and the session's findings. What changes
 * them is ./actions.ts; the rules are ./session.ts and ir/recipe's.
 */

import { computed, signal } from '@preact/signals';
import type { Problem } from '../../core/contracts';
import type { ConvertResult, LoadProgress } from '../../ir/bridge';
import { schema } from '../store';
import type { IrSession } from './session';

/** The IR session open (2b); null for none. */
export const irSession = signal<IrSession | null>(null);

/** The type open in the session: the one the 3D view shows and the inspector edits; null for none. */
export const irOpenType = signal<string | null>(null);

/** Long work of the session under way. */
export interface IrTask {
  /** `import`: opening and deriving; `derive`: deriving again; `convert`: "Готовый пак для себя". */
  readonly kind: 'import' | 'derive' | 'convert';
  /** The loading of Pyodide by the worker doing it. */
  readonly progress: LoadProgress;
  /** The converter's lines heard so far, and the last of them. */
  readonly lines: number;
  readonly last: string;
  /** When it began (performance.now()). */
  readonly started: number;
  /** Stops it (the worker doing it is stopped). */
  cancel(): void;
}

export const irTask = signal<IrTask | null>(null);

/** What the converter printed, line by line, since the session was opened (the "Лог" tab), the newest last. */
export const irLog = signal<readonly string[]>([]);

/** At most so many lines are kept in the log: a conversion of a big pack prints a few hundred. */
export const LOG_LINES = 5000;

/** Whether the 3D view draws the type's generated floor over the model. */
export const irShowFloor = signal(true);

/** The dialog of the IR mode open: the import, the save, the export of the recipe, the pack for oneself; null for none. */
export type IrDialog = 'import' | 'save' | 'export' | 'pack';

export const irDialog = signal<IrDialog | null>(null);

/** The last "Готовый пак для себя": what the converter said, how long it took, where the pack went. */
export interface IrConversion {
  readonly result: ConvertResult;
  readonly ms: number;
  /** The zip's name or the folder's, as handed over; null when nothing was written (a refusal). */
  readonly written: string | null;
}

export const irConversion = signal<IrConversion | null>(null);

/** The session's findings (./session.ts `problems`), as the session and the schema stand. */
export const irFindings = computed<Problem[]>(() => {
  const session = irSession.value;
  if (session === null) return [];
  void session.revision.value;
  return session.problems(schema.value);
});

/** The number of the session's files a save writes (new, changed, deleted). */
export const irDirtyCount = computed(() => {
  const session = irSession.value;
  if (session === null) return 0;
  void session.revision.value;
  return session.workspace.dirtyPaths().length;
});
