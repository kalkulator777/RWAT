package com.muzhik17.trainsmod.client.render.model;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.joml.Matrix4f;

/**
 * Reader for Immersive Railroading {@code .anim} files (SPEC §5.2 / v1.5
 * doors): baked Blender keyframes for a group of OBJ objects that move
 * together — a door's leaf, its handles and the step trap under it.
 *
 * <p>Format, line-based: {@code O <object>} starts an object's track,
 * {@code A <action>} names its Blender action (ignored), then one
 * {@code M m00,m01,…,m33} line per frame — the object's transform at that
 * frame <b>relative to its rest pose</b> (frame 0 is identity), row-major,
 * translation in the last column, in the OBJ's own Y-up space. The tracks of
 * one file are equally long; the frame count spans the whole motion.
 *
 * <p>No MC imports: parsing and the change of space are unit-tested against
 * the real asset.
 */
public final class IrAnim {

    /**
     * The model-space rotation the IR loader applies ({@link IrStockModel}):
     * source (x, y, z) → model (z, y, −x), +90° about Y. Column-major.
     */
    private static final Matrix4f SOURCE_TO_MODEL_ROTATION = new Matrix4f(
            0.0F, 0.0F, -1.0F, 0.0F,
            0.0F, 1.0F, 0.0F, 0.0F,
            1.0F, 0.0F, 0.0F, 0.0F,
            0.0F, 0.0F, 0.0F, 1.0F);

    private IrAnim() {
    }

    /** Object name → its frames, each a row-major 4×4 as written in the file. */
    public static Map<String, List<float[]>> parse(InputStream in) throws IOException {
        Map<String, List<float[]>> tracks = new LinkedHashMap<>();
        List<float[]> current = null;
        BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        String line;
        while ((line = reader.readLine()) != null) {
            line = line.trim();
            if (line.startsWith("O ")) {
                current = tracks.computeIfAbsent(line.substring(2).trim(), k -> new ArrayList<>());
            } else if (line.startsWith("M ") && current != null) {
                String[] values = line.substring(2).split(",");
                if (values.length != 16) {
                    throw new IOException("anim frame with " + values.length + " values, expected 16");
                }
                float[] m = new float[16];
                for (int i = 0; i < 16; i++) {
                    m[i] = Float.parseFloat(values[i].trim());
                }
                current.add(m);
            }
        }
        return tracks;
    }

    /**
     * One frame in the render model's space: the source-space transform
     * {@code M} conjugated by the loader's placement {@code P} (the +90° turn
     * and the {@code yLift}): {@code P · M · P⁻¹}. Applied to model-space
     * vertices (already placed by {@code P}) it moves them exactly as
     * {@code M} moves the raw OBJ vertices.
     */
    public static Matrix4f toModelSpace(float[] rowMajor, float yLift) {
        Matrix4f place = new Matrix4f().translation(0.0F, yLift, 0.0F).mul(SOURCE_TO_MODEL_ROTATION);
        Matrix4f frame = new Matrix4f().set(rowMajor).transpose(); // JOML reads column-major
        return new Matrix4f(place).mul(frame).mul(new Matrix4f(place).invert());
    }
}
