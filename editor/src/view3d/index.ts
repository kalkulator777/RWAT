/**
 * The 3D view (docs/proposals/editor.md §3.8): the model in the OBJ frame with its roles,
 * textures or lights, cameras and guides, picking through a BVH, overlays.
 *
 * - `view` is the `ViewApi` of core/contracts: the shell shows the open model with it and
 *   gives it the wagon type's frame for the guides (`view.setFrame(wagonFrame(type))`), the
 *   preview moves, hides, lights and repaints objects, the tools draw overlay layers,
 *   listen to picks and take the left button's presses (`setDragger`) to draw by dragging.
 * - `ROLE_COLORS`, `roleColor`, `roleColorCss`, `isGhostRole` (./roleColors.ts): the role
 *   colours, one table for the view and the objects tab's legend.
 * - `OVERLAY_STYLES`: the names an overlay shape's `style` may take.
 * - `ViewPanel`: the panel of the `view` slot.
 */

export { view, GHOSTS_LAYER, type Hover, type ViewDragger, type ViewPointer, type ViewState } from './state';
export { GHOST_ROLES, isGhostRole, ROLE_COLORS, roleColor, roleColorCss, UNKNOWN_ROLE_COLOR, VIEW_BACKGROUND } from './roleColors';
export { OVERLAY_STYLES, overlayStyle, type OverlayStyle } from './overlays';
export { frameGuides, RAILHEAD_OBJ_Y, wagonFrame, type FrameGuides, type WagonFrame } from './frame';
export { CAMERA_VIEWS, type CameraView } from './cameras';
export { DISPLAY_MODES, type DisplayMode } from './modelScene';
export { ViewPanel } from './ViewPanel';
