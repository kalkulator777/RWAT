/**
 * The markup tools of the editor (docs/proposals/editor.md §3.9): every folder
 * `src/tools/<name>/` with an `index.ts` (see ./registry.ts), and the one that is on.
 * The shell connects {@link toolHost} to its state (app/start.ts); the view's bar and the
 * inspector show it (./ToolBar.tsx).
 */

import { collectTools, ToolHost, type ToolModule } from './registry';

/** Every tool, in the tool bar's order. */
export const tools = collectTools(import.meta.glob<ToolModule>('./*/index.ts', { eager: true }));

/** The editor's tools and the one that is on. */
export const toolHost = new ToolHost(tools);
