/**
 * The editor's shared state as signals, in one place (docs/proposals/editor.md §3.4).
 * Modules read the signals and subscribe to them; derived state (problems, floor pieces)
 * is `computed` in the module that owns it.
 *
 * Here: what the shell needs and the open pack with its journal, the schema and the
 * findings (M1), and the findings as the panels show them, checked with a delay (M2); the
 * open wagon and its model (M3). The preview's state is the preview's own
 * (preview/store). Signals only; what changes them is ./session.ts and ./openModel.ts.
 */

import { computed, signal } from '@preact/signals';
import { liveFindings } from '../checks/live';
import { checkPack } from '../checks/pack';
import type { Link, Problem } from '../core/contracts';
import type { Journal } from '../core/journal';
import type { Pack } from '../core/pack';
import type { Schema } from '../core/schema';
import type { LoadedModel } from '../core/contracts';

export { lang, setLang } from '../i18n';

/** 2a — the user's own pack in the RWAT format; 2b — an IR pack through a conversion recipe. */
export type EditorMode = '2a' | '2b';

export const EDITOR_MODES: readonly EditorMode[] = ['2a', '2b'];

/** What the editor works on: an RWAT pack (2a) or an IR conversion recipe (2b). */
export const mode = signal<EditorMode>('2a');

/** What is selected: written and shown by the tree, the view, the objects and checks tabs and the inspector. */
export const selection = signal<readonly Link[]>([]);

/**
 * Set when a new version of the site has been downloaded and waits (./pwa.ts): calling
 * it reloads the page into the new version. The editor never reloads by itself, so
 * unsaved work is not lost (§5.5).
 */
export const updateReady = signal<(() => void) | null>(null);

/** The open pack (null: none). The pack is mutable: read it together with {@link revision}. */
export const pack = signal<Pack | null>(null);

/** The journal of the open pack: every edit goes through its commands. */
export const journal = signal<Journal | null>(null);

/**
 * Grows with every change of the pack (a command, undo, redo, a save, opening another
 * pack). Anything derived from the mutable {@link pack} reads it, so it is recomputed.
 */
export const revision = signal(0);

/** The pack format's schema, loaded from the site (./session.ts `loadSchema`); null until then. */
export const schema = signal<Schema | null>(null);

/** Why the schema did not load, or null. */
export const schemaError = signal<string | null>(null);

/** The last failure of opening, saving or loading the schema, as text for the user; null when there is none. */
export const failure = signal<{ key: string; params: Record<string, string | number> } | null>(null);

/** The findings of the open pack as it stands now: the loader's and the schema's (the schema's join once it is loaded). */
export const problems = computed<Problem[]>(() => {
  void revision.value;
  const open = pack.value;
  return open === null ? [] : checkPack(open, schema.value);
});

/**
 * The open wagon (`<namespace>:<id>`): the one the selection points at, staying open while
 * it points elsewhere (./openModel.ts); null for none.
 */
export const openWagon = signal<string | null>(null);

/** The open wagon's model as the model worker read it (shown in the view, previewed); null while there is none. */
export const openModel = signal<LoadedModel | null>(null);

/** True while the open wagon's model is being read. */
export const modelLoading = signal(false);

/** The findings of reading the open model (a model that can't be read, a worker that failed). */
export const modelProblems = signal<Problem[]>([]);

/** The pack's findings, checked with a delay (checks/live.ts). */
const packFindings = liveFindings({ pack, schema, revision });

/**
 * The findings the panels show (checks tab, tree, inspector): {@link problems}, checked at
 * once when a pack opens or the schema arrives and 150 ms after the last of a run of edits
 * (checks/live.ts), so typing into a big pack's forms does not check it on every key; then
 * the open model's.
 */
export const findings = computed<Problem[]>(() => {
  const model = modelProblems.value;
  return model.length === 0 ? packFindings.value : [...packFindings.value, ...model];
});

/** The number of files saving would write or delete. */
export const dirtyCount = computed(() => {
  void revision.value;
  return pack.value?.dirtyPaths().length ?? 0;
});

export const canUndo = computed(() => {
  void revision.value;
  return journal.value?.canUndo ?? false;
});

export const canRedo = computed(() => {
  void revision.value;
  return journal.value?.canRedo ?? false;
});
