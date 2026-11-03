/**
 * Golden runner of fixtures/golden/anim/ (editor.md §4.5; fixtures/golden/README.md): the
 * port ./anim.ts against `IrAnim.parse` and `IrAnim.frameAt`, the reference that writes
 * the expected. Everything of the folder is compared: the tracks as written or the
 * refusal, and with a `progress` each track's transform at it (`at`, row by row).
 */

import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { mismatch, readGoldenFolder, toNumber } from '../testing/golden.node';
import { AnimError, frameAt, framesAt, parse } from './anim';

const FOLDER = `${REPO_ROOT}fixtures/golden/anim`;

interface Input {
  text: string;
  progress?: number | string;
}

/** What the port makes of a case's input, as AnimGolden asks it. */
function compute(input: Input): unknown {
  let tracks;
  try {
    tracks = parse(input.text);
  } catch (e) {
    if (e instanceof AnimError) return { error: true };
    throw e;
  }
  const out: Record<string, unknown> = { tracks };
  if (input.progress !== undefined) out.at = framesAt(tracks, toNumber(input.progress));
  return out;
}

const golden = readGoldenFolder(FOLDER);

describe('golden anim', () => {
  it('names this port in ports.json, and the folder follows the golden format', () => {
    expect(golden.ports).toMatchObject({ reference: 'java', ports: expect.arrayContaining(['ts']) as unknown });
    expect(golden.problems).toEqual([]);
  });

  for (const file of golden.files) {
    describe(file.name, () => {
      for (const c of file.cases) {
        it(c.id, () => {
          expect(mismatch(compute(c.input as Input), c.expected, file.tolerance), c.note).toBeNull();
        });
      }
    });
  }
});

describe('anim beyond the golden cases', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const moved = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0.5, 0, 0, 0, 1];

  it('reads values as Float.parseFloat does, suffixes and blanks around them included', () => {
    const tracks = parse('O A\nM 1f, 0,0,0,0,1d,0,0,0,0,1,0x1p-1 ,0,0,0,1\n');
    expect(Array.from(tracks.get('A')![0]!)).toEqual(moved);
  });

  it('refuses an empty value between commas, and drops empty values after the last', () => {
    expect(() => parse('O A\nM 1,,0,0,0,1,0,0,0,0,1,0,0,0,0,1\n')).toThrow(AnimError);
    expect(Array.from(parse('O A\nM 1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,,,\n').get('A')![0]!)).toEqual(identity);
    expect(() => parse('O A\nM 1\n')).toThrow(/line 2/);
  });

  it('takes the frame index toward zero, and leaves the track at or below −1 / (N − 1)', () => {
    const frames = [identity, moved];
    expect(frameAt(frames, -0.5)[11]).toBe(-0.25);
    expect(frameAt(frames, -0.999)[11]).toBe(Math.fround(Math.fround(0.5 * Math.fround(-0.999))));
    expect(() => frameAt(frames, -1)).toThrow(RangeError);
    expect(() => frameAt([], 0)).toThrow(RangeError);
    expect(frameAt(frames, 1e30)[11]).toBe(0.5);
    expect(frameAt(frames, NaN)[11]).toBeNaN();
  });
});
