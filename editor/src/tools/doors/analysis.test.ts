import { describe, expect, it } from 'vitest';
import type { OverlayShape } from '../../core/contracts';
import { exampleModel } from '../../model/testing.node';
import { loadWagonType } from '../../ports/wagonType';
import { OVERLAY_STYLES } from '../../view3d/overlays';
import { openExamplePack } from '../testing.node';
import { bridgeReach, DOORS_LAYERS, doorsPicture, moversOfDoor } from './analysis';

const COACH = 'rwat_example:coach';
const SHUNTER = 'rwat_example:shunter';
const COACH_FILE = 'data/rwat_example/wagon_types/coach.json';
const SHUNTER_FILE = 'data/rwat_example/wagon_types/shunter.json';
const coachModel = await exampleModel('coach');
const shunterModel = await exampleModel('shunter');

interface TypeJson {
  doors: { id: string; min: number[]; max: number[] }[];
}

async function typeJson(file: string): Promise<TypeJson> {
  const { pack } = await openExamplePack();
  return structuredClone(pack.json(file)) as TypeJson;
}

function picture(id: string, json: unknown, model = id === COACH ? coachModel : shunterModel) {
  return doorsPicture(id, json, loadWagonType(id, json).type, model);
}

const styles = (shapes: readonly OverlayShape[]) => shapes.map((s) => s.style);

describe('the coach’s doors drawn', () => {
  it('have a box, an arrow out and an inner face each, in styles the view knows', async () => {
    const p = picture(COACH, await typeJson(COACH_FILE));
    expect(p.doors).toHaveLength(8);
    expect(styles(p.layers['doors.boxes'])).toEqual(['door', 'door', 'door', 'door', 'door', 'door', 'door-inner', 'door-inner']);
    expect(p.layers['doors.axes']).toHaveLength(8);
    expect(p.layers['doors.faces']).toHaveLength(8);
    for (const layer of DOORS_LAYERS) for (const shape of p.layers[layer]) expect(OVERLAY_STYLES).toHaveProperty(shape.style);
    expect(p.layers['doors.boxes'][0]).toEqual({ shape: 'box', min: [-9.25, 1.15, 1.45], max: [-8.25, 3.3, 1.51], style: 'door', link: { kind: 'door', type: COACH, index: 0 } });
  });

  it('say the wall and the way out as the engine reads the box', async () => {
    const p = picture(COACH, await typeJson(COACH_FILE));
    expect(p.doors.map((d) => [d.entry.id, d.wall, d.out])).toEqual([
      ['door_fl', 'side', 'left'],
      ['door_fr', 'side', 'right'],
      ['door_rl', 'side', 'left'],
      ['door_rr', 'side', 'right'],
      ['gangway_front', 'end', 'front'],
      ['gangway_rear', 'end', 'rear'],
      ['salon_door', 'end', 'front'],
      ['salon_arch', 'end', 'rear'],
    ]);
    expect(p.doors[0]?.thickness).toBeCloseTo(0.06, 9);
    expect(p.doors[0]?.width).toBeCloseTo(1, 9);
    // the left front door's arrow: from its inner face (z 1.45) out through the leaf, past its outer face (1.51) by 0.6
    const arrow = p.layers['doors.axes'][0];
    if (arrow?.shape !== 'arrow') throw new Error('no arrow');
    expect(arrow.from[2]).toBeCloseTo(1.45, 9);
    expect(arrow.to[2]).toBeCloseTo(2.11, 9);
    expect(arrow.from[0]).toBeCloseTo(-8.75, 9);
    // the front gangway's arrow points to −x, the front
    const gangway = p.layers['doors.axes'][4];
    if (gangway?.shape !== 'arrow') throw new Error('no arrow');
    expect(gangway.to[0]).toBeLessThan(gangway.from[0]);
    // its inner face is the one towards the car's middle: x −9.62
    const face = p.layers['doors.faces'][4];
    if (face?.shape !== 'polygon') throw new Error('no face');
    for (const point of face.points) expect(point[0]).toBeCloseTo(-9.62, 9);
  });

  it('show where riders walk out of the hull and gangway doors, and the inner doors’ bridges on the floor', async () => {
    const p = picture(COACH, await typeJson(COACH_FILE));
    expect(p.layers['doors.spans']).toHaveLength(6);
    // in front of door_fl's inner face, a body's half-width deep, its span less 0.1 at each end, at its foot
    expect(p.layers['doors.spans'][0]).toMatchObject({ shape: 'rect', style: 'exit', link: { kind: 'door', index: 0 } });
    const span = p.layers['doors.spans'][0];
    if (span?.shape !== 'rect') throw new Error('no span');
    expect(span.min.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([-9.15, 1.15, 1.15]);
    expect(span.max.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([-8.35, 1.15, 1.45]);
    expect(styles(p.layers['doors.bridges'])).toEqual(['bridge', 'bridge']);
    expect(p.doors.map((d) => d.bridge)).toEqual([null, null, null, null, null, null, 'both', 'both']);
    expect(p.layers['doors.zones']).toHaveLength(4);
  });

  it('show which door moves each leaf and animated piece', async () => {
    const p = picture(COACH, await typeJson(COACH_FILE));
    expect(p.movers.map((m) => [m.name, m.kind, m.door])).toEqual([
      ['DOOR_1', 'leaf', 0],
      ['DOOR_2', 'leaf', 1],
      ['DOOR_3', 'leaf', 2],
      ['DOOR_4', 'leaf', 3],
      ['DOOR_5', 'leaf', 4],
      ['DOOR_6', 'leaf', 5],
      ['salon_door', 'anim', 6],
    ]);
    expect(moversOfDoor(p, 0)[0]?.objects).toEqual(['DOOR_1_TL_0.95_X', 'DOOR_1_HANDLE']);
    expect(moversOfDoor(p, 7)).toEqual([]);
    // a point a leaf, one each piece of the animation
    expect(p.layers['doors.leaves']).toHaveLength(8);
    expect(new Set(styles(p.layers['doors.leaves']))).toEqual(new Set(['doors.leaf']));
    expect(p.layers['doors.leaves'].map((s) => (s.link?.kind === 'door' ? s.link.index : -1))).toEqual([0, 1, 2, 3, 4, 5, 6, 6]);
  });
});

describe('a broken doorway drawn', () => {
  it('shows the arch moved off the aisle: its bridge reaches the floor on one side only (FloorCheck finds nothing)', async () => {
    const json = await typeJson(COACH_FILE);
    const arch = json.doors[7] as TypeJson['doors'][number];
    // ExamplePackLoadTest.coachBreaks "salon_arch off the aisle": a block aside along z
    arch.min[2] = (arch.min[2] as number) + 1;
    arch.max[2] = (arch.max[2] as number) + 1;
    const p = picture(COACH, json);
    expect(p.doors[7]?.bridge).toBe('one');
    expect(styles(p.layers['doors.bridges'])).toEqual(['bridge', 'warning']);
    const type = loadWagonType(COACH, json).type;
    if (type === null) throw new Error('the type does not load');
    expect(bridgeReach(type, 7)).toBe('one');
    expect(bridgeReach(type, 0)).toBeNull();
  });

  it('shows a leaf no door moves in the warning colour, at its object', async () => {
    const json = await typeJson(COACH_FILE);
    // ExamplePackLoadTest.coachLeafBreaks "a door box away from its leaf": door_rl two blocks forward
    const door = json.doors[2] as TypeJson['doors'][number];
    door.min[0] = (door.min[0] as number) - 2;
    door.max[0] = (door.max[0] as number) - 2;
    const p = picture(COACH, json);
    expect(p.movers.find((m) => m.name === 'DOOR_3')?.door).toBe(-1);
    const loose = p.layers['doors.leaves'].filter((s) => s.style === 'warning');
    expect(loose).toHaveLength(1);
    expect(loose[0]?.link).toEqual({ kind: 'object', model: COACH, name: 'DOOR_3_TL_-0.95_X' });
  });

  it('draws the boxes of a type that does not load, without its leaves or bridges’ floor', async () => {
    const json = { ...(await typeJson(COACH_FILE)), length: -1 };
    const p = doorsPicture(COACH, json, null, coachModel);
    expect(p.layers['doors.boxes']).toHaveLength(8);
    expect(p.movers).toEqual([]);
    expect(p.doors[6]?.bridge).toBeNull();
    expect(styles(p.layers['doors.bridges'])).toEqual(['bridge', 'bridge']);
  });

  it('skips a door whose box cannot be read, keeping the others’ indices', () => {
    const p = doorsPicture(COACH, { doors: [{ id: 'a', min: [0, 1], max: [1, 2, 3] }, { id: 'b', min: [0, 1, 1.4], max: [1, 3, 1.46] }] }, null, null);
    expect(p.doors[0]).toMatchObject({ door: null, wall: null });
    expect(p.layers['doors.boxes'].map((s) => s.link)).toEqual([{ kind: 'door', type: COACH, index: 1 }]);
  });
});

describe('the shunter’s doors drawn', () => {
  it('are its two fixed steps in the side walls, walked out of, moving nothing', async () => {
    const p = picture(SHUNTER, await typeJson(SHUNTER_FILE));
    expect(p.doors.map((d) => [d.entry.id, d.entry.fixed, d.wall, d.out])).toEqual([
      ['steps_left', true, 'side', 'left'],
      ['steps_right', true, 'side', 'right'],
    ]);
    expect(styles(p.layers['doors.boxes'])).toEqual(['door', 'door']);
    expect(p.layers['doors.spans']).toHaveLength(2);
    expect(p.layers['doors.bridges']).toEqual([]);
    expect(p.movers).toEqual([]);
    expect(p.layers['doors.leaves']).toEqual([]);
    expect(p.layers['doors.zones']).toHaveLength(2);
  });
});
