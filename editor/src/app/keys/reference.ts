/**
 * The key map as a reference for people: the Keys window draws it, and the help
 * (src/help) can list the same rows, so that no second list of shortcuts exists.
 *
 * `keyReference()` gives one row per action of ./actions.ts with its title in both
 * languages and its chords written for each platform (`Ctrl+Shift+Z`, `⌘⇧Z`).
 */

import { catalog, type Lang } from '../../i18n';
import { KEY_ACTIONS, chordsOf, type KeyAction, type KeyScope, type KeyWidget } from './actions';
import { formatChord, parseChord, type Platform } from './chords';

export interface KeyReferenceRow {
  readonly id: string;
  readonly scope: KeyScope;
  /** Set for keys that a control handles itself. */
  readonly widget?: KeyWidget;
  /** What the keys do, in each interface language. */
  readonly title: Readonly<Record<Lang, string>>;
  /** The chords as the user reads them, per platform. */
  readonly keys: Readonly<Record<Platform, readonly string[]>>;
}

/** The i18n key of an action's title. */
export function actionTitleKey(action: Pick<KeyAction, 'id'>): string {
  return `keys.action.${action.id}`;
}

function written(action: KeyAction, platform: Platform): string[] {
  return chordsOf(action, platform).map((chord) => formatChord(parseChord(chord), platform));
}

/** Every action of the key map with its title and its keys; the order is the map's, grouped by scope. */
export function keyReference(actions: readonly KeyAction[] = KEY_ACTIONS): KeyReferenceRow[] {
  return actions.map((action) => ({
    id: action.id,
    scope: action.scope,
    ...(action.widget === undefined ? {} : { widget: action.widget }),
    title: {
      ru: catalog.get('ru', actionTitleKey(action)) ?? action.id,
      en: catalog.get('en', actionTitleKey(action)) ?? action.id,
    },
    keys: { pc: written(action, 'pc'), mac: written(action, 'mac') },
  }));
}
