/**
 * The "Preview" tab in the built site (docs/proposals/editor.md §6.1, §6.3): it is a bottom
 * tab in both languages, says there is no model to preview while none is open, and axe
 * finds nothing serious or critical in it.
 *
 * What it does to a model, with the 3D view and the open model wired to it, is the M3
 * gate's scenario (e2e/m3/): the coach's `salon_door`, a coupled end and the blue
 * livery; the shunter's `THROTTLE_1` and `FHL`, with a screenshot of the view each.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const { locale, tab, empty } of [
  { locale: 'ru-RU', tab: 'Предпросмотр', empty: 'Модель не открыта' },
  { locale: 'en-US', tab: 'Preview', empty: 'No model open' },
]) {
  test.describe(`in ${locale}`, () => {
    test.use({ locale });

    test('the preview tab says there is no model yet, and passes axe', async ({ page }) => {
      await page.goto('./');
      await page.getByRole('tab', { name: tab, exact: true }).click();
      const panel = page.getByTestId('preview');
      await expect(panel).toBeVisible();
      await expect(panel).toContainText(empty);
      const { violations } = await new AxeBuilder({ page }).include('[data-testid="preview"]').analyze();
      expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    });
  });
}
