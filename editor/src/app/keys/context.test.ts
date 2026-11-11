import { afterEach, describe, expect, it } from 'vitest';
import { contextOf, isTextEntry, watchEdits } from './context';

afterEach(() => {
  document.body.innerHTML = '';
});

/** Makes an element of the HTML given, in the page, and returns it. */
function put(html: string, select: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.querySelector(select) as HTMLElement;
}

/** A keydown on an element, as the dispatcher is given it. */
function pressOn(target: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('isTextEntry', () => {
  it('is true where the keys are text and false for everything else that takes the focus', () => {
    const text = (html: string, select = 'input, textarea, select, div') => isTextEntry(put(html, select));
    expect(text('<input>')).toBe(true);
    expect(text('<input type="text">')).toBe(true);
    expect(text('<input type="search">')).toBe(true);
    expect(text('<input type="number">')).toBe(true);
    expect(text('<textarea></textarea>')).toBe(true);
    expect(text('<select><option>a</option></select>')).toBe(true);
    expect(text('<input type="checkbox">')).toBe(false);
    expect(text('<input type="radio">')).toBe(false);
    expect(text('<input type="range">')).toBe(false);
    expect(text('<input type="file">')).toBe(false);
    expect(text('<button>x</button>', 'button')).toBe(false);
    expect(text('<div tabindex="0">x</div>')).toBe(false);
  });

  it('is true for an editable element, false for nothing at all', () => {
    const editable = put('<div contenteditable="true">x</div>', 'div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isTextEntry(editable)).toBe(true);
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(document)).toBe(false);
  });
});

describe('contextOf', () => {
  it('knows whether the focus is in a text field', () => {
    const input = put('<input>', 'input');
    expect(contextOf(pressOn(input), false).typing).toBe(true);
    const button = put('<button>x</button>', 'button');
    expect(contextOf(pressOn(button), false).typing).toBe(false);
  });

  it('knows an open modal dialog', () => {
    const button = put('<button>x</button><dialog></dialog>', 'button');
    expect(contextOf(pressOn(button), false).modal).toBe(false);
    document.querySelector('dialog')?.setAttribute('open', '');
    expect(contextOf(pressOn(button), false).modal).toBe(true);
  });

  it('knows the 3D view’s panel and a tool’s places, the latter only while a tool is on', () => {
    document.body.innerHTML = '<div data-keys-scope="view tool"><button id="bar">bar</button></div><section data-keys-scope="tool"><button id="tool">t</button></section><button id="elsewhere">e</button>';
    const get = (id: string) => document.getElementById(id) as HTMLElement;
    expect(contextOf(pressOn(get('bar')), true)).toMatchObject({ view: true, tool: true });
    expect(contextOf(pressOn(get('bar')), false)).toMatchObject({ view: true, tool: false });
    expect(contextOf(pressOn(get('tool')), true)).toMatchObject({ view: false, tool: true });
    expect(contextOf(pressOn(get('elsewhere')), true)).toMatchObject({ view: false, tool: false, list: null });
  });

  it('knows a tree and a list by their mark', () => {
    document.body.innerHTML = '<ul data-roving="tree"><li><div id="node" data-roving-item="a">a</div></li></ul><ol data-roving="list"><li><button id="item" data-roving-item="b">b</button></li></ol><ul data-roving="other"><li id="odd">c</li></ul>';
    const get = (id: string) => document.getElementById(id) as HTMLElement;
    expect(contextOf(pressOn(get('node')), false).list).toBe('tree');
    expect(contextOf(pressOn(get('item')), false).list).toBe('list');
    expect(contextOf(pressOn(get('odd')), false).list).toBeNull();
  });

  it('gives a plain context for a key that came from the page itself', () => {
    expect(contextOf(pressOn(document), true)).toEqual({ typing: false, edited: false, modal: false, view: false, tool: false, list: null });
  });
});

describe('watchEdits', () => {
  it('marks a text field from its first typing until it is committed, left or given up with Escape', () => {
    const input = put('<input>', 'input');
    const stop = watchEdits(document);
    try {
      expect(contextOf(pressOn(input), false).edited).toBe(false);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(contextOf(pressOn(input), false).edited).toBe(true);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      expect(contextOf(pressOn(input), false).edited).toBe(false);

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('focusout', { bubbles: true }));
      expect(contextOf(pressOn(input), false).edited).toBe(false);

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      expect(contextOf(pressOn(input), false).edited).toBe(true);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(contextOf(pressOn(input), false).edited).toBe(false);
    } finally {
      stop();
    }
    // stopped: typing is no longer seen
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(contextOf(pressOn(input), false).edited).toBe(false);
  });
});
