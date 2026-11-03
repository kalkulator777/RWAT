/**
 * Golden runner of fixtures/golden/door_leaves/ (editor.md §4.5; fixtures/golden/README.md):
 * the port ./doorLeaves.ts against `convention.DoorLeaves`, the reference that writes the
 * expected. As DoorLeavesGolden asks it: a model's objects (name, box in the OBJ frame,
 * textured or not), its skip and animated objects → the doors it moves by name and, for
 * each leaf, its objects, whether anything draws it and the type's door it swings with
 * (by the centre of its textured box; the type is a wagon of the case's doors).
 */

import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { mismatch, readGoldenFolder } from '../testing/golden.node';
import { DoorLeaves, leafDoor } from './doorLeaves';
import { parseWagonType } from './wagonType';

const FOLDER = `${REPO_ROOT}fixtures/golden/door_leaves`;

interface Input {
  objects: { name: string; min: number[]; max: number[]; textured?: boolean }[];
  skip?: string[];
  animated?: string[];
  doors?: unknown[];
}

/** What the port makes of a case's input, as DoorLeavesGolden asks it. */
function compute(input: Input): unknown {
  const leaves = DoorLeaves.of(
    input.objects.map((o) => o.name),
    input.skip ?? [],
    input.animated ?? [],
  );
  // only the doors matter: the rest makes a wagon of them
  const type = parseWagonType('golden:leaves', { length: 30.0, bogies: [8.0, -8.0], mass_t: 40.0, doors: input.doors ?? [] });
  const objects = new Map<string, string[]>();
  const boxes = new Map<string, number[]>();
  for (const o of input.objects) {
    const leaf = leaves.leaf(o.name);
    if (leaf?.control == null) continue;
    const key = leaf.control.key;
    objects.set(key, [...(objects.get(key) ?? []), o.name]);
    if (o.textured === false) continue; // drawn by nothing: no box
    const box = boxes.get(key) ?? [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let a = 0; a < 3; a++) {
      box[a] = Math.min(box[a]!, o.min[a]!);
      box[a + 3] = Math.max(box[a + 3]!, o.max[a]!);
    }
    boxes.set(key, box);
  }
  return {
    keys: leaves.keys,
    leaves: [...objects].map(([key, parts]) => {
      const box = boxes.get(key);
      const door = box === undefined ? -1 : leafDoor(type, box.slice(0, 3), box.slice(3));
      return { key, objects: parts, drawn: box !== undefined, door: door < 0 ? null : (type.doors[door]?.id ?? null) };
    }),
  };
}

const golden = readGoldenFolder(FOLDER);

describe('golden door_leaves', () => {
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

describe('DoorLeaves beyond the golden cases', () => {
  it('drops a skipped prefix, and reads a leaf by its name as a door', () => {
    const leaves = DoorLeaves.of(['GUIDE_DOOR_1_ROT', 'DOOR_2_ROT_90', 'DOOR_2_LEAF'], ['GUIDE_'], []);
    expect(leaves.keys).toEqual(['DOOR_2']);
    expect(leaves.leaf('GUIDE_DOOR_1_ROT')).toBeNull();
    expect(leaves.leaf('DOOR_2_LEAF')?.control).toMatchObject({ kind: 'DOOR', key: 'DOOR_2' });
    expect(leaves.leaf('BODY')).toBeNull();
  });
});
