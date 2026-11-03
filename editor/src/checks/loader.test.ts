import { describe, expect, it } from 'vitest';
import { dump } from '../core/json';
import { Pack } from '../core/pack';
import { filesOf, MemorySource, readTree } from '../core/pack/testing.node';
import { createSchema } from '../core/schema';
import { readSchemaFiles } from '../core/schema/files.node';
import { EXAMPLE_PACK } from '../testing/repo.node';
import { isBadResourcePath, loaderProblems, resourceFile } from './loader';
import { checkPack } from './pack';

const MCMETA = dump({ pack: { pack_format: 34, description: 'x' }, rwat: { format: 1 } });
const TYPE = 'data/ns/wagon_types/coach.json';
const MODEL = 'assets/ns/wagon_models/coach.json';

async function packOf(texts: Record<string, string | Uint8Array>): Promise<Pack> {
  return Pack.open(new MemorySource(filesOf({ 'pack.mcmeta': MCMETA, ...texts })));
}

function codes(pack: Pack): string[] {
  return loaderProblems(pack).map((p) => p.code);
}

const OBJ = 'assets/ns/stock/coach/coach.obj';

describe('the loader rules beyond the schema', () => {
  it('find nothing in the example pack, with the schema too', async () => {
    const pack = await Pack.open(new MemorySource(readTree(EXAMPLE_PACK)));
    expect(loaderProblems(pack)).toEqual([]);
    expect(checkPack(pack, createSchema(readSchemaFiles()))).toEqual([]);
  });

  it('say a type without a model and a model without a type', async () => {
    const pack = await packOf({
      [TYPE]: dump({ length: 20, bogies: [7, -7], mass_t: 40 }),
      'assets/ns/wagon_models/other.json': dump({ obj: 'x.obj' }),
      'assets/ns/x.obj': '',
    });
    expect(loaderProblems(pack)).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'loader.type-without-model',
        params: { id: 'ns:coach', model: MODEL },
        at: [{ kind: 'file', file: TYPE }],
        text: `wagon type 'ns:coach' has no model: it is drawn as a box (declare it in ${MODEL})`,
      }),
      expect.objectContaining({ code: 'loader.model-without-type', params: { id: 'ns:other', type: 'data/ns/wagon_types/other.json' } }),
    ]);
  });

  it('refuse a geometry that makes no wagon, in the words of WagonTypeParser.checkGeometry', async () => {
    const pack = await packOf({
      [TYPE]: dump({ length: 10, bogies: [5, -2, -1.5], mass_t: 40, couplers: { front: 0.5, rear: -5.5 } }),
      [MODEL]: dump({ obj: 'stock/coach/coach.obj' }),
      [OBJ]: '',
    });
    const found = loaderProblems(pack);
    expect(found.map((p) => [p.code, p.at])).toEqual([
      ['loader.bogie-outside', [{ kind: 'field', file: TYPE, at: '/bogies/0' }]],
      ['loader.bogie-order', [{ kind: 'field', file: TYPE, at: '/bogies/2' }]],
      ['loader.coupler-outside', [{ kind: 'field', file: TYPE, at: '/couplers/rear' }]],
    ]);
    expect(found.map((p) => p.text)).toEqual([
      "'bogies[0]' = 5 is outside the body: a pivot must lie within ±length/2 = ±5",
      "'bogies' must run front to back, each pivot behind the one before: 'bogies[2]' = -1.5 is not behind 'bogies[1]' = -2",
      "'couplers.rear' = -5.5 must be under length/2 = 5 in size",
    ]);
    expect(found.every((p) => p.severity === 'error')).toBe(true);
  });

  it('leave a geometry of the wrong types to the schema', async () => {
    const pack = await packOf({ [TYPE]: dump({ length: 'long', bogies: [99], mass_t: 1 }), [MODEL]: dump({ obj: 'stock/coach/coach.obj' }), [OBJ]: '' });
    expect(codes(pack)).toEqual([]);
  });

  it('refuse a cab with both the old and the new chairs', async () => {
    const pack = await packOf({
      [TYPE]: dump({ length: 10, bogies: [2, -2], mass_t: 40, cab: { seat: [0, 1, 0], seats: [] } }),
      [MODEL]: dump({ obj: 'stock/coach/coach.obj' }),
      [OBJ]: '',
    });
    expect(loaderProblems(pack)).toEqual([
      expect.objectContaining({ severity: 'error', code: 'loader.cab-seat-and-seats', at: [{ kind: 'field', file: TYPE, at: '/cab/seat' }] }),
    ]);
  });

  it('warn of animation and door-sound keys that are no door of the type, case aside', async () => {
    const pack = await packOf({
      [TYPE]: dump({ length: 10, bogies: [2, -2], mass_t: 40, doors: [{ id: 'Door_L', min: [0, 0, 0], max: [1, 1, 1] }] }),
      [MODEL]: dump({
        obj: 'stock/coach/coach.obj',
        animations: { door_l: 'stock/coach/coach.obj', door_x: 'stock/coach/coach.obj' },
        sounds: { doors: { DOOR_L: 'minecraft:a', 'a/b': 'minecraft:b' } },
      }),
      [OBJ]: '',
    });
    expect(loaderProblems(pack).map((p) => [p.code, p.params.key, (p.at[0] as { at: string }).at])).toEqual([
      ['loader.door-key', 'door_x', '/animations/door_x'],
      ['loader.door-key', 'a/b', '/sounds/doors/a~1b'],
    ]);
  });

  it("warn of files a model or a rail style names that the pack lacks in its own namespace, not in another pack's", async () => {
    const pack = await packOf({
      [TYPE]: dump({ length: 10, bogies: [2, -2], mass_t: 40 }),
      [MODEL]: dump({
        obj: 'stock/coach/missing.obj',
        animations: {},
        sounds: { horn: 'ns:sounds/horn.ogg', bell: { main: 'sounds/bell.ogg' }, clack: 'minecraft:block.chain.step', idle: 'other:idle.ogg' },
      }),
      'assets/ns/rail_models/track.json': dump({ obj: 'track/track.obj' }),
      'assets/ns/sounds/horn.ogg': new Uint8Array([1]),
    });
    expect(loaderProblems(pack).map((p) => [p.code, p.params.file, (p.at[0] as { at: string }).at])).toEqual([
      ['loader.missing-file', 'assets/ns/stock/coach/missing.obj', '/obj'],
      ['loader.missing-file', 'assets/ns/sounds/bell.ogg', '/sounds/bell/main'],
      ['loader.missing-file', 'assets/ns/track/track.obj', '/obj'],
    ]);
  });

  it('warn of resource paths Minecraft does not load, and of a pack format newer than the mod reads', async () => {
    const pack = await Pack.open(
      new MemorySource(
        filesOf({
          'pack.mcmeta': dump({ pack: { pack_format: 34, description: 'x' }, rwat: { format: 2 } }),
          'assets/ns/Stock/Coach.obj': '',
          'assets/ns/stock/a b.png': '',
          'README.md': '',
        }),
      ),
    );
    expect(loaderProblems(pack).map((p) => [p.code, p.severity, p.params])).toEqual([
      ['loader.resource-path', 'warning', { file: 'assets/ns/Stock/Coach.obj' }],
      ['loader.resource-path', 'warning', { file: 'assets/ns/stock/a b.png' }],
      ['loader.format-too-new', 'error', { format: 2, supported: 1 }],
    ]);
  });
});

describe('helpers', () => {
  it('resolve a resource reference in the declaring namespace or its own', () => {
    expect(resourceFile('stock/a.obj', 'ns')).toBe('assets/ns/stock/a.obj');
    expect(resourceFile('other:stock/a.obj', 'ns')).toBe('assets/other/stock/a.obj');
    expect(resourceFile(':stock/a.obj', 'ns')).toBe('assets/minecraft/stock/a.obj');
  });

  it('take only lower-case resource paths under assets/ and data/', () => {
    expect(isBadResourcePath('assets/ns/a/b.png')).toBe(false);
    expect(isBadResourcePath('assets/ns/A.png')).toBe(true);
    expect(isBadResourcePath('data/NS/wagon_types/a.json')).toBe(true);
    expect(isBadResourcePath('Pack.png')).toBe(false);
  });
});
