/**
 * Sizes of the shell's resizable areas (docs/proposals/editor.md §6.1: widths change by
 * dragging, the layout is remembered in the browser). The stored numbers are the user's
 * preference in CSS pixels; the stylesheet still caps each side at a share of the
 * window, so a layout saved on a wide screen does not squeeze the view on a narrow one.
 */

import { signal } from '@preact/signals';

export interface LayoutSizes {
  /** Width of the pack tree on the left. */
  tree: number;
  /** Width of the inspector on the right. */
  inspector: number;
  /** Height of the bottom tabs. */
  bottom: number;
}

export type LayoutArea = keyof LayoutSizes;

export const DEFAULT_LAYOUT: Readonly<LayoutSizes> = { tree: 280, inspector: 340, bottom: 220 };

/** Smallest and largest size of each area. */
export const LAYOUT_LIMITS: Readonly<Record<LayoutArea, readonly [number, number]>> = {
  tree: [160, 560],
  inspector: [240, 640],
  bottom: [96, 640],
};

export const LAYOUT_STORAGE_KEY = 'rwat.editor.layout';

/** The size within the area's limits, in whole pixels; anything that is not a finite number gives the default. */
export function clampSize(area: LayoutArea, value: unknown): number {
  const [min, max] = LAYOUT_LIMITS[area];
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LAYOUT[area];
  return Math.round(Math.min(max, Math.max(min, value)));
}

/** A layout from whatever was stored: known areas clamped, the rest default. */
export function parseLayout(stored: string | null | undefined): LayoutSizes {
  const value = parseJson(stored);
  const record = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    tree: clampSize('tree', record.tree),
    inspector: clampSize('inspector', record.inspector),
    bottom: clampSize('bottom', record.bottom),
  };
}

function parseJson(text: string | null | undefined): unknown {
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

function readStored(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAYOUT_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** The current layout. Change it with {@link resize}, which also remembers it. */
export const layout = signal<LayoutSizes>(parseLayout(readStored()));

/** Sets one area's size (clamped) and remembers the layout in this browser. */
export function resize(area: LayoutArea, size: number): void {
  const next = { ...layout.value, [area]: clampSize(area, size) };
  layout.value = next;
  try {
    globalThis.localStorage?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: the layout holds until the page is closed
  }
}
