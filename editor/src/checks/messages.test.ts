import { afterEach, describe, expect, it } from 'vitest';
import type { Problem } from '../core/contracts';
import { dump } from '../core/json';
import { Pack } from '../core/pack';
import { filesOf, MemorySource } from '../core/pack/testing.node';
import { createSchema } from '../core/schema';
import { readSchemaFiles } from '../core/schema/files.node';
import { catalog, lang, setLang } from '../i18n';
import { checkPack } from './pack';
import { problemMessage } from './messages';

const schema = createSchema(readSchemaFiles());
const TYPE = 'data/ns/wagon_types/coach.json';

afterEach(() => {
  setLang('en');
});

/** Every code the checks make: the schema's (core/schema/validate.ts) and the loader's (pack model and ./loader.ts). */
const CODES = [
  'schema.type',
  'schema.enum',
  'schema.const',
  'schema.minimum',
  'schema.maximum',
  'schema.exclusive-minimum',
  'schema.exclusive-maximum',
  'schema.min-length',
  'schema.max-length',
  'schema.pattern',
  'schema.min-items',
  'schema.max-items',
  'schema.required',
  'schema.dependent-required',
  'schema.unknown-key',
  'schema.not',
  'schema.invalid',
  'schema.one-of-many',
  'schema.no-form',
  'schema.deprecated',
  'schema.reserved',
  'schema.invalid-json',
  'pack.in-folder',
  'pack.broken-json',
  'loader.resource-path',
  'loader.format-too-new',
  'loader.type-without-model',
  'loader.model-without-type',
  'loader.bogie-outside',
  'loader.bogie-order',
  'loader.coupler-outside',
  'loader.cab-seat-and-seats',
  'loader.door-key',
  'loader.missing-file',
];

async function findingsOf(type: unknown): Promise<{ pack: Pack; problems: Problem[] }> {
  const pack = await Pack.open(
    new MemorySource(
      filesOf({
        'pack.mcmeta': dump({ pack: { pack_format: 34, description: 'x' }, rwat: { format: 1 } }),
        [TYPE]: dump(type),
        'assets/ns/wagon_models/coach.json': dump({ obj: 'coach.obj' }),
        'assets/ns/coach.obj': '',
      }),
    ),
  );
  return { pack, problems: checkPack(pack, schema) };
}

describe('the words of the findings', () => {
  it('has a line in both languages for every code the checks make', () => {
    for (const code of CODES) {
      expect(catalog.get('ru', `problem.${code}`), code).toBeTypeOf('string');
      expect(catalog.get('en', `problem.${code}`), code).toBeTypeOf('string');
    }
    expect(catalog.get('ru', 'problem.schema.unknown-key.hint')).toBeTypeOf('string');
  });

  it('says a finding in the interface language from its params, the JSON type names too', async () => {
    const { problems } = await findingsOf({ length: 20, bogies: [7, -7], mass_t: 'heavy' });
    const [problem] = problems;
    expect(problem?.code).toBe('schema.type');
    expect(problem?.text).toBe('expected number, got string "heavy"');
    setLang('en');
    expect(problemMessage(problem as Problem)).toBe('expected a number, got a string "heavy"');
    setLang('ru');
    expect(problemMessage(problem as Problem)).toBe('ожидается число, а здесь строка "heavy"');
  });

  it('offers the nearest key of an unknown one, and says a missing required key', async () => {
    const { problems } = await findingsOf({ length: 20, bogies: [7, -7], mas_t: 40 });
    setLang('ru');
    expect(problems.map((p) => problemMessage(p))).toEqual(['нет обязательного ключа «mass_t»', 'незнакомый ключ «mas_t» — может быть, «mass_t»?']);
  });

  it("gives a reserved field's note from the schema in the language, the loader's findings in words too", async () => {
    const { pack, problems } = await findingsOf({ length: 20, bogies: [11, -7], mass_t: 40, brakes: { dynamic_kn: 5 } });
    setLang('ru');
    const said = problems.map((p) => problemMessage(p, { pack, schema }));
    expect(said[0]).toBe('«bogies[0]» = 11 — вне кузова: шкворень должен быть в пределах ±length/2 = ±10');
    expect(said[1]).toMatch(/^зарезервировано — в игре ничего не меняет: .*[а-я]/);
    expect(said[1]).not.toContain('modelled');
    setLang('en');
    expect(problemMessage(problems[1] as Problem, { pack, schema })).toMatch(/^reserved — changes nothing in game: /);
  });

  it('keeps the English text of a code it has no line for', () => {
    const odd: Problem = { severity: 'info', source: 'converter', code: 'converter.something', params: {}, text: 'as the tool says', at: [] };
    lang.value = 'ru';
    expect(problemMessage(odd)).toBe('as the tool says');
  });
});
