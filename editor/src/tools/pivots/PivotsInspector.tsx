/**
 * The hinges tool's section of the inspector (docs/proposals/editor.md §2.4, §3.9, §6.3):
 * the model's controls to choose from by keyboard — each with its kind and how it moves —,
 * and the chosen one's hinge, axis, swing, slide and travel in numbers, its objects to
 * select in the view. It only shows.
 */

import { formatNumber, t } from '../../i18n';
import type { Vec3 } from '../../core/contracts';
import { overlayStyle } from '../../view3d/overlays';
import { GHOST_STYLE, type PivotView } from './analysis';
import type { PivotsTool } from './session';
import './pivots.css';

/** A number for the eye: to a thousandth. */
function short(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return formatNumber(Object.is(rounded, -0) ? 0 : rounded);
}

function vector(v: Vec3): string {
  return `(${short(v[0])}, ${short(v[1])}, ${short(v[2])})`;
}

/** The i18n key of a control kind's name: the preview tab's (`preview.kind.GAUGE-SPEED`). */
function kindKey(view: PivotView): string {
  return `preview.kind.${view.kind.replaceAll('_', '-')}`;
}

/** How a control moves, in a few words: its swing, its slide, or neither. */
function motion(view: PivotView): string {
  const parts: string[] = [];
  if (view.pivot !== null && view.degrees !== 0) parts.push(t('tools.pivots.turns', { degrees: formatNumber(view.degrees) }));
  if (view.slide.some((v) => v !== 0)) parts.push(t('tools.pivots.slides'));
  return parts.length === 0 ? t('tools.pivots.still') : parts.join(', ');
}

function Controls({ tool, controls }: { tool: PivotsTool; controls: readonly PivotView[] }) {
  const chosen = tool.chosen.value;
  if (controls.length === 0) return <p class="pivots-note">{t('tools.pivots.none')}</p>;
  return (
    <ul class="pivots-list" data-testid="pivots-controls">
      {controls.map((view) => (
        <li key={view.index} data-control={view.index} data-key={view.key}>
          <button
            type="button"
            class="pivots-control"
            aria-pressed={chosen === view.index}
            onClick={() => {
              tool.chosen.value = chosen === view.index ? null : view.index;
            }}
          >
            <code class="pivots-key">{view.key}</code>
            <span class="pivots-summary">
              {t(kindKey(view))} · {motion(view)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Chosen({ tool, view }: { tool: PivotsTool; view: PivotView }) {
  const flags = [view.offset !== 0 ? `OFFSET ${formatNumber(view.offset)}` : null, view.invert ? 'INVERT' : null].filter((flag) => flag !== null);
  return (
    <fieldset class="pivots-chosen" data-testid="pivots-chosen" data-control={view.index}>
      <legend>
        <code>{view.key}</code>
      </legend>
      <dl class="pivots-facts">
        <dt>{t('tools.pivots.pivot')}</dt>
        <dd data-fact="pivot">{view.pivot === null ? t('tools.pivots.noPivot') : vector(view.pivot)}</dd>
        <dt>{t('tools.pivots.axis')}</dt>
        <dd data-fact="axis">{vector(view.axis)}</dd>
        <dt>{t('tools.pivots.degrees')}</dt>
        <dd data-fact="degrees">{formatNumber(view.degrees)}</dd>
        <dt>{t('tools.pivots.slide')}</dt>
        <dd data-fact="slide">{vector(view.slide)}</dd>
        <dt>{t('tools.pivots.travel')}</dt>
        <dd data-fact="travel">
          {t('tools.pivots.travel.values', { from: short(view.from), to: short(view.to) })}
          {flags.length > 0 && ` (${flags.join(', ')})`}
        </dd>
      </dl>
      <p class="pivots-note">{t('tools.pivots.sign')}</p>
      <ul class="pivots-objects">
        {view.objects.map((name) => (
          <li key={name}>
            <button type="button" class="pivots-object" onClick={() => tool.selectObjects([name])}>
              <code>{name}</code>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" class="pivots-button" data-action="pivots-select" disabled={view.objects.length === 0} onClick={() => tool.selectObjects(view.objects)}>
        {t('tools.pivots.select')}
      </button>
    </fieldset>
  );
}

function Legend() {
  const entries: [string, string][] = [
    ['pivot', 'tools.pivots.legend.pivot'],
    ['travel', 'tools.pivots.legend.travel'],
    [GHOST_STYLE, 'tools.pivots.legend.ghost'],
  ];
  return (
    <ul class="pivots-legend" aria-label={t('tools.pivots.legend')}>
      {entries.map(([style, key]) => (
        <li key={key}>
          <span class="pivots-swatch" style={{ background: overlayStyle(style).color }} aria-hidden="true" />
          {t(key)}
        </li>
      ))}
    </ul>
  );
}

/** The hinges tool's section: see the file's head. */
export function PivotsInspector({ tool }: { tool: PivotsTool }) {
  const subject = tool.subject.value;
  const picture = tool.picture.value;
  const chosen = tool.chosen.value;
  if (subject === null) return null;
  if (picture === null || subject.model === null) return <p class="pivots-note">{t('tools.pivots.reading')}</p>;
  const view = chosen === null ? undefined : picture.controls.find((c) => c.index === chosen);
  return (
    <div class="pivots-tool" data-testid="pivots-tool" data-controls={picture.controls.length} data-chosen={chosen ?? undefined}>
      <p class="pivots-note">{t('tools.pivots.howto')}</p>
      <h3 class="pivots-heading">{t('tools.pivots.controls', { count: picture.controls.length })}</h3>
      <Controls tool={tool} controls={picture.controls} />
      {view !== undefined && <Chosen tool={tool} view={view} />}
      <Legend />
    </div>
  );
}
