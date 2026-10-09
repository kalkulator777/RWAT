package com.muzhik17.trainsmod.path;

import org.joml.Vector3d;

/**
 * How a rail style's tile is laid along a segment (SPEC §2.2, §6.10): the
 * path it is swept along (the curve, extended at open ends), how many tiles
 * fit, and the frame each tile station is bent with. Shared by the client's
 * rail renderer, which bends the tile's vertices, and the server's track bed
 * ({@link BedRaster}), which rasterizes the very same bent tile — so the bed
 * covers exactly the blocks the drawn rails touch and can't drift from them.
 *
 * <p>Pure math, no MC imports (SPEC principle #4).
 */
public final class TrackSweep {

    /**
     * How far the rails extend past an open track end (half a block — the node
     * sits at its marker's cell centre, so this carries the rails to the cell
     * edge instead of stopping chopped-off mid-cell). Only open ends get it
     * ({@link RailGraph#overhangAt}): where another segment continues the track
     * past the node, its rails take over and an overhang would z-fight them. A
     * joint that loses its neighbour becomes an open end and grows the
     * overhang — ends always look finished.
     */
    public static final double END_OVERHANG = 0.5;

    /**
     * Vertical seat of the rail base relative to the spline point, applied along
     * the path's up. The spline point is at ground level (the clicked block's top
     * face), so 0.0 seats the rail base on the ground; the thin track bed frames
     * it rather than lifting it. Kept as a named constant for easy tuning.
     */
    public static final double RAIL_Y_OFFSET = 0.0;

    /** Floats per station in a {@link #frame} array: position, forward, right, up. */
    public static final int FRAME_STRIDE = 12;

    private TrackSweep() {
    }

    /** The path a segment's tile is swept along: its curve, with the overhang at its open ends. */
    public static TrackPath path(RailGraph graph, RailSegment segment) {
        return path(new HermiteSegmentPath(graph.hermite(segment)),
                graph.overhangAt(segment, segment.nodeA()),
                graph.overhangAt(segment, segment.nodeB()));
    }

    /** {@code base} extended by {@link #END_OVERHANG} at the flagged ends (unchanged if neither). */
    public static TrackPath path(TrackPath base, boolean overhangStart, boolean overhangEnd) {
        double startOver = overhangStart ? END_OVERHANG : 0.0;
        double endOver = overhangEnd ? END_OVERHANG : 0.0;
        return startOver > 0.0 || endOver > 0.0 ? new OverhangPath(base, startOver, endOver) : base;
    }

    /**
     * Tiles laid along a path of {@code length}: the nearest whole number of
     * {@code tileLength}s, at least one — each tile is then stretched or
     * squeezed to {@code length / count}, so the ends always meet the nodes.
     */
    public static int tileCount(double length, double tileLength) {
        return Math.max(1, (int) Math.round(length / tileLength));
    }

    /**
     * The frame a tile station at distance {@code s} is bent with, written to
     * {@code out[offset .. offset + FRAME_STRIDE)}: position, unit forward
     * (the path tangent), right (horizontal, world up × forward) and up
     * (forward × right). A tile vertex at local (along, height, across) lands
     * at {@code position + right·across + up·(height + RAIL_Y_OFFSET)}.
     */
    public static void frame(TrackPath path, double s, double[] out, int offset) {
        Vector3d pos = path.samplePosition(s);
        Vector3d fwd = path.sampleTangent(s); // unit
        Vector3d right = new Vector3d(0, 1, 0).cross(fwd);
        if (right.lengthSquared() < 1.0e-9) {
            right.set(1, 0, 0);
        }
        right.normalize();
        Vector3d up = new Vector3d(fwd).cross(right).normalize();
        out[offset] = pos.x;
        out[offset + 1] = pos.y;
        out[offset + 2] = pos.z;
        out[offset + 3] = fwd.x;
        out[offset + 4] = fwd.y;
        out[offset + 5] = fwd.z;
        out[offset + 6] = right.x;
        out[offset + 7] = right.y;
        out[offset + 8] = right.z;
        out[offset + 9] = up.x;
        out[offset + 10] = up.y;
        out[offset + 11] = up.z;
    }
}
