package com.muzhik17.trainsmod.path;

import org.joml.Vector3d;

/**
 * {@link TrackPath} over a single Hermite segment: position/tangent by arc
 * length via the segment's {@link ArcLengthTable}. The multi-segment graph
 * path (Layer 1 proper) chains these per segment.
 */
public final class HermiteSegmentPath implements TrackPath {

    private final HermiteSegment segment;
    private final ArcLengthTable table;

    public HermiteSegmentPath(HermiteSegment segment) {
        this.segment = segment;
        this.table = ArcLengthTable.of(segment);
    }

    public HermiteSegment segment() {
        return segment;
    }

    @Override
    public double length() {
        return table.length();
    }

    @Override
    public Vector3d samplePosition(double s) {
        return segment.position(table.tForS(s));
    }

    @Override
    public Vector3d sampleTangent(double s) {
        Vector3d velocity = segment.velocity(table.tForS(s));
        double len = velocity.length();
        // degenerate (zero-velocity) point: fall back to the chord direction
        if (len < 1.0e-9) {
            Vector3d chord = segment.end().sub(segment.start());
            double chordLen = chord.length();
            return chordLen > 1.0e-9 ? chord.div(chordLen) : new Vector3d(0, 0, 1);
        }
        return velocity.div(len);
    }
}
