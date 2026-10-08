package com.muzhik17.trainsmod.client.render;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.joml.Matrix4f;

import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.BufferBuilder;
import com.mojang.blaze3d.vertex.ByteBufferBuilder;
import com.mojang.blaze3d.vertex.MeshData;
import com.mojang.blaze3d.vertex.VertexBuffer;
import com.mojang.blaze3d.vertex.VertexFormat;
import com.muzhik17.trainsmod.client.render.model.Mesh;

import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.ShaderInstance;
import net.minecraft.client.renderer.texture.OverlayTexture;

/**
 * A {@link Mesh} baked once into a GPU vertex buffer and drawn with a single
 * call per frame (SPEC §2.4). The per-frame {@code VertexConsumer} path
 * re-transforms and re-uploads every vertex on the CPU each frame — fine for
 * vanilla-sized entity models, ruinous for a 17k-quad locomotive and hundreds
 * of rail tiles (the observed 110→35 FPS drop).
 *
 * <p>Light and overlay are baked per vertex at upload time, so a baked mesh is
 * valid for one packed-light value; the caller re-bakes when its light changes
 * (rare — a train outdoors keeps sky 15). Normals are baked in model space and
 * are not re-rotated per frame, so directional diffuse shading is fixed
 * relative to the model — a known, deliberate approximation.
 *
 * <p>Several meshes drawn together go through a {@link Batch}, which sets each
 * render type's state up once for all its meshes instead of once per mesh.
 */
public final class GpuMesh implements AutoCloseable {

    private final VertexBuffer buffer; // null = empty mesh, draw is a no-op
    private final RenderType type;
    private final int vertexCount;

    private GpuMesh(VertexBuffer buffer, RenderType type, int vertexCount) {
        this.buffer = buffer;
        this.type = type;
        this.vertexCount = vertexCount;
    }

    /** Bake one mesh at one light value. */
    public static GpuMesh upload(Mesh mesh, RenderType type, int packedLight) {
        return new Builder(type, VertexFormat.Mode.QUADS, mesh.quads().size() * 4)
                .add(mesh, packedLight).upload();
    }

    /** Bake one mesh with a light per vertex (SPEC §8: lamps, glowing parts). */
    public static GpuMesh upload(Mesh mesh, RenderType type, Mesh.VertexLight light) {
        Builder builder = new Builder(type, VertexFormat.Mode.QUADS, mesh.quads().size() * 4);
        mesh.emitRaw(builder.builder, light);
        return builder.upload();
    }

    /** Vertices in the buffer (0 for an empty mesh). */
    public int vertexCount() {
        return vertexCount;
    }

    /** Accumulates meshes (each with its own baked light) into one buffer. */
    public static final class Builder {
        private final RenderType type;
        private final ByteBufferBuilder bytes;
        private final BufferBuilder builder;

        /**
         * @param mode           primitive mode of the buffer — QUADS for
         *                       {@link Mesh} geometry, TRIANGLES for callers
         *                       that emit triangles directly (no degenerate
         *                       fourth vertex)
         * @param vertexCapacity initial size hint; the buffer grows as needed
         */
        public Builder(RenderType type, VertexFormat.Mode mode, int vertexCapacity) {
            this.type = type;
            this.bytes = new ByteBufferBuilder(
                    Math.max(vertexCapacity, 64) * type.format().getVertexSize());
            // the type's own format: NEW_ENTITY for entity types, BLOCK for the
            // terrain-shader rail type. Both take BufferBuilder's bulk vertex
            // path; BLOCK simply drops the overlay.
            this.builder = new BufferBuilder(bytes, mode, type.format());
        }

        /** Append a QUADS-mode mesh, untransformed, at one light value. */
        public Builder add(Mesh mesh, int packedLight) {
            mesh.emitRaw(builder, packedLight);
            return this;
        }

        /** Append one raw vertex (world/model space, packed ARGB colour). */
        public void vertex(float x, float y, float z, int argb, float u, float v,
                int packedLight, float nx, float ny, float nz) {
            builder.addVertex(x, y, z, argb, u, v, OverlayTexture.NO_OVERLAY, packedLight,
                    nx, ny, nz);
        }

        /** Upload to the GPU; must run on the render thread. */
        public GpuMesh upload() {
            MeshData data = builder.build(); // null if nothing was added
            VertexBuffer vertexBuffer = null;
            int vertices = 0;
            if (data != null) {
                vertices = data.drawState().vertexCount();
                vertexBuffer = new VertexBuffer(VertexBuffer.Usage.STATIC);
                vertexBuffer.bind();
                vertexBuffer.upload(data);
                VertexBuffer.unbind();
            }
            bytes.close();
            return new GpuMesh(vertexBuffer, type, vertices);
        }
    }

    /**
     * Draws collected over one pass, issued grouped by render type: each
     * type's state (shader, textures, lightmap…) is set up once for all its
     * meshes rather than per mesh. Opaque cutout geometry is order-independent,
     * so regrouping changes nothing on screen. Reusable — {@link #flush}
     * leaves it empty. Render thread only.
     *
     * <p>Each draw gets modelview = global MV × pose (the current
     * {@code PoseStack.last().pose()}) — exactly what the same vertices would
     * get through the CPU path, where the pose is applied per-vertex before
     * the global MV uniform.
     */
    public static final class Batch {

        private record Entry(GpuMesh mesh, Matrix4f modelView,
                float offsetX, float offsetY, float offsetZ) {
        }

        private final Map<RenderType, List<Entry>> byType = new LinkedHashMap<>();

        /** Queue a draw at {@code pose} (entity-shader types). */
        public void add(GpuMesh mesh, Matrix4f pose) {
            add(mesh, pose, 0.0F, 0.0F, 0.0F);
        }

        /**
         * Queue a draw with an explicit {@code ChunkOffset} (terrain-shader
         * types only; entity shaders have no such uniform and ignore it). The
         * terrain shader adds the offset to every vertex position <i>and</i>
         * computes fog from the sum — pass {@code −camera} with world-absolute
         * geometry and the fog is honestly camera-relative, exactly like
         * vanilla chunks. The modelview is captured now, so the draw lands
         * where it would have if issued immediately.
         */
        public void add(GpuMesh mesh, Matrix4f pose, float offsetX, float offsetY, float offsetZ) {
            if (mesh.buffer == null) {
                return;
            }
            Matrix4f modelView = new Matrix4f(RenderSystem.getModelViewMatrix()).mul(pose);
            byType.computeIfAbsent(mesh.type, t -> new ArrayList<>())
                    .add(new Entry(mesh, modelView, offsetX, offsetY, offsetZ));
        }

        /** Issue every queued draw, one render-state setup per type. */
        public void flush() {
            for (Map.Entry<RenderType, List<Entry>> group : byType.entrySet()) {
                List<Entry> entries = group.getValue();
                if (entries.isEmpty()) {
                    continue;
                }
                RenderType type = group.getKey();
                type.setupRenderState();
                ShaderInstance shader = RenderSystem.getShader();
                if (shader != null) {
                    for (Entry entry : entries) {
                        if (shader.CHUNK_OFFSET != null) {
                            shader.CHUNK_OFFSET.set(entry.offsetX, entry.offsetY, entry.offsetZ);
                        }
                        entry.mesh.buffer.bind();
                        entry.mesh.buffer.drawWithShader(entry.modelView,
                                RenderSystem.getProjectionMatrix(), shader);
                    }
                    VertexBuffer.unbind();
                    if (shader.CHUNK_OFFSET != null) {
                        shader.CHUNK_OFFSET.set(0.0F, 0.0F, 0.0F);
                    }
                }
                type.clearRenderState();
                entries.clear();
            }
        }
    }

    @Override
    public void close() {
        if (buffer != null) {
            buffer.close();
        }
    }
}
