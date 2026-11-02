package com.muzhik17.trainsmod.convention;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * A control's hinge from its {@code …_ROT…} marker (SPEC §9.3), exactly as
 * Immersive Railroading gets it from UniversalModCore: {@code
 * ModelGroup.buildGroup}, and before it the 1.12.2 {@code
 * cam72cam.mod.model.obj.OBJParser} the MVP pack was made for. Step by step:
 * <ol>
 *   <li>the points: the corners of the marker's faces in file order (face by
 *       face, each face's corners as written), each position once, where it
 *       first comes;</li>
 *   <li>the hinge: the centre of their bounding box;</li>
 *   <li>end A: the point furthest from the centre; end B: the point furthest
 *       from A — a tie goes to the earlier point;</li>
 *   <li>the near end: B if {@code |B|² < |A|²}, else A; the other is the far end;</li>
 *   <li>the axis: from the centroid of the points nearer the near end to the
 *       centroid of those nearer the far end (a point as near to both is in
 *       neither), unit length; +Z if a half is empty (UMC's default normal).</li>
 * </ol>
 * In double, as UMC does it, from the coordinates as the OBJ loader reads
 * them (float). The axis sign decides which way the part turns.
 *
 * <p>For a rod (a line of two points, a thin cylinder, a long box seen from
 * the origin along its length) the axis runs along it, from the end nearer
 * the OBJ origin to the farther one. A marker symmetric about its centre — a
 * box, whose eight corners are all equally far from it — has several
 * candidates for A, and the first of them in the file wins: the sign then
 * comes from the order of the vertices, not from the shape. In the MVP pack
 * that is most of the markers (302 of 336, every one turning as in IR — the
 * pack was set up there). A marker of two points comes out the same either
 * way round — from the point nearer the origin to the other — so that is the
 * one to draw for a hinge whose sign matters. Pure.
 */
public final class PivotAxis {

    private PivotAxis() {
    }

    /** A position, as a set key: 0 and −0 are one. */
    private record Position(float x, float y, float z) {
        Position {
            x += 0.0F;
            y += 0.0F;
            z += 0.0F;
        }
    }

    /**
     * The distinct points of a marker: each position once, where it first
     * comes in {@code corners} (the corners of its faces in file order).
     */
    public static List<float[]> points(List<float[]> corners) {
        Set<Position> seen = new HashSet<>();
        List<float[]> points = new ArrayList<>();
        for (float[] c : corners) {
            if (seen.add(new Position(c[0], c[1], c[2]))) {
                points.add(c);
            }
        }
        return points;
    }

    /**
     * @param corners the corners of the marker's faces, in file order (repeats
     *                are dropped, {@link #points}); at least one
     * @return {@code {centre, axis}}; the axis is +Z when the points can't be
     *         split (UMC's default normal)
     */
    public static double[][] of(List<float[]> corners) {
        List<float[]> points = points(corners);
        float[] first = points.get(0);
        double[] min = {first[0], first[1], first[2]};
        double[] max = min.clone();
        for (float[] p : points) {
            for (int i = 0; i < 3; i++) {
                min[i] = Math.min(min[i], p[i]);
                max[i] = Math.max(max[i], p[i]);
            }
        }
        double[] centre = {(max[0] + min[0]) * 0.5, (max[1] + min[1]) * 0.5, (max[2] + min[2]) * 0.5};

        float[] endA = first;     // furthest from the centre (the earlier point wins a tie)
        for (float[] p : points) {
            if (dist2(endA, centre) < dist2(p, centre)) {
                endA = p;
            }
        }
        float[] endB = first;     // furthest from that
        for (float[] p : points) {
            if (dist2(endB, endA) < dist2(p, endA)) {
                endB = p;
            }
        }
        float[] nearEnd = len2(endB) < len2(endA) ? endB : endA;
        float[] farEnd = len2(endB) < len2(endA) ? endA : endB;
        double[] nearSum = new double[3];
        double[] farSum = new double[3];
        int nearCount = 0;
        int farCount = 0;
        for (float[] p : points) {
            double toNear = dist2(p, nearEnd);
            double toFar = dist2(p, farEnd);
            if (toNear < toFar) {
                for (int i = 0; i < 3; i++) {
                    nearSum[i] += p[i];
                }
                nearCount++;
            } else if (toNear > toFar) {
                for (int i = 0; i < 3; i++) {
                    farSum[i] += p[i];
                }
                farCount++;
            }
        }
        double[] axis = {0.0, 0.0, 1.0};
        if (nearCount > 0 && farCount > 0) {
            double x = farSum[0] / farCount - nearSum[0] / nearCount;
            double y = farSum[1] / farCount - nearSum[1] / nearCount;
            double z = farSum[2] / farCount - nearSum[2] / nearCount;
            double len = Math.sqrt(x * x + y * y + z * z);
            if (len > 1.0e-9) {
                axis = new double[]{x / len, y / len, z / len};
            }
        }
        return new double[][]{centre, axis};
    }

    private static double dist2(float[] a, float[] b) {
        double x = (double) a[0] - b[0];
        double y = (double) a[1] - b[1];
        double z = (double) a[2] - b[2];
        return x * x + y * y + z * z;
    }

    private static double dist2(float[] a, double[] b) {
        double x = a[0] - b[0];
        double y = a[1] - b[1];
        double z = a[2] - b[2];
        return x * x + y * y + z * z;
    }

    private static double len2(float[] a) {
        return (double) a[0] * a[0] + (double) a[1] * a[1] + (double) a[2] * a[2];
    }
}
