package com.muzhik17.trainsmod.kinematics;

/**
 * The nearest triangle a ray hits (SPEC §9.3, §9.5): what stands between the
 * eye and a door or a control — the car's walls, partitions, the desk — so a
 * click doesn't reach through them. Pure; built once per model.
 *
 * <p>The triangles are bucketed in a uniform grid of cubes ({@code cell}
 * across) by their bounds; a ray walks the cells it crosses in order
 * (Amanatides–Woo) and stops at the first cell that holds a hit no further
 * than the cell's far side, so a long car costs a handful of cells per ray.
 */
public final class RayGrid {

    private static final double EPS = 1.0e-9;

    /** Nine floats per triangle: three corners. */
    private final float[] tris;
    private final double minX;
    private final double minY;
    private final double minZ;
    private final double cell;
    private final int nx;
    private final int ny;
    private final int nz;
    /** Cell {@code c}'s triangles are {@code items[start[c]] … items[start[c + 1] − 1]}. */
    private final int[] start;
    private final int[] items;

    private RayGrid(float[] tris, double minX, double minY, double minZ, double cell,
            int nx, int ny, int nz, int[] start, int[] items) {
        this.tris = tris;
        this.minX = minX;
        this.minY = minY;
        this.minZ = minZ;
        this.cell = cell;
        this.nx = nx;
        this.ny = ny;
        this.nz = nz;
        this.start = start;
        this.items = items;
    }

    /**
     * A grid over {@code triangles} (nine floats each: x0 y0 z0 x1 … z2) with
     * cubes {@code cell} across.
     */
    public static RayGrid of(float[] triangles, double cell) {
        int count = triangles.length / 9;
        double loX = Double.MAX_VALUE;
        double loY = Double.MAX_VALUE;
        double loZ = Double.MAX_VALUE;
        double hiX = -Double.MAX_VALUE;
        double hiY = -Double.MAX_VALUE;
        double hiZ = -Double.MAX_VALUE;
        for (int i = 0; i < count * 9; i += 3) {
            loX = Math.min(loX, triangles[i]);
            loY = Math.min(loY, triangles[i + 1]);
            loZ = Math.min(loZ, triangles[i + 2]);
            hiX = Math.max(hiX, triangles[i]);
            hiY = Math.max(hiY, triangles[i + 1]);
            hiZ = Math.max(hiZ, triangles[i + 2]);
        }
        if (count == 0) {
            return new RayGrid(new float[0], 0, 0, 0, cell, 1, 1, 1, new int[2], new int[0]);
        }
        int nx = Math.max(1, (int) Math.ceil((hiX - loX) / cell));
        int ny = Math.max(1, (int) Math.ceil((hiY - loY) / cell));
        int nz = Math.max(1, (int) Math.ceil((hiZ - loZ) / cell));
        int[] start = new int[nx * ny * nz + 1];
        // two passes: count each cell's triangles, then place them
        for (int pass = 0; pass < 2; pass++) {
            int[] fill = pass == 0 ? null : start.clone();
            int[] items = pass == 0 ? null : new int[start[start.length - 1]];
            for (int t = 0; t < count; t++) {
                int b = t * 9;
                int x0 = clamp((Math.min(triangles[b], Math.min(triangles[b + 3], triangles[b + 6])) - loX) / cell, nx);
                int x1 = clamp((Math.max(triangles[b], Math.max(triangles[b + 3], triangles[b + 6])) - loX) / cell, nx);
                int y0 = clamp((Math.min(triangles[b + 1], Math.min(triangles[b + 4], triangles[b + 7])) - loY) / cell, ny);
                int y1 = clamp((Math.max(triangles[b + 1], Math.max(triangles[b + 4], triangles[b + 7])) - loY) / cell, ny);
                int z0 = clamp((Math.min(triangles[b + 2], Math.min(triangles[b + 5], triangles[b + 8])) - loZ) / cell, nz);
                int z1 = clamp((Math.max(triangles[b + 2], Math.max(triangles[b + 5], triangles[b + 8])) - loZ) / cell, nz);
                for (int x = x0; x <= x1; x++) {
                    for (int y = y0; y <= y1; y++) {
                        for (int z = z0; z <= z1; z++) {
                            int c = (x * ny + y) * nz + z;
                            if (pass == 0) {
                                start[c + 1]++;
                            } else {
                                items[fill[c]++] = t;
                            }
                        }
                    }
                }
            }
            if (pass == 0) {
                for (int c = 0; c + 1 < start.length; c++) {
                    start[c + 1] += start[c];
                }
            } else {
                return new RayGrid(triangles.clone(), loX, loY, loZ, cell, nx, ny, nz, start, items);
            }
        }
        throw new IllegalStateException("unreachable");
    }

    /** The number of triangles in the grid. */
    public int triangles() {
        return tris.length / 9;
    }

    /**
     * The nearest {@code t} in {@code [0, maxT]} at which the ray {@code o + t·d}
     * hits a triangle (either side), or −1 if none does.
     */
    public double nearest(double ox, double oy, double oz, double dx, double dy, double dz, double maxT) {
        if (items.length == 0) {
            return -1.0;
        }
        // where the ray is inside the grid's box
        double[] span = clip(ox, oy, oz, dx, dy, dz, maxT);
        if (span == null) {
            return -1.0;
        }
        double t = span[0];
        double px = ox + dx * t;
        double py = oy + dy * t;
        double pz = oz + dz * t;
        int x = clamp((px - minX) / cell, nx);
        int y = clamp((py - minY) / cell, ny);
        int z = clamp((pz - minZ) / cell, nz);
        int stepX = dx > 0 ? 1 : -1;
        int stepY = dy > 0 ? 1 : -1;
        int stepZ = dz > 0 ? 1 : -1;
        double nextX = Math.abs(dx) < EPS ? Double.MAX_VALUE
                : (minX + (x + (dx > 0 ? 1 : 0)) * cell - ox) / dx;
        double nextY = Math.abs(dy) < EPS ? Double.MAX_VALUE
                : (minY + (y + (dy > 0 ? 1 : 0)) * cell - oy) / dy;
        double nextZ = Math.abs(dz) < EPS ? Double.MAX_VALUE
                : (minZ + (z + (dz > 0 ? 1 : 0)) * cell - oz) / dz;
        double deltaX = Math.abs(dx) < EPS ? Double.MAX_VALUE : cell / Math.abs(dx);
        double deltaY = Math.abs(dy) < EPS ? Double.MAX_VALUE : cell / Math.abs(dy);
        double deltaZ = Math.abs(dz) < EPS ? Double.MAX_VALUE : cell / Math.abs(dz);
        double best = Double.MAX_VALUE;
        while (true) {
            int c = (x * ny + y) * nz + z;
            for (int i = start[c]; i < start[c + 1]; i++) {
                double hit = hit(items[i], ox, oy, oz, dx, dy, dz);
                if (hit >= 0.0 && hit <= maxT && hit < best) {
                    best = hit;
                }
            }
            double exit = Math.min(nextX, Math.min(nextY, nextZ));
            if (best <= exit || exit > span[1]) {
                break;
            }
            if (nextX <= nextY && nextX <= nextZ) {
                x += stepX;
                nextX += deltaX;
                if (x < 0 || x >= nx) {
                    break;
                }
            } else if (nextY <= nextZ) {
                y += stepY;
                nextY += deltaY;
                if (y < 0 || y >= ny) {
                    break;
                }
            } else {
                z += stepZ;
                nextZ += deltaZ;
                if (z < 0 || z >= nz) {
                    break;
                }
            }
        }
        return best == Double.MAX_VALUE ? -1.0 : best;
    }

    /** {t in, t out} of the ray inside the grid's box within [0, maxT], or null if it misses. */
    private double[] clip(double ox, double oy, double oz, double dx, double dy, double dz, double maxT) {
        double lo = 0.0;
        double hi = maxT;
        double[] o = {ox, oy, oz};
        double[] d = {dx, dy, dz};
        double[] min = {minX, minY, minZ};
        double[] max = {minX + nx * cell, minY + ny * cell, minZ + nz * cell};
        for (int a = 0; a < 3; a++) {
            if (Math.abs(d[a]) < EPS) {
                if (o[a] < min[a] || o[a] > max[a]) {
                    return null;
                }
                continue;
            }
            double t0 = (min[a] - o[a]) / d[a];
            double t1 = (max[a] - o[a]) / d[a];
            lo = Math.max(lo, Math.min(t0, t1));
            hi = Math.min(hi, Math.max(t0, t1));
            if (lo > hi) {
                return null;
            }
        }
        return new double[]{lo, hi};
    }

    /** Möller–Trumbore: t of the ray's hit on triangle {@code t}, or −1. */
    private double hit(int t, double ox, double oy, double oz, double dx, double dy, double dz) {
        int b = t * 9;
        double ax = tris[b];
        double ay = tris[b + 1];
        double az = tris[b + 2];
        double e1x = tris[b + 3] - ax;
        double e1y = tris[b + 4] - ay;
        double e1z = tris[b + 5] - az;
        double e2x = tris[b + 6] - ax;
        double e2y = tris[b + 7] - ay;
        double e2z = tris[b + 8] - az;
        double px = dy * e2z - dz * e2y;
        double py = dz * e2x - dx * e2z;
        double pz = dx * e2y - dy * e2x;
        double det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1.0e-12) {
            return -1.0; // the ray runs along the triangle
        }
        double inv = 1.0 / det;
        double sx = ox - ax;
        double sy = oy - ay;
        double sz = oz - az;
        double u = (sx * px + sy * py + sz * pz) * inv;
        if (u < -EPS || u > 1.0 + EPS) {
            return -1.0;
        }
        double qx = sy * e1z - sz * e1y;
        double qy = sz * e1x - sx * e1z;
        double qz = sx * e1y - sy * e1x;
        double v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < -EPS || u + v > 1.0 + EPS) {
            return -1.0;
        }
        double hit = (e2x * qx + e2y * qy + e2z * qz) * inv;
        return hit >= 0.0 ? hit : -1.0;
    }

    private static int clamp(double cellCoord, int n) {
        return Math.clamp((int) Math.floor(cellCoord), 0, n - 1);
    }
}
