import { act, fireEvent, render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { exampleModel } from '../../model/testing.node';
import { ToolHost } from '../registry';
import { ToolSection } from '../ToolBar';
import { bench } from '../testing.node';
import { chairsOf } from './chairs';
import seatsTool from './index';
import { SEATS_TIMING } from './session';

const SHUNTER = 'rwat_example:shunter';
const FILE = 'data/rwat_example/wagon_types/shunter.json';
const shunterModel = await exampleModel('shunter');
// drawn again at once after each edit, however slow an instrumented run is
SEATS_TIMING.slowMs = Number.POSITIVE_INFINITY;

async function shown(lang: 'en' | 'ru' = 'en') {
  setLang(lang);
  const b = await bench(SHUNTER, shunterModel);
  const host = new ToolHost([seatsTool]);
  const stop = host.connect(b.wiring);
  host.use('seats');
  const view = render(<ToolSection host={host} />);
  const q = <T extends Element = HTMLElement>(selector: string) => view.container.querySelector<T>(selector);
  const chairs = () => chairsOf(b.pack.value?.json(FILE));
  return { b, host, stop, view, q, chairs };
}

describe('the chairs tool’s section of the inspector', () => {
  it('lists the chairs with which way each drives and its cab, selects one and gives its numbers to type', async () => {
    const { b, stop, view, q, chairs } = await shown();
    const tool = q('[data-testid="seats-tool"]');
    expect(tool?.getAttribute('data-places')).toBe('2');
    expect([tool?.getAttribute('data-forward'), tool?.getAttribute('data-back')]).toEqual(['1', '1']);
    expect(view.container.querySelectorAll('[data-testid="seats-driver"] [data-seat]')).toHaveLength(2);
    expect(q('[data-seat="0"] .seats-summary')?.textContent).toBe('(1.65, 2.1, -0.8), 0°');
    expect(q('[data-seat="0"] [data-flag="forward"]')?.textContent).toBe('drives forward');
    expect(q('[data-seat="1"] [data-flag="back"]')?.textContent).toBe('drives backward');
    expect(q('[data-seat="1"] [data-flag="cab"]')?.textContent).toBe('cab 0');
    expect(q('[data-testid="seats-directions"]')?.textContent).toBe('Driving forward: 1; backward: 1.');
    expect(q('[data-testid="seats-numbers"]')).toBeNull();

    fireEvent.click(q('[data-seat="1"] .seats-name') as HTMLElement);
    expect(b.selection.value).toEqual([{ kind: 'seat', type: SHUNTER, index: 1 }]);
    expect(q('[data-testid="seats-tool"]')?.getAttribute('data-selected')).toBe('seat:1');
    expect(q('[data-testid="seats-facts"]')?.textContent).toBe(
      'One stands 0 from the chair to sit down (sitting reaches 2.5); the cushion is 0.5 over the floor there (0.2…1.5 wanted).',
    );
    const z = q<HTMLInputElement>('#seats-at-z') as HTMLInputElement;
    expect(z.value).toBe('0.8');
    fireEvent.input(z, { target: { value: '0.75' } });
    fireEvent.change(z, { target: { value: '0.75' } });
    expect(chairs()[1]?.at).toEqual([2.95, 2.1, 0.75]);
    const yaw = q<HTMLInputElement>('#seats-yaw') as HTMLInputElement;
    fireEvent.change(yaw, { target: { value: '170' } });
    expect(chairs()[1]?.yaw).toBe(170);
    fireEvent.change(yaw, { target: { value: '1,5' } });
    expect(q('[role="alert"]')?.textContent).toBe('A number, with a point');
    fireEvent.click(q('[data-action="seats-forward"]') as HTMLElement);
    expect(chairs()[1]?.yaw).toBe(0);
    expect(q('[data-seat="1"] [data-flag="forward"]')).not.toBeNull();
    fireEvent.click(q('[data-action="seats-back"]') as HTMLElement);
    expect(chairs()[1]?.yaw).toBe(180);
    stop();
  });

  it('moves chairs up and down, removes one by its button or the Delete key, and adds one', async () => {
    const { b, stop, view, q, chairs } = await shown();
    fireEvent.click(q('[data-seat="1"] [aria-label="Chair 1 up"]') as HTMLElement);
    expect(chairs()[0]?.yaw).toBe(180);
    expect(b.selection.value).toEqual([{ kind: 'seat', type: SHUNTER, index: 0 }]);
    fireEvent.keyDown(q('[data-seat="0"] .seats-name') as HTMLElement, { key: 'Delete' });
    expect(chairs()).toHaveLength(1);
    fireEvent.click(q('[data-seat="0"] [aria-label="Remove chair 0"]') as HTMLElement);
    expect(chairs()).toEqual([]);
    expect(q('.seats-kind .seats-note')?.textContent).toBe('No chairs. Click a cushion of the model or add one with the button.');
    fireEvent.click(q('[data-action="seats-add"]') as HTMLElement);
    expect(view.container.querySelectorAll('[data-testid="seats-driver"] [data-seat]')).toHaveLength(1);
    expect(chairs()[0]).toEqual({ at: [2.3, 2.1, 0], yaw: 0 });
    stop();
  });

  it('says what the floor check finds of the chairs, in the interface’s words; a click selects the chair', async () => {
    const { b, stop, q } = await shown('ru');
    await act(() => {
      b.journal.dispatch({ label: 'x', ops: [{ op: 'set', file: FILE, at: '/cab/seats/0/at', value: [1.65, 3.3, -0.8] }] });
    });
    const findings = q('[data-testid="seats-findings"]');
    expect(findings?.getAttribute('data-codes')).toBe('SEAT_NOT_SITTABLE');
    expect(q('[data-seat="0"] [data-flag="not-sittable"]')?.textContent).toBe('не сесть');
    const finding = q('[data-code="SEAT_NOT_SITTABLE"] button') as HTMLElement;
    expect(finding.textContent).toBe(
      'кресло cab.seats[0] (1.65, 3.30, -0.80): ближайшее место, где встать, — в 0.00 (сесть можно с 2.5), пол там на 1.70 ниже подушки (нужно 0.2..1.5; место кресла — верх подушки)',
    );
    fireEvent.click(finding);
    expect(b.selection.value).toEqual([
      { kind: 'field', file: FILE, at: '/cab/seats/0' },
      { kind: 'seat', type: SHUNTER, index: 0 },
    ]);
    stop();
  });

  it('says when the chair is in the old form, both forms are there, or the type has no cab', async () => {
    const { b, stop, q } = await shown();
    const set = (cab: unknown) =>
      act(() => {
        b.journal.dispatch({ label: 'x', ops: [{ op: 'set', file: FILE, at: '/cab', value: cab }] });
      });
    await set({ seat: [1.65, 2.1, -0.8] });
    expect(q('[data-form]')?.getAttribute('data-form')).toBe('old');
    expect(q('[data-seat="0"] .seats-summary')?.textContent).toBe('(1.65, 2.1, -0.8), 0°');
    await set({ seat: [1.65, 2.1, -0.8], seats: [] });
    expect(q('[data-form]')?.getAttribute('data-form')).toBe('both');
    expect(q('.seats-warning')?.textContent).toMatch(/does not load/);
    await act(() => {
      b.journal.dispatch({ label: 'x', ops: [{ op: 'remove', file: FILE, at: '/cab' }] });
    });
    expect(q('[data-form]')?.getAttribute('data-form')).toBe('no-cab');
    stop();
  });
});
