/**
 * Golden runner of fixtures/golden/model_parts/ (editor.md §4.5; fixtures/golden/README.md):
 * the port ./modelParts.ts against `convention.ModelParts`, the reference that writes the
 * expected. The model is read as `ModelPartsGolden.read` reads it (./modelCase.node.ts) and
 * written out as `ModelPartsGolden.write` writes it: every part's place, owner, index and
 * light; the light groups, bogies and wheelsets, controls and door leaves, animated doors,
 * coupler heads, cabin lamps, headlights, dropped groups and the count of parts not drawn.
 */

import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { mismatch, readGoldenFolder } from '../testing/golden.node';
import { readModelCase, type ModelCase, type ReadModel } from './modelCase.node';
import {
  dropped,
  drawn,
  fitGroups,
  groupFits,
  MAX_GROUP_LENGTH,
  modelDeclaration,
  modelParts,
  PLACES,
  tooLongGroups,
  WHEEL_RADIUS,
  Y_LIFT,
  type ModelControl,
} from './modelParts';
import { parseRole } from './objectRole';
import { PackJsonError } from './packJson';

const FOLDER = `${REPO_ROOT}fixtures/golden/model_parts`;

/** `String.format("%06X", rgb)`. */
function hex(rgb: number): string {
  return rgb.toString(16).toUpperCase().padStart(6, '0');
}

function controls(list: ModelControl[]): unknown[] {
  return list.map((c) => {
    const role = c.role;
    const flags: string[] = [];
    if (role.toggle) flags.push('TOGGLE');
    if (role.press) flags.push('PRESS');
    if (role.invert) flags.push('INVERT');
    if (role.hide) flags.push('HIDE');
    if (role.noTouch) flags.push('NOTOUCH');
    if (role.global) flags.push('GLOBAL');
    return {
      key: role.key,
      kind: role.kind,
      group: role.group,
      label: role.label,
      flags,
      offset: role.offset,
      range: [role.rangeMin, role.rangeMax],
      interior: c.interior,
      pivot: c.pivot,
      axis: c.axis,
      degrees: c.degrees,
      slide: c.slide,
      box_min: c.boxMin,
      box_max: c.boxMax,
    };
  });
}

/** What the port makes of a case, as ModelPartsGolden writes it. */
function write({ objects, parts }: ReadModel): unknown {
  return {
    parts: parts.roles.map((role, i) => ({
      object: objects[i],
      place: role.place,
      front: role.front,
      owner: role.owner,
      index: role.index,
      light: [role.light.group, role.light.fullbright, role.light.interior, role.light.invert],
    })),
    light_groups: parts.lightGroups,
    bogies: [parts.frontBogie, parts.rearBogie].map((bogie) => ({
      pivot_z: bogie.pivotZ,
      wheels: bogie.wheels.map((w) => ({ object: w.object, axle_obj: [w.axleX, w.axleY], center: [w.centerY, w.centerZ], radius: w.radius })),
    })),
    controls: controls(parts.controls),
    door_leaves: controls(parts.doorLeaves),
    doors: parts.doors.map((door) => ({ id: door.id, objects: door.objects })),
    couplers: parts.couplers.map((c) => ({ front: c.front, shown: c.shown, pivot: c.pivot })),
    lamps: parts.lamps.map((lamp) => ({ at: [lamp.x, lamp.y, lamp.z], group: lamp.group, invert: lamp.invert })),
    headlights: parts.headlights.map((h) => ({
      at: [h.x, h.y, h.z],
      dir_z: h.dirZ,
      radius: h.radius,
      rgb: hex(h.rgb),
      group: h.group,
      invert: h.invert,
    })),
    dropped_groups: parts.droppedGroups,
    skipped: parts.skipped,
  };
}

const golden = readGoldenFolder(FOLDER);

describe('golden model_parts', () => {
  it('names this port in ports.json, and the folder follows the golden format', () => {
    expect(golden.ports).toMatchObject({ reference: 'java', ports: expect.arrayContaining(['ts']) as unknown });
    expect(golden.problems).toEqual([]);
  });

  for (const file of golden.files) {
    describe(file.name, () => {
      for (const c of file.cases) {
        it(c.id, () => {
          expect(mismatch(write(readModelCase(c.input as ModelCase)), c.expected, file.tolerance), c.note).toBeNull();
        });
      }
    });
  }

  it('has the example pack shunter and coach among its cases: the objects of a loco and a coach', () => {
    const ids = golden.files.flatMap((file) => file.cases.map((c) => c.id));
    expect(ids).toEqual(expect.arrayContaining(['example-pack-shunter', 'example-pack-coach']));
  });
});

describe('ModelParts beyond the golden cases', () => {
  /** A unit cube's six faces at (x, y, z), four corners each. */
  const cube = (x: number, y: number, z: number): number[] => {
    const c = [
      [x, y, z],
      [x + 1, y, z],
      [x + 1, y + 1, z],
      [x, y + 1, z],
      [x, y, z + 1],
      [x + 1, y, z + 1],
      [x + 1, y + 1, z + 1],
      [x, y + 1, z + 1],
    ];
    return [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [3, 2, 6, 7],
      [0, 3, 7, 4],
      [1, 2, 6, 5],
    ].flatMap((face) => face.flatMap((i) => c[i]!));
  };

  it('places in the engine order: the first three are not drawn', () => {
    expect(PLACES.filter(drawn)).toEqual(['BODY', 'INTERIOR', 'BOGIE', 'WHEEL', 'ANIMATED', 'DOOR_LEAF', 'CONTROL', 'COUPLER']);
  });

  it('takes its limits from obj-conventions.json, as floats where the engine keeps floats', () => {
    expect(MAX_GROUP_LENGTH).toBe(32);
    expect(WHEEL_RADIUS).toBe(Math.fround(0.53));
    expect(Y_LIFT).toBe(Math.fround(0.43625));
  });

  it('drops by HIDE in the raw name, a WIDGET and a coupler head aside, and by a skipped prefix', () => {
    expect(dropped('LAMP_HIDE', [])).toBe('HIDDEN');
    expect(dropped('WIDGET_1_HIDE', [])).toBeNull();
    expect(dropped('COUPLED_REAR_2_HIDE', [])).toBeNull();
    expect(dropped('CARGO_FILL_1', ['CARGO_FILL'])).toBe('SKIPPED');
    expect(dropped('BODY', ['CARGO_FILL'])).toBeNull();
  });

  it('fits groups: a control group or a light group past 32 characters is dropped, the rest kept as they are', () => {
    const long = 'G'.repeat(33);
    expect(groupFits('G'.repeat(32))).toBe(true);
    expect(groupFits('')).toBe(false);
    expect(groupFits(null)).toBe(false);
    const role = parseRole(`WIDGET_1_CG_${long}_LCG_${long}_FULLBRIGHT`);
    expect(tooLongGroups(role)).toEqual([long, long]);
    const fitted = fitGroups(role);
    expect(fitted.control).toMatchObject({ group: 'WIDGET_1', noTouch: true });
    expect(fitted).toMatchObject({ lightGroup: null, fullbright: false, lightInvert: false });
    const fine = parseRole('WIDGET_1_CG_LIGHTS_LCG_IL');
    expect(fitGroups(fine)).toBe(fine);
    // a handle's group never travels: not too long, whatever its length
    expect(tooLongGroups(parseRole(`THROTTLE_1_CG_${long}`))).toEqual([]);
  });

  it('reads the parts as floats whatever array they come in', () => {
    const parts = modelParts([{ object: 'BODY', material: 'm', textured: true, corners: cube(0.1, 0, 0) }]);
    expect(parts.roles).toEqual([{ place: 'BODY', front: false, owner: null, index: -1, light: { group: -1, fullbright: false, interior: false, invert: false } }]);
    expect(parts.skipped).toBe(0);
  });

  it('takes one declared pivot for both bogies', () => {
    const parts = modelParts([{ object: 'BOGEY_FRONT_WHEEL_1', material: 'm', textured: true, corners: cube(-4.5, -0.5, -0.5) }], {
      bogies: [3],
      skip: [],
      animated: new Map(),
      handbrake: [],
    });
    expect(parts.frontBogie.pivotZ).toBe(3);
    expect(parts.rearBogie.pivotZ).toBe(3);
    expect(parts.frontBogie.wheels[0]).toMatchObject({ object: 'BOGEY_FRONT_WHEEL_1', axleX: -4, axleY: 0, centerZ: 1 });
  });

  it('reads the model fields of a declaration as WagonModelDecl.parse does, namespaces and all', () => {
    const decl = modelDeclaration('ns', {
      obj: 'stock/a.obj',
      bogies: [4, -4],
      skip: ['GUIDE_'],
      animations: { Door1: 'stock/door.anim', door2: 'other:x.anim' },
      liveries: { blue: 'l_blue' },
      handbrake: ['WIDGET_5'],
      sway: 2,
    });
    expect(decl).toEqual({
      obj: 'ns:stock/a.obj',
      bogies: [4, -4],
      skip: ['GUIDE_'],
      animations: new Map([
        ['door1', 'ns:stock/door.anim'],
        ['door2', 'other:x.anim'],
      ]),
      liveries: new Map([['blue', 'l_blue']]),
      handbrake: ['WIDGET_5'],
    });
    expect(modelDeclaration('ns', { obj: 'mod:a.obj' })).toMatchObject({ obj: 'mod:a.obj', bogies: null, skip: [], handbrake: [] });
  });

  it('refuses a declaration as the engine does, with its words', () => {
    const refusal = (json: unknown): string => {
      try {
        modelDeclaration('ns', json);
      } catch (error) {
        expect(error).toBeInstanceOf(PackJsonError);
        return (error as Error).message;
      }
      throw new Error('accepted');
    };
    expect(refusal([])).toBe('a wagon model declaration must be an object, got an array');
    expect(refusal({})).toBe("missing required field 'obj'");
    expect(refusal({ obj: '' })).toBe("'obj' is empty");
    expect(refusal({ obj: 3 })).toBe("'obj' must be a string, got the number 3");
    expect(refusal({ obj: 'a.obj', bogies: [] })).toBe("'bogies' must list at least one pivot offset");
    expect(refusal({ obj: 'a.obj', bogies: [1, null] })).toBe("'bogies[1]' must be a finite number, got null");
    expect(refusal({ obj: 'a.obj', skip: 'GUIDE_' })).toBe("'skip' must be an array, got the string \"GUIDE_\"");
    expect(refusal({ obj: 'a.obj', animations: { d: 1 } })).toBe("'animations.d' must be a string, got the number 1");
    expect(refusal({ obj: 'a.obj', handbrake: [true] })).toBe("'handbrake[0]' must be a string, got true");
  });
});
