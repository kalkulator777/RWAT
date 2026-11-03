/**
 * Which role the engine gives each part of a wagon OBJ: the steps of `parse_order` in
 * schema/obj-conventions.json, in that order, the first that takes the part deciding
 * (`convention/ModelParts.java#Builder.place`). Pure, no DOM.
 *
 * This is the objects tab's own reading until the model worker hands over the roles of
 * `ports/modelParts` (A3.1): the tab shows `ObjectInfo.role` whatever made it, and the
 * worker's model replaces the one built here (./source.ts). The rules are the schema's
 * and `ports/objectRole`'s; what is here is only their order. Held to the engine's own
 * answers by fixtures/golden/model_parts/ (./classify.test.ts).
 */

import { coupled, door, parseRole } from '../../ports/objectRole';
import { roleRegex } from './roles';

/** One part of the OBJ as the classifier needs it: its object's name and whether its material has a texture. */
export interface PartInput {
  object: string;
  textured: boolean;
}

export interface ClassifyContext {
  /** The prefixes the model declaration's `skip` lists. */
  skip: readonly string[];
  /** The names the model's `.anim` files move (exact, copy suffix included). */
  animObjects: ReadonlySet<string>;
}

const CARGO = roleRegex('skip') as RegExp;
const BOGIE_FRONT = roleRegex('bogie_front') as RegExp;
const BOGIE_REAR = roleRegex('bogie_rear') as RegExp;
const WHEEL = roleRegex('wheelset') as RegExp;
const INTERIOR = roleRegex('interior') as RegExp;
const SLIDE = /TL_[^_]*_[XYZ]/u;

/**
 * The steps that decide before the name's own meaning: hidden, skip, a part whose material
 * has no texture (not drawn: `untextured`), then coupler heads, bogies, wheels and the
 * objects of an `.anim`; null if none takes the part. A leaf's hinge marker or slide may be
 * untextured and still count, so the leaf keys use {@link nameRole} without the texture.
 */
function nameRole(name: string, textured: boolean, context: ClassifyContext): string | null {
  if (name.includes('HIDE') && parseRole(name).control?.kind !== 'WIDGET' && coupled(name) === null) return 'hidden';
  if (CARGO.test(name) || context.skip.some((prefix) => name.startsWith(prefix))) return 'skip';
  if (!textured) return 'untextured';
  if (coupled(name) !== null && parseRole(name).control === null) return 'coupler_head'; // a head named like a control is the control
  if (BOGIE_FRONT.test(name) || BOGIE_REAR.test(name)) {
    return WHEEL.test(name) ? 'wheelset' : BOGIE_FRONT.test(name) ? 'bogie_front' : 'bogie_rear';
  }
  if (context.animObjects.has(name)) return 'anim_object';
  return null;
}

/**
 * The role of every part, in the order given. A door's `DOOR_<n>` objects are leaves when
 * any of them drawn as a part of its own has a hinge marker or a slide; otherwise they are
 * body like any other.
 */
export function classifyParts(parts: readonly PartInput[], context: ClassifyContext): string[] {
  const early = parts.map((part) => nameRole(part.object, part.textured, context));
  const leafKeys = new Set<string>();
  parts.forEach((part) => {
    const role = nameRole(part.object, true, context);
    if (role !== null) return;
    const leaf = door(part.object);
    if (leaf?.control && (leaf.pivotDegrees !== null || SLIDE.test(part.object))) leafKeys.add(leaf.control.key);
  });
  return parts.map((part, at) => {
    const named = early[at];
    if (named !== null && named !== undefined) return named;
    const leaf = door(part.object);
    if (leaf?.control && leafKeys.has(leaf.control.key)) return 'door_leaf';
    if (parseRole(part.object).control !== null) return 'control';
    return INTERIOR.test(part.object) ? 'interior' : 'body';
  });
}
