import { describe, expect, it } from 'vitest';
import { createSchema } from '../core/schema';
import { readSchemaFiles } from '../core/schema/files.node';
import { tools } from './index';
import { collectTools, covers, defineTool, framedFields, toolFor, type ToolDef } from './registry';

const schema = createSchema(readSchemaFiles());

/**
 * The spatial fields of the wagon type no tool edits yet, each with the tool that is to:
 * the doors' and the chairs' come with the next wave of M4 (docs/proposals/editor.md §7,
 * A4.2, A4.3). A tool that lands takes its fields off this list; a new spatial field of the
 * schema with no tool turns the test red.
 */
const WAITING_IN_WAGON_TYPE: Readonly<Record<string, string>> = {
  '/interior': 'A4.1 tools/floor',
  '/interior/*': 'A4.1 tools/floor',
  '/doors/*': 'A4.2 tools/doors',
  '/cab/seat': 'A4.3 tools/seats (the old form of one chair)',
  '/cab/seats/*/at': 'A4.3 tools/seats',
};

/**
 * The spatial fields of a conversion override (2b): the type's markup as the override
 * writes it (`type`), and the floor generator's level and boxes. Their tools come with the
 * IR packs (M6: the override's three-state fields, tools/suggest).
 */
const WAITING_IN_OVERRIDE: Readonly<Record<string, string>> = {
  '/floor/add/*': 'M6 tools/suggest',
  '/floor/level': 'M6 tools/suggest',
  '/floor/remove/*': 'M6 tools/suggest',
  '/type/cab/seat': 'M6 overrides',
  '/type/cab/seats/*/at': 'M6 overrides',
  '/type/doors/*': 'M6 overrides',
  '/type/interior': 'M6 overrides',
  '/type/interior/*': 'M6 overrides',
};

function tool(id: string, fields: readonly string[], extra: Partial<ToolDef> = {}): ToolDef {
  return defineTool({
    id,
    order: 10,
    title: `tools.${id}.title`,
    hint: `tools.${id}.hint`,
    fields,
    activate: () => ({ Inspector: () => null, dispose: () => undefined }),
    ...extra,
  });
}

describe('the places a tool edits', () => {
  it('cover what is below them, a star standing for any element', () => {
    expect(covers('/interior/*', '/interior/2/min')).toBe(true);
    expect(covers('/interior/*', '/interior/*')).toBe(true);
    expect(covers('/interior', '/interior/0')).toBe(true);
    expect(covers('/cab/seats/*/at', '/cab/seats/1/at')).toBe(true);
    expect(covers('/cab/seats/*/at', '/cab/seats/1/yaw')).toBe(false);
    expect(covers('/interior/*', '/interior')).toBe(false);
    expect(covers('/doors/*', '/interior/0')).toBe(false);
    expect(covers('doors', '/doors')).toBe(false);
  });

  it('name the tool of a place', () => {
    const list = [tool('floor', ['/interior', '/interior/*']), tool('doors', ['/doors/*'])];
    expect(toolFor(list, '/interior/3/max')?.id).toBe('floor');
    expect(toolFor(list, '/doors/0')?.id).toBe('doors');
    expect(toolFor(list, '/cab/seats/0/at')).toBeUndefined();
  });

  it('are found in the schema by x-frame: list elements as a star, the old forms of a oneOf as the place itself', () => {
    expect(framedFields(schema.fields.root('wagon_type'))).toEqual(['/cab/seat', '/cab/seats/*/at', '/doors/*', '/interior', '/interior/*']);
    expect(framedFields(schema.fields.root('wagon_model'))).toEqual([]);
  });
});

describe('the registration of tools', () => {
  it('sorts the tools by order, then id', () => {
    const list = collectTools({
      './b/index.ts': { default: tool('seats', ['/cab/seats/*/at'], { order: 30 }) },
      './a/index.ts': { default: tool('doors', ['/doors/*'], { order: 20 }) },
      './c/index.ts': { default: tool('floor', ['/interior/*'], { order: 20 }) },
    });
    expect(list.map((t) => t.id)).toEqual(['doors', 'floor', 'seats']);
  });

  it('refuses a broken declaration with every problem listed', () => {
    const broken = (): ToolDef[] =>
      collectTools({
        './a/index.ts': {},
        './b/index.ts': { default: tool('Bad Id', ['interior'], { title: '', hint: '', order: Number.NaN }) },
        './c/index.ts': { default: tool('floor', ['/interior/*']) },
        './d/index.ts': { default: tool('floor', ['/interior/2/min']) },
        './e/index.ts': { default: { ...tool('x', []), activate: undefined } as unknown as ToolDef },
      });
    expect(broken).toThrow(/no default export of defineTool/);
    expect(broken).toThrow(/'Bad Id': id must be/);
    expect(broken).toThrow(/no title key/);
    expect(broken).toThrow(/no hint key/);
    expect(broken).toThrow(/order must be a finite number/);
    expect(broken).toThrow(/field 'interior' is not a pointer/);
    expect(broken).toThrow(/field '\/interior\/2\/min' is already tool 'floor''s \('\/interior\/\*'\)/);
    expect(broken).toThrow(/id already used in \.\/c\/index\.ts/);
    expect(broken).toThrow(/'x': no activate/);
  });

  it('registers the tools of the editor without a problem', () => {
    expect(() => tools.map((t) => t.id)).not.toThrow();
    for (const t of tools) expect(t.fields.length).toBeGreaterThan(0);
  });
});

describe('every spatial field has a tool', () => {
  it('of the wagon type, but those waiting for theirs', () => {
    const missing = framedFields(schema.fields.root('wagon_type')).filter((field) => toolFor(tools, field) === undefined);
    expect(missing).toEqual(Object.keys(WAITING_IN_WAGON_TYPE).sort());
  });

  it('of a conversion override, all waiting for the IR packs', () => {
    expect(framedFields(schema.fields.root('recipe_override'))).toEqual(Object.keys(WAITING_IN_OVERRIDE).sort());
  });

  it('and no tool claims a place the schema has no spatial field at', () => {
    const fields = framedFields(schema.fields.root('wagon_type'));
    for (const t of tools) {
      for (const pattern of t.fields) expect(fields.some((field) => covers(pattern, field) || covers(field, pattern)), `${t.id}: ${pattern}`).toBe(true);
    }
  });
});
