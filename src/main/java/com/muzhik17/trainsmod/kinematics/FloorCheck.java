package com.muzhik17.trainsmod.kinematics;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Checks a type's walkable floor, doors and driver's chair the way {@link
 * RiderWalk} will use them (SPEC §9.6) — the mistakes a pack author makes
 * measuring by hand: a zone narrower than a player, floor zones nobody can
 * walk between, a door that isn't in any zone's wall (so it can't be walked
 * through), a gangway door that isn't in an end wall, a cab floor without a
 * driver's chair, a chair not over the floor. Pure; the type registry logs what it finds on load, and a unit test
 * runs it over every type of the generated packs.
 */
public final class FloorCheck {

    private static final double M = RiderWalk.PLAYER_HALF_WIDTH;
    /** Thicker than this, a door box is more than its leaf (handles, frame — fine) or wrong. */
    private static final double MAX_DOOR_THICKNESS = 0.6;
    /** The cushion top above the floor a sitting player fits: the seated feet hang SIT_DROP below it. */
    private static final double MIN_SEAT_HEIGHT = 0.2;
    private static final double MAX_SEAT_HEIGHT = 1.5;

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
        for (int i = 0; i < zones.size(); i++) {
            WagonType.Interior.Zone z = zones.get(i);
            if (z.maxX() - z.minX() < 2 * M || z.maxZ() - z.minZ() < 2 * M) {
                out.add(String.format(Locale.ROOT, "zone %d is narrower than a player (%.2f x %.2f, needs %.1f)",
                        i, z.maxX() - z.minX(), z.maxZ() - z.minZ(), 2 * M));
            }
        }
        List<WagonType.Door> doors = type.doors();
        int[] parent = new int[zones.size()];
        for (int i = 0; i < parent.length; i++) {
            parent[i] = i;
        }
        for (int i = 0; i < zones.size(); i++) {
            for (int j = i + 1; j < zones.size(); j++) {
                if (touch(shrunk(zones.get(i)), shrunk(zones.get(j)))) {
                    union(parent, i, j);
                }
            }
        }
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
                int first = -1;
                for (int i = 0; i < zones.size(); i++) {
                    if (touch(bridge(door), shrunk(zones.get(i)))) {
                        if (first < 0) {
                            first = i;
                        } else {
                            union(parent, first, i);
                        }
                    }
                }
                if (first < 0) {
                    out.add(name + " (inner) touches no floor zone");
                }
            } else if (wallOf(door, zones) < 0) {
                out.add(name + " isn't in the wall of any floor zone: nobody can walk through it"
                        + " (a zone's side must lie within " + RiderWalk.DOOR_WALL_SLACK
                        + " of the door's inner face, along its span)");
            }
        }
        List<Integer> cut = new ArrayList<>();
        for (int i = 1; i < zones.size(); i++) {
            if (find(parent, i) != find(parent, 0)) {
                cut.add(i);
            }
        }
        if (!cut.isEmpty()) {
            out.add("floor zones " + cut + " can't be walked to from zone 0: overlap them (by "
                    + 2 * M + " or more) or join them with an inner door");
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

    /** The zone whose wall a hull or gangway door sits in (as {@link RiderWalk#exitDoor} reads it), or −1. */
    static int wallOf(WagonType.Door door, List<WagonType.Interior.Zone> zones) {
        int out = door.outward();
        boolean side = door.axis() == 0;
        for (int i = 0; i < zones.size(); i++) {
            WagonType.Interior.Zone zone = zones.get(i);
            double face = side ? (out > 0 ? zone.maxX() : zone.minX()) : (out > 0 ? zone.maxZ() : zone.minZ());
            double gap = out * (door.innerFace() - face);
            double lo = (side ? zone.minZ() : zone.minX()) + M;
            double hi = (side ? zone.maxZ() : zone.maxX()) - M;
            if (Math.abs(gap) <= RiderWalk.DOOR_WALL_SLACK
                    && Math.min(hi, door.spanMax() - RiderWalk.DOOR_SPAN_INSET)
                            >= Math.max(lo, door.spanMin() + RiderWalk.DOOR_SPAN_INSET)) {
                return i;
            }
        }
        return -1;
    }

    /** Where a rider's centre may be in a zone: {minX, minZ, maxX, maxZ}. */
    private static double[] shrunk(WagonType.Interior.Zone z) {
        return new double[]{z.minX() + M, z.minZ() + M, z.maxX() - M, z.maxZ() - M};
    }

    /** Where a rider's centre may be in an open inner door, as {@link RiderWalk} bridges it. */
    private static double[] bridge(WagonType.Door door) {
        double lo = door.spanMin() + RiderWalk.DOOR_SPAN_INSET;
        double hi = door.spanMax() - RiderWalk.DOOR_SPAN_INSET;
        return door.axis() == 0
                ? new double[]{door.minX() - RiderWalk.BRIDGE_REACH, lo, door.maxX() + RiderWalk.BRIDGE_REACH, hi}
                : new double[]{lo, door.minZ() - RiderWalk.BRIDGE_REACH, hi, door.maxZ() + RiderWalk.BRIDGE_REACH};
    }

    private static boolean touch(double[] a, double[] b) {
        return Math.min(a[2], b[2]) >= Math.max(a[0], b[0]) - 1.0e-9
                && Math.min(a[3], b[3]) >= Math.max(a[1], b[1]) - 1.0e-9;
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
