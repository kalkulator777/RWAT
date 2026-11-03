import { describe, expect, it, vi } from 'vitest';
import type { OverlayShape, PickHit } from '../core/contracts';
import { ViewState, type ViewSink } from './state';
import { boxModel } from './testModel.node';

function sink(): ViewSink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    transformChanged: (o) => calls.push(`transform ${o}`),
    visibilityChanged: (o) => calls.push(`visible ${o}`),
    litChanged: (o) => calls.push(`lit ${o}`),
    overlayChanged: (l) => calls.push(`overlay ${l}`),
  };
}

const rect: OverlayShape = { shape: 'rect', min: [0, 1, 0], max: [1, 1, 1], style: 'zone' };

describe('the view state (ViewApi)', () => {
  it('keeps what it is asked whether or not a drawing is attached, and tells the one attached', () => {
    const state = new ViewState();
    const matrix = new Float32Array(16).fill(1);
    state.setTransform('A', matrix);
    matrix[0] = 9;
    // a copy: the caller may reuse its array for the next frame
    expect(state.transforms.get('A')?.[0]).toBe(1);
    const attached = sink();
    const detach = state.attach(attached);
    state.setVisible('A', false);
    state.setLit('A', true);
    state.setTransform('A', null);
    state.overlay('floor', [rect]);
    expect(attached.calls).toEqual(['visible A', 'lit A', 'transform A', 'overlay floor']);
    expect([state.hidden.has('A'), state.lit.has('A'), state.transforms.has('A')]).toEqual([true, true, false]);
    detach();
    state.setVisible('A', true);
    expect(attached.calls).toHaveLength(4);
    expect(state.hidden.has('A')).toBe(false);
  });

  it('ignores a matrix of fewer than sixteen numbers', () => {
    const state = new ViewState();
    state.setTransform('A', new Float32Array(4));
    expect(state.transforms.has('A')).toBe(false);
  });

  it('forgets the previous model’s transforms, visibility and light on show, and keeps the overlays', () => {
    const state = new ViewState();
    state.setTransform('A', new Float32Array(16));
    state.setVisible('B', false);
    state.setLit('C', true);
    state.overlay('floor', [rect]);
    state.show(boxModel('m', []));
    expect([state.transforms.size, state.hidden.size, state.lit.size, state.overlays.size]).toEqual([0, 0, 0, 1]);
    expect(state.model.value?.id).toBe('m');
  });

  it('lists the overlay layers that have shapes, and an empty list clears a layer', () => {
    const state = new ViewState();
    state.overlay('seats', [rect]);
    state.overlay('floor', [rect]);
    expect(state.overlayLayers.value).toEqual(['floor', 'seats']);
    const before = state.overlayLayers.value;
    state.overlay('floor', [rect, rect]);
    expect(state.overlayLayers.value).toBe(before);
    state.overlay('floor', []);
    expect(state.overlayLayers.value).toEqual(['seats']);
    expect(state.overlays.has('floor')).toBe(false);
  });

  it('calls each pick listener until it is removed', () => {
    const state = new ViewState();
    const first = vi.fn<(hit: PickHit) => void>();
    const second = vi.fn<(hit: PickHit) => void>();
    const off = state.onPick(first);
    state.onPick(second);
    state.emitPick({ object: 'ROOF', point: [0, 4, 0] });
    off();
    state.emitPick({});
    expect(first.mock.calls).toEqual([[{ object: 'ROOF', point: [0, 4, 0] }]]);
    expect(second.mock.calls).toEqual([[{ object: 'ROOF', point: [0, 4, 0] }], [{}]]);
  });

  it('switches the display, the camera (again: lined up afresh), layers and roles', () => {
    const state = new ViewState();
    state.setDisplay('lit');
    expect(state.display.value).toBe('lit');
    state.setCamera('top');
    state.setCamera('top');
    expect([state.camera.value, state.cameraSerial.value]).toEqual(['top', 2]);
    state.setLayerShown('grid', false);
    state.setRoleShown('body', false);
    expect([...state.hiddenLayers.value, ...state.hiddenRoles.value]).toEqual(['grid', 'body']);
    state.setLayerShown('grid', true);
    expect(state.hiddenLayers.value.size).toBe(0);
    state.requestFraming('selected');
    expect(state.framing.value).toEqual({ serial: 1, what: 'selected' });
  });
});
