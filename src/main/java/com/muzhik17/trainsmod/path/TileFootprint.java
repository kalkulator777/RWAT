package com.muzhik17.trainsmod.path;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * A rail style's tile as the track bed sees it (SPEC §2.2, §6.10): the drawn
 * triangles in tile space — blocks, Y up, rails along X, the tile centred on
 * x = 0 and repeated every {@link #tileLength()}, gauge along Z (the IR track
 * convention) — positions only. {@link BedRaster} sweeps it with
 * {@link TrackSweep} exactly the way the renderer sweeps the textured tile.
 *
 * <p>{@link #fromObj} reads the very OBJ the client draws, by the client's
 * rules: objects named {@code …HIDE…} are not drawn, quads split into
 * (0,1,2)+(2,3,0), other faces fan from their first corner, and the rail
 * objects ({@link #isRailObject}) are stretched along X to fill the tile end
 * to end ({@link #railStretch}). One difference: faces of a material without a
 * texture count here, where the client skips them — the packs have none, and
 * the bed shouldn't hinge on texture files.
 *
 * <p>Pure, no MC imports (SPEC principle #4).
 */
public final class TileFootprint {

    final double tileLength;
    /** Distinct along-tile fractions {@code x / tileLength + 0.5}, one bend frame each. */
    final double[] stations;
    /** Per vertex (three per triangle): index into {@link #stations}. */
    final int[] station;
    /** Per vertex: local height (up). */
    final float[] y;
    /** Per vertex: local cross-track offset (right). */
    final float[] z;
    final int triangleCount;
    /** Farthest a bent vertex gets from its station's path point: max √(y² + z²). */
    final double reach;
    /** Farthest a vertex gets from the tile centre along the track: max |x|. */
    final double extent;

    private TileFootprint(double tileLength, float[] triangles) {
        if (!(tileLength > 0.0)) {
            throw new IllegalArgumentException("tile length must be positive: " + tileLength);
        }
        this.tileLength = tileLength;
        int vertexCount = triangles.length / 3;
        this.triangleCount = vertexCount / 3;
        this.station = new int[vertexCount];
        this.y = new float[vertexCount];
        this.z = new float[vertexCount];
        // stations keyed like the renderer's: one per distinct local X, in vertex order
        Map<Float, Integer> stationOf = new LinkedHashMap<>();
        double maxReach = 0.0;
        double maxExtent = 0.0;
        for (int v = 0; v < vertexCount; v++) {
            float x = triangles[v * 3];
            station[v] = stationOf.computeIfAbsent(x, k -> stationOf.size());
            y[v] = triangles[v * 3 + 1];
            z[v] = triangles[v * 3 + 2];
            maxReach = Math.max(maxReach, Math.sqrt((double) y[v] * y[v] + (double) z[v] * z[v]));
            maxExtent = Math.max(maxExtent, Math.abs(x));
        }
        this.reach = maxReach;
        this.extent = maxExtent;
        this.stations = new double[stationOf.size()];
        for (Map.Entry<Float, Integer> entry : stationOf.entrySet()) {
            stations[entry.getValue()] = entry.getKey() / tileLength + 0.5;
        }
    }

    /**
     * A tile from its triangles: nine floats — x, y, z of three corners — per
     * triangle, tile space.
     */
    public static TileFootprint of(double tileLength, float[] triangles) {
        if (triangles.length % 9 != 0) {
            throw new IllegalArgumentException("9 floats per triangle, got " + triangles.length);
        }
        return new TileFootprint(tileLength, triangles.clone());
    }

    /**
     * A tile of solid boxes {@code {x0, y0, z0, x1, y1, z1}}, tile space: each
     * contributes its bottom and top faces — all of a box the bed sees.
     */
    public static TileFootprint ofBoxes(double tileLength, float[]... boxes) {
        List<float[]> corners = new ArrayList<>();
        for (float[] box : boxes) {
            for (float level : new float[] {box[1], box[4]}) {
                float[] a = {box[0], level, box[2]};
                float[] b = {box[3], level, box[2]};
                float[] c = {box[3], level, box[5]};
                float[] d = {box[0], level, box[5]};
                addTriangle(corners, a, b, c);
                addTriangle(corners, c, d, a);
            }
        }
        return new TileFootprint(tileLength, flatten(corners));
    }

    /**
     * The tile of a rail style's OBJ (UTF-8): {@code v}, {@code o}/{@code g} and
     * {@code f} lines, positive 1-based indices (like the client loader, which
     * rejects anything else — a model it can't draw must not lay a bed either).
     *
     * @throws IOException if the file can't be read or a face is malformed
     */
    public static TileFootprint fromObj(InputStream in, double tileLength) throws IOException {
        List<float[]> positions = new ArrayList<>();
        List<int[]> faces = new ArrayList<>();
        List<String> faceObjects = new ArrayList<>();
        String object = "default";
        BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        String line;
        while ((line = reader.readLine()) != null) {
            line = line.trim();
            if (line.isEmpty() || line.charAt(0) == '#') {
                continue;
            }
            String[] t = line.split("\\s+");
            switch (t[0]) {
                case "v" -> positions.add(new float[] {
                        Float.parseFloat(t[1]), Float.parseFloat(t[2]), Float.parseFloat(t[3])});
                case "o", "g" -> object = t.length > 1 ? t[1] : "default";
                case "f" -> {
                    int[] face = new int[t.length - 1];
                    for (int i = 0; i < face.length; i++) {
                        int index = Integer.parseInt(t[i + 1].split("/")[0]) - 1;
                        if (index < 0 || index >= positions.size()) {
                            throw new IOException("face refers to a missing vertex: " + line);
                        }
                        face[i] = index;
                    }
                    faces.add(face);
                    faceObjects.add(object);
                }
                default -> { /* vt, vn, usemtl, s… — nothing the bed needs */ }
            }
        }

        // the rails' along-track extent: over every rail object, hidden ones too (as the client does)
        float minX = Float.POSITIVE_INFINITY;
        float maxX = Float.NEGATIVE_INFINITY;
        for (int f = 0; f < faces.size(); f++) {
            if (isRailObject(faceObjects.get(f))) {
                for (int index : faces.get(f)) {
                    minX = Math.min(minX, positions.get(index)[0]);
                    maxX = Math.max(maxX, positions.get(index)[0]);
                }
            }
        }
        float[] stretch = railStretch(maxX > minX ? new float[] {minX, maxX} : null, tileLength);

        List<float[]> corners = new ArrayList<>();
        for (int f = 0; f < faces.size(); f++) {
            String name = faceObjects.get(f);
            if (isHiddenObject(name)) {
                continue;
            }
            boolean rail = stretch != null && isRailObject(name);
            int[] face = faces.get(f);
            float[][] v = new float[face.length][];
            for (int i = 0; i < face.length; i++) {
                float[] p = positions.get(face[i]);
                v[i] = new float[] {rail ? stretchX(p[0], stretch) : p[0], p[1], p[2]};
            }
            if (v.length == 4) {
                addTriangle(corners, v[0], v[1], v[2]);
                addTriangle(corners, v[2], v[3], v[0]);
            } else {
                for (int i = 1; i < v.length - 1; i++) {
                    addTriangle(corners, v[0], v[i], v[i + 1]);
                }
            }
        }
        return new TileFootprint(tileLength, flatten(corners));
    }

    /** Repeat distance along the track, blocks. */
    public double tileLength() {
        return tileLength;
    }

    public int triangleCount() {
        return triangleCount;
    }

    /** Farthest any part of the tile gets from the track axis (across and up), blocks. */
    public double reach() {
        return reach;
    }

    /** Farthest any part of the tile gets from its centre along the track, blocks. */
    public double extent() {
        return extent;
    }

    // --- the tile conventions shared with the client's rail model loader (SPEC §6.10) ---

    /** A rail object: {@code RAIL_LEFT*}/{@code RAIL_RIGHT*} — not the {@code RAIL_BASE} sleepers. */
    public static boolean isRailObject(String object) {
        String name = object.toUpperCase(Locale.ROOT);
        return name.startsWith("RAIL_") && !name.contains("BASE");
    }

    /** Objects named {@code …HIDE…} are not drawn (the IR convention). */
    public static boolean isHiddenObject(String object) {
        return object.contains("HIDE");
    }

    /**
     * The along-track stretch that makes the rails span the tile
     * {@code [-tileLength/2, tileLength/2]} end to end — {@code {min, scale,
     * shift}} for {@link #stretchX} — or null if no stretch is needed: no
     * rails ({@code railExtent} null), or already one tile long and centred
     * (the IR norm).
     *
     * @param railExtent {min, max} local X over all rail objects, or null
     */
    public static float[] railStretch(float[] railExtent, double tileLength) {
        if (railExtent == null || Math.abs((railExtent[1] - railExtent[0]) - tileLength) < 1.0e-4
                && Math.abs(railExtent[0] + tileLength / 2.0) < 1.0e-4) {
            return null;
        }
        float scale = (float) (tileLength / (railExtent[1] - railExtent[0]));
        float shift = (float) (-tileLength / 2.0);
        return new float[] {railExtent[0], scale, shift};
    }

    /** A rail vertex's local X under a {@link #railStretch}. */
    public static float stretchX(float x, float[] stretch) {
        return (x - stretch[0]) * stretch[1] + stretch[2];
    }

    private static void addTriangle(List<float[]> corners, float[] a, float[] b, float[] c) {
        corners.add(a);
        corners.add(b);
        corners.add(c);
    }

    private static float[] flatten(List<float[]> corners) {
        float[] out = new float[corners.size() * 3];
        for (int i = 0; i < corners.size(); i++) {
            out[i * 3] = corners.get(i)[0];
            out[i * 3 + 1] = corners.get(i)[1];
            out[i * 3 + 2] = corners.get(i)[2];
        }
        return out;
    }
}
