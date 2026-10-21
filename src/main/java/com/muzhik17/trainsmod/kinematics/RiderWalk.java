package com.muzhik17.trainsmod.kinematics;

import java.util.List;

import org.joml.Quaterniond;
import org.joml.Vector3d;

import com.muzhik17.trainsmod.stock.FloorRegion;
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
 * kept on the walkable floor — wherever the body fits in the union of the
 * {@link WagonType.Interior} zones (SPEC §9.8, {@link FloorRegion}), plus a
 * bridge through every open door between zones (SPEC §9.1); a shut one stands
 * across the floor even where the zones on its two sides touch, and no step
 * passes through it ({@link FloorRegion.Cut#shut}). A step that would
 * leave the floor slides along the wall. Vertical movement (stairs, jumping
 * between decks) is out of v0: the feet take the floor height under them.
 *
 * <p>A <b>crouched</b> rider (Shift held) creeps at {@link #SNEAK_FACTOR} of
 * the walk and keeps to the floor like vanilla's sneak at a block edge: an
 * open hull door or opening doesn't let them out ({@link #exitDoor}), so
 * nobody steps off a moving train by accident; gangways into the next car
 * still pass — that is walking the train, not leaving it (SPEC §9.5).
 */
public final class RiderWalk {

    /** Interior walking speed, blocks/tick (a stroll, slower than open-field running). */
    public static final double WALK_SPEED = 0.12;
    /** Crouched walk as a share of {@link #WALK_SPEED} (vanilla's {@code sneaking_speed} default). */
    public static final double SNEAK_FACTOR = 0.3;
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
    /**
     * How far a hull door's inner face may sit from where the floor ends in
     * front of it and still be the way out there (MVP: −0.09 … 0.35 —
     * the wall's thickness, or a floor running a little into the doorway).
     */
    static final double DOOR_WALL_SLACK = 0.4;

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

    /** A step at the full walking pace (not crouched). */
    public static Vector3d step(Vector3d local, double forward, double strafe,
            float playerYaw, float wagonYaw, WagonType.Interior interior,
            List<WagonType.Door> doors, int openMask) {
        return step(local, forward, strafe, playerYaw, wagonYaw, interior, doors, openMask, false);
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
     * @param sneak     crouched: the step is {@link #SNEAK_FACTOR} of the walk
     * @return the new local feet position (on the floor)
     */
    public static Vector3d step(Vector3d local, double forward, double strafe,
            float playerYaw, float wagonYaw, WagonType.Interior interior,
            List<WagonType.Door> doors, int openMask, boolean sneak) {
        Vector3d next = unclamped(local, forward, strafe, playerYaw, wagonYaw, speed(sneak));
        FloorRegion region = interior.region(PLAYER_HALF_WIDTH, doors, openMask);
        if (!onFloor(local.x, local.z, region, doors, openMask)) {
            // lost the floor (a door shut on them in its doorway): nearest point
            return interior.clampFeet(next, PLAYER_HALF_WIDTH, doors, openMask);
        }
        if (onFloor(next.x, next.z, region, doors, openMask)
                && !region.throughCut(local.x, local.z, next.x, next.z)) {
            return withFloor(next, local.y, interior);
        }
        // slide: the step pulled back onto each box of the floor near the
        // rider — along the wall they push against, or easing into floor just
        // beside them (out of a doorway that isn't in line with the floor
        // beyond it), only within SIDESTEP, which can't cross a wall: where a
        // body fits, any wall leaves ≥ 2 half-widths of no room. A shut door
        // between zones leaves only its thickness: no candidate through it.
        // Keep the candidate that makes the most headway along the step — but
        // never (beyond AHEAD_SLACK) past the step's end: floor just ahead (an
        // opening off the platzkart's aisle into a bay) would otherwise pull
        // the rider up to SIDESTEP forward in one tick, and the aisle walk went
        // in jerks (play-test).
        double mx = next.x - local.x;
        double mz = next.z - local.z;
        double maxGain = mx * mx + mz * mz + AHEAD_SLACK * Math.hypot(mx, mz);
        Vector3d best = new Vector3d(local);
        double bestGain = 1.0e-9;
        List<FloorRegion.Piece> pieces = region.pieces();
        for (int i = region.firstPieceReaching(local.z - SIDESTEP); i < pieces.size(); i++) {
            FloorRegion.Piece piece = pieces.get(i);
            if (piece.minZ() > local.z + SIDESTEP) {
                break;
            }
            double[] c = piece.clamp(next.x, next.z);
            if (Math.hypot(c[0] - local.x, c[1] - local.z) <= SIDESTEP
                    && !region.throughCut(local.x, local.z, c[0], c[1])) {
                double gain = (c[0] - local.x) * mx + (c[1] - local.z) * mz;
                if (gain > bestGain && gain <= maxGain) {
                    best = new Vector3d(c[0], local.y, c[1]);
                    bestGain = gain;
                }
            }
        }
        for (int i = 0; i < doors.size(); i++) {
            WagonType.Door door = doors.get(i);
            if (door.inner() && door.open(openMask, i) && inBridge(local.x, local.z, door)) {
                Vector3d c = clampToBridge(next.x, next.z, door);
                double gain = (c.x - local.x) * mx + (c.z - local.z) * mz;
                if (gain > bestGain && !region.throughCut(local.x, local.z, c.x, c.z)) {
                    best = c;
                    bestGain = gain;
                }
            }
        }
        return withFloor(best, local.y, interior);
    }

    /**
     * Walk straight at a floor-plane point as far as the floor lets the body
     * go (SPEC §9: a driver standing up from a chair, from where they sat down
     * towards it): {@link #step}s at the walk speed, sliding along walls, so it
     * ends beside the point when the point itself isn't floor — never through
     * a wall onto floor beyond it, as the nearest floor point could be.
     * Pure, so the client predicts the same spot the server sets.
     *
     * @param from     where the walk starts (local feet, pose frame)
     * @param interior the walkable floor <b>in the pose frame</b>
     * @param doors    the type's doors <b>in the pose frame</b>
     * @param openMask bit {@code i} set = door {@code i} open
     */
    public static Vector3d toward(Vector3d from, double x, double z, WagonType.Interior interior,
            List<WagonType.Door> doors, int openMask) {
        Vector3d at = new Vector3d(from);
        for (int i = 0; i < TOWARD_STEPS; i++) {
            double dx = x - at.x;
            double dz = z - at.z;
            double left = Math.hypot(dx, dz);
            if (left < 1.0e-3) {
                break;
            }
            // wagon yaw 0: the look yaw is the local direction (0 = +Z, +90 = −X)
            float yaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
            Vector3d next = step(at, Math.min(1.0, left / WALK_SPEED), 0.0, yaw, 0.0F, interior, doors, openMask);
            if (next.distanceSquared(at) < 1.0e-8) {
                break; // against the wall
            }
            at = next;
        }
        return at;
    }

    /** How far a walking rider may stand from a driver's chair and still sit down in it (feet to chair, horizontally). */
    public static final double SEAT_REACH = 2.5;
    /** Steps {@link #toward} takes at most: past {@link #SEAT_REACH} at the walk speed, with room to slide. */
    private static final int TOWARD_STEPS = 64;

    /**
     * The furthest a blocked step may ease sideways onto floor beside it:
     * under the 0.6 of no room any wall leaves where a body fits (the
     * ChME3's cab door opens 0.2 wider than the aisle behind it — play-test).
     */
    private static final double SIDESTEP = 0.3;
    /**
     * How far past the step's end (along it) a slide may still land: a
     * sideways ease off a slightly askew step lands a hair ahead of it (the
     * platzkart's vestibule onto its slanted aisle, 1 mm — without this
     * slack the rider stuck there), a bay's opening ahead lands a block-fifth.
     */
    private static final double AHEAD_SLACK = 0.01;

    /**
     * The hull door a rider walks out through on this step, or −1 (SPEC v1.5,
     * doors, IR-style): the step would carry them past where the floor ends
     * straight ahead of them, towards an open hull door (or fixed opening)
     * whose inner face is right there (within {@link #DOOR_WALL_SLACK}), at a
     * point along the wall inside the door's span. A closed door is just wall
     * — {@link #step} keeps the rider against it. Doors between zones never
     * lead out.
     *
     * @param doors    the type's doors <b>in the pose frame</b> (already
     *                 mirrored for a flipped wagon)
     * @param openMask bit {@code i} set = door {@code i} open
     */
    public static int exitDoor(Vector3d local, double forward, double strafe,
            float playerYaw, float wagonYaw, WagonType.Interior interior,
            List<WagonType.Door> doors, int openMask) {
        return exitDoor(local, forward, strafe, playerYaw, wagonYaw, interior, doors, openMask, false);
    }

    /**
     * {@link #exitDoor(Vector3d, double, double, float, float, WagonType.Interior, List, int)}
     * for a rider who may be crouched: crouched ({@code sneak}), only a
     * gangway door leads on — a hull door or opening is the floor's edge,
     * as a block edge is to vanilla's sneak (the step keeps them at it).
     */
    public static int exitDoor(Vector3d local, double forward, double strafe,
            float playerYaw, float wagonYaw, WagonType.Interior interior,
            List<WagonType.Door> doors, int openMask, boolean sneak) {
        Vector3d next = unclamped(local, forward, strafe, playerYaw, wagonYaw, speed(sneak));
        FloorRegion region = interior.region(PLAYER_HALF_WIDTH, doors, openMask);
        for (int i = 0; i < doors.size() && i < 32; i++) {
            WagonType.Door door = doors.get(i);
            if (door.inner() || !door.open(openMask, i) || (sneak && !keepsAboard(door))) {
                continue;
            }
            int out = door.outward();
            boolean sideDoor = door.axis() == 0;
            double across = sideDoor ? next.x : next.z;  // where the step goes, along the wall normal
            double along = sideDoor ? next.z : next.x;   // where it is, along the wall
            if (along < door.spanMin() + DOOR_SPAN_INSET || along > door.spanMax() - DOOR_SPAN_INSET) {
                continue;
            }
            // as far as they can walk straight at the door: NaN off the floor (in a door bridge)
            double wall = region.reach(local.x, local.z, door.axis(), out);
            if (Double.isNaN(wall) || !facesDoor(wall, door)) {
                continue; // the floor doesn't end at this door here
            }
            if (out * across > out * wall) {
                return i;
            }
        }
        return -1;
    }

    /**
     * True if walking out through this door keeps the rider on the train —
     * a gangway door into the next car (SPEC §9.5) — rather than putting
     * them on the ground; a crouched rider passes only these.
     */
    public static boolean keepsAboard(WagonType.Door door) {
        return door.connecting();
    }

    /**
     * True if a floor whose centres reach {@code wall} (along the door's
     * axis, towards it) ends at the door: a body there touches its inner face
     * within {@link #DOOR_WALL_SLACK}.
     */
    public static boolean facesDoor(double wall, WagonType.Door door) {
        int out = door.outward();
        double gap = out * (door.innerFace() - (wall + out * PLAYER_HALF_WIDTH));
        return gap >= -DOOR_WALL_SLACK && gap <= DOOR_WALL_SLACK;
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
        return gangwayArrival(doors, interior, travel, across, ~0);
    }

    /**
     * {@link #gangwayArrival(List, WagonType.Interior, int, double)} through
     * the next car's door only if it is open (bit {@code i} of {@code
     * openMask}): a shut door of the next car is wall — the rider opens it
     * themselves, through their own open door (play-test 2026-10-10: walking
     * through it shut and seeing it swing open behind you was wrong).
     */
    public static Arrival gangwayArrival(List<WagonType.Door> doors, WagonType.Interior interior,
            int travel, double across, int openMask) {
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
        if (best < 0 || !doors.get(best).open(openMask, best)) {
            return null;
        }
        WagonType.Door door = doors.get(best);
        Vector3d inside = new Vector3d(along(across, door), 0.0,
                door.innerFace() + travel * (PLAYER_HALF_WIDTH + GANGWAY_CLEARANCE));
        return new Arrival(best, interior.clampFeet(inside, PLAYER_HALF_WIDTH, doors, openMask));
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

    /**
     * True if a rider centred at (x, z) stands on the floor: fits on it (the
     * {@code region} with the shut doors cut out), or in an open door's bridge.
     */
    static boolean onFloor(double x, double z, FloorRegion region,
            List<WagonType.Door> doors, int openMask) {
        if (region.fits(x, z)) {
            return true;
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

    /** The pace of a step, blocks/tick: the walk, or the creep while crouched. */
    public static double speed(boolean sneak) {
        return sneak ? WALK_SPEED * SNEAK_FACTOR : WALK_SPEED;
    }

    /** One walk step in the local floor plane at {@code speed}, before the walls clamp it. */
    private static Vector3d unclamped(Vector3d local, double forward, double strafe,
            float playerYaw, float wagonYaw, double speed) {
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
            double k = (Math.min(len, 1.0) * speed) / len;
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
