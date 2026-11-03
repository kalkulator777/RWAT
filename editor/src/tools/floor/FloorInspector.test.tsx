import { act, fireEvent, render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { ToolHost } from '../registry';
import { ToolSection } from '../ToolBar';
import { bench } from '../testing.node';
import floorTool, { type FloorSession } from './index';
import { FLOOR_TIMING } from './session';
import { zoneLink, zonesOf } from './zones';

const COACH = 'rwat_example:coach';
const FILE = 'data/rwat_example/wagon_types/coach.json';
// drawn again at once after each edit, however slow an instrumented run is
FLOOR_TIMING.slowMs = Number.POSITIVE_INFINITY;

async function shown() {
  setLang('en');
  const b = await bench(COACH, null);
  const host = new ToolHost([floorTool]);
  const stop = host.connect(b.wiring);
  host.use('floor');
  const view = render(<ToolSection host={host} />);
  const q = <T extends Element = HTMLElement>(selector: string) => view.container.querySelector<T>(selector);
  return { b, host, stop, view, q };
}

describe('the floor tool’s section of the inspector', () => {
  it('lists the zones in order, selects one, and gives its numbers to type', async () => {
    const { b, stop, view, q } = await shown();
    expect(q('[data-testid="floor-tool"]')?.getAttribute('data-zones')).toBe('4');
    expect(view.container.querySelectorAll('[data-testid="floor-zones"] [data-zone]')).toHaveLength(4);
    expect(q('[data-zone="1"] .floor-zone-summary')?.textContent).toBe('x -7.8…7.8, z -0.55…0.55, floor 1.3');
    expect(q('[data-testid="floor-numbers"]')).toBeNull();

    fireEvent.click(q('[data-zone="1"] .floor-zone-name') as HTMLElement);
    expect(b.selection.value).toEqual([zoneLink(COACH, 1)]);
    const maxX = q<HTMLInputElement>('#floor-max-x');
    expect(maxX?.value).toBe('7.8');
    fireEvent.input(maxX as HTMLInputElement, { target: { value: '7.75' } });
    fireEvent.change(maxX as HTMLInputElement, { target: { value: '7.75' } });
    expect(zonesOf(b.pack.value?.json(FILE))[1]?.maxX).toBe(7.75);
    // what is no number is said and changes nothing
    fireEvent.change(maxX as HTMLInputElement, { target: { value: '7,7' } });
    expect(q('[role="alert"]')?.textContent).toBe('A number, with a point');
    expect(zonesOf(b.pack.value?.json(FILE))[1]?.maxX).toBe(7.75);
    stop();
  });

  it('moves zones up and down, removes one by its button or the Delete key, and adds one', async () => {
    const { b, stop, view, q } = await shown();
    fireEvent.click(q('[data-zone="3"] [aria-label="Zone 3 up"]') as HTMLElement);
    expect(zonesOf(b.pack.value?.json(FILE))[2]?.minX).toBe(7.9);
    expect(b.selection.value).toEqual([zoneLink(COACH, 2)]);
    fireEvent.keyDown(q('[data-zone="2"] .floor-zone-name') as HTMLElement, { key: 'Delete' });
    expect(zonesOf(b.pack.value?.json(FILE))).toHaveLength(3);
    fireEvent.click(q('[data-zone="0"] [aria-label="Remove zone 0"]') as HTMLElement);
    expect(zonesOf(b.pack.value?.json(FILE))).toHaveLength(2);
    fireEvent.click(q('[data-action="floor-add"]') as HTMLElement);
    expect(view.container.querySelectorAll('[data-testid="floor-zones"] [data-zone]')).toHaveLength(3);
    expect(q('[data-zone="0"] [aria-label="Zone 0 up"]')?.hasAttribute('disabled')).toBe(true);
    stop();
  });

  it('shows what the floor check finds in the interface’s words, the engine’s line as the tooltip, each finding selecting what it is about', async () => {
    const { b, stop, q } = await shown();
    expect(q('[data-testid="floor-findings"]')?.getAttribute('data-count')).toBe('0');
    await act(() => b.journal.dispatch({ label: 'x', ops: [{ op: 'insert', file: FILE, at: '/interior/-', value: { min: [3, 1.3, 0.55], max: [3.4, 3.8, 0.95] } }] }));
    const findings = q('[data-testid="floor-findings"]');
    expect(findings?.getAttribute('data-codes')).toBe('ZONE_TOO_NARROW');
    expect(q('[data-zone="4"] .floor-zone-flag')?.textContent).toBe('no room for a player');
    const finding = q('[data-code="ZONE_TOO_NARROW"] button') as HTMLElement;
    expect(finding.textContent).toBe('zone 4 holds no place a player fits (0.40 × 0.40): widen it to 0.6 or join it to a wider zone');
    expect(finding.getAttribute('title')).toMatch(/^zone 4 .*0\.40/);
    expect(finding.getAttribute('title')).not.toBe(finding.textContent);
    await act(() => setLang('ru'));
    expect(finding.textContent).toBe('в зоне 4 игроку негде встать (0.40 × 0.40): расширьте её до 0.6 или соедините с зоной пошире');
    fireEvent.click(finding);
    expect(b.selection.value).toEqual([{ kind: 'field', file: FILE, at: '/interior/4' }, zoneLink(COACH, 4)]);
    setLang('en');
    stop();
  });

  it('switches the doors of the drawing, what edges snap to, and waits for a height click', async () => {
    const { b, host, stop, q } = await shown();
    fireEvent.click(q('[data-toggle="floor-doors"] [data-value="open"]') as HTMLElement);
    expect(b.view.overlays.get('floor.bridges')).toHaveLength(2);
    expect(q('[data-toggle="floor-doors"] [data-value="open"]')?.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(q('[data-snap="grid"] input') as HTMLElement);
    const tool = (host.current.value?.session as FloorSession).tool;
    expect(tool.snapping.value.grid).toBe(false);
    await act(() => {
      b.selection.value = [zoneLink(COACH, 0)];
    });
    fireEvent.click(q('[data-action="floor-pick-height"]') as HTMLElement);
    expect(q('[data-action="floor-pick-height"]')?.getAttribute('aria-pressed')).toBe('true');
    stop();
  });
});
