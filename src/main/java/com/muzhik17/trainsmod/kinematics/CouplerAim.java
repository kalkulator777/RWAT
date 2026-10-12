package com.muzhik17.trainsmod.kinematics;

/**
 * Which way a coupler head points (SPEC §6.12): it turns on its pivot at the
 * end of the frame, so that two coupled heads meet — each aims at the same
 * point, the middle between the two cars' pivots — in a curve or over a
 * change of grade, instead of each running straight out of its own car and
 * parting at an angle. An uncoupled head hangs straight. Pure; the frame is
 * the car's model frame (+Z front, +Y up, +X left).
 */
public final class CouplerAim {

    /** How far a head turns either way, degrees — a coupler's swing limit, so a sharp curve can't twist it off. */
    public static final double LIMIT_DEGREES = 22.0;

    private CouplerAim() {
    }

    /**
     * The turn of a head on its pivot {@code (px, py, pz)} that points its
     * outward axis — +Z at the {@code front} end, −Z at the rear — at the
     * target {@code (tx, ty, tz)}: {@code {yaw, pitch}} in radians, yaw about
     * +Y applied after pitch about +X ({@code Ry(yaw)·Rx(pitch)}), each held
     * to ±{@code limitDegrees}. {@code {0, 0}} for a target at the pivot.
     */
    public static double[] angles(double px, double py, double pz, double tx, double ty, double tz,
            boolean front, double limitDegrees) {
        double dx = tx - px;
        double dy = ty - py;
        double dz = tz - pz;
        double horizontal = Math.hypot(dx, dz);
        if (horizontal < 1.0e-9 && Math.abs(dy) < 1.0e-9) {
            return new double[]{0.0, 0.0};
        }
        // Ry(yaw)·Rx(pitch) takes +Z to (cos p·sin y, −sin p, cos p·cos y) and −Z to its negative
        double yaw = front ? Math.atan2(dx, dz) : Math.atan2(-dx, -dz);
        double pitch = front ? -Math.atan2(dy, horizontal) : Math.atan2(dy, horizontal);
        double limit = Math.toRadians(limitDegrees);
        return new double[]{Math.clamp(yaw, -limit, limit), Math.clamp(pitch, -limit, limit)};
    }
}
