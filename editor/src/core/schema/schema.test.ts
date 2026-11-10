import { describe, expect, it } from 'vitest';
import { fetchSchemaFiles, type SchemaFiles } from './files';
import { REPO_SCHEMA_DIR, readSchemaFiles } from './files.node';
import { readdirSync } from 'node:fs';
import {
  ALLOWED_EXTENSION_KEYWORDS,
  EXTENSION_KEYWORDS,
  SCHEMA_KINDS,
  createSchema,
  extensionKeywordsUsed,
  invalidJsonProblem,
  russianTwin,
  schemaKindOf,
  walkFields,
  type FieldDescriptor,
} from './index';
import { createAjv } from './ajv';
import { pyJson, pyNumber, pyRepr, show } from './pyformat';
import { SchemaStore, isNode } from './store';

const files = readSchemaFiles();
const schema = createSchema(files);
const { store, checker, fields } = schema;

function eachNode(node: unknown, visit: (node: Record<string, unknown>, pointer: string) => void, pointer = ''): void {
  if (Array.isArray(node)) node.forEach((v, i) => eachNode(v, visit, `${pointer}/${i}`));
  else if (isNode(node)) {
    visit(node, pointer);
    for (const [k, v] of Object.entries(node)) eachNode(v, visit, `${pointer}/${k}`);
  }
}

describe('loading', () => {
  it('indexes every schema file by $id and resolves $ref across files', () => {
    expect(store.documents.size).toBe(7);
    const { uri, schema: node } = store.resolve(store.uriOf('wagon_type'), 'common.schema.json#/$defs/vec3');
    expect(uri).toMatch(/common\.schema\.json$/);
    expect(node.minItems).toBe(3);
    expect(store.resolve(store.uriOf('wagon_type'), '#/$defs/door').schema.required).toEqual(['id', 'min', 'max']);
    expect(store.resolve(store.uriOf('recipe'), 'recipe_override.schema.json').uri).toBe(store.uriOf('recipe_override'));
  });

  it('refuses a ref that leads nowhere', () => {
    const base = store.uriOf('wagon_type');
    expect(() => store.resolve(base, 'nowhere.schema.json')).toThrow(/no schema/);
    expect(() => store.resolve(base, '#/$defs/nothing')).toThrow(/not found/);
    expect(() => store.resolve(base, '#anchor')).toThrow(/pointer/);
    expect(() => store.resolve(base, '#/properties/length/type')).toThrow(/not a schema/);
    expect(() => store.uriOf('nothing')).toThrow(/no schema file/);
    expect(() => new SchemaStore({ 'x.schema.json': {} })).toThrow(/\$id/);
  });

  it('lists in pack-layout.json exactly the schema files of the folder', () => {
    const onDisk = readdirSync(REPO_SCHEMA_DIR).filter((n) => n.endsWith('.schema.json')).sort();
    expect([...(store.layout.schemas as string[])].sort()).toEqual(onDisk);
    for (const kind of SCHEMA_KINDS) expect(store.uriOf(kind)).toContain(`${kind}.schema.json`);
  });

  it('fetches the files a site serves, the layout first', async () => {
    const asked: string[] = [];
    const fetched = await fetchSchemaFiles('https://site.test/schema/', (url) => {
      asked.push(url);
      const name = url.slice(url.lastIndexOf('/') + 1);
      return Promise.resolve({ ok: name in files, status: name in files ? 200 : 404, json: () => Promise.resolve(files[name]) });
    });
    expect(asked[0]).toBe('https://site.test/schema/pack-layout.json');
    expect(Object.keys(fetched).sort()).toEqual(Object.keys(files).sort());
    expect(new SchemaStore(fetched).documents.size).toBe(7);
    await expect(fetchSchemaFiles('https://site.test/schema/', () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) }))).rejects.toThrow(/404/);
    const bare: SchemaFiles = { 'pack-layout.json': {} };
    await expect(fetchSchemaFiles('https://site.test/schema/', (url) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url.endsWith('layout.json') ? bare['pack-layout.json'] : {}) }))).resolves.toBeDefined();
  });

  it('compiles every schema in Ajv strict mode', () => {
    const ajv = createAjv(store);
    for (const uri of store.documents.keys()) expect(ajv.getSchema(uri), uri).toBeDefined();
  });
});

describe('the x- vocabulary', () => {
  it('knows every extension keyword the schemas use', () => {
    for (const [name, document] of Object.entries(files)) {
      if (!name.endsWith('.schema.json')) continue;
      const unknown = [...extensionKeywordsUsed(document)].filter((k) => !ALLOWED_EXTENSION_KEYWORDS.has(k));
      expect(unknown, `${name}: a keyword the forms do not understand yet`).toEqual([]);
    }
  });

  it('is refused by Ajv when a schema uses a keyword outside it', () => {
    const doctored = { ...files, 'wagon_type.schema.json': { ...(files['wagon_type.schema.json'] as object), 'x-mystery': 1 } };
    expect(() => createSchema(doctored)).toThrow(/x-mystery/);
    expect([...extensionKeywordsUsed({ properties: { 'x-name': { 'x-mystery': 1 } } })]).toEqual(['x-mystery']);
  });

  it('keeps pack-layout.json keywords and the table the same list', () => {
    const documented = (store.layout.keywords as { keyword: string }[]).map((k) => k.keyword).filter((k) => k.startsWith('x-'));
    const text = JSON.stringify(store.layout.keywords);
    for (const { keyword } of EXTENSION_KEYWORDS) expect(text, keyword).toContain(keyword);
    for (const keyword of documented) expect(ALLOWED_EXTENSION_KEYWORDS.has(keyword), keyword).toBe(true);
  });

  it('has only Russian twins (x-<word>-ru) as x- keys in pack-layout.json and obj-conventions.json', () => {
    for (const name of ['pack-layout.json', 'obj-conventions.json']) {
      eachNode(files[name], (node) => {
        for (const key of Object.keys(node).filter((k) => k.startsWith('x-'))) {
          expect(key, name).toMatch(/^x-.+-ru$/);
        }
      });
    }
    expect(russianTwin('description')).toBe('x-description-ru');
    expect(russianTwin('x-engine-default')).toBe('x-engine-default-ru');
  });

  it('keeps x-status and x-frame to the ids pack-layout.json defines', () => {
    const statuses = store.layoutList('statuses').map((s) => s.status);
    const frames = store.layoutList('frames').map((f) => f.id);
    for (const [name, document] of Object.entries(files)) {
      if (!name.endsWith('.schema.json')) continue;
      eachNode(document, (node) => {
        if (typeof node['x-status'] === 'string') expect(statuses).toContain(node['x-status']);
        if (typeof node['x-frame'] === 'string') expect(frames).toContain(node['x-frame']);
        if (typeof node['x-unit'] === 'string') expect(store.layoutList('units').map((u) => u.unit)).toContain(node['x-unit']);
      });
    }
  });
});

describe('the schemas themselves', () => {
  it('describe every property in English and Russian, itself or through its $ref', () => {
    const described = (node: Record<string, unknown>, uri: string, key: string, depth = 0): boolean => {
      if (key in node) return true;
      if (depth > 8) return false;
      if (typeof node.$ref === 'string') {
        const target = store.resolve(uri, node.$ref);
        return described(target.schema, target.uri, key, depth + 1);
      }
      const branches = (node.anyOf ?? node.oneOf) as unknown[] | undefined;
      const live = (branches ?? []).filter((b) => isNode(b) && b.type !== 'null');
      return live.length > 0 && live.every((b) => described(b as Record<string, unknown>, uri, key, depth + 1));
    };
    for (const [uri, document] of store.documents) {
      eachNode(document, (node, pointer) => {
        if (!isNode(node.properties) || pointer.endsWith('/properties')) return;
        for (const [name, sub] of Object.entries(node.properties)) {
          for (const key of ['description', 'x-description-ru']) {
            expect(described(sub as Record<string, unknown>, uri, key), `${uri}${pointer}/properties/${name} lacks ${key}`).toBe(true);
          }
        }
      });
    }
  });

  it('give examples and defaults that the schemas accept', () => {
    for (const kind of SCHEMA_KINDS) {
      const { schema: root } = store.root(kind);
      for (const example of (root.examples as unknown[] | undefined) ?? []) {
        expect(checker.check(kind, example).filter((f) => f.level === 'error'), kind).toEqual([]);
      }
    }
  });
});

describe('findings as problems', () => {
  const problems = checker.problems('wagon_type', 'data/a/wagon_types/x.json', {
    length: 10, bogies: [3, -3], mass_t: 5, lenght: 1, cab: { seat: [0, 1, 0] }, brakes: { dynamic_kn: 5 },
  });

  it('point at the field with a JSON pointer, with a code and the engine-style text', () => {
    expect(problems).toEqual([
      {
        severity: 'warning', source: 'schema', code: 'schema.reserved',
        params: { note: expect.stringContaining('not modelled') as string },
        text: expect.stringMatching(/^reserved: /) as string,
        at: [{ kind: 'field', file: 'data/a/wagon_types/x.json', at: '/brakes/dynamic_kn' }],
      },
      {
        severity: 'warning', source: 'schema', code: 'schema.deprecated', params: { note: "Old form: one chair's point" },
        text: "deprecated form: Old form: one chair's point",
        at: [{ kind: 'field', file: 'data/a/wagon_types/x.json', at: '/cab/seat' }],
      },
      {
        severity: 'error', source: 'schema', code: 'schema.unknown-key', params: { key: 'lenght', nearest: 'length' },
        text: "unknown key 'lenght' (did you mean 'length'?)",
        at: [{ kind: 'field', file: 'data/a/wagon_types/x.json', at: '/lenght' }],
      },
    ]);
  });

  it('say a broken file is no JSON, and which schema a path has', () => {
    expect(invalidJsonProblem('pack.mcmeta', 'Unexpected end')).toMatchObject({ code: 'schema.invalid-json', at: [{ kind: 'file', file: 'pack.mcmeta' }] });
    expect(schemaKindOf('pack.mcmeta')).toBe('pack_mcmeta_rwat');
    expect(schemaKindOf('data/ns/wagon_types/a/b.json')).toBe('wagon_type');
    expect(schemaKindOf('assets/ns/wagon_models/a.json')).toBe('wagon_model');
    expect(schemaKindOf('assets/ns/rail_models/a.json')).toBe('rail_model');
    expect(schemaKindOf('assets/ns/lang/en_us.json')).toBeUndefined();
  });

  it('escape keys in pointers and name each form of a failed alternative', () => {
    const found = checker.check('wagon_type', { length: 1, bogies: [1], mass_t: 1, 'a/b~c': 1, interior: 5 });
    expect(found.map((f) => f.pointer)).toEqual(['/a~1b~0c', '/interior', '/interior']);
    expect(found[1]?.code).toBe('schema.no-form');
    expect(found[1]?.message).toBe('matches none of the allowed forms (array, object)');
  });

  it('say a oneOf matched twice', () => {
    const twice = checker.check('wagon_type', { length: 1, bogies: [1], mass_t: 1, interior: [] });
    expect(twice.map((f) => f.message)).toEqual(['0 item(s), at least 1 needed']);
  });
});

describe('Python spellings', () => {
  it('writes values as json.dumps and repr do', () => {
    expect(pyJson({ a: [1, 2.5, null, 'é', true] })).toBe('{"a": [1, 2.5, null, "é", true]}');
    expect(pyRepr("it's")).toBe('"it\'s"');
    expect(pyRepr('a\'"b\n')).toBe('\'a\\\'"b\\n\'');
    expect(pyRepr('\u0001\t\\')).toBe("'\\x01\\t\\\\'");
    expect(pyNumber(1e-5)).toBe('1e-05');
    expect(pyNumber(1.5e16)).toBe('1.5e+16');
    expect(pyNumber(0.0001)).toBe('0.0001');
    expect(pyNumber(-0)).toBe('-0.0');
    expect(show('x'.repeat(70))).toBe(`"${'x'.repeat(56)}...`);
    expect(show(undefined)).toBe('null');
  });
});

describe('field descriptors', () => {
  const wagon = fields.root('wagon_type');
  const field = (root: FieldDescriptor, ...path: string[]): FieldDescriptor => {
    let at = root;
    for (const key of path) {
      const next: FieldDescriptor | undefined = at.properties?.find((p) => p.key === key) ?? at.variants?.flatMap((v) => v.properties ?? []).find((p) => p.key === key);
      if (!next) throw new Error(`no field ${path.join('.')}`);
      at = next;
    }
    return at;
  };

  it('cover every property of the wagon type schema, with texts in both languages', () => {
    const covered = new Set([...walkFields(wagon)].map((d) => `${d.at.uri}#${d.at.pointer}`));
    const { uri, schema: root } = store.root('wagon_type');
    eachNode(root, (node, pointer) => {
      if (!isNode(node.properties) || pointer.endsWith('/properties')) return;
      for (const name of Object.keys(node.properties)) {
        expect(covered.has(`${uri}#${pointer}/properties/${name}`), `${pointer}/properties/${name}`).toBe(true);
      }
    });
    for (const d of walkFields(wagon)) {
      if (d.key === undefined) continue;
      expect(d.description.en, d.key).toBeTruthy();
      expect(d.description.ru, d.key).toMatch(/[а-яё]/i);
    }
  });

  it('give type, unit, limits, defaults and the engine default', () => {
    expect(field(wagon, 'mass_t')).toMatchObject({ shape: 'number', required: true, unit: { id: 't', label: { en: 'tonne', ru: 'т' } }, limits: { exclusiveMinimum: 0 } });
    expect(field(wagon, 'max_speed_kmh')).toMatchObject({ hasDefault: true, default: 0, limits: { minimum: 0 } });
    expect(field(wagon, 'resistance', 'a').engineDefault).toEqual({ en: '7·mass_t + 200' });
    expect(field(wagon, 'brakes', 'train_kn').engineDefault?.ru).toMatch(/mass_t/);
    expect(field(wagon, 'brakes', 'system')).toMatchObject({ shape: 'string', enum: ['passenger', 'freight', 'ep'], default: 'passenger' });
    expect(field(wagon, 'doors')).toMatchObject({ shape: 'array', limits: { maxItems: 32 }, default: [] });
    expect(field(wagon, 'doors').items?.properties?.map((p) => p.key)).toEqual(['id', 'min', 'max', 'inner', 'fixed', 'connecting', 'group']);
    expect(field(wagon, 'bogies')).toMatchObject({ shape: 'array', items: { shape: 'number' }, unit: { id: 'block' } });
  });

  it('give status, frame and the deprecated forms', () => {
    expect(field(wagon, 'brakes', 'dynamic_kn').status).toMatchObject({ id: 'reserved', label: { ru: 'Зарезервировано' } });
    expect(field(wagon, 'brakes', 'dynamic_kn').status?.note.en).toMatch(/not modelled/);
    expect(field(wagon, 'cab', 'seat')).toMatchObject({ deprecated: true, frame: 'obj', shape: 'array' });
    const interior = field(wagon, 'interior');
    expect(interior.shape).toBe('oneOf');
    expect(interior.variants?.map((v) => [v.shape, v.deprecated])).toEqual([['array', false], ['object', true]]);
    expect(interior.variants?.[0]?.items?.frame).toBe('obj');
  });

  it('read an override field as the wagon type field, nullable', () => {
    const override = fields.root('recipe_override');
    const mass = field(override, 'type', 'mass_t');
    expect(mass).toMatchObject({ shape: 'number', nullable: true, unit: { id: 't' } });
    expect(field(override, 'type', 'brakes', 'dynamic_kn').status?.id).toBe('reserved');
    expect(override.comments).toBe(true);
    expect(field(override, 'type', 'doors').shape).toBe('anyOf');
    expect(field(override, 'floor', 'level').unit?.id).toBe('block');
  });

  it('describe dictionaries and a loop that is a string or an object', () => {
    const model = fields.root('wagon_model');
    expect(field(model, 'liveries')).toMatchObject({ shape: 'object', values: { shape: 'string' } });
    expect(field(model, 'sounds', 'controls').keyPattern).toBe('^[A-Za-z][A-Za-z_]*_[0-9]+$');
    expect(field(model, 'sounds', 'idle').variants?.map((v) => v.shape)).toEqual(['string', 'object']);
    expect(field(model, 'sounds', 'idle').engineDefault?.en).toMatch(/pitch/);
    expect(fields.at('common.schema.json#/$defs/vec3', store.uriOf('wagon_type'))).toMatchObject({ shape: 'array', limits: { minItems: 3, maxItems: 3 } });
    expect(fields.root('pack_mcmeta_rwat').properties?.map((p) => p.key)).toEqual(['pack', 'rwat']);
    for (const kind of SCHEMA_KINDS) expect([...walkFields(fields.root(kind))].length).toBeGreaterThanOrEqual(3);
  });
});
