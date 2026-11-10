import { describe, expect, it } from 'vitest';
import { diffLines, hunks, splitLines } from './diff';

const text = (...lines: string[]): string => `${lines.join('\n')}\n`;

describe('the difference by lines', () => {
  it('splits lines without a last empty one, with either line end', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a\r\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\n\nb')).toEqual(['a', '', 'b']);
  });

  it('counts one changed line as one removed and one added, in its place', () => {
    const diff = diffLines(text('{', '  "a": 1,', '  "b": 2', '}'), text('{', '  "a": 3,', '  "b": 2', '}'));
    expect([diff.added, diff.removed]).toEqual([1, 1]);
    expect(diff.lines?.map((line) => line.kind)).toEqual(['same', 'del', 'add', 'same', 'same']);
  });

  it('finds the shortest script: lines inserted and removed among others', () => {
    const before = text('a', 'b', 'c', 'a', 'b', 'b', 'a');
    const after = text('c', 'b', 'a', 'b', 'a', 'c');
    const diff = diffLines(before, after);
    expect(diff.added + diff.removed).toBe(5); // Myers' classic example: D = 5
    const kept = diff.lines?.filter((line) => line.kind !== 'add').map((line) => line.text);
    const made = diff.lines?.filter((line) => line.kind !== 'del').map((line) => line.text);
    expect(kept).toEqual(splitLines(before));
    expect(made).toEqual(splitLines(after));
    expect(diffLines('', text('x', 'y'))).toMatchObject({ added: 2, removed: 0 });
    expect(diffLines(text('x'), '')).toMatchObject({ added: 0, removed: 1 });
    expect(diffLines(text('same'), text('same'))).toMatchObject({ added: 0, removed: 0 });
  });

  it('does not compare line by line past the edit limit: the changed middle counts whole', () => {
    const before = text('head', ...Array.from({ length: 30 }, (_, i) => `a${i}`), 'tail');
    const after = text('head', ...Array.from({ length: 20 }, (_, i) => `b${i}`), 'tail');
    expect(diffLines(before, after, 10)).toEqual({ added: 20, removed: 30, lines: null });
    expect(diffLines(before, after).lines).not.toBeNull();
  });

  it('shows the changed lines with their context, and counts what it leaves out', () => {
    const before = text(...Array.from({ length: 20 }, (_, i) => `l${i}`));
    const after = before.replace('l3\n', 'L3\n').replace('l15\n', 'L15\n');
    const runs = hunks(diffLines(before, after).lines ?? [], 2);
    expect(runs.map((run) => [run.skipped, run.lines.map((line) => line.text)])).toEqual([
      [1, ['l1', 'l2', 'l3', 'L3', 'l4', 'l5']],
      [7, ['l13', 'l14', 'l15', 'L15', 'l16', 'l17']],
    ]);
    expect(hunks([{ kind: 'same', text: 'x' }])).toEqual([]);
  });
});
