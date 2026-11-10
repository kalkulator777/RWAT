import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { BridgeError } from '../../ir/bridge';
import { exampleModel } from '../../model/testing.node';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import floorTool, { type FloorSession } from '../floor';
import { FLOOR_TIMING } from '../floor/session';
import { zonesOf } from '../floor/zones';
import { ToolHost } from '../registry';
import { ToolSection } from '../ToolBar';
import { bench } from '../testing.node';
import { useSuggestBridge } from './bridge';
import { fakeBridge } from './testing.node';

const COACH = 'rwat_example:coach';
const COACH_TYPE = 'data/rwat_example/wagon_types/coach.json';
const coachModel = await exampleModel('coach');
// drawn again at once after each edit, however slow an instrumented run is
FLOOR_TIMING.slowMs = Number.POSITIVE_INFINITY;

/** The coach's own floor, which the floor check finds nothing wrong with. */
const ZONES = (JSON.parse(readFileSync(join(EXAMPLE_PACK, ...COACH_TYPE.split('/')), 'utf8')) as { interior: unknown[] }).interior;

afterEach(() => {
  useSuggestBridge(null);
  setLang('en');
});

/** The zones tool of the coach (without its floor when `bare`), shown in the inspector as the shell shows it. */
async function shown(bare = true) {
  setLang('en');
  const b = await bench(COACH, coachModel);
  if (bare) b.journal.dispatch({ label: 'x', ops: [{ op: 'remove', file: COACH_TYPE, at: '/interior' }] });
  const host = new ToolHost([floorTool]);
  const stop = host.connect(b.wiring);
  host.use('floor');
  const view = render(<ToolSection host={host} />);
  const q = <T extends Element = HTMLElement>(selector: string) => view.container.querySelector<T>(selector);
  const suggest = (host.current.value?.session as FloorSession).tool.suggest;
  return { b, host, stop, view, q, suggest };
}

const draft = { interior: ZONES, levels: [1.3], notes: ['a note of the generator'], regionArea: 19.9, droppedArea: 0 };

describe('«Предложить пол» in the zones tool’s section', () => {
  it('is there, with the no-floor note, and asks for nothing until the button', async () => {
    const spy = fakeBridge();
    useSuggestBridge(spy);
    const { q, stop } = await shown();
    expect(q('[data-testid="suggest-floor"]')?.getAttribute('data-phase')).toBe('idle');
    expect(q('[data-testid="floor-tool"]')?.getAttribute('data-zones')).toBe('0');
    expect(q('[data-action="suggest-floor-run"]')?.textContent).toBe('Suggest a floor');
    expect(q('[data-testid="suggest-levels"]')?.textContent).toContain('No level given');
    expect(spy.calls).toEqual([]);
    stop();
  });

  it('takes levels by number or by a click on the model, shows them as chips and removes them', async () => {
    const { b, q, suggest, stop } = await shown();
    const input = q<HTMLInputElement>('#suggest-level') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '1.3' } });
    fireEvent.change(input, { target: { value: '1.3' } });
    expect(suggest.levels.value).toEqual([1.3]);
    expect(q('[data-testid="suggest-levels"]')?.getAttribute('data-levels')).toBe('1.3');
    expect(input.value).toBe('');
    // a text that is no number is said and adds nothing
    fireEvent.change(input, { target: { value: '1,3' } });
    expect(q('[role="alert"]')?.textContent).toBe('A number, with a point');
    expect(suggest.levels.value).toEqual([1.3]);

    const pick = q('[data-action="suggest-pick-level"]') as HTMLElement;
    fireEvent.click(pick);
    expect(pick.getAttribute('aria-pressed')).toBe('true');
    expect(suggest.picking.value).toBe(true);
    await act(() => {
      b.view.emitPick({ object: 'FLOOR', point: [0, 1.15, 0], shift: false, ctrl: false, alt: false, double: false });
    });
    expect(suggest.levels.value).toEqual([1.3, 1.15]);
    expect(q('[data-action="suggest-pick-level"]')?.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(q('.suggest-chip[data-level="1.3"] button') as HTMLElement);
    expect(suggest.levels.value).toEqual([1.15]);
    stop();
  });

  it('keeps the generator’s options under «Дополнительно»: a number, or empty for its default', async () => {
    const { q, suggest, stop } = await shown();
    const options = q<HTMLDetailsElement>('[data-testid="suggest-options"]') as HTMLDetailsElement;
    expect(options.open).toBe(false);
    expect(options.querySelector('summary')?.textContent).toBe('More options');
    const clearance = q<HTMLInputElement>('#suggest-clearance') as HTMLInputElement;
    fireEvent.change(clearance, { target: { value: '0.2' } });
    expect(suggest.clearance.value).toBe(0.2);
    fireEvent.change(clearance, { target: { value: '-1' } });
    expect(q('[role="alert"]')?.textContent).toBe('At least 0');
    expect(suggest.clearance.value).toBe(0.2);
    fireEvent.change(clearance, { target: { value: '' } });
    expect(suggest.clearance.value).toBeNull();
    fireEvent.change(q('#suggest-step-down') as HTMLElement, { target: { value: '0.05' } });
    expect(suggest.stepDown.value).toBe(0.05);
    stop();
  });

  it('shows the loading of Pyodide and a Cancel while it asks, then the draft with its findings: Accept replaces the floor, one entry', async () => {
    const spy = fakeBridge({ suggestFloor: () => draft });
    useSuggestBridge(spy);
    const { b, q, stop } = await shown();
    fireEvent.click(q('[data-action="suggest-floor-run"]') as HTMLElement);
    await waitFor(() => expect(q('[data-testid="suggest-progress"]')).not.toBeNull());
    expect(q('[data-testid="suggest-floor"]')?.getAttribute('data-phase')).toBe('running');
    expect(q('[data-action="suggest-floor-run"]')?.hasAttribute('disabled')).toBe(true);
    await act(() => spy.report({ stage: 'download', loaded: 5 * 2 ** 20, total: 13 * 2 ** 20 }));
    expect(q('[data-testid="suggest-progress"]')?.getAttribute('data-stage')).toBe('download');
    expect(q('[data-testid="suggest-progress"] [role="status"]')?.textContent).toBe('Loading Python (Pyodide), the first time only: 5 of 13 MB');
    expect(q<HTMLProgressElement>('[data-testid="suggest-progress"] progress')?.value).toBe(5 * 2 ** 20);
    await act(() => spy.report({ stage: 'start', loaded: 13 * 2 ** 20, total: 13 * 2 ** 20 }));
    expect(q('[data-testid="suggest-progress"] [role="status"]')?.textContent).toBe('Starting Python…');
    await act(() => spy.report({ stage: 'ready', loaded: 13 * 2 ** 20, total: 13 * 2 ** 20 }));
    expect(q('[data-testid="suggest-progress"] [role="status"]')?.textContent).toBe('Working…');
    await act(() => spy.release());
    await waitFor(() => expect(q('[data-testid="suggest-draft"]')).not.toBeNull());

    const shownDraft = q('[data-testid="suggest-draft"]') as HTMLElement;
    expect(shownDraft.getAttribute('data-zones')).toBe('4');
    expect(shownDraft.querySelector('h4')?.textContent).toBe('Draft: 4 zones');
    expect(q('[data-testid="suggest-draft-summary"]')?.textContent).toBe('Floor levels: 1.3. Where a player’s centre fits: 19.9 m².');
    expect(q('[data-testid="suggest-draft-notes"]')?.textContent).toBe('a note of the generator');
    expect(q('[data-testid="suggest-draft-findings"]')?.getAttribute('data-count')).toBe('0');
    expect(q('[data-testid="suggest-draft-findings"] h5')?.textContent).toBe('Floor check of the draft: nothing found');
    expect(q('[data-testid="floor-tool"]')?.getAttribute('data-zones')).toBe('0');
    expect(q('[data-testid="suggest-progress"]')).toBeNull();

    const entries = b.journal.state().done.length;
    fireEvent.click(q('[data-action="suggest-floor-accept"]') as HTMLElement);
    expect(b.journal.state().done).toHaveLength(entries + 1);
    expect(b.journal.state().done.at(-1)?.label).toBe('tools.suggest.cmd.floor');
    expect(zonesOf(b.pack.value?.json(COACH_TYPE))).toHaveLength(4);
    await waitFor(() => expect(q('[data-testid="floor-tool"]')?.getAttribute('data-zones')).toBe('4'));
    expect(q('[data-testid="suggest-draft"]')).toBeNull();
    b.journal.undo();
    expect(zonesOf(b.pack.value?.json(COACH_TYPE))).toEqual([]);
    stop();
  });

  it('lists what the floor check finds of the type with the draft, and Reject drops the draft', async () => {
    // a draft that leaves the salon door's doorway on no floor
    const spy = fakeBridge({ suggestFloor: () => ({ ...draft, interior: [{ min: [-3, 1.3, -0.55], max: [3, 3.8, 0.55] }] }) });
    useSuggestBridge(spy);
    const { b, q, stop } = await shown();
    fireEvent.click(q('[data-action="suggest-floor-run"]') as HTMLElement);
    await waitFor(() => expect(spy.calls).toHaveLength(1));
    await act(() => spy.release());
    await waitFor(() => expect(q('[data-testid="suggest-draft"]')).not.toBeNull());
    const found = q('[data-testid="suggest-draft-findings"]') as HTMLElement;
    expect(Number(found.getAttribute('data-count'))).toBeGreaterThan(0);
    expect(found.querySelector('li')?.getAttribute('title')).toBeTruthy();
    expect(found.querySelector('h5')?.textContent).toMatch(/^Floor check of the draft: \d+ findings?$/);
    const entries = b.journal.state().done.length;
    fireEvent.click(q('[data-action="suggest-floor-reject"]') as HTMLElement);
    expect(q('[data-testid="suggest-draft"]')).toBeNull();
    expect(b.journal.state().done).toHaveLength(entries);
    stop();
  });

  it('says a failure of the generator in words, the generator’s line behind a fold, no traceback; a Cancel leaves nothing', async () => {
    const spy = fakeBridge();
    spy.suggestFloor = () => Promise.reject(new BridgeError({ kind: 'python', type: 'ValueError', message: 'no up-facing surface near level 7', text: 'no up-facing surface near level 7', traceback: 'Traceback (most recent call last): …' }));
    useSuggestBridge(spy);
    const { q, suggest, stop } = await shown();
    suggest.addLevel(7);
    fireEvent.click(q('[data-action="suggest-floor-run"]') as HTMLElement);
    await waitFor(() => expect(q('[data-testid="suggest-error"]')).not.toBeNull());
    const error = q('[data-testid="suggest-error"]') as HTMLElement;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.querySelector('p')?.textContent).toBe('The model has no level surface facing up at 7. Click the model’s floor or clear the level: the generator then finds one itself.');
    expect(error.querySelector('details pre')?.textContent).toBe('no up-facing surface near level 7');
    expect(error.textContent).not.toContain('Traceback');
    expect(q('[data-action="suggest-floor-run"]')?.hasAttribute('disabled')).toBe(false);

    // the next try is a call that waits; Cancel ends it with nothing said
    const waiting = fakeBridge();
    useSuggestBridge(waiting);
    fireEvent.click(q('[data-action="suggest-floor-run"]') as HTMLElement);
    await waitFor(() => expect(q('[data-action="suggest-cancel"]')).not.toBeNull());
    expect(q('[data-testid="suggest-error"]')).toBeNull();
    fireEvent.click(q('[data-action="suggest-cancel"]') as HTMLElement);
    await waitFor(() => expect(q('[data-testid="suggest-floor"]')?.getAttribute('data-phase')).toBe('idle'));
    expect(q('[data-testid="suggest-error"]')).toBeNull();
    stop();
  });

  it('speaks Russian when the interface does', async () => {
    const { q, stop } = await shown();
    await act(() => setLang('ru'));
    expect(q('[data-action="suggest-floor-run"]')?.textContent).toBe('Предложить пол');
    expect(q('[data-testid="suggest-options"] summary')?.textContent).toBe('Дополнительно');
    expect(q('[data-action="suggest-pick-level"]')?.textContent).toBe('Кликнуть по полу модели');
    stop();
  });
});
