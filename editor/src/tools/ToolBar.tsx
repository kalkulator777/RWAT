/**
 * The tools on the screen (docs/proposals/editor.md §6.1): the switch in the 3D view's bar
 * (the plain selection, then each tool, greyed while it does not apply to the open wagon)
 * and, in the inspector, the section of the tool that is on. Both read a {@link ToolHost}.
 * The section's look is the tools' common one (./common/section.css).
 */

import { t } from '../i18n';
import type { ToolHost } from './registry';
import './common/section.css';

/** The tool switch of the view's bar: one button pressed — the selection or a tool. */
export function ToolSwitcher({ host }: { host: ToolHost }) {
  const active = host.active.value;
  void host.subject.value;
  return (
    <div class="toggle" role="group" aria-label={t('tools.bar')} data-toggle="tool">
      <button
        type="button"
        class="toggle-button"
        aria-pressed={active === null}
        title={t('tools.select.hint')}
        data-tool="select"
        onClick={() => host.use(null)}
      >
        {t('tools.select')}
      </button>
      {host.tools.map((tool) => {
        const usable = host.canUse(tool);
        return (
          <button
            key={tool.id}
            type="button"
            class="toggle-button"
            aria-pressed={active === tool.id}
            disabled={!usable && active !== tool.id}
            title={usable ? t(tool.hint) : `${t(tool.hint)} ${t('tools.unavailable')}`}
            data-tool={tool.id}
            onClick={() => host.use(active === tool.id ? null : tool.id)}
          >
            {t(tool.title)}
          </button>
        );
      })}
    </div>
  );
}

/** The inspector's section of the tool that is on; nothing while none is. */
export function ToolSection({ host }: { host: ToolHost }) {
  const on = host.current.value;
  if (on === null) return null;
  const Section = on.session.Inspector;
  return (
    <section class="tool-section" aria-label={t(on.tool.title)} data-testid="tool-section" data-tool={on.tool.id}>
      <h2 class="inspector-title">{t(on.tool.title)}</h2>
      <Section />
    </section>
  );
}
