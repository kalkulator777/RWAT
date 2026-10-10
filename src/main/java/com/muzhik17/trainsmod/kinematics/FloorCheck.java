package com.muzhik17.trainsmod.kinematics;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import com.muzhik17.trainsmod.stock.FloorRegion;
import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Checks a type's walkable floor, doors and driver's chair the way {@link
 * RiderWalk} will use them (SPEC §9.6, §9.8) — the mistakes a pack author
 * makes measuring by hand: a zone no player fits in, parts of the floor
 * nobody can walk between, a door the floor doesn't end at (so it can't be
 * walked through), a gangway door that isn't in an end wall, a cab floor
 * without a driver's chair, a chair not over the floor. Pure; the type
 * registry logs what it finds on load, and a unit test runs it over every
 * type of the generated packs.
 */
public final class FloorCheck {

    private static final double M = RiderWalk.PLAYER_HALF_WIDTH;
    /** Thicker than this, a door box is more than its leaf (handles, frame — fine) or wrong. */
    private static final double MAX_DOOR_THICKNESS = 0.6;
    /** The cushion top above the floor a sitting player fits: the seated feet hang SIT_DROP below it. */
    private static final double MIN_SEAT_HEIGHT = 0.2;
    private static final double MAX_SEAT_HEIGHT = 1.5;
    /** Step along a door's span when looking for a place to walk out through it. */
    private static final double SPAN_STEP = 0.05;

    private FloorCheck() {
    }

    /** What's wrong with this type's floor, one line each; empty if nothing. */
    public static List<String> problems(WagonType type) {
        List<String> out = new ArrayList<>();
        WagonType.Interior interior = type.interior();
        WagonType.Seat seat = type.cab() != null ? type.cab().seat() : null;
        if (interior == null) {
            if (seat != null) {
                out.add("cab.seat without an interior: the chair needs a floor to walk to it");
            }
            return out;
        }
        List<WagonType.Interior.Zone> zones = interior.zones();
        FloorRegion region = interior.region(M);
        List<FloorRegion.Piece> pieces = region.pieces();
        if (pieces.isEmpty()) {
            out.add(String.format(Locale.ROOT,
                    "a player fits nowhere on the floor: every part of it is narrower than %.1f", 2 * M));
        }
        // each zone's parts of the region: where a centre can stand inside it
        List<List<Integer>> inZone = new ArrayList<>();
        for (int i = 0; i < zones.size(); i++) {
            WagonType.Interior.Zone z = zones.get(i);
            List<Integer> mine = new ArrayList<>();
            for (int p = 0; p < pieces.size(); p++) {
                if (pieces.get(p).touches(z.minX(), z.minZ(), z.maxX(), z.maxZ())) {
                    mine.add(p);
                }
            }
            inZone.add(mine);
            if (mine.isEmpty() && !pieces.isEmpty()) {
                out.add(String.format(Locale.ROOT, "zone %d holds no place a player fits (%.2f x %.2f):"
                        + " widen it to %.1f or join it to a wider zone",
                        i, z.maxX() - z.minX(), z.maxZ() - z.minZ(), 2 * M));
            }
        }
        int[] parent = new int[pieces.size()];
        for (int i = 0; i < parent.length; i++) {
            parent[i] = i;
        }
        for (int[] link : region.links()) {
            union(parent, link[0], link[1]);
        }
        List<WagonType.Door> doors = type.doors();
        for (int d = 0; d < doors.size(); d++) {
            WagonType.Door door = doors.get(d);
            String name = "door " + d + " '" + door.id() + "'";
            double thick = door.axis() == 0 ? door.maxX() - door.minX() : door.maxZ() - door.minZ();
            if (thick > MAX_DOOR_THICKNESS) {
                out.add(String.format(Locale.ROOT, "%s is %.2f thick: is the box the door leaf?", name, thick));
            }
            if (door.spanMax() - door.spanMin() - 2 * RiderWalk.DOOR_SPAN_INSET <= 0.0) {
                out.add(name + " is too narrow to walk through");
            }
            if (door.connecting() && door.axis() != 2) {
                out.add(name + " is a gangway (connecting) door but not in an end wall");
            }
            if (door.inner()) {
                double[] b = bridge(door);
                int first = -1;
                for (int p = 0; p < pieces.size(); p++) {
                    if (pieces.get(p).touches(b[0], b[1], b[2], b[3])) {
                        if (first < 0) {
                            first = p;
                        } else {
                            union(parent, first, p);
                        }
                    }
                }
                if (first < 0) {
                    out.add(name + " (inner) touches no floor");
                }
            } else if (!walkableThrough(door, region)) {
                out.add(name + " isn't where the floor ends: nobody can walk through it"
                        + " (a player must fit in front of it, inside its span, with the floor ending"
                        + " within " + RiderWalk.DOOR_WALL_SLACK + " of its inner face)");
            }
        }
        if (!inZone.isEmpty() && !inZone.get(0).isEmpty()) {
            int home = find(parent, inZone.get(0).get(0));
            List<Integer> cut = new ArrayList<>();
            for (int i = 1; i < zones.size(); i++) {
                boolean reached = false;
                for (int p : inZone.get(i)) {
                    reached |= find(parent, p) == home;
                }
                if (!inZone.get(i).isEmpty() && !reached) {
                    cut.add(i);
                }
            }
            if (!cut.isEmpty()) {
                out.add("floor zones " + cut + " can't be walked to from zone 0: join them (zones that"
                        + " touch join) or put an inner door between them");
            }
        }
        if (type.cab() != null && seat == null) {
            out.add("a walkable cab needs the driver's chair (cab.seat): in a cab with a floor the keys"
                    + " drive only from the chair");
        }
        if (seat != null) {
            boolean over = false;
            for (WagonType.Interior.Zone z : zones) {
                double height = seat.y() - z.minY();
                if (z.holds(seat.x(), seat.z(), 0.0) && height >= MIN_SEAT_HEIGHT && height <= MAX_SEAT_HEIGHT) {
                    over = true;
                }
            }
            if (!over) {
                out.add(String.format(Locale.ROOT, "cab.seat (%.2f, %.2f, %.2f) isn't over a floor zone, %.1f..%.1f"
                        + " above it (the seat is the top of the cushion)",
                        seat.x(), seat.y(), seat.z(), MIN_SEAT_HEIGHT, MAX_SEAT_HEIGHT));
            }
        }
        return out;
    }

    /**
     * True if a rider can walk out through a hull or gangway door (as {@link
     * RiderWalk#exitDoor} reads it): somewhere inside its span (inset) a
     * player fits, and walking straight at the door from there the floor
     * ends at its inner face.
     */
    static boolean walkableThrough(WagonType.Door door, FloorRegion region) {
        boolean side = door.axis() == 0;
        int out = door.outward();
        double lo = door.spanMin() + RiderWalk.DOOR_SPAN_INSET;
        double hi = door.spanMax() - RiderWalk.DOOR_SPAN_INSET;
        for (FloorRegion.Piece p : region.pieces()) {
            double pLo = Math.max(lo, side ? p.minZ() : p.minX());
            double pHi = Math.min(hi, side ? p.maxZ() : p.maxX());
            if (pHi < pLo) {
                continue;
            }
            double across = side ? (out > 0 ? p.maxX() : p.minX()) : (out > 0 ? p.maxZ() : p.minZ());
            for (double along = pLo; ; along = Math.min(pHi, along + SPAN_STEP)) {
                double wall = side ? region.reach(across, along, 0, out) : region.reach(along, across, 2, out);
                if (!Double.isNaN(wall) && RiderWalk.facesDoor(wall, door)) {
                    return true;
                }
                if (along >= pHi) {
                    break;
                }
            }
        }
        return false;
    }

    /** Where a rider's centre may be in an open inner door, as {@link RiderWalk} bridges it: {minX, minZ, maxX, maxZ}. */
    private static double[] bridge(WagonType.Door door) {
        double lo = door.spanMin() + RiderWalk.DOOR_SPAN_INSET;
        double hi = door.spanMax() - RiderWalk.DOOR_SPAN_INSET;
        return door.axis() == 0
                ? new double[]{door.minX() - RiderWalk.BRIDGE_REACH, lo, door.maxX() + RiderWalk.BRIDGE_REACH, hi}
                : new double[]{lo, door.minZ() - RiderWalk.BRIDGE_REACH, hi, door.maxZ() + RiderWalk.BRIDGE_REACH};
    }

    private static int find(int[] parent, int i) {
        while (parent[i] != i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    }

    private static void union(int[] parent, int a, int b) {
        parent[find(parent, a)] = find(parent, b);
    }
}
