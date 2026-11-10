import { describe, expect, it } from 'vitest';
import { Journal } from '../../core/journal';
import { Pack } from '../../core/pack';
import { filesOf, MemorySink, MemorySource, readTree } from '../../core/pack/testing.node';
import { readSchemaFiles } from '../../core/schema/files.node';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import { renamedFile, renameTypeCommand, TYPE_ID } from './rename';

const files = readTree(EXAMPLE_PACK);
const decoder = new TextDecoder();
const OLD_TYPE = 'data/rwat_example/wagon_types/shunter.json';
const OLD_MODEL = 'assets/rwat_example/wagon_models/shunter.json';
const NEW_TYPE = 'data/rwat_example/wagon_types/loco/tem2.json';
const NEW_MODEL = 'assets/rwat_example/wagon_models/loco/tem2.json';
const EN = 'assets/rwat_example/lang/en_us.json';

async function example(extra: Record<string, string> = {}): Promise<{ pack: Pack; journal: Journal }> {
  const pack = await Pack.open(new MemorySource(new Map([...files, ...filesOf(extra)]), 'RwatExamplePack'));
  return { pack, journal: new Journal(pack) };
}

/** Every file of the pack as saving writes it. */
async function snapshot(pack: Pack): Promise<Map<string, string>> {
  return new Map((await pack.snapshot()).map((file) => [file.path, Buffer.from((file as { bytes: Uint8Array }).bytes).toString('base64')]));
}

describe('renaming a wagon', () => {
  it('is the type id pattern of the schema', () => {
    const common = readSchemaFiles()['common.schema.json'] as { $defs: { type_id: { pattern: string } } };
    expect(TYPE_ID.source).toBe(common.$defs.type_id.pattern);
  });

  it('moves the type and the model to the new id, keeps the old id in aliases and moves its names in place; undo is one step back to the same bytes', async () => {
    const { pack, journal } = await example();
    const before = await snapshot(pack);
    const result = renameTypeCommand(pack, 'rwat_example:shunter', ' rwat_example:loco/tem2 ');
    if ('errors' in result) throw new Error(JSON.stringify(result.errors));
    await journal.run(result.command);
    expect(journal.state().done).toHaveLength(1);
    expect(pack.has(OLD_TYPE) || pack.has(OLD_MODEL)).toBe(false);
    expect((pack.json(NEW_TYPE) as { aliases: string[] }).aliases).toEqual(['rwat_example:shunter']);
    expect(Buffer.from(await pack.bytes(NEW_MODEL)).equals(Buffer.from(files.get(OLD_MODEL) as Uint8Array))).toBe(true);
    expect(pack.stock().map((entry) => entry.id)).toContain('rwat_example:loco/tem2');
    expect(renamedFile(pack, 'rwat_example:loco/tem2')).toBe(NEW_TYPE);

    const en = (await pack.text(EN)).split('\n');
    const original = decoder.decode(files.get(EN)).split('\n');
    expect(en.length).toBe(original.length);
    expect(en.filter((line, i) => line !== original[i])).toEqual([
      '  "light.rwat_example.loco/tem2.DeskL": "Desk backlight",',
      '  "light.rwat_example.loco/tem2.FHL": "Front headlight",',
      '  "light.rwat_example.loco/tem2.IL": "Cab light",',
      '  "light.rwat_example.loco/tem2.REL": "Tail lamps",',
      '  "light.rwat_example.loco/tem2.RHL": "Rear headlight",',
      '  "wagon.rwat_example.loco/tem2": "Example shunter"',
    ]);
    // the type's own text: one line added at its end
    const typeText = await pack.text(NEW_TYPE);
    expect(typeText.startsWith(decoder.decode(files.get(OLD_TYPE)).trimEnd().slice(0, -1).trimEnd())).toBe(true);
    expect(typeText).toContain('"aliases": ["rwat_example:shunter"]');

    const sink = new MemorySink();
    await pack.save(sink);
    expect(sink.writes[0]?.map((change) => change.path).sort()).toEqual(
      [OLD_MODEL, OLD_TYPE, NEW_MODEL, NEW_TYPE, EN, 'assets/rwat_example/lang/ru_ru.json'].sort(),
    );
    journal.undo();
    expect(await snapshot(pack)).toEqual(before);
    journal.redo();
    journal.undo();
    expect(await snapshot(pack)).toEqual(before);
  });

  it('renames back: the new id leaves aliases, the other id joins them', async () => {
    const { pack, journal } = await example();
    const there = renameTypeCommand(pack, 'rwat_example:coach', 'rwat_example:coach2');
    if ('errors' in there) throw new Error('refused');
    await journal.run(there.command);
    const back = renameTypeCommand(pack, 'rwat_example:coach2', 'rwat_example:coach');
    if ('errors' in back) throw new Error(JSON.stringify(back.errors));
    await journal.run(back.command);
    expect((pack.json('data/rwat_example/wagon_types/coach.json') as { aliases: string[] }).aliases).toEqual(['rwat_example:coach2']);
  });

  it('renames a model without a type, and leaves a longer id’s light names to it', async () => {
    const { pack, journal } = await example({
      'assets/rwat_example/wagon_models/tram.json': '{"obj": "x.obj"}\n',
      'data/rwat_example/wagon_types/coach.b.json': '{"length": 1, "bogies": [0], "mass_t": 1}\n',
      'assets/rwat_example/lang/de_de.json': '{"light.rwat_example.coach.b.IL": "B", "light.rwat_example.coach.IL": "A", "light.rwat_example.coach.": "?"}\n',
    });
    const tram = renameTypeCommand(pack, 'rwat_example:tram', 'rwat_example:tram2');
    if ('errors' in tram) throw new Error('refused');
    expect(tram.command.ops).toEqual([{ op: 'renameFile', file: 'assets/rwat_example/wagon_models/tram.json', to: 'assets/rwat_example/wagon_models/tram2.json' }]);
    const coach = renameTypeCommand(pack, 'rwat_example:coach', 'rwat_example:car');
    if ('errors' in coach) throw new Error('refused');
    await journal.run(coach.command);
    expect(Object.keys(pack.json('assets/rwat_example/lang/de_de.json') as object)).toEqual([
      'light.rwat_example.coach.b.IL',
      'light.rwat_example.car.IL',
      'light.rwat_example.coach.',
    ]);
  });

  it('refuses what it cannot rename, saying why', async () => {
    const { pack } = await example({
      'data/rwat_example/wagon_types/old.json': '{"length": 1, "bogies": [0], "mass_t": 1, "aliases": ["rwat_example:taken_alias", "rwat_example:gondola"]}\n',
      'data/rwat_example/wagon_types/broken.json': '{"length": 1, "aliases": "x"}\n',
      'assets/rwat_example/lang/de_de.json': '{"wagon.rwat_example.coach": "A", "wagon.rwat_example.car": "B"}\n',
    });
    const keys = (from: string, to: string): string[] => {
      const result = renameTypeCommand(pack, from, to);
      return 'errors' in result ? result.errors.map((error) => error.key) : [];
    };
    expect(keys('rwat_example:nothing', 'rwat_example:x')).toEqual(['save.rename.error.missing']);
    expect(keys('rwat_example:coach', 'rwat_example:coach')).toEqual(['save.rename.error.same']);
    expect(keys('rwat_example:coach', 'Rwat:Coach')).toEqual(['save.rename.error.id']);
    expect(keys('rwat_example:coach', 'rwat_example:a//b')).toEqual(['save.rename.error.id']);
    expect(keys('rwat_example:coach', 'other:coach')).toEqual(['save.rename.error.namespace']);
    expect(keys('rwat_example:coach', 'rwat_example:shunter')).toContain('save.rename.error.taken'); // and its names, which the shunter has
    expect(keys('rwat_example:coach', 'rwat_example:taken_alias')).toEqual(['save.rename.error.aliasOfOther']);
    expect(keys('rwat_example:gondola', 'rwat_example:g2')).toEqual(['save.rename.error.oldClaimed']);
    expect(keys('rwat_example:broken', 'rwat_example:fixed')).toEqual(['save.rename.error.typeFile']);
    expect(keys('rwat_example:coach', 'rwat_example:car')).toEqual(['save.rename.error.nameTaken']);
    expect(keys('rwat_example:coach', 'rwat_example:wagon')).toEqual([]);
  });
});
