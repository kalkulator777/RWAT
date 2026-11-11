/**
 * The editor's keyboard (docs/proposals/editor.md §6.3): the key map, the one dispatcher,
 * the Keys window, the arrow-key movement in trees and lists, and the focus of modal windows.
 *
 * - ./actions.ts — the map: every shortcut, its chords per platform and its scope;
 * - ./dispatch.ts, ./context.ts, ./wire.ts — the one `keydown` handler and what each action does;
 * - ./roving.ts — arrows in trees and lists, the tab stop of a long list;
 * - ./modal.ts — modal windows: Tab stays inside, the focus goes back;
 * - ./reference.ts, ./KeysDialog.tsx — the map for people.
 */

export { KEY_ACTIONS, KEY_SCOPES, chordsOf, type KeyAction, type KeyScope, type KeyWidget } from './actions';
export { announce } from './announce';
export { detectPlatform, formatChord, matchChord, parseChord, type Chord, type Platform } from './chords';
export { createDispatcher, findAction, type ActionHandler, type Handlers, type KeyContext } from './dispatch';
export { KeysPanel } from './KeysButton';
export { useModalDialog } from './modal';
export { keyReference, type KeyReferenceRow } from './reference';
export { itemOf, moveFocus, useRoving } from './roving';
export { keysDialogOpen } from './state';
export { editorHandlers, installKeys } from './wire';
