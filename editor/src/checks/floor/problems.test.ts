import { afterEach, describe, expect, it } from 'vitest';
import type { FloorFinding } from '../../core/contracts';
import { dump } from '../../core/json';
import { Pack } from '../../core/pack';
import { EXAMPLE_PACK, MemorySource, filesOf, readTree } from '../../core/pack/testing.node';
import { catalog, setLang } from '../../i18n';
import { placeholders } from '../../i18n/catalog';
import { FLOOR_CODES, type FloorCode } from '../../ports/floorCheck';
import { problemMessage } from '../messages';
import { floorCode, floorProblem, floorProblems, typeFloorProblems } from './problems';

afterEach(() => {
  setLang('en');
});

const TYPE = 'data/ns/wagon_types/car.json';

/** A type of one zone and one side door, the floor ending at it: nothing to say. */
function car(): Record<string, unknown> {
  return {
    length: 20.0,
    bogies: [7.0, -7.0],
    mass_t: 40.0,
    interior: [{ min: [-9.0, 1.2, -1.4], max: [9.0, 3.5, 1.4] }],
    doors: [{ id: 'side', min: [-0.5, 1.2, 1.4], max: [0.5, 3.3, 1.46] }],
  };
}

async function packOf(type: unknown): Promise<Pack> {
  return Pack.open(
    new MemorySource(
      filesOf({
        'pack.mcmeta': dump({ pack: { pack_format: 34, description: 'x' }, rwat: { format: 1 } }),
        [TYPE]: dump(type),
      }),
    ),
  );
}

/** The params each code's line is made of, and the subject's index where it has one. */
function paramsOf(code: FloorCode): string[] {
  const finding = (index: number, params: Record<string, number | string | number[]>): string[] => [
    ...(index >= 0 ? ['index'] : []),
    ...Object.keys(params),
  ];
  switch (code) {
    case 'SEATS_WITHOUT_INTERIOR':
    case 'CAB_WITHOUT_SEAT':
      return finding(-1, {});
    case 'FLOOR_TOO_NARROW':
      return finding(-1, { player_width: 0 });
    case 'ZONE_TOO_NARROW':
      return finding(0, { size_x: 0, size_z: 0, player_width: 0 });
    case 'DOOR_TOO_THICK':
      return finding(0, { id: '', thickness: 0 });
    case 'DOOR_NOT_AT_FLOOR_END':
      return finding(0, { id: '', slack: 0 });
    case 'ZONES_UNREACHABLE':
      return finding(-1, { zones: [] });
    case 'SEAT_NOT_SITTABLE':
      return finding(0, { x: 0, y: 0, z: 0, reach: 0, sit_reach: 0, height: 0, min_height: 0, max_height: 0 });
    default:
      return finding(0, { id: '' });
  }
}

describe('the floor check in the checks', () => {
  it('has a line in both languages for each of the 13 codes, made of the params the engine line is made of', () => {
    const codes = Object.keys(FLOOR_CODES) as FloorCode[];
    expect(codes).toHaveLength(13);
    for (const code of codes) {
      for (const lang of ['ru', 'en'] as const) {
        const line = catalog.get(lang, `problem.floor.${floorCode(code)}`);
        expect(line, `${lang} ${code}`).toBeTypeOf('string');
        expect(placeholders(line!).sort(), `${lang} ${code}`).toEqual(paramsOf(code).sort());
      }
    }
  });

  it('finds nothing in the example pack', async () => {
    const pack = await Pack.open(new MemorySource(readTree(EXAMPLE_PACK)));
    expect(floorProblems(pack)).toEqual([]);
  });

  it('says what the engine says, translated, with a link to the door in the file and to the door itself', async () => {
    const type = car();
    (type.doors as { min: number[]; max: number[] }[])[0]!.min[2] = 1.9; // off the side wall, 0.5 out
    (type.doors as { min: number[]; max: number[] }[])[0]!.max[2] = 1.96;
    const pack = await packOf(type);
    const problems = floorProblems(pack);
    expect(problems).toHaveLength(1);
    const [problem] = problems;
    expect(problem).toMatchObject({
      severity: 'warning',
      source: 'floor',
      code: 'floor.door-not-at-floor-end',
      params: { index: 0, id: 'side', slack: '0.4' },
      at: [
        { kind: 'field', file: TYPE, at: '/doors/0' },
        { kind: 'door', type: 'ns:car', index: 0 },
      ],
    });
    expect(problem!.text).toBe(
      "door 0 'side' isn't where the floor ends: nobody can walk through it (a player must fit in front of it, inside its span, with the floor ending within 0.4 of its inner face)",
    );
    expect(problemMessage(problem!)).toBe(
      "door 0 “side” isn't where the floor ends: nobody can walk through it (a player must fit in front of it, inside its span, with the floor ending within 0.4 of its inner face)",
    );
    setLang('ru');
    expect(problemMessage(problem!)).toBe(
      'дверь 0 «side» не там, где кончается пол: через неё не выйти (перед ней, в её пролёте, должен помещаться игрок, а пол — кончаться не дальше 0.4 от её внутренней грани)',
    );
  });

  it('writes the numbers as the engine line does and points at a zone, a chair and the zones cut off', async () => {
    const type = car();
    type.interior = [
      { min: [-9.0, 1.2, -1.4], max: [9.0, 3.5, 1.4] },
      { min: [-9.0, 1.2, 2.0], max: [-8.6, 3.5, 2.3] }, // too narrow, and cut off
      { min: [5.0, 1.2, 3.0], max: [8.0, 3.5, 4.0] }, // cut off
    ];
    type.cab = { seats: [{ at: [1.0, 5.0, 0.0], yaw: 0 }] };
    const problems = floorProblems(await packOf(type));
    expect(problems.map((p) => [p.code, p.params, p.at])).toEqual([
      [
        'floor.zone-too-narrow',
        { index: 1, size_x: '0.40', size_z: '0.30', player_width: '0.6' },
        [
          { kind: 'field', file: TYPE, at: '/interior/1' },
          { kind: 'zone', type: 'ns:car', index: 1 },
        ],
      ],
      [
        'floor.zones-unreachable',
        { zones: [2] },
        [
          { kind: 'field', file: TYPE, at: '/interior/2' },
          { kind: 'zone', type: 'ns:car', index: 2 },
        ],
      ],
      [
        'floor.seat-not-sittable',
        {
          index: 0,
          x: '1.00',
          y: '5.00',
          z: '0.00',
          reach: '0.00',
          sit_reach: '2.5',
          height: '3.80',
          min_height: '0.2',
          max_height: '1.5',
        },
        [
          { kind: 'field', file: TYPE, at: '/cab/seats/0' },
          { kind: 'seat', type: 'ns:car', index: 0 },
        ],
      ],
    ]);
    setLang('ru');
    expect(problemMessage(problems[1]!)).toBe(
      'до зон пола 2 не дойти ни из зоны 0, ни от входа: соедините их (касающиеся зоны соединены), поставьте между ними внутреннюю дверь или дайте им дверь наружу',
    );
  });

  it('points a chair of the older one-chair form at cab.seat, and a cab or a floor as a whole at its section', () => {
    const finding = (code: FloorCode, index: number): FloorFinding => ({ code, subject: FLOOR_CODES[code], index, params: {}, text: '' });
    const old = { cab: { seat: [0, 0, 0] } };
    expect(floorProblem(finding('SEAT_NOT_SITTABLE', 0), 'ns:car', TYPE, old).at[0]).toEqual({ kind: 'field', file: TYPE, at: '/cab/seat' });
    expect(floorProblem(finding('SEATS_WITHOUT_INTERIOR', -1), 'ns:car', TYPE, old).at).toEqual([{ kind: 'field', file: TYPE, at: '/cab/seat' }]);
    expect(floorProblem(finding('SEATS_WITHOUT_INTERIOR', -1), 'ns:car', TYPE, { cab: { seats: [] } }).at).toEqual([{ kind: 'field', file: TYPE, at: '/cab/seats' }]);
    expect(floorProblem(finding('CAB_WITHOUT_SEAT', -1), 'ns:car', TYPE, {}).at).toEqual([{ kind: 'field', file: TYPE, at: '/cab' }]);
    expect(floorProblem(finding('FLOOR_TOO_NARROW', -1), 'ns:car', TYPE, {}).at).toEqual([{ kind: 'field', file: TYPE, at: '/interior' }]);
  });

  it('checks nothing of a type that does not load, and checks a type again only once its value changes', () => {
    expect(typeFloorProblems('ns:car', TYPE, { length: 0 })).toEqual([]);
    expect(typeFloorProblems('ns:car', TYPE, 'no object')).toEqual([]);
    const type = car();
    (type.interior as { max: number[] }[])[0]!.max[2] = -1.2; // 0.2 across
    const first = typeFloorProblems('ns:car', TYPE, type);
    expect(first.map((p) => p.code)).toContain('floor.floor-too-narrow');
    expect(typeFloorProblems('ns:car', TYPE, type)).toBe(first);
    expect(typeFloorProblems('ns:car', TYPE, { ...type })).not.toBe(first);
  });
});
