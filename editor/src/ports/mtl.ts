/**
 * The port of `client/render/model/MtlParser.java`: what an MTL says (material → the
 * path of its diffuse map, as written) and the paths in it. Golden:
 * fixtures/golden/mtl/ (reference Java; Python ports the material name and the reading
 * of an MTL in tools/ir2rwat.py `material_name`, `parse_mtl`).
 *
 * The file's text is read as Java reads it, and the helpers for that live here, the
 * lowest of the model readers (./obj.ts and ./anim.ts take them from this module):
 *
 * - lines end at `\n`, `\r` or `\r\n` (`BufferedReader.readLine`), a lone `\r` too;
 * - `String.trim` drops the characters up to U+0020 at both ends, and nothing else
 *   (a no-break space stays);
 * - a blank after a keyword is `Character.isWhitespace` (ASCII blanks, U+001C…U+001F
 *   and the Unicode spaces but the no-break ones).
 *
 * The function names are the Java methods' (`parse`, `materialName`, `resolve`,
 * `folderOf`, `fileNameOf`), so `import * as Mtl from './mtl'` reads as the engine.
 * Pure: no DOM, it runs in a worker and in Node.
 */

/** `String.trim`: the characters up to U+0020 dropped at both ends. */
export function javaTrim(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) <= 0x20) start++;
  while (end > start && text.charCodeAt(end - 1) <= 0x20) end--;
  return start === 0 && end === text.length ? text : text.slice(start, end);
}

/** The lines of a text as `BufferedReader.readLine` gives them: ends `\n`, `\r`, `\r\n`; no line after a last line end. */
export function javaLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * `Character.isWhitespace` of a UTF-16 unit: `\t \n \u000B \f \r`, U+001C…U+001F and the
 * space, line and paragraph separators (Zs, Zl, Zp) but the no-break spaces U+00A0,
 * U+2007, U+202F.
 */
export function isJavaWhitespace(unit: number): boolean {
  if (unit <= 0x20) return unit === 0x20 || (unit >= 0x09 && unit <= 0x0d) || (unit >= 0x1c && unit <= 0x1f);
  return (
    unit === 0x1680 ||
    (unit >= 0x2000 && unit <= 0x200a && unit !== 0x2007) ||
    unit === 0x2028 ||
    unit === 0x2029 ||
    unit === 0x205f ||
    unit === 0x3000
  );
}

/**
 * `MtlParser.materialName`: the material a `newmtl` or `usemtl` line names — everything
 * after the keyword and the blank behind it, trimmed, the blanks inside kept
 * (`usemtl Dark Wood` is `Dark Wood`, as Blender reads both keywords).
 *
 * @returns the name, or null if the line isn't a `keyword` line or names nothing
 */
export function materialName(line: string, keyword: string): string | null {
  const trimmed = javaTrim(line);
  if (!trimmed.startsWith(keyword) || trimmed.length === keyword.length || !isJavaWhitespace(trimmed.charCodeAt(keyword.length))) {
    return null;
  }
  const name = javaTrim(trimmed.slice(keyword.length));
  return name === '' ? null : name;
}

const MAP_KD = 'map_Kd ';

/**
 * `MtlParser.parse`: material → the path of its `map_Kd`, as written (relative to the
 * MTL's folder, `../` allowed; options before the path stay part of it). Materials
 * without a diffuse map are absent; a material named again keeps its place and takes
 * the later map. A Map, not an object: it keeps the order of names that look like
 * numbers.
 */
export function parse(text: string): Map<string, string> {
  const maps = new Map<string, string>();
  let material: string | null = null;
  for (const raw of javaLines(text)) {
    const line = javaTrim(raw);
    const named = materialName(line, 'newmtl');
    if (named !== null) {
      material = named;
    } else if (line.startsWith(MAP_KD) && material !== null) {
      maps.set(material, javaTrim(line.slice(MAP_KD.length)));
    }
  }
  return maps;
}

/**
 * `MtlParser.resolve`: a relative path joined onto a folder and normalised — backslashes
 * become slashes, empty and `.` segments drop, `..` pops a folder.
 *
 * @param folder the folder, without a trailing slash; may be empty
 * @param relative the path as written in the file
 * @returns the path, or null if it climbs above the root
 */
export function resolve(folder: string, relative: string): string | null {
  const segments: string[] = [];
  const joined = (folder === '' ? '' : `${folder}/`) + relative.replaceAll('\\', '/');
  for (const segment of joined.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join('/');
}

/** `MtlParser.folderOf`: the folder part of a path (`a/b/c.obj` → `a/b`), empty for a bare name. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** `MtlParser.fileNameOf`: the file-name part of a path (`a/b/c.png` → `c.png`). */
export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
