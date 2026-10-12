package com.muzhik17.trainsmod.kinematics;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.WeakHashMap;

import com.muzhik17.trainsmod.stock.FloorRegion;
import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Which part of a car's floor is a driver's cab, and which doors lead into
 * one (SPEC §9.2, the driver's key): read off the type's own data, nothing
 * declared for it. A <b>cab</b> is a piece of walkable floor a driver's chair
 * stands at, together with every piece one walks to from there without
 * passing a door — the floor pieces of {@link FloorRegion} that touch, as
 * {@link FloorCheck} joins them. An inner door is a wall until it opens, so
 * the ChME3's cab ends at its doors onto the walkways and the ER2's at the
 * partition onto the vestibule; a locomotive with two cabs (M62, ChS4T) has
 * two. A door leads into a cab if the floor it opens onto from inside is a
 * cab's — a cab's own outside doors, the inner doors onto it — and a doorway
 * without a leaf ({@code fixed}) is never one (there is nothing to lock).
 * The key works a door of a cab's group too: the doors of a group open
 * together (the ER2's {@code CabD} pair, one in the partition and one in the
 * cab).
 *
 * <p>A chair belongs to the cab of a chair listed before it if that cab's
 * floor is within sitting reach ({@link RiderWalk#SEAT_REACH}): the
 * assistant's chair beside the desk has no floor under it, and the nearest
 * floor may be behind the cab's back wall (the SR3's front vestibule).
 * Otherwise the floor nearest to it is its cab — the other end's cab.
 *
 * <p>All in the <b>model</b> frame (a flipped wagon's riders are turned back
 * into it). Pure; one instance per type, made on first use.
 */
public final class CabArea {

    /** A car without a walkable cab: no part of it is one. */
    public static final CabArea NONE = new CabArea(null, new int[0], new int[0], List.of(), 0);

    private static final Map<WagonType, CabArea> CACHE = Collections.synchronizedMap(new WeakHashMap<>());

    private static final double M = RiderWalk.PLAYER_HALF_WIDTH;

    /** The floor at the player's half-width, or null without a walkable cab. */
    private final FloorRegion region;
    /** Per piece of the region, the cab it is part of, −1 if none. */
    private final int[] cabOfPiece;
    /** Per driver's chair, the cab it stands in (−1 if the floor is nowhere). */
    private final int[] cabOfChair;
    private final List<WagonType.Seat> chairs;
    /**
     * The doors that want the key: into a cab, or of a group with such a
     * door — as open-door bits (door {@code i} of the type's list = bit {@code i}).
     */
    private final int cabDoors;

    private CabArea(FloorRegion region, int[] cabOfPiece, int[] cabOfChair, List<WagonType.Seat> chairs,
            int cabDoors) {
        this.region = region;
        this.cabOfPiece = cabOfPiece;
        this.cabOfChair = cabOfChair;
        this.chairs = chairs;
        this.cabDoors = cabDoors;
    }

    /** The cabs of {@code type} (made once per type); {@link #NONE} for a car without a walkable one. */
    public static CabArea of(WagonType type) {
        if (type == null || type.cab() == null || type.interior() == null || type.cab().seats().isEmpty()) {
            return NONE;
        }
        CabArea area = CACHE.get(type);
        if (area == null) {
            area = build(type);
            CACHE.put(type, area);
        }
        return area;
    }

    private static CabArea build(WagonType type) {
        FloorRegion region = type.interior().region(M);
        List<FloorRegion.Piece> pieces = region.pieces();
        int[] parent = new int[pieces.size()];
        for (int i = 0; i < parent.length; i++) {
            parent[i] = i;
        }
        for (int[] link : region.links()) {
            FloorCheck.union(parent, link[0], link[1]);
        }
        // each chair's cab: the floor where one stands to sit down in it, and all it joins
        List<WagonType.Seat> chairs = type.cab().seats();
        int[] cabOfChair = new int[chairs.size()];
        List<Integer> roots = new ArrayList<>();
        for (int c = 0; c < chairs.size(); c++) {
            WagonType.Seat chair = chairs.get(c);
            int piece = -1;
            double reach = RiderWalk.SEAT_REACH;
            for (int p = 0; p < pieces.size(); p++) {
                // the floor of a cab found already, within sitting reach
                double d = distance(pieces.get(p), chair.x(), chair.z());
                if (d <= reach && roots.contains(FloorCheck.find(parent, p))) {
                    piece = p;
                    reach = d;
                }
            }
            if (piece < 0) {
                piece = nearestPiece(pieces, chair.x(), chair.z());
            }
            if (piece < 0) {
                cabOfChair[c] = -1;
                continue;
            }
            int root = FloorCheck.find(parent, piece);
            if (!roots.contains(root)) {
                roots.add(root);
            }
            cabOfChair[c] = roots.indexOf(root);
        }
        int[] cabOfPiece = new int[pieces.size()];
        for (int p = 0; p < pieces.size(); p++) {
            cabOfPiece[p] = roots.indexOf(FloorCheck.find(parent, p));
        }
        int cabDoors = 0;
        List<WagonType.Door> doors = type.doors();
        for (int d = 0; d < doors.size() && d < 32; d++) {
            WagonType.Door door = doors.get(d);
            if (door.fixed()) {
                continue;
            }
            boolean intoCab = false;
            if (door.inner()) {
                double[] b = FloorCheck.bridge(door);
                for (int p = 0; p < pieces.size() && !intoCab; p++) {
                    intoCab = cabOfPiece[p] >= 0 && pieces.get(p).touches(b[0], b[1], b[2], b[3]);
                }
            } else {
                int piece = FloorCheck.walkablePiece(door, region);
                intoCab = piece >= 0 && cabOfPiece[piece] >= 0;
            }
            if (intoCab) {
                cabDoors |= 1 << d;
            }
        }
        // a door of a cab door's group opens with it: it wants the key as well
        int grouped = 0;
        for (int d = 0; d < doors.size() && d < 32; d++) {
            for (int e = 0; e < doors.size() && e < 32; e++) {
                if ((cabDoors >> e & 1) != 0 && !doors.get(d).fixed() && doors.get(d).groupedWith(doors.get(e))) {
                    grouped |= 1 << d;
                }
            }
        }
        return new CabArea(region, cabOfPiece, cabOfChair, chairs, cabDoors | grouped);
    }

    private static int nearestPiece(List<FloorRegion.Piece> pieces, double x, double z) {
        int best = -1;
        double bestDist = Double.MAX_VALUE;
        for (int p = 0; p < pieces.size(); p++) {
            double d = distance(pieces.get(p), x, z);
            if (d < bestDist) {
                best = p;
                bestDist = d;
            }
        }
        return best;
    }

    private static double distance(FloorRegion.Piece piece, double x, double z) {
        double[] c = piece.clamp(x, z);
        return Math.hypot(c[0] - x, c[1] - z);
    }

    /** How many cabs the car has (0 without a walkable one). */
    public int cabs() {
        int count = 0;
        for (int cab : cabOfChair) {
            count = Math.max(count, cab + 1);
        }
        return count;
    }

    /**
     * The cab a rider whose feet are at (x, z) stands in, −1 if none — the
     * saloon, a walkway, the middle of an open door between two floors.
     */
    public int cabAt(double x, double z) {
        if (region == null) {
            return -1;
        }
        List<FloorRegion.Piece> pieces = region.pieces();
        for (int i = region.firstPieceReaching(z - 1.0e-6); i < pieces.size(); i++) {
            FloorRegion.Piece piece = pieces.get(i);
            if (piece.minZ() > z + 1.0e-6) {
                break;
            }
            if (cabOfPiece[i] >= 0 && piece.holds(x, z)) {
                return cabOfPiece[i];
            }
        }
        return -1;
    }

    /** The cab driver's chair {@code chair} stands in, −1 if none. */
    public int cabOfChair(int chair) {
        return chair >= 0 && chair < cabOfChair.length ? cabOfChair[chair] : -1;
    }

    /**
     * The chair of cab {@code cab} nearest to (x, z) — the desk a rider
     * standing there works — or −1 if the cab has none.
     */
    public int nearestChair(int cab, double x, double z) {
        int best = -1;
        double bestDist = Double.MAX_VALUE;
        for (int c = 0; c < cabOfChair.length; c++) {
            if (cabOfChair[c] != cab || cab < 0) {
                continue;
            }
            double d = Math.hypot(chairs.get(c).x() - x, chairs.get(c).z() - z);
            if (d < bestDist) {
                best = c;
                bestDist = d;
            }
        }
        return best;
    }

    /**
     * True if door {@code index} of the type's list wants the driver's key:
     * it leads into a cab, or opens with such a door (its group).
     */
    public boolean cabDoor(int index) {
        return index >= 0 && index < 32 && (cabDoors >> index & 1) != 0;
    }

    /** The doors that want the driver's key ({@link #cabDoor}), as open-door bits. */
    public int cabDoors() {
        return cabDoors;
    }

    /**
     * Which way along the path a driver at {@code chair} of a car looks (+1
     * = +s, SPEC §6.12): a car in a flipped slot looks towards −s, and so
     * does a chair facing the model's rear. Null chair: a cab seat without
     * a walkable interior, facing the model's front.
     */
    public static int facing(boolean flipped, WagonType.Seat chair) {
        boolean back = chair != null && chair.facesBack();
        return (flipped ? -1 : 1) * (back ? -1 : 1);
    }
}
