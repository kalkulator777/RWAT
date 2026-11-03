/**
 * Every way `ExamplePackLoadTest` breaks the example pack's markup (`coachBreaks`,
 * `shunterBreaks`, `coachLeafBreaks`: copies of a type file with one change) is caught by
 * the pack check the checks tab lists (../pack.ts `checkPack`) — the floor check's, the
 * loader's rules for a door no model key names — with a finding that points at what was
 * broken (docs/proposals/editor.md §7, M4: "каждая поломка из ExamplePackLoadTest ловится
 * панелью проверок"). The breaks are listed in ./examplePackBreaks.node.ts.
 *
 * Two of them no check sees, the engine's `FloorCheck` neither: the arch moved off the
 * aisle (the rear vestibule has doors of its own, so it is still reached) and a chair
 * turned to face forward (a chair may face either way). The markup tools' overlays show
 * those (the bridge beside the aisle, the chair's direction: tools/examplePackBreaks.test.ts);
 * they are held here to no check seeing them: a check that starts to see one fails here,
 * so the list stays true.
 */

import { describe, expect, it } from 'vitest';
import type { Problem } from '../../core/contracts';
import { Pack } from '../../core/pack';
import { MemorySource } from '../../core/pack/testing.node';
import { checkPack } from '../pack';
import { BREAKS, brokenFiles, type TypeJson } from './examplePackBreaks.node';

/** What the pack check says of the example pack with `file` changed: the loader's rules and the floor check (the schema has nothing to say of geometry). */
async function checked(file?: string, change?: (type: TypeJson) => void): Promise<Problem[]> {
  return checkPack(await Pack.open(new MemorySource(brokenFiles(file, change))), null);
}

describe("the checks catch every way ExamplePackLoadTest breaks the example pack's markup", () => {
  it('find nothing in the pack as it is', async () => {
    expect(await checked()).toEqual([]);
  });

  for (const [name, { file, change, caught }] of Object.entries(BREAKS)) {
    if (caught === null) {
      it(`not checkable automatically — the tools' overlays show it: ${name}`, async () => {
        expect(await checked(file, change)).toEqual([]);
      });
    } else {
      it(`${name}: ${caught.code}`, async () => {
        const problems = await checked(file, change);
        expect(problems.map((p) => ({ code: p.code, at: p.at }))).toContainEqual(caught);
      });
    }
  }

  it('lists the two no check sees, as the plan names them', () => {
    expect(Object.entries(BREAKS).filter(([, b]) => b.caught === null).map(([name]) => name)).toEqual([
      'salon_arch a block aside, off the aisle',
      'the second chair facing forward',
    ]);
  });
});
