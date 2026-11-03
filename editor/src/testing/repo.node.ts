/**
 * Node only (tests and tools): where the repository's files are, in one place. The
 * editor lives in `editor/` of the repository, so every path is found from this file.
 * Lives outside core/, io/ and the rest so that every module's tests may import it
 * (the lint borders of core/ and ports/ forbid the modules above them, not this).
 */

import { join } from 'node:path';

/** The repository's root folder, with a trailing separator. */
// import.meta.dirname, not a file: URL: under happy-dom (the interface tests) import.meta.url is http:.
export const REPO_ROOT = `${join(import.meta.dirname, '..', '..', '..')}/`;

/** The example pack's folder (R11, CC0). */
export const EXAMPLE_PACK = join(REPO_ROOT, 'run', 'rwat_packs', 'RwatExamplePack');

/** The converter's folder, for tests that compare with what it writes. */
export const TOOLS_DIR = join(REPO_ROOT, 'tools');

/** The pack format's schema folder, with a trailing separator. */
export const REPO_SCHEMA_DIR = `${join(REPO_ROOT, 'schema')}/`;

/** The shared golden cases (`fixtures/golden/`). */
export const GOLDEN_DIR = join(REPO_ROOT, 'fixtures', 'golden');
