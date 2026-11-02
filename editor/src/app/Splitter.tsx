import { useRef } from 'preact/hooks';
import { t } from '../i18n';
import { LAYOUT_LIMITS, layout, resize, type LayoutArea } from './layout';

/** Pixels per arrow key press; Shift moves four times as far. */
export const KEY_STEP = 16;

interface SplitterProps {
  area: LayoutArea;
  /** `x` — a vertical bar between columns, dragged left and right; `y` — a horizontal bar, dragged up and down. */
  axis: 'x' | 'y';
  /** +1 when moving right (down) makes the area larger, −1 when it makes it smaller. */
  sign: 1 | -1;
  /** i18n key of the bar's name for a screen reader. */
  label: string;
  class?: string;
}

/**
 * A bar that resizes one area of the shell by dragging or from the keyboard (arrows,
 * Shift for larger steps, Home and End for the limits): the window splitter of WAI-ARIA.
 */
export function Splitter({ area, axis, sign, label, class: className }: SplitterProps) {
  const drag = useRef<{ pointer: number; start: number; size: number } | null>(null);
  const size = layout.value[area];
  const [min, max] = LAYOUT_LIMITS[area];
  const coordinate = (e: PointerEvent) => (axis === 'x' ? e.clientX : e.clientY);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { pointer: e.pointerId, start: coordinate(e), size };
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (d && d.pointer === e.pointerId) resize(area, d.size + sign * (coordinate(e) - d.start));
  };
  const onPointerEnd = (e: PointerEvent) => {
    if (drag.current?.pointer === e.pointerId) drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (e.key === back) resize(area, size - sign * step);
    else if (e.key === forward) resize(area, size + sign * step);
    else if (e.key === 'Home') resize(area, min);
    else if (e.key === 'End') resize(area, max);
    else return;
    e.preventDefault();
  };

  return (
    <div
      class={`splitter splitter-${axis}${className ? ` ${className}` : ''}`}
      role="separator"
      tabIndex={0}
      aria-label={t(label)}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={size}
      aria-valuemin={min}
      aria-valuemax={max}
      data-area={area}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
    />
  );
}
