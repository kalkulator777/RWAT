/**
 * The editor has one key handler (docs/proposals/editor.md §6.3). This reads the sources
 * and holds the line: the only places that listen for keys are the dispatcher and the
 * widgets whose pattern asks them to (tabs, splitters, a text field's Enter and Escape, a
 * list item's Delete, a dialog's Tab), and the keys they use are in the key map as keys of
 * a widget. A new `onKeyDown` anywhere else fails here until it goes through the map.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEY_ACTIONS } from './actions';
import { parseChord } from './chords';

const SRC = join(__dirname, '..', '..');

/** The files that may listen for keys, and why. */
const LISTENERS: Readonly<Record<string, string>> = {
  'app/keys/context.ts': 'follows the typing in text fields (Escape gives it up); presses nothing',
  'app/keys/modal.ts': 'a dialog keeps Tab inside',
  'app/keys/wire.ts': 'the one dispatcher',
  'app/SlotTabs.tsx': 'tabs: arrows, Home and End (WAI-ARIA tabs)',
  'app/Splitter.tsx': 'splitters: arrows, Home and End (WAI-ARIA window splitter)',
  'forms/Field.tsx': 'a text field of the forms: Enter adds, Escape brings the old value back',
  'panels/names/NameInput.tsx': 'a text field: Escape brings the old value back',
  'panels/sounds/SoundsPanel.tsx': 'a text field: Escape, Enter',
  'tools/common/inputs.tsx': 'a text field: Escape brings the old value back',
  'tools/floor/FloorInspector.tsx': 'an item of the zones list: Delete',
  'tools/doors/DoorsInspector.tsx': 'an item of the doors list: Delete',
  'tools/seats/SeatsInspector.tsx': 'an item of the chairs list: Delete',
};

/** The sources of the editor that run in the page: no tests, no files for Node. */
function sources(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((name) => name.split(sep).join('/'))
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.node\.ts$/.test(name));
}

const LISTENS = /\bonKey(?:Down|Up|Press)\b|addEventListener\(\s*['"]key(?:down|up|press)['"]/;

describe('the sources', () => {
  it('listen for keys only where the key map says a widget does', () => {
    const found = sources().filter((name) => LISTENS.test(readFileSync(join(SRC, name), 'utf8')));
    expect(found.sort()).toEqual(Object.keys(LISTENERS).sort());
  });

  it('use no keys in those widgets that the map does not list as theirs', () => {
    const widgetKeys = new Set(KEY_ACTIONS.filter((action) => action.widget !== undefined).flatMap((action) => action.keys.map((chord) => parseChord(chord).key)));
    const named = /'(Arrow(?:Up|Down|Left|Right)|Home|End|Enter|Escape|Delete|Backspace|Tab|PageUp|PageDown)'/g;
    for (const name of Object.keys(LISTENERS)) {
      if (name.startsWith('app/keys/')) continue;
      const text = readFileSync(join(SRC, name), 'utf8');
      const used = new Set([...text.matchAll(named)].map((match) => match[1] as string));
      for (const key of used) expect(widgetKeys.has(key), `${name} listens for ${key}, which the key map does not list`).toBe(true);
    }
  });
});
