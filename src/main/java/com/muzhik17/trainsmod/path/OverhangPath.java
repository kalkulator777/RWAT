package com.muzhik17.trainsmod.path;

import org.joml.Vector3d;

/**
 * A path extended past its ends by extrapolating along the end tangents —
 * lets a rail style's tile be swept {@link TrackSweep#END_OVERHANG} beyond an
 * open track end without touching the graph geometry (SPEC §2.2).
 */
public record OverhangPath(TrackPath inner, double startOver, double endOver) implements TrackPath {

    @Override
    public double length() {
        return inner.length() + startOver + endOver;
    }

    @Override
    public Vector3d samplePosition(double s) {
        double t = s - startOver;
        double innerLength = inner.length();
        if (t < 0.0) {
            return inner.samplePosition(0.0).add(inner.sampleTangent(0.0).mul(t));
        }
        if (t > innerLength) {
            return inner.samplePosition(innerLength)
                    .add(inner.sampleTangent(innerLength).mul(t - innerLength));
        }
        return inner.samplePosition(t);
    }

    @Override
    public Vector3d sampleTangent(double s) {
        return inner.sampleTangent(s - startOver); // inner clamps to [0, length]
    }
}
