package com.muzhik17.trainsmod.kinematics;

import org.joml.Vector3d;

/**
 * Whether a player logging back in is where they logged out aboard a car
 * (SPEC v1.5-б, logging out aboard): the spot their feet were on — the car's
 * floor where it stands now, or its seat — is right by them. They come back
 * on the spot they left, but the car is an entity of its own and loads a
 * moment later: by then they may have dropped through its floor to the
 * track (≈ 1.8 below) or a little further. If the train has moved on
 * since, the spot is elsewhere and they stay where they are. Pure, so it is
 * testable.
 */
public final class ReturnAboard {

    /** How far off the spot across the floor a returning player may be (a body width and a half). */
    public static final double ACROSS = 1.0;
    /** How far below it: a drop through the car's floor to the track, and some. */
    public static final double BELOW = 3.0;
    /** How far above it. */
    public static final double ABOVE = 0.5;

    private ReturnAboard() {
    }

    /** True if a player standing at {@code player} (feet) is at the spot {@code feet} they left, by the rules above. */
    public static boolean near(Vector3d feet, Vector3d player) {
        double dy = player.y - feet.y;
        return Math.hypot(player.x - feet.x, player.z - feet.z) <= ACROSS && dy >= -BELOW && dy <= ABOVE;
    }
}
