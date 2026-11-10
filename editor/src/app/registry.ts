/**
 * Panels register themselves (docs/proposals/editor.md §3.4): every folder
 * `src/panels/<name>/` has an `index.ts` (or `index.tsx`) whose default export is one
 * {@link PanelDef} or a list of them, and the shell finds the folders by itself
 * (./panels.ts). A new panel edits no file of the shell, so agents do not collide in app/.
 *
 * ```ts
 * // src/panels/checks/index.ts
 * import { definePanel } from '../../app/registry';
 * import { ChecksPanel } from './ChecksPanel';
 * export default definePanel({ id: 'checks', slot: 'bottom', order: 10, title: 'checks.title', component: ChecksPanel });
 * ```
 *
 * A panel reads and writes the editor's state through the signals of ./store.ts and
 * changes the pack only through the journal's commands.
 */

import type { ComponentType } from 'preact';
import type { EditorMode } from './store';

/**
 * Where on the screen a panel goes (§6.1):
 * - `toolbar` — controls in the top bar (open, new, IR import, save, undo and redo, help), in a row;
 * - `tree` — the left side (the pack tree; in 2b the recipe);
 * - `view` — the centre: the 3D view with its own bar and status line;
 * - `inspector` — the right side: the form of what is selected;
 * - `bottom` — the tabs under the view.
 *
 * In `tree`, `inspector` and `bottom` several panels become tabs; one panel in `tree` or
 * `inspector` fills the side alone. In `view` the first panel is shown.
 */
export type PanelSlot = 'toolbar' | 'tree' | 'view' | 'inspector' | 'bottom';

export const PANEL_SLOTS: readonly PanelSlot[] = ['toolbar', 'tree', 'view', 'inspector', 'bottom'];

export interface PanelDef {
  /** Unique across the editor, lower-case words joined by '-': `checks`, `ir-recipe`. */
  id: string;
  slot: PanelSlot;
  /** Ascending within the slot, ties by id. Bottom tabs of §6.1: checks 10, objects 20, preview 30, journal 40, log 50. */
  order: number;
  /** i18n key of the panel's name: the tab's label, the region's name for a screen reader. */
  title: string;
  /** The modes the panel shows in (2a — RWAT pack, 2b — IR pack); both when left out. */
  modes?: readonly EditorMode[];
  component: ComponentType;
}

/** A panel folder's `index.ts` as `import.meta.glob(..., { eager: true })` returns it. */
export interface PanelModule {
  default?: PanelDef | readonly PanelDef[];
}

/** Declares a panel; it only gives the declaration its type. */
export function definePanel(def: PanelDef): PanelDef {
  return def;
}

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * The panels the modules declare, sorted by slot order and id. A broken declaration
 * (no default export, a bad or repeated id, an unknown slot) throws with every problem
 * listed: the editor does not start half-registered, and the unit test of a new panel
 * fails at once.
 */
export function collectPanels(modules: Readonly<Record<string, PanelModule>>): PanelDef[] {
  const problems: string[] = [];
  const panels: PanelDef[] = [];
  const seen = new Map<string, string>();
  for (const path of Object.keys(modules).sort()) {
    const exported = modules[path]?.default;
    if (exported === undefined) {
      problems.push(`${path}: no default export of definePanel(...)`);
      continue;
    }
    const defs: readonly PanelDef[] = Array.isArray(exported) ? exported : [exported as PanelDef];
    for (const def of defs) {
      const where = `${path}: panel '${String(def.id)}'`;
      if (typeof def.id !== 'string' || !ID.test(def.id)) problems.push(`${where}: id must be lower-case words joined by '-'`);
      if (!PANEL_SLOTS.includes(def.slot)) problems.push(`${where}: unknown slot '${String(def.slot)}'`);
      if (typeof def.title !== 'string' || def.title === '') problems.push(`${where}: no title key`);
      if (!Number.isFinite(def.order)) problems.push(`${where}: order must be a finite number`);
      if (typeof def.component !== 'function') problems.push(`${where}: no component`);
      const first = seen.get(def.id);
      if (first !== undefined) problems.push(`${where}: id already used in ${first}`);
      else seen.set(def.id, path);
      panels.push(def);
    }
  }
  if (problems.length > 0) throw new Error(`Panel registration failed:\n${problems.join('\n')}`);
  return panels.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The panels of one slot that show in the mode, in order. */
export function panelsIn(panels: readonly PanelDef[], slot: PanelSlot, mode: EditorMode): PanelDef[] {
  return panels.filter((p) => p.slot === slot && (p.modes === undefined || p.modes.includes(mode)));
}
