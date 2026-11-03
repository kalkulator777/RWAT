import { describe, expect, it } from 'vitest';
import { dump } from '../../core/json';
import { Journal } from '../../core/journal';
import { Pack } from '../../core/pack';
import { filesOf, MemorySource, readTree } from '../../core/pack/testing.node';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import { nameLangs, nameOps, nameRows } from './model';

describe('the names of a pack', () => {
  it('lists the wagons, the rail styles, the light groups and the other keys, with the name in each language', async () => {
    const pack = await Pack.open(new MemorySource(readTree(EXAMPLE_PACK)));
    const rows = nameRows(pack);
    expect(rows.map((row) => [row.kind, row.key])).toEqual([
      ['wagon', 'wagon.rwat_example.coach'],
      ['wagon', 'wagon.rwat_example.gondola'],
      ['wagon', 'wagon.rwat_example.shunter'],
      ['rail', 'rail.rwat_example.wooden_track'],
      ['light', 'light.rwat_example.coach.IL'],
      ['light', 'light.rwat_example.shunter.DeskL'],
      ['light', 'light.rwat_example.shunter.FHL'],
      ['light', 'light.rwat_example.shunter.IL'],
      ['light', 'light.rwat_example.shunter.REL'],
      ['light', 'light.rwat_example.shunter.RHL'],
    ]);
    const coach = rows[0];
    expect(coach?.fallback).toBe('rwat_example:coach');
    expect(coach?.values.ru_ru).toEqual({ value: 'Пассажирский вагон (пример)', file: 'assets/rwat_example/lang/ru_ru.json' });
    expect(rows.find((row) => row.key.endsWith('shunter.FHL'))?.fallback).toBe('FHL');
    expect(nameLangs(pack)).toEqual(['en_us', 'ru_ru']);
  });

  it('writes a name into its lang file, removes an emptied one, and creates the lang file the namespace lacks', async () => {
    const pack = await Pack.open(
      new MemorySource(
        filesOf({
          'pack.mcmeta': dump({ pack: { pack_format: 34, description: 'x' }, rwat: { format: 1 } }),
          'data/ns/wagon_types/coach.json': dump({ length: 10, bogies: [2, -2], mass_t: 1 }),
          'assets/ns/lang/en_us.json': dump({ 'wagon.ns.coach': 'Coach' }),
        }),
      ),
    );
    const journal = new Journal(pack);
    expect(nameOps(pack, 'wagon.ns.coach', 'ns', 'en_us', 'Coach')).toEqual([]);
    expect(nameOps(pack, 'wagon.ns.coach', 'ns', 'en_us', 'Car')).toEqual([{ op: 'set', file: 'assets/ns/lang/en_us.json', at: '/wagon.ns.coach', value: 'Car' }]);
    expect(nameOps(pack, 'wagon.ns.coach', 'ns', 'en_us', '')).toEqual([{ op: 'remove', file: 'assets/ns/lang/en_us.json', at: '/wagon.ns.coach' }]);
    expect(nameOps(pack, 'wagon.ns.coach', 'ns', 'ru_ru', '')).toEqual([]);

    await journal.run({ label: 'x', ops: nameOps(pack, 'wagon.ns.coach', 'ns', 'ru_ru', 'Вагон') });
    expect(await pack.text('assets/ns/lang/ru_ru.json')).toBe('{\n  "wagon.ns.coach": "Вагон"\n}\n');
    expect(nameRows(pack)[0]?.values.ru_ru?.value).toBe('Вагон');
    journal.undo();
    expect(pack.has('assets/ns/lang/ru_ru.json')).toBe(false);
  });
});
