import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vec3, ViewPointer } from '../../core/contracts';
import { exampleModel } from '../../model/testing.node';
import { ToolHost } from '../registry';
import { bench, drawing, type Bench } from '../testing.node';
import floorTool, { type FloorSession } from './index';
import { cursorOf, grabAt } from './gesture';
import { FLOOR_TIMING, heightFor, startFloor, type FloorTool } from './session';
import { GRID, vertexLines } from '../common/snap';
import { zoneLink, zonesOf, type ZoneBox } from './zones';

const COACH = 'rwat_example:coach';
const COACH_TYPE = 'data/rwat_example/wagon_types/coach.json';
const coachModel = await exampleModel('coach');
// drawn again at once after each edit, however slow an instrumented run is
FLOOR_TIMING.slowMs = Number.POSITIVE_INFINITY;

/** A pointer of the view from the top over (x, z) of the plan, one pixel a hundredth of a block. */
function top(x: number, z: number, keys: Partial<Pick<ViewPointer, 'shift' | 'ctrl' | 'alt'>> = {}): ViewPointer {
  return { origin: [x, 50, z], direction: [0, -1, 0], pixel: 0.01, view: 'top', shift: false, ctrl: false, alt: false, ...keys };
}

/** Turns the floor tool on through the host, as the shell does. */
async function on(model: typeof coachModel | null = coachModel): Promise<{ b: Bench; host: ToolHost; stop: () => void }> {
  const b = await bench(COACH, model);
  const host = new ToolHost([floorTool]);
  const stop = host.connect(b.wiring);
  host.use('floor');
  return { b, host, stop };
}

function zones(b: Bench): (ZoneBox | null)[] {
  return zonesOf(b.pack.value?.json(COACH_TYPE));
}

function drag(b: Bench, from: [number, number], to: [number, number], keys: Parameters<typeof top>[2] = {}): void {
  const dragger = b.view.dragger;
  if (dragger === null) throw new Error('no dragger');
  expect(dragger.press(top(from[0], from[1], keys))).toBe(true);
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    dragger.drag(top(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, keys));
  }
  dragger.release(top(to[0], to[1], keys));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the floor tool turned on', () => {
  it('looks from the top, takes the presses and draws the floor; turned off, it gives them all back', async () => {
    const { b, host, stop } = await on();
    expect(b.view.camera.value).toBe('top');
    expect(b.view.dragger).not.toBeNull();
    expect(b.view.overlays.get('floor.zones')).toHaveLength(4);
    expect(b.view.overlays.get('floor.pieces')?.length).toBeGreaterThan(0);
    expect(b.view.overlayLayers.value).toContain('floor.exits');
    host.use(null);
    expect(b.view.dragger).toBeNull();
    expect([...b.view.overlays.keys()].filter((layer) => layer.startsWith('floor.'))).toEqual([]);
    stop();
  });

  it('draws again with the doors as chosen: shut, the salon door cuts the floor; open, it bridges it', async () => {
    const { b, host, stop } = await on();
    const tool = toolOf(host);
    expect(b.view.overlays.get('floor.cuts')).toHaveLength(1);
    tool.doorState.value = 'open';
    expect(b.view.overlays.has('floor.cuts')).toBe(false);
    expect(b.view.overlays.get('floor.bridges')).toHaveLength(2);
    tool.doorState.value = 'preview';
    b.previewDoors.value = 1 << 6;
    expect(b.view.overlays.get('floor.bridges')).toHaveLength(2);
    b.previewDoors.value = 0;
    expect(b.view.overlays.get('floor.cuts')).toHaveLength(1);
    stop();
  });
});

/** The state of the floor tool that is on. */
function toolOf(host: ToolHost): FloorTool {
  const session = host.current.value?.session as FloorSession | undefined;
  if (session === undefined) throw new Error('no tool on');
  return session.tool;
}

describe('a zone drawn on the floor from the top', () => {
  it('snaps to the grid and to other zones’ edges, takes its floor from the zone nearest, and is one entry of the journal', async () => {
    const { b, host, stop } = await on(null);
    const before = b.journal.state().done.length;
    // from beside the corridor (its edge z 0.55 is near enough to snap to, not to grab) out to the free floor
    drag(b, [3.01, 0.62], [3.39, 0.97]);
    expect(zones(b)).toHaveLength(5);
    expect(zones(b)[4]).toEqual({ minX: 3, minY: 1.3, minZ: 0.55, maxX: 3.375, maxY: 3.8, maxZ: 1 });
    expect(b.journal.state().done.length).toBe(before + 1);
    expect(b.journal.state().done.at(-1)?.label).toBe('tools.floor.cmd.add');
    expect(b.selection.value).toEqual([zoneLink(COACH, 4)]);
    // the floor check finds it holds no place a player fits, and the drawing says so
    expect(toolOf(host).picture.value?.findings.map((f) => [f.code, f.index])).toEqual([['ZONE_TOO_NARROW', 4]]);
    expect(b.view.overlays.get('floor.zones')?.[4]?.style).toBe('warning');

    // stretched by its far edge to 4: it holds a place now
    drag(b, [3.375, 0.7], [4.01, 0.7]);
    expect(zones(b)[4]).toMatchObject({ minX: 3, maxX: 4, minZ: 0.55, maxZ: 1 });
    expect(b.journal.state().done.at(-1)?.label).toBe('tools.floor.cmd.resize');
    expect(toolOf(host).picture.value?.findings).toEqual([]);

    // undone, the stretch goes whole, then the drawing
    b.journal.undo();
    expect(zones(b)[4]?.maxX).toBe(3.375);
    b.journal.undo();
    expect(zones(b)).toHaveLength(4);
    stop();
  });

  it('moves by whole grid steps from inside, a zone off the grid keeping its place between the lines', async () => {
    const { b, stop } = await on(null);
    // the front vestibule, x −9.6…−7.9: off the grid
    drag(b, [-8.7, 0], [-8.48, 0.13]);
    expect(zones(b)[0]).toEqual({ minX: -9.35, minY: 1.15, minZ: -1.275, maxX: -7.65, maxY: 3.6, maxZ: 1.525 });
    expect(b.journal.state().done.at(-1)?.label).toBe('tools.floor.cmd.move');
    expect(b.selection.value).toEqual([zoneLink(COACH, 0)]);
    stop();
  });

  it('stretches by a corner both ways, and turns over when the edge is dragged past the other', async () => {
    const { b, stop } = await on(null);
    drag(b, [1.2, 1.4], [1.51, 1.62]);
    expect(zones(b)[2]).toMatchObject({ minX: -1.2, maxX: 1.5, minZ: -1.4, maxZ: 1.625 });
    drag(b, [1.5, 0], [-2, 0]);
    expect(zones(b)[2]).toMatchObject({ minX: -2, maxX: -1.2 });
    stop();
  });

  it('snaps to the model’s vertices, and to nothing with Alt held', async () => {
    const { b, stop } = await on();
    // by the front left door's box (z 1.45…1.51 the OBJ writes, off the grid), no zone's edge near
    drag(b, [-8.7, 1.509], [-8.2, 1.9], { shift: true });
    const drawn = zones(b)[4];
    expect(vertexLines(coachModel).zs).toContain(drawn?.minZ);
    expect((drawn?.minZ ?? 0) % GRID).not.toBe(0);
    expect(String(drawn?.minZ).length).toBeLessThan(6);
    drag(b, [-5.0012, 0.8], [-4.4567, 1.3], { alt: true, shift: true });
    expect(zones(b)[5]).toMatchObject({ minX: -5.001, maxX: -4.457, minZ: 0.8, maxZ: 1.3 });
    stop();
  });

  it('selects a zone with a click (Shift adds or takes out), and leaves a click on no zone to the view', async () => {
    const { b, stop } = await on(null);
    const dragger = b.view.dragger;
    if (dragger === null) throw new Error('no dragger');
    expect(dragger.press(top(0, 0))).toBe(true);
    expect(dragger.click(top(0, 0))).toBe(true);
    // the selected zone is grabbed first where zones overlap: the corridor's middle
    expect(b.selection.value).toEqual([zoneLink(COACH, 2)]);
    dragger.press(top(-8.7, 0, { shift: true }));
    expect(dragger.click(top(-8.7, 0, { shift: true }))).toBe(true);
    expect(b.selection.value).toEqual([zoneLink(COACH, 2), zoneLink(COACH, 0)]);
    dragger.press(top(-8.7, 0, { shift: true }));
    dragger.click(top(-8.7, 0, { shift: true }));
    expect(b.selection.value).toEqual([zoneLink(COACH, 2)]);
    expect(dragger.press(top(5, 1.2))).toBe(true);
    expect(dragger.click(top(5, 1.2))).toBe(false);
    // a press from another view is not the tool's
    expect(dragger.press({ ...top(0, 0), view: 'orbit' })).toBe(false);
    expect(dragger.press({ ...top(0, 0), direction: [1, 0, 0] })).toBe(false);
    stop();
  });

  it('shows where a press would grab by the cursor', async () => {
    const { b, stop } = await on(null);
    const dragger = b.view.dragger;
    expect(dragger?.hover?.(top(5, 1.2))).toBe('crosshair');
    expect(dragger?.hover?.(top(-8.7, 0))).toBe('move');
    expect(dragger?.hover?.(top(-9.6, 0))).toBe('ew-resize');
    expect(dragger?.hover?.(top(-8.7, 1.4))).toBe('ns-resize');
    expect(dragger?.hover?.(top(-7.9, 1.4))).toBe('nwse-resize');
    expect(dragger?.hover?.(top(-7.9, -1.4))).toBe('nesw-resize');
    expect(dragger?.hover?.(null)).toBeNull();
    stop();
  });

  it('does nothing to a pack the editor only shows', async () => {
    const b = await bench(COACH, null);
    const host = new ToolHost([floorTool]);
    // the shell's dispatch refuses every command of a generated pack
    const stop = host.connect({ ...b.wiring, dispatch: () => false });
    host.use('floor');
    drag(b, [3, 0.8], [3.5, 1.2]);
    expect(zones(b)).toHaveLength(4);
    expect(b.selection.value).toEqual([]);
    stop();
  });
});

describe('a zone’s floor height', () => {
  it('is taken from the vertex under the next click on the model, as the OBJ writes it', async () => {
    const { b, host, stop } = await on();
    const tool = toolOf(host);
    b.selection.value = [zoneLink(COACH, 1)];
    tool.pickingHeight.value = 1;
    // while it waits, a click in the view is the view's, to pick: the tool takes no press
    expect(b.view.dragger?.press(top(0, 0))).toBe(false);
    expect(b.view.dragger?.hover?.(top(0, 0))).toBeNull();
    const floor = coachModel.objects.find((o) => o.name === 'FLOOR') ?? coachModel.objects.find((o) => o.role === 'interior');
    if (floor === undefined) throw new Error('no floor object');
    const point: Vec3 = [(floor.bbox[0][0] + floor.bbox[1][0]) / 2, floor.bbox[1][1], (floor.bbox[0][2] + floor.bbox[1][2]) / 2];
    expect(b.view.emitPick({ object: floor.name, point, shift: false, ctrl: false, alt: false, double: false })).toBe(true);
    expect(tool.pickingHeight.value).toBeNull();
    expect(zones(b)[1]?.minY).toBe(Math.round(floor.bbox[1][1] * 1e6) / 1e6);
    expect(zones(b)[1]?.maxY).toBeCloseTo((zones(b)[1]?.minY ?? 0) + 2.3, 9);
    expect(b.selection.value).toEqual([zoneLink(COACH, 1)]);
    // a click while no zone waits changes nothing, and is the view's
    expect(b.view.emitPick({ object: floor.name, point: [0, 9, 0], shift: false, ctrl: false, alt: false, double: false })).toBe(false);
    expect(b.journal.state().done).toHaveLength(1);
    stop();
  });

  it('is clicked on the model with the zone kept selected: the view selects nothing by the click', async () => {
    const { b, host, stop } = await on();
    const tool = toolOf(host);
    const view = drawing(b, coachModel, 'side');
    b.selection.value = [zoneLink(COACH, 1)];
    tool.pickingHeight.value = 1;
    const hit = view.click([0, 1.3, 1.6]);
    expect(hit.object).toBeDefined();
    expect(tool.pickingHeight.value).toBeNull();
    expect(b.journal.state().done.at(-1)?.label).toBe('tools.floor.cmd.height');
    expect(b.selection.value).toEqual([zoneLink(COACH, 1)]);
    // with no zone waiting, a click on the model is the view's: it selects the object
    view.click([0, 1.3, 1.6]);
    expect(b.selection.value).toEqual([{ kind: 'object', model: COACH, name: hit.object?.object }]);
    view.stop();
    stop();
  });

  it('of a zone drawn is the nearest zone’s, else the model’s floor under it, else 0', async () => {
    const b = await bench(COACH, coachModel);
    const host = new ToolHost([]);
    const stop = host.connect(b.wiring);
    const subject = host.subject.value;
    if (subject === null) throw new Error('no subject');
    expect(heightFor(subject, -9, 0)).toBe(1.15);
    expect(heightFor(subject, 0, 5)).toBe(1.3);
    const bare = { ...subject, typeJson: {} };
    expect(heightFor(bare, 0, 0)).toBeGreaterThan(1);
    expect(heightFor({ ...bare, model: null }, 0, 0)).toBe(0);
    stop();
  });
});

describe('the keyboard’s zones', () => {
  it('are added, reordered, given numbers and removed', async () => {
    const { b, host, stop } = await on(null);
    const tool = toolOf(host);
    b.selection.value = [zoneLink(COACH, 2)];
    tool.add();
    expect(zones(b)[4]).toEqual({ minX: -0.5, minY: 1.3, minZ: -0.5, maxX: 0.5, maxY: 3.8, maxZ: 0.5 });
    expect(tool.selected()).toBe(4);
    tool.setNumber(4, 'max', 0, 2);
    expect(zones(b)[4]?.maxX).toBe(2);
    tool.reorder(4, 0);
    expect(zones(b)[0]?.maxX).toBe(2);
    expect(tool.selected()).toBe(0);
    tool.setHeight(0, 1.5);
    expect(zones(b)[0]).toMatchObject({ minY: 1.5, maxY: 4 });
    tool.remove(0);
    expect(zones(b)).toHaveLength(4);
    expect(tool.selected()).toBe(0);
    tool.show([{ kind: 'door', type: COACH, index: 3 }]);
    expect(b.selection.value).toEqual([{ kind: 'door', type: COACH, index: 3 }]);
    expect(tool.selected()).toBeNull();
    stop();
  });
});

describe('the drawing of a big floor', () => {
  it('follows a moment after the last of a run of edits once a picture takes long', async () => {
    vi.useFakeTimers();
    const b = await bench(COACH, null);
    const host = new ToolHost([]);
    const stop = host.connect(b.wiring);
    const session = startFloor(
      { subject: host.subject, dispatch: (command) => b.wiring.dispatch(command), selection: b.selection, reveal: (links) => host.reveal(links), view: b.view, previewDoors: b.previewDoors },
      { slowMs: -1, settleMs: 100 },
    );
    expect(b.view.overlays.get('floor.zones')).toHaveLength(4);
    session.tool.add();
    expect(b.view.overlays.get('floor.zones')).toHaveLength(4);
    vi.advanceTimersByTime(99);
    expect(b.view.overlays.get('floor.zones')).toHaveLength(4);
    vi.advanceTimersByTime(1);
    expect(b.view.overlays.get('floor.zones')).toHaveLength(5);
    session.dispose();
    stop();
  });
});

describe('the gestures’ geometry', () => {
  it('grabs edges, corners and insides on the floor, and shows each by its cursor', () => {
    const zone = { minX: 0, minY: 1, minZ: 0, maxX: 2, maxY: 3, maxZ: 1 };
    expect(grabAt([zone], null, 1, 0.5, 0.05)).toEqual({ kind: 'move', index: 0 });
    expect(grabAt([zone], null, 2.04, 0.5, 0.05)).toEqual({ kind: 'stretch', index: 0, x: 'max', z: null });
    expect(grabAt([zone], null, 0.01, 1.02, 0.05)).toEqual({ kind: 'stretch', index: 0, x: 'min', z: 'max' });
    expect(grabAt([zone], null, 5, 5, 0.05)).toEqual({ kind: 'draw' });
    expect(grabAt([zone], null, 1, 0.5, 0.05, true)).toEqual({ kind: 'draw' });
    expect(cursorOf({ kind: 'stretch', index: 0, x: 'min', z: 'max' })).toBe('nesw-resize');
  });
});
