import { describe, expect, it } from 'vitest';
import { createCatalog, formatMessage, placeholders } from './catalog';
import { defineStrings } from './define';

const WAGONS_RU = '{count, plural, =0 {нет вагонов} one {# вагон} few {# вагона} many {# вагонов} other {# вагона}}';
const WAGONS_EN = '{count, plural, =0 {no wagons} one {# wagon} other {# wagons}}';

describe('formatMessage', () => {
  it('fills placeholders and writes numbers the JSON way in both languages', () => {
    expect(formatMessage('Тип {id}: {mass} т', { id: 'rwat:coach', mass: 42.5 }, 'ru')).toBe('Тип rwat:coach: 42.5 т');
    expect(formatMessage('{a} and {a}', { a: -0.25 }, 'en')).toBe('-0.25 and -0.25');
  });

  it("writes a finding's list of zone indices and its infinite or NaN numbers", () => {
    expect(formatMessage('Zones {zones} cannot be reached', { zones: [2, 5, 7] }, 'en')).toBe(
      'Zones 2, 5, 7 cannot be reached',
    );
    expect(formatMessage('{height} above the floor', { height: Number.POSITIVE_INFINITY }, 'en')).toBe(
      'Infinity above the floor',
    );
  });

  it('leaves an unknown placeholder as written, so the gap shows', () => {
    expect(formatMessage('Zone {index} of {type}', { index: 2 }, 'en')).toBe('Zone 2 of {type}');
    expect(formatMessage('broken {brace', {}, 'en')).toBe('broken {brace');
  });

  it('picks the plural branch by the language rules', () => {
    const ru = (count: number) => formatMessage(WAGONS_RU, { count }, 'ru');
    expect([0, 1, 2, 5, 11, 21, 22, 25, 1.5].map(ru)).toEqual([
      'нет вагонов',
      '1 вагон',
      '2 вагона',
      '5 вагонов',
      '11 вагонов',
      '21 вагон',
      '22 вагона',
      '25 вагонов',
      '1.5 вагона',
    ]);
    const en = (count: number) => formatMessage(WAGONS_EN, { count }, 'en');
    expect([0, 1, 2].map(en)).toEqual(['no wagons', '1 wagon', '2 wagons']);
  });

  it('fills placeholders inside a plural branch', () => {
    const message = 'In {pack}: {n, plural, one {# error in {file}} other {# errors in {file}}}';
    expect(formatMessage(message, { pack: 'Example', n: 3, file: 'coach.json' }, 'en')).toBe(
      'In Example: 3 errors in coach.json',
    );
  });
});

describe('placeholders', () => {
  it('names the parameters, plural branches included, not the branch texts', () => {
    expect(placeholders(WAGONS_EN)).toEqual(['count']);
    expect(placeholders('{n, plural, one {wagon} other {{n} in {file}}} of {pack}')).toEqual(['file', 'n', 'pack']);
    expect(placeholders('no parameters')).toEqual([]);
  });
});

describe('createCatalog', () => {
  const shell = defineStrings({ ru: { 'shell.title': 'Редактор', 'shell.count': WAGONS_RU }, en: { 'shell.title': 'Editor', 'shell.count': WAGONS_EN } });

  it('looks strings up by language and key', () => {
    const catalog = createCatalog({ '../app/i18n.ts': { default: shell } });
    expect(catalog.problems).toEqual([]);
    expect(catalog.get('ru', 'shell.title')).toBe('Редактор');
    expect(catalog.get('en', 'shell.title')).toBe('Editor');
    expect(catalog.get('en', 'shell.none')).toBeUndefined();
    expect(catalog.keys()).toEqual(['shell.count', 'shell.title']);
  });

  it('reports a key defined twice, a key in one language only, placeholders that differ and a module without strings', () => {
    const catalog = createCatalog({
      '../app/i18n.ts': { default: shell },
      '../panels/checks/i18n.ts': {
        default: {
          ru: { 'shell.title': 'Другой', 'checks.only-ru': 'Только', 'checks.count': '{n} находок' },
          en: { 'checks.count': '{count} problems' },
        },
      },
      '../panels/log/i18n.ts': {},
    });
    expect(catalog.problems).toEqual([
      "../panels/checks/i18n.ts: 'checks.count' has placeholders {n} in ru but {count} in en",
      "../panels/checks/i18n.ts: 'checks.only-ru' has no en text",
      "../panels/checks/i18n.ts: 'shell.title' has no en text",
      "../panels/checks/i18n.ts: 'shell.title' is already defined in ../app/i18n.ts",
      '../panels/log/i18n.ts: no default export of defineStrings({ ru, en })',
    ]);
    // The first definition wins.
    expect(catalog.get('ru', 'shell.title')).toBe('Редактор');
  });
});
