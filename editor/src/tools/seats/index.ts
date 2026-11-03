/**
 * The chairs tool, «Кресла» (docs/proposals/editor.md §2.3, §3.9): the wagon type's
 * driver's chairs (`cab.seats`) placed by a click on a cushion, moved on the plan, turned
 * on a dial and typed in the inspector; over them which way each drives, the reach one
 * sits down from, the floor and the band of cushion heights, and the cab each is in — the
 * engine's floor check and cab finder, by their ports, after every edit. A chair finding
 * clicked in the checks turns the tool on (`ToolHost.reveal`: its place `/cab/seats/<i>`,
 * `/cab/seats` or `/cab` holds the tool's fields).
 *
 * The tool goes through kinds of place (./places.ts): the passengers' seats and berths of
 * phase 5 are to be another kind, not another tool.
 */

import { h } from 'preact';
import { defineTool, type ToolSession } from '../registry';
import { SeatsInspector } from './SeatsInspector';
import { startSeats, type SeatsTool } from './session';

/** The chairs tool's session: with its state, which the inspector's section drives (and the tests). */
export interface SeatsSession extends ToolSession {
  readonly tool: SeatsTool;
}

export default defineTool({
  id: 'seats',
  order: 30,
  title: 'tools.seats.title',
  hint: 'tools.seats.hint',
  // the whole chair (its yaw too), and the old one-chair form, which the first edit turns into the list
  fields: ['/cab/seats/*', '/cab/seat'],
  activate(context): SeatsSession {
    const { tool, dispose } = startSeats(context);
    return { tool, Inspector: () => h(SeatsInspector, { tool }), dispose };
  },
});
