/**
 * A type's names in its override (editor.md §2.6, step 4; tools/ir2rwat.py `add_names`):
 * `name` — the type's display name by language (`en_us` replaces the IR name) — and
 * `lights` — each light group's name by language, for the driver's light menu. Both are
 * written to the override, never to a lang file: the converter writes the lang files
 * (`wagon.<ns>.<id>`, `light.<ns>.<id>.<group>`). And `sway`, the body's rocking (0…3).
 * Thin names for fields of ./fields.ts.
 */

import type { Command } from '../../core/contracts';
import { escapeSegment } from '../../core/json';
import { resetField, setField, type SetOptions } from './fields';
import type { RecipeWorkspace } from './workspace';

export const namePointer = (lang: string): string => `/name/${escapeSegment(lang)}`;
export const lightPointer = (group: string, lang: string): string => `/lights/${escapeSegment(group)}/${escapeSegment(lang)}`;

/** The type's name in a language (`ru_ru`); with the derived `base`, the IR name given back as `en_us` is a reset. */
export function setName(workspace: RecipeWorkspace, id: string, lang: string, text: string, options: SetOptions = {}): Command {
  return setField(workspace, id, namePointer(lang), text, { label: 'recipe.cmd.name', ...options });
}

export function resetName(workspace: RecipeWorkspace, id: string, lang: string): Command {
  return resetField(workspace, id, namePointer(lang));
}

/** A light group's name in a language. */
export function setLightName(workspace: RecipeWorkspace, id: string, group: string, lang: string, text: string, options: SetOptions = {}): Command {
  return setField(workspace, id, lightPointer(group, lang), text, { label: 'recipe.cmd.lightName', ...options });
}

export function resetLightName(workspace: RecipeWorkspace, id: string, group: string, lang: string): Command {
  return resetField(workspace, id, lightPointer(group, lang));
}

/** The body's rocking, a number from 0 to 3 (the converter leaves any other out, with a warning). */
export function setSway(workspace: RecipeWorkspace, id: string, sway: number, options: SetOptions = {}): Command {
  return setField(workspace, id, '/sway', sway, { label: 'recipe.cmd.sway', ...options });
}

export function resetSway(workspace: RecipeWorkspace, id: string): Command {
  return resetField(workspace, id, '/sway');
}
