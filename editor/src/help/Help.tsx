/**
 * The help in the editor (docs/proposals/editor.md §6.1: "справка" in the top bar): a
 * button that opens a dialog of the topics of ./topics.ts, in the interface's language —
 * the topics listed by group on the left, the open one on the right, its links to other
 * topics opening them in place, its links out in a new tab. The buttons a topic names are
 * written with their own labels ([[key]]), so the help follows the interface's words.
 */

import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { lang, t } from '../i18n';
import './help.css';
import { parseHelp, type Block, type Inline } from './markup';
import { topic as topicOf, TOPICS, type HelpTopic } from './topics';

/** The topic the help shows; null while it is closed. */
export const helpTopic = signal<string | null>(null);

/** Opens the help at a topic (the start by default). */
export function openHelp(id = 'start'): void {
  helpTopic.value = topicOf(id) === undefined ? 'start' : id;
}

function InlineParts({ parts, go }: { parts: readonly Inline[]; go: (id: string) => void }) {
  return (
    <>
      {parts.map((part, i) => {
        switch (part.kind) {
          case 'text':
            return part.text;
          case 'code':
            return <code key={i}>{part.text}</code>;
          case 'key':
            return <kbd key={i}>{part.text}</kbd>;
          case 'strong':
            return <strong key={i}>{part.text}</strong>;
          case 'label':
            return (
              <strong key={i} class="help-label" data-label={part.key}>
                {t(part.key)}
              </strong>
            );
          case 'link':
            return (
              <a
                key={i}
                href={`#help-${part.topic}`}
                data-topic-link={part.topic}
                onClick={(event) => {
                  event.preventDefault();
                  go(part.topic);
                }}
              >
                {part.text}
              </a>
            );
          case 'external':
            return (
              <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">
                {part.text}
                <span class="help-hidden"> {t('help.newTab')}</span>
              </a>
            );
        }
      })}
    </>
  );
}

function Blocks({ blocks, go }: { blocks: readonly Block[]; go: (id: string) => void }) {
  return (
    <>
      {blocks.map((block, i) => {
        if (block.kind === 'heading') {
          return (
            <h4 key={i}>
              <InlineParts parts={block.inline} go={go} />
            </h4>
          );
        }
        if (block.kind === 'paragraph') {
          return (
            <p key={i}>
              <InlineParts parts={block.inline} go={go} />
            </p>
          );
        }
        const items = block.items.map((item, j) => (
          <li key={j}>
            <InlineParts parts={item} go={go} />
          </li>
        ));
        return block.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
      })}
    </>
  );
}

const GROUPS: readonly HelpTopic['group'][] = ['start', 'scenarios', 'reference'];

function HelpDialog({ id }: { id: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
  }, []);
  const shown = topicOf(id) ?? topicOf('start');
  const language = lang.value;
  const go = (next: string): void => {
    helpTopic.value = next;
    heading.current?.focus({ preventScroll: false });
  };
  const close = (): void => {
    helpTopic.value = null;
  };
  if (shown === undefined) return null;
  const list = (group: HelpTopic['group']): ComponentChildren => (
    <ul>
      {TOPICS.filter((item) => item.group === group).map((item) => (
        <li key={item.id}>
          <button type="button" data-topic={item.id} aria-current={item.id === shown.id ? 'page' : undefined} onClick={() => go(item.id)}>
            {item.title[language]}
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <dialog
      ref={ref}
      class="dialog help-dialog"
      aria-labelledby="help-dialog-title"
      data-testid="help-dialog"
      data-topic={shown.id}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div class="help-body">
        <header class="help-head">
          <h2 id="help-dialog-title">{t('help.title')}</h2>
          <button type="button" data-testid="help-close" onClick={close}>
            {t('help.close')}
          </button>
        </header>
        <nav class="help-nav" aria-label={t('help.topics')}>
          {GROUPS.map((group) => (
            <section key={group} aria-labelledby={`help-group-${group}`}>
              <h3 id={`help-group-${group}`}>{t(`help.group.${group}`)}</h3>
              {list(group)}
            </section>
          ))}
        </nav>
        <article class="help-topic" data-testid="help-topic" data-topic={shown.id} lang={language} aria-labelledby="help-topic-title">
          <h3 id="help-topic-title" ref={heading} tabIndex={-1}>
            {shown.title[language]}
          </h3>
          <Blocks blocks={parseHelp(shown.body[language])} go={go} />
        </article>
      </div>
    </dialog>
  );
}

/** «Help» in the top bar, and the help's dialog while it is open. */
export function HelpButton() {
  const open = helpTopic.value;
  return (
    <div class="file-actions">
      <button type="button" data-testid="help" aria-haspopup="dialog" onClick={() => openHelp()}>
        {t('help.button')}
      </button>
      {open !== null && <HelpDialog id={open} />}
    </div>
  );
}
