/**
 * The lights tool, «Свет» (docs/proposals/editor.md §2.4, §3.9): it only shows the open
 * model's headlights (a cone the way each shines — by the half of the model its lens is in
 * — and its colour), its cabin lamps and its light groups, the chosen group's lights in a
 * colour of their own. It edits no field.
 */

import { h } from 'preact';
import { defineTool, type ToolSession } from '../registry';
import { LightsInspector } from './LightsInspector';
import { startLights, type LightsTool } from './session';

/** The lights tool's session: with its state, which the inspector's section drives (and the tests). */
export interface LightsSession extends ToolSession {
  readonly tool: LightsTool;
}

export default defineTool({
  id: 'lights',
  order: 40,
  title: 'tools.lights.title',
  hint: 'tools.lights.hint',
  fields: [],
  activate(context): LightsSession {
    const { tool, dispose } = startLights(context);
    return { tool, Inspector: () => h(LightsInspector, { tool }), dispose };
  },
});
