package com.muzhik17.trainsmod.client.render;

import java.util.Arrays;

import org.joml.Matrix4f;
import org.joml.Quaternionf;
import org.joml.Vector3f;

import com.mojang.blaze3d.vertex.VertexConsumer;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.compat.IrisCompat;

import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.LightTexture;
import net.minecraft.client.renderer.MultiBufferSource;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.RenderFrameEvent;
import net.neoforged.neoforge.client.event.RenderLevelStageEvent;

/**
 * The headlights' light outside the car (SPEC §8), built each frame for
 * every lit {@code HEADLIGHT} of a wagon from soft round spots — fans whose
 * vertex alpha falls from the centre to nothing at the rim — under additive
 * blending ({@link RwatRenderTypes#lightGlow}):
 *
 * <ul>
 *   <li><b>Flare</b> — spots facing the camera at the lens: a bright core,
 *       and a wide halo that grows the more you look into the lamp (gone from
 *       behind it), as IR's {@code LightFlare} does.</li>
 *   <li><b>Beam</b> — a soft cone of haze {@link #BEAM_LENGTH} blocks ahead,
 *       drawn as camera-facing spots strung along the axis, each as wide as
 *       the cone there and spaced by a fraction of that width. Spots add up
 *       like light scattered along a sight line through the cone: brightest
 *       on the axis, soft at the edges, and right from any side — from the
 *       cab, looking down the beam, the spots stack into the glow ahead (a
 *       flat band vanished edge-on there). Each spot dims as the cone widens
 *       (the same light over a wider section) and toward the far end.</li>
 *   <li><b>Light on the track</b> — a long soft spot lying just above the
 *       railheads ahead of the lamp, so the line ahead shows lit up.</li>
 * </ul>
 * All of it shows in the dark and washes out in daylight or under lamps.
 *
 * <p><b>When it is drawn:</b> wagons are entities, but the glow is queued
 * during the entity pass and drawn later, with the camera-relative positions
 * it was queued with and the level's view rotation:
 * <ul>
 *   <li>vanilla — after translucent terrain and particles ({@link
 *       RenderLevelStageEvent.Stage#AFTER_PARTICLES}), depth-tested against
 *       the scene, so water and glass in front hide it;</li>
 *   <li>with a shader pack (Iris) — after the whole level ({@link
 *       RenderLevelStageEvent.Stage#AFTER_LEVEL}), onto the pack's finished
 *       image, still depth-tested. Anything drawn inside the level goes
 *       through the pack's programs, and they broke it every way (play-test,
 *       Photon): the sky, composed after the opaque passes, painted over
 *       light drawn with the entities; textured light was alpha-tested away
 *       below 0.1 and blended as plain alpha (black squares); untextured
 *       spots came out as hard stars. And the shadow pass draws entities
 *       again, facing the sun — nothing is queued then.</li>
 * </ul>
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class LampEffects {

    static final float BEAM_LENGTH = 16.0F;
    /** The cone's radius at its far end, blocks. */
    private static final float BEAM_END_RADIUS = 2.4F;
    /** Spot spacing along the beam, as a fraction of the cone radius there (smaller = smoother). */
    private static final float BEAM_STEP = 0.45F;
    /** Each beam spot's alpha at the lens (spots overlap ~2/{@link #BEAM_STEP} deep). */
    private static final float BEAM_ALPHA = 0.11F;
    /** A spot's rim over the cone radius: its falloff leaves ~half of it lit. */
    private static final float SPOT_SPREAD = 1.7F;
    /** Light on the track: from this far ahead of the lamp … */
    private static final float POOL_NEAR = 1.0F;
    /** … to this far, and this wide each side of the lamp. */
    private static final float POOL_FAR = 22.0F;
    private static final float POOL_HALF_WIDTH = 2.6F;
    /** Height of the track light in the model frame: just above the railheads (0.406). */
    private static final float POOL_Y = 0.45F;
    private static final float POOL_ALPHA = 0.5F;

    /** Segments round a spot. */
    private static final int SEGMENTS = 12;
    /** A spot's falloff: alpha at the centre, at half the radius, at the rim (≈ a Gaussian). */
    private static final float MID_RADIUS = 0.5F;
    private static final float MID_ALPHA = 0.3F;
    private static final float[] COS = new float[SEGMENTS + 1];
    private static final float[] SIN = new float[SEGMENTS + 1];

    static {
        for (int i = 0; i <= SEGMENTS; i++) {
            COS[i] = (float) Math.cos(2.0 * Math.PI * i / SEGMENTS);
            SIN[i] = (float) Math.sin(2.0 * Math.PI * i / SEGMENTS);
        }
    }

    /** Queued vertices: x, y, z (camera-relative), r, g, b, a. */
    private static final int STRIDE = 7;
    private static float[] queue = new float[STRIDE * 4096];
    private static int queued;

    private LampEffects() {
    }

    /**
     * Queue one wagon's headlight light for this frame (entity pass).
     *
     * @param body        model space → camera-relative world (the body's pose, turned if flipped)
     * @param camera      the camera's orientation (spots face it)
     * @param litMask     the model's lit light groups
     * @param packedLight the wagon's light (bright surroundings drown the beam)
     * @param dayLight    0 at night … 1 at noon
     */
    static void collect(StockModel model, long litMask, Matrix4f body, Quaternionf camera,
            int packedLight, float dayLight) {
        if (IrisCompat.renderingShadowPass()) {
            return; // the light's view of the world: spots facing it would show as slivers
        }
        float ambient = Math.max(LightTexture.block(packedLight),
                LightTexture.sky(packedLight) * dayLight) / 15.0F;
        float darkness = 1.0F - ambient;
        Vector3f right = camera.transform(new Vector3f(1.0F, 0.0F, 0.0F));
        Vector3f up = camera.transform(new Vector3f(0.0F, 1.0F, 0.0F));
        Vector3f centre = new Vector3f();
        Vector3f dir = new Vector3f();
        Vector3f bodyUp = body.transformDirection(new Vector3f(0.0F, 1.0F, 0.0F)).normalize();
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
                beam(centre, dir, radius, right, up, r, g, b, darkness);
                track(lamp, body, bodyUp, r, g, b, darkness);
            }
            if (facing > 0.0F) {
                float glow = 0.35F + 0.65F * darkness;
                // pulled toward the camera so the lamp's own housing doesn't clip the spots
                Vector3f lens = new Vector3f(centre).mul(1.0F - Math.min(0.5F, distance * 0.3F)
                        / Math.max(distance, 1.0e-3F));
                spot(lens, right, up, radius * 1.6F, r, g, b, 0.9F * glow * (float) Math.sqrt(facing));
                float halo = facing * facing;
                spot(lens, right, up, radius * (3.0F + 10.0F * halo), r, g, b, 0.4F * glow * halo);
            }
        }
    }

    /** The beam: camera-facing spots along the axis, each as wide as the cone there. */
    private static void beam(Vector3f start, Vector3f dir, float startRadius, Vector3f right,
            Vector3f up, float r, float g, float b, float darkness) {
        Vector3f p = new Vector3f();
        float s = startRadius * 1.5F;
        while (s < BEAM_LENGTH) {
            float t = s / BEAM_LENGTH;
            float coneRadius = startRadius + (BEAM_END_RADIUS - startRadius) * t;
            p.set(dir).mul(s).add(start);
            float rim = coneRadius * SPOT_SPREAD;
            float alpha = BEAM_ALPHA * darkness
                    * (float) Math.pow(startRadius / coneRadius, 0.7) // spreading thins it
                    * (1.0F - t) * (1.0F - t);                      // and it fades out ahead
            // a spot round the camera would fill the screen: fade it out as it closes in
            float toCamera = p.length();
            alpha *= Math.clamp((toCamera - 0.5F * rim) / rim, 0.0F, 1.0F);
            if (toCamera > 1.0e-3F) {
                // looking along the beam every spot stacks up: hold the glow ahead down
                float along = Math.abs(p.dot(dir)) / toCamera;
                alpha *= 1.0F - 0.6F * along * along * along * along;
            }
            spot(p, right, up, rim, r, g, b, alpha);
            s += BEAM_STEP * coneRadius;
        }
    }

    /**
     * Light on the track ahead of a lamp: one long soft spot lying flat just
     * above the railheads (it rides the body's pitch; the ground beside the
     * track is a hand's width lower — seen from the cab or the lineside,
     * that's not visible). Seen edge-on it thins out.
     */
    private static void track(StockModel.Headlight lamp, Matrix4f body, Vector3f bodyUp,
            float r, float g, float b, float darkness) {
        float half = (POOL_FAR - POOL_NEAR) * 0.5F;
        Vector3f middle = body.transformPosition(lamp.x(), POOL_Y,
                lamp.z() + lamp.dirZ() * (POOL_NEAR + half), new Vector3f());
        Vector3f across = body.transformDirection(POOL_HALF_WIDTH, 0.0F, 0.0F, new Vector3f());
        Vector3f along = body.transformDirection(0.0F, 0.0F, half, new Vector3f());
        float distance = middle.length();
        float grazing = distance < 1.0e-3F ? 1.0F : Math.abs(middle.dot(bodyUp)) / distance;
        spot(middle, across, along, 1.0F, r, g, b,
                POOL_ALPHA * darkness * Math.clamp(grazing * 4.0F, 0.15F, 1.0F));
    }

    /**
     * A soft spot: a fan round {@code c} in the plane of {@code u} and {@code
     * v} scaled by {@code scale} — alpha falls from the centre through {@link
     * #MID_ALPHA} at half the radius to nothing at the rim. Drawn as quads: a
     * degenerate quad per inner triangle, a quad per outer ring segment.
     */
    private static void spot(Vector3f c, Vector3f u, Vector3f v, float scale,
            float r, float g, float b, float alpha) {
        if (alpha < 0.003F) {
            return;
        }
        float aMid = alpha * MID_ALPHA;
        for (int i = 0; i < SEGMENTS; i++) {
            float x0 = COS[i] * scale;
            float y0 = SIN[i] * scale;
            float x1 = COS[i + 1] * scale;
            float y1 = SIN[i + 1] * scale;
            float m = MID_RADIUS;
            vertex(c.x, c.y, c.z, r, g, b, alpha);
            vertex(c.x, c.y, c.z, r, g, b, alpha);
            vertex(c.x + (u.x * x0 + v.x * y0) * m, c.y + (u.y * x0 + v.y * y0) * m,
                    c.z + (u.z * x0 + v.z * y0) * m, r, g, b, aMid);
            vertex(c.x + (u.x * x1 + v.x * y1) * m, c.y + (u.y * x1 + v.y * y1) * m,
                    c.z + (u.z * x1 + v.z * y1) * m, r, g, b, aMid);

            vertex(c.x + (u.x * x0 + v.x * y0) * m, c.y + (u.y * x0 + v.y * y0) * m,
                    c.z + (u.z * x0 + v.z * y0) * m, r, g, b, aMid);
            vertex(c.x + u.x * x0 + v.x * y0, c.y + u.y * x0 + v.y * y0,
                    c.z + u.z * x0 + v.z * y0, r, g, b, 0.0F);
            vertex(c.x + u.x * x1 + v.x * y1, c.y + u.y * x1 + v.y * y1,
                    c.z + u.z * x1 + v.z * y1, r, g, b, 0.0F);
            vertex(c.x + (u.x * x1 + v.x * y1) * m, c.y + (u.y * x1 + v.y * y1) * m,
                    c.z + (u.z * x1 + v.z * y1) * m, r, g, b, aMid);
        }
    }

    private static void vertex(float x, float y, float z, float r, float g, float b, float a) {
        if ((queued + 1) * STRIDE > queue.length) {
            queue = Arrays.copyOf(queue, queue.length * 2);
        }
        int i = queued * STRIDE;
        queue[i] = x;
        queue[i + 1] = y;
        queue[i + 2] = z;
        queue[i + 3] = r;
        queue[i + 4] = g;
        queue[i + 5] = b;
        queue[i + 6] = a;
        queued++;
    }

    /** Draw this frame's queue once the sky and translucent terrain are in (see the class notes). */
    @SubscribeEvent
    static void onRenderStage(RenderLevelStageEvent event) {
        boolean shaders = IrisCompat.shaderPackInUse();
        RenderLevelStageEvent.Stage stage = shaders
                ? RenderLevelStageEvent.Stage.AFTER_LEVEL : RenderLevelStageEvent.Stage.AFTER_PARTICLES;
        if (event.getStage() != stage || queued == 0) {
            return;
        }
        // inside the level the model-view stack holds the view rotation; after it, it's gone
        Matrix4f view = shaders ? event.getModelViewMatrix() : null;
        Vector3f p = new Vector3f();
        MultiBufferSource.BufferSource buffers = Minecraft.getInstance().renderBuffers().bufferSource();
        VertexConsumer out = buffers.getBuffer(RwatRenderTypes.lightGlow());
        for (int v = 0; v < queued; v++) {
            int i = v * STRIDE;
            p.set(queue[i], queue[i + 1], queue[i + 2]);
            if (view != null) {
                view.transformPosition(p);
            }
            out.addVertex(p.x, p.y, p.z)
                    .setColor(queue[i + 3], queue[i + 4], queue[i + 5], queue[i + 6]);
        }
        buffers.endBatch(RwatRenderTypes.lightGlow());
        queued = 0;
    }

    /** A frame whose level wasn't drawn (or a renderer that queued outside it) leaves nothing behind. */
    @SubscribeEvent
    static void onFrameStart(RenderFrameEvent.Pre event) {
        queued = 0;
    }
}
