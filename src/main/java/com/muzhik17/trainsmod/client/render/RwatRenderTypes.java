package com.muzhik17.trainsmod.client.render;

import java.util.function.Function;

import com.mojang.blaze3d.vertex.DefaultVertexFormat;
import com.mojang.blaze3d.vertex.VertexFormat;

import net.minecraft.Util;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.resources.ResourceLocation;

/**
 * Custom render types (subclassing {@link RenderType} for shard access).
 *
 * <p>{@link #rails}: world-static baked geometry must NOT use an entity render
 * type — entity shaders compute fog from the raw vertex position (entities are
 * CPU-transformed to camera-relative space every frame, so for them it <i>is</i>
 * the camera distance). A static world-coordinate buffer fed to that shader
 * gets fog by distance from the world origin: track sections far from 0,0
 * drown in sky-coloured fog regardless of where the camera is. The terrain
 * shader (RENDERTYPE_CUTOUT) computes fog from {@code Position + ChunkOffset},
 * and the renderer passes {@code ChunkOffset = −camera} — true camera-relative
 * fog for world-absolute vertices, exactly how vanilla chunks do it. Trade-off:
 * the terrain shader ignores normals, so directional diffuse is baked into the
 * vertex colour at build time.
 *
 * <p>{@link #lightGlow}: the headlights' flares, beams and light on the track
 * (SPEC §8).
 */
public final class RwatRenderTypes extends RenderType {

    private static final Function<ResourceLocation, RenderType> RAILS = Util.memoize(
            texture -> create("rwat_rails",
                    DefaultVertexFormat.BLOCK, VertexFormat.Mode.QUADS, 1536, false, false,
                    CompositeState.builder()
                            .setShaderState(RENDERTYPE_CUTOUT_SHADER)
                            .setTextureState(new TextureStateShard(texture, false, false))
                            .setLightmapState(LIGHTMAP)
                            .setCullState(NO_CULL)
                            .createCompositeState(false)));

    private static final RenderType LIGHT_GLOW = create("rwat_light_glow",
            DefaultVertexFormat.POSITION_COLOR, VertexFormat.Mode.QUADS, 8192, false, false,
            CompositeState.builder()
                    .setShaderState(POSITION_COLOR_SHADER)
                    .setTransparencyState(LIGHTNING_TRANSPARENCY)
                    .setWriteMaskState(COLOR_WRITE)
                    .setDepthTestState(LEQUAL_DEPTH_TEST)
                    .setCullState(NO_CULL)
                    .createCompositeState(false));

    /**
     * Headlight flares, beams and track light (SPEC §8): flat vertex colour,
     * additive ({@code src·alpha + dst}), depth-tested but not depth-written,
     * both faces — light that adds to what is behind it. No texture, the soft
     * falloff is in the vertex alpha: a shader pack swaps a textured program
     * for one that discards alpha under 0.1 (it cut the faint beam away),
     * the plain-colour one only discards zero.
     */
    public static RenderType lightGlow() {
        return LIGHT_GLOW;
    }

    /**
     * Terrain-shader cutout with one rail style texture (SPEC §6.10): BLOCK
     * format, lightmap, no cull. One instance per texture, so meshes of the
     * same texture batch together.
     */
    public static RenderType rails(ResourceLocation texture) {
        return RAILS.apply(texture);
    }

    private RwatRenderTypes(String name, VertexFormat format, VertexFormat.Mode mode,
            int bufferSize, boolean affectsCrumbling, boolean sortOnUpload, Runnable setup,
            Runnable clear) {
        super(name, format, mode, bufferSize, affectsCrumbling, sortOnUpload, setup, clear);
        throw new UnsupportedOperationException("static shard holder, never instantiated");
    }
}
