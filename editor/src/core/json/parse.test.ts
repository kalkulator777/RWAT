import { describe, expect, it } from 'vitest';
import { JsonNumber, JsonSyntaxError, nodeAt, parseBody, parseJson, parseLossless, splitBom } from './parse';

describe('reading JSON text', () => {
  it('reads strict JSON, and JSON with a BOM, comments and trailing commas', () => {
    expect(parseJson('{"a": [1, 2.5]}')).toEqual({ a: [1, 2.5] });
    expect(parseJson('﻿{"a": 1}')).toEqual({ a: 1 });
    expect(parseJson('{\n  // a comment\n  "a": [1, 2,], /* more */ "b": {"c": null,},\n}')).toEqual({ a: [1, 2], b: { c: null } });
  });

  it('says where text is not JSON, counting the BOM', () => {
    expect(() => parseJson('{"a": 1,, }')).toThrow(JsonSyntaxError);
    try {
      parseJson('﻿{"a" 1}');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(JsonSyntaxError);
      expect((error as JsonSyntaxError).code).toBe('ColonExpected');
      expect((error as JsonSyntaxError).offset).toBe(6);
    }
    expect(() => parseJson('')).toThrow(JsonSyntaxError);
    expect(() => parseBody('  ')).toThrow(/ValueExpected/);
  });

  it('makes __proto__ a member, not a prototype, whichever way it reads', () => {
    for (const text of ['{"__proto__": {"x": 1}}', '{"__proto__": {"x": 1}, /* c */}']) {
      const value = parseJson(text) as Record<string, unknown>;
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
      expect(Object.keys(value)).toEqual(['__proto__']);
      expect((value as { x?: unknown }).x).toBeUndefined();
    }
  });

  it('keeps the last of duplicate members, as JSON.parse does, and finds that one in the tree', () => {
    const text = '{"a": 1, "b": 2, "a": 3, /* c */}';
    expect(parseJson(text)).toEqual({ a: 3, b: 2 });
    expect(parseJson('{"a": 1, "b": 2, "a": 3}')).toEqual({ a: 3, b: 2 });
    const root = parseBody(text);
    expect(nodeAt(root, ['a'])?.value).toBe(3);
    expect(nodeAt(root, ['c'])).toBeUndefined();
  });

  it('finds nodes by pointer segments', () => {
    const root = parseBody('{"doors": [{"min": [1, 2, 3]}], "n": 5}');
    expect(nodeAt(root, [])).toBe(root);
    expect(nodeAt(root, ['doors', '0', 'min', '2'])?.value).toBe(3);
    expect(nodeAt(root, ['doors', '1'])).toBeUndefined();
    expect(nodeAt(root, ['doors', '01'])).toBeUndefined();
    expect(nodeAt(root, ['n', 'x'])).toBeUndefined();
    expect(nodeAt(root, ['n', 'x', 'y'])).toBeUndefined();
  });

  it('reads losslessly: numbers as written, objects as Maps in their order', () => {
    const value = parseLossless('﻿{"b": [100.0, 100, 1e2], "1": "x", "a": {"c": true}, "a": {"d": null}}') as Map<string, unknown>;
    expect([...value.keys()]).toEqual(['b', '1', 'a']);
    expect((value.get('b') as JsonNumber[]).map((n) => n.lexeme)).toEqual(['100.0', '100', '1e2']);
    expect(Number(new JsonNumber('2.5'))).toBe(2.5);
    expect(value.get('a')).toEqual(new Map([['d', null]]));
    expect(() => parseLossless('[1,')).toThrow(JsonSyntaxError);
  });

  it('splits off the BOM', () => {
    expect(splitBom('﻿x')).toEqual({ bom: '﻿', body: 'x' });
    expect(splitBom('x')).toEqual({ bom: '', body: 'x' });
  });
});
