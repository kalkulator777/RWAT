package com.muzhik17.trainsmod.kinematics;

import org.joml.Quaterniond;
import org.joml.Vector3d;

/**
 * How far a car body has moved on its springs (SPEC §10), in the wagon's pose
 * frame (+Z forward along +s, +Y up, +X left): {@code bounce} up, in blocks;
 * {@code pitch} nose down and {@code roll} top to the right, in radians,
 * both about a centre {@link #CENTRE_Y} above the pose origin. The renderer
 * draws the body with it on top of the pose; riders ride it the same way
 * (bogies don't — they stay on the rail).
 */
public record Sway(double bounce, double pitch, double roll) {

    public static final Sway ZERO = new Sway(0.0, 0.0, 0.0);

    /**
     * Height of the body's rocking centre above the pose origin (the track),
     * blocks: about where a car rests on its bogies' springs.
     */
    public static final double CENTRE_Y = 1.0;

    public Sway scaled(double factor) {
        return new Sway(bounce * factor, pitch * factor, roll * factor);
    }

    public static Sway lerp(Sway from, Sway to, double t) {
        return new Sway(from.bounce + (to.bounce - from.bounce) * t,
                from.pitch + (to.pitch - from.pitch) * t,
                from.roll + (to.roll - from.roll) * t);
    }

    /**
     * A point of the body (pose frame) moved with the body: lifted by the
     * bounce, turned about the rocking centre — roll about +Z, then pitch
     * about +X, the order the renderer applies them in. Returns a fresh vector.
     */
    public Vector3d apply(Vector3d local) {
        Vector3d out = new Vector3d(local.x, local.y - CENTRE_Y, local.z);
        new Quaterniond().rotateZ(roll).rotateX(pitch).transform(out);
        return out.add(0.0, CENTRE_Y + bounce, 0.0);
    }
}
