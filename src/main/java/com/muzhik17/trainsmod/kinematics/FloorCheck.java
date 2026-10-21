package com.muzhik17.trainsmod.kinematics;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import com.muzhik17.trainsmod.stock.FloorRegion;
import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Checks a type's walkable floor, doors and driver's chair the way {@link
 * RiderWalk} will use them (SPEC §9.6, §9.8) — the mistakes a pack author
 * makes measuring by hand: a zone no player fits in, a part of the floor
 * nobody can walk to (from the first zone or a way in of its own — the
 * other end's cab of a double-ended locomotive has its own steps), a door the floor doesn't end at (so it can't be
 * walked through), a door between zones the floor runs through (zones that
 * touch or overlap in its doorway: shut, the engine still cuts the floor
 * there, but a body stands half in the leaf) or round (its two sides are one
 * floor without it: shut, it is no wall), a gangway door that isn't in an
 * end wall, a cab floor
 * without a driver's chair, a chair nobody can stand near enough to sit in
 * (or at the wrong height for the floor there). The parts of the floor are
 * those with every door between zones shut ({@link
 * WagonType.Interior#region(double, List, int)}), joined where one opens.
 * Pure; the type
 * registry logs what it finds on load, and a unit test runs it over every
 * type of the generated packs.
 */
public final class FloorCheck {

    private static final double M = RiderWalk.PLAYER_HALF_WIDTH;
    /** Thicker than this, a door box is more than its leaf (handles, frame — fine) or wrong. */
    private static final double MAX_DOOR_THICKNESS = 0.6;
    /** The cushion top above the floor by it a sitting player fits: the seated feet hang SIT_DROP below it. */
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
        List<WagonType.Seat> seats = type.cab() != null ? type.cab().seats() : List.of();
        if (interior == null) {
            if (!seats.isEmpty()) {
                out.add("cab.seats without an interior: a chair needs a floor to walk to it");
            }
            return out;
        }
        List<WagonType.Interior.Zone> zones = interior.zones();
        List<WagonType.Door> doors = type.doors();
        FloorRegion region = interior.region(M);
        List<FloorRegion.Piece> pieces = region.pieces();
        if (pieces.isEmpty()) {
            out.add(String.format(Locale.ROOT,
                    "a player fits nowhere on the floor: every part of it is narrower than %.1f", 2 * M));
        }
        // the floor with every door between zones shut: its pieces are the parts walked
        FloorRegion shut = interior.region(M, doors, 0);
        List<FloorRegion.Piece> parts = shut.pieces();
        // each zone's parts of the region: where a centre can stand inside it
        List<List<Integer>> inZone = new ArrayList<>();
        for (int i = 0; i < zones.size(); i++) {
            WagonType.Interior.Zone z = zones.get(i);
            List<Integer> mine = new ArrayList<>();
            for (int p = 0; p < parts.size(); p++) {
                if (parts.get(p).touches(z.minX(), z.minZ(), z.maxX(), z.maxZ())) {
                    mine.add(p);
                }
            }
            inZone.add(mine);
            boolean fits = false;
            for (FloorRegion.Piece piece : pieces) {
                fits |= piece.touches(z.minX(), z.minZ(), z.maxX(), z.maxZ());
            }
            if (!fits && !pieces.isEmpty()) {
                out.add(String.format(Locale.ROOT, "zone %d holds no place a player fits (%.2f x %.2f):"
                        + " widen it to %.1f or join it to a wider zone",
                        i, z.maxX() - z.minX(), z.maxZ() - z.minZ(), 2 * M));
            }
        }
        // joined: by the floor alone (every door between zones shut), then by open doors too
        int[] alone = new int[parts.size()];
        for (int i = 0; i < alone.length; i++) {
            alone[i] = i;
        }
        for (int[] link : shut.links()) {
            union(alone, link[0], link[1]);
        }
        int[] parent = alone.clone();
        List<Integer> waysIn = new ArrayList<>(); // the floor pieces outside and gangway doors open onto
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
                FloorRegion.Cut cut = FloorRegion.Cut.shut(door, M);
                int first = -1;
                List<Integer> before = new ArrayList<>(); // the parts its bridge reaches on each side
                List<Integer> behind = new ArrayList<>();
                for (int p = 0; p < parts.size(); p++) {
                    FloorRegion.Piece part = parts.get(p);
                    if (part.touches(b[0], b[1], b[2], b[3])) {
                        if (first < 0) {
                            first = p;
                        } else {
                            union(parent, first, p);
                        }
                        // no part reaches into the cut: each ends at or begins past it
                        double end = door.axis() == 0 ? part.maxX() : part.maxZ();
                        if (end <= (door.axis() == 0 ? cut.minX() : cut.minZ()) + 1.0e-6) {
                            before.add(p);
                        } else {
                            behind.add(p);
                        }
                    }
                }
                if (first < 0) {
                    out.add(name + " (inner) touches no floor");
                }
                if (door.fixed()) {
                    continue; // never shut
                }
                boolean through = false;
                for (FloorRegion.Piece piece : pieces) {
                    through |= cut.bites(piece);
                }
                if (through) {
                    out.add(name + " (inner): the floor runs through its doorway — the zones on its two sides"
                            + " touch or overlap in it, and a player stands half in the shut leaf: part them"
                            + " (any gap is wall; open, the door bridges it)");
                }
                boolean round = false;
                for (int p : before) {
                    for (int q : behind) {
                        round |= find(alone, p) == find(alone, q);
                    }
                }
                if (round) {
                    out.add(name + " (inner): its two sides are one floor without it — the floor runs round"
                            + " it or through the wall beside it, so shut it is no wall");
                }
            } else {
                List<Integer> from = walkablePieces(door, shut);
                if (from.isEmpty()) {
                    out.add(name + " isn't where the floor ends: nobody can walk through it"
                            + " (a player must fit in front of it, inside its span, with the floor ending"
                            + " within " + RiderWalk.DOOR_WALL_SLACK + " of its inner face)");
                }
                waysIn.addAll(from);
            }
        }
        if (!inZone.isEmpty() && !inZone.get(0).isEmpty()) {
            // reached: zone 0's part of the floor, and every part a way in opens onto
            java.util.Set<Integer> reachedParts = new java.util.HashSet<>();
            reachedParts.add(find(parent, inZone.get(0).get(0)));
            for (int p : waysIn) {
                reachedParts.add(find(parent, p));
            }
            List<Integer> cut = new ArrayList<>();
            for (int i = 1; i < zones.size(); i++) {
                boolean reached = false;
                for (int p : inZone.get(i)) {
                    reached |= reachedParts.contains(find(parent, p));
                }
                if (!inZone.get(i).isEmpty() && !reached) {
                    cut.add(i);
                }
            }
            if (!cut.isEmpty()) {
                out.add("floor zones " + cut + " can't be walked to from zone 0 or a way in: join them"
                        + " (zones that touch join), put an inner door between them, or a door out of them");
            }
        }
        if (type.cab() != null && seats.isEmpty()) {
            out.add("a walkable cab needs a driver's chair (cab.seats): in a cab with a floor the keys"
                    + " drive only from a chair");
        }
        // a chair needs floor to sit down from: a place to stand within reach,
        // the cushion above the floor there (the chair itself may stand off
        // the floor — the assistant's beside the desk: standing up walks the
        // driver to beside it, RiderWalk.toward)
        for (int i = 0; i < seats.size(); i++) {
            WagonType.Seat seat = seats.get(i);
            double reach = Double.POSITIVE_INFINITY;
            double floor = Double.NaN;
            for (FloorRegion.Piece piece : pieces) {
                double[] c = piece.clamp(seat.x(), seat.z());
                double d = Math.hypot(c[0] - seat.x(), c[1] - seat.z());
                if (d < reach) {
                    reach = d;
                    floor = interior.floorAt(c[0], c[1], M);
                }
            }
            double height = seat.y() - floor;
            if (!(reach <= RiderWalk.SEAT_REACH) || !(height >= MIN_SEAT_HEIGHT && height <= MAX_SEAT_HEIGHT)) {
                out.add(String.format(Locale.ROOT, "cab.seats[%d] (%.2f, %.2f, %.2f): the nearest place to stand"
                        + " is %.2f off (sitting reaches %.1f), its floor %.2f below the cushion (%.1f..%.1f;"
                        + " the seat is the top of the cushion)", i, seat.x(), seat.y(), seat.z(), reach,
                        RiderWalk.SEAT_REACH, height, MIN_SEAT_HEIGHT, MAX_SEAT_HEIGHT));
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
        return !walkablePieces(door, region).isEmpty();
    }

    /**
     * Every piece of the region a rider walks through {@code door} from (see
     * {@link #walkableThrough}), in order; empty if none. {@code
     * tools/floorgen.py}'s {@code door_seeds} is the same rule.
     */
    static List<Integer> walkablePieces(WagonType.Door door, FloorRegion region) {
        boolean side = door.axis() == 0;
        int out = door.outward();
        double lo = door.spanMin() + RiderWalk.DOOR_SPAN_INSET;
        double hi = door.spanMax() - RiderWalk.DOOR_SPAN_INSET;
        List<FloorRegion.Piece> pieces = region.pieces();
        List<Integer> found = new ArrayList<>();
        for (int i = 0; i < pieces.size(); i++) {
            FloorRegion.Piece p = pieces.get(i);
            double pLo = Math.max(lo, side ? p.minZ() : p.minX());
            double pHi = Math.min(hi, side ? p.maxZ() : p.maxX());
            if (pHi < pLo) {
                continue;
            }
            double across = side ? (out > 0 ? p.maxX() : p.minX()) : (out > 0 ? p.maxZ() : p.minZ());
            for (double along = pLo; ; along = Math.min(pHi, along + SPAN_STEP)) {
                double wall = side ? region.reach(across, along, 0, out) : region.reach(along, across, 2, out);
                if (!Double.isNaN(wall) && RiderWalk.facesDoor(wall, door)) {
                    found.add(i);
                    break;
                }
                if (along >= pHi) {
                    break;
                }
            }
        }
        return found;
    }

    /** Where a rider's centre may be in an open inner door, as {@link RiderWalk} bridges it: {minX, minZ, maxX, maxZ}. */
    static double[] bridge(WagonType.Door door) {
        double lo = door.spanMin() + RiderWalk.DOOR_SPAN_INSET;
        double hi = door.spanMax() - RiderWalk.DOOR_SPAN_INSET;
        return door.axis() == 0
                ? new double[]{door.minX() - RiderWalk.BRIDGE_REACH, lo, door.maxX() + RiderWalk.BRIDGE_REACH, hi}
                : new double[]{lo, door.minZ() - RiderWalk.BRIDGE_REACH, hi, door.maxZ() + RiderWalk.BRIDGE_REACH};
    }

    static int find(int[] parent, int i) {
        while (parent[i] != i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    }

    static void union(int[] parent, int a, int b) {
        parent[find(parent, a)] = find(parent, b);
    }
}
