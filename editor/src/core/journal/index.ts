/**
 * The journal of edits (editor.md §3.5): commands, undo and redo, merged drags, and the
 * journal as JSON for the session's autosave and the replay tests.
 */

export { JOURNAL_DEPTH, Journal, type JournalState, type OpTarget } from './journal';
export { JOURNAL_FORMAT, JournalFormatError, fromBase64, parseJournal, serializeJournal, toBase64 } from './serialize';
