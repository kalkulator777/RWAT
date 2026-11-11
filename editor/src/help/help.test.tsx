/**
 * The help (./topics.ts, ./Help.tsx): every topic in both languages and the two the same
 * help — the same links to other topics and out, the same keys, the same buttons named —;
 * no link to a topic that is not there, no topic nobody links to, no label that is no
 * string of the interface; Russian in Russian, English without Cyrillic. In the page: the
 * top bar's button opens it at the start, a link opens its topic in place, the language
 * switch changes it, Escape and «Close» close it.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { panels } from '../app/panels';
import { catalog, placeholders, setLang, type Lang } from '../i18n';
import { HelpButton, helpTopic, openHelp } from './Help';
import { inlines, parseHelp, parseInline, type Inline } from './markup';
import { TOPICS } from './topics';

const LANGS: readonly Lang[] = ['ru', 'en'];

function parts(id: string, lang: Lang): Inline[] {
  const found = TOPICS.find((t) => t.id === id);
  if (found === undefined) throw new Error(`no topic ${id}`);
  return inlines(parseHelp(found.body[lang]));
}

function sorted(list: string[]): string[] {
  return [...list].sort();
}

describe('the help’s markup', () => {
  it('reads headings, lists, numbered lists and paragraphs, and code, keys, stress, labels and links in a line', () => {
    expect(parseHelp('## A\n- one\n- two\n\n1. first\n2. second\n\nsome\ntext\n\n## B')).toEqual([
      { kind: 'heading', inline: [{ kind: 'text', text: 'A' }] },
      { kind: 'list', ordered: false, items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]] },
      { kind: 'list', ordered: true, items: [[{ kind: 'text', text: 'first' }], [{ kind: 'text', text: 'second' }]] },
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'some text' }] },
      { kind: 'heading', inline: [{ kind: 'text', text: 'B' }] },
    ]);
    // no topic's text has a heading or a list mark left in a paragraph
    for (const topic of TOPICS) {
      for (const lang of LANGS) {
        for (const block of parseHelp(topic.body[lang])) {
          if (block.kind !== 'paragraph') continue;
          const text = block.inline.map((p) => (p.kind === 'text' ? p.text : '')).join('');
          expect(text, `${topic.id} (${lang})`).not.toMatch(/##|(?:^|\s)- |(?:^|\s)\d+\. [A-ZА-Я]/);
        }
      }
    }
    expect(parseInline('a `x` {{Ctrl+Z}} **b** [[file.save]] [c](#keys) [d](https://e.org/f) g')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'code', text: 'x' },
      { kind: 'text', text: ' ' },
      { kind: 'key', text: 'Ctrl+Z' },
      { kind: 'text', text: ' ' },
      { kind: 'strong', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'label', key: 'file.save' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'c', topic: 'keys' },
      { kind: 'text', text: ' ' },
      { kind: 'external', text: 'd', href: 'https://e.org/f' },
      { kind: 'text', text: ' g' },
    ]);
  });
});

describe('the help’s topics', () => {
  it('have unique ids, a title and a text in each language', () => {
    const ids = TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('start');
    for (const topic of TOPICS) {
      expect(topic.id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
      for (const lang of LANGS) {
        expect(topic.title[lang].trim(), `${topic.id} ${lang}`).not.toBe('');
        expect(parseHelp(topic.body[lang]).length, `${topic.id} ${lang}`).toBeGreaterThan(0);
      }
    }
  });

  it('say the same in both languages: the same blocks, links, keys and buttons', () => {
    for (const topic of TOPICS) {
      const shape = (lang: Lang) => parseHelp(topic.body[lang]).map((b) => (b.kind === 'list' ? `${b.ordered ? 'ol' : 'ul'}${b.items.length}` : b.kind));
      expect(shape('en'), topic.id).toEqual(shape('ru'));
      const of = (lang: Lang, kind: Inline['kind']): string[] =>
        sorted(
          parts(topic.id, lang)
            .filter((p) => p.kind === kind)
            .map((p) => (p.kind === 'link' ? p.topic : p.kind === 'external' ? p.href : p.kind === 'label' ? p.key : p.kind === 'key' ? p.text : '')),
        );
      for (const kind of ['link', 'external', 'label', 'key'] as const) expect(of('en', kind), `${topic.id}: ${kind}`).toEqual(of('ru', kind));
    }
  });

  it('link only to topics that are there, and every topic is linked to from another', () => {
    const ids = new Set(TOPICS.map((t) => t.id));
    const linked = new Set<string>();
    for (const topic of TOPICS) {
      for (const lang of LANGS) {
        for (const part of parts(topic.id, lang)) {
          if (part.kind !== 'link') continue;
          expect(ids.has(part.topic), `${topic.id} (${lang}) links to #${part.topic}`).toBe(true);
          if (part.topic !== topic.id) linked.add(part.topic);
        }
      }
    }
    expect(TOPICS.map((t) => t.id).filter((id) => id !== 'start' && !linked.has(id))).toEqual([]);
  });

  it('link out only over https, to the repository', () => {
    for (const topic of TOPICS) {
      for (const part of parts(topic.id, 'en')) {
        if (part.kind === 'external') expect(part.href, topic.id).toMatch(/^https:\/\/github\.com\/kalkulator777\/RWAT\/(?:blob|tree)\/main\/[\w./-]+$/);
      }
    }
  });

  it('name buttons by strings of the interface that take no values', () => {
    for (const topic of TOPICS) {
      for (const part of parts(topic.id, 'ru')) {
        if (part.kind !== 'label') continue;
        for (const lang of LANGS) {
          const text = catalog.get(lang, part.key);
          expect(text, `${topic.id}: [[${part.key}]] in ${lang}`).toBeDefined();
          expect(placeholders(text ?? ''), `${topic.id}: [[${part.key}]]`).toEqual([]);
        }
      }
    }
  });

  it('are Russian in Russian and have no Cyrillic in English', () => {
    for (const topic of TOPICS) {
      expect(`${topic.title.ru} ${topic.body.ru}`, topic.id).toMatch(/[а-яё]/i);
      expect(`${topic.title.en} ${topic.body.en}`, topic.id).not.toMatch(/[а-яё]/i);
    }
  });

  it('cover the scenarios 2.1–2.5, the tools, the tabs, the keys, the limits and the format', () => {
    expect(TOPICS.map((t) => t.id)).toEqual(['start', 'new-pack', 'open-pack', 'markup', 'locomotive', 'check-save', 'tools', 'tabs', 'keys', 'limits', 'format']);
    expect(sorted(parts('start', 'en').flatMap((p) => (p.kind === 'link' ? [p.topic] : [])))).toEqual(sorted(TOPICS.map((t) => t.id).filter((id) => id !== 'start')));
  });
});

describe('the help in the page', () => {
  beforeEach(() => setLang('en'));
  afterEach(() => {
    cleanup();
    helpTopic.value = null;
    localStorage.clear();
  });

  it('is a button of the top bar', () => {
    expect(panels.find((p) => p.id === 'help')).toMatchObject({ slot: 'toolbar', title: 'help.title' });
  });

  it('opens at the start, goes to a topic by its link and by the list, follows the language, closes', async () => {
    render(<HelpButton />);
    expect(screen.queryByTestId('help-dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('help'));
    const dialog = await screen.findByTestId('help-dialog');
    const article = screen.getByTestId('help-topic');
    expect(article.dataset.topic).toBe('start');
    expect(article.querySelector('h3')?.textContent).toBe('Where to begin');
    // a label is the interface's own words
    expect(article.querySelector('[data-label="checks.title"]')?.textContent).toBe('Checks');

    fireEvent.click(article.querySelector('[data-topic-link="markup"]') as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('help-topic').dataset.topic).toBe('markup'));
    expect(screen.getByTestId('help-topic').querySelector('[data-label="tools.doors.fromSelection"]')?.textContent).toBe('Door from selection');
    expect(dialog.querySelector('[data-topic="markup"][aria-current="page"]')).not.toBeNull();

    fireEvent.click(dialog.querySelector('button[data-topic="keys"]') as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('help-topic').dataset.topic).toBe('keys'));
    expect(screen.getByTestId('help-topic').querySelectorAll('kbd').length).toBeGreaterThan(10);

    setLang('ru');
    await waitFor(() => expect(screen.getByTestId('help-topic').querySelector('h3')?.textContent).toBe('Клавиши'));
    expect(screen.getByTestId('help-topic').getAttribute('lang')).toBe('ru');
    expect(screen.getByTestId('help-close').textContent).toBe('Закрыть');

    fireEvent.click(screen.getByTestId('help-close'));
    await waitFor(() => expect(screen.queryByTestId('help-dialog')).toBeNull());

    openHelp('format');
    const again = await screen.findByTestId('help-dialog');
    expect(again.dataset.topic).toBe('format');
    const out = screen.getByTestId('help-topic').querySelector('a[target="_blank"]');
    expect(out?.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent(again, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByTestId('help-dialog')).toBeNull());
    openHelp('no-such-topic');
    expect(helpTopic.value).toBe('start');
  });
});
