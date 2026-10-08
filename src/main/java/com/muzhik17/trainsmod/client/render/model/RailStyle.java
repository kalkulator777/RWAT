package com.muzhik17.trainsmod.client.render.model;

import java.util.List;

import net.minecraft.resources.ResourceLocation;

/**
 * One rail style (SPEC §6.10): the tile swept along every segment drawn in
 * it, split by texture — a style may use several (MVP's embankment track has
 * a rail atlas and a ballast map). The tile is in blocks, Y up, rails along
 * <b>X</b>, centred on x = 0 and repeated every {@code tileLength}; the gauge
 * runs along Z (the IR track model convention).
 *
 * @param id         the style id ({@code <ns>:<name>} of its declaration)
 * @param parts      the tile, one mesh per texture
 * @param tileLength repeat distance along X, blocks
 */
public record RailStyle(String id, List<Part> parts, double tileLength) {

    /**
     * The tile's faces using one texture: {@code full} is everything,
     * {@code railsOnly} drops the {@code RAIL_BASE} objects (sleepers,
     * ballast) — switch blades sweep that, so a diverging leg reads as bare
     * rails over the selected route's sleepers (SPEC §2.2 v1).
     */
    public record Part(ResourceLocation texture, Mesh full, Mesh railsOnly) {
    }
}
