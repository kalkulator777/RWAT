import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Link, LoadedModel, PickHit } from '../../core/contracts';
import { exampleModel } from '../../model/testing.node';
import type { ViewPointer } from '../../core/contracts';
import floorTool from '../floor/index';
import { ToolHost } from '../registry';
import { bench, drawing, type Bench } from '../testing.node';
import { DIAL_RADIUS } from './analysis';
import { chairsOf } from './chairs';
import { dialYaw, facingPoint, grabAt, movedTo } from './gesture';
import seatsTool, { type SeatsSession } from './index';
import { newPlace, SEATS_TIMING, startSeats, type SeatsTool } from './session';

const SHUNTER = 'rwat_example:shunter';
const SHUNTER_TYPE = 'data/rwat_example/wagon_types/shunter.json';
const COACH = 'rwat_example:coach';
const shunterModel = await exampleModel('shunter');
// drawn again at once after each edit, however slow an instrumented run is
SEATS_TIMING.slowMs = Number.POSITIVE_INFINITY;

/** A pointer of the view from the top over (x, z) of the plan, one pixel a hundredth of a block. */
function top(x: number, z: number, keys: Partial<Pick<ViewPointer, 'shift' | 'ctrl' | 'alt'>> = {}): ViewPointer {
  return { origin: [x, 50, z], direction: [0, -1, 0], pixel: 0.01, view: 'top', shift: false, ctrl: false, alt: false, ...keys };
}

function pick(object: string, point: [number, number, number], keys: Partial<PickHit> = {}): PickHit {
  return { object, point, shift: false, ctrl: false, alt: false, double: false, ...keys };
}

/** Turns the chairs tool on through the host, as the shell does. */
async function on(wagon = SHUNTER, model: LoadedModel | null = shunterModel): Promise<{ b: Bench; host: ToolHost; stop: () => void; tool: SeatsTool }> {
  const b = await bench(wagon, model);
  const host = new ToolHost([floorTool, seatsTool]);
  const stop = host.connect(b.wiring);
  host.use('seats');
  const session = host.current.value?.session as SeatsSession | undefined;
  if (session === undefined) throw new Error('no tool on');
  return { b, host, stop, tool: session.tool };
}

function chairs(b: Bench) {
  return chairsOf(b.pack.value?.json(SHUNTER_TYPE));
}

const seat = (index: number, type = SHUNTER): Link => ({ kind: 'seat', type, index });

afterEach(() => {
  vi.useRealTimers();
});

describe('the chairs tool turned on', () => {
  it('looks from the top, takes the presses on its chairs and draws them; turned off, it gives them all back', async () => {
    const { b, host, stop } = await on();
    expect(b.view.camera.value).toBe('top');
    expect(b.view.dragger).not.toBeNull();
    expect(b.view.overlays.get('seats.chairs')).toHaveLength(4);
    expect(b.view.overlays.get('seats.facing')).toHaveLength(2);
    expect(b.view.overlayLayers.value).toEqual(expect.arrayContaining(['seats.reach', 'seats.floor']));
    host.use(null);
    expect(b.view.dragger).toBeNull();
    expect([...b.view.overlays.keys()].filter((layer) => layer.startsWith('seats.'))).toEqual([]);
    // a click on the model places nothing once it is off
    b.view.emitPick(pick('INTERIOR_CHAIRS_LCG_IL', [1.6, 2.1, -0.75]));
    expect(chairs(b)).toHaveLength(2);
    stop();
  });

  it('is turned on by a chair’s finding clicked in the checks, the chair selected', async () => {
    const b = await bench(SHUNTER, shunterModel);
    const host = new ToolHost([floorTool, seatsTool]);
    const stop = host.connect(b.wiring);
    host.use('floor');
    // as the checks tab does: the finding's links selected, then the tool of their place revealed
    const links: Link[] = [{ kind: 'field', file: SHUNTER_TYPE, at: '/cab/seats/1' }, seat(1)];
    b.selection.value = links;
    host.reveal(links);
    expect(host.active.value).toBe('seats');
    const tool = (host.current.value?.session as SeatsSession).tool;
    expect(tool.selected()?.index).toBe(1);
    expect(b.view.overlays.get('seats.dial')?.[0]?.link).toEqual(seat(1));
    // the chairs without a floor point at the list, the cab without a chair at the cab: the chairs' tool both
    host.use('floor');
    host.reveal([{ kind: 'field', file: SHUNTER_TYPE, at: '/cab/seats' }]);
    expect(host.active.value).toBe('seats');
    host.use(null);
    host.reveal([{ kind: 'field', file: SHUNTER_TYPE, at: '/cab' }]);
    expect(host.active.value).toBe('seats');
    // the old one-chair form
    host.use(null);
    host.reveal([{ kind: 'field', file: SHUNTER_TYPE, at: '/cab/seat' }]);
    expect(host.active.value).toBe('seats');
    stop();
  });
});

describe('a chair placed by a click on the model', () => {
  it('sits on the cushion clicked, faces forward, is one entry of the journal and is selected: the click is the tool’s', async () => {
    const { b, tool, stop } = await on();
    const before = b.journal.state().done.length;
    expect(b.view.emitPick(pick('INTERIOR_CHAIRS_LCG_IL', [3.0, 2.1, 0.7]))).toBe(true);
    expect(chairs(b)).toHaveLength(3);
    expect(chairs(b)[2]).toEqual({ at: [2.95, 2.1, 0.8], yaw: 0 });
    expect(b.journal.state().done.length).toBe(before + 1);
    expect(b.journal.state().done.at(-1)?.label).toBe('tools.seats.cmd.place');
    expect(b.selection.value).toEqual([seat(2)]);
    expect(tool.selected()?.index).toBe(2);
    b.journal.undo();
    expect(chairs(b)).toHaveLength(2);
    stop();
  });

  it('placed by a click on the screen stays selected at once: the view selects nothing by the click', async () => {
    const { b, stop } = await on();
    const view = drawing(b, shunterModel);
    // the long hood's top, as the browser test clicks it
    const hit = view.click([-1.5, 3.3, 0.2]);
    expect(hit.object).toBeDefined();
    expect(chairs(b)).toHaveLength(3);
    expect(b.selection.value).toEqual([seat(2)]);
    // Shift held places nothing: the click is the view's, which adds the object
    view.click([-1.5, 3.3, 0.2], { shift: true });
    expect(chairs(b)).toHaveLength(3);
    expect(b.selection.value).toEqual([seat(2), { kind: 'object', model: SHUNTER, name: hit.object?.object }]);
    view.stop();
    stop();
  });

  it('with Alt, right where clicked; with Shift or Ctrl, or a double click, not at all', async () => {
    const { b, stop } = await on();
    b.view.emitPick(pick('INTERIOR_CHAIRS_LCG_IL', [1.6123, 2.1, -0.7456], { alt: true }));
    expect(chairs(b)[2]).toEqual({ at: [1.612, 2.1, -0.746], yaw: 0 });
    b.view.emitPick(pick('INTERIOR_CHAIRS_LCG_IL', [1.6, 2.1, -0.7], { shift: true }));
    b.view.emitPick(pick('INTERIOR_CHAIRS_LCG_IL', [1.6, 2.1, -0.7], { ctrl: true }));
    b.view.emitPick(pick('INTERIOR_CHAIRS_LCG_IL', [1.6, 2.1, -0.7], { double: true }));
    b.view.emitPick({ shift: false, ctrl: false, alt: false, double: false });
    expect(chairs(b)).toHaveLength(3);
    stop();
  });

  it('makes the cab of a type that has none, and stops at sixteen chairs', async () => {
    const coachModel = await exampleModel('coach');
    const { b, tool, stop } = await on(COACH, coachModel);
    const file = 'data/rwat_example/wagon_types/coach.json';
    expect(tool.placeOn('FLOOR', [0, 1.3, 0.2])).toBe(true);
    expect((b.pack.value?.json(file) as { cab: unknown }).cab).toEqual({ seats: [{ at: [0, 1.3, 0.2], yaw: 0 }] });
    for (let i = 1; i < 16; i++) expect(tool.placeOn('FLOOR', [i * 0.1, 1.3, 0])).toBe(true);
    expect(tool.placeOn('FLOOR', [0, 1.3, 0])).toBe(false);
    expect(chairsOf(b.pack.value?.json(file))).toHaveLength(16);
    stop();
  });
});

describe('a chair dragged from the top', () => {
  it('is grabbed by its disc: a click selects it (Shift adds), a press elsewhere is the view’s', async () => {
    const { b, stop } = await on();
    const dragger = b.view.dragger!;
    expect(dragger.press(top(4, 0))).toBe(false);
    expect(dragger.hover?.(top(1.7, -0.8))).toBe('move');
    expect(dragger.press(top(1.7, -0.8))).toBe(true);
    expect(dragger.click(top(1.7, -0.8))).toBe(true);
    expect(b.selection.value).toEqual([seat(0)]);
    expect(dragger.press(top(2.95, 0.8, { shift: true }))).toBe(true);
    dragger.click(top(2.95, 0.8, { shift: true }));
    expect(b.selection.value).toEqual([seat(0), seat(1)]);
    dragger.press(top(2.95, 0.8, { shift: true }));
    dragger.click(top(2.95, 0.8, { shift: true }));
    expect(b.selection.value).toEqual([seat(0)]);
    stop();
  });

  it('moves on the plan, snapping to the grid, a vertex or a cushion’s middle (its height too), and is one entry of the journal', async () => {
    const { b, tool, stop } = await on();
    const dragger = b.view.dragger!;
    const before = b.journal.state().done.length;
    tool.snapping.value = { cushions: true, vertices: false, grid: true };
    expect(dragger.press(top(1.65, -0.8))).toBe(true);
    dragger.drag(top(1.9, -0.5));
    dragger.drag(top(2.21, 0.14));
    dragger.release(top(2.21, 0.14));
    expect(chairs(b)[0]).toEqual({ at: [2.1875, 2.1, 0.125], yaw: 0 });
    expect(b.journal.state().done.length).toBe(before + 1);
    expect(b.journal.state().done.at(-1)?.label).toBe('tools.seats.cmd.move');
    expect(b.selection.value).toEqual([seat(0)]);
    // the model's vertices too: one at z 0.13
    tool.snapping.value = { cushions: true, vertices: true, grid: true };
    dragger.press(top(2.1875, 0.125));
    dragger.release(top(2.1875, 0.134));
    expect(chairs(b)[0]?.at[2]).toBe(0.13);
    // onto the other chair's cushion, a few pixels off its middle
    dragger.press(top(2.1875, 0.13));
    dragger.release(top(2.99, 0.77));
    expect(chairs(b)[0]?.at).toEqual([2.95, 2.1, 0.8]);
    // Alt: free, to a thousandth
    dragger.press(top(2.95, 0.8));
    dragger.release(top(2.4321, 0.1234, { alt: true }));
    expect(chairs(b)[0]?.at).toEqual([2.432, 2.1, 0.123]);
    for (let i = 0; i < 4; i++) b.journal.undo();
    expect(chairs(b)[0]?.at).toEqual([1.65, 2.1, -0.8]);
    stop();
  });

  it('turns round its dial by the head of its arrow once selected, by 15° (Alt: 1°)', async () => {
    const { b, tool, stop } = await on();
    const dragger = b.view.dragger!;
    tool.select({ kind: tool.kinds[0]!, index: 0 });
    const head = facingPoint({ at: [1.65, 2.1, -0.8], yaw: 0 });
    expect(head).toEqual([1.65 - DIAL_RADIUS, 2.1, -0.8]);
    expect(dragger.hover?.(top(head[0], head[2]))).toBe('grab');
    expect(dragger.press(top(head[0], head[2]))).toBe(true);
    // to the right side (−z), a little short of square
    dragger.drag(top(1.65 - 0.05, -0.8 - 0.6));
    dragger.release(top(1.65 - 0.05, -0.8 - 0.6));
    expect(chairs(b)[0]?.yaw).toBe(90);
    expect(b.journal.state().done.at(-1)?.label).toBe('tools.seats.cmd.turn');
    // backward
    const right = facingPoint({ at: [1.65, 2.1, -0.8], yaw: 90 });
    dragger.press(top(right[0], right[2]));
    dragger.release(top(1.65 + 0.6, -0.8 + 0.02));
    expect(chairs(b)[0]?.yaw).toBe(180);
    dragger.press(top(1.65 + 0.6, -0.8));
    dragger.release(top(1.65 + 0.6, -0.8 + 0.1, { alt: true }));
    expect(chairs(b)[0]?.yaw).toBe(-171);
    stop();
  });

  it('works out a dial’s yaw and a move’s target alone', () => {
    expect(dialYaw([0, 0, 0], -1, 0.1, 15)).toBe(0);
    expect(dialYaw([0, 0, 0], 1, 0.01, 15)).toBe(180);
    expect(dialYaw([0, 0, 0], -1, -0.3, 1)).toBe(17);
    const lines = { xs: Float64Array.of(0.33), zs: Float64Array.of() };
    expect(movedTo({ at: [0, 2, 0], yaw: 0 }, 0.335, 0.47, 0.08, [], lines, { cushions: true, vertices: true, grid: true })).toEqual([0.33, 2, 0.5]);
    expect(movedTo({ at: [0, 2, 0], yaw: 0 }, 0.335, 0.47, 0.08, [[0.3, 1.5, 0.45]], lines, { cushions: true, vertices: true, grid: true })).toEqual([0.3, 1.5, 0.45]);
    expect(movedTo({ at: [0, 2, 0], yaw: 0 }, 0.335, 0.47, 0.08, [[0.3, 1.5, 0.45]], lines, { cushions: false, vertices: false, grid: false })).toEqual([0.335, 2, 0.47]);
    // cushions one over another: the one nearest the chair's height, though another is nearer on the plan
    expect(movedTo({ at: [0, 2, 0], yaw: 0 }, 0.335, 0.47, 0.08, [[0.33, 0.5, 0.47], [0.3, 1.5, 0.45]], lines, { cushions: true, vertices: true, grid: true })).toEqual([0.3, 1.5, 0.45]);
  });

  it('grabs nothing from a ray that misses every disc, and the selected chair’s handle before another disc', () => {
    const views = [{ ref: { kind: null as never, index: 0 }, place: { at: [0, 0, 0] as [number, number, number], yaw: 0 }, facts: null, backward: false }];
    expect(grabAt(views, null, top(5, 5))).toBeNull();
    expect(grabAt(views, null, top(0.1, 0))?.kind).toBe('move');
    expect(grabAt(views, views[0]!.ref, top(-DIAL_RADIUS, 0))?.kind).toBe('turn');
  });
});

describe('the chairs edited from the keyboard', () => {
  it('added over the floor, typed, turned, moved in the order, removed', async () => {
    const { b, tool, stop } = await on();
    tool.add();
    expect(chairs(b)[2]).toEqual({ at: [2.3, 2.1, 0], yaw: 0 });
    expect(tool.selected()?.index).toBe(2);
    const ref = { kind: tool.kinds[0]!, index: 2 };
    tool.setAt(ref, 1, 2.2);
    tool.setYaw(ref, 90);
    expect(chairs(b)[2]).toEqual({ at: [2.3, 2.2, 0], yaw: 90 });
    tool.reorder(ref, 0);
    expect(chairs(b)[0]).toEqual({ at: [2.3, 2.2, 0], yaw: 90 });
    expect(tool.selected()?.index).toBe(0);
    tool.remove({ kind: tool.kinds[0]!, index: 0 });
    expect(chairs(b)).toHaveLength(2);
    expect(tool.selected()?.index).toBe(0);
    tool.remove({ kind: tool.kinds[0]!, index: 0 });
    tool.remove({ kind: tool.kinds[0]!, index: 0 });
    expect(chairs(b)).toEqual([]);
    expect(tool.selected()).toBeNull();
    expect(b.view.overlays.has('seats.chairs')).toBe(false);
    stop();
  });

  it('puts a new chair where nothing else is known at the car’s middle', () => {
    expect(newPlace({ wagon: 'x:y', typeFile: 'f', modelFile: 'm', typeJson: {}, modelJson: {}, type: null, model: null, readOnly: false })).toEqual({ at: [0, 1, 0], yaw: 0 });
  });

  it('in a pack the editor only shows: refused, nothing changes', async () => {
    const { b, tool, stop } = await on();
    const refuse = vi.spyOn(b.wiring, 'dispatch').mockReturnValue(false);
    expect(tool.placeOn('INTERIOR_CHAIRS_LCG_IL', [1.6, 2.1, -0.75])).toBe(false);
    tool.add();
    expect(refuse).toHaveBeenCalled();
    expect(chairs(b)).toHaveLength(2);
    stop();
  });

  it('draws a moment after the last of a run of edits once drawing is slow; a selection, at once', async () => {
    vi.useFakeTimers();
    const b = await bench(SHUNTER, shunterModel);
    const host = new ToolHost([]);
    const stop = host.connect(b.wiring);
    // every picture is slow: each edit's drawing waits for the run to end
    const own = startSeats(
      { subject: host.subject, dispatch: (command) => b.wiring.dispatch(command), selection: b.selection, reveal: (links) => host.reveal(links), view: b.view, previewDoors: b.previewDoors },
      { slowMs: 0, settleMs: 50 },
    );
    const drawn = () => b.view.overlays.get('seats.chairs')?.length ?? 0;
    expect(drawn()).toBe(4);
    own.tool.add();
    expect(drawn()).toBe(4);
    vi.advanceTimersByTime(60);
    expect(drawn()).toBe(6);
    expect(b.view.overlays.get('seats.dial')).toHaveLength(5);
    own.tool.select(null);
    expect(b.view.overlays.has('seats.dial')).toBe(false);
    own.dispose();
    stop();
  });
});
