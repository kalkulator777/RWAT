/**
 * The "Preview" tab on the example pack's coach and shunter, driving a stand-in of the 3D
 * view (preview/testing.node.ts `recordingView`) through the editor's one preview: its
 * sliders, buttons and switches reach the view as the engine would move the model.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { panels } from '../../app/panels';
import { catalog, setLang } from '../../i18n';
import { CONTROL_KINDS } from '../../ports/objectRole';
import { framesAt, parse as parseAnim } from '../../ports/anim';
import { rowMajor } from '../../ports/controlPose';
import { preview } from '../../preview/store';
import { assetPath, exampleSubject, recordingView, type RecordingView } from '../../preview/testing.node';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import { PreviewPanel } from './PreviewPanel';

/** A frame written row by row as the view takes it, column by column: its transpose (ports/controlPose `rowMajor` transposes any 4×4). */
function transposed(rows: ArrayLike<number>): number[] {
  return rowMajor(Array.from(rows));
}

let view: RecordingView;

/** The example coach and shunter as the model worker reads them. */
const subjects = { coach: await exampleSubject('coach'), shunter: await exampleSubject('shunter') };

function open(name: 'coach' | 'shunter'): void {
  view = recordingView();
  const subject = subjects[name];
  view.show(subject.model);
  preview.view.value = view;
  preview.load(subject);
}

beforeEach(() => {
  setLang('en');
});

afterEach(() => {
  cleanup();
  preview.load(null);
  preview.view.value = null;
  vi.useRealTimers();
  localStorage.clear();
});

const salonTracks = parseAnim(readFileSync(join(EXAMPLE_PACK, ...assetPath('stock/coach/salon_door.anim').split('/')), 'utf8'));

function knobAt(progress: number): number[] {
  return transposed(framesAt(salonTracks, progress).get('SALON_DOOR_KNOB')!);
}

describe('the Preview tab', () => {
  it('is a bottom tab after the checks and the objects', () => {
    const def = panels.find((p) => p.id === 'preview');
    expect(def).toMatchObject({ slot: 'bottom', order: 30, title: 'preview.title' });
  });

  it('says there is nothing to preview without a model', () => {
    render(<PreviewPanel />);
    expect(screen.getByTestId('preview').textContent).toContain('No model open');
  });

  it('moves the salon door by its slider, frame by frame of its .anim', () => {
    open('coach');
    render(<PreviewPanel />);
    const row = screen.getByTestId('preview').querySelector('[data-door="salon_door"]') as HTMLElement;
    expect(row.textContent).toContain('animation salon_door');
    const slider = within(row).getByRole('slider', { name: 'How far door salon_door is open' });
    fireEvent.input(slider, { target: { value: '0.37' } });
    expect(Array.from(view.transforms.get('SALON_DOOR_KNOB')!)).toEqual(knobAt(0.37));
    expect(row.textContent).toContain('37 %');
  });

  it('opens a door over 2 s with its button, and the button then closes it', () => {
    vi.useFakeTimers();
    open('coach');
    render(<PreviewPanel />);
    const row = screen.getByTestId('preview').querySelector('[data-door="salon_door"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Open' }));
    expect(within(row).getByRole('button', { name: 'Close' })).toBeTruthy();
    vi.advanceTimersByTime(2050);
    expect(preview.state.value!.doors[6]).toBe(1);
    expect(Array.from(view.transforms.get('SALON_DOOR_KNOB')!)).toEqual(knobAt(1));
  });

  it('names what moves each door and the leaves of the coach’s side doors', () => {
    open('coach');
    render(<PreviewPanel />);
    const tab = screen.getByTestId('preview');
    expect(tab.querySelector('[data-door="door_fl"]')!.textContent).toContain('leaves DOOR_1');
    expect(tab.querySelector('[data-door="door_fl"]')!.textContent).toContain('group DoorsL');
    expect(tab.querySelector('[data-door="salon_arch"]')).toBeNull(); // fixed: nothing swings
  });

  it('turns the throttle by its slider to the last notch', () => {
    open('shunter');
    render(<PreviewPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Controls/ }));
    const slider = screen.getByRole('slider', { name: 'Position of control THROTTLE_1' });
    view.clearCalls();
    fireEvent.input(slider, { target: { value: '8' } });
    expect(view.calls.map((c) => c.object).sort()).toEqual(['THROTTLE_1_KNOB', 'THROTTLE_1_LEVER_LABEL_Controller', 'THROTTLE_1_ROT_-50']);
    const row = screen.getByTestId('preview').querySelector('[data-control="THROTTLE_1"]') as HTMLElement;
    expect(row.textContent).toContain('notch 8 of 8');
    expect(row.textContent).toContain('turned -50°');
    expect(row.textContent).toContain('Controller');
    expect(within(row).getByText('Throttle').tagName).toBe('TD');
  });

  it('names every control kind in both languages', () => {
    for (const kind of CONTROL_KINDS) {
      for (const language of ['ru', 'en'] as const) expect(catalog.get(language, `preview.kind.${kind.replaceAll('_', '-')}`), kind).toBeDefined();
    }
  });

  it('switches a light group, counts what shines and shows the view’s light display', () => {
    open('shunter');
    render(<PreviewPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Lights/ }));
    expect(screen.getByTestId('preview-lit').textContent).toBe('Shining: cabin lamps 0 of 1, headlights 0 of 2.');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Group FHL on' }));
    expect(view.lit.get('HEADLIGHT_1_LCG_FHL_0XFFF2CC')).toBe(true);
    expect(screen.getByTestId('preview-lit').textContent).toBe('Shining: cabin lamps 0 of 1, headlights 1 of 2.');
    fireEvent.click(screen.getByRole('button', { name: 'Show in the Light display' }));
    expect(view.display).toBe('lit');
  });

  it('shows the coach in its livery and back', async () => {
    open('coach');
    render(<PreviewPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Liveries/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'blue: replaces 2 textures' }));
    await waitFor(() => expect(view.shown).toHaveLength(2));
    const body = assetPath('stock/coach/coach_body.png');
    expect((view.shown.at(-1)!.textures[body] as unknown as { path: string }).path).toBe(assetPath('stock/coach/l_blue/coach_body.png'));
    fireEvent.click(screen.getByRole('radio', { name: 'Base' }));
    expect(view.shown.at(-1)).toBe(preview.subject.value!.model);
  });

  it('couples the front end: its free head goes, its coupled head comes', () => {
    open('coach');
    render(<PreviewPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Couplers/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Front coupled (3 heads)' }));
    expect(view.visible.get('COUPLED_FRONT_2_HIDE')).toBe(false);
    expect(view.visible.get('COUPLED_FRONT_3_HIDE_INVERT')).toBe(true);
    expect(view.visible.get('COUPLED_REAR_2_HIDE')).toBe(true);
  });

  it('resets everything with one button, and speaks Russian', () => {
    open('coach');
    setLang('ru');
    render(<PreviewPanel />);
    const slider = screen.getByRole('slider', { name: 'Насколько открыта дверь salon_door' });
    fireEvent.input(slider, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
    expect(preview.state.value!.doors.every((d) => d === 0)).toBe(true);
    expect(Array.from(view.transforms.get('SALON_DOOR_KNOB')!)).toEqual(knobAt(0));
  });
});
