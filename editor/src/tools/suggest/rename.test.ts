// @vitest-environment node
/**
 * «Переименовать и переписать ссылки» (./rename.ts, ./repair.ts) on a pack made here, of our
 * own bytes, with paths Minecraft refuses — `Textures/Body Map.png` and its kin — the rewrite
 * of the references the converter's own `rewrite_references` (Pyodide in Node): the plan is
 * what changes before anything does; applied, the checks are clean, the model reads, and one
 * undo gives every file back byte for byte. The rule of the names is compared with the
 * converter's `resource_part` run by `python3`.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loaderProblems } from '../../checks/loader';
import { dump } from '../../core/json';
import type { Pack } from '../../core/pack';
import { setLang } from '../../i18n';
import type { PythonBridge } from '../../ir/bridge';
import { havePython, runPythonJson } from '../../ir/testing.node';
import { exampleApi } from '../../model/testing.node';
import { useSuggestBridge } from './bridge';
import { createRepair } from './repair';
import { isEmptyPlan, mtllibs, planRename, referenceCount, relativeTo, renameCommand, resourcePart } from './rename';
import { fakeBridge, packOf, realBridge } from './testing.node';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);

const OBJ = 'mtllib Box Mats.mtl\r\no BODY\r\nv 0 0 0\r\nv 1 0 0\r\nv 1 1 0\r\nusemtl body\r\nf 1 2 3\r\n';
const MTL = 'newmtl body\nmap_Kd Textures/Body Map.png\nnewmtl glass\r\n  map_Kd ../Common/Glass.PNG\r\nnewmtl keep\nmap_Kd fine.png\n';

/** A pack whose files are named the way a Blender export names them. */
function badFiles(): Record<string, string | Uint8Array> {
  return {
    'pack.mcmeta': '{"pack": {"pack_format": 34, "description": "t"}}',
    'data/t/wagon_types/box.json': dump({ length: 10, bogies: [3, -3], mass_t: 20, max_speed_kmh: 100 }),
    'assets/t/wagon_models/box.json': dump({
      obj: 'stock/Box/Box Model.obj',
      liveries: { red: 'Livery Red' },
      sounds: { horn: 'sounds/Big Horn.ogg', clack: 'minecraft:block.chain.step' },
    }),
    'assets/t/stock/Box/Box Model.obj': OBJ,
    'assets/t/stock/Box/Box Mats.mtl': MTL,
    'assets/t/stock/Box/Textures/Body Map.png': PNG,
    'assets/t/stock/Box/fine.png': PNG,
    'assets/t/stock/Common/Glass.PNG': new Uint8Array([1, 2, 3, 4]),
    'assets/t/stock/Box/Livery Red/Body Map.png': new Uint8Array([9, 9, 9]),
    'assets/t/sounds/Big Horn.ogg': new Uint8Array([79, 103, 103, 83]),
  };
}

let bridge: PythonBridge;

beforeAll(() => {
  bridge = realBridge();
  setLang('en');
});

afterEach(() => {
  useSuggestBridge(null);
});

describe('the new name of a part of a path', () => {
  const names = ['Body Map.png', 'Glass.PNG', 'File (1).Png', 'ÄÖ ü.png', 'a b', '😀x😀.png', 'İstanbul', 'ẞ', 'x–y', 'A.B-c_D', '', '.hidden', 'CON.PNG'];

  it.skipIf(!havePython)('is the converter’s resource_part: lower case, every other character an underscore, by code point', () => {
    const theirs = runPythonJson('import ir2rwat, json\nprint(json.dumps([ir2rwat.resource_part(p) for p in json.loads(sys.argv[1])]))', [JSON.stringify(names)]) as string[];
    expect(names.map(resourcePart)).toEqual(theirs);
  });

  it('is lower case with underscores', () => {
    expect(resourcePart('Body Map.png')).toBe('body_map.png');
    expect(resourcePart('😀x')).toBe('_x');
  });

  it.skipIf(!havePython)('relativeTo is posixpath.relpath inside the namespace', () => {
    const pairs = [['stock/box', 'stock/box/a.png'], ['stock/box', 'stock/common/g.png'], ['', 'a/b.png'], ['a/b/c', 'a/x.png'], ['stock/box', 'stock/box/livery/l']];
    const theirs = runPythonJson('import posixpath, json\nprint(json.dumps([posixpath.relpath(path, folder or ".") for folder, path in json.loads(sys.argv[1])]))', [JSON.stringify(pairs)]);
    expect(pairs.map(([folder, path]) => relativeTo(folder as string, path as string))).toEqual(theirs);
  });

  it('the mtllib lines of an OBJ are those the converter’s rewrite reads', () => {
    expect(mtllibs('mtllib A B.mtl\r\n  mtllib  C.mtl \no x\nmtllib A B.mtl\n# mtllib D.mtl\nmtllibx E.mtl\n')).toEqual(['A B.mtl', 'C.mtl']);
  });
});

describe('the plan: what would change, before anything does', () => {
  it('renames every file with a path Minecraft refuses, rewrites the lines and strings that name them, and changes nothing', async () => {
    const { pack } = await packOf(badFiles());
    const plan = await planRename(pack);
    expect(plan.renames).toEqual([
      { from: 'assets/t/sounds/Big Horn.ogg', to: 'assets/t/sounds/big_horn.ogg' },
      { from: 'assets/t/stock/Box/Box Mats.mtl', to: 'assets/t/stock/box/box_mats.mtl' },
      { from: 'assets/t/stock/Box/Box Model.obj', to: 'assets/t/stock/box/box_model.obj' },
      { from: 'assets/t/stock/Box/Livery Red/Body Map.png', to: 'assets/t/stock/box/livery_red/body_map.png' },
      { from: 'assets/t/stock/Box/Textures/Body Map.png', to: 'assets/t/stock/box/textures/body_map.png' },
      { from: 'assets/t/stock/Box/fine.png', to: 'assets/t/stock/box/fine.png' },
      { from: 'assets/t/stock/Common/Glass.PNG', to: 'assets/t/stock/common/glass.png' },
    ]);
    expect(plan.skipped).toEqual([]);
    // paths relative to the OBJ’s folder, as the engine reads them; the one that stays valid is not touched
    expect(plan.texts).toEqual([
      { file: 'assets/t/stock/Box/Box Model.obj', target: 'assets/t/stock/box/box_model.obj', keyword: 'mtllib', moved: { 'Box Mats.mtl': 'box_mats.mtl' } },
      {
        file: 'assets/t/stock/Box/Box Mats.mtl',
        target: 'assets/t/stock/box/box_mats.mtl',
        keyword: 'map_Kd',
        moved: { 'Textures/Body Map.png': 'textures/body_map.png', '../Common/Glass.PNG': '../common/glass.png' },
      },
    ]);
    expect(plan.jsons).toEqual([
      { file: 'assets/t/wagon_models/box.json', at: '/obj', from: 'stock/Box/Box Model.obj', to: 'stock/box/box_model.obj' },
      { file: 'assets/t/wagon_models/box.json', at: '/sounds/horn', from: 'sounds/Big Horn.ogg', to: 'sounds/big_horn.ogg' },
      { file: 'assets/t/wagon_models/box.json', at: '/liveries/red', from: 'Livery Red', to: 'livery_red' },
    ]);
    expect(referenceCount(plan)).toBe(6);
    expect(plan.version).toBe(pack.version);
    expect(pack.dirtyPaths()).toEqual([]);
  });

  it('says why a file keeps its name: a namespace, a declaration, a name taken, two files for one name', async () => {
    const { pack } = await packOf({
      'pack.mcmeta': '{"pack": {"pack_format": 34}}',
      'assets/My Pack/x.png': PNG,
      'assets/t/wagon_models/Foo.json': '{}',
      'assets/t/lang/EN_us.json': '{}',
      'data/t/wagon_types/Foo.json': '{}',
      'assets/t/a.png': PNG,
      'assets/t/A.png': PNG,
      'assets/t/Ab.png': PNG,
      'assets/t/AB.png': PNG,
    });
    const plan = await planRename(pack);
    expect(plan.renames).toEqual([]);
    const reasons = Object.fromEntries(plan.skipped.map((skip) => [skip.path, skip.reason]));
    expect(reasons).toEqual({
      'assets/My Pack/x.png': 'namespace',
      'assets/t/wagon_models/Foo.json': 'declaration',
      'assets/t/lang/EN_us.json': 'declaration',
      'data/t/wagon_types/Foo.json': 'declaration',
      'assets/t/A.png': 'exists',
      'assets/t/Ab.png': 'clash',
      'assets/t/AB.png': 'clash',
    });
    expect(plan.skipped.find((skip) => skip.path === 'assets/t/A.png')?.to).toBe('assets/t/a.png');
    expect(isEmptyPlan(plan)).toBe(true);
  });

  it('reads no OBJ when no file moves, and leaves an MTL several models share, with different paths in it, to the author', async () => {
    const files = badFiles();
    const pack = (await packOf({ 'pack.mcmeta': '{"pack": {"pack_format": 34}}', 'assets/t/m/one.obj': OBJ.replace('Box Mats.mtl', 'x.mtl') })).pack;
    const reads: string[] = [];
    const watching: Pick<Pack, 'paths' | 'has' | 'json' | 'text' | 'version'> = {
      paths: () => pack.paths(),
      has: (path) => pack.has(path),
      json: (path) => pack.json(path),
      text: (path) => {
        reads.push(path);
        return pack.text(path);
      },
      version: pack.version,
    };
    expect(isEmptyPlan(await planRename(watching))).toBe(true);
    expect(reads).toEqual([]);

    // one MTL, two OBJs: `Tex.png` is a file to rename in the first’s folder and a file that stays in the second’s
    const shared = (
      await packOf({
        'pack.mcmeta': files['pack.mcmeta']!,
        'assets/t/m/shared.mtl': 'newmtl a\nmap_Kd Tex.png\n',
        'assets/t/m/A/one.obj': 'mtllib ../shared.mtl\n',
        'assets/t/m/B/two.obj': 'mtllib ../shared.mtl\n',
        'assets/t/m/A/Tex.png': PNG,
        'assets/t/m/B/Tex.png': PNG,
        'assets/t/m/B/tex.png': PNG,
      })
    ).pack;
    const plan = await planRename(shared);
    expect(plan.notes).toEqual([{ kind: 'shared', file: 'assets/t/m/shared.mtl' }]);
    expect(plan.texts.filter((entry) => entry.keyword === 'map_Kd')).toEqual([]);
  });

  it('warns that sounds.json may name a renamed sound by its old name', async () => {
    const { pack } = await packOf({
      'pack.mcmeta': '{"pack": {"pack_format": 34}}',
      'assets/t/sounds/Big Horn.ogg': PNG,
      'assets/t/sounds.json': dump({ horn: { sounds: ['t:Big Horn'] } }),
    });
    const plan = await planRename(pack);
    expect(plan.notes).toEqual([{ kind: 'sounds', file: 'assets/t/sounds.json', sound: 'assets/t/sounds/Big Horn.ogg' }]);
  });
});

describe('applied through the converter’s rewrite_references', () => {
  /** The pack, the journal and a repair that applies commands as the shell does (`run`: what the undo needs is read first). */
  async function repairing(files: Record<string, string | Uint8Array> = badFiles()) {
    const { pack, journal } = await packOf(files);
    useSuggestBridge(bridge);
    const repair = createRepair(async (command) => {
      await journal.run(command);
      return true;
    });
    return { pack, journal, repair, original: new Map(pack.paths().map((path) => [path, path] as const)) };
  }

  /** Every file of the pack: path → bytes as saving writes them. */
  async function snapshot(pack: Pack): Promise<Map<string, Uint8Array>> {
    return new Map((await pack.snapshot()).map((change) => [change.path, 'bytes' in change ? change.bytes : new Uint8Array()]));
  }

  it('renames the files and rewrites the references, one entry of the journal; the checks are clean, the model reads', async () => {
    const { pack, journal, repair } = await repairing();
    const before = await snapshot(pack);
    const reader = { read: async (path: string) => (pack.has(path) ? pack.bytes(path) : null), has: (path: string) => Promise.resolve(pack.has(path)) };
    const load = (): ReturnType<typeof exampleApi.load> => exampleApi.load({ id: 't:box', file: 'assets/t/wagon_models/box.json', declaration: pack.json('assets/t/wagon_models/box.json') }, reader);
    // before: Minecraft refuses the files, and the model path is no resource location
    expect(loaderProblems(pack).filter((problem) => problem.code === 'loader.resource-path')).toHaveLength(7);
    expect((await load()).problems.map((problem) => problem.code)).toContain('model.bad-path');

    await repair.review(pack);
    expect(repair.state.value).toMatchObject({ phase: 'plan', changed: false });
    expect(await repair.apply(pack)).toBe(true);
    expect(repair.state.value).toEqual({ phase: 'done', files: 7, refs: 6 });
    expect(journal.state().done).toHaveLength(1);
    expect(journal.state().done[0]).toMatchObject({ label: 'tools.suggest.cmd.rename', labelParams: { files: 7, refs: 6 } });

    // the paths are valid; the references follow; every other byte of the OBJ and the MTL is as it was
    expect(loaderProblems(pack).filter((problem) => problem.code === 'loader.resource-path')).toEqual([]);
    expect(pack.paths()).toEqual(
      [
        'assets/t/sounds/big_horn.ogg',
        'assets/t/stock/box/box_mats.mtl',
        'assets/t/stock/box/box_model.obj',
        'assets/t/stock/box/fine.png',
        'assets/t/stock/box/livery_red/body_map.png',
        'assets/t/stock/box/textures/body_map.png',
        'assets/t/stock/common/glass.png',
        'assets/t/wagon_models/box.json',
        'data/t/wagon_types/box.json',
        'pack.mcmeta',
      ].sort(),
    );
    expect(await pack.text('assets/t/stock/box/box_model.obj')).toBe(OBJ.replace('mtllib Box Mats.mtl', 'mtllib box_mats.mtl'));
    expect(await pack.text('assets/t/stock/box/box_mats.mtl')).toBe(MTL.replace('Textures/Body Map.png', 'textures/body_map.png').replace('../Common/Glass.PNG', '../common/glass.png'));
    expect(await pack.bytes('assets/t/stock/box/textures/body_map.png')).toEqual(PNG);
    expect(pack.json('assets/t/wagon_models/box.json')).toEqual({
      obj: 'stock/box/box_model.obj',
      liveries: { red: 'livery_red' },
      sounds: { horn: 'sounds/big_horn.ogg', clack: 'minecraft:block.chain.step' },
    });
    const model = await load();
    expect(model.problems).toEqual([]);
    expect(model.obj).toBe('assets/t/stock/box/box_model.obj');
    expect(model.materials).toEqual({
      body: 'assets/t/stock/box/textures/body_map.png',
      glass: 'assets/t/stock/common/glass.png',
      keep: 'assets/t/stock/box/fine.png',
    });
    expect(model.liveries).toEqual({ red: { 'assets/t/stock/box/textures/body_map.png': 'assets/t/stock/box/livery_red/body_map.png' } });

    // one undo gives it all back, byte for byte
    journal.undo();
    expect(await snapshot(pack)).toEqual(before);
    expect(pack.dirtyPaths()).toEqual([]);
    expect(loaderProblems(pack).filter((problem) => problem.code === 'loader.resource-path')).toHaveLength(7);
    // and redo does it again
    journal.redo();
    expect(loaderProblems(pack).filter((problem) => problem.code === 'loader.resource-path')).toEqual([]);
  }, 60_000);

  it('asks Python only when a line has to be rewritten: renaming a lone texture loads nothing', async () => {
    const spy = fakeBridge();
    useSuggestBridge(spy);
    const { pack, journal } = await packOf({ 'pack.mcmeta': '{"pack": {"pack_format": 34}}', 'assets/t/stock/Lone Texture.png': PNG });
    const repair = createRepair(async (command) => {
      await journal.run(command);
      return true;
    });
    await repair.review(pack);
    expect(await repair.apply(pack)).toBe(true);
    expect(spy.calls).toEqual([]);
    expect(pack.has('assets/t/stock/lone_texture.png')).toBe(true);
    expect(journal.state().done).toHaveLength(1);
  });

  it('shows a new plan, and applies nothing, when the pack changed after the list was made', async () => {
    const { pack, journal, repair } = await repairing();
    await repair.review(pack);
    journal.dispatch({ label: 'x', ops: [{ op: 'set', file: 'data/t/wagon_types/box.json', at: '/mass_t', value: 25 }] });
    expect(await repair.apply(pack)).toBe(false);
    expect(repair.state.value).toMatchObject({ phase: 'plan', changed: true });
    expect(journal.state().done).toHaveLength(1);
    expect(await repair.apply(pack)).toBe(true);
    expect(journal.state().done).toHaveLength(2);
  }, 60_000);

  it('stops at Cancel: nothing is applied', async () => {
    const spy = fakeBridge();
    useSuggestBridge(spy);
    const { pack, journal } = await packOf(badFiles());
    const repair = createRepair(async (command) => {
      await journal.run(command);
      return true;
    });
    await repair.review(pack);
    const applied = repair.apply(pack);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(repair.running.value).not.toBeNull();
    repair.cancel();
    expect(await applied).toBe(false);
    expect(repair.state.value.phase).toBe('plan');
    expect(journal.state().done).toEqual([]);
    expect(pack.dirtyPaths()).toEqual([]);
  });

  it('the command of a plan with no rewritten text leaves the OBJ alone', async () => {
    const { pack } = await packOf(badFiles());
    const plan = await planRename(pack);
    const command = renameCommand(plan, new Map());
    expect(command.ops.filter((op) => op.op === 'putFile')).toEqual([]);
    expect(command.ops.filter((op) => op.op === 'renameFile')).toHaveLength(7);
  });
});
