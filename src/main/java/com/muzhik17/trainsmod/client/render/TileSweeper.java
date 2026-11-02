package com.muzhik17.trainsmod.client.render;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.path.SwitchThroat;
import com.muzhik17.trainsmod.path.TrackPath;
import com.muzhik17.trainsmod.path.TrackSweep;

/**
 * Lays a rail style's tile along a path for the {@link RailRenderer} (SPEC
 * §2.2 visual, §6.10): every copy of the tile is bent to the spline by the
 * {@link TrackSweep} rules the track bed rasterizes with, so there are no
 * gaps on bends. Pure — no MC imports, unit-tested; the renderer turns the
 * tiles into GPU meshes.
 */
final class TileSweeper {

    private TileSweeper() {
    }

    /**
     * One texture's share of a rail style tile, flattened for sweeping:
     * triangles (three vertices each), with each vertex tied to one of a
     * handful of along-track <i>stations</i> (distinct local X — 7 in MVP's
     * rail). Bending then samples the spline frame once per station, not
     * twice per vertex.
     */
    public static final class Template {
        /** What the renderer draws the tiles with (its render type) — opaque here. */
        final Object renderType;
        /** Repeat distance along the track, blocks (the style's tile length). */
        final double tileLength;
        /** Distinct along-tile fractions 0..1, one path frame each. */
        final double[] stations;
        final int[] station; // per vertex: index into stations
        final float[] y;     // per vertex: local height (up)
        final float[] z;     // per vertex: local cross-track (right)
        final float[] nx;    // per vertex: local normal, X = along
        final float[] ny;
        final float[] nz;
        final float[] u;
        final float[] v;
        final float[] rgba;  // per vertex: base colour, 4 floats
        /** Per vertex: the vertex whose bent normal shades it (its quad's first corner). */
        final int[] shadeFrom;
        final int vertexCount;

        /**
         * A template from its vertices, three per triangle, in tile space
         * (blocks, Y up, the rails along X, the tile centred on x = 0):
         * {@code position} and {@code normal} three floats each, {@code uv}
         * two, {@code rgba} four, {@code shadeFrom} the vertex whose normal
         * shades each one.
         */
        public Template(Object renderType, double tileLength, float[] position, float[] normal, float[] uv,
                float[] rgba, int[] shadeFrom) {
            this.renderType = renderType;
            this.tileLength = tileLength;
            this.vertexCount = shadeFrom.length;
            Map<Float, Integer> stationOf = new LinkedHashMap<>();
            station = new int[vertexCount];
            y = new float[vertexCount];
            z = new float[vertexCount];
            nx = new float[vertexCount];
            ny = new float[vertexCount];
            nz = new float[vertexCount];
            u = new float[vertexCount];
            v = new float[vertexCount];
            this.rgba = rgba.clone();
            this.shadeFrom = shadeFrom.clone();
            for (int i = 0; i < vertexCount; i++) {
                station[i] = stationOf.computeIfAbsent(position[i * 3], k -> stationOf.size());
                y[i] = position[i * 3 + 1];
                z[i] = position[i * 3 + 2];
                nx[i] = normal[i * 3];
                ny[i] = normal[i * 3 + 1];
                nz[i] = normal[i * 3 + 2];
                u[i] = uv[i * 2];
                v[i] = uv[i * 2 + 1];
            }
            stations = new double[stationOf.size()];
            for (Map.Entry<Float, Integer> entry : stationOf.entrySet()) {
                // 0..1 along the tile, which is centred on x = 0
                stations[entry.getValue()] = entry.getKey() / tileLength + 0.5;
            }
        }

        public Object renderType() {
            return renderType;
        }

        public int vertexCount() {
            return vertexCount;
        }
    }

    /**
     * One bent tile, compact: world positions plus a packed normal and baked
     * diffuse shade per vertex — UV and base colour stay in the shared
     * {@link Template} (~4 KB per tile, where a bent mesh of records was
     * ~22 KB, ~85 MB of heap for a 3800-block network). The geometry depends
     * only on the rail graph; {@code light} is the one field a relight may
     * touch (sampled one block above the tile centre). {@code bounds} is the
     * box of the bent vertices, {minX, minY, minZ, maxX, maxY, maxZ} — what
     * the tile really covers, however far its style reaches off the track
     * (a crossing's deck, a bridge's girders) and however a bend stretches it.
     */
    public static final class Tile {
        final Template template;
        final float[] xyz;
        /** Per vertex: normal as three signed bytes (bits 0–23) + shade 0–255 (bits 24–31). */
        final int[] normalShade;
        final double cx;
        final double cy;
        final double cz;
        final double[] bounds;
        /** {@link RailRegion#key} of the region holding the tile: the one its centre lies in. */
        final long regionKey;
        /** Packed light, -1 until sampled. */
        int light = -1;

        Tile(Template template, float[] xyz, int[] normalShade, Vector3d centre, double[] bounds) {
            this.template = template;
            this.xyz = xyz;
            this.normalShade = normalShade;
            this.cx = centre.x;
            this.cy = centre.y;
            this.cz = centre.z;
            this.bounds = bounds;
            this.regionKey = RailRegion.key(cx, cz);
        }

        /** World X of vertex {@code i}. */
        double x(int i) {
            return xyz[i * 3];
        }

        /** World Y of vertex {@code i}. */
        double y(int i) {
            return xyz[i * 3 + 1];
        }

        /** World Z of vertex {@code i}. */
        double z(int i) {
            return xyz[i * 3 + 2];
        }
    }

    // --- sweeping ---

    /**
     * A rail of a switch bent along its stretch, station by station: the
     * side it's on, its gauge face, and per station {floor, cut, shift,
     * drop} for {@link SwitchThroat#bend} (and the height).
     */
    public interface RailBend {

        int side();

        double gaugeFace();

        /** Fill {floor, cut, shift, drop} at {@code s} into the stretch. */
        void station(double s, double[] out, int offset);
    }

    /**
     * A contiguous stretch {@code [from, to]} of another path, re-parametrized
     * from zero — lets the sweep lay a switch throat's blade stretch apart.
     */
    public record SubPath(TrackPath inner, double from, double to) implements TrackPath {

        @Override
        public double length() {
            return to - from;
        }

        @Override
        public Vector3d samplePosition(double s) {
            return inner.samplePosition(from + s);
        }

        @Override
        public Vector3d sampleTangent(double s) {
            return inner.sampleTangent(from + s);
        }
    }

    /**
     * Repeat the tile along the path, bending each copy to the spline — laid
     * by the {@link TrackSweep} rules the track bed rasterizes with.
     */
    public static void sweep(Template template, TrackPath path, List<Tile> out) {
        sweep(template, path, null, out);
    }

    /** {@link #sweep(Template, TrackPath, List)} with every tile bent (a blade, a frog rail) unless null. */
    public static void sweep(Template template, TrackPath path, RailBend bend, List<Tile> out) {
        double length = path.length();
        if (length < 1.0e-6) {
            return;
        }
        int n = TrackSweep.tileCount(length, template.tileLength);
        double tileLen = length / n;
        for (int i = 0; i < n; i++) {
            Vector3d centre = path.samplePosition((i + 0.5) * tileLen);
            out.add(bendTile(template, i, tileLen, path, centre, bend));
        }
    }

    /** Sweep every template along the path. */
    public static void sweepAll(List<Template> templates, TrackPath path, List<Tile> out) {
        for (Template template : templates) {
            sweep(template, path, out);
        }
    }

    /** Light0/Light1 of {@code Lighting.setupLevel}, normalized. */
    private static final float[] DIFFUSE_LIGHT_0 = {0.16169F, 0.80845F, -0.56592F};
    private static final float[] DIFFUSE_LIGHT_1 = {-0.16169F, 0.80845F, 0.56592F};

    /**
     * The entity shader's {@code minecraft_mix_light} factor, baked at build
     * time: the terrain shader the rails draw with ignores normals (vanilla
     * bakes terrain shade the same way), so without this the rails would lose
     * the shading an entity shader would give them from the normals.
     */
    private static float diffuseShade(float nx, float ny, float nz) {
        float light0 = Math.max(0.0F,
                DIFFUSE_LIGHT_0[0] * nx + DIFFUSE_LIGHT_0[1] * ny + DIFFUSE_LIGHT_0[2] * nz);
        float light1 = Math.max(0.0F,
                DIFFUSE_LIGHT_1[0] * nx + DIFFUSE_LIGHT_1[1] * ny + DIFFUSE_LIGHT_1[2] * nz);
        return Math.min(1.0F, (light0 + light1) * 0.6F + 0.4F);
    }

    /**
     * Bend one copy of the tile onto the spline at tile index {@code i}: each
     * template station (local <b>X</b>, the rails' length) picks a distance
     * {@code s} along the path and gets the path frame there; a vertex's
     * local Z rides the frame's right axis (gauge) and local Y its up axis;
     * the normal is rotated into the same frame (local X→forward, Z→right,
     * Y→up). Diffuse shade is taken from each quad's first corner, as the
     * per-quad shading always was. A {@code bend} (a switch blade or frog rail)
     * reshapes each vertex's across and height at its station first. The
     * tile's bounds are taken over the bent vertices.
     */
    private static Tile bendTile(Template t, int tileIndex, double tileLen, TrackPath path,
            Vector3d centre, RailBend bend) {
        int stations = t.stations.length;
        double[] frame = new double[stations * TrackSweep.FRAME_STRIDE]; // pos, fwd, right, up
        double[] bent = bend == null ? null : new double[stations * 4]; // floor, cut, shift, drop
        for (int k = 0; k < stations; k++) {
            double s = (tileIndex + t.stations[k]) * tileLen;
            TrackSweep.frame(path, s, frame, k * TrackSweep.FRAME_STRIDE);
            if (bend != null) {
                bend.station(s, bent, k * 4);
            }
        }
        int n = t.vertexCount;
        float[] xyz = new float[n * 3];
        float[] normals = new float[n * 3];
        double[] bounds = {Double.POSITIVE_INFINITY, Double.POSITIVE_INFINITY, Double.POSITIVE_INFINITY,
                Double.NEGATIVE_INFINITY, Double.NEGATIVE_INFINITY, Double.NEGATIVE_INFINITY};
        for (int i = 0; i < n; i++) {
            int o = t.station[i] * TrackSweep.FRAME_STRIDE;
            double across = t.z[i]; // local Z is the cross-track (gauge) axis
            double height = t.y[i] + TrackSweep.RAIL_Y_OFFSET;
            if (bend != null) {
                int b = t.station[i] * 4;
                across = SwitchThroat.bend(across, bend.side(), bend.gaugeFace(), bent[b], bent[b + 1], bent[b + 2]);
                height -= bent[b + 3];
            }
            for (int axis = 0; axis < 3; axis++) {
                double world = frame[o + axis] + frame[o + 6 + axis] * across + frame[o + 9 + axis] * height;
                xyz[i * 3 + axis] = (float) world;
                bounds[axis] = Math.min(bounds[axis], world);
                bounds[axis + 3] = Math.max(bounds[axis + 3], world);
            }
            normals[i * 3] = (float) (frame[o + 3] * t.nx[i] + frame[o + 6] * t.nz[i] + frame[o + 9] * t.ny[i]);
            normals[i * 3 + 1] = (float) (frame[o + 4] * t.nx[i] + frame[o + 7] * t.nz[i] + frame[o + 10] * t.ny[i]);
            normals[i * 3 + 2] = (float) (frame[o + 5] * t.nx[i] + frame[o + 8] * t.nz[i] + frame[o + 11] * t.ny[i]);
        }
        int[] normalShade = new int[n];
        for (int i = 0; i < n; i++) {
            int src = t.shadeFrom[i] * 3;
            float shade = diffuseShade(normals[src], normals[src + 1], normals[src + 2]);
            normalShade[i] = packNormal(normals[i * 3]) | packNormal(normals[i * 3 + 1]) << 8
                    | packNormal(normals[i * 3 + 2]) << 16 | Math.round(shade * 255.0F) << 24;
        }
        if (n == 0) {
            bounds = new double[] {centre.x, centre.y, centre.z, centre.x, centre.y, centre.z};
        }
        return new Tile(t, xyz, normalShade, centre, bounds);
    }

    /** One normal component as a signed byte, quantized like BufferBuilder's. */
    private static int packNormal(float component) {
        return (int) (Math.clamp(component, -1.0F, 1.0F) * 127.0F) & 0xFF;
    }
}
