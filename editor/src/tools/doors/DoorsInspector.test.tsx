import { act, fireEvent, render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { exampleModel } from '../../model/testing.node';
import { ToolHost } from '../registry';
import { ToolSection } from '../ToolBar';
import { bench } from '../testing.node';
import { doorLink, doorsOf } from './doors';
import doorsTool from './index';

const COACH = 'rwat_example:coach';
const FILE = 'data/rwat_example/wagon_types/coach.json';
const coachModel = await exampleModel('coach');

async function shown(model: typeof coachModel | null = coachModel) {
  setLang('en');
  const b = await bench(COACH, model);
  const host = new ToolHost([doorsTool]);
  const stop = host.connect(b.wiring);
  host.use('doors');
  const view = render(<ToolSection host={host} />);
  const q = <T extends Element = HTMLElement>(selector: string) => view.container.querySelector<T>(selector);
  const doors = () => doorsOf(b.pack.value?.json(FILE));
  return { b, host, stop, view, q, doors };
}

function type(input: HTMLInputElement | null, value: string): void {
  if (input === null) throw new Error('no input');
  fireEvent.input(input, { target: { value } });
  fireEvent.change(input, { target: { value } });
}

describe('the doors tool’s section of the inspector', () => {
  it('lists the doors in order with what they are, selects one, and shows what the engine makes of it', async () => {
    const { b, stop, view, q } = await shown();
    expect(q('[data-testid="doors-tool"]')?.getAttribute('data-doors')).toBe('8');
    expect(view.container.querySelectorAll('[data-testid="doors-list"] [data-door]')).toHaveLength(8);
    expect(q('[data-door="0"] .tool-item-name')?.textContent).toBe('Door 0door_flhull, group DoorsL');
    expect(q('[data-door="7"] .tool-item-name')?.textContent).toBe('Door 7salon_archinner, opening');
    expect(q('[data-testid="doors-door"]')).toBeNull();

    fireEvent.click(q('[data-door="0"] .tool-item-name') as HTMLElement);
    expect(b.selection.value).toEqual([doorLink(COACH, 0)]);
    expect(q<HTMLInputElement>('#doors-id')?.value).toBe('door_fl');
    expect(q<HTMLInputElement>('#doors-group')?.value).toBe('DoorsL');
    expect(q<HTMLInputElement>('#doors-max-z')?.value).toBe('1.51');
    expect(q('[data-testid="doors-facts"]')?.getAttribute('data-out')).toBe('left');
    expect(q('[data-testid="doors-facts"]')?.textContent).toContain('Side wall, out +Z (the left side); 0.06 thick, 1 wide');
    expect(q('[data-testid="doors-movers"]')?.textContent).toBe('Moves: leaf DOOR_1 (2 objects)');
    expect(q('[data-testid="doors-findings"]')?.getAttribute('data-count')).toBe('0');

    await act(() => {
      b.selection.value = [doorLink(COACH, 6)];
    });
    expect(q('[data-testid="doors-facts"]')?.getAttribute('data-bridge')).toBe('both');
    expect(q('[data-testid="doors-movers"]')?.textContent).toBe('Moves: animation salon_door (2 objects)');
    await act(() => {
      b.selection.value = [doorLink(COACH, 7)];
    });
    expect(q('[data-testid="doors-movers"]')?.textContent).toBe('A fixed opening moves no leaf: it stands shut.');
    stop();
  });

  it('types the id, flags, group and numbers in, refusing an empty id and what is no number', async () => {
    const { b, stop, q, doors } = await shown();
    await act(() => {
      b.selection.value = [doorLink(COACH, 1)];
    });
    type(q<HTMLInputElement>('#doors-id'), '');
    expect(q('[role="alert"]')?.textContent).toBe('A name is needed');
    expect(doors()[1]?.id).toBe('door_fr');
    type(q<HTMLInputElement>('#doors-id'), 'DOOR_FL');
    expect(doors()[1]?.id).toBe('DOOR_FL');
    expect(q('[data-testid="doors-door"]')?.textContent).toContain('Another door has this id (case aside)');
    fireEvent.click(q('[data-flag="inner"] input') as HTMLElement);
    expect(doors()[1]?.inner).toBe(true);
    type(q<HTMLInputElement>('#doors-group'), '');
    expect(doors()[1]?.group).toBeNull();
    type(q<HTMLInputElement>('#doors-min-y'), '1.3');
    expect(doors()[1]?.box?.minY).toBe(1.3);
    type(q<HTMLInputElement>('#doors-min-y'), '1,2');
    expect(q('[role="alert"]')?.textContent).toBe('A number, with a point');
    expect(doors()[1]?.box?.minY).toBe(1.3);
    stop();
  });

  it('makes a door of the objects selected, and shows the floor check’s findings of it in the interface’s words', async () => {
    const { b, stop, q, doors } = await shown();
    const button = q<HTMLButtonElement>('[data-action="doors-from-selection"]');
    expect(button?.disabled).toBe(true);
    expect(q('[data-testid="doors-objects"]')?.textContent).toBe('No objects of the model selected');
    await act(() => {
      b.selection.value = [{ kind: 'object', model: COACH, name: 'LIGHT_SWITCH_PLATE' }];
    });
    expect(q('[data-testid="doors-objects"]')?.textContent).toBe('1 object selected');
    expect(q<HTMLButtonElement>('[data-action="doors-from-selection"]')?.disabled).toBe(false);
    await act(() => {
      fireEvent.click(q('[data-action="doors-from-selection"]') as HTMLElement);
    });
    expect(doors()).toHaveLength(9);
    expect(q('[data-door="8"]')?.getAttribute('data-selected')).toBe('true');
    expect(q('[data-door="8"] .tool-item-flag')?.textContent).toBe('2 findings');
    const findings = q('[data-testid="doors-findings"]');
    expect(findings?.getAttribute('data-codes')).toBe('floor.door-too-narrow floor.door-not-at-floor-end');
    expect(findings?.textContent).toContain('door 8 “door_8” is too narrow to walk through');
    expect(q('[data-testid="doors-movers"]')?.textContent).toBe('Moves nothing of the model.');
    stop();
  });

  it('moves doors up and down, removes one by its button or the Delete key, and adds one', async () => {
    const { stop, view, q, doors } = await shown(null);
    expect(q('[data-testid="doors-tool"]')?.textContent).toContain('The model is still being read');
    fireEvent.click(q('[data-door="7"] [aria-label="Door 7 up"]') as HTMLElement);
    expect(doors()[6]?.id).toBe('salon_arch');
    fireEvent.keyDown(q('[data-door="6"] .tool-item-name') as HTMLElement, { key: 'Delete' });
    expect(doors()).toHaveLength(7);
    fireEvent.click(q('[data-door="0"] [aria-label="Remove door 0"]') as HTMLElement);
    expect(doors()).toHaveLength(6);
    fireEvent.click(q('[data-action="doors-add"]') as HTMLElement);
    expect(view.container.querySelectorAll('[data-testid="doors-list"] [data-door]')).toHaveLength(7);
    expect(q('[data-door="0"] [aria-label="Door 0 up"]')?.hasAttribute('disabled')).toBe(true);
    fireEvent.click(q('[data-snap="grid"] input') as HTMLElement);
    expect(q<HTMLInputElement>('[data-snap="grid"] input')?.checked).toBe(false);
    stop();
  });

  it('says a leaf no door moves, and a type that does not load', async () => {
    const { b, stop, q } = await shown();
    await act(() =>
      b.journal.dispatch({
        label: 'x',
        ops: [
          { op: 'set', file: FILE, at: '/doors/2/min', value: [6.25, 1.15, 1.45] },
          { op: 'set', file: FILE, at: '/doors/2/max', value: [7.25, 3.3, 1.51] },
        ],
      }),
    );
    expect(q('[data-testid="doors-loose"]')?.textContent).toBe('No door moves: leaf DOOR_3 (2 objects)');
    await act(() => b.journal.dispatch({ label: 'x', ops: [{ op: 'set', file: FILE, at: '/length', value: -1 }] }));
    expect(q('[data-testid="doors-tool"]')?.textContent).toContain('The wagon type does not load now');
    stop();
  });
});
