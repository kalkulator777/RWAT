import { describe, expect, it } from 'vitest';
import { detectPlatform, formatChord, matchChord, parseChord, type KeyLike } from './chords';

/** A key event with the fields matching reads; every modifier is up unless given. */
function key(name: string, init: Partial<KeyLike> = {}): KeyLike {
  return { key: name, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init };
}

describe('parseChord', () => {
  it('reads modifiers and the key, letters in lower case', () => {
    expect(parseChord('Mod+Shift+Z')).toEqual({ mod: true, shift: true, alt: false, key: 'z' });
    expect(parseChord('Alt+PageDown')).toEqual({ mod: false, shift: false, alt: true, key: 'PageDown' });
    expect(parseChord('?')).toEqual({ mod: false, shift: false, alt: false, key: '?' });
    expect(parseChord(' ')).toEqual({ mod: false, shift: false, alt: false, key: ' ' });
  });

  it('refuses a chord with no key, an unknown modifier or a repeated one', () => {
    expect(() => parseChord('')).toThrow('no key');
    expect(() => parseChord('Mod+')).toThrow('no key');
    expect(() => parseChord('Ctrl+S')).toThrow('not a modifier');
    expect(() => parseChord('Mod+Mod+S')).toThrow('Mod twice');
    expect(() => parseChord('Shift+Shift+S')).toThrow('Shift twice');
    expect(() => parseChord('Alt+Alt+S')).toThrow('Alt twice');
  });
});

describe('matchChord', () => {
  it('takes Ctrl as the command key on a PC and ⌘ on a Mac, and the other one never', () => {
    const save = parseChord('Mod+S');
    expect(matchChord(save, key('s', { ctrlKey: true }), 'pc')).toBe(true);
    expect(matchChord(save, key('s', { metaKey: true }), 'pc')).toBe(false);
    expect(matchChord(save, key('s', { metaKey: true }), 'mac')).toBe(true);
    expect(matchChord(save, key('s', { ctrlKey: true }), 'mac')).toBe(false);
    expect(matchChord(save, key('s', { ctrlKey: true, metaKey: true }), 'pc')).toBe(false);
    expect(matchChord(save, key('s'), 'pc')).toBe(false);
  });

  it('wants exactly the modifiers the chord names', () => {
    const redo = parseChord('Mod+Shift+Z');
    expect(matchChord(redo, key('Z', { ctrlKey: true, shiftKey: true }), 'pc')).toBe(true);
    expect(matchChord(redo, key('z', { ctrlKey: true }), 'pc')).toBe(false);
    expect(matchChord(redo, key('Z', { ctrlKey: true, shiftKey: true, altKey: true }), 'pc')).toBe(false);
    expect(matchChord(parseChord('Mod+Z'), key('z', { ctrlKey: true, shiftKey: true }), 'pc')).toBe(false);
    expect(matchChord(parseChord('F8'), key('F8', { altKey: true }), 'pc')).toBe(false);
  });

  it('matches a letter by its place when the layout types no Latin letter there', () => {
    const undo = parseChord('Mod+Z');
    // Russian layout: the key of Z types я
    expect(matchChord(undo, key('я', { code: 'KeyZ', ctrlKey: true }), 'pc')).toBe(true);
    expect(matchChord(undo, key('я', { code: 'KeyY', ctrlKey: true }), 'pc')).toBe(false);
    // ⌥ on a Mac types a symbol; the place says which key it was
    expect(matchChord(parseChord('Alt+Z'), key('Ω', { code: 'KeyZ', altKey: true }), 'mac')).toBe(true);
    // a Latin layout is matched by the letter it types, not by where the key is
    expect(matchChord(undo, key('y', { code: 'KeyZ', ctrlKey: true }), 'pc')).toBe(false);
  });

  it('matches digits on the top row and the keypad, symbols whatever Shift they need', () => {
    const top = parseChord('7');
    expect(matchChord(top, key('7', { code: 'Digit7' }), 'pc')).toBe(true);
    expect(matchChord(top, key('7', { code: 'Numpad7' }), 'pc')).toBe(true);
    expect(matchChord(top, key('Home', { code: 'Numpad7' }), 'pc')).toBe(true); // keypad with Num Lock off
    expect(matchChord(top, key('&', { code: 'Digit7', shiftKey: true }), 'pc')).toBe(false);
    const dot = parseChord('.');
    expect(matchChord(dot, key('.', { code: 'Period' }), 'pc')).toBe(true);
    expect(matchChord(dot, key('Delete', { code: 'NumpadDecimal' }), 'pc')).toBe(true);
    const question = parseChord('?');
    expect(matchChord(question, key('?', { shiftKey: true }), 'pc')).toBe(true);
    expect(matchChord(question, key('?'), 'pc')).toBe(true);
    expect(matchChord(question, key('?', { ctrlKey: true }), 'pc')).toBe(false);
  });

  it('is case-sensitive for named keys and takes Shift as part of a letter chord only', () => {
    expect(matchChord(parseChord('Escape'), key('Escape'), 'pc')).toBe(true);
    expect(matchChord(parseChord('Escape'), key('escape'), 'pc')).toBe(false);
    expect(matchChord(parseChord('Z'), key('Z', { shiftKey: true }), 'pc')).toBe(false);
    expect(matchChord(parseChord('Z'), key('z'), 'pc')).toBe(true);
    expect(matchChord(parseChord(' '), key(' '), 'pc')).toBe(true);
  });
});

describe('formatChord', () => {
  it('writes a chord the way the platform does', () => {
    const redo = parseChord('Mod+Shift+Z');
    expect(formatChord(redo, 'pc')).toBe('Ctrl+Shift+Z');
    expect(formatChord(redo, 'mac')).toBe('⇧⌘Z');
    expect(formatChord(parseChord('Alt+PageDown'), 'pc')).toBe('Alt+PgDn');
    expect(formatChord(parseChord('Alt+PageDown'), 'mac')).toBe('⌥PgDn');
    expect(formatChord(parseChord('ArrowUp'), 'pc')).toBe('↑');
    expect(formatChord(parseChord('Escape'), 'pc')).toBe('Esc');
    expect(formatChord(parseChord(' '), 'pc')).toBe('Space');
    expect(formatChord(parseChord('.'), 'pc')).toBe('.');
    expect(formatChord(parseChord('s'), 'pc')).toBe('S');
  });
});

describe('detectPlatform', () => {
  it('is a Mac for a Mac, an iPad or an iPhone, a PC otherwise', () => {
    expect(detectPlatform({ platform: 'MacIntel' })).toBe('mac');
    expect(detectPlatform({ platform: 'iPad' })).toBe('mac');
    expect(detectPlatform({ userAgentData: { platform: 'macOS' }, platform: 'Linux' })).toBe('mac');
    expect(detectPlatform({ platform: 'Win32' })).toBe('pc');
    expect(detectPlatform({ platform: 'Linux x86_64' })).toBe('pc');
    expect(detectPlatform(null)).toBe('pc');
  });
});
