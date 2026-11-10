/**
 * The hinges tool, «Шарниры» (docs/proposals/editor.md §2.4, §3.9): it only shows the
 * open model's cab controls as the engine moves them — the hinge marker of each, and for
 * the one chosen its signed axis, the arc of its `ROT_<deg>` travel, its `TL` slide and
 * the end of its travel as a ghost. It edits no field.
 */

import { h } from 'preact';
import { defineTool, type ToolSession } from '../registry';
import { PivotsInspector } from './PivotsInspector';
import { startPivots, type PivotsTool } from './session';

/** The hinges tool's session: with its state, which the inspector's section drives (and the tests). */
export interface PivotsSession extends ToolSession {
  readonly tool: PivotsTool;
}

export default defineTool({
  id: 'pivots',
  order: 50,
  title: 'tools.pivots.title',
  hint: 'tools.pivots.hint',
  fields: [],
  activate(context): PivotsSession {
    const { tool, dispose } = startPivots(context);
    return { tool, Inspector: () => h(PivotsInspector, { tool }), dispose };
  },
});
