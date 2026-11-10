/**
 * The doors tool, «Двери» (docs/proposals/editor.md §2.3, §3.9): a wagon type's doors made
 * of the box around objects of the model, their boxes moved and stretched in the views
 * from the top, the side and the front, their ids, flags, groups, numbers and order in the
 * inspector, and over them what the engine makes of each — its wall and way out, its inner
 * face, where a rider walks through it, an inner door's bridge, the leaves it moves — by
 * the ports of the engine's rules, after every edit. «Двери по именам» asks the converter
 * for the doors the model's object names say, as a draft to take or leave
 * (tools/suggest/doors.ts).
 */

import { h } from 'preact';
import { defineTool, type ToolSession } from '../registry';
import { DoorsInspector } from './DoorsInspector';
import { startDoors, type DoorsTool } from './session';

/** The doors tool's session: with its state, which the inspector's section drives (and the tests). */
export interface DoorsSession extends ToolSession {
  readonly tool: DoorsTool;
}

export default defineTool({
  id: 'doors',
  order: 20,
  title: 'tools.doors.title',
  hint: 'tools.doors.hint',
  fields: ['/doors/*'],
  activate(context): DoorsSession {
    const { tool, dispose } = startDoors(context);
    return { tool, Inspector: () => h(DoorsInspector, { tool }), dispose };
  },
});
