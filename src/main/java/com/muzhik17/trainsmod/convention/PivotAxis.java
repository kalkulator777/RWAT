package com.muzhik17.trainsmod.convention;

import java.util.List;

/**
 * A control's hinge from its {@code …_ROT…} marker (SPEC §9.3), the way IR
 * gets it from UniversalModCore's {@code ModelGroup}: the point is the centre
 * of the marker's bounding box; the axis is its long direction — the vertex
 * furthest from the centre, the vertex furthest from that one, the points
 * split by which of the two they are nearer, and the axis runs from the
 * centroid of the half whose extreme is nearer the origin to the other's.
 * That sign matters: it decides which way a lever turns. Pure.
 */
public final class PivotAxis {

    private PivotAxis() {
    }

    /**
     * @param points the marker's distinct vertex positions, in file order
     * @return {@code {centre, axis}}; the axis defaults to +Z when the points
     *         can't be split (UMC's default normal)
     */
    public static float[][] of(List<float[]> points) {
        float[] first = points.get(0);
        float[] min = first.clone();
        float[] max = first.clone();
        for (float[] p : points) {
            for (int i = 0; i < 3; i++) {
                min[i] = Math.min(min[i], p[i]);
                max[i] = Math.max(max[i], p[i]);
            }
        }
        float[] centre = {(min[0] + max[0]) * 0.5F, (min[1] + max[1]) * 0.5F, (min[2] + max[2]) * 0.5F};

        float[] far = first;      // furthest from the centre (first one wins a tie)
        for (float[] p : points) {
            if (dist2(far, centre) < dist2(p, centre)) {
                far = p;
            }
        }
        float[] other = first;    // furthest from that
        for (float[] p : points) {
            if (dist2(other, far) < dist2(p, far)) {
                other = p;
            }
        }
        float[] nearEnd = len2(other) < len2(far) ? other : far;
        float[] farEnd = len2(other) < len2(far) ? far : other;
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
        float[] axis = {0.0F, 0.0F, 1.0F};
        if (nearCount > 0 && farCount > 0) {
            double x = farSum[0] / farCount - nearSum[0] / nearCount;
            double y = farSum[1] / farCount - nearSum[1] / nearCount;
            double z = farSum[2] / farCount - nearSum[2] / nearCount;
            double len = Math.sqrt(x * x + y * y + z * z);
            if (len > 1.0e-9) {
                axis = new float[]{(float) (x / len), (float) (y / len), (float) (z / len)};
            }
        }
        return new float[][]{centre, axis};
    }

    private static double dist2(float[] a, float[] b) {
        double x = a[0] - b[0];
        double y = a[1] - b[1];
        double z = a[2] - b[2];
        return x * x + y * y + z * z;
    }

    private static double len2(float[] a) {
        return (double) a[0] * a[0] + (double) a[1] * a[1] + (double) a[2] * a[2];
    }
}
