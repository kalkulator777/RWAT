/**
 * Node only (tests and tools): where the repository's files are, in one place. The
 * editor lives in `editor/` of the repository, so every path is found from this file.
 * Lives outside core/, io/ and the rest so that every module's tests may import it
 * (the lint borders of core/ and ports/ forbid the modules above them, not this).
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository's root folder, with a trailing separator. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The example pack's folder (R11, CC0). */
export const EXAMPLE_PACK = join(REPO_ROOT, 'run', 'rwat_packs', 'RwatExamplePack');

/** The converter's folder, for tests that compare with what it writes. */
export const TOOLS_DIR = join(REPO_ROOT, 'tools');

/** The pack format's schema folder, with a trailing separator. */
export const REPO_SCHEMA_DIR = `${join(REPO_ROOT, 'schema')}/`;

/** The shared golden cases (`fixtures/golden/`). */
export const GOLDEN_DIR = join(REPO_ROOT, 'fixtures', 'golden');
