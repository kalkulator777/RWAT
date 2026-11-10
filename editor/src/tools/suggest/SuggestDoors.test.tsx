import { act, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { dump } from '../../core/json';
import { setLang } from '../../i18n';
import { COACH_OBJ } from '../../ir/testing.node';
import doorsTool, { type DoorsSession } from '../doors';
import { ToolHost } from '../registry';
import { ToolSection } from '../ToolBar';
import { useSuggestBridge } from './bridge';
import { fakeBridge, wagonBench } from './testing.node';

const TYPE = 'data/t/wagon_types/box.json';
const found = [
  { id: 'DoorA', min: [2.95, 0.9, -0.5], max: [3.05, 3, 0.5], inner: true },
  { id: 'door_1', min: [-1, 0.9, 1.35], max: [0, 3, 1.45] },
];

afterEach(() => {
  useSuggestBridge(null);
  setLang('en');
});

/** The doors tool of a wagon made here, shown in the inspector as the shell shows it; `generated`: a pack the editor only shows. */
async function shown(doors: unknown[] | undefined, generated = false) {
  setLang('en');
  const b = await wagonBench(
    {
      'pack.mcmeta': '{"pack": {"pack_format": 34, "description": "t"}}',
      ...(generated ? { 'RWAT_CONVERSION.txt': 'made by ir2rwat' } : {}),
      [TYPE]: dump({ length: 10, bogies: [3, -3], mass_t: 20, max_speed_kmh: 100, ...(doors === undefined ? {} : { doors }) }),
      'assets/t/wagon_models/box.json': dump({ obj: 'stock/box.obj', animations: { doora: 'stock/doora.anim' } }),
      'assets/t/stock/box.obj': COACH_OBJ,
      'assets/t/stock/doora.anim': 'O WIDGET_2_TOGGLE_CG_DoorA\n',
    },
    't:box',
  );
  const host = new ToolHost([doorsTool]);
  const stop = host.connect(b.wiring);
  host.use('doors');
  const view = render(<ToolSection host={host} />);
  const q = <T extends Element = HTMLElement>(selector: string) => view.container.querySelector<T>(selector);
  const by = (host.current.value?.session as DoorsSession).tool.byNames;
  return { b, stop, q, by, view };
}

describe('«Двери по именам» in the doors tool’s section', () => {
  it('explains what it reads and asks for nothing until the button', async () => {
    const spy = fakeBridge();
    useSuggestBridge(spy);
    const { q, stop } = await shown(undefined);
    expect(q('[data-testid="suggest-doors"] legend')?.textContent).toBe('Doors by names');
    expect(q('[data-testid="suggest-doors"] > .tool-note')?.textContent).toContain('DOOR_<n>');
    expect(q('[data-action="suggest-doors-run"]')?.textContent).toBe('Find doors by names');
    expect(spy.calls).toEqual([]);
    stop();
  });

  it('shows the progress, then the doors found against the type’s: Accept adds the new ones, one entry', async () => {
    const spy = fakeBridge({ modelDoors: () => found });
    useSuggestBridge(spy);
    const { b, q, stop } = await shown([{ id: 'doora', min: [1, 1, 1], max: [2, 2, 2], inner: true }]);
    fireEvent.click(q('[data-action="suggest-doors-run"]') as HTMLElement);
    await waitFor(() => expect(q('[data-testid="suggest-progress"]')).not.toBeNull());
    expect(spy.calls[0]?.args).toEqual([['doora']]);
    await act(() => spy.release());
    await waitFor(() => expect(q('[data-testid="suggest-doors-draft"]')).not.toBeNull());
    expect(q('[data-testid="suggest-doors-draft"] h4')?.textContent).toBe('2 doors found; new: 1');
    const items = [...(q('[data-testid="suggest-doors-found"]') as HTMLElement).querySelectorAll('li')];
    expect(items.map((li) => [li.getAttribute('data-door-id'), li.getAttribute('data-present')])).toEqual([['DoorA', 'true'], ['door_1', 'false']]);
    expect(items[0]?.textContent).toContain('a door with this id is there already');
    expect(q('[data-action="suggest-doors-accept"]')?.textContent).toBe('Accept: add 1 door');

    const entries = b.journal.state().done.length;
    fireEvent.click(q('[data-action="suggest-doors-accept"]') as HTMLElement);
    expect(b.journal.state().done).toHaveLength(entries + 1);
    expect((b.pack.value?.json(TYPE) as { doors: { id: string }[] }).doors.map((door) => door.id)).toEqual(['doora', 'door_1']);
    await waitFor(() => expect(q('[data-testid="suggest-doors-draft"]')).toBeNull());
    expect(q('[data-testid="doors-tool"]')?.getAttribute('data-doors')).toBe('2');
    stop();
  });

  it('says so when the model has no doors by names, and when it has nothing new', async () => {
    const spy = fakeBridge({ modelDoors: () => [] });
    useSuggestBridge(spy);
    const { q, stop } = await shown(undefined);
    fireEvent.click(q('[data-action="suggest-doors-run"]') as HTMLElement);
    await waitFor(() => expect(spy.calls).toHaveLength(1));
    await act(() => spy.release());
    await waitFor(() => expect(q('[data-testid="suggest-doors-none"]')).not.toBeNull());
    expect(q('[data-testid="suggest-doors-none"]')?.textContent).toContain('no DOOR_<n> objects');
    expect(q('[data-action="suggest-doors-accept"]')?.hasAttribute('disabled')).toBe(true);
    fireEvent.click(q('[data-action="suggest-doors-reject"]') as HTMLElement);
    expect(q('[data-testid="suggest-doors-draft"]')).toBeNull();
    stop();
  });

  it('says a failure in words and ends a Cancel with nothing said', async () => {
    const waiting = fakeBridge();
    useSuggestBridge(waiting);
    const { q, stop } = await shown(undefined);
    fireEvent.click(q('[data-action="suggest-doors-run"]') as HTMLElement);
    await waitFor(() => expect(q('[data-action="suggest-cancel"]')).not.toBeNull());
    fireEvent.click(q('[data-action="suggest-cancel"]') as HTMLElement);
    await waitFor(() => expect(q('[data-testid="suggest-doors"]')?.getAttribute('data-phase')).toBe('idle'));
    expect(q('[data-testid="suggest-doors-error"]')).toBeNull();

    const failing = fakeBridge();
    failing.modelDoors = () => Promise.reject(new Error('the worker is gone'));
    useSuggestBridge(failing);
    fireEvent.click(q('[data-action="suggest-doors-run"]') as HTMLElement);
    await waitFor(() => expect(q('[data-testid="suggest-doors-error"]')).not.toBeNull());
    expect(q('[data-testid="suggest-doors-error"] p')?.textContent).toBe('That did not work.');
    expect(q('[data-testid="suggest-doors-error"] pre')?.textContent).toBe('the worker is gone');
    stop();
  });

  it('is off for a pack that is only shown', async () => {
    const { q, stop } = await shown(undefined, true);
    expect(q('[data-action="suggest-doors-run"]')?.hasAttribute('disabled')).toBe(true);
    stop();
  });
});
