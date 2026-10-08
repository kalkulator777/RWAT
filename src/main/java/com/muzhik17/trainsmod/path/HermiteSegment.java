package com.muzhik17.trainsmod.path;

import org.joml.Vector3d;

/**
 * Cubic Hermite spline segment in 3D (SPEC §2.2, open question #1: Hermite).
 *
 * <p>A node stores position + tangent; the tangent is shared by adjacent
 * segments, giving C1 continuity at joints for free. A straight track is the
 * special case of tangents along the chord A→B — no separate code path
 * (SPEC §2.2).
 *
 * <p>Pure math, no MC imports (SPEC principle #4). The raw parameter
 * {@code t ∈ [0, 1]} is internal: all motion uses arc length via
 * {@link ArcLengthTable}, never raw {@code t}.
 */
public final class HermiteSegment {

    private final Vector3d p0;
    private final Vector3d m0;
    private final Vector3d p1;
    private final Vector3d m1;

    /**
     * @param p0 start position
     * @param m0 start tangent (direction and magnitude; for a natural-looking
     *           curve, magnitudes on the order of the chord length)
     * @param p1 end position
     * @param m1 end tangent
     */
    public HermiteSegment(Vector3d p0, Vector3d m0, Vector3d p1, Vector3d m1) {
        this.p0 = new Vector3d(p0);
        this.m0 = new Vector3d(m0);
        this.p1 = new Vector3d(p1);
        this.m1 = new Vector3d(m1);
    }

    /** A straight segment A→B: tangents along the chord, uniform speed in t. */
    public static HermiteSegment straight(Vector3d a, Vector3d b) {
        Vector3d chord = new Vector3d(b).sub(a);
        return new HermiteSegment(a, chord, b, chord);
    }

    public Vector3d start() {
        return new Vector3d(p0);
    }

    public Vector3d end() {
        return new Vector3d(p1);
    }

    public Vector3d startTangent() {
        return new Vector3d(m0);
    }

    public Vector3d endTangent() {
        return new Vector3d(m1);
    }

    /** Position at raw parameter {@code t ∈ [0, 1]} (clamped). */
    public Vector3d position(double t) {
        double tc = Math.clamp(t, 0.0, 1.0);
        double t2 = tc * tc;
        double t3 = t2 * tc;
        double h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
        double h10 = t3 - 2.0 * t2 + tc;
        double h01 = -2.0 * t3 + 3.0 * t2;
        double h11 = t3 - t2;
        return new Vector3d(p0).mul(h00)
                .add(new Vector3d(m0).mul(h10))
                .add(new Vector3d(p1).mul(h01))
                .add(new Vector3d(m1).mul(h11));
    }

    /** Derivative dp/dt at raw parameter {@code t ∈ [0, 1]} (clamped). Not unit length. */
    public Vector3d velocity(double t) {
        double tc = Math.clamp(t, 0.0, 1.0);
        double t2 = tc * tc;
        double h00 = 6.0 * t2 - 6.0 * tc;
        double h10 = 3.0 * t2 - 4.0 * tc + 1.0;
        double h01 = -6.0 * t2 + 6.0 * tc;
        double h11 = 3.0 * t2 - 2.0 * tc;
        return new Vector3d(p0).mul(h00)
                .add(new Vector3d(m0).mul(h10))
                .add(new Vector3d(p1).mul(h01))
                .add(new Vector3d(m1).mul(h11));
    }
}
