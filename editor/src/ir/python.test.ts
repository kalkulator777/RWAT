/**
 * The bridge's Python side (./python.ts) on Pyodide in Node — the same code and the same
 * Python files the worker runs — against the real Python (`python3 -I tools/…`):
 *
 * - a synthetic IR pack (./testing.node.ts, our own bytes) converts to the same pack,
 *   file by file and as the `--zip` bytes, with the same exit status and warnings;
 * - `suggest_floor` on the example pack's coach at a given level gives floorgen's zones;
 * - `model_doors` and `rewrite_references` give what the converter's functions give;
 * - failures (a bad recipe, a source that is no zip, a floor the generator can't take, a
 *   request the bridge can't follow) come as structures.
 *
 * Pyodide is loaded once for the file (about 2 s). Without python3 the comparisons say
 * they are skipped.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLE_PACK } from '../testing/repo.node';
import type { ConvertRequest, ConvertResult, Failure, Outcome, PythonApi } from './bridge';
import { resolvePath } from './python';
import {
  COACH_OBJ,
  havePython,
  irOverrides,
  irPackFiles,
  irRecipe,
  json,
  nodePython,
  readFolder,
  runPythonJson,
  runTool,
  secondPackFiles,
  writeFolder,
  zipOf,
} from './testing.node';

const COACH = join(EXAMPLE_PACK, 'assets', 'rwat_example', 'stock', 'coach', 'coach.obj');
const COACH_TYPE = join(EXAMPLE_PACK, 'data', 'rwat_example', 'wagon_types', 'coach.json');

let api: PythonApi;
let scratch: string;

beforeAll(async () => {
  api = nodePython();
  const started = await api.start({});
  expect(started.ok).toBe(true);
  scratch = await mkdtemp(join(tmpdir(), 'rwat-pyodide-'));
}, 60_000);

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function value<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`${outcome.error.type}: ${outcome.error.message}\n${outcome.error.traceback}`);
  return outcome.value;
}

function failure<T>(outcome: Outcome<T>): Failure {
  if (outcome.ok) throw new Error(`expected a failure, got ${JSON.stringify(outcome.value).slice(0, 200)}`);
  return outcome.error;
}

/** The synthetic pack as files: the recipe folder and the second source beside it. */
async function syntheticInput() {
  const recipe = json(irRecipe());
  const overrides = Object.fromEntries(Object.entries(irOverrides()).map(([id, v]) => [id, json(v)]));
  const first = await zipOf(irPackFiles());
  const second = await zipOf(secondPackFiles());
  return { recipe, overrides, first, second };
}

/** The converter of the real Python on the same input, written to a folder of the disk. */
async function cliConvert(name: string, input: Awaited<ReturnType<typeof syntheticInput>>, asZip: boolean) {
  const root = join(scratch, name);
  await writeFolder(root, {
    'packs/test.json': input.recipe,
    ...Object.fromEntries(Object.entries(input.overrides).map(([id, bytes]) => [`packs/tp/${id}.json`, bytes])),
    'packs/test-ir.zip': input.first,
    'sources/Second IR.zip': input.second,
  });
  const out = join(root, 'out');
  const run = runTool('ir2rwat.py', [join(root, 'packs', 'test.json'), '--out', out, ...(asZip ? ['--zip'] : [])]);
  return { run, out };
}

function request(input: Awaited<ReturnType<typeof syntheticInput>>, output: 'zip' | 'files'): ConvertRequest {
  return {
    recipe: input.recipe,
    recipeName: 'test.json',
    overrides: input.overrides,
    sources: { 'test-ir.zip': input.first, '../sources/Second IR.zip': new Blob([input.second.slice()]) },
    output,
  };
}

describe('resolvePath', () => {
  it('resolves . and .. against the base, never above /', () => {
    expect(resolvePath('/work/packs', '../MVP.zip')).toBe('/work/MVP.zip');
    expect(resolvePath('/work/packs', './a/./b/../c.zip')).toBe('/work/packs/a/c.zip');
    expect(resolvePath('/work/packs', '../../../../x')).toBe('/x');
    expect(resolvePath('/work/packs', '/abs/y')).toBe('/abs/y');
  });
});

describe.skipIf(!havePython)('the converter in Pyodide = python3 tools/ir2rwat.py', () => {
  it('writes the same pack, file by file, with the same exit status and warnings', async () => {
    const input = await syntheticInput();
    const cli = await cliConvert('folder', input, false);
    const lines: string[] = [];
    const started = performance.now();
    const result: ConvertResult = value(await api.convert(request(input, 'files'), (line) => lines.push(line)));
    console.info(`synthetic pack, files: ${(performance.now() - started).toFixed(0)} ms, wasm heap ${((await api.memory()) / 2 ** 20).toFixed(0)} MiB`);

    expect(result.exitCode).toBe(cli.run.status);
    expect(result.exitCode).toBe(1); // the type with no model: an error, the rest converted
    expect(result.pack?.kind).toBe('files');
    if (result.pack?.kind !== 'files') return;
    expect(result.pack.name).toBe('TestPack');
    const theirs = await readFolder(join(cli.out, 'TestPack'));
    const ours = new Map(result.pack.files.map((f) => [f.path, f.bytes]));
    expect([...ours.keys()]).toEqual([...theirs.keys()]);
    for (const [path, bytes] of theirs) expect(ours.get(path), path).toEqual(bytes);
    // what was renamed is there, and the per-type file reached the pack
    expect(ours.has('assets/tp/stock/rolling_stock/passenger/test_coach/test_coach.obj')).toBe(true);
    expect(new TextDecoder().decode(ours.get('assets/tp/lang/ru_ru.json'))).toContain('Тестовый вагон');

    const said = cli.run.stdout.split('\n');
    expect(result.report.warnings).toEqual(said.filter((l) => l.startsWith('  WARNING: ')).map((l) => l.slice('  WARNING: '.length)));
    expect(result.report.errors).toEqual(said.filter((l) => l.startsWith('  ERROR: ')).map((l) => l.slice('  ERROR: '.length)));
    expect(result.report.warnings.some((w) => w.includes('unknown key "unknown_key"'))).toBe(true);
    expect(result.report.errors).toHaveLength(1);
    expect(result.report.refusal).toBeNull();
    expect(result.report.stock.map((s) => s.id).sort()).toEqual(['hopper', 'loco', 'test_coach']);
    expect(result.report.stock.find((s) => s.id === 'hopper')?.source).toBe('Test');
    expect(result.report.rails).toEqual([{ id: 'rail_a', source: 'Test', name: 'Rail A' }]);
    // the log is what it printed, heard line by line as printed; only the last lines name the target
    expect(lines).toEqual(result.report.log);
    expect(result.report.log.slice(0, -3)).toEqual(said.slice(0, result.report.log.length - 3));
  }, 60_000);

  it('writes the same zip as --zip, byte for byte', async () => {
    const input = await syntheticInput();
    const cli = await cliConvert('zip', input, true);
    const result = value(await api.convert(request(input, 'zip')));
    expect(result.exitCode).toBe(cli.run.status);
    expect(result.pack?.kind).toBe('zip');
    if (result.pack?.kind !== 'zip') return;
    expect(result.pack.name).toBe('TestPack.zip');
    expect(result.pack.bytes).toEqual(new Uint8Array(await readFile(join(cli.out, 'TestPack.zip'))));
  }, 60_000);

  it('takes the recipe and the per-type files as JSON values, as their files', async () => {
    const input = await syntheticInput();
    const asValues = value(await api.convert({ ...request(input, 'zip'), recipe: irRecipe(), overrides: irOverrides() }));
    const asFiles = value(await api.convert(request(input, 'zip')));
    expect(asValues.pack).toEqual(asFiles.pack);
  }, 60_000);

  it('refuses a bad recipe as the command line does: exit 2, the reason, nothing written', async () => {
    const input = await syntheticInput();
    const bad = { ...input, recipe: json({ ...irRecipe(), namespace: 'Not A Namespace' }) };
    const cli = await cliConvert('bad', bad, true);
    const result = value(await api.convert(request(bad, 'zip')));
    expect(cli.run.status).toBe(2);
    expect(result.exitCode).toBe(2);
    expect(result.pack).toBeNull();
    expect(`ir2rwat: error: ${result.report.refusal}\n`).toBe(cli.run.stderr);
    expect(result.report.refusal).toContain('"namespace" must be a Minecraft namespace');
  }, 60_000);

  it('refuses a source that is no zip, naming it', async () => {
    const input = await syntheticInput();
    const result = value(await api.convert({ ...request(input, 'zip'), sources: { 'test-ir.zip': new TextEncoder().encode('not a zip'), '../sources/Second IR.zip': input.second } }));
    expect(result.exitCode).toBe(2);
    expect(result.report.refusal).toMatch(/sources\[0\]\.zip .*test-ir\.zip: not a readable zip/);
  }, 60_000);

  it('reports a source the recipe names but nobody gave as a missing file', async () => {
    const input = await syntheticInput();
    const result = value(await api.convert({ ...request(input, 'zip'), sources: { 'test-ir.zip': input.first } }));
    expect(result.exitCode).toBe(2);
    expect(result.report.refusal).toMatch(/sources\[1\]\.zip: no file .*Second IR\.zip/);
  }, 60_000);

  it('turns a per-type "floor" the generator cannot take into a converter error (exit 1)', async () => {
    const input = await syntheticInput();
    const overrides = { ...irOverrides(), test_coach: { floor: { clearance: 'wide' } } };
    const result = value(await api.convert({ ...request(input, 'zip'), overrides }));
    expect(result.exitCode).toBe(1);
    expect(result.report.errors.some((e) => e.includes('test_coach: no generated floor') && e.includes('"floor".clearance must be a number'))).toBe(true);
  }, 60_000);

  it('leaves nothing behind: the next conversion sees only its own files', async () => {
    const input = await syntheticInput();
    // per-type files the first run had are gone in the second
    const first = value(await api.convert(request(input, 'files')));
    const second = value(await api.convert({ ...request(input, 'files'), overrides: {} }));
    const lang = (r: ConvertResult) => (r.pack?.kind === 'files' ? r.pack.files.find((f) => f.path === 'assets/tp/lang/ru_ru.json') : undefined);
    expect(lang(first)).toBeDefined();
    expect(lang(second)).toBeUndefined();
  }, 60_000);
});

describe('requests the bridge cannot follow', () => {
  it('per-type files for a recipe without "overrides_dir"', async () => {
    const recipe = { ...irRecipe() };
    delete recipe.overrides_dir;
    const error = failure(await api.convert({ recipe, overrides: { x: {} }, sources: {}, output: 'zip' }));
    expect(error).toMatchObject({ kind: 'bridge', type: 'BadRequest' });
  });

  it('a type id or a source that leads out of the recipe\'s place', async () => {
    expect(failure(await api.convert({ recipe: irRecipe(), overrides: { '../x': {} }, sources: {}, output: 'zip' }))).toMatchObject({ kind: 'bridge', type: 'BadRequest' });
    expect(failure(await api.convert({ recipe: irRecipe(), sources: { '../../../etc/x.zip': new Uint8Array() }, output: 'zip' }))).toMatchObject({ kind: 'bridge', type: 'BadRequest' });
  });
});

describe.skipIf(!havePython)('suggest_floor = floorgen.generate', () => {
  it('gives floorgen\'s zones for the example coach at the level given', async () => {
    const obj = new Uint8Array(await readFile(COACH));
    const doors = (JSON.parse(await readFile(COACH_TYPE, 'utf8')) as { doors: unknown[] }).doors;
    const options = { level: 1.3 };
    const started = performance.now();
    const ours = value(await api.suggestFloor(obj, options, doors));
    console.info(`suggest_floor, example coach: ${(performance.now() - started).toFixed(0)} ms`);
    const theirs = runPythonJson(
      [
        'import json, floorgen',
        'f = floorgen.generate(open(sys.argv[1], "rb").read(), floorgen.FloorConfig(json.loads(sys.argv[2])), json.load(open(sys.argv[3]))["doors"])',
        'print(json.dumps({"interior": f.interior, "levels": [floorgen.y_to_obj(l) for l in f.levels], "notes": f.notes,',
        '                  "regionArea": f.region.area(), "droppedArea": f.dropped_area}))',
      ].join('\n'),
      [COACH, JSON.stringify(options), COACH_TYPE],
    );
    expect(ours).toEqual(theirs);
    expect(ours.levels).toEqual([1.3]);
    expect(ours.interior.length).toBeGreaterThan(5);
  }, 60_000);
});

describe('suggest_floor failures come as structures', () => {
  it('a FloorConfigError, naming the member', async () => {
    const error = failure(await api.suggestFloor(COACH_OBJ, { bogus: 1 }, []));
    expect(error).toMatchObject({ kind: 'python', type: 'FloorConfigError' });
    expect(error.message).toContain('unknown key(s)');
    expect(error.text).toBe(error.message);
    expect(error.traceback).toMatch(/Traceback[\s\S]*FloorConfigError/);
  });

  it('a level with no floor: a ValueError', async () => {
    const error = failure(await api.suggestFloor(COACH_OBJ, { level: 7 }, []));
    expect(error).toMatchObject({ kind: 'python', type: 'ValueError' });
    expect(error.message).toContain('no up-facing surface near level');
  });
});

describe.skipIf(!havePython)('model_doors and rewrite_references = the converter\'s', () => {
  it('finds the doors the converter finds', async () => {
    const ours = value(await api.modelDoors(COACH_OBJ, ['DOORA']));
    const theirs = runPythonJson(
      'import ir2rwat, json\nprint(json.dumps(ir2rwat.model_doors(ir2rwat.parse_obj(sys.stdin.buffer.read() if False else open(sys.argv[1], "rb").read())[3], {"doora"})))',
      [await diskFile('coach.obj', COACH_OBJ)],
    );
    expect(ours).toEqual(theirs);
    expect(ours.map((d) => d.id).sort()).toEqual(['DoorA', 'door_1', 'door_3'].sort());
  });

  it('rewrites the lines the converter rewrites, and says when nothing moves', async () => {
    const mtl = new TextEncoder().encode('newmtl a\r\n  map_Kd Old Name.png\r\nnewmtl b\nmap_Kd keep.png\n');
    const moved = { 'Old Name.png': 'old_name.png' };
    const ours = value(await api.rewriteReferences(mtl, 'map_Kd', moved));
    const theirs = runPythonJson(
      'import ir2rwat, json\nout = ir2rwat.rewrite_references(open(sys.argv[1], "rb").read(), "map_Kd", json.loads(sys.argv[2]))\nprint(json.dumps(list(out)))',
      [await diskFile('a.mtl', mtl), JSON.stringify(moved)],
    ) as number[];
    expect(ours).toEqual(new Uint8Array(theirs));
    expect(value(await api.rewriteReferences(mtl, 'map_Kd', {}))).toBeNull();
  });
});

async function diskFile(name: string, bytes: Uint8Array): Promise<string> {
  await writeFolder(scratch, { [name]: bytes });
  return join(scratch, name);
}
