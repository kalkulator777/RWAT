package com.muzhik17.trainsmod.kinematics;

import java.util.ArrayList;
import java.util.List;

import com.muzhik17.trainsmod.kinematics.FloorFinding.Code;
import com.muzhik17.trainsmod.stock.FloorRegion;
import com.muzhik17.trainsmod.stock.ObjFrame;
import com.muzhik17.trainsmod.stock.UnionFind;
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
 *
 * <p>Each thing found is a {@link FloorFinding}: a stable code, the zone,
 * door or chair it is about, and the numbers and names its line is made of,
 * for the pack editor to word in its language and point at; {@link
 * #problems} gives the lines, in English. A line (and a finding's params)
 * that names a place or a size gives it in the OBJ frame, where the author
 * measured it ({@link ObjFrame}): a chair at its {@code at}, a zone as its x
 * (along the car) by z (across) extent. Pure; the type registry logs the
 * lines on load, a unit test runs it over every type of the generated
 * packs, and another holds the lines to what they were before the findings
 * had codes ({@code FloorCheckTextsTest}).
 *
 * <p>Ported: {@code editor/src/ports/floorCheck.ts}, {@code tools/floorgen.py}
 * ({@code Region.door_seeds}: the ways out); golden:
 * {@code fixtures/golden/floor_check/}.
 */
public final class FloorCheck {

    private static final double M = RiderWalk.PLAYER_HALF_WIDTH;
    /** Thicker than this, a door box is more than its leaf (handles, frame — fine) or wrong. */
    private static final double MAX_DOOR_THICKNESS = 0.6;
    /** The cushion top above the floor by it a sitting player fits: the seated feet hang SIT_DROP below it. */
    public static final double MIN_SEAT_HEIGHT = 0.2;
    /** The highest a chair's cushion may be above the floor by it (see {@link #MIN_SEAT_HEIGHT}). */
    public static final double MAX_SEAT_HEIGHT = 1.5;
    /** Step along a door's span when looking for a place to walk out through it. */
    private static final double SPAN_STEP = 0.05;

    private FloorCheck() {
    }

    /**
     * What's wrong with this type's floor, one line each, as the type
     * registry logs it and {@code /rwat packs} shows it: the {@link
     * FloorFinding#text} of each of {@link #findings}; empty if nothing.
     */
    public static List<String> problems(WagonType type) {
        List<String> out = new ArrayList<>();
        for (FloorFinding finding : findings(type)) {
            out.add(finding.text());
        }
        return out;
    }

    /**
     * What's wrong with this type's floor, one finding each, in the order of
     * {@link #problems}' lines: its code, the zone, door or chair it is
     * about, and the numbers and names its line is made of; empty if nothing.
     */
    public static List<FloorFinding> findings(WagonType type) {
        List<FloorFinding> out = new ArrayList<>();
        WagonType.Interior interior = type.interior();
        List<WagonType.Seat> seats = type.cab() != null ? type.cab().seats() : List.of();
        if (interior == null) {
            if (!seats.isEmpty()) {
                out.add(FloorFinding.of(Code.SEATS_WITHOUT_INTERIOR, -1));
            }
            return out;
        }
        List<WagonType.Interior.Zone> zones = interior.zones();
        List<WagonType.Door> doors = type.doors();
        FloorRegion region = interior.region(M);
        List<FloorRegion.Piece> pieces = region.pieces();
        if (pieces.isEmpty()) {
            out.add(FloorFinding.of(Code.FLOOR_TOO_NARROW, -1, "player_width", 2 * M));
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
                // x along the car by z across, as the OBJ frame has them
                out.add(FloorFinding.of(Code.ZONE_TOO_NARROW, i, "size_x", z.maxZ() - z.minZ(),
                        "size_z", z.maxX() - z.minX(), "player_width", 2 * M));
            }
        }
        // joined: by the floor alone (every door between zones shut), then by open doors too
        int[] alone = UnionFind.of(parts.size());
        for (int[] link : shut.links()) {
            UnionFind.union(alone, link[0], link[1]);
        }
        int[] parent = alone.clone();
        List<Integer> waysIn = new ArrayList<>(); // the floor pieces outside and gangway doors open onto
        for (int d = 0; d < doors.size(); d++) {
            WagonType.Door door = doors.get(d);
            String id = door.id();
            double thick = door.axis() == 0 ? door.maxX() - door.minX() : door.maxZ() - door.minZ();
            if (thick > MAX_DOOR_THICKNESS) {
                out.add(FloorFinding.of(Code.DOOR_TOO_THICK, d, "id", id, "thickness", thick));
            }
            if (door.spanMax() - door.spanMin() - 2 * RiderWalk.DOOR_SPAN_INSET <= 0.0) {
                out.add(FloorFinding.of(Code.DOOR_TOO_NARROW, d, "id", id));
            }
            if (door.connecting() && door.axis() != 2) {
                out.add(FloorFinding.of(Code.GANGWAY_NOT_IN_END_WALL, d, "id", id));
            }
            if (door.inner()) {
                // the parts its bridge reaches, on each side of its leaf: open, it joins them
                BridgeSides sides = bridgeSides(door, shut);
                List<Integer> reached = sides.parts();
                for (int i = 1; i < reached.size(); i++) {
                    UnionFind.union(parent, reached.get(0), reached.get(i));
                }
                if (sides.reach() == BridgeSides.Reach.NONE) {
                    out.add(FloorFinding.of(Code.INNER_DOOR_NO_FLOOR, d, "id", id));
                }
                if (door.fixed()) {
                    continue; // never shut
                }
                FloorRegion.Cut cut = FloorRegion.Cut.shut(door, M);
                boolean through = false;
                for (FloorRegion.Piece piece : pieces) {
                    through |= cut.bites(piece);
                }
                if (through) {
                    out.add(FloorFinding.of(Code.INNER_DOOR_FLOOR_THROUGH, d, "id", id));
                }
                boolean round = false;
                for (int p : sides.before()) {
                    for (int q : sides.behind()) {
                        round |= UnionFind.find(alone, p) == UnionFind.find(alone, q);
                    }
                }
                if (round) {
                    out.add(FloorFinding.of(Code.INNER_DOOR_FLOOR_ROUND, d, "id", id));
                }
            } else {
                List<Integer> from = walkablePieces(door, shut);
                if (from.isEmpty()) {
                    out.add(FloorFinding.of(Code.DOOR_NOT_AT_FLOOR_END, d, "id", id,
                            "slack", RiderWalk.DOOR_WALL_SLACK));
                }
                waysIn.addAll(from);
            }
        }
        if (!inZone.isEmpty() && !inZone.get(0).isEmpty()) {
            // reached: zone 0's part of the floor, and every part a way in opens onto
            java.util.Set<Integer> reachedParts = new java.util.HashSet<>();
            reachedParts.add(UnionFind.find(parent, inZone.get(0).get(0)));
            for (int p : waysIn) {
                reachedParts.add(UnionFind.find(parent, p));
            }
            List<Integer> cut = new ArrayList<>();
            for (int i = 1; i < zones.size(); i++) {
                boolean reached = false;
                for (int p : inZone.get(i)) {
                    reached |= reachedParts.contains(UnionFind.find(parent, p));
                }
                if (!inZone.get(i).isEmpty() && !reached) {
                    cut.add(i);
                }
            }
            if (!cut.isEmpty()) {
                out.add(FloorFinding.of(Code.ZONES_UNREACHABLE, -1, "zones", List.copyOf(cut)));
            }
        }
        if (type.cab() != null && seats.isEmpty()) {
            out.add(FloorFinding.of(Code.CAB_WITHOUT_SEAT, -1));
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
                double[] at = ObjFrame.toObj(seat.x(), seat.y(), seat.z());
                out.add(FloorFinding.of(Code.SEAT_NOT_SITTABLE, i, "x", at[0], "y", at[1], "z", at[2],
                        "reach", reach, "sit_reach", RiderWalk.SEAT_REACH, "height", height,
                        "min_height", MIN_SEAT_HEIGHT, "max_height", MAX_SEAT_HEIGHT));
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
    public static List<Integer> walkablePieces(WagonType.Door door, FloorRegion region) {
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

    /**
     * The parts of the floor an open inner door's bridge reaches ({@link
     * #bridgeSides}), by the side of its leaf they are on, each in order.
     *
     * @param before the parts on the near side: ending at or short of the
     *               leaf's cut along the door's axis (towards −X or −Z of the
     *               model frame)
     * @param behind the parts past the cut
     */
    public record BridgeSides(List<Integer> before, List<Integer> behind) {

        /** On how many sides of its leaf a bridge meets the floor. */
        public enum Reach {
            BOTH("both"),
            ONE("one"),
            NONE("none");

            /** Lower-case name, as the editor and the golden data write it. */
            public final String key;

            Reach(String key) {
                this.key = key;
            }
        }

        public BridgeSides {
            before = List.copyOf(before);
            behind = List.copyOf(behind);
        }

        /** Every part the bridge reaches, in order. */
        public List<Integer> parts() {
            List<Integer> all = new ArrayList<>(before);
            all.addAll(behind);
            all.sort(null);
            return all;
        }

        /** Both sides, one (the floor ends at the door, or runs off beside it) or none (no floor near). */
        public Reach reach() {
            return !before.isEmpty() && !behind.isEmpty() ? Reach.BOTH
                    : before.isEmpty() && behind.isEmpty() ? Reach.NONE : Reach.ONE;
        }
    }

    /**
     * Where an open inner door's bridge ({@link #bridge}) meets the floor
     * with every door between zones shut ({@code shut}: {@link
     * WagonType.Interior#region(double, List, int)} with no door open): each
     * part it touches, by the side of the leaf it lies on — before the leaf a
     * part that ends at or short of its cut ({@link FloorRegion.Cut#shut})
     * along the door's axis, else behind it; no part reaches into the cut, so
     * each is on one side. The floor check finds by it an inner door on no
     * floor and one whose two sides are one floor without it; the pack
     * editor's doors tool shows by it a bridge that meets the floor on one
     * side only (beside the aisle), which the check does not see when the
     * rooms behind it have doors of their own.
     */
    public static BridgeSides bridgeSides(WagonType.Door door, FloorRegion shut) {
        double[] b = bridge(door);
        FloorRegion.Cut cut = FloorRegion.Cut.shut(door, M);
        List<Integer> before = new ArrayList<>();
        List<Integer> behind = new ArrayList<>();
        List<FloorRegion.Piece> parts = shut.pieces();
        for (int p = 0; p < parts.size(); p++) {
            FloorRegion.Piece part = parts.get(p);
            if (part.touches(b[0], b[1], b[2], b[3])) {
                double end = door.axis() == 0 ? part.maxX() : part.maxZ();
                if (end <= (door.axis() == 0 ? cut.minX() : cut.minZ()) + 1.0e-6) {
                    before.add(p);
                } else {
                    behind.add(p);
                }
            }
        }
        return new BridgeSides(before, behind);
    }

    /** Where a rider's centre may be in an open inner door, as {@link RiderWalk} bridges it: {minX, minZ, maxX, maxZ}. */
    static double[] bridge(WagonType.Door door) {
        double lo = door.spanMin() + RiderWalk.DOOR_SPAN_INSET;
        double hi = door.spanMax() - RiderWalk.DOOR_SPAN_INSET;
        return door.axis() == 0
                ? new double[]{door.minX() - RiderWalk.BRIDGE_REACH, lo, door.maxX() + RiderWalk.BRIDGE_REACH, hi}
                : new double[]{lo, door.minZ() - RiderWalk.BRIDGE_REACH, hi, door.maxZ() + RiderWalk.BRIDGE_REACH};
    }
}
