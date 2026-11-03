import { describe, expect, it } from 'vitest';
import type { OverlayShape } from '../../core/contracts';
import { loadWagonType } from '../../ports/wagonType';
import { OVERLAY_STYLES } from '../../view3d/overlays';
import { openExamplePack } from '../testing.node';
import { analysePlaces, BACK_STYLE, DIAL_RADIUS, drivesBack, FORWARD_STYLE, SEAT_LAYERS, seatsPicture, type SeatsPicture } from './analysis';
import { DRIVER_CHAIRS } from './chairs';
import { facing, normalYaw, yawOf } from './places';

const SHUNTER = 'data/rwat_example/wagon_types/shunter.json';
const COACH = 'data/rwat_example/wagon_types/coach.json';

interface TypeJson {
  cab?: { seats: { at: number[]; yaw?: number }[] };
}

async function json(file: string): Promise<TypeJson> {
  const { pack } = await openExamplePack();
  return structuredClone(pack.json(file)) as TypeJson;
}

function picture(id: string, typeJson: TypeJson, selected: number[] = []): SeatsPicture {
  const type = loadWagonType(id, typeJson).type;
  return seatsPicture(
    id,
    analysePlaces(typeJson, type),
    selected.map((index) => ({ kind: DRIVER_CHAIRS, index })),
  );
}

const styles = (shapes: readonly OverlayShape[]) => shapes.map((s) => s.style);

describe('which way a yaw faces', () => {
  it('0 forward (−X), 90 to the right side (−Z), 180 back; and back from a direction', () => {
    expect(facing(0)).toEqual([-1, 0, 0]);
    expect(facing(90)[2]).toBeCloseTo(-1, 12);
    expect(facing(180)[0]).toBeCloseTo(1, 12);
    expect(yawOf(-1, 0)).toBe(0);
    expect(yawOf(0, -1)).toBe(90);
    expect(yawOf(1, 0)).toBe(180);
    expect(yawOf(1, -0)).toBe(180);
    expect(yawOf(0, 1)).toBe(-90);
    expect([normalYaw(-180), normalYaw(270), normalYaw(-0), normalYaw(540)]).toEqual([180, -90, 0, 180]);
    // the engine's rule: more than 90° off forward drives back; square to the side drives forward
    expect([0, 90, 91, 180, -90, -91, 270, 271].map(drivesBack)).toEqual([false, false, true, true, false, true, false, false]);
  });
});

describe('the chairs drawn over the shunter', () => {
  it('in its cab’s shade, the first driving forward and the second back, sat down in from the floor under them', async () => {
    const p = picture('rwat_example:shunter', await json(SHUNTER));
    expect(p.places.map((v) => [v.ref.index, v.backward, v.facts?.cab, v.facts?.sittable])).toEqual([
      [0, false, 0, true],
      [1, true, 0, true],
    ]);
    expect(p.findings).toEqual([]);
    const chairs = p.layers['seats.chairs'];
    expect(chairs.filter((s) => s.shape === 'circle').map((s) => (s.shape === 'circle' ? s.centre : null))).toEqual([
      [1.65, 2.1, -0.8],
      [2.95, 2.1, 0.8],
    ]);
    expect(new Set(styles(chairs))).toEqual(new Set(['cab']));
    expect(chairs[0]?.link).toEqual({ kind: 'seat', type: 'rwat_example:shunter', index: 0 });
    // the arrows: forward and back, the dial's length
    const arrows = p.layers['seats.facing'];
    expect(styles(arrows)).toEqual([FORWARD_STYLE, BACK_STYLE]);
    const first = arrows[0];
    if (first?.shape !== 'arrow') throw new Error('no arrow');
    expect(first.to[0]).toBeCloseTo(1.65 - DIAL_RADIUS, 12);
    const second = arrows[1];
    if (second?.shape !== 'arrow') throw new Error('no arrow');
    expect(second.to[0]).toBeCloseTo(2.95 + DIAL_RADIUS, 12);
    // where one stands: right under the cushion, on the floor at 1.6; the band of heights over it
    const floor = p.layers['seats.floor'];
    expect(floor.filter((s) => s.shape === 'arrow')).toEqual([]);
    const band = floor.find((s) => s.shape === 'box');
    if (band?.shape !== 'box') throw new Error('no band');
    expect(band.min[1]).toBeCloseTo(1.8, 5);
    expect(band.max[1]).toBeCloseTo(3.1, 5);
    expect(band.style).toBe('reach');
    // with none selected every chair's reach; no dial
    expect(p.layers['seats.reach'].map((s) => (s.shape === 'circle' ? [s.radius, s.centre[1]] : null))).toEqual([
      [2.5, expect.closeTo(1.6, 5)],
      [2.5, expect.closeTo(1.6, 5)],
    ]);
    expect(p.layers['seats.dial']).toEqual([]);
    for (const layer of SEAT_LAYERS) for (const shape of p.layers[layer]) expect(OVERLAY_STYLES).toHaveProperty(shape.style);
  });

  it('a chair selected: its reach alone, and its dial', async () => {
    const p = picture('rwat_example:shunter', await json(SHUNTER), [1]);
    expect(p.layers['seats.reach']).toHaveLength(1);
    expect(p.layers['seats.reach'][0]?.link).toEqual({ kind: 'seat', type: 'rwat_example:shunter', index: 1 });
    const dial = p.layers['seats.dial'];
    expect(dial[0]).toMatchObject({ shape: 'circle', centre: [2.95, 2.1, 0.8], radius: DIAL_RADIUS });
    expect(dial.filter((s) => s.shape === 'point')).toHaveLength(4);
  });

  it('turned the wrong way — "the second chair facing forward", which the floor check cannot see — both arrows say forward', async () => {
    const broken = await json(SHUNTER);
    broken.cab!.seats[1]!.yaw = 0;
    const p = picture('rwat_example:shunter', broken);
    expect(p.findings).toEqual([]);
    expect(styles(p.layers['seats.facing'])).toEqual([FORWARD_STYLE, FORWARD_STYLE]);
    expect(p.places.map((v) => v.backward)).toEqual([false, false]);
  });

  it('too high to sit down in: the floor check’s finding, the chair and its band in the warning colour', async () => {
    const broken = await json(SHUNTER);
    broken.cab!.seats[0]!.at[1]! += 1.2;
    const p = picture('rwat_example:shunter', broken);
    expect(p.findings.map((f) => [f.code, f.index])).toEqual([['SEAT_NOT_SITTABLE', 0]]);
    expect(p.places[0]?.facts?.sittable).toBe(false);
    expect(styles(p.layers['seats.chairs']).slice(0, 2)).toEqual(['warning', 'warning']);
    const band = p.layers['seats.floor'].find((s) => s.shape === 'box' && s.link?.kind === 'seat' && s.link.index === 0);
    expect(band?.style).toBe('warning');
  });

  it('out of reach: the way to the nearest floor drawn as an arrow', async () => {
    const broken = await json(SHUNTER);
    broken.cab!.seats[0]!.at = [-3, 3.3, 0];
    const p = picture('rwat_example:shunter', broken);
    expect(p.findings.map((f) => f.code)).toEqual(['SEAT_NOT_SITTABLE']);
    const way = p.layers['seats.floor'].find((s) => s.shape === 'arrow');
    if (way?.shape !== 'arrow') throw new Error('no way');
    expect(way.style).toBe('warning');
    expect(way.to).toEqual([-3, expect.closeTo(1.6, 5), 0]);
    expect(way.from[0]).toBeCloseTo(1.55, 5);
  });
});

describe('the chairs drawn over the coach', () => {
  it('none: nothing drawn', async () => {
    const p = picture('rwat_example:coach', await json(COACH));
    expect(p.places).toEqual([]);
    for (const layer of SEAT_LAYERS) expect(p.layers[layer]).toEqual([]);
  });

  it('a chair in its salon: in the one cab the whole floor makes with the doors shut, its reach on the salon floor', async () => {
    const coach = await json(COACH);
    coach.cab = { seats: [{ at: [0, 1.8, 0], yaw: 180 }] };
    const p = picture('rwat_example:coach', coach);
    expect(p.places.map((v) => [v.backward, v.facts?.cab, v.facts?.sittable])).toEqual([[true, 0, true]]);
    expect(styles(p.layers['seats.facing'])).toEqual([BACK_STYLE]);
    expect(p.layers['seats.reach'][0]).toMatchObject({ shape: 'circle', radius: 2.5, centre: [0, expect.closeTo(1.3, 5), 0] });
    // the coach has no other chair: its cab wants none more
    expect(p.findings).toEqual([]);
  });

  it('a type that does not load: its chairs drawn as the file has them, with nothing of the engine', async () => {
    const coach = await json(COACH);
    coach.cab = { seats: [{ at: [0, 1.8, 0] }], seat: [0, 0, 0] } as unknown as TypeJson['cab'];
    const p = seatsPicture('rwat_example:coach', analysePlaces(coach, null), []);
    expect(p.places.map((v) => [v.place?.at, v.facts])).toEqual([[[0, 1.8, 0], null]]);
    expect(styles(p.layers['seats.chairs'])).toEqual(['seat', 'seat']);
    expect(p.layers['seats.floor']).toEqual([]);
  });
});
