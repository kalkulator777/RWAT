/**
 * The journal as JSON (editor.md §3.5): what the session's autosave keeps in IndexedDB
 * after every command (M5) and what the replay tests read (`editor/test/replay/`).
 *
 * `{"format": 1, "committed": [...], "done": [...], "undone": [...]}`, each command
 * `{"label", "labelParams"?, "coalesceKey"?, "ops": [...]}` with its ops as in
 * `contracts.ts`, except that a `putFile` carries its bytes as base64 (`"base64"`) in
 * place of `bytes`. Reading checks the shape and refuses anything else.
 */

import type { Command, Op } from '../contracts';
import type { JournalState } from './journal';

/** The version of the serialized form. */
export const JOURNAL_FORMAT = 1;

/** A serialized journal that is not one. */
export class JournalFormatError extends Error {
  constructor(where: string, reason: string) {
    super(`not a journal: ${where}: ${reason}`);
    this.name = 'JournalFormatError';
  }
}

const CHUNK = 0x8000;

/** Bytes as base64 (RFC 4648, padded). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** Base64 back to bytes; throws on what is not base64. */
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function opToJson(op: Op): unknown {
  return op.op === 'putFile' ? { op: 'putFile', file: op.file, base64: toBase64(op.bytes) } : op;
}

function commandToJson(command: Command): unknown {
  return { ...command, ops: command.ops.map(opToJson) };
}

/** The journal state as JSON text. */
export function serializeJournal(state: JournalState): string {
  return JSON.stringify({
    format: JOURNAL_FORMAT,
    committed: state.committed.map(commandToJson),
    done: state.done.map(commandToJson),
    undone: state.undone.map(commandToJson),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new JournalFormatError(where, `"${key}" must be a string`);
  return value;
}

function opFromJson(json: unknown, where: string): Op {
  if (!isRecord(json)) throw new JournalFormatError(where, 'an op must be an object');
  const file = text(json, 'file', where);
  switch (json.op) {
    case 'set':
    case 'insert':
      if (!('value' in json)) throw new JournalFormatError(where, `"${json.op}" needs a value`);
      return { op: json.op, file, at: text(json, 'at', where), value: json.value };
    case 'remove':
      return { op: 'remove', file, at: text(json, 'at', where) };
    case 'putFile':
      try {
        return { op: 'putFile', file, bytes: fromBase64(text(json, 'base64', where)) };
      } catch (error) {
        if (error instanceof JournalFormatError) throw error;
        throw new JournalFormatError(where, '"base64" is not base64');
      }
    case 'deleteFile':
      return { op: 'deleteFile', file };
    case 'renameFile':
      return { op: 'renameFile', file, to: text(json, 'to', where) };
    default:
      throw new JournalFormatError(where, `unknown op ${JSON.stringify(json.op)}`);
  }
}

function commandFromJson(json: unknown, where: string): Command {
  if (!isRecord(json)) throw new JournalFormatError(where, 'a command must be an object');
  if (!Array.isArray(json.ops)) throw new JournalFormatError(where, '"ops" must be an array');
  const command: Command = { label: text(json, 'label', where), ops: json.ops.map((op, i) => opFromJson(op, `${where}.ops[${i}]`)) };
  if (json.labelParams !== undefined) {
    const params = json.labelParams;
    if (!isRecord(params) || !Object.values(params).every((v) => typeof v === 'string' || typeof v === 'number')) {
      throw new JournalFormatError(where, '"labelParams" must map names to strings or numbers');
    }
    command.labelParams = params as Record<string, string | number>;
  }
  if (json.coalesceKey !== undefined) command.coalesceKey = text(json, 'coalesceKey', where);
  return command;
}

/** The journal state from JSON text written by {@link serializeJournal}; throws {@link JournalFormatError}. */
export function parseJournal(json: string): JournalState {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new JournalFormatError('the text', 'not JSON');
  }
  if (!isRecord(data)) throw new JournalFormatError('the text', 'must hold an object');
  const record = data;
  if (record.format !== JOURNAL_FORMAT) throw new JournalFormatError('format', `must be ${JOURNAL_FORMAT}, not ${JSON.stringify(record.format)}`);
  const list = (key: 'committed' | 'done' | 'undone'): Command[] => {
    const value = record[key];
    if (!Array.isArray(value)) throw new JournalFormatError(key, 'must be an array');
    return value.map((command, i) => commandFromJson(command, `${key}[${i}]`));
  };
  return { committed: list('committed'), done: list('done'), undone: list('undone') };
}
