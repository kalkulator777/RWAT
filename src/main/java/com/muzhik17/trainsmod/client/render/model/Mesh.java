package com.muzhik17.trainsmod.client.render.model;

import java.util.ArrayList;
import java.util.List;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;

import net.minecraft.client.renderer.texture.OverlayTexture;

/**
 * Geometry as data (SPEC §2.4): a flat list of coloured, lit quads in model
 * space, decoupled from where it came from. Today a hardcoded generator fills
 * it ({@link WagonModel}); tomorrow an {@code ObjLoader} or pack parser fills
 * the same {@link Mesh} and the renderer is untouched.
 *
 * <p>Built once and emitted every frame ("baked as data, not rebuilt per
 * frame") — the {@link EntityRenderer} only calls {@link #emit}.
 */
public final class Mesh {

    /** One model-space vertex: position, texture UV, normal (for diffuse shading). */
    public record Vertex(float x, float y, float z, float u, float v, float nx, float ny, float nz) {
    }

    /**
     * A flat-coloured quad (4 vertices, one rgba). {@code tag} is free for the
     * loader: the stock loader marks how the quad is lit (SPEC §8 — light
     * group, glows, lit by the cabin lamps); 0 = plain.
     */
    public record Quad(Vertex v0, Vertex v1, Vertex v2, Vertex v3, float r, float g, float b, float a,
            int tag) {

        public Quad(Vertex v0, Vertex v1, Vertex v2, Vertex v3, float r, float g, float b, float a) {
            this(v0, v1, v2, v3, r, g, b, a, 0);
        }
    }

    /** Per-vertex packed light for a bake (SPEC §8: lamps, glowing parts). */
    @FunctionalInterface
    public interface VertexLight {
        int light(Quad quad, Vertex vertex);
    }

    private final List<Quad> quads = new ArrayList<>();

    /** The quads, for consumers that transform geometry (e.g. sweeping a tile along a spline). */
    public List<Quad> quads() {
        return quads;
    }

    /** Append a pre-built quad (used by the sweeper that bends a source tile). */
    public Mesh add(Quad quad) {
        quads.add(quad);
        return this;
    }

    /** Copy another mesh's quads into this one (used to merge the .obj sub-objects into one tile). */
    public Mesh merge(Mesh other) {
        quads.addAll(other.quads);
        return this;
    }

    /**
     * This mesh cut across X at {@code planes} (ascending): every face is
     * split where it crosses a plane, its attributes interpolated, and comes
     * out as triangles (quads with the last corner repeated) — more stations
     * for a sweep that bends the tile finer than its own vertices are spaced
     * (a switch's blades and frog, SPEC §2.2 v1).
     */
    public Mesh slicedAlongX(float[] planes) {
        Mesh out = new Mesh();
        for (Quad q : quads) {
            boolean triangle = q.v2().equals(q.v3());
            slice(out, q, List.of(q.v0(), q.v1(), q.v2()), planes);
            if (!triangle) {
                slice(out, q, List.of(q.v2(), q.v3(), q.v0()), planes);
            }
        }
        return out;
    }

    /** One triangle of {@code owner}, clipped to each slab between the planes, fanned into triangles. */
    private static void slice(Mesh out, Quad owner, List<Vertex> triangle, float[] planes) {
        for (int k = 0; k <= planes.length; k++) {
            float lo = k == 0 ? Float.NEGATIVE_INFINITY : planes[k - 1];
            float hi = k == planes.length ? Float.POSITIVE_INFINITY : planes[k];
            List<Vertex> piece = clip(clip(triangle, lo, true), hi, false);
            for (int i = 1; i + 1 < piece.size(); i++) {
                out.add(new Quad(piece.get(0), piece.get(i), piece.get(i + 1), piece.get(i + 1),
                        owner.r(), owner.g(), owner.b(), owner.a(), owner.tag()));
            }
        }
    }

    /** The polygon's part with x ≥ {@code plane} ({@code above}) or x ≤ it (Sutherland–Hodgman). */
    private static List<Vertex> clip(List<Vertex> polygon, float plane, boolean above) {
        if (polygon.isEmpty() || Float.isInfinite(plane)) {
            return polygon;
        }
        List<Vertex> out = new ArrayList<>();
        for (int i = 0; i < polygon.size(); i++) {
            Vertex a = polygon.get(i);
            Vertex b = polygon.get((i + 1) % polygon.size());
            boolean aIn = above ? a.x() >= plane : a.x() <= plane;
            boolean bIn = above ? b.x() >= plane : b.x() <= plane;
            if (aIn) {
                out.add(a);
            }
            if (aIn != bIn) {
                float t = (plane - a.x()) / (b.x() - a.x());
                out.add(new Vertex(plane, lerp(a.y(), b.y(), t), lerp(a.z(), b.z(), t),
                        lerp(a.u(), b.u(), t), lerp(a.v(), b.v(), t),
                        lerp(a.nx(), b.nx(), t), lerp(a.ny(), b.ny(), t), lerp(a.nz(), b.nz(), t)));
            }
        }
        return out.size() >= 3 ? out : List.of();
    }

    private static float lerp(float a, float b, float t) {
        return a + (b - a) * t;
    }

    /**
     * Append a quad from four corners (any winding — the wagon render type is
     * no-cull) with a shared normal and colour. UVs map the corners to the unit
     * square; with the white wagon texture that just samples white, so the face
     * shows its raw colour times the light.
     */
    public Mesh quad(float[] c0, float[] c1, float[] c2, float[] c3, float[] n,
            float r, float g, float b, float a) {
        quads.add(new Quad(
                new Vertex(c0[0], c0[1], c0[2], 0.0F, 0.0F, n[0], n[1], n[2]),
                new Vertex(c1[0], c1[1], c1[2], 0.0F, 1.0F, n[0], n[1], n[2]),
                new Vertex(c2[0], c2[1], c2[2], 1.0F, 1.0F, n[0], n[1], n[2]),
                new Vertex(c3[0], c3[1], c3[2], 1.0F, 0.0F, n[0], n[1], n[2]),
                r, g, b, a));
        return this;
    }

    /** Emit every quad into the buffer at the current pose (SPEC §2.4 pipeline). */
    public void emit(PoseStack.Pose pose, VertexConsumer consumer, int packedLight) {
        for (Quad q : quads) {
            put(pose, consumer, q.v0(), q, packedLight);
            put(pose, consumer, q.v1(), q, packedLight);
            put(pose, consumer, q.v2(), q, packedLight);
            put(pose, consumer, q.v3(), q, packedLight);
        }
    }

    private static void put(PoseStack.Pose pose, VertexConsumer vc, Vertex vx, Quad q, int light) {
        vc.addVertex(pose, vx.x(), vx.y(), vx.z())
                .setColor(q.r(), q.g(), q.b(), q.a())
                .setUv(vx.u(), vx.v())
                .setOverlay(OverlayTexture.NO_OVERLAY)
                .setLight(light)
                .setNormal(pose, vx.nx(), vx.ny(), vx.nz());
    }

    /**
     * Emit every quad untransformed through the bulk vertex call — the bake
     * path into a GPU buffer, where the pose is applied at draw time. Same
     * bytes as {@link #emit} with an identity pose, minus the per-vertex
     * matrix multiplies (a 17k-quad model is ~70k vertices per bake).
     */
    public void emitRaw(VertexConsumer consumer, int packedLight) {
        for (Quad q : quads) {
            int color = argb(q.r(), q.g(), q.b(), q.a());
            putRaw(consumer, q.v0(), color, packedLight);
            putRaw(consumer, q.v1(), color, packedLight);
            putRaw(consumer, q.v2(), color, packedLight);
            putRaw(consumer, q.v3(), color, packedLight);
        }
    }

    /** {@link #emitRaw(VertexConsumer, int)} with a light per vertex. */
    public void emitRaw(VertexConsumer consumer, VertexLight light) {
        for (Quad q : quads) {
            int color = argb(q.r(), q.g(), q.b(), q.a());
            putRaw(consumer, q.v0(), color, light.light(q, q.v0()));
            putRaw(consumer, q.v1(), color, light.light(q, q.v1()));
            putRaw(consumer, q.v2(), color, light.light(q, q.v2()));
            putRaw(consumer, q.v3(), color, light.light(q, q.v3()));
        }
    }

    private static void putRaw(VertexConsumer vc, Vertex vx, int color, int light) {
        vc.addVertex(vx.x(), vx.y(), vx.z(), color, vx.u(), vx.v(),
                OverlayTexture.NO_OVERLAY, light, vx.nx(), vx.ny(), vx.nz());
    }

    /** Packed ARGB, quantized exactly like {@code VertexConsumer.setColor(float…)}. */
    public static int argb(float r, float g, float b, float a) {
        return (int) (a * 255.0F) << 24 | (int) (r * 255.0F) << 16
                | (int) (g * 255.0F) << 8 | (int) (b * 255.0F);
    }
}
