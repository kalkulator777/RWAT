package com.muzhik17.trainsmod.client.render.model;

/**
 * The hardcoded v0 wagon: a box with a window band (SPEC §2.4, "box with
 * windows"). Built once into a {@link Mesh} so the renderer just emits it.
 * This generator is the swappable source — an {@code ObjLoader} would replace
 * it and produce the same {@link Mesh}.
 *
 * <p>Model space matches the renderer's body frame: x∈[−1,1] (sides), y∈[0,2]
 * (0 = bogie/rail height, up), z∈[−3,3] (+Z forward). Origin at the bottom
 * centre of the body, between the two bogies.
 */
public final class WagonModel {

    // body extents
    private static final float HX = 1.0F;   // half width
    private static final float Y0 = 0.05F;  // floor (just above the rail)
    private static final float Y1 = 2.0F;   // roof
    private static final float HZ = 3.0F;   // half length

    // colours (rgb, alpha 1)
    private static final float[] BODY = {0.46F, 0.12F, 0.12F};   // dark red sides
    private static final float[] ROOF = {0.26F, 0.07F, 0.07F};   // darker roof
    private static final float[] FLOOR = {0.18F, 0.18F, 0.20F};  // grey underside
    private static final float[] END = {0.52F, 0.15F, 0.15F};    // lighter ends
    private static final float[] WINDOW = {0.55F, 0.80F, 0.92F};  // light blue glass

    // window band along each long side
    private static final float WIN_Y0 = 0.95F;
    private static final float WIN_Y1 = 1.55F;
    private static final float WIN_HALF = 0.42F;             // half window width along z
    private static final float[] WIN_CENTERS = {-1.8F, -0.6F, 0.6F, 1.8F};
    private static final float WIN_OUT = 0.02F;              // protrude past the side to avoid z-fight

    /** The single shared, immutable wagon mesh. */
    public static final Mesh BODY_MESH = build();

    private WagonModel() {
    }

    private static Mesh build() {
        Mesh m = new Mesh();

        // --- body box (6 faces, outward normals) ---
        // +X right side
        face(m, HX, Y0, -HZ, HX, Y1, -HZ, HX, Y1, HZ, HX, Y0, HZ, new float[]{1, 0, 0}, BODY);
        // -X left side
        face(m, -HX, Y0, HZ, -HX, Y1, HZ, -HX, Y1, -HZ, -HX, Y0, -HZ, new float[]{-1, 0, 0}, BODY);
        // +Y roof
        face(m, -HX, Y1, -HZ, -HX, Y1, HZ, HX, Y1, HZ, HX, Y1, -HZ, new float[]{0, 1, 0}, ROOF);
        // -Y floor
        face(m, -HX, Y0, HZ, -HX, Y0, -HZ, HX, Y0, -HZ, HX, Y0, HZ, new float[]{0, -1, 0}, FLOOR);
        // +Z front
        face(m, HX, Y0, HZ, HX, Y1, HZ, -HX, Y1, HZ, -HX, Y0, HZ, new float[]{0, 0, 1}, END);
        // -Z back
        face(m, -HX, Y0, -HZ, -HX, Y1, -HZ, HX, Y1, -HZ, HX, Y0, -HZ, new float[]{0, 0, -1}, END);

        // --- window decals on both long sides ---
        for (float cz : WIN_CENTERS) {
            float z0 = cz - WIN_HALF;
            float z1 = cz + WIN_HALF;
            float xr = HX + WIN_OUT;
            float xl = -HX - WIN_OUT;
            face(m, xr, WIN_Y0, z0, xr, WIN_Y1, z0, xr, WIN_Y1, z1, xr, WIN_Y0, z1,
                    new float[]{1, 0, 0}, WINDOW);
            face(m, xl, WIN_Y0, z1, xl, WIN_Y1, z1, xl, WIN_Y1, z0, xl, WIN_Y0, z0,
                    new float[]{-1, 0, 0}, WINDOW);
        }

        return m;
    }

    private static void face(Mesh m,
            float x0, float y0, float z0, float x1, float y1, float z1,
            float x2, float y2, float z2, float x3, float y3, float z3,
            float[] normal, float[] rgb) {
        m.quad(new float[]{x0, y0, z0}, new float[]{x1, y1, z1},
                new float[]{x2, y2, z2}, new float[]{x3, y3, z3},
                normal, rgb[0], rgb[1], rgb[2], 1.0F);
    }
}
