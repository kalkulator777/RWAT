import { LANGS, setLang, t } from '../i18n';
import { layout } from './layout';
import { panelsIn, type PanelDef } from './registry';
import { SlotTabs } from './SlotTabs';
import { Splitter } from './Splitter';
import { EDITOR_MODES, failure, lang, mode, pack, updateReady } from './store';

/** Two or more buttons of which one is on, such as the language: each says whether it is pressed. */
function Toggle<T extends string>(props: {
  label: string;
  values: readonly T[];
  current: T;
  text: (value: T) => string;
  title?: (value: T) => string;
  lang?: (value: T) => string;
  onPick: (value: T) => void;
  name: string;
}) {
  return (
    <div class="toggle" role="group" aria-label={props.label} data-toggle={props.name}>
      {props.values.map((value) => (
        <button
          key={value}
          type="button"
          class="toggle-button"
          aria-pressed={value === props.current}
          title={props.title?.(value)}
          lang={props.lang?.(value)}
          data-value={value}
          onClick={() => props.onPick(value)}
        >
          {props.text(value)}
        </button>
      ))}
    </div>
  );
}

/** The open pack's name and where it came from; whether saving writes in place or downloads a zip. */
function PackStatus() {
  const open = pack.value;
  if (open === null) return <span class="pack-status">{t('shell.noPack')}</span>;
  const { source } = open;
  const how = open.readOnly ? 'shell.pack.generated' : source.writable ? 'shell.pack.folder' : 'shell.pack.zipSave';
  const text = t('shell.pack.status', { name: source.name, how: t(how) });
  // the top bar cuts the status short where the buttons need the room: the whole of it on hover
  return (
    <span class="pack-status" data-testid="pack-status" data-kind={source.kind} title={text}>
      {text}
    </span>
  );
}

function TopBar({ toolbar }: { toolbar: readonly PanelDef[] }) {
  return (
    <header class="topbar">
      <div class="brand">
        <img class="brand-icon" src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" width={24} height={24} />
        <span class="brand-name">RWAT</span>
        <PackStatus />
      </div>
      <div class="toolbar" role="group" aria-label={t('shell.region.actions')}>
        {toolbar.map((p) => {
          const Control = p.component;
          return (
            <div key={p.id} class="toolbar-item" data-panel={p.id}>
              <Control />
            </div>
          );
        })}
      </div>
      <Toggle
        name="mode"
        label={t('shell.mode.label')}
        values={EDITOR_MODES}
        current={mode.value}
        text={(m) => t(`shell.mode.${m}`)}
        title={(m) => t(`shell.mode.${m}.hint`)}
        onPick={(m) => {
          mode.value = m;
        }}
      />
      <Toggle
        name="lang"
        label={t('shell.lang.label')}
        values={LANGS}
        current={lang.value}
        text={(l) => l.toUpperCase()}
        title={(l) => t(`lang.${l}`)}
        lang={(l) => l}
        onPick={setLang}
      />
    </header>
  );
}

/** Why the last open or save failed (app/session.ts), until the next action or the user closes it. */
function FailureBanner() {
  const problem = failure.value;
  if (!problem) return null;
  return (
    <div class="banner banner-error" role="alert" data-testid="failure">
      <span>{t(problem.key, problem.params)}</span>
      <button
        type="button"
        onClick={() => {
          failure.value = null;
        }}
      >
        {t('shell.failure.close')}
      </button>
    </div>
  );
}

/** The new-version notice of §5.5: the editor never reloads by itself, the user chooses when. */
function UpdateBanner() {
  const reload = updateReady.value;
  if (!reload) return null;
  return (
    <div class="banner" role="status">
      <span>{t('shell.update.text')}</span>
      <button type="button" onClick={reload}>
        {t('shell.update.reload')}
      </button>
      <button
        type="button"
        onClick={() => {
          updateReady.value = null;
        }}
      >
        {t('shell.update.later')}
      </button>
    </div>
  );
}

/**
 * The screen of docs/proposals/editor.md §6.1: the top bar; the pack tree on the left,
 * the 3D view in the centre, the inspector on the right, the tabs under the view; bars
 * between them resize the areas. What fills the areas is whatever panels registered
 * themselves for the current mode (./registry.ts).
 */
export function Shell({ panels }: { panels: readonly PanelDef[] }) {
  const current = mode.value;
  const sizes = layout.value;
  const view = panelsIn(panels, 'view', current)[0];
  const View = view?.component;
  const style = {
    '--tree-width': `${sizes.tree}px`,
    '--inspector-width': `${sizes.inspector}px`,
    '--bottom-height': `${sizes.bottom}px`,
  };
  return (
    <div class="shell" style={style} data-mode={current}>
      <TopBar toolbar={panelsIn(panels, 'toolbar', current)} />
      <div class="banners">
        <FailureBanner />
        <UpdateBanner />
      </div>
      <aside class="area area-tree" aria-label={t('shell.region.tree')}>
        <SlotTabs
          slot="tree"
          panels={panelsIn(panels, 'tree', current)}
          empty="shell.empty.tree"
          label="shell.region.tree"
        />
      </aside>
      <Splitter area="tree" axis="x" sign={1} label="shell.splitter.tree" class="splitter-tree" />
      <main class="area area-view" aria-label={t('shell.region.view')}>
        {View ? (
          <div class="slot-single" data-panel={view.id}>
            <View />
          </div>
        ) : (
          <p class="slot-empty">{t('shell.empty.view')}</p>
        )}
      </main>
      <Splitter area="inspector" axis="x" sign={-1} label="shell.splitter.inspector" class="splitter-inspector" />
      <aside class="area area-inspector" aria-label={t('shell.region.inspector')}>
        <SlotTabs
          slot="inspector"
          panels={panelsIn(panels, 'inspector', current)}
          empty="shell.empty.inspector"
          label="shell.region.inspector"
        />
      </aside>
      <Splitter area="bottom" axis="y" sign={-1} label="shell.splitter.bottom" class="splitter-bottom" />
      <section class="area area-bottom" aria-label={t('shell.region.bottom')}>
        <SlotTabs
          slot="bottom"
          panels={panelsIn(panels, 'bottom', current)}
          empty="shell.empty.bottom"
          label="shell.region.bottom"
          alwaysTabs
        />
      </section>
    </div>
  );
}
