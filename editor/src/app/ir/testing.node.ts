/**
 * Node only (tests): the IR session on Pyodide in Node — each bridge a Pyodide of its own,
 * as each is a worker of its own in the page — and the synthetic IR pack of ir/testing.node
 * as the files an author picks: the zips, the recipe file, its per-type files as a zip.
 */

import { PythonBridge } from '../../ir/bridge';
import { irOverrides, irPackFiles, irRecipe, json, nodePython, secondPackFiles, zipOf } from '../../ir/testing.node';
import { useBridgeMaker, type IrBridge } from './session';

/** How many bridges the sessions made (a session's own, one per conversion). */
export const made: IrBridge[] = [];

/** Makes the sessions take bridges over Pyodide in Node (one Pyodide each, as one worker each in the page). */
export function useNodeBridges(): void {
  useBridgeMaker(() => {
    const bridge = new PythonBridge(() => ({ api: nodePython(), stop: () => undefined }), () => ({}));
    made.push(bridge);
    return Promise.resolve(bridge);
  });
}

/** The synthetic IR pack as an author picks it: the two zips (named as the recipe names them), the recipe file, its per-type files zipped in their folder. */
export async function syntheticPicks(recipe: Record<string, unknown> = irRecipe()) {
  const first = new File([(await zipOf(irPackFiles())).slice()], 'test-ir.zip');
  const second = new File([(await zipOf(secondPackFiles())).slice()], 'Second IR.zip');
  const recipeFile = new File([json(recipe).slice()], 'test.json');
  const overrides = new File([(await zipOf(Object.fromEntries(Object.entries(irOverrides()).map(([id, value]) => [`tp/${id}.json`, json(value)])))).slice()], 'tp.zip');
  return { zips: [first, second], recipe: recipeFile, overrides };
}
