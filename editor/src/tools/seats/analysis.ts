/**
 * What the chairs tool draws over the model (docs/proposals/editor.md §2.3, §3.9), worked
 * out at every edit by the ports of the engine's own logic:
 *
 * - each place as a disc on its cushion in the shade of its driver's cab (`CabArea`, the
 *   floor tool's shades), with an arrow the way it faces — green for a chair that drives
 *   forward, red for one that drives backward (`Seat.facesBack`): a chair turned the wrong
 *   way is a break the floor check cannot see (`ExamplePackLoadTest`, "the second chair
 *   facing forward"), so the drawing shows it;
 * - where one stands to sit down: the nearest point of the floor a player's centre fits
 *   on, an arrow from there to under the cushion, and the band of heights over that floor
 *   the cushion must be in (`FloorCheck`: 0.2…1.5) — in the warning colour when the floor
 *   check finds the chair can't be sat down in (`SEAT_NOT_SITTABLE`);
 * - the sitting reach (2.5 around it, on the floor) of the selected places, of all when none is;
 * - the selected place's dial: a ring its arrow's head is dragged round on.
 *
 * Every shape is in the OBJ frame and carries its place's link. Pure: no DOM, no signals.
 */

import type { FloorFinding, Link, OverlayShape, Vec3 } from '../../core/contracts';
import { MAX_SEAT_HEIGHT, MIN_SEAT_HEIGHT } from '../../ports/floorCheck';
import { SEAT_REACH } from '../../ports/riderWalk';
import { Seat, type WagonType } from '../../ports/wagonType';
import { CAB_STYLES } from '../floor/analysis';
import { floorFindingsOf } from './chairs';
import { facing, placeLink, PLACE_KINDS, samePlace, type Place, type PlaceFacts, type PlaceKind, type PlaceRef } from './places';

/** The tool's overlay layers, in drawing order. */
export const SEAT_LAYERS = ['seats.reach', 'seats.floor', 'seats.chairs', 'seats.facing', 'seats.dial'] as const;

export type SeatLayer = (typeof SEAT_LAYERS)[number];

/** The radius of a place's disc on its cushion, blocks. */
export const DISC_RADIUS = 0.25;
/** The length of a place's arrow and the radius of its dial: the arrow's head is the dial's handle. */
export const DIAL_RADIUS = 0.6;
/** Half the width of the band of cushion heights. */
const BAND_HALF = 0.04;

/** The overlay styles of the arrows of chairs that drive forward and backward (view3d overlays). */
export const FORWARD_STYLE = 'seats.forward';
export const BACK_STYLE = 'seats.back';

/** The floor check's codes about chairs. */
export const SEAT_CODES: ReadonlySet<string> = new Set(['SEATS_WITHOUT_INTERIOR', 'CAB_WITHOUT_SEAT', 'SEAT_NOT_SITTABLE']);

/** A place as the tool shows it. */
export interface PlaceView {
  readonly ref: PlaceRef;
  /** As the file writes it; null when it cannot be read. */
  readonly place: Place | null;
  /** What the engine makes of it; null while the type does not load. */
  readonly facts: PlaceFacts | null;
  /** For a driver's chair: it drives backward (more than 90° off forward). */
  readonly backward: boolean;
}

/** The places of a type and what the engine makes of them: worked out once a file's value, drawn at every selection. */
export interface PlaceAnalysis {
  /** Every place of every kind, kind by kind, each in the file's order. */
  readonly places: readonly PlaceView[];
  /** What the floor check finds of the chairs and the cab (ports/floorCheck), in the engine's order. */
  readonly findings: readonly FloorFinding[];
}

/** What the tool shows of the open wagon's places. */
export interface SeatsPicture extends PlaceAnalysis {
  readonly layers: Readonly<Record<SeatLayer, OverlayShape[]>>;
}

/** The style of a place's disc: its cab's shade, or the plain chair's without a cab. */
export function discStyle(facts: PlaceFacts | null): string {
  const cab = facts?.cab ?? -1;
  return cab >= 0 ? (CAB_STYLES[cab % CAB_STYLES.length] as string) : 'seat';
}

/** True if a yaw drives backward: more than 90° off forward (`WagonType.Seat.facesBack`). */
export function drivesBack(yaw: number): boolean {
  return new Seat(0, 0, 0, yaw).facesBack();
}

function plus(a: Vec3, b: Vec3, scale: number): Vec3 {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

function emptyLayers(): Record<SeatLayer, OverlayShape[]> {
  return Object.fromEntries(SEAT_LAYERS.map((layer) => [layer, []])) as unknown as Record<SeatLayer, OverlayShape[]>;
}

/**
 * The places of every kind with what the engine makes of them: `typeJson` as the file has
 * it (its places are shown even when the type does not load), `type` as the engine reads
 * it (null: it does not).
 */
export function analysePlaces(typeJson: unknown, type: WagonType | null, kinds: readonly PlaceKind[] = PLACE_KINDS): PlaceAnalysis {
  const places = kinds.flatMap((kind) => {
    const facts = type === null ? [] : kind.facts(type);
    return kind.places(typeJson).map((place, index) => ({
      ref: { kind, index },
      place,
      facts: type === null ? null : (facts[index] ?? null),
      backward: kind.drives && place !== null && drivesBack(place.yaw),
    }));
  });
  const findings = type === null ? [] : floorFindingsOf(type).filter((f) => SEAT_CODES.has(f.code));
  return { places, findings };
}

/** The shapes of one place where one stands to sit down in it: the spot, the way to under the cushion, the band of heights. */
function floorShapes(place: Place, facts: PlaceFacts, link: Link): OverlayShape[] {
  const stand = facts.stand;
  if (stand === null) return [];
  const style = facts.sittable ? 'piece' : 'warning';
  const [x, , z] = place.at;
  const floor = stand[1];
  const shapes: OverlayShape[] = [{ shape: 'point', at: stand, style, link }];
  if (Math.hypot(stand[0] - x, stand[2] - z) > 0.01) shapes.push({ shape: 'arrow', from: stand, to: [x, floor, z], style, link });
  const inBand = facts.height >= MIN_SEAT_HEIGHT && facts.height <= MAX_SEAT_HEIGHT;
  shapes.push({
    shape: 'box',
    min: [x - BAND_HALF, floor + MIN_SEAT_HEIGHT, z - BAND_HALF],
    max: [x + BAND_HALF, floor + MAX_SEAT_HEIGHT, z + BAND_HALF],
    style: inBand ? 'reach' : 'warning',
    link,
  });
  return shapes;
}

/** The picture of the places of wagon `wagon` ({@link analysePlaces}), `selected` the places selected (the last one's dial is drawn). */
export function seatsPicture(wagon: string, analysis: PlaceAnalysis, selected: readonly PlaceRef[]): SeatsPicture {
  const layers = emptyLayers();
  const { places, findings } = analysis;
  const dialled = selected.at(-1) ?? null;
  const reached = (ref: PlaceRef): boolean => selected.length === 0 || selected.some((s) => samePlace(s, ref));
  for (const view of places) {
    const { place, facts, ref } = view;
    if (place === null) continue;
    const link = placeLink(wagon, ref);
    const style = facts !== null && !facts.sittable ? 'warning' : discStyle(facts);
    layers['seats.chairs'].push({ shape: 'circle', centre: place.at, radius: DISC_RADIUS, style, link }, { shape: 'point', at: place.at, style, link });
    const ahead = plus(place.at, facing(place.yaw), DIAL_RADIUS);
    const arrowStyle = ref.kind.drives ? (view.backward ? BACK_STYLE : FORWARD_STYLE) : 'seat';
    layers['seats.facing'].push({ shape: 'arrow', from: place.at, to: ahead, style: arrowStyle, link });
    if (facts !== null) layers['seats.floor'].push(...floorShapes(place, facts, link));
    if (reached(ref)) {
      const floor = facts?.stand?.[1] ?? place.at[1];
      layers['seats.reach'].push({ shape: 'circle', centre: [place.at[0], floor, place.at[2]], radius: SEAT_REACH, style: 'reach', link });
    }
    if (samePlace(dialled, ref)) {
      layers['seats.dial'].push({ shape: 'circle', centre: place.at, radius: DIAL_RADIUS, style: 'reach', link });
      for (const yaw of [0, 90, 180, 270]) layers['seats.dial'].push({ shape: 'point', at: plus(place.at, facing(yaw), DIAL_RADIUS), style: 'reach', link });
    }
  }
  return { places, findings, layers };
}
