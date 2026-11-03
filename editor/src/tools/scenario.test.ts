/**
 * The M4 scenario (docs/proposals/editor.md, M4 «Готово, когда»): all the markup of the
 * example pack's coach and shunter — floor zones, doors, driver's chairs — taken out in one
 * edit, then made again with the editor's three markup tools, one after the other, for one
 * wagon and then the other, all in one journal: the zones by the zones tool, the doors by
 * the doors tool on those zones, the chairs by the chairs tool on that floor
 * (./scenarios.node.ts, the steps each tool's own scenario takes). The types come out as
 * the repository's files have them, as values; the floor check and the pack check find
 * nothing; undone step by step, the markup is gone again, and the edit that took it out
 * undone, the files are the repository's byte for byte.
 */

import { batch } from '@preact/signals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkPack } from '../checks/pack';
import { exampleModel } from '../model/testing.node';
import { findings } from '../ports/floorCheck';
import { EXAMPLE_PACK } from '../testing/repo.node';
import type { DoorsSession } from './doors';
import type { FloorSession } from './floor';
import { FLOOR_TIMING } from './floor/session';
import { tools } from './index';
import { ToolHost } from './registry';
import { CHAIR_CLICKS, DOOR_STEPS, drawZones, makeDoors, placeChairs, repositoryType, typeFile, ZONE_FLOORS, type MarkedWagon } from './scenarios.node';
import type { SeatsSession } from './seats';
import { SEATS_TIMING } from './seats/session';
import { bench } from './testing.node';

// drawn again at once after each edit, however slow an instrumented run is
FLOOR_TIMING.slowMs = Number.POSITIVE_INFINITY;
SEATS_TIMING.slowMs = Number.POSITIVE_INFINITY;

const WAGONS: readonly MarkedWagon[] = ['coach', 'shunter'];

describe('the markup of the example pack made again with the three markup tools, in one journal', () => {
  it('comes out as the repository has it, the checks find nothing, and undone it is gone, the files as they were', async () => {
    const models = { coach: await exampleModel('coach'), shunter: await exampleModel('shunter') };
    const b = await bench('rwat_example:coach', models.coach);
    const host = new ToolHost(tools);
    const stop = host.connect(b.wiring);

    // all the markup taken out, of both wagons, in one edit
    b.journal.dispatch({
      label: 'x',
      ops: WAGONS.flatMap((name) => [
        { op: 'remove' as const, file: typeFile(name), at: '/interior' },
        { op: 'remove' as const, file: typeFile(name), at: '/doors' },
        ...(repositoryType(name).cab === undefined ? [] : [{ op: 'remove' as const, file: typeFile(name), at: '/cab/seats' }]),
      ]),
    });
    for (const name of WAGONS) expect(b.pack.value?.json(typeFile(name))).not.toHaveProperty('interior');

    for (const name of WAGONS) {
      const id = `rwat_example:${name}`;
      batch(() => {
        b.openWagon.value = id;
        b.openModel.value = models[name];
      });
      const markup = repositoryType(name);

      host.use('floor');
      drawZones(b, (host.current.value?.session as FloorSession).tool, id, markup.interior, ZONE_FLOORS[name]);
      host.use('doors');
      const doors = (host.current.value?.session as DoorsSession).tool;
      makeDoors(b, doors, id, markup.doors, DOOR_STEPS[name]);
      // every leaf of the model is moved by a door
      expect(doors.picture.value?.movers.filter((m) => m.door < 0)).toEqual([]);
      if (markup.cab !== undefined) {
        host.use('seats');
        placeChairs(b, (host.current.value?.session as SeatsSession).tool, id, markup.cab.seats, CHAIR_CLICKS[name]);
      }

      expect(b.pack.value?.json(typeFile(name))).toEqual(markup);
      const type = host.subject.value?.type;
      if (type === undefined || type === null) throw new Error(`${name}: the type does not load`);
      expect(findings(type), name).toEqual([]);
    }
    host.use(null);
    const pack = b.pack.value;
    if (pack === null) throw new Error('no pack');
    expect(checkPack(pack, null)).toEqual([]);

    // every step was a command of the one journal: undone, the markup is gone again
    while (b.journal.state().done.length > 1) b.journal.undo();
    for (const name of WAGONS) {
      const json = pack.json(typeFile(name)) as Record<string, unknown>;
      expect(json, name).not.toHaveProperty('interior');
      expect(json, name).not.toHaveProperty('doors');
      expect((json.cab as Record<string, unknown> | undefined) ?? {}, name).not.toHaveProperty('seats');
    }
    // and the edit that took it out undone: the type files are the repository's, byte for byte
    b.journal.undo();
    for (const name of WAGONS) expect(await pack.text(typeFile(name)), name).toBe(readFileSync(join(EXAMPLE_PACK, typeFile(name)), 'utf8'));
    expect(pack.dirtyPaths()).toEqual([]);
    stop();
  });
});
