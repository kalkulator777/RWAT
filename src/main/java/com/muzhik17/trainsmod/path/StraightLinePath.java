package com.muzhik17.trainsmod.path;

import org.joml.Vector3d;

/**
 * Hardcoded debug path: a straight line A→B (SPEC §2.1, decision 0.2).
 *
 * <p>Exists so Layer 0 has something to run {@code s += v} against before the
 * real spline graph (Layer 1) lands. Pure math, no MC imports.
 */
public final class StraightLinePath implements TrackPath {

    private final Vector3d a;
    private final Vector3d b;
    private final Vector3d dir;
    private final double length;

    public StraightLinePath(Vector3d a, Vector3d b) {
        this.a = new Vector3d(a);
        this.b = new Vector3d(b);
        double len = a.distance(b);
        this.length = len;
        // degenerate A==B: keep a valid unit tangent so sampling never NaNs
        this.dir = len > 1.0e-9
                ? new Vector3d(b).sub(a).div(len)
                : new Vector3d(0, 0, 1);
    }

    /** Start point (copy). */
    public Vector3d start() {
        return new Vector3d(a);
    }

    /** End point (copy). */
    public Vector3d end() {
        return new Vector3d(b);
    }

    @Override
    public double length() {
        return length;
    }

    @Override
    public Vector3d samplePosition(double s) {
        double clamped = Math.clamp(s, 0.0, length);
        return new Vector3d(dir).mul(clamped).add(a);
    }

    @Override
    public Vector3d sampleTangent(double s) {
        return new Vector3d(dir);
    }
}
