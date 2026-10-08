package com.muzhik17.trainsmod.convention;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

/** A control's hinge from its {@code _ROT_} marker (SPEC §9.3), UMC's rule. */
class PivotAxisTest {

    private static final Path CHME3 = Path.of("run/rwat_packs/MatoiVanillaPack/assets/mvp/stock/"
            + "rolling_stock/locomotives/mvp_ir_chme3/mvp_ir_chme3.obj");

    @Test
    void rod_pointsAwayFromTheOrigin() {
        // a thin rod along X, its near end at x = 1: the axis runs to the far end, +X
        List<float[]> rod = List.of(
                new float[]{1, 0, 0}, new float[]{1, 0.01F, 0}, new float[]{3, 0, 0}, new float[]{3, 0.01F, 0});
        float[][] pa = PivotAxis.of(rod);
        assertEquals(2.0F, pa[0][0], 1.0e-6F);
        assertEquals(1.0F, pa[1][0], 1.0e-3F);
        // the same rod on the other side of the origin flips its axis
        List<float[]> mirrored = List.of(
                new float[]{-1, 0, 0}, new float[]{-1, 0.01F, 0}, new float[]{-3, 0, 0}, new float[]{-3, 0.01F, 0});
        assertEquals(-1.0F, PivotAxis.of(mirrored)[1][0], 1.0e-3F);
    }

    /** The real ChME3 markers (the pack is generated, not shipped — skipped without it). */
    @Test
    void chme3_leversTurnAboutTheVertical() throws IOException {
        assumeTrue(Files.exists(CHME3), "MVP pack not generated");
        Map<String, List<float[]>> markers = markers(CHME3);
        for (String lever : List.of("THROTTLE_1_ROT_-120_INTERIOR_LCG_IL_mvp_chme3",
                "REVERSER_1_ROT_-60_CG_RVR_mvp_chme3", "TRAIN_BRAKE_1_ROT_129_mvp_chme3")) {
            float[][] pa = PivotAxis.of(markers.get(lever));
            assertEquals(1.0F, pa[1][1], 1.0e-3F, lever + " axis +Y");
        }
        // the cab switches flip about X (front desk) — UMC's normal for that marker
        float[][] sw = PivotAxis.of(markers.get("WIDGET_6_ROT_80_INTERIOR_LCG_IL_mvp_chme3"));
        assertEquals(1.0F, Math.abs(sw[1][0]), 1.0e-3F);
    }

    /** Distinct vertex positions of every {@code _ROT_} object, in file order. */
    private static Map<String, List<float[]>> markers(Path obj) throws IOException {
        List<float[]> vertices = new ArrayList<>();
        Map<String, Set<Integer>> faces = new LinkedHashMap<>();
        String current = null;
        for (String line : Files.readAllLines(obj)) {
            if (line.startsWith("v ")) {
                String[] p = line.trim().split("\\s+");
                vertices.add(new float[]{Float.parseFloat(p[1]), Float.parseFloat(p[2]), Float.parseFloat(p[3])});
            } else if (line.startsWith("o ")) {
                current = line.substring(2).trim();
            } else if (line.startsWith("f ") && current != null && current.contains("_ROT_")) {
                Set<Integer> indices = faces.computeIfAbsent(current, k -> new LinkedHashSet<>());
                for (String token : line.trim().split("\\s+")) {
                    if (!token.equals("f")) {
                        indices.add(Integer.parseInt(token.split("/")[0]) - 1);
                    }
                }
            }
        }
        Map<String, List<float[]>> out = new LinkedHashMap<>();
        faces.forEach((name, indices) -> {
            Set<String> seen = new LinkedHashSet<>();
            List<float[]> points = new ArrayList<>();
            for (int i : indices) {
                float[] v = vertices.get(i);
                if (seen.add(v[0] + "," + v[1] + "," + v[2])) {
                    points.add(v);
                }
            }
            out.put(name, points);
        });
        return out;
    }
}
