import { useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import type { PanelDef } from './registry';

const TAB_STORAGE_PREFIX = 'rwat.editor.tab.';

function rememberedTab(slot: string): string | null {
  try {
    return globalThis.localStorage?.getItem(TAB_STORAGE_PREFIX + slot) ?? null;
  } catch {
    return null;
  }
}

function rememberTab(slot: string, id: string): void {
  try {
    globalThis.localStorage?.setItem(TAB_STORAGE_PREFIX + slot, id);
  } catch {
    // storage blocked: the tab holds until the page is closed
  }
}

interface SlotTabsProps {
  /** The slot's name; also the key the chosen tab is remembered under. */
  slot: string;
  panels: readonly PanelDef[];
  /** i18n key of the text shown while no panel is registered for the slot. */
  empty: string;
  /** i18n key of the tab list's name for a screen reader. */
  label: string;
  /** Tabs even for a single panel (the bottom area always shows its tab strip). */
  alwaysTabs?: boolean;
}

/**
 * The panels of one slot: a single panel fills the area, several become tabs (WAI-ARIA
 * tabs: arrows, Home and End move between them). All the slot's panels stay mounted and
 * the hidden ones keep their state; the chosen tab is remembered in the browser.
 */
export function SlotTabs({ slot, panels, empty, label, alwaysTabs = false }: SlotTabsProps) {
  const [chosen, setChosen] = useState<string | null>(() => rememberedTab(slot));
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});

  if (panels.length === 0) {
    return <p class="slot-empty">{t(empty)}</p>;
  }
  if (panels.length === 1 && !alwaysTabs) {
    const Only = (panels[0] as PanelDef).component;
    return (
      <div class="slot-single" data-panel={(panels[0] as PanelDef).id}>
        <Only />
      </div>
    );
  }

  const selected: PanelDef = panels.find((p) => p.id === chosen) ?? panels[0]!;
  const select = (id: string, focus: boolean) => {
    setChosen(id);
    rememberTab(slot, id);
    if (focus) tabs.current[id]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const index = panels.indexOf(selected);
    let next: number;
    if (e.key === 'ArrowRight') next = (index + 1) % panels.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + panels.length) % panels.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = panels.length - 1;
    else return;
    e.preventDefault();
    select((panels[next] as PanelDef).id, true);
  };

  return (
    <div class="slot-tabs">
      <div class="tablist" role="tablist" aria-label={t(label)} onKeyDown={onKeyDown}>
        {panels.map((p) => (
          <button
            key={p.id}
            ref={(el) => {
              tabs.current[p.id] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${p.id}`}
            class="tab"
            aria-selected={p === selected}
            aria-controls={`tabpanel-${p.id}`}
            tabIndex={p === selected ? 0 : -1}
            onClick={() => select(p.id, false)}
          >
            {t(p.title)}
          </button>
        ))}
      </div>
      {panels.map((p) => {
        const Panel = p.component;
        return (
          <div
            key={p.id}
            class="tabpanel"
            role="tabpanel"
            id={`tabpanel-${p.id}`}
            aria-labelledby={`tab-${p.id}`}
            hidden={p !== selected}
            data-panel={p.id}
          >
            <Panel />
          </div>
        );
      })}
    </div>
  );
}
