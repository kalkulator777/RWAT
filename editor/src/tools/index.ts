/**
 * The markup tools of the editor (docs/proposals/editor.md §3.9): every folder
 * `src/tools/<name>/` with an `index.ts` (see ./registry.ts).
 */

import { collectTools, type ToolModule } from './registry';

/** Every tool, in the tool bar's order. */
export const tools = collectTools(import.meta.glob<ToolModule>('./*/index.ts', { eager: true }));
