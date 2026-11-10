/**
 * The view's part of the shared selection (core/contracts `Link`, app/store `selection`,
 * docs/proposals/editor.md §3.4, §3.8): a click on an object selects it, Shift adds it or
 * takes it back out. An object's link is `{kind: 'object', model: '<namespace>:<wagon id>',
 * name: '<OBJ object name>'}`, as the objects tab writes and reads it. What the view shows
 * of a selection: the objects of its model, and the overlay shapes with the same link.
 *
 * A click on nothing leaves the selection as it is: the selection also says which wagon is
 * open (the objects tab takes it from there), so emptying it from the view would close the
 * very model being looked at.
 *
 * Pure: no three, no DOM, no signals.
 */

import type { Link } from '../core/contracts';
import { sameLink } from './overlayGeometry';

/** The link of an object of a model. */
export function objectLink(model: string, name: string): Link {
  return { kind: 'object', model, name };
}

/**
 * The selection after a click in the view. `hit` is what the click hit: an object's link
 * or an overlay shape's, or null for nothing. Without Shift the hit becomes the selection;
 * with Shift it is added, or taken out if it was in. Nothing hit changes nothing. The same
 * array comes back when nothing changes.
 */
export function selectionAfterClick(current: readonly Link[], hit: Link | null, additive: boolean): readonly Link[] {
  if (hit === null) return current;
  if (!additive) return current.length === 1 && sameLink(current[0] as Link, hit) ? current : [hit];
  return current.some((link) => sameLink(link, hit)) ? current.filter((link) => !sameLink(link, hit)) : [...current, hit];
}

/** The names of the model's objects in the selection. */
export function selectedObjects(selection: readonly Link[], model: string | null): Set<string> {
  const names = new Set<string>();
  for (const link of selection) if (link.kind === 'object' && link.model === model) names.add(link.name);
  return names;
}

/** True if the link is in the selection. */
export function isSelected(selection: readonly Link[], link: Link): boolean {
  return selection.some((chosen) => sameLink(chosen, link));
}
