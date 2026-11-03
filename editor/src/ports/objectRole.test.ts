/**
 * Golden runner of fixtures/golden/object_role/ (editor.md §4.5; fixtures/golden/README.md):
 * the editor's `parseRole`, `door`, `coupled` and `hasToken` (./objectRole.ts) against
 * Java's `ObjectRole`, the reference that writes the expected. A case gives an object's
 * name; the expected is what the convention reads in it (control, pivot degrees, light,
 * rgb as `RRGGBB`, the INTERIOR token, the name read as a door leaf, the coupler head).
 */

import { describe, expect, it } from 'vitest';
import conventions from '../../../schema/obj-conventions.json';
import { REPO_ROOT } from '../testing/repo.node';
import { mismatch, readGoldenFolder, readGoldenPorts } from '../testing/goldenCompare.node';
import { CONTROL_KINDS, coupled, door, hasToken, headShownAt, parseRole, type Control } from './objectRole';

const FOLDER = `${REPO_ROOT}fixtures/golden/object_role`;

function controlOut(c: Control | null): Record<string, unknown> | null {
  if (c === null) return null;
  return {
    kind: c.kind,
    gauge: c.gauge,
    id: c.id,
    key: c.key,
    group: c.group,
    label: c.label,
    toggle: c.toggle,
    press: c.press,
    invert: c.invert,
    hide: c.hide,
    no_touch: c.noTouch,
    global: c.global,
    offset: c.offset,
    range: [c.rangeMin, c.rangeMax],
    slide: c.slide,
  };
}

/** The port's reading of a name in the shape of the file's `expected`. */
function read(name: string): Record<string, unknown> {
  const role = parseRole(name);
  const leaf = door(name);
  const head = coupled(name);
  return {
    control: controlOut(role.control),
    pivot_degrees: role.pivotDegrees,
    light_group: role.lightGroup,
    light_invert: role.lightInvert,
    fullbright: role.fullbright,
    headlight: role.headlight,
    rgb: role.rgb.toString(16).toUpperCase().padStart(6, '0'),
    interior_token: hasToken(name, 'INTERIOR'),
    door: leaf === null ? null : { ...controlOut(leaf.control), pivot_degrees: leaf.pivotDegrees },
    coupled: head,
  };
}

describe('golden object_role', () => {
  const files = readGoldenFolder(FOLDER);

  it('names this port in ports.json and has cases', () => {
    expect(readGoldenPorts(FOLDER)).toMatchObject({ reference: 'java', ports: expect.arrayContaining(['ts']) as unknown });
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file.cases.length, file.name).toBeGreaterThanOrEqual(10);
  });

  for (const file of files) {
    describe(file.name, () => {
      for (const c of file.cases) {
        it(c.id, () => {
          const name = (c.input as { name: string }).name;
          expect(mismatch(read(name), c.expected, file.tolerance), `${c.note}: ${name}`).toBeNull();
        });
      }
    });
  }
});

describe('the conventions schema and the port', () => {
  it('lists the control kinds in the order the port tries them', () => {
    expect(conventions.control_kinds.map((entry) => entry.kind)).toEqual([...CONTROL_KINDS]);
  });

  it('holds only expressions that compile for JavaScript with the u flag', () => {
    const sources: string[] = [];
    const collect = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(collect);
      else if (typeof node === 'object' && node !== null) {
        for (const [key, value] of Object.entries(node)) {
          if (key === 'regex' && typeof value === 'string') sources.push(value);
          else collect(value);
        }
      }
    };
    collect(conventions);
    expect(sources.length).toBeGreaterThan(40);
    for (const source of sources) expect(() => new RegExp(source, 'u'), source).not.toThrow();
  });
});

describe('objectRole beyond the golden cases', () => {
  it('holds the control number of too many digits at the int range', () => {
    expect(parseRole('THROTTLE_12345678901')).toMatchObject({ control: { id: 2147483647, key: 'THROTTLE_12345678901' } });
  });

  it('does not take a hinge with NaN degrees for a marker', () => {
    expect(parseRole('THROTTLE_1_ROT_NaN').pivotDegrees).toBeNull();
    expect(parseRole('THROTTLE_1_ROT').pivotDegrees).toBe(0);
  });

  it('shows a coupler head by its state', () => {
    expect(headShownAt('COUPLED', true)).toBe(true);
    expect(headShownAt('COUPLED', false)).toBe(false);
    expect(headShownAt('UNCOUPLED', false)).toBe(true);
    expect(headShownAt('ALWAYS', false)).toBe(true);
  });
});
