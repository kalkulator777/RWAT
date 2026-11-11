/**
 * The preview against the 3D view's contract (core/contracts `ViewApi`), on the example
 * pack's coach and shunter as the model worker reads them (./testing.node.ts, through
 * model/build) and their wagon types as the engine reads them: the M3 gates of
 * the preview (editor.md §7, M3) — the `salon_door` slider moves the door's pieces by its
 * `.anim`, the `THROTTLE_1` slider turns the lever about its marker's axis as far as its
 * name says, the coupler heads switch, a livery swaps the textures — and the rest of what
 * the preview tells the view.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vec3 } from '../core/contracts';
import { framesAt, parse as parseAnim } from '../ports/anim';
import { rowMajor } from '../ports/controlPose';
import { parseRole } from '../ports/objectRole';
import { of as hingeOf } from '../ports/pivotAxis';
import { EXAMPLE_PACK } from '../testing/repo.node';
import { PreviewController, prefersReducedMotion, type PreviewSubject, type Ticker } from './controller';
import { DOOR_ANIM_TICKS, TICK_MS } from './doors';
import { HEADLIGHT_STYLE, LAMP_STYLE, LIGHTS_LAYER } from './scene';
import { parseWagonType } from '../ports/wagonType';
import { assetPath, cornersOf, exampleSubject, objText, packText, recordingView, type RecordingView } from './testing.node';

/** A frame written row by row as the view takes it, column by column: its transpose (ports/controlPose `rowMajor` transposes any 4×4). */
function transposed(rows: ArrayLike<number>): number[] {
  return rowMajor(Array.from(rows));
}

/** A ticker the test turns by hand: it only counts who asked to be run. */
function handTicker(): Ticker & { running: number } {
  const ticker = {
    running: 0,
    every() {
      ticker.running++;
      return () => {
        ticker.running--;
      };
    },
  };
  return ticker;
}

const controllers: PreviewController[] = [];

/** The example coach and shunter as the model worker reads them (read once: a subject is never changed). */
const subjects: Record<'coach' | 'shunter', PreviewSubject> = { coach: await exampleSubject('coach'), shunter: await exampleSubject('shunter') };

function setUp(name: 'coach' | 'shunter', ticker: Ticker = handTicker(), subject = subjects[name]): { preview: PreviewController; view: RecordingView } {
  const preview = new PreviewController(ticker);
  controllers.push(preview);
  const view = recordingView();
  view.show(subject.model); // as the editor does before handing the model to the preview
  preview.view.value = view;
  preview.load(subject);
  return { preview, view };
}

afterEach(() => {
  for (const preview of controllers.splice(0)) preview.dispose();
  vi.useRealTimers();
});

/** A matrix as a plain list, for comparing. */
function list(matrix: Float32Array | null | undefined): number[] {
  if (matrix === null || matrix === undefined) throw new Error('no transform');
  return Array.from(matrix);
}

/** Column-major 4×4 times a point. */
function apply(m: Float32Array, p: Vec3): Vec3 {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The signed angle, degrees, by which `m` turns point `p` about the axis through `centre` (right-hand rule). */
function turnAbout(m: Float32Array, centre: Vec3, axis: Vec3, p: Vec3): number {
  const off = (q: Vec3): Vec3 => {
    const d = sub(q, centre);
    const along = dot(d, axis);
    return [d[0] - along * axis[0], d[1] - along * axis[1], d[2] - along * axis[2]];
  };
  const before = off(p);
  const after = off(apply(m, p));
  return (Math.atan2(dot(cross(before, after), axis), dot(before, after)) * 180) / Math.PI;
}

function centreOf(corners: readonly Vec3[]): Vec3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const c of corners) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, c[i]!);
      max[i] = Math.max(max[i]!, c[i]!);
    }
  }
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

const SALON_DOOR = 6; // the coach type's door `salon_door`
const salonTracks = parseAnim(readFileSync(join(EXAMPLE_PACK, ...assetPath('stock/coach/salon_door.anim').split('/')), 'utf8'));

describe('the salon_door slider', () => {
  it('moves the door pieces frame by frame of salon_door.anim, as framesAt gives them', () => {
    const { preview, view } = setUp('coach');
    expect(preview.subject.value?.type?.doors[SALON_DOOR]?.id).toBe('salon_door');
    expect([...salonTracks.keys()]).toEqual(['SALON_DOOR_LEAF_INTERIOR_LCG_IL', 'SALON_DOOR_KNOB']);
    for (const progress of [0, 0.1, 0.25, 0.5, 0.731, 0.99, 1]) {
      preview.setDoor(SALON_DOOR, progress);
      const frames = framesAt(salonTracks, progress);
      for (const [object, rows] of frames) {
        expect(list(view.transforms.get(object)), `${object} at ${progress}`).toEqual(transposed(rows));
      }
    }
  });

  it('hands the view the frame column by column: the frame’s translation is the matrix’s last column', () => {
    const { preview, view } = setUp('coach');
    preview.setDoor(SALON_DOOR, 1);
    const rows = framesAt(salonTracks, 1).get('SALON_DOOR_KNOB')!;
    const m = view.transforms.get('SALON_DOOR_KNOB')!;
    expect([m[12], m[13], m[14], m[15]]).toEqual([rows[3], rows[7], rows[11], rows[15]]);
    expect(rows[11]).not.toBe(0); // the knob does move
  });

  it('leaves the pieces at rest while the door is shut, and the other doors’ leaves where they are', () => {
    const { preview, view } = setUp('coach');
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(list(view.transforms.get('SALON_DOOR_KNOB'))).toEqual(identity);
    view.clearCalls();
    preview.setDoor(SALON_DOOR, 0.5);
    expect(new Set(view.calls.map((c) => c.object))).toEqual(new Set(['SALON_DOOR_LEAF_INTERIOR_LCG_IL', 'SALON_DOOR_KNOB']));
    expect(list(view.transforms.get('DOOR_1_TL_0.95_X'))).toEqual(identity);
  });

  it('opens over the engine’s 40 ticks and closes again, the pieces at framesAt of the door’s progress', () => {
    const ticker = handTicker();
    const { preview, view } = setUp('coach', ticker);
    preview.toggleDoor(SALON_DOOR);
    expect(ticker.running).toBe(1);
    expect(preview.isOpening(SALON_DOOR)).toBe(true);
    for (let tick = 1; tick <= DOOR_ANIM_TICKS / 2; tick++) preview.tick();
    const half = preview.state.value!.doors[SALON_DOOR]!;
    expect(half).toBeCloseTo(0.5, 6);
    expect(list(view.transforms.get('SALON_DOOR_KNOB'))).toEqual(transposed(framesAt(salonTracks, half).get('SALON_DOOR_KNOB')!));
    for (let tick = DOOR_ANIM_TICKS / 2 + 1; tick <= DOOR_ANIM_TICKS; tick++) expect(preview.tick()).toBe(true);
    // 40 steps of the float 1/40 fall 4e-7 short of 1, as in the engine: a 41st settles it
    expect(preview.state.value!.doors[SALON_DOOR]).toBeCloseTo(1, 6);
    expect(preview.tick()).toBe(false);
    expect(preview.state.value!.doors[SALON_DOOR]).toBe(1);
    expect(ticker.running).toBe(0);
    expect(list(view.transforms.get('SALON_DOOR_KNOB'))).toEqual(transposed(framesAt(salonTracks, 1).get('SALON_DOOR_KNOB')!));

    preview.toggleDoor(SALON_DOOR);
    expect(preview.isOpening(SALON_DOOR)).toBe(false);
    while (preview.tick());
    expect(preview.state.value!.doors[SALON_DOOR]).toBe(0);
  });

  it('jumps to open and to shut at once when less motion is asked for, with no tick running', () => {
    const ticker = handTicker();
    const preview = new PreviewController(ticker, () => true);
    controllers.push(preview);
    const view = recordingView();
    view.show(subjects.coach.model);
    preview.view.value = view;
    preview.load(subjects.coach);
    preview.toggleDoor(SALON_DOOR);
    expect(preview.state.value!.doors[SALON_DOOR]).toBe(1);
    expect(preview.state.value!.heading[SALON_DOOR]).toBeNull();
    expect(preview.isOpening(SALON_DOOR)).toBe(true);
    expect(ticker.running).toBe(0);
    expect(list(view.transforms.get('SALON_DOOR_KNOB'))).toEqual(transposed(framesAt(salonTracks, 1).get('SALON_DOOR_KNOB')!));
    preview.toggleDoor(SALON_DOOR);
    expect(preview.state.value!.doors[SALON_DOOR]).toBe(0);
    expect(preview.isOpening(SALON_DOOR)).toBe(false);
    // a door's group goes together, as in the game
    preview.toggleDoor(0);
    expect(preview.state.value!.doors.slice(0, 4)).toEqual([1, 0, 1, 0]);
    expect(ticker.running).toBe(0);
  });

  it('reads the system’s wish for less motion when none is given', () => {
    const real = globalThis.matchMedia;
    try {
      globalThis.matchMedia = ((query: string) => ({ matches: query.includes('reduce') })) as typeof matchMedia;
      expect(prefersReducedMotion()).toBe(true);
      globalThis.matchMedia = ((query: string) => ({ matches: !query.includes('reduce') })) as typeof matchMedia;
      expect(prefersReducedMotion()).toBe(false);
      // the shell has none: motion as usual
      (globalThis as { matchMedia?: unknown }).matchMedia = undefined;
      expect(prefersReducedMotion()).toBe(false);
    } finally {
      globalThis.matchMedia = real;
    }
  });

  it('swings in real time, a game tick every 50 ms: 2 s open it', () => {
    vi.useFakeTimers();
    const preview = new PreviewController();
    controllers.push(preview);
    const view = recordingView();
    preview.view.value = view;
    preview.load(subjects.coach);
    preview.toggleDoor(SALON_DOOR);
    vi.advanceTimersByTime((DOOR_ANIM_TICKS / 2) * TICK_MS);
    expect(preview.state.value!.doors[SALON_DOOR]).toBeCloseTo(0.5, 6);
    vi.advanceTimersByTime((DOOR_ANIM_TICKS / 2) * TICK_MS);
    expect(preview.state.value!.doors[SALON_DOOR]).toBeCloseTo(1, 6);
    vi.advanceTimersByTime(TICK_MS);
    expect(preview.state.value!.doors[SALON_DOOR]).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('opens the leaves of a door’s group together, as a click in the game does', () => {
    const { preview, view } = setUp('coach');
    preview.toggleDoor(0); // door_fl, group DoorsL with door_rl
    while (preview.tick());
    expect(preview.state.value!.doors.slice(0, 4)).toEqual([1, 0, 1, 0]);
    // DOOR_1 (door_fl) slides 0.95 along OBJ X, DOOR_3 (door_rl) back the other way
    expect(view.transforms.get('DOOR_1_TL_0.95_X')![12]).toBeCloseTo(0.95, 6);
    expect(view.transforms.get('DOOR_1_HANDLE')![12]).toBeCloseTo(0.95, 6);
    expect(view.transforms.get('DOOR_3_TL_-0.95_X')![12]).toBeCloseTo(-0.95, 6);
    expect(view.transforms.get('DOOR_2_TL_0.95_X')![12]).toBe(0);
  });
});

describe('the THROTTLE_1 slider', () => {
  const marker = 'THROTTLE_1_ROT_-50';
  const hinge = hingeOf(cornersOf(objText('shunter'), marker));
  const degrees = parseRole(marker).pivotDegrees!;
  const knob = centreOf(cornersOf(objText('shunter'), 'THROTTLE_1_KNOB'));
  // the marker is drawn too (a textured pivot boss), as all the control's objects
  const objects = [marker, 'THROTTLE_1_LEVER_LABEL_Controller', 'THROTTLE_1_KNOB'];

  it('turns the lever about its marker’s axis, to the angle in the marker’s name at the last notch', () => {
    const { preview, view } = setUp('shunter');
    expect(degrees).toBe(-50);
    preview.setInput('THROTTLE_1', 8);
    const m = view.transforms.get('THROTTLE_1_KNOB')!;
    // the hinge stays put, so does every point of its axis
    for (const along of [0, 1, -2]) {
      const p: Vec3 = [hinge.centre[0] + along * hinge.axis[0], hinge.centre[1] + along * hinge.axis[1], hinge.centre[2] + along * hinge.axis[2]];
      const q = apply(m, p);
      for (let i = 0; i < 3; i++) expect(q[i]).toBeCloseTo(p[i]!, 5);
    }
    expect(turnAbout(m, hinge.centre, hinge.axis, knob)).toBeCloseTo(degrees, 3);
    for (const object of objects) expect(list(view.transforms.get(object))).toEqual(list(m));
  });

  it('turns it notch by notch: an eighth of the swing a notch, none at rest', () => {
    const { preview, view } = setUp('shunter');
    expect(turnAbout(view.transforms.get('THROTTLE_1_KNOB')!, hinge.centre, hinge.axis, knob)).toBeCloseTo(0, 6);
    for (const notch of [1, 4, 7]) {
      preview.setInput('THROTTLE_1', notch);
      expect(turnAbout(view.transforms.get('THROTTLE_1_KNOB')!, hinge.centre, hinge.axis, knob)).toBeCloseTo((degrees * notch) / 8, 3);
    }
  });

  it('tells the view only what moved: the lever’s objects, not the other cab’s lever', () => {
    const { preview, view } = setUp('shunter');
    view.clearCalls();
    preview.setInput('THROTTLE_1', 3);
    expect(view.calls.every((c) => c.method === 'setTransform')).toBe(true);
    expect(view.calls.map((c) => c.object).sort()).toEqual([...objects].sort());
    preview.setInput('THROTTLE_1', 3);
    expect(view.calls).toHaveLength(objects.length);
  });

  it('holds a slider to its notches’ ends', () => {
    const { preview } = setUp('shunter');
    preview.setInput('THROTTLE_1', 12);
    expect(preview.state.value!.inputs.get('THROTTLE_1')).toBe(8);
    preview.setInput('THROTTLE_1', Number.NaN);
    expect(preview.state.value!.inputs.get('THROTTLE_1')).toBe(0);
    preview.setInput('NO_SUCH_1', 1);
    expect(preview.state.value!.inputs.has('NO_SUCH_1')).toBe(false);
  });

  it('puts the reverser in neutral at rest and turns it half its swing either way', () => {
    const { preview, view } = setUp('shunter');
    const reverser = hingeOf(cornersOf(objText('shunter'), 'REVERSER_1_ROT_-60'));
    const point = centreOf(cornersOf(objText('shunter'), 'REVERSER_1_KNOB'));
    expect(turnAbout(view.transforms.get('REVERSER_1_KNOB')!, reverser.centre, reverser.axis, point)).toBeCloseTo(0, 6);
    preview.setInput('REVERSER_1', 1);
    expect(turnAbout(view.transforms.get('REVERSER_1_KNOB')!, reverser.centre, reverser.axis, point)).toBeCloseTo(-30, 3);
    preview.setInput('REVERSER_1', -1);
    expect(turnAbout(view.transforms.get('REVERSER_1_KNOB')!, reverser.centre, reverser.axis, point)).toBeCloseTo(30, 3);
  });
});

describe('the other controls, as the engine moves them', () => {
  /** How far `object` is turned about the hinge of `marker`, degrees. */
  function turned(view: RecordingView, marker: string, object: string): number {
    const hinge = hingeOf(cornersOf(objText('shunter'), marker));
    return turnAbout(view.transforms.get(object)!, hinge.centre, hinge.axis, centreOf(cornersOf(objText('shunter'), object)));
  }

  it('turns a gauge’s needle by its reading through RANGE: the speedometer at half its 0…1.5', () => {
    const { preview, view } = setUp('shunter');
    preview.setInput('GAUGE_SPEED_1', 0.75);
    expect(turned(view, 'GAUGE_SPEED_1_ROT_-240', 'GAUGE_SPEED_1_NEEDLE_RANGE_0_1.5')).toBeCloseTo(-120, 3);
    preview.setInput('GAUGE_SPEED_1', 1.5);
    expect(Math.abs(turned(view, 'GAUGE_SPEED_1_ROT_-240', 'GAUGE_SPEED_1_NEEDLE_RANGE_0_1.5'))).toBeCloseTo(120, 3); // −240° is +120°
  });

  it('turns a switch by OFFSET: half its swing back while off, half forward while on', () => {
    const { preview, view } = setUp('shunter');
    const knob = 'WIDGET_1_TOGGLE_CG_FHL_OFFSET_-0.5';
    expect(turned(view, 'WIDGET_1_ROT_60', knob)).toBeCloseTo(-30, 3);
    preview.setGroup('FHL', 1);
    expect(turned(view, 'WIDGET_1_ROT_60', knob)).toBeCloseTo(30, 3);
  });

  it('slides an INVERT window full way while its group is 0, and back to rest at 1', () => {
    const { preview, view } = setUp('shunter');
    expect(view.transforms.get('WINDOW_1_HANDLE')![13]).toBeCloseTo(0.8, 6);
    expect(view.transforms.get('WINDOW_1_INVERT_TL_0.8_Y')![13]).toBeCloseTo(0.8, 6);
    preview.setInput('WINDOW_1', 1);
    expect(list(view.transforms.get('WINDOW_1_HANDLE'))).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });
});

describe('the coupler heads', () => {
  it('show the free head at a free end and the coupled one at a coupled end; the plain head always', () => {
    const { preview, view } = setUp('coach');
    const at = (end: 'FRONT' | 'REAR'): boolean[] =>
      [`COUPLED_${end}_1`, `COUPLED_${end}_2_HIDE`, `COUPLED_${end}_3_HIDE_INVERT`].map((object) => view.visible.get(object)!);
    expect(at('FRONT')).toEqual([true, true, false]);
    expect(at('REAR')).toEqual([true, true, false]);
    preview.setCoupled(true, true);
    expect(at('FRONT')).toEqual([true, false, true]);
    expect(at('REAR')).toEqual([true, true, false]);
    preview.setCoupled(false, true);
    expect(at('REAR')).toEqual([true, false, true]);
    preview.setCoupled(true, false);
    expect(at('FRONT')).toEqual([true, true, false]);
  });
});

describe('the livery', () => {
  const body = assetPath('stock/coach/coach_body.png');
  const door = assetPath('stock/coach/coach_door.png');
  const roof = assetPath('stock/coach/coach_roof.png');
  const blueBody = assetPath('stock/coach/l_blue/coach_body.png');
  const blueDoor = assetPath('stock/coach/l_blue/coach_door.png');

  /** The path of a stand-in bitmap (model/testing.node `fakeBitmap`), or what the view holds instead. */
  const pathOf = (bitmap: ImageBitmap | null | undefined): string | null | undefined => (bitmap === null || bitmap === undefined ? bitmap : (bitmap as unknown as { path: string }).path);

  it('decodes the livery’s pictures once, then has the view draw the base textures with them, and back, never showing the model anew', async () => {
    const asked: string[][] = [];
    const { preview, view } = setUp('coach', handTicker(), await exampleSubject('coach', asked));
    const model = preview.subject.value!.model;
    preview.setLivery('blue');
    expect(asked).toEqual([[blueBody, blueDoor]]);
    await vi.waitFor(() => expect(view.textures.size).toBe(2));
    expect(pathOf(view.textures.get(body))).toBe(blueBody);
    expect(pathOf(view.textures.get(door))).toBe(blueDoor);
    expect(view.textures.has(roof)).toBe(false);

    preview.setLivery(null);
    expect(view.textures.get(body)).toBe(model.textures[body]);
    expect(view.textures.get(door)).toBe(model.textures[door]);
    view.clearCalls();
    preview.setLivery('blue');
    // the pictures are here already: two textures swapped, and nothing else told
    expect(view.calls).toEqual([
      { method: 'setTexture', object: body },
      { method: 'setTexture', object: door },
    ]);
    expect(asked).toHaveLength(1);
    expect(view.shown).toHaveLength(1);
  });

  it('keeps what the view was told when the livery changes: doors, couplers and controls stay where they are', async () => {
    const { preview, view } = setUp('coach', handTicker(), await exampleSubject('coach'));
    preview.setDoor(SALON_DOOR, 0.5);
    preview.setCoupled(true, true);
    view.clearCalls();
    preview.setLivery('blue');
    await vi.waitFor(() => expect(view.textures.size).toBe(2));
    expect(view.calls.map((call) => call.method)).toEqual(['setTexture', 'setTexture']);
    expect(list(view.transforms.get('SALON_DOOR_KNOB'))).toEqual(transposed(framesAt(salonTracks, 0.5).get('SALON_DOOR_KNOB')!));
    expect(view.visible.get('COUPLED_FRONT_3_HIDE_INVERT')).toBe(true);
    expect(view.transforms.has('HANDBRAKE_1_HANDWHEEL')).toBe(true);
  });

  it('keeps the view as it is while the pictures come, and drops them for another model', async () => {
    let answer: (bitmaps: Record<string, ImageBitmap | null>) => void = () => undefined;
    const slow: PreviewSubject = { ...subjects.coach, textures: () => new Promise((resolve) => (answer = resolve)) };
    const { preview, view } = setUp('coach', handTicker(), slow);
    preview.setLivery('blue');
    preview.setDoor(SALON_DOOR, 1);
    expect(view.textures.size).toBe(0);
    expect(view.transforms.has('SALON_DOOR_KNOB')).toBe(true);
    // the model read anew (an edit of its files): another model, though of the same files
    preview.load({ ...subjects.coach, model: { ...subjects.coach.model } });
    answer({});
    await Promise.resolve();
    expect(view.textures.size).toBe(0);
    expect(view.shown).toHaveLength(1);
  });

  it('shows a livery picture that can’t be decoded as missing, and takes no livery the model does not have', async () => {
    const failing: PreviewSubject = { ...subjects.coach, textures: () => Promise.reject(new Error('no worker')) };
    const { preview, view } = setUp('coach', handTicker(), failing);
    preview.setLivery('red');
    expect(preview.state.value!.livery).toBeNull();
    expect(view.textures.size).toBe(0);
    preview.setLivery('blue');
    await vi.waitFor(() => expect(view.textures.size).toBe(2));
    expect(view.textures.get(body)).toBeNull();
  });
});

describe('the lights', () => {
  it('light a group’s objects while its group is on, its LINVERT ones while it is off', () => {
    const { preview, view } = setUp('shunter');
    expect(view.lit.get('HEADLIGHT_1_LCG_FHL_0XFFF2CC')).toBe(false);
    expect(view.lit.get('IND_LAMP_FULLBRIGHT_LCG_FHL_LINVERT')).toBe(true);
    preview.setGroup('FHL', 1);
    expect(view.lit.get('HEADLIGHT_1_LCG_FHL_0XFFF2CC')).toBe(true);
    expect(view.lit.get('IND_LAMP_FULLBRIGHT_LCG_FHL_LINVERT')).toBe(false);
    expect(view.lit.get('HEADLIGHT_2_LCG_RHL_0XFFF2CC')).toBe(false);
  });

  it('draws the shining headlights and cabin lamps in the preview’s overlay layer', () => {
    const { preview, view } = setUp('shunter');
    expect(view.overlays.get(LIGHTS_LAYER)).toEqual([]);
    preview.setGroup('FHL', 1);
    preview.setGroup('IL', 1);
    const shapes = view.overlays.get(LIGHTS_LAYER)!;
    expect(shapes.map((s) => s.style)).toEqual([LAMP_STYLE, HEADLIGHT_STYLE]);
    const beam = shapes[1]!;
    if (beam.shape !== 'arrow') throw new Error('a headlight is an arrow');
    expect(beam.to[0]).toBeLessThan(beam.from[0]); // the front headlight shines to the front, −X
  });

  it('moves the switches of a group with it, and shows a HIDE widget only while its group is not 1', () => {
    const { preview, view } = setUp('shunter');
    const cover = 'WIDGET_7_CG_FHL_HIDE_NOTOUCH';
    expect(view.visible.get(cover)).toBe(true);
    const before = list(view.transforms.get('WIDGET_1_TOGGLE_CG_FHL_OFFSET_-0.5'));
    preview.setInput('WIDGET_1', 1); // the switch of group FHL
    expect(preview.state.value!.groups.get('FHL')).toBe(1);
    expect(view.visible.get(cover)).toBe(false);
    expect(view.lit.get('HEADLIGHT_1_LCG_FHL_0XFFF2CC')).toBe(true);
    expect(list(view.transforms.get('WIDGET_1_TOGGLE_CG_FHL_OFFSET_-0.5'))).not.toEqual(before);
  });

  it('switches the view to its light display on request', () => {
    const { preview, view } = setUp('shunter');
    preview.showLight();
    expect(view.display).toBe('lit');
  });
});

describe('the preview as a whole', () => {
  it('starts every model over: doors shut, controls at rest, groups off, ends free, base livery', () => {
    const { preview } = setUp('coach');
    preview.setDoor(0, 1);
    preview.setGroup('IL', 1);
    preview.setLivery('blue');
    preview.reset();
    const state = preview.state.value!;
    expect(state.doors.every((d) => d === 0)).toBe(true);
    expect(state.groups.size).toBe(0);
    expect(state.livery).toBeNull();
    expect(state.inputs.get('HANDBRAKE_1')).toBe(0);
  });

  it('keeps its state when the model comes again with its type edited: each door by its id, the controls, groups and livery', () => {
    const ticker = handTicker();
    const { preview, view } = setUp('coach', ticker);
    preview.setDoor(0, 1); // door_fl open
    preview.toggleDoor(2); // door_rl opening
    preview.tick();
    preview.setGroup('IL', 1);
    preview.setLivery('blue');
    const swinging = preview.state.value!.doors[2];
    const leaf = list(view.transforms.get('DOOR_1_TL_0.95_X'));
    // door_fl moved to the end of the list, a door added before the rest: the indices change, the ids stay
    const json = JSON.parse(packText('data/rwat_example/wagon_types/coach.json')) as { doors: { id: string }[] };
    json.doors.push(json.doors.shift()!);
    json.doors.unshift({ ...json.doors[0]!, id: 'added' });
    view.clearCalls();
    preview.load({ ...subjects.coach, type: parseWagonType('rwat_example:coach', json) });
    const state = preview.state.value!;
    expect(state.doors).toEqual([0, 0, swinging, 0, 0, 0, 0, 0, 1]);
    expect(state.heading[2]).toBe(1);
    expect(ticker.running).toBe(1);
    expect(state.groups.get('IL')).toBe(1);
    expect(state.livery).toBe('blue');
    // the view is not shown the model anew, nor told again what stands where it stood
    expect(view.shown).toHaveLength(1);
    expect(list(view.transforms.get('DOOR_1_TL_0.95_X'))).toEqual(leaf);
    expect(view.calls.filter((call) => call.object === 'DOOR_1_TL_0.95_X')).toEqual([]);
    // another model starts over
    preview.load(subjects.shunter);
    expect(preview.state.value!.doors).toEqual([0, 0]);
    expect(ticker.running).toBe(0);
  });

  it('tells a new view everything, and nothing when there is no model or no view', () => {
    const preview = new PreviewController(handTicker());
    controllers.push(preview);
    const first = recordingView();
    preview.view.value = first;
    expect(first.calls).toEqual([]);
    preview.load(subjects.coach);
    expect(first.transforms.size).toBeGreaterThan(0);
    const second = recordingView();
    preview.view.value = second;
    expect([...second.transforms.keys()].sort()).toEqual([...first.transforms.keys()].sort());
    preview.load(null);
    second.clearCalls();
    preview.setDoor(0, 1);
    expect(second.calls).toEqual([]);
    expect(preview.state.value).toBeNull();
  });

  it('ignores doors past the type’s and a toggle without a type', () => {
    const { preview } = setUp('coach');
    preview.setDoor(99, 1);
    expect(preview.state.value!.doors).toHaveLength(8);
    const typeless = new PreviewController(handTicker());
    controllers.push(typeless);
    typeless.load({ ...subjects.coach, type: null });
    typeless.toggleDoor(0);
    expect(typeless.state.value!.doors).toEqual([]);
    expect(typeless.tick()).toBe(false);
  });
});
