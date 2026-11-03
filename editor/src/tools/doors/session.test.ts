import { describe, expect, it } from 'vitest';
import type { Link } from '../../core/contracts';
import { exampleModel } from '../../model/testing.node';
import { findings } from '../../ports/floorCheck';
import type { ViewPointer } from '../../view3d/state';
import floorTool from '../floor/index';
import { ToolHost } from '../registry';
import { bench, type Bench } from '../testing.node';
import doorsTool, { type DoorsSession } from './index';
import { cursorOf, grabAt, grabOfDoor, PLANES, planePoint, vertexYs } from './gesture';
import { doorLink, doorsOf, type DoorBox } from './doors';
import type { DoorsTool } from './session';

const COACH = 'rwat_example:coach';
const FILE = 'data/rwat_example/wagon_types/coach.json';
const coachModel = await exampleModel('coach');

type Keys = Partial<Pick<ViewPointer, 'shift' | 'ctrl' | 'alt'>>;

/** A pointer of an orthographic view over a point (`u`, `v` of the view's plane), one pixel `pixel` blocks. */
function pointer(view: 'top' | 'side' | 'front', u: number, v: number, keys: Keys = {}, pixel = 0.01): ViewPointer {
  const plane = PLANES[view];
  const origin: [number, number, number] = [0, 0, 0];
  const direction: [number, number, number] = [0, 0, 0];
  origin[plane.u] = u;
  origin[plane.v] = v;
  origin[plane.n] = view === 'front' ? -50 : 50;
  direction[plane.n] = view === 'front' ? 1 : -1;
  return { origin, direction, pixel, view, shift: false, ctrl: false, alt: false, ...keys };
}

async function on(model: typeof coachModel | null = coachModel, wagon = COACH): Promise<{ b: Bench; host: ToolHost; tool: DoorsTool; stop: () => void }> {
  const b = await bench(wagon, model);
  const host = new ToolHost([floorTool, doorsTool]);
  const stop = host.connect(b.wiring);
  host.use('doors');
  const session = host.current.value?.session as DoorsSession | undefined;
  if (session === undefined) throw new Error('the tool is not on');
  return { b, host, tool: session.tool, stop };
}

function boxes(b: Bench): (DoorBox | null)[] {
  return doorsOf(b.pack.value?.json(FILE)).map((door) => door.box);
}

function drag(b: Bench, view: 'top' | 'side' | 'front', from: [number, number], to: [number, number], keys: Keys = {}, pixel = 0.01): void {
  const dragger = b.view.dragger;
  if (dragger === null) throw new Error('no dragger');
  expect(dragger.press(pointer(view, from[0], from[1], keys, pixel))).toBe(true);
  for (let i = 1; i <= 4; i++) dragger.drag(pointer(view, from[0] + ((to[0] - from[0]) * i) / 4, from[1] + ((to[1] - from[1]) * i) / 4, keys, pixel));
  dragger.release(pointer(view, to[0], to[1], keys, pixel));
}

const objectLink = (name: string): Link => ({ kind: 'object', model: COACH, name });

describe('the doors tool turned on', () => {
  it('looks from the top, takes the presses and draws the doors; turned off, it gives them all back', async () => {
    const { b, host, stop } = await on();
    expect(b.view.camera.value).toBe('top');
    expect(b.view.dragger).not.toBeNull();
    expect(b.view.overlays.get('doors.boxes')).toHaveLength(8);
    expect(b.view.overlays.get('doors.leaves')).toHaveLength(8);
    expect(b.view.overlayLayers.value).toEqual(expect.arrayContaining(['doors.axes', 'doors.faces', 'doors.spans', 'doors.bridges', 'doors.zones']));
    host.use(null);
    expect(b.view.dragger).toBeNull();
    expect([...b.view.overlays.keys()].filter((layer) => layer.startsWith('doors.'))).toEqual([]);
    stop();
  });

  it('draws again after an edit and once the model is read', async () => {
    const { b, tool, stop } = await on(null);
    expect(b.view.overlays.has('doors.leaves')).toBe(false);
    b.openModel.value = coachModel;
    expect(b.view.overlays.get('doors.leaves')).toHaveLength(8);
    tool.remove(7);
    expect(b.view.overlays.get('doors.boxes')).toHaveLength(7);
    stop();
  });

  it('comes on for a door the checks point at, with the door selected', async () => {
    const b = await bench(COACH, coachModel);
    const host = new ToolHost([floorTool, doorsTool]);
    const stop = host.connect(b.wiring);
    // the links of a floor finding about door 0 (checks/floor/problems)
    const links: Link[] = [{ kind: 'field', file: FILE, at: '/doors/0' }, doorLink(COACH, 0)];
    b.selection.value = links;
    host.reveal(links);
    expect(host.current.value?.tool.id).toBe('doors');
    expect((host.current.value?.session as DoorsSession).tool.selected()).toBe(0);
    // a zone's finding brings the floor tool; a field no tool edits, nothing
    host.reveal([{ kind: 'field', file: FILE, at: '/interior/2' }]);
    expect(host.current.value?.tool.id).toBe('floor');
    host.reveal([{ kind: 'field', file: FILE, at: '/length' }, { kind: 'field', file: 'data/other.json', at: '/doors/0' }]);
    expect(host.current.value?.tool.id).toBe('floor');
    stop();
  });
});

describe('a door from objects of the model', () => {
  it('is the box around the selected objects, with a fresh id, selected, one entry of the journal', async () => {
    const { b, tool, stop } = await on();
    expect(tool.fromSelection()).toBe(false);
    b.selection.value = [objectLink('DOOR_1_TL_0.95_X'), objectLink('DOOR_1_HANDLE'), doorLink(COACH, 3)];
    expect(tool.objects()).toEqual(['DOOR_1_TL_0.95_X', 'DOOR_1_HANDLE']);
    const before = b.journal.state().done.length;
    expect(tool.fromSelection()).toBe(true);
    const json = b.pack.value?.json(FILE) as { doors: unknown[] };
    expect(json.doors[8]).toEqual({ id: 'door_8', min: [-9.25, 1.15, 1.45], max: [-8.25, 3.3, 1.55] });
    expect(b.journal.state().done).toHaveLength(before + 1);
    expect(b.journal.state().done.at(-1)?.label).toBe('tools.doors.cmd.add');
    expect(b.selection.value).toEqual([doorLink(COACH, 8)]);
    b.journal.undo();
    expect(boxes(b)).toHaveLength(8);
    stop();
  });

  it('comes of a double click on an object; a double click on a door’s leaf selects that door', async () => {
    const { b, stop } = await on();
    const pick = (object: string) => b.view.emitPick({ object, point: [0, 0, 0], shift: false, ctrl: false, alt: false, double: true });
    // the view's two clicks selected the object first
    b.selection.value = [objectLink('DOOR_3_HANDLE')];
    pick('DOOR_3_HANDLE');
    expect(b.selection.value).toEqual([doorLink(COACH, 2)]);
    expect(boxes(b)).toHaveLength(8);
    b.selection.value = [objectLink('LIGHT_SWITCH_PLATE')];
    pick('LIGHT_SWITCH_PLATE');
    expect(boxes(b)[8]).toEqual({ minX: -7.92, minY: 2.3, minZ: 0.8, maxX: -7.9, maxY: 2.5, maxZ: 1 });
    expect(b.selection.value).toEqual([doorLink(COACH, 8)]);
    // an object the clicks did not select (a door's box took them), or a single click: nothing
    pick('FLOOR');
    b.view.emitPick({ object: 'FLOOR', shift: false, ctrl: false, alt: false, double: false });
    expect(boxes(b)).toHaveLength(9);
    stop();
  });
});

describe('a door’s box by hand', () => {
  it('moves from the top as one entry of the journal, snapping to the other doors’ edges, and is undone whole', async () => {
    const { b, stop } = await on(null);
    const before = b.journal.state().done.length;
    // door_fl, x −9.25…−8.25, z 1.45…1.51: half a block in, a hair off the lines it snaps back to
    drag(b, 'top', [-8.75, 1.48], [-8.7, 0.983]);
    expect(boxes(b)[0]).toEqual({ minX: -9.25, minY: 1.15, minZ: 0.95, maxX: -8.25, maxY: 3.3, maxZ: 1.01 });
    expect(b.journal.state().done).toHaveLength(before + 1);
    expect(b.journal.state().done.at(-1)?.label).toBe('tools.doors.cmd.move');
    expect(b.selection.value).toEqual([doorLink(COACH, 0)]);
    b.journal.undo();
    expect(boxes(b)[0]).toMatchObject({ minZ: 1.45, maxZ: 1.51 });
    stop();
  });

  it('stretches from the side to the floor of a zone, and from the front by an edge; the floor check follows', async () => {
    const { b, host, tool, stop } = await on();
    b.selection.value = [objectLink('LIGHT_SWITCH_PLATE')];
    tool.fromSelection();
    const found = () => {
      const type = host.subject.value?.type;
      if (type === null || type === undefined) throw new Error('the type does not load');
      return findings(type).map((f) => [f.code, f.index]);
    };
    expect(found()).toEqual([
      ['DOOR_TOO_NARROW', 8],
      ['DOOR_NOT_AT_FLOOR_END', 8],
    ]);
    // from the front (z to the right, y up), zoomed in: its left edge, z 0.8, to the doorways' −0.45
    drag(b, 'front', [0.8, 2.4], [-0.44, 2.4], {}, 0.005);
    expect(boxes(b)[8]).toMatchObject({ minZ: -0.45, maxZ: 1 });
    expect(b.journal.state().done.at(-1)?.label).toBe('tools.doors.cmd.resize');
    expect(found()).toEqual([]);
    // from the side (x to the right, y up): its foot, y 2.3, down to the aisle's floor
    drag(b, 'side', [-7.91, 2.3], [-7.91, 1.32], {}, 0.005);
    expect(boxes(b)[8]).toMatchObject({ minY: 1.3, maxY: 2.5 });
    b.journal.undo();
    b.journal.undo();
    expect(found()).toEqual([
      ['DOOR_TOO_NARROW', 8],
      ['DOOR_NOT_AT_FLOOR_END', 8],
    ]);
    stop();
  });

  it('snaps to the model’s vertices and the grid, and to nothing with Alt held', async () => {
    const { b, tool, stop } = await on();
    tool.select(8);
    tool.add();
    // the new door: x −9.25…−8.25, z 1.4…1.4625; its far end stretched from the top, Alt held: free to a thousandth
    drag(b, 'top', [-8.25, 1.43], [-8.0123, 1.43], { alt: true });
    expect(boxes(b)[8]).toMatchObject({ minX: -9.25, maxX: -8.012 });
    // the vertices let go of (the salon's seats are dense with them), off every edge: the grid
    tool.snapping.value = { ...tool.snapping.value, vertices: false };
    drag(b, 'top', [-8.012, 1.43], [-3.27, 1.43]);
    expect(boxes(b)[8]?.maxX).toBe(-3.25);
    tool.snapping.value = { ...tool.snapping.value, vertices: true };
    // the side view's y: to a vertex (the window sill, 2.3, of the light switch's plate)
    drag(b, 'side', [-8.75, 1.15], [-8.75, 2.31], {}, 0.005);
    expect(vertexYs(coachModel)).toContain(2.3);
    expect(boxes(b)[8]).toMatchObject({ minY: 2.3 });
    stop();
  });

  it('selects a door with a click (Shift adds or takes out), and leaves a press away from every door to the view', async () => {
    const { b, stop } = await on(null);
    const dragger = b.view.dragger;
    if (dragger === null) throw new Error('no dragger');
    expect(dragger.press(pointer('top', -8.75, 1.48))).toBe(true);
    expect(dragger.click(pointer('top', -8.75, 1.48))).toBe(true);
    expect(b.selection.value).toEqual([doorLink(COACH, 0)]);
    dragger.press(pointer('top', 8.75, -1.48, { shift: true }));
    dragger.click(pointer('top', 8.75, -1.48, { shift: true }));
    expect(b.selection.value).toEqual([doorLink(COACH, 0), doorLink(COACH, 3)]);
    dragger.press(pointer('top', -8.75, 1.48, { shift: true }));
    dragger.click(pointer('top', -8.75, 1.48, { shift: true }));
    expect(b.selection.value).toEqual([doorLink(COACH, 3)]);
    expect(dragger.press(pointer('top', 0, 0))).toBe(false);
    expect(dragger.press({ ...pointer('top', -8.75, 1.48), view: 'orbit' })).toBe(false);
    expect(dragger.hover?.({ ...pointer('top', -8.75, 1.48), view: 'orbit' })).toBeNull();
    stop();
  });

  it('shows where a press would grab by the cursor', async () => {
    const { b, stop } = await on(null);
    const dragger = b.view.dragger;
    // a side door seen from the top is thin across: no edge to grab there, it moves
    expect(dragger?.hover?.(pointer('top', -8.75, 1.48))).toBe('move');
    expect(dragger?.hover?.(pointer('top', -9.25, 1.48))).toBe('ew-resize');
    expect(dragger?.hover?.(pointer('top', 0, 0))).toBeNull();
    // from the side its height and width: the top edge, then the top right corner (y up on the screen)
    expect(dragger?.hover?.(pointer('side', -8.75, 3.3))).toBe('ns-resize');
    expect(dragger?.hover?.(pointer('side', -8.25, 3.3))).toBe('nesw-resize');
    expect(dragger?.hover?.(null)).toBeNull();
    stop();
  });

  it('does nothing to a pack the editor only shows', async () => {
    const b = await bench(COACH, coachModel);
    const host = new ToolHost([doorsTool]);
    const stop = host.connect({ ...b.wiring, dispatch: () => false });
    host.use('doors');
    const tool = (host.current.value?.session as DoorsSession).tool;
    drag(b, 'top', [-8.75, 1.48], [-8.75, 1.0]);
    b.selection.value = [objectLink('LIGHT_SWITCH_PLATE')];
    expect(tool.fromSelection()).toBe(false);
    expect(boxes(b)[0]).toMatchObject({ minZ: 1.45 });
    expect(boxes(b)).toHaveLength(8);
    expect(b.selection.value).toEqual([objectLink('LIGHT_SWITCH_PLATE')]);
    stop();
  });
});

describe('the keyboard’s doors', () => {
  it('are added, given numbers, ids, flags and groups, reordered and removed', async () => {
    const { b, tool, stop } = await on(null);
    tool.add();
    expect(boxes(b)[8]).toEqual({ minX: -9.25, minY: 1.15, minZ: 1.4, maxX: -8.25, maxY: 3.15, maxZ: 1.4625 });
    expect(tool.selected()).toBe(8);
    tool.setNumber(8, 'max', 2, 1.45);
    expect(boxes(b)[8]?.maxZ).toBe(1.45);
    expect(tool.setId(8, '')).toBe(false);
    expect(tool.setId(8, 'hatch')).toBe(true);
    tool.setFlag(8, 'fixed', true);
    tool.setGroup(8, 'Hatches');
    const door = () => (b.pack.value?.json(FILE) as { doors: Record<string, unknown>[] }).doors;
    expect(door()[8]).toEqual({ id: 'hatch', min: [-9.25, 1.15, 1.4], max: [-8.25, 3.15, 1.45], fixed: true, group: 'Hatches' });
    tool.reorder(8, 0);
    expect(door()[0]?.id).toBe('hatch');
    expect(tool.selected()).toBe(0);
    tool.remove(0);
    expect(door()).toHaveLength(8);
    expect(tool.selected()).toBe(0);
    tool.select(null);
    expect(tool.selected()).toBeNull();
    stop();
  });
});

describe('the gestures’ geometry', () => {
  it('meets a ray at a view’s plane, grabs edges, corners and insides, and shows each by its cursor', () => {
    expect(planePoint({ ...pointer('top', 0, 0), origin: [0, 5, 0], direction: [0.6, -0.8, 0] }, PLANES.top, 1)).toEqual([3, 0]);
    expect(planePoint({ ...pointer('top', 0, 0), direction: [1, 0, 0] }, PLANES.top, 1)).toBeNull();
    const box = { minX: 0, minY: 1, minZ: 0, maxX: 2, maxY: 3, maxZ: 1 };
    expect(grabOfDoor(box, 0, PLANES.side, 1, 2, 0.05)).toEqual({ kind: 'move', index: 0 });
    expect(grabOfDoor(box, 0, PLANES.side, 2.04, 2, 0.05)).toEqual({ kind: 'stretch', index: 0, u: 'max', v: null });
    expect(grabOfDoor(box, 0, PLANES.front, 0.01, 0.98, 0.05)).toEqual({ kind: 'stretch', index: 0, u: 'min', v: 'min' });
    expect(grabOfDoor(box, 0, PLANES.side, 5, 2, 0.05)).toBeNull();
    // thinner than three tolerances: no edges, an inside grown by the tolerance
    expect(grabOfDoor({ ...box, maxZ: 0.1 }, 0, PLANES.top, 1, 0.14, 0.05)).toEqual({ kind: 'move', index: 0 });
    expect(grabAt([box, null, { ...box, minX: 1 }], null, PLANES.side, 1.5, 2, 0.05)).toEqual({ kind: 'move', index: 2 });
    expect(grabAt([box, null, { ...box, minX: 1 }], 0, PLANES.side, 1.5, 2, 0.05)).toEqual({ kind: 'move', index: 0 });
    expect(cursorOf({ kind: 'stretch', index: 0, u: 'max', v: 'max' }, PLANES.top)).toBe('nwse-resize');
    expect(cursorOf({ kind: 'stretch', index: 0, u: 'max', v: 'max' }, PLANES.side)).toBe('nesw-resize');
    expect(cursorOf({ kind: 'stretch', index: 0, u: null, v: 'min' }, PLANES.front)).toBe('ns-resize');
  });
});
