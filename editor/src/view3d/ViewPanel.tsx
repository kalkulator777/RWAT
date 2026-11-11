/**
 * The 3D view's panel in the centre of the screen (docs/proposals/editor.md §6.1): its bar
 * (the tools' switch the panel is given, camera, framing, display, wireframe, layers and
 * roles), the drawing, the axis legend,
 * the status line with what is under the pointer, and a description of the model and the
 * selection for a screen reader (§6.3). The drawing itself is ./viewport.ts; what other
 * modules ask of the view is ./state.ts (`view`). The selection is the shell's one signal.
 */

import type { ComponentChildren } from 'preact';
import type { OrthographicCamera, PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import { useEffect, useRef, useState } from 'preact/hooks';
import conventions from '../../../schema/obj-conventions.json';
import { lang, selection } from '../app/store';
import { schemaText, t } from '../i18n';
import { CAMERA_VIEWS } from './cameras';
import { AXIS_COLORS, GUIDE_LAYERS } from './guides';
import { DISPLAY_MODES } from './modelScene';
import { roleColorCss } from './roleColors';
import { selectedObjects } from './selection';
import { GHOSTS_LAYER, view } from './state';
import { exposeForTests } from './testHook';
import { Viewport } from './viewport';
import './view.css';

/** Pressed-or-not buttons of which one is on, as the shell draws its toggles. */
function Choice<T extends string>(props: { name: string; label: string; values: readonly T[]; current: T; prefix: string; onPick: (value: T) => void }) {
  return (
    <div class="toggle" role="group" aria-label={props.label} data-toggle={props.name}>
      {props.values.map((value) => (
        <button
          key={value}
          type="button"
          class="toggle-button"
          aria-pressed={value === props.current}
          title={t(`${props.prefix}.${value}.hint`)}
          data-value={value}
          onClick={() => props.onPick(value)}
        >
          {t(`${props.prefix}.${value}`)}
        </button>
      ))}
    </div>
  );
}

function Check(props: { label: string; checked: boolean; onChange: (checked: boolean) => void; swatch?: string; title?: string; name: string }) {
  return (
    <label class="view3d-check" title={props.title} data-layer={props.name}>
      <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.currentTarget.checked)} />
      {props.swatch !== undefined && <span class="view3d-swatch" style={{ background: props.swatch }} aria-hidden="true" />}
      <span>{props.label}</span>
    </label>
  );
}

/** A role's name pattern from schema/obj-conventions.json, in the interface language. */
function roleTitle(id: string): string | undefined {
  const role = conventions.roles.find((entry) => entry.id === id);
  return role === undefined ? undefined : schemaText(role, lang.value, 'name');
}

function LayersMenu() {
  const hiddenLayers = view.hiddenLayers.value;
  const hiddenRoles = view.hiddenRoles.value;
  const overlays = view.overlayLayers.value;
  return (
    <details class="view3d-menu" data-testid="view3d-layers">
      <summary>{t('view3d.layers')}</summary>
      <div class="view3d-menu-body">
        <fieldset>
          <legend>{t('view3d.layers.guides')}</legend>
          {[...GUIDE_LAYERS, GHOSTS_LAYER].map((layer) => (
            <Check
              key={layer}
              name={layer}
              label={t(`view3d.layer.${layer}`)}
              checked={!hiddenLayers.has(layer)}
              onChange={(shown) => view.setLayerShown(layer, shown)}
            />
          ))}
        </fieldset>
        {overlays.length > 0 && (
          <fieldset>
            <legend>{t('view3d.layers.overlays')}</legend>
            {overlays.map((layer) => (
              <Check key={layer} name={layer} label={layer} checked={!hiddenLayers.has(layer)} onChange={(shown) => view.setLayerShown(layer, shown)} />
            ))}
          </fieldset>
        )}
        <fieldset>
          <legend>{t('view3d.layers.roles')}</legend>
          {conventions.parse_order.steps.map((role) => (
            <Check
              key={role}
              name={`role:${role}`}
              label={role}
              title={roleTitle(role)}
              swatch={roleColorCss(role)}
              checked={!hiddenRoles.has(role)}
              onChange={(shown) => view.setRoleShown(role, shown)}
            />
          ))}
        </fieldset>
      </div>
    </details>
  );
}

function ViewBar({ tools }: { tools?: ComponentChildren }) {
  return (
    <div class="view3d-bar" role="toolbar" aria-label={t('view3d.bar')}>
      {tools}
      <Choice name="camera" label={t('view3d.camera')} values={CAMERA_VIEWS} current={view.camera.value} prefix="view3d.camera" onPick={(v) => view.setCamera(v)} />
      <div class="toggle" role="group" aria-label={t('view3d.frame.all')}>
        <button type="button" class="toggle-button" title={t('view3d.frame.all.hint')} data-action="frame-all" onClick={() => view.requestFraming('all')}>
          {t('view3d.frame.all')}
        </button>
        <button type="button" class="toggle-button" title={t('view3d.frame.selected.hint')} data-action="frame-selected" onClick={() => view.requestFraming('selected')}>
          {t('view3d.frame.selected')}
        </button>
      </div>
      <Choice name="display" label={t('view3d.display')} values={DISPLAY_MODES} current={view.display.value} prefix="view3d.display" onPick={(m) => view.setDisplay(m)} />
      <div class="toggle" role="group" aria-label={t('view3d.wireframe')}>
        <button
          type="button"
          class="toggle-button"
          aria-pressed={view.wireframe.value}
          title={t('view3d.wireframe.hint')}
          data-action="wireframe"
          onClick={() => view.setWireframe(!view.wireframe.value)}
        >
          {t('view3d.wireframe')}
        </button>
      </div>
      <LayersMenu />
    </div>
  );
}

interface AxisRefs {
  lines: Partial<Record<'x' | 'y' | 'z', SVGLineElement | null>>;
  labels: Partial<Record<'x' | 'y' | 'z', SVGTextElement | null>>;
}

const AXIS_DIRECTIONS = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) } as const;
const AXIS_CENTRE = 30;
const AXIS_LENGTH = 20;

/** Turns the axis legend as the camera sees the OBJ frame's axes. */
function turnAxes(refs: AxisRefs, camera: PerspectiveCamera | OrthographicCamera): void {
  const inverse = camera.quaternion.clone().invert();
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = AXIS_DIRECTIONS[axis].clone().applyQuaternion(inverse);
    const x = AXIS_CENTRE + d.x * AXIS_LENGTH;
    const y = AXIS_CENTRE - d.y * AXIS_LENGTH;
    // an axis pointing at the eye or away is a dot: its label goes aside, faint
    const flat = Math.hypot(d.x, d.y) < 0.2;
    refs.lines[axis]?.setAttribute('x2', x.toFixed(1));
    refs.lines[axis]?.setAttribute('y2', y.toFixed(1));
    refs.labels[axis]?.setAttribute('x', (flat ? AXIS_CENTRE - 8 : AXIS_CENTRE + d.x * (AXIS_LENGTH + 7)).toFixed(1));
    refs.labels[axis]?.setAttribute('y', (flat ? AXIS_CENTRE - 6 : AXIS_CENTRE - d.y * (AXIS_LENGTH + 7) + 4).toFixed(1));
    refs.labels[axis]?.setAttribute('opacity', flat ? '0.5' : '1');
  }
}

function AxisLegend({ refs }: { refs: AxisRefs }) {
  return (
    <figure class="view3d-axes" aria-label={t('view3d.axes')}>
      <svg width={AXIS_CENTRE * 2} height={AXIS_CENTRE * 2} viewBox={`0 0 ${AXIS_CENTRE * 2} ${AXIS_CENTRE * 2}`} aria-hidden="true">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <g key={axis}>
            <line
              ref={(el) => {
                refs.lines[axis] = el;
              }}
              x1={AXIS_CENTRE}
              y1={AXIS_CENTRE}
              x2={AXIS_CENTRE}
              y2={AXIS_CENTRE}
              stroke={AXIS_COLORS[axis]}
              stroke-width="2"
            />
            <text
              ref={(el) => {
                refs.labels[axis] = el;
              }}
              x={AXIS_CENTRE}
              y={AXIS_CENTRE}
              fill={AXIS_COLORS[axis]}
              text-anchor="middle"
              font-size="10"
              font-weight="700"
            >
              {axis.toUpperCase()}
            </text>
          </g>
        ))}
      </svg>
      <figcaption>{t('view3d.axes.front')}</figcaption>
    </figure>
  );
}

function StatusLine() {
  const hover = view.hover.value;
  const model = view.model.value;
  const role = hover?.object === undefined ? undefined : model?.objects.find((o) => o.name === hover.object)?.role;
  const point = hover?.point;
  return (
    <div class="view3d-status" role="status" aria-label={t('view3d.status')} data-testid="view3d-status" data-hover={hover?.object ?? ''}>
      <span class="view3d-status-object">
        {hover?.object === undefined ? t('view3d.status.none') : t('view3d.status.object', { name: hover.object, role: role ?? '?' })}
      </span>
      {point !== undefined && <span class="view3d-status-point">{t('view3d.status.point', { x: point[0], y: point[1], z: point[2] })}</span>}
      <span class="view3d-status-units">{t('view3d.status.units')}</span>
    </div>
  );
}

/** The model and the selection in words, for a screen reader. */
function describe(): string {
  const model = view.model.value;
  if (model === null) return t('view3d.describe.empty');
  const chosen = [...selectedObjects(selection.value, model.id)];
  return [
    t('view3d.describe.model', { model: model.id, count: model.objects.length }),
    chosen.length === 0 ? t('view3d.describe.nothing') : t('view3d.describe.selected', { names: chosen.join(', ') }),
    t('view3d.describe.keys'),
  ].join(' ');
}

export function ViewPanel({ tools }: { tools?: ComponentChildren } = {}) {
  const host = useRef<HTMLDivElement>(null);
  const axes = useRef<AxisRefs>({ lines: {}, labels: {} });
  const [webgl, setWebgl] = useState<'starting' | 'ok' | 'none'>('starting');

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const viewport = Viewport.create(element, view, selection, { onRender: (camera) => turnAxes(axes.current, camera) });
    setWebgl(viewport === null ? 'none' : 'ok');
    exposeForTests(viewport);
    return () => {
      exposeForTests(null);
      viewport?.dispose();
    };
  }, []);

  const model = view.model.value;
  const chosen = [...selectedObjects(selection.value, model?.id ?? null)];
  return (
    <div
      class="view3d"
      data-keys-scope="view tool"
      data-testid="view3d"
      data-webgl={webgl}
      data-camera={view.camera.value}
      data-display={view.display.value}
      data-model={model?.id ?? ''}
      data-selected={chosen.join(',')}
    >
      <ViewBar tools={tools} />
      <div class="view3d-stage">
        <div
          ref={host}
          class="view3d-canvas"
          role="application"
          tabIndex={0}
          aria-label={t('view3d.region')}
          aria-describedby="view3d-description"
          onPointerDown={() => host.current?.focus({ preventScroll: true })}
        />
        <AxisLegend refs={axes.current} />
        {webgl === 'none' ? (
          <p class="view3d-message" data-testid="view3d-no-webgl">
            {t('view3d.noWebgl')}
          </p>
        ) : (
          model === null && <p class="view3d-message">{t('view3d.noModel')}</p>
        )}
      </div>
      <StatusLine />
      <p id="view3d-description" class="view3d-description">
        {describe()}
      </p>
    </div>
  );
}
