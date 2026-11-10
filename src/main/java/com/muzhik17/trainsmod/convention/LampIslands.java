package com.muzhik17.trainsmod.convention;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.muzhik17.trainsmod.stock.UnionFind;

/**
 * Cabin lamps out of a glowing object (SPEC §8): an IR {@code FULLBRIGHT}
 * object is usually many separate lamps in one mesh (the platzkart's 22
 * ceiling lamps), so the mesh is split into islands of faces that share
 * corner positions, and each big-enough island is a lamp at the centre of
 * its box. Tiny islands — dial backlights, indicator dots — are no lamps. No
 * JSON coordinates needed. {@link ModelParts} takes the islands of every
 * glowing part; which of them light the inside, it decides. Pure.
 *
 * <p>The rule, step by step, as a port has to follow it (all in {@code float}):
 * <ol>
 *   <li>a corner's position is its key rounded to 1e-4 blocks:
 *       {@code Math.round(c * 1e4f)} on each axis ({@code float} product, round
 *       half up); faces sharing a key are one island, through any chain of
 *       them;</li>
 *   <li>an island's box is the bounds of all its faces' corners;</li>
 *   <li>it is a lamp if the box's diagonal {@code sqrt(dx² + dy² + dz²)}
 *       ({@code float} squares and sum) is at least {@link #MIN_LAMP_SIZE};
 *       the lamp is at the box centre, {@code (min + max) * 0.5f};</li>
 *   <li>lamps come in the order of each island's first face.</li>
 * </ol>
 * The key is the rounded position itself, not a hash of it: the former
 * 64-bit multiply-and-XOR hash could take two far corners for one and join
 * their islands (no pack had such a pair), and a port could not repeat it
 * without 64-bit integers.
 *
 * <p>Ported: {@code editor/src/ports/lampIslands.ts}; golden:
 * {@code fixtures/golden/lamp_islands/}.
 */
public final class LampIslands {

    /** Islands smaller than this (bounding-box diagonal, blocks) aren't lamps. */
    public static final float MIN_LAMP_SIZE = 0.3F;

    private LampIslands() {
    }

    /** A corner position rounded to 1e-4 blocks: faces meeting at one are one island. */
    private record Key(int x, int y, int z) {
    }

    /**
     * The lamps of one glowing part, in its own frame.
     *
     * @param corners the part's faces, four corners each (a triangle repeats
     *                its last), {@code x, y, z} per corner in order — as
     *                {@code ObjLoader} reads them
     * @return each lamp's {@code {x, y, z}}, in the order of its island's first face
     */
    public static List<float[]> of(float[] corners) {
        int faces = corners.length / 12;
        int[] parent = UnionFind.of(faces);
        Map<Key, Integer> firstFaceAt = new HashMap<>();
        for (int i = 0; i < faces; i++) {
            for (int c = 0; c < 4; c++) {
                int at = i * 12 + c * 3;
                Integer other = firstFaceAt.putIfAbsent(key(corners[at], corners[at + 1], corners[at + 2]), i);
                if (other != null) {
                    UnionFind.union(parent, i, other);
                }
            }
        }
        // island root → its box, in the order of each island's first face
        Map<Integer, float[]> boxes = new LinkedHashMap<>();
        for (int i = 0; i < faces; i++) {
            float[] box = boxes.computeIfAbsent(UnionFind.find(parent, i), r -> new float[]{
                    Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE,
                    -Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE});
            for (int c = 0; c < 4; c++) {
                int at = i * 12 + c * 3;
                for (int axis = 0; axis < 3; axis++) {
                    box[axis] = Math.min(box[axis], corners[at + axis]);
                    box[axis + 3] = Math.max(box[axis + 3], corners[at + axis]);
                }
            }
        }
        List<float[]> lamps = new ArrayList<>();
        for (float[] box : boxes.values()) {
            float dx = box[3] - box[0];
            float dy = box[4] - box[1];
            float dz = box[5] - box[2];
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) >= MIN_LAMP_SIZE) {
                lamps.add(new float[]{(box[0] + box[3]) * 0.5F, (box[1] + box[4]) * 0.5F, (box[2] + box[5]) * 0.5F});
            }
        }
        return lamps;
    }

    private static Key key(float x, float y, float z) {
        return new Key(Math.round(x * 1.0e4F), Math.round(y * 1.0e4F), Math.round(z * 1.0e4F));
    }

}
