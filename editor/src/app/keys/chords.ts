/**
 * Key chords: how the key map writes them down, how a keyboard event is matched against
 * one, and how one is shown to the user (docs/proposals/editor.md §6.3).
 *
 * A chord is written as modifiers and a key joined by `+`: `Mod+Shift+Z`, `F8`, `Alt+PageDown`,
 * `?`, `1`, `Home`. `Mod` is the platform's command key: Ctrl on Windows and Linux, ⌘ on a
 * Mac. The other modifiers are `Shift` and `Alt`. The key is a name of `KeyboardEvent.key`
 * (`ArrowUp`, `Escape`, `F8`), or a letter, a digit or a symbol as typed.
 *
 * Matching knows two things a plain `event.key` comparison misses:
 * - a letter is matched by the key's place too (`event.code`) when the layout types no Latin
 *   letter there, so `Ctrl+Я` on a Russian layout is `Ctrl+Z`, as the browser's own
 *   shortcuts are;
 * - the modifier a chord does not name must not be down (`Ctrl+Z` is not `Ctrl+Alt+Z`),
 *   and on each platform the other platform's command key is never part of a chord.
 *
 * No DOM here: the functions read the fields of an event, which the tests make by hand.
 */

/** The platforms the key map has its own keys for. */
export type Platform = 'pc' | 'mac';

/** One chord, parsed. `key` is a `KeyboardEvent.key` name, or one lower-case letter, digit or symbol. */
export interface Chord {
  /** The platform's command key: Ctrl on a PC, ⌘ on a Mac. */
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly key: string;
}

/** The fields of a keyboard event that matching reads. */
export interface KeyLike {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** The platform of a browser: a Mac (also an iPad or iPhone) by its platform string, else a PC. */
export function detectPlatform(nav: unknown = globalThis.navigator): Platform {
  const info = nav as { userAgentData?: { platform?: string }; platform?: string } | undefined;
  const name = info?.userAgentData?.platform ?? info?.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(name) ? 'mac' : 'pc';
}

const MODIFIERS = new Set(['mod', 'shift', 'alt']);

/** Parses a chord as the key map writes it; throws on a chord with no key, a repeated modifier or an unknown one. */
export function parseChord(text: string): Chord {
  const parts = text.split('+');
  const key = parts.pop();
  if (key === undefined || key === '') throw new Error(`chord '${text}' has no key`);
  let mod = false;
  let shift = false;
  let alt = false;
  for (const raw of parts) {
    const name = raw.toLowerCase();
    if (!MODIFIERS.has(name)) throw new Error(`chord '${text}': '${raw}' is not a modifier (Mod, Shift, Alt)`);
    if (name === 'mod') {
      if (mod) throw new Error(`chord '${text}': Mod twice`);
      mod = true;
    } else if (name === 'shift') {
      if (shift) throw new Error(`chord '${text}': Shift twice`);
      shift = true;
    } else {
      if (alt) throw new Error(`chord '${text}': Alt twice`);
      alt = true;
    }
  }
  return { mod, shift, alt, key: key.length === 1 ? key.toLowerCase() : key };
}

/** True for a key typed as a symbol (`?`, `.`): the Shift its layout needs for it is not part of the chord. */
function isSymbol(key: string): boolean {
  return key.length === 1 && !/[a-z0-9]/.test(key);
}

/** True for a character of ASCII: what a Latin layout types. */
function isAscii(text: string): boolean {
  return text.length === 1 && text.charCodeAt(0) < 128;
}

/** Whether the event's key is the chord's key (modifiers aside). */
function sameKey(chord: Chord, event: KeyLike): boolean {
  const { key } = chord;
  if (/^[a-z]$/.test(key)) {
    if (event.key.toLowerCase() === key) return true;
    // a layout that types no Latin letter here (Cyrillic, or ⌥ on a Mac): the key's place says which it is
    return !isAscii(event.key) && event.code === `Key${key.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(key)) return event.key === key || event.code === `Digit${key}` || event.code === `Numpad${key}`;
  if (key === '.') return event.key === '.' || event.code === 'NumpadDecimal';
  return event.key === key;
}

/** Whether a keyboard event is the chord, on the platform. */
export function matchChord(chord: Chord, event: KeyLike, platform: Platform): boolean {
  const command = platform === 'mac' ? event.metaKey : event.ctrlKey;
  const foreign = platform === 'mac' ? event.ctrlKey : event.metaKey;
  if (foreign || command !== chord.mod || event.altKey !== chord.alt) return false;
  if (!sameKey(chord, event)) return false;
  return isSymbol(chord.key) || event.shiftKey === chord.shift;
}

const NAMES: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  PageDown: 'PgDn',
  PageUp: 'PgUp',
  ' ': 'Space',
};

/** A chord as the user reads it: `Ctrl+Shift+Z` on a PC, `⌘⇧Z` on a Mac. */
export function formatChord(chord: Chord, platform: Platform): string {
  const key = NAMES[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  if (platform === 'mac') return `${chord.alt ? '⌥' : ''}${chord.shift ? '⇧' : ''}${chord.mod ? '⌘' : ''}${key}`;
  return [chord.mod ? 'Ctrl' : '', chord.alt ? 'Alt' : '', chord.shift ? 'Shift' : '', key].filter((part) => part !== '').join('+');
}
