/**
 * Browser tests (docs/proposals/editor.md §5.2) against the built site, served by
 * `vite preview`: run `npm run build` first (CI does), then `npm run e2e`.
 *
 * - Chromium of the Playwright version in package.json (`npx playwright install chromium`).
 *   Where that browser is not installed but another Chromium is, `RWAT_CHROME` names
 *   its executable: `RWAT_CHROME=/opt/pw-browsers/chromium npm run e2e`.
 * - WebGL without a GPU through SwiftShader.
 * - Reference screenshots are CI's (Linux, Playwright's Chromium); `e2e/visual/` keeps them.
 */

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const origin = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `${origin}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: process.env.RWAT_CHROME || undefined,
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `${origin}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
