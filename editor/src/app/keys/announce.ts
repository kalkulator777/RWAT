/**
 * What the editor says to a screen reader when a key did something that has no other
 * sound: a tool switched on from the keyboard, a finding visited. {@link announce} sets
 * the text; the live region that speaks it is {@link Announcer}, drawn once in the top bar
 * (./KeysButton.tsx).
 */

import { signal } from '@preact/signals';

/** The text the live region holds now. */
export const announcement = signal('');

/** A non-breaking space, built here rather than typed: the source stays free of invisible characters. */
const NBSP = String.fromCharCode(0xa0);

let flip = false;

/** Says `text` politely. The same text again is said again: the region's text changes by a non-breaking space. */
export function announce(text: string): void {
  flip = !flip;
  announcement.value = flip ? text : text + NBSP;
}
