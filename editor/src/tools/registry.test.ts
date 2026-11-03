import { describe, expect, it } from 'vitest';
import { createSchema } from '../core/schema';
import { readSchemaFiles } from '../core/schema/files.node';
import { exampleModel } from '../model/testing.node';
import { tools } from './index';
import { collectTools, covers, defineTool, framedFields, subjectOf, toolFor, ToolHost, type ToolContext, type ToolDef } from './registry';
import { bench, openExamplePack } from './testing.node';

const schema = createSchema(readSchemaFiles());

/**
 * The spatial fields of the wagon type no tool edits yet, each with the tool that is to:
 * the doors' and the chairs' come with the next wave of M4 (docs/proposals/editor.md §7,
 * A4.2, A4.3). A tool that lands takes its fields off this list; a new spatial field of the
 * schema with no tool turns the test red. The floor's zones are tools/floor's.
 */
const WAITING_IN_WAGON_TYPE: Readonly<Record<string, string>> = {
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
        './c/index.ts': { default: tool('floor', ['/interior', '/interior/*']) },
        './d/index.ts': { default: tool('zones', ['/interior/2/min']) },
        './e/index.ts': { default: tool('floor', ['/doors/*']) },
        './f/index.ts': { default: { ...tool('x', []), activate: undefined } as unknown as ToolDef },
      });
    expect(broken).toThrow(/no default export of defineTool/);
    expect(broken).toThrow(/'Bad Id': id must be/);
    expect(broken).toThrow(/no title key/);
    expect(broken).toThrow(/no hint key/);
    expect(broken).toThrow(/order must be a finite number/);
    expect(broken).toThrow(/field 'interior' is not a pointer/);
    expect(broken).toThrow(/'zones': field '\/interior\/2\/min' is already tool 'floor''s \('\/interior'\)/);
    // a tool's own places may lie one inside another
    expect(broken).not.toThrow(/field '\/interior\/\*' is already/);
    expect(broken).toThrow(/id already used in \.\/c\/index\.ts/);
    expect(broken).toThrow(/'x': no activate/);
  });

  it('registers the tools of the editor without a problem', () => {
    expect(() => tools.map((t) => t.id)).not.toThrow();
    for (const t of tools) expect(t.fields.length).toBeGreaterThan(0);
  });

  it('refuses a kind of link that is no markup, or that two tools select', () => {
    const broken = (): ToolDef[] =>
      collectTools({
        './a/index.ts': { default: tool('floor', ['/interior'], { selects: ['zone'] }) },
        './b/index.ts': { default: tool('zones', ['/doors/*'], { selects: ['zone', 'object' as never] }) },
        './c/index.ts': { default: tool('chairs', ['/cab/seat'], { selects: 'seat' as never }) },
      });
    expect(broken).toThrow(/'zones': 'zone' links are already tool 'floor''s/);
    expect(broken).toThrow(/'zones': 'object' is no kind of markup link/);
    expect(broken).toThrow(/'chairs': selects must be a list of link kinds/);
    expect(() => collectTools({ './a/index.ts': { default: tool('lights', []) } })).not.toThrow();
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

describe('the tool that is on', () => {
  /** A tool that records what it was given and when it was turned off. */
  function recorder(id = 'probe', extra: Partial<ToolDef> = {}) {
    const log: string[] = [];
    const contexts: ToolContext[] = [];
    const def = tool(id, ['/interior/*'], {
      activate: (context) => {
        contexts.push(context);
        log.push(`on ${context.subject.value?.wagon ?? 'none'}`);
        return {
          Inspector: () => null,
          dispose: () => {
            log.push(`off ${context.subject.value?.wagon ?? 'none'}`);
          },
        };
      },
      ...extra,
    });
    return { def, log, contexts };
  }

  it('works on a type paired with a model, as the pack holds it, and follows its edits', async () => {
    const b = await bench();
    const probe = recorder();
    const host = new ToolHost([probe.def]);
    const stop = host.connect(b.wiring);
    expect(host.subject.value).toMatchObject({
      wagon: 'rwat_example:coach',
      typeFile: 'data/rwat_example/wagon_types/coach.json',
      modelFile: 'assets/rwat_example/wagon_models/coach.json',
      model: null,
      readOnly: false,
    });
    expect(host.subject.value?.type?.doors.length).toBe(8);
    expect(host.canUse(probe.def)).toBe(true);

    host.use('probe');
    expect(probe.log).toEqual(['on rwat_example:coach']);
    expect(host.current.value?.tool.id).toBe('probe');
    const context = probe.contexts[0] as ToolContext;
    expect(context.view).toBe(b.view);
    expect(context.selection).toBe(b.selection);

    // an edit through the context is the journal's, and the subject follows it
    expect(context.dispatch({ label: 'x', ops: [{ op: 'set', file: 'data/rwat_example/wagon_types/coach.json', at: '/length', value: 21 }] })).toBe(true);
    expect((context.subject.value?.typeJson as { length: number }).length).toBe(21);
    expect(context.subject.value?.type?.length).toBe(21);
    expect(b.journal.canUndo).toBe(true);

    host.use(null);
    expect(probe.log).toEqual(['on rwat_example:coach', 'off rwat_example:coach']);
    expect(host.current.value).toBeNull();
    stop();
  });

  it('is turned off and on afresh for another wagon, and off for good when none applies', async () => {
    const b = await bench();
    const probe = recorder();
    const host = new ToolHost([probe.def]);
    const stop = host.connect(b.wiring);
    host.use('probe');
    b.openWagon.value = 'rwat_example:shunter';
    expect(probe.log).toEqual(['on rwat_example:coach', 'off rwat_example:coach', 'on rwat_example:shunter']);
    // the first session never saw the shunter: its subject stays its own wagon's
    expect(probe.contexts[0]?.subject.value?.wagon).toBe('rwat_example:coach');
    expect(host.active.value).toBe('probe');

    b.openWagon.value = null;
    expect(probe.log.at(-1)).toBe('off rwat_example:shunter');
    expect(host.active.value).toBeNull();
    expect(host.canUse(probe.def)).toBe(false);
    host.use('probe');
    expect(host.current.value).toBeNull();
    expect(host.active.value).toBeNull();
    stop();
  });

  it('gives the open model to the tool once it is the wagon’s, and refuses a tool that does not apply', async () => {
    const coach = await exampleModel('coach');
    const b = await bench('rwat_example:shunter', coach);
    const picky = recorder('picky', { applies: (subject) => subject.wagon.endsWith(':coach') });
    const host = new ToolHost([picky.def]);
    const stop = host.connect(b.wiring);
    expect(host.subject.value?.model).toBeNull();
    expect(host.canUse(picky.def)).toBe(false);
    host.use('picky');
    expect(picky.log).toEqual([]);
    b.openWagon.value = 'rwat_example:coach';
    expect(host.subject.value?.model).toBe(coach);
    host.use('picky');
    expect(picky.log).toEqual(['on rwat_example:coach']);
    host.use('nonsense');
    expect(host.active.value).toBe('picky');
    stop();
    expect(picky.log).toEqual(['on rwat_example:coach', 'off rwat_example:coach']);
  });

  it('is turned on by a zone, door or chair of the open wagon coming into the selection, as a finding in the checks selects it', async () => {
    const b = await bench();
    const zones = recorder('zones', { selects: ['zone'] });
    const doors = recorder('doors', { selects: ['door'], fields: ['/doors/*'] });
    const host = new ToolHost([zones.def, doors.def]);
    const stop = host.connect(b.wiring);
    expect(host.active.value).toBeNull();
    b.selection.value = [{ kind: 'field', file: 'data/rwat_example/wagon_types/coach.json', at: '/doors/6' }, { kind: 'door', type: 'rwat_example:coach', index: 6 }];
    expect(host.active.value).toBe('doors');
    expect(doors.log).toEqual(['on rwat_example:coach']);
    // the tool on selects that kind: it stays; another kind: its tool comes on
    b.selection.value = [{ kind: 'door', type: 'rwat_example:coach', index: 2 }];
    expect(host.active.value).toBe('doors');
    b.selection.value = [{ kind: 'zone', type: 'rwat_example:coach', index: 1 }];
    expect(host.active.value).toBe('zones');
    // turned off by hand, it stays off while the selection stands
    host.use(null);
    b.revision.value++;
    expect(host.active.value).toBeNull();
    // the plain selection of an object turns nothing on
    b.selection.value = [{ kind: 'object', model: 'rwat_example:coach', name: 'ROOF' }];
    expect(host.active.value).toBeNull();
    stop();
  });

  it('waits with it for the wagon of the link to open, and forgets it for a selection that moves on', async () => {
    const b = await bench();
    const chairs = recorder('chairs', { selects: ['seat'] });
    const host = new ToolHost([chairs.def]);
    const stop = host.connect(b.wiring);
    b.selection.value = [{ kind: 'seat', type: 'rwat_example:shunter', index: 0 }];
    expect(host.active.value).toBeNull();
    b.selection.value = [{ kind: 'file', file: 'pack.mcmeta' }];
    b.openWagon.value = 'rwat_example:shunter';
    expect(host.active.value).toBeNull();
    b.selection.value = [{ kind: 'seat', type: 'rwat_example:shunter', index: 1 }];
    expect(host.active.value).toBe('chairs');
    expect(chairs.log).toEqual(['on rwat_example:shunter']);
    stop();
  });

  it('takes no wagon without a type or a model', async () => {
    const { pack } = await openExamplePack();
    expect(subjectOf(pack, 'rwat_example:nope', null)).toBeNull();
    expect(subjectOf(null, 'rwat_example:coach', null)).toBeNull();
    expect(subjectOf(pack, null, null)).toBeNull();
  });
});
