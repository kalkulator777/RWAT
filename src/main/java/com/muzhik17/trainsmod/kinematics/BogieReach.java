package com.muzhik17.trainsmod.kinematics;

import org.joml.Vector3d;

/**
 * Whether a player's blow can be at a bogie (SPEC §6.11, breaking a wagon by
 * striking a bogie). The client picks the bogie it aims at (the look ray
 * against the bogie's box in the bogie's own pose — it turns apart from the
 * body, SPEC §5.2); the server, which knows the pose too but not the model,
 * checks that the blow could have landed there: the bogie lies ahead along
 * the look, within reach, and the look passes near it. Pure math, so it is
 * the same on every side and testable.
 *
 * <p>Generous on purpose: the client strikes the bogie it <i>sees</i>, which
 * runs a couple of ticks behind the server's on a moving train (the
 * interpolation delay, SPEC §2.1) — the caller widens {@code slack} by that
 * much travel.
 */
public final class BogieReach {

    /**
     * A bogie's pick box when its model's isn't known (no pack model, still
     * loading), bogie frame, around the path point (rail level): across, up,
     * along. Roomy for a two-axle bogie (1.52 gauge, ~2.4 wheelbase).
     */
    public static final double DEFAULT_HALF_WIDTH = 1.4;
    public static final double DEFAULT_HEIGHT = 1.2;
    public static final double DEFAULT_HALF_LENGTH = 1.6;
    /**
     * How far from the bogie's path point its parts reach, for the server's
     * check: the default box's corner, and then some for a three-axle
     * locomotive bogie (~4.5 long).
     */
    public static final double RADIUS = 2.6;
    /** Height of the bogie's middle over its path point (the rail), for the server's check. */
    public static final double CENTRE_Y = 0.6;

    private BogieReach() {
    }

    /**
     * True if a blow from {@code eye} looking along {@code look} can be at a
     * bogie whose path point is {@code bogie}: its middle ({@link #CENTRE_Y}
     * above the point) is ahead — not behind the eye — no further along the
     * look than {@code reach} plus the bogie's {@link #RADIUS} plus
     * {@code slack}, and the look passes within {@link #RADIUS} plus
     * {@code slack} of it.
     *
     * @param look  the look direction (any length but zero)
     * @param slack extra room: the train's travel the client's view lags by
     */
    public static boolean reaches(Vector3d eye, Vector3d look, Vector3d bogie, double reach, double slack) {
        double lookLength = look.length();
        if (lookLength < 1.0e-9) {
            return false;
        }
        double tx = bogie.x - eye.x;
        double ty = bogie.y + CENTRE_Y - eye.y;
        double tz = bogie.z - eye.z;
        double along = (tx * look.x + ty * look.y + tz * look.z) / lookLength;
        double room = RADIUS + slack;
        if (along < 0.0 || along > reach + room) {
            return false;
        }
        double off2 = tx * tx + ty * ty + tz * tz - along * along;
        return off2 <= room * room;
    }
}
