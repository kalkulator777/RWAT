/**
 * The tab's roles against the engine's: every case of fixtures/golden/model_parts/ (the
 * synthetic ones and the example pack's three models) gives each part the place Java's
 * `ModelParts` gives it. The tab's classifier is interim (A3.1's `ports/modelParts` takes
 * over), and this holds it to the reference meanwhile.
 */

import { describe, expect, it } from 'vitest';
import { readGoldenFolder } from '../../testing/golden.node';
import { REPO_ROOT } from '../../testing/repo.node';
import { loadModel } from '../../ports/obj';
import { parse as parseAnim } from '../../ports/anim';
import { parse as parseMtl } from '../../ports/mtl';
import { classifyParts } from './classify';

const PARTS = `${REPO_ROOT}fixtures/golden/model_parts`;

/** The engine's place → the schema's role id (a bogie's depends on its end). */
function roleOf(place: string, front: boolean): string {
  switch (place) {
    case 'HIDDEN': return 'hidden';
    case 'SKIPPED': return 'skip';
    case 'UNTEXTURED': return 'untextured';
    case 'BODY': return 'body';
    case 'INTERIOR': return 'interior';
    case 'BOGIE': return front ? 'bogie_front' : 'bogie_rear';
    case 'WHEEL': return 'wheelset';
    case 'ANIMATED': return 'anim_object';
    case 'DOOR_LEAF': return 'door_leaf';
    case 'CONTROL': return 'control';
    case 'COUPLER': return 'coupler_head';
    default: throw new Error(`unknown place ${place}`);
  }
}

interface Input {
  obj: string;
  textured?: string[];
  mtl?: string;
  model?: { skip?: string[] };
  [key: string]: unknown;
}

interface Expected {
  parts: { object: string; place: string; front: boolean }[];
}

const golden = readGoldenFolder(PARTS);
const cases = golden.files.flatMap((file) => file.cases);

describe('roles against golden model_parts', () => {
  it('has the cases', () => {
    expect(cases.length).toBeGreaterThan(10);
  });

  for (const c of cases) {
    it(c.id, () => {
      const input = c.input as Input;
      const textured = new Set(input.textured ?? (input.mtl === undefined ? [] : [...parseMtl(input.mtl).keys()]));
      const animObjects = new Set<string>();
      for (const [key, value] of Object.entries(input)) {
        if (key.startsWith('anim_') && typeof value === 'string') for (const [name, frames] of parseAnim(value)) if (frames.length > 0) animObjects.add(name);
      }
      const parts = loadModel(input.obj).parts;
      const roles = classifyParts(
        parts.map((part) => ({ object: part.object, textured: textured.has(part.material) })),
        { skip: input.model?.skip ?? [], animObjects },
      );
      const expected = (c.expected as Expected).parts;
      expect(roles.map((role, at) => [parts[at]!.object, role])).toEqual(expected.map((part) => [part.object, roleOf(part.place, part.front)]));
    });
  }
});
