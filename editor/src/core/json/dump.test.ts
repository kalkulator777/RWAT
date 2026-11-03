import { describe, expect, it } from 'vitest';
import { EXAMPLE_PACK, jsonTexts } from '../pack/testing.node';
import { DUMP_STYLE, dump, dumpBytes, encodeInline, encodeValue } from './dump';
import { JsonNumber, parseJson, parseLossless } from './parse';
import { deepEqual } from './value';

/**
 * [JSON text, what tools/ir2rwat.py dump writes of json.loads(text)], written by Python
 * 3.13 (`ir2rwat.dump(json.loads(text)).decode()`). The golden json_dump set
 * (ports/json_dump.test.ts) has the rest.
 */
const PYTHON_DUMPS: [string, string][] = [
  [
    '{"doors": {"left": {"min": [1.5, 2, 3e-5], "max": [4, 5.25, 6], "tags": []}}, "ok": true}',
    '{\n  "doors": {\n    "left": {\n      "min": [1.5, 2, 3e-05],\n      "max": [4, 5.25, 6],\n      "tags": []\n    }\n  },\n  "ok": true\n}\n',
  ],
  ['[[], {}, [[1]], {"a": [{}]}]', '[\n  [],\n  {},\n  [\n    [1]\n  ],\n  {\n    "a": [\n      {}\n    ]\n  }\n]\n'],
  ['{"10": 1, "2": 2, "b": 3, "1": 4}', '{\n  "10": 1,\n  "2": 2,\n  "b": 3,\n  "1": 4\n}\n'],
  [
    '{"s": "tab\\there \\\\ \\"q\\" \\u001f end", "ru": "Привет, мир"}',
    '{\n  "s": "tab\\there \\\\ \\"q\\" \\u001f end",\n  "ru": "Привет, мир"\n}\n',
  ],
  ['{"n": [-0.5, 1e-4, 12345678901234567890, 0.1e1, 2.50e+3]}', '{\n  "n": [-0.5, 0.0001, 12345678901234567890, 1.0, 2500.0]\n}\n'],
  ['{"a": {"b": [1, [2, 3], {"c": null}]}}', '{\n  "a": {\n    "b": [\n      1,\n      [2, 3],\n      {\n        "c": null\n      }\n    ]\n  }\n}\n'],
];

describe('dump (port of ir2rwat.dump)', () => {
  it.each(PYTHON_DUMPS)('writes %s as Python does', (text, expected) => {
    expect(dump(parseLossless(text))).toBe(expected);
  });

  it('writes every JSON file of the example pack back to the same bytes', () => {
    const texts = jsonTexts(EXAMPLE_PACK);
    expect(texts.size).toBeGreaterThanOrEqual(9);
    for (const [path, text] of texts) {
      expect(dump(parseLossless(text)), path).toBe(text);
      expect(new TextDecoder().decode(dumpBytes(parseLossless(text))), path).toBe(text);
    }
  });

  it('writes plain JavaScript values: whole numbers as ints, the same JSON value as the file', () => {
    const coach = jsonTexts(EXAMPLE_PACK).get('data/rwat_example/wagon_types/coach.json') as string;
    const plain = dump(parseJson(coach));
    expect(plain).toContain('"length": 20,\n');
    expect(plain).toContain('"bogies": [7, -7],\n');
    expect(deepEqual(parseJson(plain), parseJson(coach))).toBe(true);
    expect(plain.split('\n').length).toBe(coach.split('\n').length);
  });

  it('keeps the order of a Map; a plain object puts numeric-looking keys first', () => {
    expect(dump(new Map<string, unknown>([['b', 1], ['1', 2]]))).toBe('{\n  "b": 1,\n  "1": 2\n}\n');
    expect(dump({ b: 1, 1: 2 })).toBe('{\n  "1": 2,\n  "b": 1\n}\n');
  });

  it('writes bigints and lexemes as they are, and refuses what JSON cannot hold', () => {
    expect(dump([12345678901234567890n, new JsonNumber('1e2'), new JsonNumber('-0')])).toBe('[12345678901234567890, 100.0, 0]\n');
    expect(() => dump({ a: undefined })).toThrow(TypeError);
    expect(() => dump([() => 1])).toThrow(TypeError);
    expect(() => dump(Number.NaN)).toThrow(RangeError);
    expect(dumpBytes('Тест')).toEqual(new TextEncoder().encode('"Тест"\n'));
  });

  it('writes a value at an indent in a file style, and inline', () => {
    const value = { min: [1, 2, 3], doors: [{ id: 'a' }] };
    expect(encodeValue(value, '\t', { unit: '\t', eol: '\r\n' })).toBe(
      '{\r\n\t\t"min": [1, 2, 3],\r\n\t\t"doors": [\r\n\t\t\t{\r\n\t\t\t\t"id": "a"\r\n\t\t\t}\r\n\t\t]\r\n\t}',
    );
    expect(encodeValue([], '  ', DUMP_STYLE)).toBe('[]');
    expect(encodeInline(value)).toBe('{"min": [1, 2, 3], "doors": [{"id": "a"}]}');
    expect(encodeInline(new Map([['x', true]]))).toBe('{"x": true}');
  });
});
