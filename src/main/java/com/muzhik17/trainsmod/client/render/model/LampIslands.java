package com.muzhik17.trainsmod.client.render.model;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Cabin lamps out of a glowing object (SPEC §8): an IR {@code FULLBRIGHT}
 * object is usually many separate lamps in one mesh (the platzkart's 22
 * ceiling lamps), so the mesh is split into islands of quads that share
 * vertex positions, and each big-enough island is a lamp at its centre. Tiny
 * islands — dial backlights, indicator dots — are no lamps. No JSON
 * coordinates needed.
 */
final class LampIslands {

    /** Islands smaller than this (bounding-box diagonal, blocks) aren't lamps. */
    static final float MIN_LAMP_SIZE = 0.3F;

    private LampIslands() {
    }

    /** The lamps of one glowing object's model-space mesh, all in light group {@code group}. */
    static List<StockModel.Lamp> of(Mesh mesh, int group) {
        List<Mesh.Quad> quads = mesh.quads();
        int[] parent = new int[quads.size()];
        for (int i = 0; i < parent.length; i++) {
            parent[i] = i;
        }
        Map<Long, Integer> firstQuadAt = new HashMap<>();
        for (int i = 0; i < quads.size(); i++) {
            Mesh.Quad q = quads.get(i);
            for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                Integer other = firstQuadAt.putIfAbsent(key(v), i);
                if (other != null) {
                    union(parent, i, other);
                }
            }
        }
        Map<Integer, float[]> boxes = new HashMap<>();
        for (int i = 0; i < quads.size(); i++) {
            float[] box = boxes.computeIfAbsent(find(parent, i), r -> new float[]{
                    Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE,
                    -Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE});
            Mesh.Quad q = quads.get(i);
            for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                box[0] = Math.min(box[0], v.x());
                box[1] = Math.min(box[1], v.y());
                box[2] = Math.min(box[2], v.z());
                box[3] = Math.max(box[3], v.x());
                box[4] = Math.max(box[4], v.y());
                box[5] = Math.max(box[5], v.z());
            }
        }
        List<StockModel.Lamp> lamps = new ArrayList<>();
        for (float[] box : boxes.values()) {
            float dx = box[3] - box[0];
            float dy = box[4] - box[1];
            float dz = box[5] - box[2];
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) >= MIN_LAMP_SIZE) {
                lamps.add(new StockModel.Lamp((box[0] + box[3]) * 0.5F, (box[1] + box[4]) * 0.5F,
                        (box[2] + box[5]) * 0.5F, group));
            }
        }
        return lamps;
    }

    private static long key(Mesh.Vertex v) {
        long x = Math.round(v.x() * 1.0e4F);
        long y = Math.round(v.y() * 1.0e4F);
        long z = Math.round(v.z() * 1.0e4F);
        return (x * 73856093L) ^ (y * 19349663L) ^ (z * 83492791L);
    }

    private static int find(int[] parent, int i) {
        while (parent[i] != i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    }

    private static void union(int[] parent, int a, int b) {
        int ra = find(parent, a);
        int rb = find(parent, b);
        if (ra != rb) {
            parent[ra] = rb;
        }
    }
}
