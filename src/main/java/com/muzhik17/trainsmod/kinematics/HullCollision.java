package com.muzhik17.trainsmod.kinematics;

import java.util.List;

import org.joml.Quaterniond;
import org.joml.Vector3d;

import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Pure-math hard collision against a wagon's solid hull (SPEC v1.5-а): a moving
 * <b>OBB</b> (the body box carried by the pose) versus an entity that may walk
 * or fly into it. Minecraft's collision is AABB-only, so we move the problem
 * into the wagon's <b>local frame</b> — where the hull is axis-aligned — do the
 * standard per-axis swept clamp there, and rotate the result back to world.
 *
 * <p>No MC imports (SPEC principle #4): the rotation mirrors
 * {@link PoseMath} exactly so client and server agree, and the geometry is
 * unit-testable without the game.
 */
public final class HullCollision {

    private HullCollision() {
    }

    /**
     * An open doorway through the hull wall (SPEC v1.5, doors), in the
     * wagon's local frame. The hull stays solid everywhere else; an entity
     * whose <b>centre</b> lies inside the opening's cross-section — along the
     * wall ({@code spanMin..spanMax}), below the door top ({@code maxY}) and
     * on the door's own side: outside the wall face, or no more than {@link
     * #DEPTH} in through it — is not stopped by the wall the doorway pierces
     * ({@code axis}: 0 = an X wall / side door, 2 = a Z wall / end door; the
     * face at {@code face} on that axis, {@code outward} ±1 the way the door
     * faces). The opposite wall stays solid over the same span. There is no
     * lower bound: stepping into the doorway from the ground walks into the
     * step well, the way a real vestibule is boarded.
     */
    public record Portal(int axis, int outward, double face, double spanMin, double spanMax,
            double maxY) {

        /**
         * How far in through the wall face the opening still counts: the step
         * well — a body's width, and the steps the server may take in at once
         * before it boards the player (or the hull shove would throw them out).
         */
        public static final double DEPTH = 1.0;

        /**
         * The opening open door {@code door} (pose frame) cuts in {@code hull}:
         * in the hull face on the door's side, along the door's span less
         * {@link RiderWalk#DOOR_SPAN_INSET} at each jamb, up to the door's top.
         */
        public static Portal of(WagonType.Door door, WagonType.Hull hull) {
            int axis = door.axis();
            int outward = door.outward();
            double face = axis == 0
                    ? (outward > 0 ? hull.maxX() : hull.minX())
                    : (outward > 0 ? hull.maxZ() : hull.minZ());
            return new Portal(axis, outward, face, door.spanMin() + RiderWalk.DOOR_SPAN_INSET,
                    door.spanMax() - RiderWalk.DOOR_SPAN_INSET, door.maxY());
        }

        /** Whether a local point is inside this opening's cross-section, on its side of the car. */
        public boolean contains(double x, double y, double z) {
            double along = axis == 0 ? z : x;
            return along >= spanMin && along <= spanMax && y <= maxY && outside(x, z) >= -DEPTH;
        }

        /** How far a local point lies out from the wall face, the way the door faces (negative: in). */
        public double outside(double x, double z) {
            return ((axis == 0 ? x : z) - face) * outward;
        }
    }

    /** Local→world body rotation, the exact mirror of {@link PoseMath} / the renderer. */
    private static Quaterniond rotation(float yawDeg, float pitchDeg) {
        return new Quaterniond()
                .rotateY(Math.toRadians(-yawDeg))
                .rotateX(Math.toRadians(pitchDeg));
    }

    /**
     * Clamp an entity's intended world movement so it cannot <b>enter</b> the
     * wagon's solid hull from outside (the hard wall — can't walk or fly through,
     * SPEC v1.5-а). The entity AABB and the move are transformed into the wagon's
     * local frame, swept-clamped per axis against the solid hull box (vanilla
     * order Y, X, Z), and the clamped move rotated back to world.
     *
     * <p>Only blocks entering: an entity already overlapping the hull keeps its
     * movement (so it can walk out, and the server shove ejects it) — a swept
     * clamp against a solid box never resolves existing penetration, by design.
     * When nothing clamps, the <i>same</i> world vector is returned (no rotation
     * round-trip), so a no-op introduces no floating drift.
     *
     * @param hullMin model-space hull min corner
     * @param hullMax model-space hull max corner
     * @param body    wagon body world position (the model origin)
     * @param yawDeg  wagon body yaw, degrees
     * @param pitchDeg wagon body pitch, degrees
     * @param entityCenter entity AABB centre, world
     * @param ehx     entity AABB half-extent X (world)
     * @param ehy     entity AABB half-extent Y (world)
     * @param ehz     entity AABB half-extent Z (world)
     * @param move    intended world movement (already block-collided by vanilla)
     * @return the clamped world movement (the same {@code move} instance if unchanged)
     */
    public static Vector3d clampMove(Vector3d hullMin, Vector3d hullMax,
            Vector3d body, float yawDeg, float pitchDeg,
            Vector3d entityCenter, double ehx, double ehy, double ehz,
            Vector3d move) {
        return clampMove(hullMin, hullMax, body, yawDeg, pitchDeg,
                entityCenter, ehx, ehy, ehz, move, List.of());
    }

    /**
     * {@link #clampMove} with open doorways: the X (Z) wall doesn't stop an
     * entity whose centre is inside an open {@link Portal} on that axis at
     * the moment that axis is resolved — it walks into the opening, and the
     * server then boards it. Only the door's own wall opens: one coming at
     * the opposite wall over the same span still meets it.
     */
    public static Vector3d clampMove(Vector3d hullMin, Vector3d hullMax,
            Vector3d body, float yawDeg, float pitchDeg,
            Vector3d entityCenter, double ehx, double ehy, double ehz,
            Vector3d move, List<Portal> portals) {
        Quaterniond rot = rotation(yawDeg, pitchDeg);
        Quaterniond inv = new Quaterniond(rot).conjugate();

        Vector3d cLocal = inv.transform(new Vector3d(entityCenter).sub(body));
        Vector3d mLocal = inv.transform(new Vector3d(move));

        double[] lh = localCover(inv, ehx, ehy, ehz);
        double lhx = lh[0], lhy = lh[1], lhz = lh[2];

        double minX = cLocal.x - lhx, maxX = cLocal.x + lhx;
        double minY = cLocal.y - lhy, maxY = cLocal.y + lhy;
        double minZ = cLocal.z - lhz, maxZ = cLocal.z + lhz;

        // default: the axis passes unclamped; clamp only where the box actually
        // overlaps the hull on the other two axes (vanilla per-axis order Y,X,Z)
        double dy = mLocal.y, dx = mLocal.x, dz = mLocal.z;
        if (overlap(minX, maxX, hullMin.x, hullMax.x) && overlap(minZ, maxZ, hullMin.z, hullMax.z)) {
            dy = clampAxis(mLocal.y, minY, maxY, hullMin.y, hullMax.y);
        }
        minY += dy;
        maxY += dy;
        if (overlap(minY, maxY, hullMin.y, hullMax.y) && overlap(minZ, maxZ, hullMin.z, hullMax.z)
                && !inPortal(portals, 0, (minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5)) {
            dx = clampAxis(mLocal.x, minX, maxX, hullMin.x, hullMax.x);
        }
        minX += dx;
        maxX += dx;
        if (overlap(minX, maxX, hullMin.x, hullMax.x) && overlap(minY, maxY, hullMin.y, hullMax.y)
                && !inPortal(portals, 2, (minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5)) {
            dz = clampAxis(mLocal.z, minZ, maxZ, hullMin.z, hullMax.z);
        }

        if (dx == mLocal.x && dy == mLocal.y && dz == mLocal.z) {
            return move; // nothing clamped — return the exact input, no round-trip drift
        }
        return rot.transform(new Vector3d(dx, dy, dz));
    }

    /**
     * The world displacement that ejects an entity out the nearest <b>horizontal</b>
     * hull face, or {@link #ZERO} if it isn't overlapping. The wagon-motion shove
     * (SPEC v1.5-а part 2): the server runs this after moving the wagon so a car
     * that overtakes a standing entity pushes it aside rather than swallowing it
     * (the case {@link #clampMove}, acting on the entity's own move, can't catch).
     * Never vertical — a body shoves sideways, it doesn't launch entities up.
     */
    public static Vector3d shove(Vector3d hullMin, Vector3d hullMax,
            Vector3d body, float yawDeg, float pitchDeg,
            Vector3d entityCenter, double ehx, double ehy, double ehz) {
        Quaterniond rot = rotation(yawDeg, pitchDeg);
        Quaterniond inv = new Quaterniond(rot).conjugate();

        Vector3d cLocal = inv.transform(new Vector3d(entityCenter).sub(body));
        double[] lh = localCover(inv, ehx, ehy, ehz);
        double lhx = lh[0], lhy = lh[1], lhz = lh[2];

        if (!(overlap(cLocal.x - lhx, cLocal.x + lhx, hullMin.x, hullMax.x)
                && overlap(cLocal.y - lhy, cLocal.y + lhy, hullMin.y, hullMax.y)
                && overlap(cLocal.z - lhz, cLocal.z + lhz, hullMin.z, hullMax.z))) {
            return new Vector3d(ZERO);
        }

        // signed exit along each horizontal axis, pick the shallower per axis
        double exitPosX = hullMax.x - (cLocal.x - lhx); // push +X to clear
        double exitNegX = hullMin.x - (cLocal.x + lhx); // push −X to clear (negative)
        double dispX = exitPosX <= -exitNegX ? exitPosX : exitNegX;

        double exitPosZ = hullMax.z - (cLocal.z - lhz);
        double exitNegZ = hullMin.z - (cLocal.z + lhz);
        double dispZ = exitPosZ <= -exitNegZ ? exitPosZ : exitNegZ;

        // eject along the shallower of the two horizontal axes
        Vector3d local = Math.abs(dispX) <= Math.abs(dispZ)
                ? new Vector3d(dispX, 0.0, 0.0)
                : new Vector3d(0.0, 0.0, dispZ);
        return rot.transform(local);
    }

    /** A fresh zero vector (callers may mutate). */
    private static final Vector3d ZERO = new Vector3d(0.0, 0.0, 0.0);

    /**
     * Exact local-frame AABB cover half-extents of a world-axis-aligned entity
     * box: each world axis maps to a vector in local coordinates, and the cover
     * half-extent along a local axis is the |projection|-weighted sum of the
     * world half-extents. For a yawed wagon this is what makes the local-frame
     * box conservative-but-tight rather than a crude inflate.
     */
    private static double[] localCover(Quaterniond inv, double ehx, double ehy, double ehz) {
        Vector3d wx = inv.transform(new Vector3d(1, 0, 0));
        Vector3d wy = inv.transform(new Vector3d(0, 1, 0));
        Vector3d wz = inv.transform(new Vector3d(0, 0, 1));
        return new double[]{
                Math.abs(wx.x) * ehx + Math.abs(wy.x) * ehy + Math.abs(wz.x) * ehz,
                Math.abs(wx.y) * ehx + Math.abs(wy.y) * ehy + Math.abs(wz.y) * ehz,
                Math.abs(wx.z) * ehx + Math.abs(wy.z) * ehy + Math.abs(wz.z) * ehz};
    }

    /**
     * The open doorway an entity centre (world) stands in, or null: on the
     * door's side, at most {@link Portal#DEPTH} in through its wall. The
     * server uses it to leave a player stepping through a door alone (no
     * shove back out mid-step).
     */
    public static Portal portalAt(List<Portal> portals, Vector3d body, float yawDeg,
            float pitchDeg, Vector3d entityCenter) {
        if (portals.isEmpty()) {
            return null;
        }
        Vector3d local = new Quaterniond(rotation(yawDeg, pitchDeg)).conjugate()
                .transform(new Vector3d(entityCenter).sub(body));
        for (Portal portal : portals) {
            if (portal.contains(local.x, local.y, local.z)) {
                return portal;
            }
        }
        return null;
    }

    private static boolean inPortal(List<Portal> portals, int axis, double x, double y, double z) {
        for (Portal portal : portals) {
            if (portal.axis() == axis && portal.contains(x, y, z)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Distance along a ray to where it enters an axis-aligned box (slab
     * test), 0 if the origin is already inside, or −1 if it misses or the box
     * is behind. Used to pick a door leaf under the crosshair in the wagon's
     * local frame ({@code dir} need not be normalized; the result is in units
     * of {@code |dir|}).
     */
    public static double rayBox(Vector3d origin, Vector3d dir, double minX, double minY,
            double minZ, double maxX, double maxY, double maxZ) {
        double tNear = Double.NEGATIVE_INFINITY;
        double tFar = Double.POSITIVE_INFINITY;
        double[] o = {origin.x, origin.y, origin.z};
        double[] d = {dir.x, dir.y, dir.z};
        double[] lo = {minX, minY, minZ};
        double[] hi = {maxX, maxY, maxZ};
        for (int i = 0; i < 3; i++) {
            if (Math.abs(d[i]) < 1.0e-12) {
                if (o[i] < lo[i] || o[i] > hi[i]) {
                    return -1.0; // parallel and outside this slab
                }
                continue;
            }
            double t1 = (lo[i] - o[i]) / d[i];
            double t2 = (hi[i] - o[i]) / d[i];
            tNear = Math.max(tNear, Math.min(t1, t2));
            tFar = Math.min(tFar, Math.max(t1, t2));
        }
        if (tNear > tFar || tFar < 0.0) {
            return -1.0;
        }
        return Math.max(tNear, 0.0);
    }

    /** Half-open interval overlap (matches vanilla's strict AABB test). */
    private static boolean overlap(double a0, double a1, double b0, double b1) {
        return a1 > b0 && a0 < b1;
    }

    /**
     * One-axis swept clamp of a moving interval {@code [a0,a1]} against a static
     * solid interval {@code [s0,s1]} (vanilla {@code AABB.collideX/Y/Z}): reduce
     * {@code move} so the box stops at the face instead of crossing it. Caller
     * has already confirmed overlap on the other two axes.
     */
    private static double clampAxis(double move, double a0, double a1, double s0, double s1) {
        if (move > 0.0 && a1 <= s0) {
            double limit = s0 - a1;
            return limit < move ? limit : move;
        }
        if (move < 0.0 && a0 >= s1) {
            double limit = s1 - a0;
            return limit > move ? limit : move;
        }
        return move;
    }
}
