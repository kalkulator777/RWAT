/**
 * The floor tool, «Зоны» (docs/proposals/editor.md §2.3, §3.9): the wagon type's floor
 * zones drawn, moved, stretched and removed on the view from the top, their numbers and
 * order in the inspector, and over them where a player stands, walks out and drives —
 * the engine's floor logic, by its ports, after every edit. For a type with no floor, or a
 * poor one, «Предложить пол» asks the converter's floor generator for a draft from the model
 * (tools/suggest/floor.ts), taken or left in one step.
 */

import { h } from 'preact';
import { defineTool, type ToolSession } from '../registry';
import { FloorInspector } from './FloorInspector';
import { startFloor, type FloorTool } from './session';

/** The floor tool's session: with its state, which the inspector's section drives (and the tests). */
export interface FloorSession extends ToolSession {
  readonly tool: FloorTool;
}

export default defineTool({
  id: 'floor',
  order: 10,
  title: 'tools.floor.title',
  hint: 'tools.floor.hint',
  fields: ['/interior', '/interior/*'],
  activate(context): FloorSession {
    const { tool, dispose } = startFloor(context);
    return { tool, Inspector: () => h(FloorInspector, { tool }), dispose };
  },
});
