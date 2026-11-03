/**
 * The built site works from a subfolder, as GitHub Pages serves it under /RWAT/
 * (docs/proposals/editor.md §5.4): the page, its scripts and styles, the editor's own
 * fonts and the schema all load from /RWAT/…, and nothing is asked for outside it. The
 * preview server serves the site at /; here every request under /RWAT/ is answered with
 * the site's file and anything else with 404, so a URL that escapes the folder fails.
 */

import { expect, test } from '@playwright/test';

test.use({ locale: 'ru-RU', serviceWorkers: 'block' });

test('the site under /RWAT/ loads its fonts and its schema from there', async ({ page, baseURL }) => {
  const origin = new URL(baseURL as string).origin;
  const outside: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.continue();
    if (!url.pathname.startsWith('/RWAT/')) {
      outside.push(url.pathname);
      return route.fulfill({ status: 404, body: 'outside the site' });
    }
    const response = await route.fetch({ url: `${origin}${url.pathname.slice('/RWAT'.length)}${url.search}` });
    return route.fulfill({ response });
  });
  const failed: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`${origin}/RWAT/`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.locator('.checks')).toHaveAttribute('data-schema', 'loaded');
  const faces = await page.evaluate(async () => {
    await Promise.all(['Inter Variable', 'JetBrains Mono Variable'].map((family) => document.fonts.load(`16px "${family}"`, 'Aa Жж 0')));
    await document.fonts.ready;
    return [...document.fonts].map((font) => `${font.family.replaceAll('"', '')} ${font.status}`).sort();
  });
  expect(faces).toEqual(['Inter Variable loaded', 'Inter Variable loaded', 'JetBrains Mono Variable loaded', 'JetBrains Mono Variable loaded']);
  expect(outside).toEqual([]);
  expect(failed).toEqual([]);
});
