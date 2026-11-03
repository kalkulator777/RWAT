/**
 * The editor's findings against tools/validate_pack.py, the reference, run live on the
 * same files: the example pack and the MVP recipe with its overrides (nothing to say),
 * and broken documents that reach the corners of the schemas (composites, `null` forms,
 * key maps, deprecated and reserved fields). Places, severities and words must all agree.
 * More than the golden folder holds; skipped, said out loud, when Python is not there.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSchemaFiles } from './files.node';
import { createSchema, schemaKindOf, type SchemaKind } from './index';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const PACK = `${REPO}run/rwat_packs/RwatExamplePack`;
const python = spawnSync('python3', ['--version']).status === 0;
const schema = createSchema(readSchemaFiles());

interface Line {
  level: string;
  pointer: string;
  text: string;
}

const PATH_STEP = /\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/y;

function pointerOf(path: string): string {
  let out = '';
  PATH_STEP.lastIndex = 1;
  while (PATH_STEP.lastIndex < path.length) {
    const m = PATH_STEP.exec(path);
    if (!m) throw new Error(path);
    const name = m[1] ?? m[2] ?? (JSON.parse(m[3] as string) as string);
    out += `/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`;
  }
  return out;
}

/** What validate_pack.py says of each file, by the file's path. */
function pythonSays(kind: SchemaKind, paths: string[]): Map<string, Line[]> {
  const run = spawnSync('python3', ['-I', `${REPO}tools/validate_pack.py`, '--as', kind, ...paths], { encoding: 'utf8' });
  const out = new Map<string, Line[]>(paths.map((p) => [p, []]));
  for (const line of run.stdout.split('\n')) {
    for (const path of paths) {
      if (!line.startsWith(`${path}: `)) continue;
      const m = /^(error|warning): (\$[^:]*(?:\["(?:[^"\\]|\\.)*"\])*[^:]*): (.*)$/.exec(line.slice(path.length + 2));
      if (m) out.get(path)?.push({ level: m[1] as string, pointer: pointerOf(m[2] as string), text: m[3] as string });
    }
  }
  return out;
}

function ours(kind: SchemaKind, value: unknown): Line[] {
  return schema.checker.check(kind, value).map((f) => ({ level: f.level, pointer: f.pointer, text: f.message }));
}

const sorted = (lines: Line[]): Line[] =>
  lines.slice().sort((a, b) => `${a.pointer}|${a.level}|${a.text}`.localeCompare(`${b.pointer}|${b.level}|${b.text}`));

const zone = { min: [0, 1, 0], max: [1, 2, 1] };
const base = { length: 20, bogies: [5, -5], mass_t: 30 };

const BROKEN: [string, SchemaKind, unknown][] = [
  [
    'many things at once',
    'wagon_type',
    {
      length: -1, bogies: 'x', mass_t: 3, foo: 1, lenght: 2, interior: { min: [1, 2], max: [1, 2, 3] },
      cab: { seat: [1, 2, 3], seats: [] }, brakes: { system: 5, dynamic_kn: 1 },
      doors: [{ id: '', min: [1, 2, 'a'], max: [1, 2, 3], x: 1 }],
    },
  ],
  ['interior neither form', 'wagon_type', { ...base, interior: 'x' }],
  ['interior an empty list', 'wagon_type', { ...base, interior: [] }],
  ['interior list with a bad zone', 'wagon_type', { ...base, interior: [zone, { min: [0, 1], max: 3, extra: 1 }] }],
  ['interior the old form, valid', 'wagon_type', { ...base, interior: zone }],
  ['too many doors and bad flags', 'wagon_type', { ...base, doors: Array.from({ length: 33 }, (_, i) => ({ id: `d${i}`, min: [0, 0, 0], max: [1, 1, 1], inner: 'yes' })) }],
  ['aliases and couplers', 'wagon_type', { ...base, aliases: ['Bad', 5], couplers: 'x' }],
  ['cab seats', 'wagon_type', { ...base, cab: { seats: [{ yaw: 'x' }, { at: [0, 0, 0], extra: 1 }], seat_yaw: 3 } }],
  ['traction without keys', 'wagon_type', { ...base, traction: { adhesion: -1 }, resistance: { a: -1, z: 0 }, brakes: { dynamic_fade_kmh: 4, system: 'ep' } }],
  ['a type that is a string', 'wagon_type', 'x'],
  [
    'model sounds',
    'wagon_model',
    {
      obj: 'Stock/A.obj', animations: { '': 'x.anim', door: 5 }, liveries: { a: 'A/b' }, handbrake: ['x'], sway: 5, skip: [''], bogies: [],
      sounds: {
        idle: { main: 5, pitch: [1], bad: 1 }, horn: [1], wheels: { start: 'a.ogg' }, clack: '', doors: { '': 'x.ogg' },
        controls: { bad: { move: 1 }, THROTTLE_1: { engage: 'A', other: 1 } }, other: 1,
      },
    },
  ],
  ['model sounds valid loops', 'wagon_model', { obj: 'a.obj', sounds: { idle: { main: 'a.ogg', pitch: [1, 2] }, horn: 'a.ogg' } }],
  ['rail model', 'rail_model', { obj: '', tile_length: 0.1, x: 1 }],
  ['mcmeta', 'pack_mcmeta_rwat', { pack: { pack_format: 'x' }, rwat: { format: 0, extra: 1, authors: [1] } }],
  ['mcmeta without rwat', 'pack_mcmeta_rwat', { pack: { pack_format: 34, description: 'x' } }],
  [
    'override with null forms',
    'recipe_override',
    {
      name: { BAD: 'x', en_us: 1 }, lights: 5, floor: 5, sway: 9, _why: 1,
      type: {
        interior: { min: [1, 2], max: [1, 2, 3] }, doors: 5, mass_t: 'x', cab: { seat: [1, 2, 3] }, brakes: { dynamic_kn: 3, system: 'x' },
        couplers: 5, resistance: null, traction: { power_kw: 'x' }, other: 1,
      },
      model: { sounds: { idle: 5, doors: 5, controls: { A: 5 } }, animations: { a: 5 }, liveries: { a: 5 }, obj: 5 },
    },
  ],
  [
    'override doors as object and floor',
    'recipe_override',
    {
      type: { doors: { d: { min: 1 }, _c: 1, e: null, f: { id: 5 } }, interior: [{ min: [0, 0, 0], max: [1, 1, 1] }, 5] },
      floor: { clearance: -1, level: 'x', add: [{ min: [0, 0, 0] }], slab: [1], cell: 0, ignore: [1], step_down: -2, extra: 1 },
    },
  ],
  ['override floor false and chair', 'recipe_override', { floor: false, type: { cab: { seats: [{ at: [0, 0, 0] }, { yaw: 1 }], seat: 5 } } }],
  ['override interior old form', 'recipe_override', { type: { interior: zone }, model: { sounds: { idle: { main: null, pitch: [1, 2] } } } }],
  [
    'recipe',
    'recipe',
    {
      namespace: 'A', sources: [], pack_dir: '..', copy_root_files: ['pack.mcmeta', 'assets/x', '/abs', 'a/../b', 5], overrides: { x: 5 },
      rail_overrides: { a: { tile_length: 'x', obj: null } }, foo: 1, exclude: [''], sound_defaults: { clack: '', wheels: { a: '' }, x: 1 },
    },
  ],
  ['recipe sources', 'recipe', { namespace: 'a', pack_dir: 'p', sources: [{ zip: '', root: 'lang/x' }, { root: 'a', extra: 1 }, 5] }],
  ['recipe missing', 'recipe', {}],
  ['an array for every kind', 'recipe_override', [1, 2]],
  ['a number', 'wagon_model', 5],
];

describe.skipIf(!python)('findings equal validate_pack.py', () => {
  const dir = mkdtempSync(`${tmpdir()}/rwat-parity-`);
  const files = BROKEN.map(([, , value], i) => {
    const path = `${dir}/case${i}.json`;
    writeFileSync(path, JSON.stringify(value));
    return path;
  });
  const reference = new Map<string, Line[]>();
  for (const kind of new Set(BROKEN.map((b) => b[1]))) {
    const paths = BROKEN.flatMap((b, i) => (b[1] === kind ? [files[i] as string] : []));
    for (const [path, lines] of pythonSays(kind, paths)) reference.set(path, lines);
  }

  BROKEN.forEach(([name, kind, value], i) => {
    it(name, () => {
      const expected = reference.get(files[i] as string) ?? [];
      expect(sorted(ours(kind, value))).toEqual(sorted(expected));
    });
  });

  it('the broken documents do say something', () => {
    const counts = BROKEN.map((_, i) => reference.get(files[i] as string)?.length ?? 0);
    expect(counts.filter((n) => n === 0).length).toBeLessThanOrEqual(2);
  });
});

function jsonFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((p) => p.endsWith('.json') || p === 'pack.mcmeta').sort();
}

describe('the example pack', () => {
  it('has no finding of the schema in any declaration', () => {
    let checked = 0;
    for (const rel of jsonFiles(PACK).map((p) => p.replace(/\\/g, '/'))) {
      const kind = schemaKindOf(rel);
      if (!kind) continue;
      checked++;
      const found = ours(kind, JSON.parse(readFileSync(`${PACK}/${rel}`, 'utf8')));
      expect(found, rel).toEqual([]);
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });
});

describe('the MVP recipe', () => {
  const recipe = `${REPO}packs/mvp.json`;
  const present = existsSync(recipe);
  it.skipIf(!present || !python)('says what validate_pack.py says of the recipe and every override', () => {
    const overrides = readdirSync(`${REPO}packs/mvp`).filter((n) => n.endsWith('.json')).map((n) => `${REPO}packs/mvp/${n}`);
    const lines = (kind: SchemaKind, paths: string[]): void => {
      for (const [path, expected] of pythonSays(kind, paths)) {
        expect(sorted(ours(kind, JSON.parse(readFileSync(path, 'utf8')))), path).toEqual(sorted(expected));
      }
    };
    lines('recipe', [recipe]);
    lines('recipe_override', overrides);
    expect(overrides.length).toBeGreaterThan(5);
  });
  it.skipIf(present)('is skipped: packs/mvp.json is missing', () => {
    expect(present).toBe(false);
  });
});

describe.skipIf(python)('parity with Python', () => {
  it('is skipped: python3 is not installed here', () => {
    expect(python).toBe(false);
  });
});
