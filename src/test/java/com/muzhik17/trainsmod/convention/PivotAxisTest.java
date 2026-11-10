package com.muzhik17.trainsmod.convention;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.ObjLoader;

/** A control's hinge from its {@code _ROT_} marker (SPEC §9.3), IR's (UniversalModCore's) rule. */
class PivotAxisTest {

    private static final Path MVP = Path.of("run/rwat_packs/MatoiVanillaPack");
    private static final Path EXAMPLE = Path.of("run/rwat_packs/RwatExamplePack");
    private static final Path CHME3 = MVP.resolve("assets/mvp/stock/rolling_stock/locomotives/mvp_ir_chme3/mvp_ir_chme3.obj");
    /** The axis IR gives every MVP marker (a summary, no asset): see its $comment. */
    private static final String MVP_AXES = "/fixtures/mvp_pivot_axes.json";

    @Test
    void rod_pointsAwayFromTheOrigin() {
        // a thin rod along X, its near end at x = 1: the axis runs to the far end, +X
        List<float[]> rod = List.of(
                new float[]{1, 0, 0}, new float[]{1, 0.01F, 0}, new float[]{3, 0, 0}, new float[]{3, 0.01F, 0});
        double[][] pa = PivotAxis.of(rod);
        assertEquals(2.0, pa[0][0], 1.0e-6);
        assertEquals(1.0, pa[1][0], 1.0e-3);
        // the same rod on the other side of the origin flips its axis
        List<float[]> mirrored = List.of(
                new float[]{-1, 0, 0}, new float[]{-1, 0.01F, 0}, new float[]{-3, 0, 0}, new float[]{-3, 0.01F, 0});
        assertEquals(-1.0, PivotAxis.of(mirrored)[1][0], 1.0e-3);
        // a line of two points, either way round: from z = 1 (nearer the origin) to z = 2
        assertEquals(1.0, PivotAxis.of(List.of(new float[]{0, 1, 2}, new float[]{0, 1, 1}))[1][2], 1.0e-9);
        assertEquals(1.0, PivotAxis.of(List.of(new float[]{0, 1, 1}, new float[]{0, 1, 2}))[1][2], 1.0e-9);
    }

    /**
     * A box's corners are all equally far from its centre, so the first of them in
     * the file is end A and decides the sign: here a 0.0125 × 0.0125 × 0.0625 lever
     * marker along Z, seen from the origin across its length. IR (UniversalModCore)
     * takes the centre in double; the port once took it in float, and the rounding
     * made one corner "further" — the sign IR's tie gives flipped (38 MVP markers).
     */
    @Test
    void box_theFirstCornerDecides_inDouble() {
        float x0 = 3.691F;
        float x1 = 3.704F;
        float y0 = 2.916F;
        float y1 = 2.929F;
        float z0 = 0.498F;
        float z1 = 0.561F;
        List<float[]> box = List.of(new float[]{x0, y0, z1}, new float[]{x0, y0, z0}, new float[]{x1, y0, z0},
                new float[]{x1, y0, z1}, new float[]{x0, y1, z1}, new float[]{x1, y1, z1}, new float[]{x1, y1, z0},
                new float[]{x0, y1, z0});
        // A = (x0, y0, z1), B = (x1, y1, z0); A is nearer the origin: from A to B, −Z
        assertEquals(-1.0, PivotAxis.of(box)[1][2], 1.0e-9);
        // the same box written from (x0, y0, z0): A and B trade ends, +Z
        List<float[]> turned = new ArrayList<>(box);
        turned.add(0, turned.remove(1));
        assertEquals(1.0, PivotAxis.of(turned)[1][2], 1.0e-9);
    }

    /** Each position counts once, where it first comes: a triangle's repeated corner, a shared corner. */
    @Test
    void corners_eachPositionOnce_inFileOrder() {
        List<float[]> corners = List.of(new float[]{0, 0, 1}, new float[]{0, 0, 2}, new float[]{0, -0.0F, 2},
                new float[]{0, 0, 1}, new float[]{0, 0, 2});
        List<float[]> points = PivotAxis.points(corners);
        assertEquals(2, points.size());
        assertEquals(1.0F, points.get(0)[2]);
        assertEquals(1.0, PivotAxis.of(corners)[1][2], 1.0e-9);
        // one point: nothing to split, UMC's default normal
        assertEquals(1.0, PivotAxis.of(List.of(new float[]{1, 2, 3}))[1][2], 1.0e-9);
    }

    /** The real ChME3 markers (the pack is generated, not shipped — skipped without it). */
    @Test
    void chme3_leversTurnAboutTheVertical() throws IOException {
        assumeTrue(Files.exists(CHME3), "MVP pack not generated");
        Map<String, List<float[]>> markers = markers(CHME3);
        for (String lever : List.of("THROTTLE_1_ROT_-120_INTERIOR_LCG_IL_mvp_chme3",
                "REVERSER_1_ROT_-60_CG_RVR_mvp_chme3", "TRAIN_BRAKE_1_ROT_129_mvp_chme3")) {
            double[][] pa = PivotAxis.of(markers.get(lever));
            assertEquals(1.0, pa[1][1], 1.0e-3, lever + " axis +Y");
        }
        // the cab switches flip about X (front desk) — UMC's normal for that marker
        double[][] sw = PivotAxis.of(markers.get("WIDGET_6_ROT_80_INTERIOR_LCG_IL_mvp_chme3"));
        assertEquals(1.0, Math.abs(sw[1][0]), 1.0e-3);
    }

    /**
     * Every hinge marker of MVP gets the axis Immersive Railroading gives it, the
     * one the pack's ROT angles were set against — a summary computed by
     * simulating UniversalModCore's OBJ parser (skipped without the pack).
     */
    @Test
    void mvp_everyMarkerTurnsAsInIr() throws IOException {
        assumeTrue(Files.isDirectory(MVP), "MVP pack not generated");
        JsonObject summary;
        try (InputStream in = PivotAxisTest.class.getResourceAsStream(MVP_AXES)) {
            summary = JsonParser.parseString(new String(in.readAllBytes(), StandardCharsets.UTF_8)).getAsJsonObject();
        }
        int checked = 0;
        for (Path obj : objs(MVP)) {
            String file = MVP.relativize(obj).toString().replace('\\', '/');
            Map<String, List<float[]>> markers = markers(obj);
            JsonObject expected = summary.has(file) ? summary.getAsJsonObject(file) : new JsonObject();
            assertEquals(new TreeMap<>(expected.asMap()).keySet(), new TreeMap<>(markers).keySet(), file);
            for (Map.Entry<String, JsonElement> marker : expected.entrySet()) {
                JsonArray axis = marker.getValue().getAsJsonArray();
                double[] ours = PivotAxis.of(markers.get(marker.getKey()))[1];
                for (int i = 0; i < 3; i++) {
                    assertEquals(axis.get(i).getAsDouble(), ours[i], 2.0e-6, file + " " + marker.getKey());
                }
                checked++;
            }
        }
        assertEquals(336, checked, "MVP's hinge markers");
    }

    /**
     * The example pack draws every hinge marker as a line of two points
     * ({@code tools/gen_example_pack.py}, {@code line}): no tie, the axis runs
     * from the end nearer the origin to the other, as its ROT angles assume.
     */
    @Test
    void examplePack_everyMarkerIsALine_fromTheEndNearerTheOrigin() throws IOException {
        int checked = 0;
        for (Path obj : objs(EXAMPLE)) {
            for (Map.Entry<String, List<float[]>> marker : markers(obj).entrySet()) {
                List<float[]> points = PivotAxis.points(marker.getValue());
                assertEquals(2, points.size(), marker.getKey());
                float[] a = points.get(0);
                float[] b = points.get(1);
                boolean aNear = a[0] * a[0] + a[1] * a[1] + a[2] * a[2] <= b[0] * b[0] + b[1] * b[1] + b[2] * b[2];
                float[] near = aNear ? a : b;
                float[] far = aNear ? b : a;
                double[] axis = PivotAxis.of(marker.getValue())[1];
                double length = Math.sqrt(Math.pow(far[0] - near[0], 2) + Math.pow(far[1] - near[1], 2)
                        + Math.pow(far[2] - near[2], 2));
                for (int i = 0; i < 3; i++) {
                    assertEquals((far[i] - near[i]) / length, axis[i], 1.0e-6, marker.getKey());
                }
                checked++;
            }
        }
        assertTrue(checked >= 20, "the example pack's hinge markers: " + checked);
    }

    private static List<Path> objs(Path root) throws IOException {
        try (Stream<Path> files = Files.walk(root)) {
            return files.filter(p -> p.toString().endsWith(".obj")).sorted().toList();
        }
    }

    /**
     * The corners of every hinge marker object (a control's or a door leaf's
     * {@code …_ROT…}) in file order, as the model loader hands them to {@link PivotAxis}.
     */
    private static Map<String, List<float[]>> markers(Path obj) throws IOException {
        ObjLoader.Model model;
        try (InputStream in = Files.newInputStream(obj)) {
            model = ObjLoader.loadModel(in);
        }
        Map<String, List<float[]>> out = new LinkedHashMap<>();
        for (ObjLoader.Part part : model.parts()) {
            ObjectRole role = ObjectRole.parse(part.object());
            ObjectRole leaf = ObjectRole.door(part.object());
            if (!role.pivot() && !(leaf != null && leaf.pivot())) {
                continue;
            }
            List<float[]> corners = out.computeIfAbsent(part.object(), k -> new ArrayList<>());
            for (Mesh.Quad q : part.mesh().quads()) {
                for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                    corners.add(new float[]{v.x(), v.y(), v.z()});
                }
            }
        }
        return out;
    }
}
