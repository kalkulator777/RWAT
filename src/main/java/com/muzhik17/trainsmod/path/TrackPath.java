package com.muzhik17.trainsmod.path;

import org.joml.Vector3d;

/**
 * Minimal path interface Layer 0 is built against (SPEC §2.1, decision 0.2).
 *
 * <p>Pure math — no {@code net.minecraft.*} imports (SPEC principle #4).
 * All motion is expressed as distance-along-path {@code s} in blocks; sampling
 * out-of-range {@code s} clamps to the path ends — except on a closed
 * {@link #loop()}, where {@code s} wraps modulo the length instead.
 *
 * <p>Layer 1 substitutes the real spline graph behind this interface without
 * changing it.
 */
public interface TrackPath {

    /**
     * Rail length between joints, blocks (SPEC §10): the standard 25 m rail
     * of Russian jointed track — where the wheels knock and the car jolts.
     */
    double JOINT_SPACING = 25.0;

    /** Total path length in blocks. */
    double length();

    /**
     * True if the path is a closed loop (its end joins its start): sampling
     * wraps {@code s} modulo {@link #length()} and a consist circulates
     * instead of stopping at the artificial route end.
     */
    default boolean loop() {
        return false;
    }

    /**
     * World position at distance {@code s} along the path.
     * {@code s} is clamped to {@code [0, length()]}. Returns a fresh vector.
     */
    Vector3d samplePosition(double s);

    /**
     * Unit tangent (travel direction for increasing {@code s}) at distance
     * {@code s}. {@code s} is clamped to {@code [0, length()]}. Returns a
     * fresh vector.
     */
    Vector3d sampleTangent(double s);

    /**
     * How many rail joints lie at or before {@code s} (SPEC §10), give or take
     * a constant: a step function of {@code s}, so the joints a wheel crossed
     * between two positions are the difference of the two counts. This
     * default spaces the joints evenly along {@code s}; a {@link RoutePath}
     * lays them per segment, so they stay put on the track whichever route
     * runs over it.
     */
    default long jointIndex(double s) {
        return (long) Math.floor(s / JOINT_SPACING);
    }

    /** Distance from {@code s} to the nearest rail joint, blocks (SPEC §10). */
    default double jointDistance(double s) {
        double into = s - Math.floor(s / JOINT_SPACING) * JOINT_SPACING;
        return Math.min(into, JOINT_SPACING - into);
    }
}
