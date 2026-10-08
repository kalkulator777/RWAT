package com.muzhik17.trainsmod.client.render;

import org.joml.Matrix4f;
import org.joml.Quaternionf;
import org.joml.Vector3f;

import com.mojang.blaze3d.vertex.VertexConsumer;
import com.muzhik17.trainsmod.client.render.model.StockModel;

import net.minecraft.client.renderer.LightTexture;

/**
 * The headlights' flare and beam (SPEC §8), drawn each frame for every lit
 * {@code HEADLIGHT} of a wagon — no texture, the falloff is vertex alpha
 * under additive blending ({@link RwatRenderTypes#lightGlow}).
 *
 * <ul>
 *   <li><b>Flare</b> — a disc facing the camera at the lens: a bright core,
 *       and a wide halo that grows the more you look into the lamp (gone from
 *       behind it), as IR's {@code LightFlare} does.</li>
 *   <li><b>Beam</b> — a soft band {@link #BEAM_LENGTH} blocks ahead, widening
 *       and fading to nothing at its end; it shows in the dark and washes out
 *       in daylight.</li>
 * </ul>
 */
final class LampEffects {

    static final float BEAM_LENGTH = 12.0F;
    private static final float BEAM_END_RADIUS = 1.6F;
    private static final float BEAM_ALPHA = 0.35F;
    /** The axis at the far end keeps this much of its light (the rest of the fade is the edges). */
    private static final float BEAM_END_FADE = 0.12F;
    private static final int DISC_SEGMENTS = 16;

    private LampEffects() {
    }

    /**
     * @param body       model space → camera-relative world (the body's pose, turned if flipped)
     * @param camera     the camera's orientation (billboards face it)
     * @param litMask    the model's lit light groups
     * @param packedLight the wagon's light (bright surroundings drown the beam)
     * @param dayLight   0 at night … 1 at noon
     */
    static void draw(VertexConsumer out, StockModel model, long litMask, Matrix4f body,
            Quaternionf camera, int packedLight, float dayLight) {
        float ambient = Math.max(LightTexture.block(packedLight),
                LightTexture.sky(packedLight) * dayLight) / 15.0F;
        float darkness = 1.0F - ambient;
        Vector3f centre = new Vector3f();
        Vector3f dir = new Vector3f();
        for (StockModel.Headlight lamp : model.headlights()) {
            if (!StockModel.tagLit(StockModel.tag(lamp.group(), false, false, false), litMask)) {
                continue;
            }
            body.transformPosition(lamp.x(), lamp.y(), lamp.z(), centre);
            body.transformDirection(0.0F, 0.0F, lamp.dirZ(), dir).normalize();
            float r = (lamp.rgb() >> 16 & 255) / 255.0F;
            float g = (lamp.rgb() >> 8 & 255) / 255.0F;
            float b = (lamp.rgb() & 255) / 255.0F;
            float radius = Math.max(lamp.radius(), 0.1F);
            // the camera is at the origin of camera-relative space
            float distance = centre.length();
            float facing = distance < 1.0e-3F ? 1.0F : -centre.dot(dir) / distance;
            if (darkness > 0.05F) {
                beam(out, centre, dir, radius, r, g, b, BEAM_ALPHA * darkness);
            }
            if (facing > 0.0F) {
                float glow = 0.35F + 0.65F * darkness;
                disc(out, centre, camera, radius * 1.4F, r, g, b, 0.85F * glow * (float) Math.sqrt(facing));
                float halo = facing * facing;
                disc(out, centre, camera, radius * (2.0F + 7.0F * halo), r, g, b, 0.45F * glow * halo);
            }
        }
    }

    /** A camera-facing disc, opaque-ish at the centre fading to nothing at the rim. */
    private static void disc(VertexConsumer out, Vector3f c, Quaternionf camera, float radius,
            float r, float g, float b, float alpha) {
        if (alpha < 0.01F) {
            return;
        }
        Vector3f right = camera.transform(new Vector3f(radius, 0.0F, 0.0F));
        Vector3f up = camera.transform(new Vector3f(0.0F, radius, 0.0F));
        for (int i = 0; i < DISC_SEGMENTS; i++) {
            double a0 = 2.0 * Math.PI * i / DISC_SEGMENTS;
            double a1 = 2.0 * Math.PI * (i + 1) / DISC_SEGMENTS;
            float c0 = (float) Math.cos(a0);
            float s0 = (float) Math.sin(a0);
            float c1 = (float) Math.cos(a1);
            float s1 = (float) Math.sin(a1);
            // a degenerate quad = one triangle of the fan
            out.addVertex(c.x, c.y, c.z).setColor(r, g, b, alpha);
            out.addVertex(c.x, c.y, c.z).setColor(r, g, b, alpha);
            out.addVertex(c.x + right.x * c0 + up.x * s0, c.y + right.y * c0 + up.y * s0,
                    c.z + right.z * c0 + up.z * s0).setColor(r, g, b, 0.0F);
            out.addVertex(c.x + right.x * c1 + up.x * s1, c.y + right.y * c1 + up.y * s1,
                    c.z + right.z * c1 + up.z * s1).setColor(r, g, b, 0.0F);
        }
    }

    /**
     * The beam as a soft band along its axis, turned to face the camera (a
     * cone's sides would add up into bright streaks along its silhouette):
     * brightest along the axis at the lens, fading to nothing at its edges
     * and its far end. Seen straight down the axis it vanishes — the flare
     * covers that view.
     */
    private static void beam(VertexConsumer out, Vector3f start, Vector3f dir, float startRadius,
            float r, float g, float b, float alpha) {
        Vector3f end = new Vector3f(dir).mul(BEAM_LENGTH).add(start);
        Vector3f mid = new Vector3f(start).add(end).mul(0.5F);
        Vector3f side = new Vector3f(dir).cross(mid);
        if (side.lengthSquared() < 1.0e-6F) {
            return;
        }
        side.normalize();
        // fainter the more end-on the band is seen (it narrows on screen)
        float across = new Vector3f(dir).cross(new Vector3f(mid).normalize()).length();
        float a = alpha * across;
        float aEnd = a * BEAM_END_FADE;
        // each half: edge (dark) → axis (lit) along the whole length, so both
        // triangles of the quad carry light; the axis fades toward the far end
        for (int half = -1; half <= 1; half += 2) {
            Vector3f s0 = new Vector3f(side).mul(half * startRadius).add(start);
            Vector3f s1 = new Vector3f(side).mul(half * BEAM_END_RADIUS).add(end);
            out.addVertex(start.x, start.y, start.z).setColor(r, g, b, a);
            out.addVertex(s0.x, s0.y, s0.z).setColor(r, g, b, 0.0F);
            out.addVertex(s1.x, s1.y, s1.z).setColor(r, g, b, 0.0F);
            out.addVertex(end.x, end.y, end.z).setColor(r, g, b, aEnd);
        }
    }
}
