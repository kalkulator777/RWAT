/**
 * The model pipeline (./build.ts through ./api.ts, as the worker runs it) on the example
 * pack and on small models: the roles of the example coach's and shunter's objects are the
 * engine's (golden model_parts, the cases the engine wrote from the same files), the
 * buffers hold every face, the textures and liveries are found as the game finds them,
 * and a model that can't be read is one finding.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import conventions from '../../../schema/obj-conventions.json';
import { MemoryPack } from '../io';
import { NodeFsSource } from '../io/nodeFs.node';
import { drawn, PLACES, type Role } from '../ports/modelParts';
import { EXAMPLE_PACK, GOLDEN_DIR } from '../testing/repo.node';
import { createModelApi } from './api';
import { roleId } from './build';
import { sourceFiles, type ModelFiles } from './files';
import type { LoadedModel } from '../core/contracts';
import type { ModelReader, ModelRequest } from './types';

/** A bitmap stand-in: Node decodes no images. */
const fakeDecode = (bytes: Uint8Array, path: string): Promise<ImageBitmap> => Promise.resolve({ path, size: bytes.length } as unknown as ImageBitmap);

const api = createModelApi(fakeDecode);

function reader(files: ModelFiles): ModelReader {
  return {
    read: async (path) => ((await files.has(path)) ? files.read(path) : null),
    has: async (path) => files.has(path),
  };
}

const example = sourceFiles(new NodeFsSource(EXAMPLE_PACK));

function exampleRequest(name: string): ModelRequest {
  const file = `assets/rwat_example/wagon_models/${name}.json`;
  return { id: `rwat_example:${name}`, file, declaration: JSON.parse(readFileSync(`${EXAMPLE_PACK}/${file}`, 'utf8')) as unknown };
}

async function loadExample(name: string): Promise<LoadedModel> {
  return api.load(exampleRequest(name), reader(await example));
}

interface GoldenPart {
  object: string;
  place: Role['place'];
  front: boolean;
  owner: string | null;
  index: number;
  light: [number, boolean, boolean, boolean];
}

const goldenCases = (
  JSON.parse(readFileSync(`${GOLDEN_DIR}/model_parts/parts.json`, 'utf8')) as {
    cases: { id: string; expected: { parts: GoldenPart[]; light_groups: string[]; controls: { key: string }[]; doors: { id: string }[] } }[];
  }
).cases;

/** Each object of a golden case with the role of its first drawn part, else its first part, in the order objects come. */
function goldenObjects(id: string): { name: string; place: string; front: boolean; owner: string | null; index: number; light: unknown }[] {
  const found = goldenCases.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no golden case ${id}`);
  const byName = new Map<string, GoldenPart>();
  for (const part of found.expected.parts) {
    const first = byName.get(part.object);
    if (first === undefined || (!drawn(first.place) && drawn(part.place))) byName.set(part.object, part);
  }
  return [...byName.values()].map((p) => ({
    name: p.object,
    place: p.place,
    front: p.front,
    owner: p.owner,
    index: p.index,
    light: { group: p.light[0], fullbright: p.light[1], interior: p.light[2], invert: p.light[3] },
  }));
}

function triangles(obj: string): number {
  let count = 0;
  for (const line of obj.split('\n')) if (line.startsWith('f ')) count += line.trim().split(/\s+/).length - 3;
  return count;
}

describe('the example pack through the model worker', () => {
  for (const [name, caseId] of [
    ['shunter', 'example-pack-shunter'],
    ['coach', 'example-pack-coach'],
    ['gondola', 'example-pack-gondola'],
  ] as const) {
    it(`gives the ${name}'s objects the roles the engine gives them (golden ${caseId})`, async () => {
      const model = await loadExample(name);
      expect(model.problems).toEqual([]);
      const objects = model.objects.map((o) => ({ name: o.name, ...o.engine }));
      expect(objects).toEqual(goldenObjects(caseId));
      for (const o of model.objects) expect(o.role).toBe(roleId(o.engine.place, o.engine.front));
      const expected = goldenCases.find((c) => c.id === caseId)!.expected;
      expect(model.engine?.lightGroups).toEqual(expected.light_groups);
      expect(model.engine?.controls.map((c) => c.role.key)).toEqual(expected.controls.map((c) => c.key));
      expect(model.engine?.doors.map((d) => d.id)).toEqual(expected.doors.map((d) => d.id));
    });
  }

  it('builds the triangles of every face, by object and material, as the file has them', async () => {
    const model = await loadExample('coach');
    const obj = readFileSync(`${EXAMPLE_PACK}/assets/rwat_example/stock/coach/coach.obj`, 'utf8');
    const total = model.parts.reduce((sum, part) => sum + part.positions.length / 9, 0);
    expect(total).toBe(triangles(obj));
    for (const part of model.parts) {
      expect(part.normals.length).toBe(part.positions.length);
      expect(part.uvs.length / 2).toBe(part.positions.length / 3);
    }
    const keys = model.parts.map((part) => `${part.object}/${part.material}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(model.parts[0]).toMatchObject({ object: 'BODY_SIDES', material: 'body', texture: 'assets/rwat_example/stock/coach/coach_body.png', role: 'body', drawn: true });
    // a part is drawn as the engine draws it: the guide floors of `skip` are not
    expect(model.parts.filter((part) => !part.drawn).map((part) => part.role)).toEqual(expect.arrayContaining(['skip']));
    for (const part of model.parts) expect(part.drawn, part.object).toBe(!['hidden', 'skip', 'untextured'].includes(part.role));
  });

  it('decodes the textures its parts use, by pack path, a texture next to the OBJ and one in a sibling folder', async () => {
    const model = await loadExample('coach');
    expect(Object.keys(model.textures)).toEqual(expect.arrayContaining(['assets/rwat_example/stock/coach/coach_body.png', 'assets/rwat_example/stock/common/black.png']));
    for (const [path, bitmap] of Object.entries(model.textures)) expect(bitmap, path).toMatchObject({ path });
    const used = new Set(model.parts.map((part) => part.texture).filter((texture) => texture !== null));
    expect(new Set(Object.keys(model.textures))).toEqual(used);
  });

  it('gives the animated door its tracks and the livery the textures it replaces', async () => {
    const model = await loadExample('coach');
    expect(Object.keys(model.animations)).toEqual(['salon_door']);
    const tracks = model.animations.salon_door!;
    expect(Object.keys(tracks)).toContain('SALON_DOOR_LEAF_INTERIOR_LCG_IL');
    expect(tracks.SALON_DOOR_LEAF_INTERIOR_LCG_IL![0]).toHaveLength(16);
    expect(model.liveries).toEqual({
      blue: {
        'assets/rwat_example/stock/coach/coach_body.png': 'assets/rwat_example/stock/coach/l_blue/coach_body.png',
        'assets/rwat_example/stock/coach/coach_door.png': 'assets/rwat_example/stock/coach/l_blue/coach_door.png',
      },
    });
  });

  it('says which materials have a texture, the skip of the declaration and the objects the .anims move', async () => {
    const model = await loadExample('coach');
    expect(model.materials).toMatchObject({
      body: 'assets/rwat_example/stock/coach/coach_body.png',
      black: 'assets/rwat_example/stock/common/black.png',
    });
    for (const part of model.parts) expect(part.texture).toBe(model.materials[part.material] ?? null);
    expect(model.skip).toEqual(['GUIDE_']);
    expect(Object.keys(model.animated).length).toBeGreaterThan(0);
    expect(new Set(Object.values(model.animated))).toEqual(new Set(['salon_door']));
    expect(Object.keys(model.animated).sort()).toEqual(Object.keys(model.animations.salon_door!).sort());
  });

  it('gives a door leaf object its leaf, merged as the engine builds it', async () => {
    const model = await loadExample('coach');
    const leaf = model.objects.find((o) => o.engine.place === 'DOOR_LEAF');
    expect(leaf?.control).toMatchObject({ kind: 'DOOR', key: leaf?.engine.owner });
  });

  it('gives a control object the control as the engine merges it, and a lit object its group', async () => {
    const model = await loadExample('shunter');
    const throttle = model.objects.find((o) => o.engine.place === 'CONTROL' && o.engine.owner === 'THROTTLE_1');
    expect(throttle?.control).toMatchObject({ kind: 'THROTTLE', key: 'THROTTLE_1' });
    const cabLamp = model.objects.find((o) => o.name === 'CAB_LAMP_FULLBRIGHT_LCG_IL');
    expect(cabLamp).toMatchObject({ lightGroup: 'IL', engine: { light: { fullbright: true } } });
    const [min, max] = cabLamp!.bbox;
    for (let axis = 0; axis < 3; axis++) expect(min[axis]).toBeLessThanOrEqual(max[axis]!);
  });

  it('hands the buffers over for transfer, each once', async () => {
    const built = await createModelApi(() => Promise.resolve(null)).load(exampleRequest('gondola'), reader(await example));
    expect(Object.values(built.textures).every((bitmap) => bitmap === null)).toBe(true);
    expect(built.parts.length).toBeGreaterThan(0);
  });
});

describe('role ids', () => {
  it('names a role of schema/obj-conventions.json for every place', () => {
    const ids = new Set(conventions.roles.map((role) => role.id));
    for (const place of PLACES) for (const front of [true, false]) expect(ids, `${place}`).toContain(roleId(place, front));
  });
});

/** A model of one object (a quad and a triangle) in a pack of its own, with the given MTL and declaration. */
function smallPack(options: { obj?: string; mtl?: string; declaration?: unknown; files?: Record<string, string> } = {}): {
  files: Promise<ModelFiles>;
  request: ModelRequest;
} {
  const obj =
    options.obj ??
    ['mtllib m.mtl', 'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'vt 0 0.25', 'vt 1 0.25', 'vt 1 1', 'o BODY', 'usemtl paint', 'f 1/1 2/2 3/3 4/1', 'f 1/1 2/2 3/3', ''].join('\n');
  const pack = new MemoryPack('small', {
    'assets/t/stock/m.obj': obj,
    'assets/t/stock/m.mtl': options.mtl ?? 'newmtl paint\nmap_Kd paint.png\n',
    'assets/t/stock/paint.png': 'png',
    ...options.files,
  });
  return {
    files: sourceFiles(pack),
    request: { id: 't:m', file: 'assets/t/wagon_models/m.json', declaration: options.declaration ?? { obj: 'stock/m.obj' } },
  };
}

async function loadSmall(options: Parameters<typeof smallPack>[0] = {}): Promise<LoadedModel> {
  const { files, request } = smallPack(options);
  return api.load(request, reader(await files));
}

describe('a small model', () => {
  it('makes a quad two triangles and a triangle one, the V of the file kept', async () => {
    const model = await loadSmall();
    expect(model.parts).toHaveLength(1);
    const part = model.parts[0]!;
    expect(part.positions.length / 9).toBe(3);
    expect(Array.from(part.positions.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    expect(Array.from(part.positions.slice(9, 18))).toEqual([0, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect(Array.from(part.uvs.slice(0, 6))).toEqual([0, 0.25, 1, 0.25, 1, 1]);
    expect(Array.from(part.normals.slice(0, 3))).toEqual([0, 1, 0]);
    expect(model.objects).toEqual([
      expect.objectContaining({ name: 'BODY', role: 'body', bbox: [[0, 0, 0], [1, 1, 0]], engine: expect.objectContaining({ place: 'BODY' }) as unknown }),
    ]);
  });

  it('takes a texture that is missing as a texture, and a path Minecraft refuses as none', async () => {
    const missing = await loadSmall({ mtl: 'newmtl paint\nmap_Kd gone.png\n' });
    expect(missing.objects[0]?.role).toBe('body');
    expect(missing.textures).toEqual({ 'assets/t/stock/gone.png': null });
    const refused = await loadSmall({ mtl: 'newmtl paint\nmap_Kd Paint.png\n' });
    expect(refused.objects[0]?.role).toBe('untextured');
    expect(refused.parts[0]?.texture).toBeNull();
    expect(refused.textures).toEqual({});
  });

  it('draws nothing when the MTL is missing, and nothing breaks', async () => {
    const model = await loadSmall({ obj: ['mtllib none.mtl', 'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'o BODY', 'usemtl paint', 'f 1 2 3', ''].join('\n') });
    expect(model.problems).toEqual([]);
    expect(model.objects[0]?.role).toBe('untextured');
  });

  it('leaves the objects of a missing or broken .anim in the body', async () => {
    const obj = ['mtllib m.mtl', 'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'o LEAF', 'usemtl paint', 'f 1 2 3', ''].join('\n');
    const track = `O LEAF\nM ${Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)).join(',')}\n`;
    const moved = await loadSmall({ obj, declaration: { obj: 'stock/m.obj', animations: { Door: 'stock/d.anim' } }, files: { 'assets/t/stock/d.anim': track } });
    expect(moved.objects[0]).toMatchObject({ role: 'anim_object', engine: { owner: 'door' } });
    expect(Object.keys(moved.animations.door ?? {})).toEqual(['LEAF']);
    const broken = await loadSmall({ obj, declaration: { obj: 'stock/m.obj', animations: { door: 'stock/d.anim' } }, files: { 'assets/t/stock/d.anim': 'O LEAF\nM 1,2\n' } });
    expect(broken.objects[0]?.role).toBe('body');
    const missing = await loadSmall({ obj, declaration: { obj: 'stock/m.obj', animations: { door: 'stock/none.anim', other: 'Bad Path' } } });
    expect(missing.objects[0]?.role).toBe('body');
    expect(missing.animations).toEqual({});
  });

  it('names the leaf of a hinge marker that nothing draws, and no control for a body door', async () => {
    const obj = ['mtllib m.mtl', 'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'o DOOR_1_ROT_90', 'usemtl bare', 'f 1 2 3', 'o DOOR_2_EXTERNAL', 'usemtl paint', 'f 1 2 3', ''].join('\n');
    const model = await loadSmall({ obj });
    expect(model.objects[0]).toMatchObject({ role: 'untextured', engine: { owner: 'DOOR_1', index: -1 }, control: { kind: 'DOOR', key: 'DOOR_1' } });
    expect(model.parts.map((part) => [part.object, part.drawn])).toEqual([
      ['DOOR_1_ROT_90', false],
      ['DOOR_2_EXTERNAL', true],
    ]);
    expect(model.objects[1]).toMatchObject({ role: 'body' });
    expect(model.objects[1]?.control).toBeUndefined();
    expect(model.materials).toEqual({ paint: 'assets/t/stock/paint.png' });
  });

  it('is one finding when it cannot be read, with nothing to draw', async () => {
    const cases: [Parameters<typeof smallPack>[0], string, string][] = [
      [{ declaration: { obj: 'stock/m.obj', bogies: [] } }, 'model.bad-declaration', "assets/t/wagon_models/m.json: 'bogies' must list at least one pivot offset"],
      [{ declaration: { obj: 'stock/M.obj' } }, 'model.bad-path', "model path 't:stock/M.obj' is not a valid resource location"],
      [{ declaration: { obj: 'stock/none.obj' } }, 'model.missing', 'model file t:stock/none.obj not found'],
      [{ obj: 'v 0 0 0\nf 1 2 3\n' }, 'model.unreadable', "model t:stock/m.obj can't be read: line 2: the corner '2' names 2 of 1"],
    ];
    for (const [options, code, text] of cases) {
      const model = await loadSmall(options);
      expect(model.problems, code).toEqual([expect.objectContaining({ severity: 'error', source: 'model', code, text })]);
      expect(model).toMatchObject({ parts: [], objects: [], textures: {}, engine: null, materials: {}, skip: [], animated: {} });
    }
  });

  it('is one finding when the pack fails to read the OBJ', async () => {
    const { request } = smallPack();
    const failing: ModelReader = { read: () => Promise.reject(new Error('disk gone')), has: () => Promise.resolve(true) };
    const model = await api.load(request, failing);
    expect(model.problems).toEqual([expect.objectContaining({ code: 'model.unreadable', text: "model t:stock/m.obj can't be read: Error: disk gone" })]);
  });

  it('decodes textures asked for by path, a missing or broken one as null', async () => {
    const { files } = smallPack();
    const broken = createModelApi((_bytes, path) => (path.endsWith('bad.png') ? Promise.reject(new Error('no image')) : fakeDecode(_bytes, path)));
    const pack = await files;
    const bitmaps = await broken.textures(['assets/t/stock/paint.png', 'assets/t/stock/none.png', 'assets/t/stock/paint.png'], reader(pack));
    expect(Object.keys(bitmaps)).toEqual(['assets/t/stock/paint.png', 'assets/t/stock/none.png']);
    expect(bitmaps['assets/t/stock/none.png']).toBeNull();
    const withBad = smallPack({ files: { 'assets/t/stock/bad.png': 'x' } });
    expect(await broken.textures(['assets/t/stock/bad.png'], reader(await withBad.files))).toEqual({ 'assets/t/stock/bad.png': null });
  });
});
