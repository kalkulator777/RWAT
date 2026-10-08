package com.muzhik17.trainsmod.rail;

/**
 * The switch marker (SPEC §2.2 UX): like the plain {@link RailMarkerBlock}
 * (same 8-step rotation from the placer's look, same registry hooks — the
 * registry tells the two apart by block type), but clicking it with rails
 * builds a junction instead of a plain segment:
 *
 * <ul>
 * <li><b>Y-switch:</b> this marker is the toe (point A), the two nearest plain
 * markers are the branch ends (B and C) — two segments A→B and A→C sharing
 * node A and its tangent.</li>
 * <li><b>Diamond crossing:</b> four switch markers and no plain ones — two
 * independent segments between opposite pairs, crossing in the middle (no
 * shared node, no route choice — a diamond, not a slip).</li>
 * </ul>
 *
 * <p>Geometry only for now: route walking still stops at nodes with more than
 * two segments, the switching mechanics (point state, train routing) are v1.
 */
public class RailSwitchMarkerBlock extends RailMarkerBlock {

    public RailSwitchMarkerBlock(Properties properties) {
        super(properties);
    }
}
