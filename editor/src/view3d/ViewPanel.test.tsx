import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { selection } from '../app/store';
import { setLang } from '../i18n';
import { objectLink } from './selection';
import { view } from './state';
import { exampleModel } from './testModel.node';
import { ViewPanel } from './ViewPanel';

function reset(): void {
  view.show(null);
  view.setDisplay('roles');
  view.camera.value = 'orbit';
  view.wireframe.value = false;
  view.hiddenLayers.value = new Set();
  view.hiddenRoles.value = new Set();
  view.hover.value = null;
  selection.value = [];
}

beforeEach(() => {
  reset();
  setLang('en');
});

afterEach(() => {
  cleanup();
  reset();
});

function button(group: string, value: string): HTMLElement {
  return screen.getByTestId('view3d').querySelector(`[data-toggle="${group}"] [data-value="${value}"]`) as HTMLElement;
}

describe('the view panel', () => {
  it('says so where the browser gives no WebGL 2, and that no model is open', () => {
    render(<ViewPanel />);
    const panel = screen.getByTestId('view3d');
    expect(panel.getAttribute('data-webgl')).toBe('none');
    expect(screen.getByTestId('view3d-no-webgl').textContent).toBe('The browser gave no WebGL 2: the 3D view is not available.');
    expect(screen.getByRole('application').getAttribute('aria-label')).toBe('3D view of the model');
    expect(document.getElementById('view3d-description')?.textContent).toContain('No model open.');
  });

  it('switches the camera, the display and the wireframe from its bar, each button saying whether it is on', () => {
    render(<ViewPanel />);
    expect(button('camera', 'orbit').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button('camera', 'top'));
    expect(view.camera.value).toBe('top');
    expect(button('camera', 'top').getAttribute('aria-pressed')).toBe('true');
    expect(button('camera', 'top').getAttribute('title')).toContain('(7)');
    fireEvent.click(button('display', 'textured'));
    expect(view.display.value).toBe('textured');
    expect(screen.getByTestId('view3d').getAttribute('data-display')).toBe('textured');
    const wireframe = screen.getByTestId('view3d').querySelector('[data-action="wireframe"]') as HTMLElement;
    fireEvent.click(wireframe);
    expect([view.wireframe.value, wireframe.getAttribute('aria-pressed')]).toEqual([true, 'true']);
    const serial = view.framing.value.serial;
    fireEvent.click(screen.getByTestId('view3d').querySelector('[data-action="frame-selected"]') as HTMLElement);
    expect(view.framing.value).toEqual({ serial: serial + 1, what: 'selected' });
  });

  it('switches guide layers, ghosts, overlay layers and roles from its layers menu', () => {
    view.overlay('floor', [{ shape: 'rect', min: [0, 1, 0], max: [1, 1, 1], style: 'zone' }]);
    render(<ViewPanel />);
    const menu = screen.getByTestId('view3d-layers');
    const box = (layer: string) => menu.querySelector(`[data-layer="${layer}"] input`) as HTMLInputElement;
    fireEvent.click(box('grid'));
    fireEvent.click(box('ghosts'));
    fireEvent.click(box('floor'));
    fireEvent.click(box('role:body'));
    expect([...view.hiddenLayers.value].sort()).toEqual(['floor', 'ghosts', 'grid']);
    expect([...view.hiddenRoles.value]).toEqual(['body']);
    expect(box('grid').checked).toBe(false);
    const swatch = within(menu.querySelector('[data-layer="role:door_leaf"]') as HTMLElement).getByText('door_leaf').previousElementSibling as HTMLElement;
    expect(swatch.getAttribute('style')).toContain('#e69f00');
    view.overlay('floor', []);
  });

  it('names what is under the pointer and where, and tells a screen reader the model and the selection', async () => {
    const coach = exampleModel('coach');
    view.show(coach);
    selection.value = [objectLink(coach.id, 'ROOF'), objectLink(coach.id, 'FLOOR')];
    view.hover.value = { object: 'DOOR_1_TL_0.95_X', point: [-8.75, 2.25, 1.5] };
    render(<ViewPanel />);
    const status = screen.getByTestId('view3d-status');
    expect(status.getAttribute('data-hover')).toBe('DOOR_1_TL_0.95_X');
    expect(status.textContent).toContain('DOOR_1_TL_0.95_X · door_leaf');
    expect(status.textContent).toContain('x -8.75  y 2.25  z 1.5');
    const description = document.getElementById('view3d-description')?.textContent ?? '';
    expect(description).toContain(`Model rwat_example:coach: ${coach.objects.length} objects.`);
    expect(description).toContain('Selected: ROOF, FLOOR.');
    expect(screen.getByTestId('view3d').getAttribute('data-selected')).toBe('ROOF,FLOOR');
    setLang('ru');
    await waitFor(() => expect(document.getElementById('view3d-description')?.textContent).toContain('Выделено: ROOF, FLOOR.'));
  });
});
