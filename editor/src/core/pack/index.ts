/**
 * The pack model (editor.md §3.5): the files of an opened pack, its declarations and
 * names, what the journal's ops did to it, and what saving writes.
 */

export {
  CONVERSION_MARKER,
  MCMETA,
  SUPPORTED_FORMAT,
  classify,
  fileKind,
  findPackRoot,
  langPath,
  lightNameKey,
  modelPath,
  railNameKey,
  railPath,
  typePath,
  wagonNameKey,
  type Declaration,
  type DeclarationKind,
  type FileKind,
  type PackRoot,
} from './layout';
export { Pack, PackError, putJson, type FileStatus, type NameEntry, type PackErrorCode, type PackMeta, type StockEntry } from './pack';
