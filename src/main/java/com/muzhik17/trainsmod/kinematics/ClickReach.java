package com.muzhik17.trainsmod.kinematics;

/**
 * The server's reach check for a click on a moving car (SPEC §9.3): is the
 * player's eye near enough to the part they clicked? The client draws a
 * train behind the server — the playback delay, the tick the model is drawn
 * behind the clock (SPEC §2.1), the snapshot's and the click's trip over the
 * wire — so by the time a click arrives the car has run on. Measured against
 * the car where the server has it, an honest click on a passing train fell
 * out of reach. So the eye is taken back along the car's run instead: in the
 * car's pose frame (+Z along +s) the car that was drawn stood {@code v·k}
 * behind for some lag {@code k}, the eye {@code v·k} further forward of it —
 * the eye is swept along z over the lag, and the nearest point of the sweep
 * counts. Pure; the frame is the caller's.
 */
public final class ClickReach {

    /**
     * Ticks of lag past the playback delay and the round trip: the tick the
     * model is drawn behind the clock, the server tick a click waits for, and
     * one for jitter.
     */
    public static final double EXTRA_TICKS = 3.0;

    private ClickReach() {
    }

    /**
     * How many ticks behind the server a client may have drawn the train it
     * clicked: the playback delay, the round trip, {@link #EXTRA_TICKS}.
     */
    public static double lagTicks(double playbackDelayTicks, int roundTripMillis) {
        return playbackDelayTicks + Math.max(roundTripMillis, 0) / 50.0 + EXTRA_TICKS;
    }

    /**
     * The squared distance between the box {@code min…max} and the eye
     * {@code (ex, ey, ez)} swept along z by {@code sweepZ} (either sign: the
     * eye's z runs from {@code ez} to {@code ez + sweepZ}); 0 if the sweep
     * touches the box. A point is a box with {@code min == max}.
     */
    public static double distanceSq(double ex, double ey, double ez, double sweepZ,
            double minX, double minY, double minZ, double maxX, double maxY, double maxZ) {
        double z0 = Math.min(ez, ez + sweepZ);
        double z1 = Math.max(ez, ez + sweepZ);
        double dx = Math.max(Math.max(minX - ex, ex - maxX), 0.0);
        double dy = Math.max(Math.max(minY - ey, ey - maxY), 0.0);
        double dz = Math.max(Math.max(minZ - z1, z0 - maxZ), 0.0);
        return dx * dx + dy * dy + dz * dz;
    }
}
