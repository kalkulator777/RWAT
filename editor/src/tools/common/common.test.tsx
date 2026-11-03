import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { setLang } from '../../i18n';
import { OVERLAY_STYLES } from '../../view3d/overlays';
import { NumberInput, TextInput } from './inputs';
import { CAB_STYLES, cabStyle } from './styles';

describe('the tools’ number field', () => {
  it('applies a number that reads and differs, says what does not read, and drops a draft on Escape', () => {
    setLang('en');
    const commit = vi.fn<(value: number) => void>();
    const view = render(<NumberInput id="n" label="x" value={7.8} disabled={false} onCommit={commit} />);
    const input = view.container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('7.8');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    fireEvent.change(input, { target: { value: '7.80' } });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '7.75' } });
    expect(commit).toHaveBeenLastCalledWith(7.75);
    fireEvent.input(input, { target: { value: '7,7' } });
    fireEvent.change(input, { target: { value: '7,7' } });
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('A number, with a point');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe('the tools’ text field', () => {
  it('applies a text its parse takes and that differs, and says the parse’s error', () => {
    const commit = vi.fn<(text: string) => void>();
    const view = render(
      <TextInput id="t" label="id" text="door_0" disabled={false} parse={(text) => (text === '' ? { error: 'empty' } : { ok: true })} onCommit={commit} />,
    );
    const input = view.container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'door_0' } });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '' } });
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('empty');
    fireEvent.change(input, { target: { value: 'salon_door' } });
    expect(commit).toHaveBeenCalledWith('salon_door');
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('the cabs’ shades', () => {
  it('are overlay styles of the view, taken over again past the last', () => {
    for (const style of CAB_STYLES) expect(OVERLAY_STYLES).toHaveProperty([style]);
    expect([0, 1, 2, 3, 4].map(cabStyle)).toEqual(['cab', 'cab-2', 'cab-3', 'cab-4', 'cab']);
  });
});
