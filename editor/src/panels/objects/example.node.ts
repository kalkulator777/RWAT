/**
 * Node only (tests): the example pack's wagons as the objects tab reads them, one place
 * for the tab's tests.
 */

import { Pack } from '../../core/pack';
import { MemorySource, readTree } from '../../core/pack/testing.node';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import type { BuiltModel } from './buildModel';
import { loadWagonModel } from './source';

/** The example pack, opened. */
export async function openExample(): Promise<Pack> {
  return Pack.open(new MemorySource(readTree(EXAMPLE_PACK), 'RwatExamplePack'));
}

/** The model of one of the example pack's wagons (`rwat_example:shunter`). */
export async function exampleModel(id: string, pack?: Pack): Promise<BuiltModel> {
  const open = pack ?? (await openExample());
  const entry = open.stock().find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`the example pack has no wagon ${id}`);
  const result = await loadWagonModel(open, entry);
  if (!('built' in result)) throw new Error(`${id}: ${result.failure}`);
  return result.built;
}
