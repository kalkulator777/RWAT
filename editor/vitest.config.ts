/**
 * Unit tests (docs/proposals/editor.md §5.1). Tests live next to the code as
 * `*.test.ts(x)`; the replay tests in test/.
 *
 * - `node` — everything that has no DOM: core/, ports/, io/ (node-fs adapter), ir/
 *   (Pyodide runs in Node), checks/, i18n/, model/, workers/, test/.
 * - `dom` (happy-dom) — the interface folders listed in DOM_FOLDERS. A new interface
 *   folder is added there; a single test elsewhere can still ask for the DOM with a
 *   `// @vitest-environment happy-dom` comment.
 *
 * Coverage: core/ and ports/ keep at least 90 % of their lines tested (§5.1).
 */

import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

const DOM_FOLDERS = ['app', 'forms', 'panels', 'view3d', 'preview', 'tools', 'help', 'audio'];

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts'],
            exclude: [...configDefaults.exclude, ...DOM_FOLDERS.map((folder) => `src/${folder}/**`)],
          },
        },
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'happy-dom',
            include: DOM_FOLDERS.map((folder) => `src/${folder}/**/*.test.{ts,tsx}`),
          },
        },
      ],
      coverage: {
        provider: 'v8',
        include: ['src/core/**', 'src/ports/**'],
        exclude: ['**/*.test.{ts,tsx}', 'src/core/contracts.ts'],
        reporter: ['text-summary'],
        thresholds: { lines: 90 },
      },
    },
  }),
);
