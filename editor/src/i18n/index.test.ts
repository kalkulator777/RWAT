import { afterEach, describe, expect, it } from 'vitest';
import { catalog, detectLang, lang, setLang, t } from './index';

afterEach(() => {
  lang.value = 'en';
});

describe('detectLang', () => {
  it('starts in the remembered language, else Russian for a ru* browser and English for any other', () => {
    expect(detectLang('en', 'ru-RU')).toBe('en');
    expect(detectLang('ru', 'de-DE')).toBe('ru');
    expect(detectLang(null, 'ru-RU')).toBe('ru');
    expect(detectLang(null, 'ru')).toBe('ru');
    expect(detectLang(undefined, 'RU-by')).toBe('ru');
    expect(detectLang(null, 'en-US')).toBe('en');
    expect(detectLang(null, 'rue')).toBe('en');
    expect(detectLang('fr', undefined)).toBe('en');
  });
});

describe('t', () => {
  it('follows the language signal', () => {
    setLang('ru');
    expect(t('shell.title')).toBe('Редактор паков RWAT');
    setLang('en');
    expect(t('shell.title')).toBe('RWAT pack editor');
  });

  it('gives back the key itself when no module defines it', () => {
    expect(t('nowhere.at-all')).toBe('nowhere.at-all');
  });
});

describe('the strings of every module', () => {
  it('are complete in both languages, defined once, with the same placeholders', () => {
    expect(catalog.problems).toEqual([]);
  });

  it('are found without being listed: the shell and the language names are there', () => {
    expect(catalog.keys()).toEqual(expect.arrayContaining(['shell.title', 'lang.ru', 'lang.en']));
  });

  it('use keys of the form <module>.<name>', () => {
    for (const key of catalog.keys()) expect(key).toMatch(/^[a-z][a-z0-9-]*\.[A-Za-z0-9.-]+$/);
  });
});
