/**
 * The chairs tool while it is on (docs/proposals/editor.md §2.3, §3.9): the view goes to
 * the top, the tool takes the presses on its places (./gesture.ts), draws its layers
 * (./analysis.ts) again after every edit and selection, and places a chair where a click
 * lands on the model (./cushion.ts): on a cushion, at its middle; Alt held, at the point
 * clicked. Its state — what a moved place snaps to — lives here, read by the inspector's
 * section (./SeatsInspector.tsx).
 *
 * A click on the model selects the object it hit right after telling the tool (the view's
 * own selection): the chair placed is selected again once that is done.
 *
 * The places drawn are worked out once a file's value (the pack never changes one in
 * place): a selection only draws them again. Worked out, they cost the floor check and the
 * cab finder of the type — tens of milliseconds for a big type: once a picture took long,
 * the next one after an edit is drawn a moment after the last of a run of edits, so a drag
 * stays smooth.
 */

import { batch, effect, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type { Command, Link, PickHit, Vec3 } from '../../core/contracts';
import type { WagonType } from '../../ports/wagonType';
import { free } from '../floor/snap';
import { zonesOf } from '../floor/zones';
import type { ToolContext, ToolSession, ToolSubject } from '../registry';
import { analysePlaces, SEAT_LAYERS, seatsPicture, type PlaceAnalysis, type PlaceView, type SeatsPicture } from './analysis';
import { placeAt } from './cushion';
import { ALL_SEAT_SNAPPING, SeatDragger, type SeatSnapping } from './gesture';
import { PLACE_KINDS, placeLink, samePlace, selectedPlaces, type Place, type PlaceKind, type PlaceRef } from './places';

/** When the places are drawn again after an edit (see the file's head); the unit tests draw at once (`slowMs` infinite). */
export const SEATS_TIMING = { slowMs: 30, settleMs: 120 };

/** How far over the floor a chair added from the keyboard has its cushion, blocks. */
export const NEW_CUSHION = 0.5;

/** What the chairs tool holds while it is on; its section of the inspector reads and drives it. */
export interface SeatsTool {
  readonly subject: ReadonlySignal<ToolSubject | null>;
  /** The editor's selection (the selected places are links in it). */
  readonly selection: ReadonlySignal<readonly Link[]>;
  /** The kinds of place the tool edits. */
  readonly kinds: readonly PlaceKind[];
  /** The picture drawn now. */
  readonly picture: ReadonlySignal<SeatsPicture | null>;
  readonly snapping: Signal<SeatSnapping>;
  /** The selected places, in the selection's order. */
  chosen(): PlaceRef[];
  /** The place selected last, or null. */
  selected(): PlaceRef | null;
  select(ref: PlaceRef | null, toggle?: boolean): void;
  /** Selects what a finding points at (its chair, or the field of the cab). */
  show(links: readonly Link[]): void;
  dispatch(command: Command): boolean;
  /** Places a place of `kind` where a click at `point` on `object` puts one (`exact`: the point itself); false when nothing was placed. */
  placeOn(object: string, point: Vec3, exact?: boolean, kind?: PlaceKind): boolean;
  /** Adds a place from the keyboard: over the middle of the first zone, {@link NEW_CUSHION} over its floor, facing forward. */
  add(kind?: PlaceKind): void;
  remove(ref: PlaceRef): void;
  /** Moves a place to `to` in its kind's list. */
  reorder(ref: PlaceRef, to: number): void;
  /** One number of a place's `at`: `axis` 0 x, 1 y, 2 z. */
  setAt(ref: PlaceRef, axis: 0 | 1 | 2, value: number): void;
  setYaw(ref: PlaceRef, yaw: number): void;
}

/** A place's place in the file, or null when it is not there or cannot be read. */
function placeOf(subject: ToolSubject, ref: PlaceRef): Place | null {
  return ref.kind.places(subject.typeJson)[ref.index] ?? null;
}

/** Where a place added from the keyboard goes: over the middle of the first zone, else over the car's middle. */
export function newPlace(subject: ToolSubject): Place {
  const zone = zonesOf(subject.typeJson).find((z) => z !== null) ?? null;
  if (zone === null) return { at: [0, 1, 0], yaw: 0 };
  return { at: [free((zone.minX + zone.maxX) / 2), free(zone.minY + NEW_CUSHION), free((zone.minZ + zone.maxZ) / 2)], yaw: 0 };
}

/** Turns the chairs tool on: returns its state and what turns it off (the session's `dispose`). */
export function startSeats(context: ToolContext, options: { settleMs?: number; slowMs?: number; kinds?: readonly PlaceKind[] } = {}): Pick<ToolSession, 'dispose'> & { tool: SeatsTool } {
  const settle = options.settleMs ?? SEATS_TIMING.settleMs;
  const slow = options.slowMs ?? SEATS_TIMING.slowMs;
  const kinds = options.kinds ?? PLACE_KINDS;
  const subject = (): ToolSubject => context.subject.peek() as ToolSubject;
  const snapping = signal<SeatSnapping>(ALL_SEAT_SNAPPING);
  const picture = signal<SeatsPicture | null>(null);
  let disposed = false;

  const chosen = (): PlaceRef[] => {
    const now = context.subject.peek();
    if (now === null) return [];
    return selectedPlaces(context.selection.peek(), now.wagon, kinds).filter((ref) => ref.index < ref.kind.places(now.typeJson).length);
  };
  const selected = (): PlaceRef | null => chosen().at(-1) ?? null;

  const select = (ref: PlaceRef | null, toggle = false): void => {
    const wagon = subject().wagon;
    const now = context.selection.peek();
    if (ref === null) {
      if (!toggle) context.selection.value = now.filter((link) => selectedPlaces([link], wagon, kinds).length === 0);
      return;
    }
    const link = placeLink(wagon, ref);
    if (!toggle) context.selection.value = [link];
    else if (chosen().some((other) => samePlace(other, ref))) context.selection.value = now.filter((l) => !samePlace(selectedPlaces([l], wagon, kinds)[0] ?? null, ref));
    else context.selection.value = [...now, link];
  };

  const dispatch = (command: Command): boolean => command.ops.length === 0 || context.dispatch(command);

  /** Adds a place and selects it; false when the kind is full or the command was refused. */
  const addPlace = (kind: PlaceKind, place: Place, label?: string): PlaceRef | null => {
    const now = subject();
    const index = kind.places(now.typeJson).length;
    if (index >= kind.limit) return null;
    const command = kind.add(now.typeFile, now.typeJson, place, label === undefined ? {} : { label });
    if (command.ops.length === 0 || !dispatch(command)) return null;
    const ref = { kind, index };
    select(ref);
    return ref;
  };

  const tool: SeatsTool = {
    subject: context.subject,
    selection: context.selection,
    kinds,
    picture,
    snapping,
    chosen,
    selected,
    select,
    show(links) {
      if (links.length > 0) context.selection.value = [...links];
    },
    dispatch,
    placeOn(object, point, exact = false, kind = kinds[0]) {
      const model = subject().model;
      if (model === null || kind === undefined) return false;
      const at: Vec3 = exact ? [free(point[0]), free(point[1]), free(point[2])] : placeAt(model, object, point);
      const ref = addPlace(kind, { at, yaw: 0 }, 'tools.seats.cmd.place');
      if (ref === null) return false;
      // the view selects the object clicked right after telling the tool: select the chair again then
      queueMicrotask(() => {
        if (!disposed) select(ref);
      });
      return true;
    },
    add(kind = kinds[0]) {
      if (kind !== undefined) addPlace(kind, newPlace(subject()));
    },
    remove(ref) {
      const now = subject();
      if (!dispatch(ref.kind.remove(now.typeFile, now.typeJson, ref.index))) return;
      const left = ref.kind.places(subject().typeJson).length;
      select(left === 0 ? null : { kind: ref.kind, index: Math.min(ref.index, left - 1) });
    },
    reorder(ref, to) {
      const now = subject();
      if (dispatch(ref.kind.reorder(now.typeFile, now.typeJson, ref.index, to))) select({ kind: ref.kind, index: to });
    },
    setAt(ref, axis, value) {
      const now = subject();
      const place = placeOf(now, ref);
      if (place === null) return;
      const at: Vec3 = [place.at[0], place.at[1], place.at[2]];
      at[axis] = value;
      dispatch(ref.kind.set(now.typeFile, now.typeJson, ref.index, { at, yaw: place.yaw }, { label: 'tools.seats.cmd.set' }));
    },
    setYaw(ref, yaw) {
      const now = subject();
      const place = placeOf(now, ref);
      if (place === null) return;
      dispatch(ref.kind.set(now.typeFile, now.typeJson, ref.index, { at: place.at, yaw }, { label: 'tools.seats.cmd.turn' }));
    },
  };

  // the places of a file's value, worked out once (the floor check and the cab finder)
  let analysed: { typeJson: unknown; type: WagonType | null; analysis: PlaceAnalysis } | null = null;
  const analysis = (now: ToolSubject): PlaceAnalysis => {
    if (analysed === null || analysed.typeJson !== now.typeJson || analysed.type !== now.type) {
      analysed = { typeJson: now.typeJson, type: now.type, analysis: analysePlaces(now.typeJson, now.type, kinds) };
    }
    return analysed.analysis;
  };
  const placesNow = (): readonly PlaceView[] => {
    const now = context.subject.peek();
    return now === null ? [] : analysis(now).places;
  };

  // the layers: drawn again after each edit (at once while that is quick) and each selection
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cost = 0;
  let drawnJson: unknown = undefined;
  const draw = (): void => {
    timer = undefined;
    const now = context.subject.peek();
    if (now === null) return;
    const began = performance.now();
    const fresh = drawnJson !== now.typeJson;
    const next = seatsPicture(now.wagon, analysis(now), chosen());
    batch(() => {
      for (const layer of SEAT_LAYERS) context.view.overlay(layer, next.layers[layer]);
      picture.value = next;
    });
    drawnJson = now.typeJson;
    if (fresh) cost = performance.now() - began;
  };
  const stopDrawing = effect(() => {
    const now = context.subject.value;
    void context.selection.value;
    clearTimeout(timer);
    const edited = now !== null && drawnJson !== now.typeJson;
    if (!edited || cost < slow || picture.peek() === null) draw();
    else timer = setTimeout(draw, settle);
  });

  // a chair where a click lands on the model
  const stopPicking = context.view.onPick((hit: PickHit) => {
    if (hit.double || hit.shift || hit.ctrl || hit.object === undefined || hit.point === undefined) return;
    tool.placeOn(hit.object, hit.point, hit.alt);
  });

  const dragger = new SeatDragger({
    subject,
    places: placesNow,
    selected,
    select,
    dispatch,
    snapping: () => snapping.peek(),
  });
  context.view.setDragger(dragger);
  context.view.setCamera('top');

  return {
    tool,
    dispose() {
      disposed = true;
      stopDrawing();
      stopPicking();
      clearTimeout(timer);
      dragger.dispose();
      context.view.setDragger(null);
      for (const layer of SEAT_LAYERS) context.view.overlay(layer, []);
    },
  };
}
