/**
 * Overlay styles (view3d/overlays `OVERLAY_STYLES`) more than one markup tool draws with:
 * the zones tool's cab areas and the chairs tool's chairs in the cab they are in share one
 * shade a cab. Plain data.
 */

/** The cabs' shades, the first cab's first; more cabs take them over again. */
export const CAB_STYLES = ['cab', 'cab-2', 'cab-3', 'cab-4'] as const;

/** The shade of cab `cab` (0 the first, as ports/cabArea numbers them). */
export function cabStyle(cab: number): string {
  return CAB_STYLES[cab % CAB_STYLES.length] as string;
}
