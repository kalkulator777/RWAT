import { describe, expect, it } from 'vitest';
import { panels as registered } from './panels';
import { collectPanels, definePanel, panelsIn, type PanelDef } from './registry';

const Empty = () => null;

function panel(id: string, slot: PanelDef['slot'], order: number, extra: Partial<PanelDef> = {}): PanelDef {
  return definePanel({ id, slot, order, title: `${id}.title`, component: Empty, ...extra });
}

describe('collectPanels', () => {
  it('takes one panel or a list per module and sorts them by order, then id', () => {
    const panels = collectPanels({
      '../panels/log/index.ts': { default: panel('log', 'bottom', 50) },
      '../panels/journal/index.ts': {
        default: [panel('journal', 'bottom', 40), panel('undo-redo', 'toolbar', 20)],
      },
      '../panels/checks/index.ts': { default: panel('checks', 'bottom', 10) },
      '../panels/objects/index.ts': { default: panel('objects', 'bottom', 10) },
    });
    expect(panels.map((p) => p.id)).toEqual(['checks', 'objects', 'undo-redo', 'journal', 'log']);
  });

  it('refuses a broken declaration with every problem listed', () => {
    const broken = {
      '../panels/a/index.ts': { default: panel('checks', 'bottom', 10) },
      '../panels/b/index.ts': { default: panel('checks', 'sidebar' as PanelDef['slot'], 10) },
      '../panels/c/index.ts': { default: panel('Bad_Id', 'tree', Number.NaN, { title: '' }) },
      '../panels/d/index.ts': {},
    };
    expect(() => collectPanels(broken)).toThrow(
      [
        'Panel registration failed:',
        "../panels/b/index.ts: panel 'checks': unknown slot 'sidebar'",
        "../panels/b/index.ts: panel 'checks': id already used in ../panels/a/index.ts",
        "../panels/c/index.ts: panel 'Bad_Id': id must be lower-case words joined by '-'",
        "../panels/c/index.ts: panel 'Bad_Id': no title key",
        "../panels/c/index.ts: panel 'Bad_Id': order must be a finite number",
        '../panels/d/index.ts: no default export of definePanel(...)',
      ].join('\n'),
    );
  });
});

describe('panelsIn', () => {
  it('gives the panels of a slot that show in the mode', () => {
    const panels = collectPanels({
      '../panels/tree/index.ts': { default: panel('tree', 'tree', 10, { modes: ['2a'] }) },
      '../panels/ir/index.ts': { default: panel('ir-recipe', 'tree', 10, { modes: ['2b'] }) },
      '../panels/checks/index.ts': { default: panel('checks', 'bottom', 10) },
    });
    expect(panelsIn(panels, 'tree', '2a').map((p) => p.id)).toEqual(['tree']);
    expect(panelsIn(panels, 'tree', '2b').map((p) => p.id)).toEqual(['ir-recipe']);
    expect(panelsIn(panels, 'bottom', '2b').map((p) => p.id)).toEqual(['checks']);
  });
});

describe('the registered panels', () => {
  it('load without a registration problem', () => {
    expect(Array.isArray(registered)).toBe(true);
  });
});
