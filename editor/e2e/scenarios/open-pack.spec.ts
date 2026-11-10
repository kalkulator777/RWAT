/**
 * Scenario 2.2 of docs/proposals/editor.md, short, on the example pack: an existing pack
 * opened from a zip and from a folder (File System Access, written in place); its tree,
 * its checks; a finding in it, and a click on the finding that goes to its place — the
 * door it is about in the doors tool, the field it is about in the inspector's form.
 */

import { expect, test } from '@playwright/test';
import { checksTab, field, NS, openZip, packFiles, privateFolder, watchErrors, zipOf } from './steps';

test.use({ locale: 'en-US', viewport: { width: 1600, height: 1000 } });

const COACH = `data/${NS}/wagon_types/coach.json`;
const SHUNTER = `data/${NS}/wagon_types/shunter.json`;

test('2.2 a zip: the tree and the checks show the pack; a door off its wall is found, its finding opens the doors tool on it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  // the coach's door_fl half a block off the left wall
  const zip = await zipOf(
    packFiles({
      [COACH]: (type) => {
        const door = (type.doors as { id: string; min: number[]; max: number[] }[]).find((d) => d.id === 'door_fl');
        if (door === undefined) throw new Error('no door_fl');
        door.min[2] = (door.min[2] ?? 0) + 0.5;
        door.max[2] = (door.max[2] ?? 0) + 0.5;
      },
    }),
  );
  await openZip(page, zip, 'Pack.zip');
  await expect(page.locator('[data-section="wagons"] [data-stock]')).toHaveCount(3);
  await expect(page.locator('[data-section="rails"]')).toContainText(`${NS}:wooden_track`);

  const checks = await checksTab(page);
  await expect(checks).toHaveAttribute('data-schema', 'loaded');
  const finding = checks.locator('.finding[data-code="floor.door-not-at-floor-end"]');
  await expect(finding).toHaveCount(1);
  await expect(finding.locator('.finding-where')).toHaveText(`${COACH} /doors/0`);
  await finding.click();
  const view = page.getByTestId('view3d');
  await expect(view).toHaveAttribute('data-model', `${NS}:coach`, { timeout: 15_000 });
  await expect(view.locator('[data-toggle="tool"] [data-tool="doors"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('doors-door')).toHaveAttribute('data-door', '0');
  await expect(page.locator('#doors-min-z')).toHaveValue('1.95');
  expect(errors).toEqual([]);
});

test('2.2 a folder, written in place: a field of the wrong kind is found, its finding brings the field into view', async ({ page }) => {
  const errors = watchErrors(page);
  await privateFolder(
    page,
    'rwat-e2e-scenario-open',
    packFiles({
      [SHUNTER]: (type) => {
        type.max_speed_kmh = 'fast';
      },
    }),
  );
  await page.getByTestId('open-folder').click();
  const status = page.getByTestId('pack-status');
  await expect(status).toHaveAttribute('data-kind', 'fs-access');
  await expect(status).toContainText('rwat-e2e-scenario-open');
  await expect(page.locator('[data-section="wagons"] [data-stock]')).toHaveCount(3);

  const checks = await checksTab(page);
  const finding = checks.locator('.finding');
  await expect(finding).toHaveCount(1);
  await expect(finding).toHaveAttribute('data-source', 'schema');
  await expect(finding.locator('.finding-where')).toHaveText(`${SHUNTER} /max_speed_kmh`);
  await finding.click();
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-file', SHUNTER);
  await expect(field(page, '/max_speed_kmh').locator('input').first()).toBeFocused();
  expect(errors).toEqual([]);
});
