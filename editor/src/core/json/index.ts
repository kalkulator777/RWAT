/**
 * The pack's JSON (editor.md §3.6): pointers (RFC 6901), values that are never changed
 * in place, minimal edits of a file's text, and `dump` — the port of tools/ir2rwat.py
 * `dump` that writes new files as the converter and the example pack's generator do.
 */

export { DUMP_STYLE, dump, dumpBytes, encodeInline, encodeValue, type TextStyle } from './dump';
export { detectStyle, editJson, type EditResult } from './edit';
export { formatLexeme, formatNumber, isFloatLexeme, pythonFloat } from './numbers';
export { JsonNumber, JsonSyntaxError, parseJson, parseLossless, splitBom } from './parse';
export { PointerError, arrayIndex, childPointer, escapeSegment, formatPointer, getAt, isPrefixPointer, parsePointer } from './pointer';
export { ValuePathError, deepEqual, insertIn, isJsonObject, removeIn, setIn, type Previous } from './value';
