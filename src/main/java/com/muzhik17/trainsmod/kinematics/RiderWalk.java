package com.muzhik17.trainsmod.kinematics;

import java.util.List;

import org.joml.Quaterniond;
import org.joml.Vector3d;

import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Advances a wagon-bound rider's local feet position from walk input (SPEC
 * v1.5-б). Pure math, shared verbatim by the client prediction and the
 * server-authoritative update so both land on the same local point: same
 * inputs + same wagon yaw → same result.
 *
 * <p>The rider walks the interior <b>floor plane</b> (local X–Z): the player's
 * look-relative input is turned into a world horizontal move exactly as
 * vanilla {@code moveRelative} does, then rotated into the wagon's local frame
 * by yaw only (pitch is ignored so a graded car's floor stays walkable), and
 * kept on the walkable floor — the {@link WagonType.Interior} zones, plus a
 * bridge through every open door between zones (SPEC §9.1). A step that would
 * leave the floor slides along the wall of the zone the rider stands in.
 * Vertical movement (stairs, jumping between decks) is out of v0: the feet
 * take the floor height of the zone they are in.
 */
public final class RiderWalk {

    /** Interior walking speed, blocks/tick (a stroll, slower than open-field running). */
    public static final double WALK_SPEED = 0.12;
    /** Player half-width kept off the walls when clamping. */
    public static final double PLAYER_HALF_WIDTH = 0.3;
    /**
     * How far inside a door's edges the rider's centre must be to walk out
     * through it — a body grazing the door frame leans on the wall instead.
     */
    public static final double DOOR_SPAN_INSET = 0.1;
    /**
     * How far a door bridge reaches past each face of an open door between
     * zones — through the wall into the walkable part of both zones (wall
     * thickness + the half-width the zones are shrunk by).
     */
    static final double BRIDGE_REACH = 0.6;
    /** How far a hull door may sit from a zone's wall and still be that wall's way out. */
    static final double DOOR_WALL_SLACK = 0.6;

    private RiderWalk() {
    }

    /**
     * A step with no doors between zones (a single-saloon car, or all such
     * doors shut).
     */
    public static Vector3d step(Vector3d local, double forward, double strafe,
            float playerYaw, float wagonYaw, WagonType.Interior interior) {
        return step(local, forward, strafe, playerYaw, wagonYaw, interior, List.of(), 0);
    }

    /**
     * @param local     current local feet position
     * @param forward   forward input (+1 = the player's look forward), [-1,1]
     * @param strafe    strafe input (+1 = left, vanilla {@code leftImpulse}), [-1,1]
     * @param playerYaw the player's world look yaw, degrees
     * @param wagonYaw  the wagon body's world yaw, degrees
     * @param interior  the walkable floor <b>in the pose frame</b>
     * @param doors     the type's doors <b>in the pose frame</b>
     * @param openMask  bit {@code i} set = door {@code i} open
     * @return the new local feet position (on the floor)
     */
    public static Vector3d step(Vector3d local, double forward, double strafe,
            float playerYaw, float wagonYaw, WagonType.Interior interior,
            List<WagonType.Door> doors, int openMask) {
        Vector3d next = unclamped(local, forward, strafe, playerYaw, wagonYaw);
        if (!onFloor(local.x, local.z, interior, doors, openMask)) {
            return interior.clampFeet(next, PLAYER_HALF_WIDTH); // lost the floor: nearest point
        }
        if (onFloor(next.x, next.z, interior, doors, openMask)) {
            return withFloor(next, local.y, interior);
        }
        // slide: pull the step back inside each region the rider stands in —
        // or ease into a zone just beside them (out of a doorway that isn't in
        // line with the floor beyond it), only within SIDESTEP, which can't
        // cross a wall: between zones a wall is ≥ 2 half-widths of no floor.
        // Keep the candidate that makes the most headway along the step.
        double mx = next.x - local.x;
        double mz = next.z - local.z;
        Vector3d best = new Vector3d(local);
        double bestGain = 1.0e-9;
        for (WagonType.Interior.Zone zone : interior.zones()) {
            Vector3d c = zone.clamp(next.x, next.z, PLAYER_HALF_WIDTH);
            boolean standsIn = zone.holds(local.x, local.z, PLAYER_HALF_WIDTH);
            if (standsIn || Math.hypot(c.x - local.x, c.z - local.z) <= SIDESTEP) {
                double gain = (c.x - local.x) * mx + (c.z - local.z) * mz;
                if (gain > bestGain) {
                    best = c;
                    bestGain = gain;
                }
            }
        }
        for (int i = 0; i < doors.size(); i++) {
            WagonType.Door door = doors.get(i);
            if (door.inner() && door.open(openMask, i) && inBridge(local.x, local.z, door)) {
                Vector3d c = clampToBridge(next.x, next.z, door);
                double gain = (c.x - local.x) * mx + (c.z - local.z) * mz;
                if (gain > bestGain) {
                    best = c;
                    bestGain = gain;
                }
            }
        }
        return withFloor(best, local.y, interior);
    }

    /**
     * The furthest a blocked step may ease sideways into a neighbouring zone:
     * under the 0.6 of no floor any wall leaves between shrunk zones (the
     * ChME3's cab door opens 0.2 wider than the aisle behind it — play-test).
     */
    private static final double SIDESTEP = 0.3;

    /**
     * The hull door a rider walks out through on this step, or −1 (SPEC v1.5,
     * doors, IR-style): the step would carry their feet past the wall of the
     * zone they stand in, on the side of an open hull door (or fixed opening)
     * in that wall, at a point along the wall inside the door's span. A closed
     * door is just wall — {@link #step} keeps the rider against it. Doors
     * between zones never lead out.
     *
     * @param doors    the type's doors <b>in the pose frame</b> (already
     *                 mirrored for a flipped wagon)
     * @param openMask bit {@code i} set = door {@code i} open
     */
    public static int exitDoor(Vector3d local, double forward, double strafe,
            float playerYaw, float wagonYaw, WagonType.Interior interior,
            List<WagonType.Door> doors, int openMask) {
        Vector3d next = unclamped(local, forward, strafe, playerYaw, wagonYaw);
        for (int i = 0; i < doors.size() && i < 32; i++) {
            WagonType.Door door = doors.get(i);
            if (door.inner() || !door.open(openMask, i)) {
                continue;
            }
            int out = door.outward();
            boolean sideDoor = door.axis() == 0;
            double across = sideDoor ? next.x : next.z;  // where the step goes, along the wall normal
            double along = sideDoor ? next.z : next.x;   // where it is, along the wall
            if (along < door.spanMin() + DOOR_SPAN_INSET || along > door.spanMax() - DOOR_SPAN_INSET) {
                continue;
            }
            for (WagonType.Interior.Zone zone : interior.zones()) {
                if (!zone.holds(local.x, local.z, PLAYER_HALF_WIDTH)) {
                    continue;
                }
                double face = sideDoor ? (out > 0 ? zone.maxX() : zone.minX())
                        : (out > 0 ? zone.maxZ() : zone.minZ());
                double gap = out * (door.innerFace() - face);
                if (gap < -DOOR_WALL_SLACK || gap > DOOR_WALL_SLACK) {
                    continue; // the door isn't in this zone's wall
                }
                double wall = face - out * PLAYER_HALF_WIDTH;
                if (out * across > out * wall) {
                    return i;
                }
            }
        }
        return -1;
    }

    /** Gap left between a rider arriving through a gangway door and its inner face. */
    static final double GANGWAY_CLEARANCE = 0.05;

    /**
     * Where a rider coming through a gangway lands in the next car (SPEC
     * §9.5): its connecting door in the end wall facing them — the one
     * nearest their place across the car — and a spot just inside it, at
     * that place (within the door), on the nearest floor.
     *
     * @param doors    the next car's doors <b>in its pose frame</b>
     * @param interior the next car's floor in its pose frame
     * @param travel   the way the rider walks along the train: +1 forward
     *                 (in through the next car's rear end wall), -1 back
     * @param across   the rider's local X in the car they leave (pose frames
     *                 of coupled cars point the same way, so X carries over)
     * @return the door and the feet, or null if no connecting door faces them
     */
    public static Arrival gangwayArrival(List<WagonType.Door> doors, WagonType.Interior interior,
            int travel, double across) {
        int best = -1;
        double bestOff = Double.MAX_VALUE;
        for (int i = 0; i < doors.size() && i < 32; i++) {
            WagonType.Door door = doors.get(i);
            if (door.connecting() && door.axis() == 2 && door.outward() == -travel) {
                double off = Math.abs(along(across, door) - across);
                if (off < bestOff) {
                    best = i;
                    bestOff = off;
                }
            }
        }
        if (best < 0) {
            return null;
        }
        WagonType.Door door = doors.get(best);
        Vector3d inside = new Vector3d(along(across, door), 0.0,
                door.innerFace() + travel * (PLAYER_HALF_WIDTH + GANGWAY_CLEARANCE));
        return new Arrival(best, interior.clampFeet(inside, PLAYER_HALF_WIDTH));
    }

    /** A gangway arrival: the door walked in through and the rider's new local feet. */
    public record Arrival(int door, Vector3d feet) {
    }

    /** A body-width point along a door's span: clamped inside it, or its middle if too narrow. */
    public static double along(double value, WagonType.Door door) {
        double lo = door.spanMin() + PLAYER_HALF_WIDTH;
        double hi = door.spanMax() - PLAYER_HALF_WIDTH;
        return lo > hi ? (door.spanMin() + door.spanMax()) * 0.5 : Math.clamp(value, lo, hi);
    }

    /** True if a rider centred at (x, z) stands on the floor: in a zone or an open door's bridge. */
    static boolean onFloor(double x, double z, WagonType.Interior interior,
            List<WagonType.Door> doors, int openMask) {
        for (WagonType.Interior.Zone zone : interior.zones()) {
            if (zone.holds(x, z, PLAYER_HALF_WIDTH)) {
                return true;
            }
        }
        for (int i = 0; i < doors.size(); i++) {
            WagonType.Door door = doors.get(i);
            if (door.inner() && door.open(openMask, i) && inBridge(x, z, door)) {
                return true;
            }
        }
        return false;
    }

    /** The passage through an open door between zones: its span (inset) × the wall ± the reach. */
    private static boolean inBridge(double x, double z, WagonType.Door door) {
        boolean sideDoor = door.axis() == 0;
        double across = sideDoor ? x : z;
        double along = sideDoor ? z : x;
        double lo = sideDoor ? door.minX() : door.minZ();
        double hi = sideDoor ? door.maxX() : door.maxZ();
        return along >= door.spanMin() + DOOR_SPAN_INSET - 1.0e-9
                && along <= door.spanMax() - DOOR_SPAN_INSET + 1.0e-9
                && across >= lo - BRIDGE_REACH - 1.0e-9 && across <= hi + BRIDGE_REACH + 1.0e-9;
    }

    private static Vector3d clampToBridge(double x, double z, WagonType.Door door) {
        boolean sideDoor = door.axis() == 0;
        double along = Math.clamp(sideDoor ? z : x,
                door.spanMin() + DOOR_SPAN_INSET, door.spanMax() - DOOR_SPAN_INSET);
        double lo = (sideDoor ? door.minX() : door.minZ()) - BRIDGE_REACH;
        double hi = (sideDoor ? door.maxX() : door.maxZ()) + BRIDGE_REACH;
        double across = Math.clamp(sideDoor ? x : z, lo, hi);
        return sideDoor ? new Vector3d(across, 0.0, along) : new Vector3d(along, 0.0, across);
    }

    /** {@code p} with its feet on the floor under it (kept as is in a door bridge). */
    private static Vector3d withFloor(Vector3d p, double currentY, WagonType.Interior interior) {
        double floor = interior.floorAt(p.x, p.z, PLAYER_HALF_WIDTH);
        return new Vector3d(p.x, Double.isNaN(floor) ? currentY : floor, p.z);
    }

    /** One walk step in the local floor plane, before the walls clamp it. */
    private static Vector3d unclamped(Vector3d local, double forward, double strafe,
            float playerYaw, float wagonYaw) {
        Vector3d next = new Vector3d(local);
        double yr = Math.toRadians(playerYaw);
        double sin = Math.sin(yr);
        double cos = Math.cos(yr);
        // world horizontal move, matching vanilla moveRelative(strafe, forward)
        double wx = strafe * cos - forward * sin;
        double wz = forward * cos + strafe * sin;
        double len = Math.hypot(wx, wz);
        if (len > 1.0e-4) {
            // cap magnitude at the walk speed (no faster diagonals)
            double k = (Math.min(len, 1.0) * WALK_SPEED) / len;
            // world move → local horizontal: inverse of the body's yaw rotation
            // (bodyRotation uses Y(-yaw); ignore pitch so the floor stays flat)
            Vector3d localMove = new Quaterniond()
                    .rotateY(Math.toRadians(wagonYaw))
                    .transform(new Vector3d(wx * k, 0.0, wz * k));
            next.x += localMove.x;
            next.z += localMove.z;
        }
        return next;
    }
}
