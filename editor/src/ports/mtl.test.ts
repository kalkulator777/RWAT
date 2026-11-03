/**
 * Golden runner of fixtures/golden/mtl/ (editor.md §4.5; fixtures/golden/README.md): the
 * port ./mtl.ts against `MtlParser` (`materialName`, `parse`, `resolve`, `folderOf`,
 * `fileNameOf`), the reference that writes the expected. Everything of the folder is
 * compared: names, the reading of an MTL (material → map, in order), the paths.
 * Then the Java text rules the model readers share (`String.trim`, `readLine`,
 * `Character.isWhitespace`) on what the cases leave out.
 */

import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../testing/repo.node';
import { mismatch, readGoldenFolder } from '../testing/goldenCases.node';
import { fileNameOf, folderOf, isJavaWhitespace, javaLines, javaTrim, materialName, parse, resolve } from './mtl';

const FOLDER = `${REPO_ROOT}fixtures/golden/mtl`;

interface Input {
  line?: string;
  keyword?: string;
  text?: string;
  resolve?: [string, string];
  folder_of?: string;
  file_name_of?: string;
}

/** What the port makes of a case's input, as the Java runner (MtlGolden) asks it. */
function compute(input: Input): unknown {
  if (input.line !== undefined) return materialName(input.line, input.keyword!);
  if (input.text !== undefined) return parse(input.text);
  if (input.resolve !== undefined) return resolve(...input.resolve);
  if (input.folder_of !== undefined) return folderOf(input.folder_of);
  return fileNameOf(input.file_name_of!);
}

const golden = readGoldenFolder(FOLDER);

describe('golden mtl', () => {
  it('names this port in ports.json, and the folder follows the golden format', () => {
    expect(golden.ports).toMatchObject({ reference: 'java', ports: expect.arrayContaining(['ts']) as unknown });
    expect(golden.problems).toEqual([]);
  });

  for (const file of golden.files) {
    describe(file.name, () => {
      for (const c of file.cases) {
        it(c.id, () => {
          expect(mismatch(compute(c.input as Input), c.expected, file.tolerance), c.note).toBeNull();
        });
      }
    });
  }
});

describe('Java text rules', () => {
  it('trims only the characters up to U+0020', () => {
    expect(javaTrim('\u0000\t a b \r\n\u001f')).toBe('a b');
    expect(javaTrim(' a ')).toBe(' a ');
    expect(javaTrim('   ')).toBe('');
    const same = 'abc';
    expect(javaTrim(same)).toBe(same);
  });

  it('ends lines at LF, CR and CRLF, with no line after the last line end', () => {
    expect(javaLines('a\nb\rc\r\nd')).toEqual(['a', 'b', 'c', 'd']);
    expect(javaLines('a\n')).toEqual(['a']);
    expect(javaLines('a\n\n')).toEqual(['a', '']);
    expect(javaLines('\n')).toEqual(['']);
    expect(javaLines('')).toEqual([]);
  });

  it('takes as whitespace what Character.isWhitespace does', () => {
    const blanks = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x1680, 0x2000, 0x2006, 0x2008, 0x200a, 0x2028, 0x2029, 0x205f, 0x3000];
    const others = [0x00, 0x08, 0x0e, 0x1b, 0x21, 0x41, 0x85, 0xa0, 0x180e, 0x2007, 0x200b, 0x202f, 0xfeff];
    expect(blanks.filter((c) => !isJavaWhitespace(c))).toEqual([]);
    expect(others.filter((c) => isJavaWhitespace(c))).toEqual([]);
  });

  it('parts a keyword from a material name by any Java whitespace, not by a no-break space; trims only up to U+0020', () => {
    // U+3000 parts the keyword (Character.isWhitespace), but String.trim keeps it in the name
    expect(materialName('newmtl　Wood', 'newmtl')).toBe('　Wood');
    expect(materialName('newmtl\u001fWood', 'newmtl')).toBe('Wood');
    expect(materialName('newmtl Wood', 'newmtl')).toBeNull();
  });

  it('reads a lone CR as a line end in an MTL', () => {
    expect([...parse('newmtl a\rmap_Kd a.png\rnewmtl b\rmap_Kd b.png')]).toEqual([
      ['a', 'a.png'],
      ['b', 'b.png'],
    ]);
  });
});
