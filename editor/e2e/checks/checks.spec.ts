/**
 * The checks tab in the browser (docs/proposals/editor.md §3.10, M4 agent A4.4): "Check all
 * models" reads every model of the example pack in the model worker and finds no error;
 * a broken wagon type (a door off the wall, as `ExamplePackLoadTest.coachBreaks` breaks
 * it) has the floor check's finding in the interface's language, the engine's line as its
 * tooltip, and a click on it opens the wagon and brings the inspector to its doors. A
 * screenshot of the tab with the finding goes to the test's output; axe finds nothing
 * serious or critical in it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { EXAMPLE_PACK } from '../../src/testing/repo.node';
import { filesOf, openPack, watchErrors } from '../examplePack';

const COACH = 'data/rwat_example/wagon_types/coach.json';

test.use({ locale: 'en-US' });

/** A zip of the example pack with the coach's door_fl half a block off the side wall. */
async function brokenZip(): Promise<Buffer> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  for (const name of filesOf(EXAMPLE_PACK)) {
    let bytes: Uint8Array = readFileSync(join(EXAMPLE_PACK, name));
    if (name === COACH) {
      const type = JSON.parse(new TextDecoder().decode(bytes)) as { doors: { id: string; min: number[]; max: number[] }[] };
      const door = type.doors.find((d) => d.id === 'door_fl')!;
      door.min[2]! += 0.5;
      door.max[2]! += 0.5;
      bytes = new TextEncoder().encode(JSON.stringify(type, null, 2));
    }
    await writer.add(name, new Uint8ArrayReader(bytes));
  }
  return Buffer.from(await writer.close());
}

async function axe(page: Page): Promise<void> {
  const serious = (await new AxeBuilder({ page }).include('[data-testid="checks"]').analyze()).violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('"Check all models" reads every model of the example pack in the worker and finds no error', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await openPack(page);
  const bar = page.getByTestId('check-models-bar');
  await page.getByTestId('check-models').click();
  await expect(bar).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  await expect(page.getByTestId('check-models-status')).toHaveText('Models checked: 3; errors: 0, warnings: 0.');
  await expect(page.getByTestId('checks-summary')).toHaveText('No findings.');
  await expect(page.locator('.finding[data-source="model"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a broken type has the floor check’s finding in the interface’s words, and a click goes to the door', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await openPack(page, await brokenZip(), 'Broken.zip');
  const finding = page.locator('.finding[data-code="floor.door-not-at-floor-end"]');
  await expect(finding).toHaveCount(1);
  await expect(finding).toHaveAttribute('data-source', 'floor');
  await expect(finding.locator('.finding-text')).toHaveText(
    "door 0 “door_fl” isn't where the floor ends: nobody can walk through it (a player must fit in front of it, inside its span, with the floor ending within 0.4 of its inner face)",
  );
  await expect(finding).toHaveAttribute(
    'title',
    "door 0 'door_fl' isn't where the floor ends: nobody can walk through it (a player must fit in front of it, inside its span, with the floor ending within 0.4 of its inner face)",
  );
  await expect(finding.locator('.finding-where')).toHaveText(`${COACH} /doors/0`);

  await page.locator('[data-toggle="lang"] [data-value="ru"]').click();
  await expect(finding.locator('.finding-text')).toHaveText(
    'дверь 0 «door_fl» не там, где кончается пол: через неё не выйти (перед ней, в её пролёте, должен помещаться игрок, а пол — кончаться не дальше 0.4 от её внутренней грани)',
  );
  const path = test.info().outputPath('checks-floor-finding.png');
  await page.getByTestId('checks').screenshot({ path });
  await test.info().attach('checks-floor-finding', { path, contentType: 'image/png' });
  await axe(page);

  await finding.click();
  // the wagon the door is of opens in the 3D view, and the inspector comes to its doors (the markup tools take the door itself)
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-model', 'rwat_example:coach', { timeout: 15_000 });
  await expect(page.getByTestId('inspector').locator('[data-pointer="/doors"]')).toHaveClass(/field-flash/);
  expect(errors).toEqual([]);
});
