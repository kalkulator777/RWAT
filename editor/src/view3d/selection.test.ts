import { describe, expect, it } from 'vitest';
import type { Link } from '../core/contracts';
import { isSelected, objectLink, selectedObjects, selectionAfterClick } from './selection';

const COACH = 'rwat_example:coach';
const roof = objectLink(COACH, 'ROOF');
const floor = objectLink(COACH, 'FLOOR');
const file: Link = { kind: 'file', file: 'data/rwat_example/wagon_types/coach.json' };

describe('the view in the selection', () => {
  it('writes an object as the objects tab does: the wagon id and the OBJ name', () => {
    expect(roof).toEqual({ kind: 'object', model: 'rwat_example:coach', name: 'ROOF' });
  });

  it('makes the hit the selection, and with Shift adds it or takes it back out', () => {
    expect(selectionAfterClick([file], roof, false)).toEqual([roof]);
    expect(selectionAfterClick([roof], floor, true)).toEqual([roof, floor]);
    expect(selectionAfterClick([roof, floor], roof, true)).toEqual([floor]);
    expect(selectionAfterClick([file, roof], { kind: 'zone', type: 'rwat_example:coach', index: 0 }, false)).toEqual([
      { kind: 'zone', type: 'rwat_example:coach', index: 0 },
    ]);
  });

  it('keeps the very same selection when nothing changes, and when the click hits nothing', () => {
    const current = [roof];
    expect(selectionAfterClick(current, objectLink(COACH, 'ROOF'), false)).toBe(current);
    expect(selectionAfterClick(current, null, false)).toBe(current);
    expect(selectionAfterClick(current, null, true)).toBe(current);
  });

  it("reads the model's selected objects and whether a link is selected", () => {
    const selection = [roof, objectLink('rwat_example:shunter', 'ROOF'), file];
    expect([...selectedObjects(selection, COACH)]).toEqual(['ROOF']);
    expect([...selectedObjects(selection, null)]).toEqual([]);
    expect(isSelected(selection, { kind: 'file', file: file.file })).toBe(true);
    expect(isSelected(selection, floor)).toBe(false);
  });
});
