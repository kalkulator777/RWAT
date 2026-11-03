import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { defineTool, ToolHost } from './registry';
import { ToolSection, ToolSwitcher } from './ToolBar';
import { bench } from './testing.node';

const probe = defineTool({
  id: 'probe',
  order: 10,
  title: 'tools.select',
  hint: 'tools.select.hint',
  fields: ['/interior/*'],
  activate: () => ({ Inspector: () => <p data-testid="probe-numbers">numbers</p>, dispose: () => undefined }),
});

describe('the tools on the screen', () => {
  it('switch in the view bar: the selection or a tool, greyed where it does not apply', async () => {
    setLang('en');
    const b = await bench(null);
    const host = new ToolHost([probe]);
    const stop = host.connect(b.wiring);
    const { container, rerender } = render(
      <>
        <ToolSwitcher host={host} />
        <ToolSection host={host} />
      </>,
    );
    const button = (id: string) => container.querySelector<HTMLButtonElement>(`[data-tool="${id}"]`) as HTMLButtonElement;
    expect(button('select').getAttribute('aria-pressed')).toBe('true');
    expect(button('probe').disabled).toBe(true);
    expect(button('probe').title).toContain('Needs an open wagon');

    b.openWagon.value = 'rwat_example:coach';
    rerender(
      <>
        <ToolSwitcher host={host} />
        <ToolSection host={host} />
      </>,
    );
    expect(button('probe').disabled).toBe(false);
    fireEvent.click(button('probe'));
    expect(host.active.value).toBe('probe');
    expect(button('probe').getAttribute('aria-pressed')).toBe('true');
    // the section of the tool that is on, headed by its name
    expect(container.querySelector('[data-testid="tool-section"]')?.getAttribute('data-tool')).toBe('probe');
    expect(container.querySelector('[data-testid="probe-numbers"]')).not.toBeNull();

    // pressed again it goes off, and so does its section
    fireEvent.click(button('probe'));
    expect(host.active.value).toBeNull();
    expect(container.querySelector('[data-testid="tool-section"]')).toBeNull();
    fireEvent.click(button('probe'));
    fireEvent.click(button('select'));
    expect(host.active.value).toBeNull();
    stop();
  });
});
