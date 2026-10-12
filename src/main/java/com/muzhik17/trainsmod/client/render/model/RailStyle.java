package com.muzhik17.trainsmod.client.render.model;

import java.util.List;

import com.muzhik17.trainsmod.path.SwitchThroat;

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
 * @param blades     its switch blades' profile, or null if its rail objects
 *                   are no running rails — its switches then draw as plain
 *                   track (SPEC §2.2 v1)
 */
public record RailStyle(String id, List<Part> parts, double tileLength, Blades blades) {

    /**
     * The tile's faces using one texture: {@code full} is everything,
     * {@code base} all but the rail objects ({@code RAIL_LEFT}/{@code RAIL_RIGHT}
     * — sleepers, ballast, a bridge: what a switch blade never bends), and
     * {@code plusRails}/{@code minusRails} the rail objects' faces at local
     * z &gt; 0 / z &lt; 0 ({@link SwitchThroat#PLUS_Z}/{@link SwitchThroat#MINUS_Z}),
     * which a switch throat draws apart — one side of a leg bent into a
     * blade (SPEC §2.2 v1).
     */
    public record Part(ResourceLocation texture, Mesh full, Mesh base, Mesh plusRails, Mesh minusRails) {
    }

    /**
     * The railhead gauge faces (|z| of the heads' inner edges) of the
     * +z and −z running rails — where a blade lies against its stock rail
     * ({@link SwitchThroat#gaugeFace}).
     */
    public record Blades(double plusFace, double minusFace) {

        public double face(int side) {
            return side == SwitchThroat.PLUS_Z ? plusFace : minusFace;
        }
    }
}
