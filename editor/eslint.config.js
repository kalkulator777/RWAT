// @ts-check
/**
 * Lint of the editor (`npm run lint` runs `tsc -b` first). Besides the recommended
 * rules it guards the module borders of docs/proposals/editor.md §3.3:
 *
 * - core/ and ports/ import no Preact and no three, and none of the modules above them
 *   (app, panels, forms, view3d, …): they run in Node, in workers and in tests, like the
 *   mod's pure core;
 * - ports/ know only each other (and schema data): of core/ only the shared contracts.
 */

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/** The folders of src/ that sit above core/ and ports/. */
const UPPER_MODULES = [
  'app',
  'panels',
  'forms',
  'view3d',
  'preview',
  'tools',
  'checks',
  'io',
  'model',
  'workers',
  'ir',
  'i18n',
  'help',
  'audio',
];

const uiLibraries = {
  group: ['preact', 'preact/*', '@preact/*', 'three', 'three/*', 'three-mesh-bvh', 'three-mesh-bvh/*'],
  message: 'core/ and ports/ run in Node and in workers: no Preact, no three (editor.md §3.3).',
};

const upperModules = {
  regex: `^(?:\\.\\./)+(?:${UPPER_MODULES.join('|')})(?:/|$)`,
  message: 'core/ and ports/ do not import the modules above them (editor.md §3.3).',
};

const coreFromPorts = {
  regex: '^(?:\\.\\./)+core/(?!contracts$)',
  message: 'ports/ know nothing of the pack model: of core/ only the contracts (editor.md §3.3).',
};

export default defineConfig(
  globalIgnores(['dist/', 'dev-dist/', 'coverage/', 'playwright-report/', 'test-results/', 'blob-report/']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [uiLibraries, upperModules] }],
    },
  },
  {
    files: ['src/ports/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [uiLibraries, upperModules, coreFromPorts] }],
    },
  },
);
