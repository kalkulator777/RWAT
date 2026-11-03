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
    textureChanged: (p) => calls.push(`texture ${p}`),
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
    state.setTexture('t.png', null);
    state.overlay('floor', [rect]);
    expect(attached.calls).toEqual(['visible A', 'lit A', 'transform A', 'texture t.png', 'overlay floor']);
    expect([state.hidden.has('A'), state.lit.has('A'), state.transforms.has('A')]).toEqual([true, true, false]);
    detach();
    state.setVisible('A', true);
    expect(attached.calls).toHaveLength(5);
    expect(state.hidden.has('A')).toBe(false);
  });

  it('ignores a matrix of fewer than sixteen numbers', () => {
    const state = new ViewState();
    state.setTransform('A', new Float32Array(4));
    expect(state.transforms.has('A')).toBe(false);
  });

  it('forgets the previous model’s transforms, visibility, light and pictures on show, and keeps the frame and the overlays', () => {
    const state = new ViewState();
    const frame = { length: 10, bogies: [3, -3], couplerReach: [5, 5] as const, hull: { minX: -1, minY: 0, minZ: -5, maxX: 1, maxY: 4, maxZ: 5 } };
    state.setFrame(frame);
    state.setTransform('A', new Float32Array(16));
    state.setVisible('B', false);
    state.setLit('C', true);
    state.setTexture('t.png', null);
    state.overlay('floor', [rect]);
    state.show(boxModel('m', []));
    expect([state.transforms.size, state.hidden.size, state.lit.size, state.textures.size, state.overlays.size]).toEqual([0, 0, 0, 0, 1]);
    expect(state.model.value?.id).toBe('m');
    expect(state.frame.value).toBe(frame);
  });

  it('draws a texture with the picture it was told, else the model’s own', () => {
    const state = new ViewState();
    const own = { name: 'own' } as unknown as ImageBitmap;
    const blue = { name: 'blue' } as unknown as ImageBitmap;
    state.show({ ...boxModel('m', []), textures: { 'a.png': own, 'b.png': null } });
    expect([state.textureOf('a.png'), state.textureOf('b.png'), state.textureOf('c.png')]).toEqual([own, null, null]);
    state.setTexture('a.png', blue);
    state.setTexture('b.png', blue);
    expect([state.textureOf('a.png'), state.textureOf('b.png')]).toEqual([blue, blue]);
    state.setTexture('a.png', null);
    expect(state.textureOf('a.png')).toBeNull();
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
    const roof: PickHit = { object: 'ROOF', point: [0, 4, 0], shift: false, ctrl: false, alt: false, double: false };
    const nothing: PickHit = { shift: true, ctrl: false, alt: false, double: true };
    state.emitPick(roof);
    off();
    state.emitPick(nothing);
    expect(first.mock.calls).toEqual([[roof]]);
    expect(second.mock.calls).toEqual([[roof], [nothing]]);
  });

  it('switches the display, the wireframe, the camera (again: lined up afresh), layers and roles', () => {
    const state = new ViewState();
    state.setDisplay('lit');
    expect(state.display.value).toBe('lit');
    state.setWireframe(true);
    expect(state.wireframe.value).toBe(true);
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
