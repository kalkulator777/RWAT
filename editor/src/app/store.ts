/**
 * The editor's shared state as signals, in one place (docs/proposals/editor.md §3.4).
 * Modules read the signals and subscribe to them; derived state (problems, floor pieces)
 * is `computed` in the module that owns it.
 *
 * The skeleton holds what the shell itself needs. The open pack and its journal, the
 * open model and the preview state join here when their modules are wired in (by the
 * conductor or the agent it names: this file is app/).
 */

import { signal } from '@preact/signals';
import type { Link } from '../core/contracts';

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
