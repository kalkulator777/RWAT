package com.muzhik17.trainsmod.kinematics;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The outline of a part's mesh (SPEC §9.3: the hover outline round a lever,
 * a switch, a door leaf): its <b>characteristic edges</b>, not its whole
 * triangulation, which is noise. Worked out once per part:
 * <ul>
 *   <li>the <b>boundary</b> of an open surface (an edge of one face);</li>
 *   <li><b>creases</b>: an edge between two faces whose normals part by more
 *       than the crease angle — a box gives exactly its twelve edges, as a
 *       block's outline;</li>
 *   <li>edges where three or more faces meet;</li>
 * </ul>
 * these are always drawn. The rest — the <b>smooth</b> edges of a curved
 * surface, a rounded handle — are drawn only where they are on the part's
 * <b>silhouette</b> from the eye (one face toward it, the other away), so a
 * cylinder shows its two rims and its two side lines from wherever it is
 * seen. The diagonal of a quad split in two is smooth and flat: never drawn.
 *
 * <p>Corners are welded by position first (an OBJ repeats a corner per UV
 * and normal; parts of one control repeat each other's corners), and the
 * faces' winding is read off the shared edge: two faces going the same way
 * along it are wound against each other, and one's normal is turned to
 * compare them. Pure; the mesh is the caller's quads.
 */
public final class EdgeOutline {

    /** An edge to draw, from one end to the other. */
    @FunctionalInterface
    public interface EdgeSink {
        void edge(float x0, float y0, float z0, float x1, float y1, float z1);
    }

    /** Six floats per edge always drawn: its two ends. */
    private final float[] fixed;
    /** Twelve floats per smooth edge: its two ends, then its two faces' normals (wound alike). */
    private final float[] smooth;

    private EdgeOutline(float[] fixed, float[] smooth) {
        this.fixed = fixed;
        this.smooth = smooth;
    }

    /** No edges (a part without faces). */
    public static final EdgeOutline EMPTY = new EdgeOutline(new float[0], new float[0]);

    /** How many edges are always drawn. */
    public int fixedCount() {
        return fixed.length / 6;
    }

    /** How many edges are drawn only on the silhouette. */
    public int smoothCount() {
        return smooth.length / 12;
    }

    /**
     * The outline of quads {@code quads} — twelve floats each, four corners
     * {@code x y z} in order (a triangle repeats a corner) — with corners
     * closer than {@code weld} taken as one and faces parting by more than
     * {@code creaseDegrees} making a crease.
     */
    public static EdgeOutline of(float[] quads, double creaseDegrees, double weld) {
        Welder welder = new Welder(weld);
        double creaseCos = Math.cos(Math.toRadians(creaseDegrees));
        List<double[]> normals = new ArrayList<>();
        // edge key → { first end, second end, face of the first, its direction, face of the second, its direction, count }
        Map<Long, int[]> edges = new HashMap<>();
        int[] corner = new int[4];
        for (int q = 0; q + 12 <= quads.length; q += 12) {
            int n = 0;
            for (int k = 0; k < 4; k++) {
                int id = welder.id(quads[q + k * 3], quads[q + k * 3 + 1], quads[q + k * 3 + 2]);
                if (n == 0 || corner[n - 1] != id) {
                    corner[n++] = id;
                }
            }
            if (n > 1 && corner[n - 1] == corner[0]) {
                n--;
            }
            if (n < 3) {
                continue; // a degenerate face: no area, no edges of its own
            }
            double[] normal = newell(welder, corner, n);
            if (normal == null) {
                continue;
            }
            int face = normals.size();
            normals.add(normal);
            for (int k = 0; k < n; k++) {
                int a = corner[k];
                int b = corner[(k + 1) % n];
                long key = a < b ? (long) a << 32 | b : (long) b << 32 | a;
                int[] edge = edges.get(key);
                if (edge == null) {
                    edges.put(key, new int[]{a, b, face, 1, -1, 0, 1});
                } else {
                    if (edge[6] == 1) {
                        edge[4] = face;
                        edge[5] = edge[0] == a ? 1 : -1; // the same way along it as the first face, or back
                    }
                    edge[6]++;
                }
            }
        }
        float[] fixed = new float[edges.size() * 6];
        float[] smooth = new float[edges.size() * 12];
        int nf = 0;
        int ns = 0;
        for (int[] edge : edges.values()) {
            float[] a = welder.at(edge[0]);
            float[] b = welder.at(edge[1]);
            if (edge[6] == 2) {
                double[] n1 = normals.get(edge[2]);
                double[] n2 = normals.get(edge[4]);
                // two faces wound alike go opposite ways along their shared edge
                double sign = edge[5] == 1 ? -1.0 : 1.0;
                double cos = (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]) * sign;
                if (cos >= creaseCos) {
                    System.arraycopy(a, 0, smooth, ns, 3);
                    System.arraycopy(b, 0, smooth, ns + 3, 3);
                    for (int i = 0; i < 3; i++) {
                        smooth[ns + 6 + i] = (float) n1[i];
                        smooth[ns + 9 + i] = (float) (n2[i] * sign);
                    }
                    ns += 12;
                    continue;
                }
            }
            System.arraycopy(a, 0, fixed, nf, 3);
            System.arraycopy(b, 0, fixed, nf + 3, 3);
            nf += 6;
        }
        return new EdgeOutline(java.util.Arrays.copyOf(fixed, nf), java.util.Arrays.copyOf(smooth, ns));
    }

    /**
     * The edges to draw seen from {@code (ex, ey, ez)}, in the mesh's frame:
     * every fixed edge, and the smooth edges on the silhouette from there.
     */
    public void forEach(double ex, double ey, double ez, EdgeSink sink) {
        for (int i = 0; i < fixed.length; i += 6) {
            sink.edge(fixed[i], fixed[i + 1], fixed[i + 2], fixed[i + 3], fixed[i + 4], fixed[i + 5]);
        }
        for (int i = 0; i < smooth.length; i += 12) {
            double dx = ex - smooth[i];
            double dy = ey - smooth[i + 1];
            double dz = ez - smooth[i + 2];
            double s1 = smooth[i + 6] * dx + smooth[i + 7] * dy + smooth[i + 8] * dz;
            double s2 = smooth[i + 9] * dx + smooth[i + 10] * dy + smooth[i + 11] * dz;
            if (s1 * s2 < 0.0) {
                sink.edge(smooth[i], smooth[i + 1], smooth[i + 2], smooth[i + 3], smooth[i + 4], smooth[i + 5]);
            }
        }
    }

    /** A face's unit normal by Newell's method (a bent quad gets its mean), null if it has no area. */
    private static double[] newell(Welder welder, int[] corner, int n) {
        double nx = 0.0;
        double ny = 0.0;
        double nz = 0.0;
        for (int k = 0; k < n; k++) {
            float[] p = welder.at(corner[k]);
            float[] q = welder.at(corner[(k + 1) % n]);
            nx += (p[1] - q[1]) * (p[2] + q[2]);
            ny += (p[2] - q[2]) * (p[0] + q[0]);
            nz += (p[0] - q[0]) * (p[1] + q[1]);
        }
        double length = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (length < 1.0e-12) {
            return null;
        }
        return new double[]{nx / length, ny / length, nz / length};
    }

    /** Corners welded by position: ids by first appearance, a grid of {@code weld}-sized cells. */
    private static final class Welder {
        private final double weld;
        private final Map<Long, List<Integer>> cells = new HashMap<>();
        private final List<float[]> points = new ArrayList<>();

        Welder(double weld) {
            this.weld = Math.max(weld, 1.0e-6);
        }

        int id(float x, float y, float z) {
            long cx = (long) Math.floor(x / weld);
            long cy = (long) Math.floor(y / weld);
            long cz = (long) Math.floor(z / weld);
            double limit = weld * weld;
            for (long dx = -1; dx <= 1; dx++) {
                for (long dy = -1; dy <= 1; dy++) {
                    for (long dz = -1; dz <= 1; dz++) {
                        List<Integer> cell = cells.get(key(cx + dx, cy + dy, cz + dz));
                        if (cell == null) {
                            continue;
                        }
                        for (int id : cell) {
                            float[] p = points.get(id);
                            double ddx = p[0] - x;
                            double ddy = p[1] - y;
                            double ddz = p[2] - z;
                            if (ddx * ddx + ddy * ddy + ddz * ddz <= limit) {
                                return id;
                            }
                        }
                    }
                }
            }
            int id = points.size();
            points.add(new float[]{x, y, z});
            cells.computeIfAbsent(key(cx, cy, cz), k -> new ArrayList<>(2)).add(id);
            return id;
        }

        float[] at(int id) {
            return points.get(id);
        }

        private static long key(long x, long y, long z) {
            return (x * 73856093L) ^ (y * 19349663L) ^ (z * 83492791L);
        }
    }
}
