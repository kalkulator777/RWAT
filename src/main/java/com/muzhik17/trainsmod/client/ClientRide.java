package com.muzhik17.trainsmod.client;

import java.util.HashMap;
import java.util.Map;

import com.muzhik17.trainsmod.kinematics.RideMotion;
import com.muzhik17.trainsmod.kinematics.Sway;
import com.muzhik17.trainsmod.kinematics.WagonPose;
import com.muzhik17.trainsmod.path.TrackPath;

/**
 * Car bodies rocking on their springs, client side (SPEC §10): one
 * {@link RideMotion} per wagon entity, stepped once per client tick from the
 * wagon's tick pose ({@link ClientConsists#tickPose}) and the consist's speed
 * at the same clock. The renderer draws the body with {@link #sway} (the
 * tick window interpolated, like the pose itself); riders are placed with
 * {@link #current}, so the camera rides the body. Each step also notes the
 * rail joints each bogie crossed, which the wheels' knock plays from
 * ({@link #takeJoints}).
 *
 * <p>How hard a body rocks is the client's {@code swayStrength} times its
 * type's own factor ({@code "sway"} in the pack's model declaration), handed
 * over by the model reload ({@link #typeSway}).
 *
 * <p>A blow at a bogie (SPEC §6.11) rocks the body too: the wagon's wobble,
 * a roll, rides on top of the springs — not scaled by {@code swayStrength},
 * which is the track's doing; it is the feedback of a hit.
 *
 * <p>Nothing here is synced: each client steps its own copy from the same
 * snapshots. Deliberately free of client-only MC classes so the common
 * {@code WagonEntity} can call it.
 */
public final class ClientRide {

    private static final double TICK_SECONDS = 0.05;
    /** Ticks without a step after which a wagon's state is dropped (the entity is gone). */
    private static final int STALE_TICKS = 40;

    private static final class Ride {
        final RideMotion motion = new RideMotion();
        Sway previous = Sway.ZERO;
        Sway current = Sway.ZERO;
        /** A blow's rock, radians of roll, last tick and this one. */
        double knockPrevious;
        double knock;
        /** The wagon type's own sway factor. */
        double typeFactor = 1.0;
        TrackPath path;
        double frontS;
        double rearS;
        long frontJoint;
        long rearJoint;
        double speed = Double.NaN;
        int frontCrossed;
        int rearCrossed;
        long lastTick;
    }

    private static final Map<Integer, Ride> RIDES = new HashMap<>();
    private static long ticks;
    /** Sway factor by wagon type id, the types the packs scale (the rest rock at 1). */
    private static Map<String, Double> typeSway = Map.of();

    private ClientRide() {
    }

    /** Once per client tick, before entities tick: the clock, and dropping wagons that left. */
    public static void tickAll() {
        ticks++;
        RIDES.values().removeIf(ride -> ticks - ride.lastTick > STALE_TICKS);
    }

    /** The packs' per-type sway factors (SPEC §10.2), from each model reload: type id → factor. */
    public static void typeSway(Map<String, Double> factors) {
        typeSway = Map.copyOf(factors);
    }

    /**
     * Step one wagon's body (from its client tick, after its pose is set).
     *
     * @param typeId the wagon's type, for its sway factor; null = unknown yet
     * @param pose   the wagon's tick pose
     * @param knock  a blow's rock this tick, radians of roll (0: none)
     */
    public static void step(int entityId, int consistId, String typeId, WagonPose pose, double knock) {
        Ride ride = RIDES.computeIfAbsent(entityId, id -> new Ride());
        if (ride.lastTick == ticks) {
            return; // ticked twice in one client tick — never step twice
        }
        ride.lastTick = ticks;
        ride.typeFactor = typeId == null ? 1.0 : typeSway.getOrDefault(typeId, 1.0);
        TrackPath path = ClientConsists.trackPath(consistId);
        double frontS = pose.front().pathS();
        double rearS = pose.rear().pathS();
        double speed = ClientConsists.tickSpeed(consistId) / TICK_SECONDS; // blocks/tick → m/s
        double accel = Double.isNaN(ride.speed) ? 0.0 : (speed - ride.speed) / TICK_SECONDS;

        // joints crossed since the last tick — unless the path or the meaning
        // of s changed under us (a re-anchor, a coupling): then just re-seed
        double reach = Math.abs(speed) * TICK_SECONDS * 2.0 + 1.0;
        boolean continuous = path != null && path == ride.path
                && Math.abs(frontS - ride.frontS) <= reach && Math.abs(rearS - ride.rearS) <= reach;
        long frontJoint = path == null ? 0L : path.jointIndex(frontS);
        long rearJoint = path == null ? 0L : path.jointIndex(rearS);
        ride.frontCrossed = continuous ? (int) Math.min(Math.abs(frontJoint - ride.frontJoint), 3) : 0;
        ride.rearCrossed = continuous ? (int) Math.min(Math.abs(rearJoint - ride.rearJoint), 3) : 0;
        ride.path = path;
        ride.frontS = frontS;
        ride.rearS = rearS;
        ride.frontJoint = frontJoint;
        ride.rearJoint = rearJoint;
        ride.speed = speed;

        // the track's curvature under the car, from the bogies' headings
        // (yaw falls as the track turns left — toward +X of the pose frame)
        double span = frontS - rearS;
        double turn = Math.toRadians(wrapDegrees(pose.front().yaw() - pose.rear().yaw()));
        double curvature = span > 1.0e-3 ? -turn / span : 0.0;

        ride.motion.step(TICK_SECONDS, new RideMotion.Input(frontS, rearS, speed,
                continuous ? accel : 0.0, curvature, ride.frontCrossed, ride.rearCrossed));
        ride.previous = ride.current;
        ride.current = ride.motion.sway();
        ride.knockPrevious = ride.knock;
        ride.knock = knock;
    }

    /**
     * The body's sway for rendering at {@code partialTick} (the tick window,
     * like the pose), scaled by the client setting and the wagon type's factor.
     */
    public static Sway sway(int entityId, float partialTick) {
        Ride ride = RIDES.get(entityId);
        if (ride == null) {
            return Sway.ZERO;
        }
        double strength = ClientConfig.swayStrength() * ride.typeFactor;
        Sway springs = strength <= 0.0 ? Sway.ZERO
                : Sway.lerp(ride.previous, ride.current, partialTick).scaled(strength);
        return knocked(springs, ride.knockPrevious + (ride.knock - ride.knockPrevious) * partialTick);
    }

    /** The body's sway at the current tick, where riders are placed (scaled like {@link #sway}). */
    public static Sway current(int entityId) {
        Ride ride = RIDES.get(entityId);
        if (ride == null) {
            return Sway.ZERO;
        }
        double strength = ClientConfig.swayStrength() * ride.typeFactor;
        return knocked(strength <= 0.0 ? Sway.ZERO : ride.current.scaled(strength), ride.knock);
    }

    /** The body's sway with a blow's rock added to its roll. */
    private static Sway knocked(Sway sway, double knock) {
        return knock == 0.0 ? sway : new Sway(sway.bounce(), sway.pitch(), sway.roll() + knock);
    }

    /**
     * Rail joints the wagon's bogies crossed in its last step, front and rear
     * — then forgotten, so each knock plays once.
     */
    public static int[] takeJoints(int entityId) {
        Ride ride = RIDES.get(entityId);
        if (ride == null || ride.lastTick != ticks) {
            return new int[] {0, 0};
        }
        int[] crossed = {ride.frontCrossed, ride.rearCrossed};
        ride.frontCrossed = 0;
        ride.rearCrossed = 0;
        return crossed;
    }

    private static double wrapDegrees(double degrees) {
        double wrapped = degrees % 360.0;
        if (wrapped >= 180.0) {
            wrapped -= 360.0;
        } else if (wrapped < -180.0) {
            wrapped += 360.0;
        }
        return wrapped;
    }

    /** Drop everything (logout). */
    public static void clearAll() {
        RIDES.clear();
    }
}
