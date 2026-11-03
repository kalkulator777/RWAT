/**
 * The lights tool's section of the inspector (docs/proposals/editor.md §2.4, §3.9, §6.3):
 * the model's headlights — which way each shines and why (the half of the model its lens
 * is in), its colour, its group —, its light groups to choose from by keyboard, each with
 * what it lights, and the chosen group's objects to select in the view. It only shows.
 */

import { formatNumber, t } from '../../i18n';
import { MIN_LAMP_SIZE } from '../../ports/lampIslands';
import { overlayStyle } from '../../view3d/overlays';
import { CHOSEN_STYLE, NO_GROUP, type GroupView, type HeadlightView, type LightsPicture } from './analysis';
import type { LightsTool } from './session';
import './lights.css';

function groupName(group: GroupView): string {
  return group.name ?? t('tools.lights.noGroup');
}

function groupOf(picture: LightsPicture, index: number): string {
  if (index < 0) return t('tools.lights.noGroup');
  return picture.groups.find((g) => g.index === index)?.name ?? String(index);
}

function Headlights({ picture }: { picture: LightsPicture }) {
  if (picture.headlights.length === 0) return <p class="lights-note">{t('tools.lights.headlights.none')}</p>;
  return (
    <ul class="lights-list" data-testid="lights-headlights">
      {picture.headlights.map((h: HeadlightView) => (
        <li key={h.index} class="lights-item" data-headlight={h.index} data-way={h.forward ? 'forward' : 'back'}>
          <span class="lights-index">{t('tools.lights.headlight', { index: h.index })}</span>
          <span>{t(h.forward ? 'tools.lights.way.forward' : 'tools.lights.way.back')}</span>
          <span class="lights-colour">
            <span class="lights-swatch" style={{ background: h.colour }} aria-hidden="true" />
            <code>{h.colour}</code>
          </span>
          <span>{t('tools.lights.inGroup', { group: groupOf(picture, h.group) })}</span>
          {h.invert && <span class="lights-flag">LINVERT</span>}
        </li>
      ))}
    </ul>
  );
}

function Groups({ tool, picture }: { tool: LightsTool; picture: LightsPicture }) {
  const chosen = tool.chosen.value;
  if (picture.groups.length === 0) return <p class="lights-note">{t('tools.lights.groups.none')}</p>;
  return (
    <ul class="lights-list" data-testid="lights-groups">
      {picture.groups.map((group) => (
        <li key={group.index} data-group={group.index}>
          <button
            type="button"
            class="lights-group"
            aria-pressed={chosen === group.index}
            onClick={() => {
              tool.chosen.value = chosen === group.index ? null : group.index;
            }}
          >
            <span class="lights-index">{groupName(group)}</span>
            <span class="lights-summary">{t('tools.lights.group.summary', { headlights: group.headlights.length, lamps: group.lamps.length, objects: group.objects.length })}</span>
            {group.interior && <span class="lights-flag">{t('tools.lights.group.interior')}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Chosen({ tool, group }: { tool: LightsTool; group: GroupView }) {
  return (
    <fieldset class="lights-chosen" data-testid="lights-chosen" data-group={group.index}>
      <legend>{groupName(group)}</legend>
      <p class="lights-note">{group.index === NO_GROUP ? t('tools.lights.chosen.none') : t('tools.lights.chosen.group')}</p>
      {group.inverted.length > 0 && <p class="lights-note">{t('tools.lights.chosen.inverted', { objects: group.inverted.join(', ') })}</p>}
      <ul class="lights-objects">
        {group.objects.map((name) => (
          <li key={name}>
            <button type="button" class="lights-object" onClick={() => tool.selectObjects([name])}>
              <code>{name}</code>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" class="lights-button" data-action="lights-select-group" disabled={group.objects.length === 0} onClick={() => tool.selectObjects(group.objects)}>
        {t('tools.lights.chosen.select')}
      </button>
    </fieldset>
  );
}

function Legend() {
  const entries: [string, string][] = [
    ['headlight', 'tools.lights.legend.headlight'],
    ['lamp', 'tools.lights.legend.lamp'],
    [CHOSEN_STYLE, 'tools.lights.legend.chosen'],
  ];
  return (
    <ul class="lights-legend" aria-label={t('tools.lights.legend')}>
      {entries.map(([style, key]) => (
        <li key={key}>
          <span class="lights-swatch" style={{ background: overlayStyle(style).color }} aria-hidden="true" />
          {t(key)}
        </li>
      ))}
    </ul>
  );
}

/** The lights tool's section: see the file's head. */
export function LightsInspector({ tool }: { tool: LightsTool }) {
  const subject = tool.subject.value;
  const picture = tool.picture.value;
  const chosen = tool.chosen.value;
  if (subject === null) return null;
  if (picture === null || subject.model === null) return <p class="lights-note">{t('tools.lights.reading')}</p>;
  if (subject.model.engine === null) return <p class="lights-note">{t('tools.lights.unreadable')}</p>;
  const group = chosen === null ? undefined : picture.groups.find((g) => g.index === chosen);
  return (
    <div
      class="lights-tool"
      data-testid="lights-tool"
      data-groups={picture.groups.length}
      data-headlights={picture.headlights.length}
      data-lamps={picture.lamps.length}
      data-chosen={chosen ?? undefined}
    >
      <p class="lights-note">{t('tools.lights.howto')}</p>
      <h3 class="lights-heading">{t('tools.lights.headlights', { count: picture.headlights.length })}</h3>
      <Headlights picture={picture} />
      <p class="lights-note">{t('tools.lights.way.note')}</p>
      <h3 class="lights-heading">{t('tools.lights.lamps', { count: picture.lamps.length })}</h3>
      <p class="lights-note">{t('tools.lights.lamps.note', { size: formatNumber(Math.round(MIN_LAMP_SIZE * 100) / 100) })}</p>
      <h3 class="lights-heading">{t('tools.lights.groups', { count: picture.groups.filter((g) => g.index >= 0).length })}</h3>
      <Groups tool={tool} picture={picture} />
      {group !== undefined && <Chosen tool={tool} group={group} />}
      <Legend />
    </div>
  );
}
