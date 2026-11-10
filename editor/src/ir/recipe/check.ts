/**
 * The recipe and its per-type files against their schemas (editor.md §3.10; schema/
 * recipe.schema.json, recipe_override.schema.json), as findings with links to the field.
 *
 * An unknown key is a warning, not an error: the converter warns about it and goes on (an
 * unknown key of the recipe, a source, `sound_defaults` or a per-type file is ignored;
 * one inside `type` or `model` lands in the declaration, whose reader warns about it in
 * the game). The hint to the nearest known key is validate_pack's (core/schema `suggest`).
 * A per-type file for a type the IR packs don't have is a warning too, as the converter's
 * "no stock type … in the packs, not used".
 */

import type { Problem } from '../../core/contracts';
import type { Schema } from '../../core/schema';
import { nearestKey } from '../../core/schema';
import { pyRepr } from '../../core/schema/pyformat';
import type { RecipeWorkspace } from './workspace';

function asWarnings(problems: Problem[]): Problem[] {
  return problems.map((problem) => (problem.code === 'schema.unknown-key' ? { ...problem, severity: 'warning' } : problem));
}

export interface CheckOptions {
  /** The ids of the stock types the IR packs have (the bridge's `type_ids`); without them the per-type files' ids are not checked. */
  typeIds?: readonly string[];
}

/** Every finding of the recipe's files: what does not read as JSON, what the schemas say, the per-type files of no type. */
export function checkRecipe(schema: Schema, workspace: RecipeWorkspace, options: CheckOptions = {}): Problem[] {
  const problems = [...workspace.problems()];
  const recipe = workspace.json(workspace.recipePath);
  if (recipe !== undefined) problems.push(...asWarnings(schema.checker.problems('recipe', workspace.recipePath, recipe)));
  for (const id of workspace.overrideIds()) {
    const path = workspace.overridePath(id);
    const value = workspace.json(path);
    if (value !== undefined) problems.push(...asWarnings(schema.checker.problems('recipe_override', path, value)));
    if (options.typeIds !== undefined && !options.typeIds.includes(id)) {
      const nearest = nearestKey(id, options.typeIds);
      problems.push({
        severity: 'warning',
        source: 'converter',
        code: 'recipe.unknown-type',
        params: { id, nearest: nearest ?? '' },
        text: `${path}: no stock type ${pyRepr(id)} in the packs, not used${nearest === undefined ? '' : ` (did you mean ${pyRepr(nearest)}?)`}`,
        at: [{ kind: 'file', file: path }],
      });
    }
  }
  return problems;
}
