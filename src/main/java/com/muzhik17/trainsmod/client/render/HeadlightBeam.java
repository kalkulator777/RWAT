package com.muzhik17.trainsmod.client.render;

/**
 * The shape of a headlight's light outside the car (SPEC §8), in the model
 * frame: one set of sizes for what {@link LampEffects} draws, for how far
 * {@code compat.LambDynLightsCompat} lights the world, and for the box
 * {@link WagonRenderer} keeps a car drawn by while its light may be in view
 * (M28: the light was culled with the car). Without Minecraft, so it can be
 * tested.
 */
public final class HeadlightBeam {

    /** The beam's haze reaches this far ahead of the lens, blocks. */
    public static final float LENGTH = 16.0F;
    /** The beam cone's radius at its far end, blocks. */
    public static final float END_RADIUS = 2.4F;
    /** A beam spot's rim over the cone radius where it sits: its falloff leaves ~half of it lit. */
    public static final float SPOT_SPREAD = 1.7F;
    /** Light on the track: from this far ahead of the lamp … */
    public static final float POOL_NEAR = 1.0F;
    /** … to this far, blocks … */
    public static final float POOL_FAR = 22.0F;
    /** … and this wide each side of the lamp. */
    public static final float POOL_HALF_WIDTH = 2.6F;
    /** Height of the track light in the model frame: just above the railheads (0.406). */
    public static final float POOL_Y = 0.45F;
    /** A lens is drawn at least this big, blocks of radius. */
    public static final float MIN_RADIUS = 0.1F;
    /** The flare's core, in lens radii. */
    public static final float FLARE_CORE = 1.6F;
    /** The flare's halo, in lens radii: this much from the side … */
    public static final float FLARE_HALO = 3.0F;
    /** … and up to this much more looking straight into the lamp. */
    public static final float FLARE_HALO_GROWTH = 10.0F;
    /** The flare is drawn up to this far in front of the lens, toward the camera, blocks. */
    public static final float FLARE_PULL = 0.5F;

    private HeadlightBeam() {
    }

    /**
     * {@code box} — {minX, minY, minZ, maxX, maxY, maxZ}, model frame, or
     * null for none yet — grown to hold all the light of a lamp at
     * ({@code x}, {@code y}, {@code z}) shining along {@code dirZ} (+1 ahead,
     * −1 back) with a lens of {@code radius}: its flare, its beam with the
     * spots' rims, and its light on the track.
     *
     * @return the box (a new one if {@code box} was null)
     */
    public static float[] reach(float x, float y, float z, float dirZ, float radius, float[] box) {
        float[] out = box != null ? box : new float[]{
            Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};
        float ahead = dirZ < 0.0F ? -1.0F : 1.0F;
        float lens = Math.max(radius, MIN_RADIUS);
        grow(out, x, y, z, lens * (FLARE_HALO + FLARE_HALO_GROWTH) + FLARE_PULL);
        // the beam's spots widen from the lens to its far end: the box of the two end ones holds them all
        grow(out, x, y, z, lens * SPOT_SPREAD);
        grow(out, x, y, z + ahead * LENGTH, END_RADIUS * SPOT_SPREAD);
        for (float side : new float[]{-POOL_HALF_WIDTH, POOL_HALF_WIDTH}) {
            grow(out, x + side, POOL_Y, z + ahead * POOL_NEAR, 0.0F);
            grow(out, x + side, POOL_Y, z + ahead * POOL_FAR, 0.0F);
        }
        return out;
    }

    /** Grow {@code box} to hold a ball of radius {@code r} round a point. */
    private static void grow(float[] box, float x, float y, float z, float r) {
        box[0] = Math.min(box[0], x - r);
        box[1] = Math.min(box[1], y - r);
        box[2] = Math.min(box[2], z - r);
        box[3] = Math.max(box[3], x + r);
        box[4] = Math.max(box[4], y + r);
        box[5] = Math.max(box[5], z + r);
    }
}
