import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { installKeys } from './wire';
import { itemOf, isNativeControl, movedIndex, moveFocus, rovingItems, treeCollapse, treeExpand, treeParent, useRoving } from './roving';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('movedIndex', () => {
  it('goes to the neighbour, the first or the last, and stops at the ends', () => {
    expect(movedIndex('next', 1, 4)).toBe(2);
    expect(movedIndex('next', 3, 4)).toBe(3);
    expect(movedIndex('prev', 1, 4)).toBe(0);
    expect(movedIndex('prev', 0, 4)).toBe(0);
    expect(movedIndex('first', 2, 4)).toBe(0);
    expect(movedIndex('last', 0, 4)).toBe(3);
    expect(movedIndex('next', 0, 0)).toBe(-1);
  });
});

/** A flat list of buttons, as the findings and the tool lists are. */
function listHtml(): string {
  return '<ul data-roving="list"><li><button data-roving-item="a">a</button></li><li><button data-roving-item="b" disabled>b</button></li><li><button data-roving-item="c">c</button></li><li><button data-roving-item="d">d</button></li></ul><button id="outside">o</button>';
}

describe('moving the focus along a list', () => {
  it('goes between the items that can take it, skipping a disabled one', () => {
    document.body.innerHTML = listHtml();
    const [a, c, d] = ['a', 'c', 'd'].map((key) => document.querySelector(`[data-roving-item="${key}"]`) as HTMLElement);
    expect(rovingItems(document.querySelector('[data-roving]') as Element).map((item) => item.textContent)).toEqual(['a', 'c', 'd']);
    a?.focus();
    expect(moveFocus(a as HTMLElement, 'next')).toBe(true);
    expect(document.activeElement).toBe(c);
    moveFocus(c as HTMLElement, 'last');
    expect(document.activeElement).toBe(d);
    moveFocus(d as HTMLElement, 'next');
    expect(document.activeElement).toBe(d);
    moveFocus(d as HTMLElement, 'first');
    expect(document.activeElement).toBe(a);
    moveFocus(a as HTMLElement, 'prev');
    expect(document.activeElement).toBe(a);
  });

  it('does nothing for a place that is no item', () => {
    document.body.innerHTML = listHtml();
    const outside = document.getElementById('outside') as HTMLElement;
    expect(itemOf(outside)).toBeNull();
    expect(moveFocus(outside, 'next')).toBe(false);
    expect(itemOf(document.querySelector('[data-roving-item="a"]'))).not.toBeNull();
    expect(itemOf(null)).toBeNull();
  });

  it('knows a native control from a plain element', () => {
    document.body.innerHTML = '<button id="b">b</button><div id="d" tabindex="0">d</div><a id="a" href="#">a</a>';
    expect(isNativeControl(document.getElementById('b') as Element)).toBe(true);
    expect(isNativeControl(document.getElementById('a') as Element)).toBe(true);
    expect(isNativeControl(document.getElementById('d') as Element)).toBe(false);
  });
});

/** A tree of two branches, the first open, as the pack tree is. */
function treeHtml(): string {
  return `<ul role="tree" data-roving="tree">
    <li role="none"><div role="treeitem" id="one" aria-level="1" aria-expanded="true" data-roving-item="one" tabindex="0">one</div>
      <ul role="group"><li role="none"><div role="treeitem" id="leaf1" aria-level="2" data-roving-item="leaf1" tabindex="-1">leaf1</div></li>
      <li role="none"><div role="treeitem" id="leaf2" aria-level="2" data-roving-item="leaf2" tabindex="-1">leaf2</div></li></ul></li>
    <li role="none"><div role="treeitem" id="two" aria-level="1" aria-expanded="false" data-roving-item="two" tabindex="-1">two</div></li>
  </ul>`;
}

describe('a tree', () => {
  const get = (id: string) => document.getElementById(id) as HTMLElement;

  it('finds the parent of an item by the levels', () => {
    document.body.innerHTML = treeHtml();
    const items = rovingItems(document.querySelector('[data-roving]') as Element);
    expect(treeParent(items, get('leaf2'))).toBe(get('one'));
    expect(treeParent(items, get('one'))).toBeNull();
    expect(treeParent(items, get('two'))).toBeNull();
  });

  it('goes into an open branch with Right, to the parent with Left, and closes and opens a branch by a click on it', () => {
    document.body.innerHTML = treeHtml();
    const clicked: string[] = [];
    for (const id of ['one', 'two']) get(id).addEventListener('click', () => clicked.push(id));
    get('one').focus();
    treeExpand(get('one'));
    expect(document.activeElement).toBe(get('leaf1'));
    treeCollapse(get('leaf1'));
    expect(document.activeElement).toBe(get('one'));
    treeCollapse(get('one'));
    expect(clicked).toEqual(['one']);
    treeExpand(get('two'));
    expect(clicked).toEqual(['one', 'two']);
    // a leaf has nothing to open, a closed branch nothing to close
    treeExpand(get('leaf1'));
    treeCollapse(get('two'));
    expect(clicked).toEqual(['one', 'two']);
  });
});

describe('the keys on a tree, through the one handler', () => {
  const get = (id: string) => document.getElementById(id) as HTMLElement;

  it('moves with the arrows, opens and closes with Right and Left, and presses a plain item with Enter and Space', () => {
    document.body.innerHTML = treeHtml();
    const off = installKeys(document, { platform: 'pc' });
    try {
      const clicks: string[] = [];
      for (const id of ['leaf1', 'two']) get(id).addEventListener('click', () => clicks.push(id));
      get('one').focus();
      fireEvent.keyDown(get('one'), { key: 'ArrowDown' });
      expect(document.activeElement).toBe(get('leaf1'));
      fireEvent.keyDown(get('leaf1'), { key: 'ArrowDown' });
      fireEvent.keyDown(get('leaf2'), { key: 'ArrowDown' });
      expect(document.activeElement).toBe(get('two'));
      fireEvent.keyDown(get('two'), { key: 'ArrowUp' });
      expect(document.activeElement).toBe(get('leaf2'));
      fireEvent.keyDown(get('leaf2'), { key: 'Home' });
      expect(document.activeElement).toBe(get('one'));
      fireEvent.keyDown(get('one'), { key: 'End' });
      expect(document.activeElement).toBe(get('two'));
      fireEvent.keyDown(get('two'), { key: 'ArrowRight' });
      fireEvent.keyDown(get('two'), { key: 'Enter' });
      fireEvent.keyDown(get('leaf1'), { key: ' ' });
      expect(clicks).toEqual(['two', 'two', 'leaf1']);
    } finally {
      off();
    }
  });

  it('takes the key it uses, leaves a key it does not, and leaves a native button its own Enter', () => {
    document.body.innerHTML = `${treeHtml()}<ul data-roving="list"><li><button id="native" data-roving-item="n">n</button></li></ul>`;
    const off = installKeys(document, { platform: 'pc' });
    try {
      get('one').focus();
      expect(fireEvent.keyDown(get('one'), { key: 'ArrowDown' })).toBe(false); // fireEvent: false when the default was prevented
      expect(fireEvent.keyDown(get('one'), { key: 'a' })).toBe(true);
      expect(fireEvent.keyDown(get('native'), { key: 'Enter' })).toBe(true);
    } finally {
      off();
    }
  });
});

function Rover({ keys, preferred }: { keys: string[]; preferred?: string }) {
  const roving = useRoving(keys, preferred ?? null);
  return (
    <ul data-roving="list">
      {keys.map((key) => (
        <li key={key}>
          <button {...roving.props(key)}>{key}</button>
        </li>
      ))}
    </ul>
  );
}

describe('useRoving', () => {
  it('gives the tab stop to the first item, or the preferred one, and moves it to the item that takes the focus', () => {
    const { rerender } = render(<Rover keys={['a', 'b', 'c']} />);
    const stops = () => screen.getAllByRole('button').filter((button) => button.getAttribute('tabindex') === '0').map((button) => button.textContent);
    expect(stops()).toEqual(['a']);
    fireEvent.focus(screen.getByText('c'));
    expect(stops()).toEqual(['c']);
    rerender(<Rover keys={['a', 'b', 'c']} preferred="b" />);
    expect(stops()).toEqual(['c']);
    // the item that held the stop goes: the stop goes to the preferred one
    rerender(<Rover keys={['a', 'b']} preferred="b" />);
    expect(stops()).toEqual(['b']);
    rerender(<Rover keys={['a', 'b']} />);
    fireEvent.focus(screen.getByText('b'));
    rerender(<Rover keys={[]} />);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});
