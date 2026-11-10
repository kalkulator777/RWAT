import { act, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loaderProblems } from '../../checks/loader';
import { dump } from '../../core/json';
import { setLang } from '../../i18n';
import type { PythonBridge } from '../../ir/bridge';
import { useSuggestBridge } from './bridge';
import { PathRepair } from './PathRepair';
import { fakeBridge, packOf, realBridge } from './testing.node';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** A pack whose texture and model are named the way a Blender export names them. */
function files(): Record<string, string | Uint8Array> {
  return {
    'pack.mcmeta': '{"pack": {"pack_format": 34, "description": "t"}}',
    'assets/t/wagon_models/box.json': dump({ obj: 'stock/box.obj' }),
    'assets/t/stock/box.obj': 'mtllib box.mtl\no BODY\n',
    'assets/t/stock/box.mtl': 'newmtl body\nmap_Kd Textures/Body Map.png\n',
    'assets/t/stock/Textures/Body Map.png': PNG,
    'assets/t/stock/Other/Thing.PNG': text('x'),
  };
}

let bridge: PythonBridge;

beforeAll(() => {
  bridge = realBridge();
});

afterEach(() => {
  useSuggestBridge(null);
  setLang('en');
});

/** How many files the checks find with a path Minecraft refuses. */
function badCount(pack: Parameters<typeof loaderProblems>[0]): number {
  return loaderProblems(pack).filter((problem) => problem.code === 'loader.resource-path').length;
}

describe('«Переименовать и переписать ссылки» in the checks tab', () => {
  it('is nothing while no path is bad', async () => {
    setLang('en');
    const { pack, journal } = await packOf({ 'pack.mcmeta': '{"pack": {"pack_format": 34}}' });
    const view = render(<PathRepair pack={pack} files={0} readOnly={false} run={(command) => journal.run(command).then(() => true)} />);
    expect(view.container.querySelector('[data-testid="repair-paths"]')).toBeNull();
  });

  it('lists what it would do before it does it, then does it through the converter’s rewrite, and says what it did; undone, the pack is as it was', async () => {
    setLang('en');
    useSuggestBridge(bridge);
    const { pack, journal } = await packOf(files());
    const run = async (command: Parameters<typeof journal.run>[0]): Promise<boolean> => {
      await journal.run(command);
      return true;
    };
    const view = render(<PathRepair pack={pack} files={badCount(pack)} readOnly={false} run={run} />);
    const q = <T extends Element = HTMLElement>(selector: string) => view.container.querySelector<T>(selector);
    expect(q('[data-testid="repair-paths"]')?.getAttribute('data-bad')).toBe('2');
    expect(q('.suggest-repair .tool-note')?.textContent).toBe('Files with resource paths Minecraft refuses: 2. It will not load them.');

    fireEvent.click(q('[data-action="repair-review"]') as HTMLElement);
    await waitFor(() => expect(q('[data-testid="repair-plan"]')).not.toBeNull());
    const plan = q('[data-testid="repair-plan"]') as HTMLElement;
    expect(plan.getAttribute('data-files')).toBe('2');
    expect(plan.getAttribute('data-refs')).toBe('1');
    expect(plan.textContent).toContain('assets/t/stock/Textures/Body Map.png');
    expect(plan.textContent).toContain('assets/t/stock/textures/body_map.png');
    expect(plan.textContent).toContain('Textures/Body Map.png');
    expect(plan.textContent).toContain('textures/body_map.png');
    expect(plan.textContent).toContain('Ctrl+Z');
    // nothing has changed yet
    expect(pack.dirtyPaths()).toEqual([]);
    expect(journal.state().done).toEqual([]);

    const before = new Map((await pack.snapshot()).map((change) => [change.path, 'bytes' in change ? change.bytes : new Uint8Array()]));
    fireEvent.click(q('[data-action="repair-apply"]') as HTMLElement);
    await waitFor(() => expect(journal.state().done).toHaveLength(1), { timeout: 30_000 });
    expect(badCount(pack)).toBe(0);
    expect(await pack.text('assets/t/stock/box.mtl')).toBe('newmtl body\nmap_Kd textures/body_map.png\n');
    // the checks tab passes the new count: the findings are gone, the report stays
    view.rerender(<PathRepair pack={pack} files={badCount(pack)} readOnly={false} run={run} />);
    expect(q('[data-testid="repair-done"]')?.textContent).toBe('Done: files renamed — 2, references rewritten — 1. Ctrl+Z gives it all back.');
    expect(q('[data-testid="repair-plan"]')).toBeNull();

    journal.undo();
    expect(new Map((await pack.snapshot()).map((change) => [change.path, 'bytes' in change ? change.bytes : new Uint8Array()]))).toEqual(before);
    // bad paths are back: the report is not shown, the button is
    view.rerender(<PathRepair pack={pack} files={badCount(pack)} readOnly={false} run={run} />);
    expect(q('[data-testid="repair-done"]')).toBeNull();
    expect(q('[data-action="repair-review"]')).not.toBeNull();
  }, 60_000);

  it('shows Pyodide’s loading and a Cancel while the converter works; Cancel leaves the plan and changes nothing', async () => {
    setLang('en');
    const spy = fakeBridge();
    useSuggestBridge(spy);
    const { pack, journal } = await packOf(files());
    const run = async (command: Parameters<typeof journal.run>[0]): Promise<boolean> => {
      await journal.run(command);
      return true;
    };
    const view = render(<PathRepair pack={pack} files={badCount(pack)} readOnly={false} run={run} />);
    const q = <T extends Element = HTMLElement>(selector: string) => view.container.querySelector<T>(selector);
    fireEvent.click(q('[data-action="repair-review"]') as HTMLElement);
    await waitFor(() => expect(q('[data-testid="repair-plan"]')).not.toBeNull());
    fireEvent.click(q('[data-action="repair-apply"]') as HTMLElement);
    await waitFor(() => expect(q('[data-testid="suggest-progress"]')).not.toBeNull());
    await act(() => spy.report({ stage: 'download', loaded: 2 * 2 ** 20, total: 13 * 2 ** 20 }));
    expect(q('[data-testid="suggest-progress"] [role="status"]')?.textContent).toBe('Loading Python (Pyodide), the first time only: 2 of 13 MB');
    expect(q('[data-action="repair-apply"]')?.hasAttribute('disabled')).toBe(true);
    fireEvent.click(q('[data-action="suggest-cancel"]') as HTMLElement);
    await waitFor(() => expect(q('[data-testid="suggest-progress"]')).toBeNull());
    expect(q('[data-testid="repair-plan"]')).not.toBeNull();
    expect(q('[data-testid="repair-error"]')).toBeNull();
    expect(journal.state().done).toEqual([]);
    expect(pack.dirtyPaths()).toEqual([]);
  });

  it('is off for a pack that is only shown, and tells what it leaves alone', async () => {
    setLang('ru');
    const { pack, journal } = await packOf({ ...files(), 'assets/t/wagon_models/Foo.json': '{}' });
    const run = (command: Parameters<typeof journal.run>[0]): Promise<boolean> => journal.run(command).then(() => true);
    const view = render(<PathRepair pack={pack} files={badCount(pack)} readOnly={true} run={run} />);
    expect(view.container.querySelector('[data-action="repair-review"]')?.hasAttribute('disabled')).toBe(true);
    view.rerender(<PathRepair pack={pack} files={badCount(pack)} readOnly={false} run={run} />);
    fireEvent.click(view.container.querySelector('[data-action="repair-review"]') as HTMLElement);
    await waitFor(() => expect(view.container.querySelector('[data-testid="repair-plan"]')).not.toBeNull());
    expect(view.container.querySelector('[data-testid="repair-plan"]')?.textContent).toContain('Останутся как есть (1)');
    expect(view.container.querySelector('[data-testid="repair-plan"]')?.textContent).toContain('assets/t/wagon_models/Foo.json');
  });
});
