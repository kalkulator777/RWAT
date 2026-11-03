/**
 * The two ways `ExamplePackLoadTest` breaks the example pack's markup that no check sees —
 * the engine's `FloorCheck` neither (checks/floor/examplePackBreaks.test.ts holds that) —
 * are seen in the markup tools' overlays (docs/proposals/editor.md M4: "эти две показаны
 * наложением"): the arch moved off the aisle, by the doors tool's bridge of it, drawn in
 * the warning colour where it meets the floor on one side only; the second chair turned to
 * face forward, by the chairs tool's arrows, which all point forward — the pink arrow of a
 * chair driving backward is gone. Each break is drawn from the type file as the break makes
 * it, against the type as it is.
 */

import { describe, expect, it } from 'vitest';
import type { OverlayShape } from '../core/contracts';
import { BREAKS, brokenType, COACH, SHUNTER, type Break } from '../checks/floor/examplePackBreaks.node';
import { exampleModel } from '../model/testing.node';
import { loadWagonType } from '../ports/wagonType';
import { doorsPicture } from './doors/analysis';
import { analysePlaces, BACK_STYLE, FORWARD_STYLE, seatsPicture } from './seats/analysis';

const IDS: Record<string, string> = { [COACH]: 'rwat_example:coach', [SHUNTER]: 'rwat_example:shunter' };
const coachModel = await exampleModel('coach');

const styles = (shapes: readonly OverlayShape[]): string[] => shapes.map((s) => s.style);

/** The styles of the overlay layer a break is to be seen in, for type `file` as `json` has it. */
function layer(shown: NonNullable<Break['shown']>, file: string, json: unknown): string[] {
  const id = IDS[file] as string;
  const type = loadWagonType(id, json).type;
  if (shown === 'doors.bridge') return styles(doorsPicture(id, json, type, coachModel).layers['doors.bridges']);
  return styles(seatsPicture(id, analysePlaces(json, type), []).layers['seats.facing']);
}

const unchecked = Object.entries(BREAKS).filter(([, b]) => b.caught === null);

describe('the breaks of ExamplePackLoadTest no check sees, in the markup tools’ overlays', () => {
  it('are the two the plan names, each with the overlay to see it in', () => {
    expect(unchecked.map(([name, b]) => [name, b.shown])).toEqual([
      ['salon_arch a block aside, off the aisle', 'doors.bridge'],
      ['the second chair facing forward', 'seats.facing'],
    ]);
  });

  it('the arch off the aisle: its bridge meets the floor on one side only, in the warning colour', () => {
    const { file, change } = BREAKS['salon_arch a block aside, off the aisle'] as Break;
    expect(layer('doors.bridge', file, brokenType(file, () => undefined))).not.toContain('warning');
    expect(layer('doors.bridge', file, brokenType(file, change))).toContain('warning');
  });

  it('the second chair facing forward: no arrow drives backward', () => {
    const { file, change } = BREAKS['the second chair facing forward'] as Break;
    expect(layer('seats.facing', file, brokenType(file, () => undefined))).toEqual([FORWARD_STYLE, BACK_STYLE]);
    expect(layer('seats.facing', file, brokenType(file, change))).toEqual([FORWARD_STYLE, FORWARD_STYLE]);
  });
});
