import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_PACK, REPO_ROOT, jsonTexts } from '../pack/testing.node';
import { detectStyle, editJson } from './edit';
import type { Node } from 'jsonc-parser';
import { memberNode, nodeAt, parseBody, parseJson } from './parse';
import { getAt } from './pointer';
import { insertIn, isJsonObject, removeIn, setIn } from './value';

/** The one hunk where two texts differ, by lines: what went and what came. */
function hunk(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split('\n');
  const b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return { removed: a.slice(head, a.length - tail), added: b.slice(head, b.length - tail) };
}

/** Edits the text from its value to `to` and checks the result reads as `to`, by minimal edits. */
function edited(text: string, to: unknown): string {
  const result = editJson(text, parseJson(text), to);
  expect(result.rewritten).toBe(false);
  expect(parseJson(result.text)).toEqual(to);
  return result.text;
}

const set = (text: string, path: string[], value: unknown): string => edited(text, setIn(parseJson(text), path, value).root);
const remove = (text: string, path: string[]): string => edited(text, removeIn(parseJson(text), path).root);
const insert = (text: string, path: string[], value: unknown): string => edited(text, insertIn(parseJson(text), path, value).root);

/** The property node of a member or the node of an element. */
function childNode(text: string, path: string[]): Node {
  const parent = nodeAt(parseBody(text), path.slice(0, -1)) as Node;
  const last = path.at(-1) as string;
  return (parent.type === 'object' ? memberNode(parent, last) : parent.children?.[Number(last)]) as Node;
}

/**
 * True when `lines` are `original` with lines left out, in order, except that one line
 * may have lost its trailing comma (the one before a removed last member).
 */
function keptInOrder(lines: string[], original: string[]): boolean {
  let j = 0;
  let commas = 0;
  for (const line of lines) {
    while (j < original.length && original[j] !== line && !(original[j] === `${line},` && commas === 0)) j++;
    if (j === original.length) return false;
    if (original[j] !== line) commas++;
    j++;
  }
  return true;
}

/** Every scalar of a value with its path. */
function leaves(value: unknown, path: string[] = []): [string[], unknown][] {
  if (Array.isArray(value)) return value.flatMap((item, i) => leaves(item, [...path, String(i)]));
  if (isJsonObject(value)) return Object.entries(value).flatMap(([key, item]) => leaves(item, [...path, key]));
  return [[path, value]];
}

/** Every member and element of a value with its path. */
function children(value: unknown, path: string[] = []): string[][] {
  if (Array.isArray(value)) return value.flatMap((item, i) => [[...path, String(i)], ...children(item, [...path, String(i)])]);
  if (isJsonObject(value)) return Object.entries(value).flatMap(([key, item]) => [[...path, key], ...children(item, [...path, key])]);
  return [];
}

function changed(value: unknown): unknown {
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'string') return `${value}x`;
  if (typeof value === 'boolean') return !value;
  return 0;
}

describe('minimal edits of the example pack', () => {
  const texts = jsonTexts(EXAMPLE_PACK);

  it('changes one line for one scalar, and nothing for an edit undone', () => {
    let count = 0;
    for (const [file, text] of texts) {
      const value = parseJson(text);
      for (const [path, leaf] of leaves(value)) {
        const after = set(text, path, changed(leaf));
        const { removed, added } = hunk(text, after);
        expect(removed.length, `${file} /${path.join('/')}`).toBe(1);
        expect(added.length).toBe(1);
        expect(editJson(text, value, parseJson(text)).text).toBe(text);
        count++;
      }
    }
    expect(count).toBeGreaterThan(200);
  });

  it('removes exactly the lines of a member or element, and the comma before the last one', () => {
    for (const [file, text] of texts) {
      const value = parseJson(text);
      for (const path of children(value)) {
        const where = `${file} /${path.join('/')}`;
        const node = childNode(text, path);
        const after = remove(text, path);
        const before = text.split('\n');
        const lines = after.split('\n');
        const parent = getAt(value, path.slice(0, -1)) as unknown[] | Record<string, unknown>;
        const siblings = Array.isArray(parent) ? parent.length : Object.keys(parent).length;
        if (siblings === 1) continue; // an only child leaves {} or []
        const ownLine = /^[ \t]*$/.test(text.slice(text.lastIndexOf('\n', node.offset - 1) + 1, node.offset));
        if (ownLine) {
          const span = text.slice(node.offset, node.offset + node.length).split('\n').length;
          expect(before.length - lines.length, where).toBe(span);
          expect(keptInOrder(lines, before), where).toBe(true);
        } else {
          expect(lines.length, where).toBe(before.length);
          expect(hunk(text, after).removed.length, where).toBe(1);
        }
      }
    }
  });

  it('adds a member on a line of its own in the file style', () => {
    const coach = texts.get('data/rwat_example/wagon_types/coach.json') as string;
    const after = set(coach, ['brakes', 'train_kn'], 40);
    expect(hunk(coach, after)).toEqual({
      removed: ['    "parking_kn": 18.0'],
      added: ['    "parking_kn": 18.0,', '    "train_kn": 40'],
    });
    const zone = { min: [-1, 1.3, -1], max: [1, 3.6, 1] };
    const withZone = insert(coach, ['interior', '-'], zone);
    expect(hunk(coach, withZone)).toEqual({
      removed: [],
      added: ['    },', '    {', '      "min": [-1, 1.3, -1],', '      "max": [1, 3.6, 1]'],
    });
  });
});

describe('minimal edits, case by case', () => {
  it('keeps the float form of the number it replaces', () => {
    expect(set('{"length": 20.0, "speed": 120}', ['length'], 21)).toBe('{"length": 21.0, "speed": 120}');
    expect(set('{"length": 20.0, "speed": 120}', ['length'], 21.25)).toBe('{"length": 21.25, "speed": 120}');
    expect(set('{"length": 20.0, "speed": 120}', ['speed'], 100)).toBe('{"length": 20.0, "speed": 100}');
    expect(set('{"b": [7.0, -7.0]}', ['b'], [8, -8])).toBe('{"b": [8.0, -8.0]}');
    expect(set('{"x": 1e-5}', ['x'], 0.00002)).toBe('{"x": 2e-05}');
  });

  it('adds members after the last one, or in place of an empty object', () => {
    expect(set('{\n    "a": 1\n}\n', ['b'], { c: [1, 2], d: {} })).toBe('{\n    "a": 1,\n    "b": {\n        "c": [1, 2],\n        "d": {}\n    }\n}\n');
    expect(set('{"min": [1, 2], "inner": true}', ['fixed'], true)).toBe('{"min": [1, 2], "inner": true, "fixed": true}');
    expect(set('{"a": {}}', ['a', 'b'], { c: 1 })).toBe('{"a": {"b": {"c": 1}}}');
    expect(set('{\n  "a": {}\n}', ['a', 'b'], 1)).toBe('{\n  "a": {\n    "b": 1\n  }\n}');
    expect(set('{\n  "a": 1}', ['b'], 2)).toBe('{\n  "a": 1,\n  "b": 2}');
    expect(set('{\n  "a": 1 // one\n}', ['b'], 2)).toBe('{\n  "a": 1, // one\n  "b": 2\n}');
    expect(set('{\n  "a": 1, /* one */\n}', ['b'], 2)).toBe('{\n  "a": 1, /* one */\n  "b": 2\n}');
    expect(set('{"a": 1,}', ['b'], 2)).toBe('{"a": 1, "b": 2}');
  });

  it('adds a member where the new value has it: before the first member after it the text has', () => {
    expect(edited('{\n  "a": 1,\n  "c": 3\n}\n', { a: 1, b: 2, c: 3 })).toBe('{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}\n');
    expect(edited('{\n  "c": 3\n}', { a: { x: 1 }, b: 2, c: 3 })).toBe('{\n  "a": {\n    "x": 1\n  },\n  "b": 2,\n  "c": 3\n}');
    expect(edited('{"a": 1, "c": 3}', { a: 1, b: [1, 2], c: 3 })).toBe('{"a": 1, "b": [1, 2], "c": 3}');
    // after the members the text has, at the end as before
    expect(edited('{"a": 1, "c": 3}', { a: 1, c: 3, d: 4 })).toBe('{"a": 1, "c": 3, "d": 4}');
    // the members the text has stay where they are, whatever the value's order: one added goes before the first after it
    expect(edited('{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}', { d: 4, c: 3, a: 1 })).toBe('{\n  "a": 1,\n  "d": 4,\n  "c": 3\n}');
  });

  it('removes members with their line, or their own text on one line', () => {
    expect(remove('{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}', ['b'])).toBe('{\n  "a": 1,\n  "c": 3\n}');
    expect(remove('{\n  "a": 1, // about a\n  "b": 2 // about b\n}', ['b'])).toBe('{\n  "a": 1 // about a\n}');
    expect(remove('{\n  // the first\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}', ['a'])).toBe('{\n  // the first\n  "b": {\n    "c": 2\n  }\n}');
    expect(remove('{"a": 1, "b": 2, "c": 3}', ['a'])).toBe('{"b": 2, "c": 3}');
    expect(remove('{"a": 1, "b": 2, "c": 3}', ['b'])).toBe('{"a": 1, "c": 3}');
    expect(remove('{"a": 1, "b": 2, "c": 3}', ['c'])).toBe('{"a": 1, "b": 2}');
    expect(remove('{\n  "a": 1\n}', ['a'])).toBe('{}');
    expect(remove('{\n  "a": 1,\n  "b": 2 }', ['b'])).toBe('{\n  "a": 1 }');
  });

  it('inserts and removes array elements at their place', () => {
    const lines = '[\n  {"id": "a"},\n  {"id": "b"}\n]';
    expect(insert(lines, ['0'], { id: 'z' })).toBe('[\n  {\n    "id": "z"\n  },\n  {"id": "a"},\n  {"id": "b"}\n]');
    expect(insert(lines, ['1'], 5)).toBe('[\n  {"id": "a"},\n  5,\n  {"id": "b"}\n]');
    expect(insert(lines, ['-'], 'c')).toBe('[\n  {"id": "a"},\n  {"id": "b"},\n  "c"\n]');
    expect(remove(lines, ['0'])).toBe('[\n  {"id": "b"}\n]');
    expect(remove(lines, ['1'])).toBe('[\n  {"id": "a"}\n]');
    expect(insert('{"skip": ["A"]}', ['skip', '0'], 'Z')).toBe('{"skip": ["Z", "A"]}');
    expect(insert('{"skip": ["A"]}', ['skip', '-'], { a: [1] })).toBe('{"skip": ["A", {"a": [1]}]}');
    expect(insert('{"skip": []}', ['skip', '-'], 'A')).toBe('{"skip": ["A"]}');
    expect(insert('{\n  "zones": []\n}', ['zones', '-'], { min: [0, 0, 0] })).toBe('{\n  "zones": [\n    {\n      "min": [0, 0, 0]\n    }\n  ]\n}');
    expect(remove('[1.0, 2.0, 3.0]', ['1'])).toBe('[1.0, 3.0]');
    expect(remove('[1.0, 2.0, 3.0]', ['2'])).toBe('[1.0, 2.0]');
    expect(remove('[1.0]', ['0'])).toBe('[]');
    expect(edited('[1, 2, 3, 4]', [1, 9, 4])).toBe('[1, 9, 4]');
    expect(edited('[1, 2]', [1, 2, 3, 4])).toBe('[1, 2, 3, 4]');
    expect(edited('{"a": [1, 2]}', { a: [] })).toBe('{"a": []}');
  });

  it('replaces a value whose type changed where it stands', () => {
    expect(set('{\n  "sound": "a",\n  "x": 1\n}', ['sound'], { main: 'a', pitch: [1, 2] })).toBe(
      '{\n  "sound": {\n    "main": "a",\n    "pitch": [1, 2]\n  },\n  "x": 1\n}',
    );
    expect(set('{"sound": "a", "x": 1}', ['sound'], { main: 'a' })).toBe('{"sound": {"main": "a"}, "x": 1}');
    expect(edited('[1]\n', { a: 1 })).toBe('{\n  "a": 1\n}\n');
    expect(edited('5', 'five')).toBe('"five"');
  });

  it('keeps the BOM, the line ends, the indent and the comments', () => {
    const text = '﻿{\r\n\t"a": 1, // one\r\n\t/* two */\r\n\t"b": [1.0, 2.0]\r\n}\r\n';
    const value = parseJson(text);
    const after = editJson(text, value, { ...(value as object), c: { d: true } });
    expect(after).toEqual({ text: '﻿{\r\n\t"a": 1, // one\r\n\t/* two */\r\n\t"b": [1.0, 2.0],\r\n\t"c": {\r\n\t\t"d": true\r\n\t}\r\n}\r\n', rewritten: false });
    expect(detectStyle('{"a": {"b": 1}}', parseBody('{"a": {"b": 1}}'))).toEqual({ unit: '  ', eol: '\n' });
    expect(detectStyle('{"a": [\n    1\n]}', parseBody('{"a": [\n    1\n]}')).unit).toBe('    ');
    expect(detectStyle('', undefined)).toEqual({ unit: '  ', eol: '\n' });
  });

  it('copes with duplicate members: the last one counts, all go when removed', () => {
    expect(set('{"a": 1, "b": 2, "a": 3}', ['a'], 4)).toBe('{"a": 1, "b": 2, "a": 4}');
    expect(edited('{"a": 1, "b": 2, "a": 3}', { b: 2 })).toBe('{"b": 2}');
  });

  it('writes the whole value when the text is not JSON, in its style', () => {
    expect(editJson('{\n    "a": 1,,\n}\n', { a: 1 }, { a: 2 })).toEqual({ text: '{\n    "a": 2\n}\n', rewritten: true });
    expect(editJson('nope', null, [1])).toEqual({ text: '[1]', rewritten: true });
    expect(editJson('{"a": 1}', { a: 1 }, { a: 1 })).toEqual({ text: '{"a": 1}', rewritten: false });
  });

  it('writes the whole value when the edits cannot give it (a text that does not hold the old value)', () => {
    expect(editJson('{"a": 1}', { b: 1 }, { b: 2 })).toEqual({ text: '{\n  "b": 2\n}', rewritten: true });
  });
});

describe('minimal edits of the MVP recipe overrides (packs/mvp, our markup, no assets)', () => {
  // the override files themselves, not the geometry digests in packs/mvp/geometry/
  const overrides = new Map([...jsonTexts(join(REPO_ROOT, 'packs', 'mvp'))].filter(([path]) => !path.includes('/')));
  it.skipIf(overrides.size === 0)('changes, adds and removes without touching anything else', () => {
    for (const [file, text] of overrides) {
      const value = parseJson(text) as Record<string, unknown>;
      const [path, leaf] = leaves(value)[0] as [string[], unknown];
      expect(hunk(text, set(text, path, changed(leaf))).removed.length, file).toBe(1);
      expect(hunk(text, set(text, ['_note'], 'checked'))).toMatchObject({ added: [expect.any(String), '  "_note": "checked"'] });
      for (const key of Object.keys(value)) {
        const { added } = hunk(text, remove(text, [key]));
        expect(added.length, `${file} /${key}`).toBeLessThanOrEqual(1);
      }
      for (const child of children(value)) {
        const parent = getAt(value, child.slice(0, -1));
        if (Array.isArray(parent) && child.at(-1) === '0') {
          // every array: an element in front, one at the end, the first and the last removed
          const path = child.slice(0, -1);
          insert(text, [...path, '0'], { min: [0, 0, 0] });
          insert(text, [...path, '-'], 1);
          remove(text, child);
          remove(text, [...path, String(parent.length - 1)]);
        }
      }
    }
  }, 30_000);
});
