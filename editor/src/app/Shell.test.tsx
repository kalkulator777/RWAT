import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lang, setLang } from '../i18n';
import { DEFAULT_LAYOUT, layout } from './layout';
import { collectPanels, definePanel, type PanelDef } from './registry';
import { Shell } from './Shell';
import { mode, updateReady } from './store';

function panel(id: string, slot: PanelDef['slot'], order: number, extra: Partial<PanelDef> = {}): PanelDef {
  return definePanel({ id, slot, order, title: `test.${id}`, component: () => <p>{`content of ${id}`}</p>, ...extra });
}

const panels = collectPanels({
  '../panels/open/index.ts': { default: panel('open', 'toolbar', 10, { component: () => <button>Open</button> }) },
  '../panels/tree/index.ts': { default: panel('tree', 'tree', 10, { modes: ['2a'] }) },
  '../panels/ir/index.ts': { default: panel('ir-recipe', 'tree', 10, { modes: ['2b'] }) },
  '../panels/view/index.ts': { default: panel('view', 'view', 10) },
  '../panels/checks/index.ts': { default: panel('checks', 'bottom', 10) },
  '../panels/objects/index.ts': { default: panel('objects', 'bottom', 20) },
  '../panels/log/index.ts': { default: panel('log', 'bottom', 50) },
});

beforeEach(() => {
  setLang('ru');
  mode.value = '2a';
  layout.value = { ...DEFAULT_LAYOUT };
  updateReady.value = null;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Shell without panels', () => {
  it('lays out the regions of §6.1 with their names and empty states', () => {
    render(<Shell panels={[]} />);
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Пак' }).textContent).toBe('Откройте пак или создайте новый.');
    expect(screen.getByRole('main', { name: 'Вид' }).textContent).toBe('Модель не открыта.');
    expect(screen.getByRole('complementary', { name: 'Инспектор' }).textContent).toBe('Ничего не выделено.');
    expect(screen.getByRole('region', { name: 'Нижние вкладки' }).textContent).toBe('Вкладок пока нет.');
    expect(screen.getAllByRole('separator').map((s) => s.getAttribute('aria-label'))).toEqual([
      'Ширина дерева пака',
      'Ширина инспектора',
      'Высота нижних вкладок',
    ]);
  });

  it('switches every text to the other language at once', () => {
    render(<Shell panels={[]} />);
    const languages = screen.getByRole('group', { name: 'Язык интерфейса' });
    fireEvent.click(within(languages).getByRole('button', { name: 'EN' }));
    expect(lang.value).toBe('en');
    expect(screen.getByRole('main', { name: 'View' }).textContent).toBe('No model open.');
    expect(screen.getByRole('group', { name: 'Interface language' })).toBeTruthy();
    expect(within(languages).getByRole('button', { name: 'EN' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(languages).getByRole('button', { name: 'RU' }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Shell with panels', () => {
  it('puts each panel into its slot', () => {
    render(<Shell panels={panels} />);
    expect(within(screen.getByRole('group', { name: 'Действия' })).getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Пак' }).textContent).toBe('content of tree');
    expect(screen.getByRole('main', { name: 'Вид' }).textContent).toBe('content of view');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['test.checks', 'test.objects', 'test.log']);
  });

  it('shows the panels of the chosen mode', () => {
    render(<Shell panels={panels} />);
    fireEvent.click(screen.getByRole('button', { name: 'IR-пак' }));
    expect(mode.value).toBe('2b');
    expect(screen.getByRole('complementary', { name: 'Пак' }).textContent).toBe('content of ir-recipe');
  });

  it('switches bottom tabs by click and by arrow keys, keeping the hidden panels mounted', () => {
    render(<Shell panels={panels} />);
    const [checks, objects, log] = screen.getAllByRole('tab') as [HTMLElement, HTMLElement, HTMLElement];
    expect(checks.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(objects);
    expect(objects.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('content of objects');
    fireEvent.keyDown(objects, { key: 'ArrowRight' });
    expect(log.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(log);
    fireEvent.keyDown(log, { key: 'ArrowRight' });
    expect(checks.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(checks, { key: 'End' });
    expect(log.getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(3);
  });
});

describe('splitters', () => {
  it('resize their area from the keyboard, within its limits', () => {
    render(<Shell panels={[]} />);
    const [tree, inspector, bottom] = screen.getAllByRole('separator') as [HTMLElement, HTMLElement, HTMLElement];
    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    expect(layout.value.tree).toBe(DEFAULT_LAYOUT.tree + 16);
    fireEvent.keyDown(inspector, { key: 'ArrowLeft', shiftKey: true });
    expect(layout.value.inspector).toBe(DEFAULT_LAYOUT.inspector + 64);
    fireEvent.keyDown(bottom, { key: 'ArrowUp' });
    expect(layout.value.bottom).toBe(DEFAULT_LAYOUT.bottom + 16);
    fireEvent.keyDown(tree, { key: 'Home' });
    expect(layout.value.tree).toBe(160);
    expect(tree.getAttribute('aria-valuenow')).toBe('160');
  });
});

describe('new version notice', () => {
  it('appears when a new version waits, reloads only when asked, and can be put off', () => {
    let reloads = 0;
    render(<Shell panels={[]} />);
    expect(screen.queryByRole('status')).toBeNull();
    updateReady.value = () => {
      reloads++;
    };
    // Signals re-render on the next frame of Preact's scheduler; findBy waits for it.
    return screen.findByRole('status').then((notice) => {
      fireEvent.click(within(notice).getByRole('button', { name: 'Перезагрузить' }));
      expect(reloads).toBe(1);
      fireEvent.click(within(notice).getByRole('button', { name: 'Позже' }));
      return new Promise<void>((done) => {
        setTimeout(() => {
          expect(screen.queryByRole('status')).toBeNull();
          done();
        }, 50);
      });
    });
  });
});
