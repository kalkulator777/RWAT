import { describe, expect, it } from 'vitest';
import type { OverlayShape } from '../../core/contracts';
import { cabArea } from '../../ports/cabArea';
import { walkablePieces } from '../../ports/floorCheck';
import { toObj } from '../../ports/objFrame';
import { PLAYER_HALF_WIDTH } from '../../ports/riderWalk';
import { loadWagonType, type WagonType } from '../../ports/wagonType';
import { OVERLAY_STYLES } from '../../view3d/overlays';
import { openExamplePack } from '../testing.node';
import { CAB_STYLES } from '../common/styles';
import { FLOOR_LAYERS, floorAt, floorPicture, hatch, openMaskOf, planFromModel } from './analysis';
import { zoneLink, zoneOver } from './zones';

const { pack } = await openExamplePack();
const coachJson = pack.json('data/rwat_example/wagon_types/coach.json') as Record<string, unknown>;
const shunterJson = pack.json('data/rwat_example/wagon_types/shunter.json') as Record<string, unknown>;
const COACH = 'rwat_example:coach';
const SHUNTER = 'rwat_example:shunter';

function typeOf(json: unknown): WagonType {
  const loaded = loadWagonType('t:t', json);
  if (loaded.type === null) throw new Error(loaded.error ?? 'no type');
  return loaded.type;
}

function rects(shapes: readonly OverlayShape[]): Extract<OverlayShape, { shape: 'rect' }>[] {
  return shapes.filter((s): s is Extract<OverlayShape, { shape: 'rect' }> => s.shape === 'rect');
}

describe('the frames of the floor picture', () => {
  it('turn a box of the model plan back into the OBJ plan', () => {
    // the model's x is the OBJ's z; the model's z is the OBJ's −x
    expect(planFromModel(-0.25, 7.5, 0.25, 9.3)).toEqual({ minX: -9.3, minZ: -0.25, maxX: -7.5, maxZ: 0.25 });
    const [x, , z] = toObj(0.25, 0, 9.3);
    expect([x, z]).toEqual([-9.3, 0.25]);
  });

  it('stand on the highest zone over a point, else the lowest', () => {
    const zones = [zoneOver({ minX: 0, minZ: 0, maxX: 2, maxZ: 2 }, 1), zoneOver({ minX: 1, minZ: 0, maxX: 3, maxZ: 2 }, 1.5), null];
    expect(floorAt(zones, 1.5, 1)).toBe(1.5);
    expect(floorAt(zones, 0.5, 1)).toBe(1);
    expect(floorAt(zones, 9, 9)).toBe(1);
    expect(floorAt([], 0, 0)).toBe(0);
  });

  it('open no door, every door, or the preview’s', () => {
    expect(openMaskOf('closed', 8, 0b11)).toBe(0);
    expect(openMaskOf('open', 8, 0)).toBe(0xff);
    expect(openMaskOf('open', 40, 0)).toBe(-1);
    expect(openMaskOf('preview', 8, 0b100)).toBe(0b100);
    expect(openMaskOf('preview', 8, null)).toBe(0);
  });
});

describe('the floor picture of the example coach', () => {
  const type = typeOf(coachJson);

  it('draws the zones with their links, and the pieces a centre stands on, from the ports', () => {
    const picture = floorPicture(COACH, coachJson, type, 'closed', null);
    expect(picture.findings).toEqual([]);
    expect(picture.layers['floor.zones'].map((s) => s.link)).toEqual([0, 1, 2, 3].map((i) => zoneLink(COACH, i)));
    expect(picture.layers['floor.zones'][1]).toMatchObject({ shape: 'rect', min: [-7.8, 1.3, -0.55], max: [7.8, 1.3, 0.55], style: 'zone' });
    const region = type.interior?.region(PLAYER_HALF_WIDTH, type.doors, 0);
    expect(picture.pieces).toBe(region?.pieces.length);
    const piece = region?.pieces[0];
    if (piece === undefined) throw new Error('no piece');
    const plan = planFromModel(piece.minX, piece.minZ, piece.maxX, piece.maxZ);
    expect(rects(picture.layers['floor.pieces'])[0]).toMatchObject({ min: [plan.minX, 1.15, plan.minZ], max: [plan.maxX, 1.15, plan.maxZ], style: 'piece' });
    // every style the picture draws is one of the view's
    for (const layer of FLOOR_LAYERS) for (const shape of picture.layers[layer]) expect(OVERLAY_STYLES).toHaveProperty(shape.style);
  });

  it('cuts the floor at the shut salon door and bridges the arch, always open; open, the door is a bridge too', () => {
    const shut = floorPicture(COACH, coachJson, type, 'closed', null);
    expect(shut.layers['floor.cuts'].map((s) => s.link)).toEqual([{ kind: 'door', type: COACH, index: 6 }]);
    expect(shut.layers['floor.bridges'].map((s) => s.link)).toEqual([{ kind: 'door', type: COACH, index: 7 }]);
    const open = floorPicture(COACH, coachJson, type, 'open', null);
    expect(open.layers['floor.cuts']).toEqual([]);
    expect(open.layers['floor.bridges'].map((s) => s.link)).toEqual([6, 7].map((index) => ({ kind: 'door', type: COACH, index })));
    // as previewed: the salon door opened alone
    const previewed = floorPicture(COACH, coachJson, type, 'preview', 1 << 6);
    expect(previewed.openMask).toBe(1 << 6);
    expect(previewed.layers['floor.cuts']).toEqual([]);
  });

  it('marks, for each hull and gangway door, the pieces walked out from, with an arrow to the door', () => {
    const picture = floorPicture(COACH, coachJson, type, 'closed', null);
    const region = type.interior?.region(PLAYER_HALF_WIDTH, type.doors, 0);
    if (region === undefined) throw new Error('no region');
    type.doors.forEach((door, d) => {
      const mine = picture.layers['floor.exits'].filter((s) => s.link?.kind === 'door' && s.link.index === d);
      if (door.inner) {
        expect(mine).toEqual([]);
        return;
      }
      expect(rects(mine)).toHaveLength(walkablePieces(door, region).length);
      const arrow = mine.find((s) => s.shape === 'arrow');
      if (arrow?.shape !== 'arrow') throw new Error(`no arrow to door ${d}`);
      const foot = toObj((door.minX + door.maxX) / 2, door.minY, (door.minZ + door.maxZ) / 2);
      expect(arrow.to[0]).toBeCloseTo(foot[0], 9);
      expect(arrow.to[2]).toBeCloseTo(foot[2], 9);
    });
  });

  it('warns of a zone with no room for a player, and hatches the zones nobody walks to', () => {
    const narrow = { ...coachJson, interior: [...(coachJson.interior as unknown[]), { min: [3, 1.3, 0.55], max: [3.4, 3.8, 0.95] }] };
    const picture = floorPicture(COACH, narrow, typeOf(narrow), 'closed', null);
    expect(picture.findings.map((f) => f.code)).toEqual(['ZONE_TOO_NARROW']);
    expect(picture.layers['floor.zones'][4]?.style).toBe('warning');

    const apart = { ...coachJson, interior: [...(coachJson.interior as unknown[]), { min: [3, 1.3, 0.75], max: [4, 3.8, 1.4] }] };
    const away = floorPicture(COACH, apart, typeOf(apart), 'closed', null);
    expect(away.findings.map((f) => f.code)).toEqual(['ZONES_UNREACHABLE']);
    expect(away.unreachable).toEqual([4]);
    const marks = away.layers['floor.unreachable'];
    expect(marks[0]).toMatchObject({ shape: 'rect', style: 'unreachable', min: [3, 1.3, 0.75], max: [4, 1.3, 1.4] });
    expect(marks.length).toBeGreaterThan(3);
    expect(marks.slice(1).every((s) => s.shape === 'polygon' && s.style === 'unreachable')).toBe(true);
  });

  it('draws the zones alone while the type does not load', () => {
    const picture = floorPicture(COACH, coachJson, null, 'closed', null);
    expect(picture.layers['floor.zones']).toHaveLength(4);
    expect(picture.pieces).toBe(0);
    for (const layer of FLOOR_LAYERS) if (layer !== 'floor.zones') expect(picture.layers[layer]).toEqual([]);
  });
});

describe('the cabs of the floor picture', () => {
  it('shade the shunter’s one cab, all its floor', () => {
    const type = typeOf(shunterJson);
    const picture = floorPicture(SHUNTER, shunterJson, type, 'closed', null);
    expect(picture.cabs).toBe(1);
    const area = cabArea(type);
    expect(picture.layers['floor.cabs']).toHaveLength(area.cabOfPiece.filter((cab) => cab >= 0).length);
    expect(new Set(picture.layers['floor.cabs'].map((s) => s.style))).toEqual(new Set(['cab']));
  });

  it('give two cabs apart shades of their own', () => {
    const json = {
      ...shunterJson,
      interior: [
        { min: [-6, 1.6, -1.4], max: [-4, 3.9, 1.4] },
        { min: [4, 1.6, -1.4], max: [6, 3.9, 1.4] },
      ],
      cab: { seats: [{ at: [-5, 2.1, 0] }, { at: [5, 2.1, 0], yaw: 180 }] },
      doors: [],
    };
    const picture = floorPicture(SHUNTER, json, typeOf(json), 'closed', null);
    expect(picture.cabs).toBe(2);
    expect(new Set(picture.layers['floor.cabs'].map((s) => s.style))).toEqual(new Set(CAB_STYLES.slice(0, 2)));
  });
});

describe('the hatching', () => {
  it('lies in the zone, stroke by stroke', () => {
    const zone = zoneOver({ minX: 0, minZ: 0, maxX: 2, maxZ: 1 }, 1);
    const strokes = hatch(zone, 'unreachable', zoneLink('a:b', 0));
    expect(strokes.length).toBeGreaterThan(5);
    for (const stroke of strokes) {
      if (stroke.shape !== 'polygon') throw new Error('not a stroke');
      expect(stroke.link).toEqual(zoneLink('a:b', 0));
      for (const [x, y, z] of stroke.points) {
        expect(y).toBe(1);
        expect(x).toBeGreaterThanOrEqual(-0.03);
        expect(x).toBeLessThanOrEqual(2);
        expect(z).toBeGreaterThanOrEqual(-1e-9);
        expect(z).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});
