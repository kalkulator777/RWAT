import { signal } from '@preact/signals';
import { Matrix4, OrthographicCamera, PerspectiveCamera } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Link, OverlayShape, PickHit } from '../core/contracts';
import { objectLink } from './selection';
import { ViewState } from './state';
import { exampleModel } from './testModel.node';
import { ViewScene } from './viewScene';

const coach = exampleModel('coach');
const COACH = coach.id;

function setUp(): { state: ViewState; selection: ReturnType<typeof signal<readonly Link[]>>; scene: ViewScene; stop: () => void; frames: { count: number } } {
  const state = new ViewState();
  const selection = signal<readonly Link[]>([]);
  const frames = { count: 0 };
  const scene = new ViewScene(state, selection, () => frames.count++);
  const stop = scene.start();
  scene.setAspect(16 / 9);
  return { state, selection, scene, stop, frames };
}

describe('the view scene', () => {
  it('shows the model the state is given, framed, and asks for a picture', () => {
    const { state, scene, frames } = setUp();
    frames.count = 0;
    state.show(coach);
    expect(scene.model?.model.id).toBe(COACH);
    expect(frames.count).toBeGreaterThan(0);
    expect(scene.camera).toBeInstanceOf(PerspectiveCamera);
    const centre = scene.project([0, 2, 0]);
    expect(Math.abs(centre.x)).toBeLessThan(0.2);
    state.show(null);
    expect(scene.model).toBeNull();
  });

  it('selects what a click in the top view hits, as the objects tab writes it, and tells the pick listeners', () => {
    const { state, selection, scene } = setUp();
    state.show(coach);
    state.setCamera('top');
    expect(scene.camera).toBeInstanceOf(OrthographicCamera);
    const picks = vi.fn<(hit: PickHit) => void>();
    state.onPick(picks);
    const hit = scene.clickAt(0, 0, false);
    expect(hit.object?.object).toBe('ROOF');
    expect(selection.value).toEqual([{ kind: 'object', model: 'rwat_example:coach', name: 'ROOF' }]);
    expect(picks).toHaveBeenCalledWith({ object: 'ROOF', point: hit.object?.point });
    expect(scene.model?.node('ROOF')?.outline.visible).toBe(true);

    // a click past the car's end hits nothing: the listeners hear it, the selection stays
    scene.clickAt(0.99, 0, false);
    expect(picks).toHaveBeenLastCalledWith({});
    expect(selection.value).toEqual([objectLink(COACH, 'ROOF')]);

    // Shift takes it back out
    scene.clickAt(0, 0, true);
    expect(selection.value).toEqual([]);
    expect(scene.model?.node('ROOF')?.outline.visible).toBe(false);
  });

  it('boxes what another panel selects, and frames it on request', () => {
    const { state, selection, scene } = setUp();
    state.show(coach);
    selection.value = [objectLink(COACH, 'DOOR_1_TL_0.95_X'), objectLink('rwat_example:shunter', 'ROOF')];
    expect(scene.model?.node('DOOR_1_TL_0.95_X')?.outline.visible).toBe(true);
    expect(scene.model?.node('ROOF')?.outline.visible).toBe(false);
    state.requestFraming('selected');
    const door = scene.model?.bounds(['DOOR_1_TL_0.95_X']).getCenter(scene.target.clone());
    expect(scene.target.distanceTo(door as typeof scene.target)).toBeLessThan(1e-6);
    state.requestFraming('all');
    expect(Math.abs(scene.target.x)).toBeLessThan(1);
  });

  it('tints what the pointer is over and tells the status line, until it leaves', () => {
    const { state, scene } = setUp();
    state.show(coach);
    state.setCamera('top');
    scene.hoverAt({ x: 0, y: 0 });
    expect(state.hover.value?.object).toBe('ROOF');
    expect(state.hover.value?.point?.[1]).toBeGreaterThan(3);
    expect(scene.model?.node('ROOF')?.meshes[0]?.material.emissive.getHex()).not.toBe(0);
    scene.hoverAt(null);
    expect(state.hover.value).toBeNull();
    expect(scene.model?.node('ROOF')?.meshes[0]?.material.emissive.getHex()).toBe(0);
  });

  it('moves, hides and lights objects as the state is told, before or after the model is shown', () => {
    const { state, scene } = setUp();
    state.show(coach);
    state.setTransform('DOOR_1_TL_0.95_X', new Float32Array(new Matrix4().makeTranslation(0.95, 0, 0).elements));
    expect(scene.model?.node('DOOR_1_TL_0.95_X')?.group.matrix.elements[12]).toBeCloseTo(0.95, 6);
    state.setVisible('ROOF', false);
    state.setCamera('top');
    expect(scene.clickAt(0, 0, false).object?.object).not.toBe('ROOF');
    state.setDisplay('lit');
    state.setLit('LAMPS_FULLBRIGHT_LCG_IL', true);
    expect(scene.model?.node('LAMPS_FULLBRIGHT_LCG_IL')?.meshes[0]?.material.emissive.getHex()).not.toBe(0);
    state.setRoleShown('interior', false);
    expect(scene.model?.isDrawn('INTERIOR_SEATS_LCG_IL')).toBe(false);
    state.setLayerShown('ghosts', false);
    expect(scene.model?.isDrawn('GUIDE_FLOOR_0')).toBe(false);
  });

  it('draws overlay layers, picks a shape with a link where no object is hit, and marks it when selected', () => {
    const { state, selection, scene } = setUp();
    const zone: OverlayShape = { shape: 'rect', min: [-2, 1.2, -1], max: [2, 1.2, 1], style: 'zone', link: { kind: 'zone', type: COACH, index: 1 } };
    state.overlay('floor', [zone]);
    state.setCamera('top');
    const layer = scene.scene.getObjectByName('overlay:floor');
    expect(layer?.children).toHaveLength(1);
    expect(scene.clickAt(0, 0, false).link).toEqual(zone.link);
    expect(selection.value).toEqual([zone.link]);
    // the layer is drawn again with the shape in the selection's colour
    expect(scene.scene.getObjectByName('overlay:floor')).not.toBe(layer);
    state.setLayerShown('floor', false);
    expect(scene.scene.getObjectByName('overlay:floor')?.visible).toBe(false);
    expect(scene.clickAt(0, 0, false).link).toBeUndefined();
    state.overlay('floor', []);
    expect(scene.scene.getObjectByName('overlay:floor')).toBeUndefined();
  });

  it('gives the guides the type frame and lets go of the state when stopped', () => {
    const { state, scene, stop } = setUp();
    state.frame.value = { length: 20, bogies: [7, -7], couplerReach: [10.25, 10.25], hull: { minX: -1.7, minY: 0.4, minZ: -10, maxX: 1.7, maxY: 4.7, maxZ: 10 } };
    expect(scene.guides.layers.frame.children.length).toBeGreaterThan(0);
    stop();
    state.show(coach);
    expect(scene.model).toBeNull();
    scene.dispose();
  });
});
