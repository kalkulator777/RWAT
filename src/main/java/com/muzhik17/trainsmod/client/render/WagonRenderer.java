package com.muzhik17.trainsmod.client.render;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.joml.Matrix4f;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.math.Axis;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.ClientCabInteract;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientFloorDebug;
import com.muzhik17.trainsmod.client.ClientRide;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.client.render.model.WagonModel;
import com.muzhik17.trainsmod.consist.Handles;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.convention.ControlValue;
import com.muzhik17.trainsmod.kinematics.Sway;
import com.muzhik17.trainsmod.kinematics.WagonPose;
import com.muzhik17.trainsmod.physics.TrainPhysics;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.client.renderer.LevelRenderer;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.RenderFrameEvent;

/**
 * Layer 3 renderer (SPEC §2.4): draws the wagon's {@link BakedStockModel} —
 * GPU buffers baked once, a handful of draw calls per frame. The per-frame
 * {@code VertexConsumer} path was the FPS killer at 17k quads per wagon. The
 * body is positioned from the two-bogie {@link WagonPose}; each bogie is drawn
 * with its own transform — at its path sample point, turned to the local
 * tangent — so bogies articulate through curves (SPEC §5.2); wheels spin about
 * their axles. The pose comes from {@link ClientConsists#renderPose}, which
 * shows the same one-tick-behind window vanilla entity lerp shows, so the
 * model never leads or trails the driver in the seat (SPEC §2.1, 0.2).
 *
 * <p>A wagon's parts are queued into a {@link GpuMesh.Batch} and issued grouped
 * by texture; the interior is skipped beyond {@link #INTERIOR_DRAW_DISTANCE}.
 * Doors swing with their IR animation, keyed by each door's open progress
 * ({@link WagonEntity#doorAnim}).
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public class WagonRenderer extends EntityRenderer<WagonEntity> {

    /** Plain white texture for the box fallback (flat-colour-shaded). */
    private static final ResourceLocation WAGON_TEXTURE =
            ResourceLocation.withDefaultNamespace("textures/misc/white.png");

    /**
     * Draw a wireframe box at each bogie's path sample point (SPEC §2.4a):
     * shows where the kinematics puts each bogie vs where the model's wheels
     * render. Off now that the bogie seating is play-test confirmed.
     */
    private static final boolean DEBUG_BOGIES = false;
    /** Half-extent of a bogie marker box, blocks. */
    private static final float BOGIE_MARK = 0.35F;

    /**
     * Interior (the {@code INTERIOR*} objects — over a third of a passenger
     * car's geometry) is drawn only while the camera is within this many
     * blocks of the body centre; further out it is a few pixels behind
     * window glass. Covers riding: a camera inside the car is at most half a
     * car length (~12.6) from the centre.
     */
    private static final double INTERIOR_DRAW_DISTANCE = 32.0;

    /**
     * Placeholder box (SPEC §6.5) for a type no installed pack has a model
     * for: the debug {@link WagonModel} (2 wide, 2 tall, 6 long) stretched to
     * the loading gauge and to the type's own length, lifted onto the rails.
     */
    private static final float BOX_SCALE_X = 1.6F;
    private static final float BOX_SCALE_Y = 2.0F;
    private static final float BOX_LENGTH = 6.0F;
    private static final float BOX_LIFT = 0.45F;

    /**
     * Baked model per (stock model, livery, packed-light value), in access order.
     * Outdoors this holds one entry per stock type on screen (sky 15); a
     * train running past lamps or through a lit tunnel keeps meeting new
     * values. Past {@link #BAKE_CACHE_MAX} the least recently drawn entry is
     * freed — never the whole cache: the former wholesale flush made every
     * wagon on screen re-bake its ~70k vertices in one frame. The model key
     * compares by identity — {@link StockModels} caches instances, and
     * value-comparing records over 17k-quad meshes would defeat the point of
     * a cache.
     */
    private static final int BAKE_CACHE_MAX = 24;
    private static final Map<BakeKey, BakedStockModel> BAKED =
            new LinkedHashMap<>(32, 0.75F, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<BakeKey, BakedStockModel> eldest) {
                    if (size() <= BAKE_CACHE_MAX) {
                        return false;
                    }
                    eldest.getValue().close();
                    return true;
                }
            };

    /**
     * New bakes allowed per frame. A bake is a whole model (~70k vertices,
     * ~2.5 MB upload); when several wagons hit new light values at once, the
     * rest borrow their model's most recent bake for a frame or two — a light
     * step a few frames late instead of a hitch.
     */
    private static final int BAKES_PER_FRAME = 1;
    private static int bakesThisFrame;

    /** Reused draw queue for one wagon's parts (render thread only). */
    private static final GpuMesh.Batch BATCH = new GpuMesh.Batch();
    /** Scratch for an interpolated door keyframe (render thread only). */
    private static final Matrix4f DOOR_FRAME = new Matrix4f();

    /** Scratch for a control's transform (render thread only). */
    private static final Matrix4f CONTROL_FRAME = new Matrix4f();
    /** The outline round the cab control under the crosshair (SPEC §9.3): warm white. */
    private static final float OUTLINE_R = 1.0F;
    private static final float OUTLINE_G = 0.92F;
    private static final float OUTLINE_B = 0.7F;
    private static final float OUTLINE_A = 0.8F;
    /** Outline gap round a control's box, blocks. */
    private static final float OUTLINE_PAD = 0.01F;

    private record BakeKey(StockModel model, String livery, int packedLight, long litMask) {
        @Override
        public boolean equals(Object o) {
            return o instanceof BakeKey k && k.model == model && k.packedLight == packedLight
                    && k.litMask == litMask && k.livery.equals(livery);
        }

        @Override
        public int hashCode() {
            return ((System.identityHashCode(model) * 31 + livery.hashCode()) * 31 + packedLight)
                    * 31 + Long.hashCode(litMask);
        }
    }

    public WagonRenderer(EntityRendererProvider.Context context) {
        super(context);
    }

    @Override
    public void render(WagonEntity wagon, float entityYaw, float partialTick,
            PoseStack poseStack, MultiBufferSource buffers, int packedLight) {
        super.render(wagon, entityYaw, partialTick, poseStack, buffers, packedLight);

        int wagonIndex = wagon.getWagonIndex();
        var slot = ClientConsists.slot(wagon.getConsistId(), wagonIndex);
        if (slot == null) {
            return; // composition not synced yet (a tick or two after spawn/login)
        }
        // the model of the slot's type, from the packs (SPEC §6.6)
        StockModel model = StockModels.model(slot.type().id());
        if (model == null) {
            return; // first sight of this type: its OBJ is still loading in the background
        }
        WagonPose pose = ClientConsists.renderPose(wagon.getConsistId(), wagonIndex, partialTick);
        boolean flipped = slot.flipped();

        // poseStack origin is the vanilla-lerped entity position; shift it to
        // the exact body position derived from the two bogies (SPEC §2.3)
        var lerped = wagon.getPosition(partialTick);
        double bodyX = pose != null ? pose.body().x : lerped.x;
        double bodyY = pose != null ? pose.body().y : lerped.y;
        double bodyZ = pose != null ? pose.body().z : lerped.z;
        float yRot = pose != null ? pose.yaw() : wagon.getYRot();
        float xRot = pose != null ? pose.pitch() : wagon.getXRot();
        Sway sway = ClientRide.sway(wagon.getId(), partialTick); // the body on its springs (SPEC §10)

        if (model.isEmpty()) {
            // no pack has a model for this type (or it failed to load) — the placeholder box
            poseStack.pushPose();
            poseStack.translate(bodyX - lerped.x, bodyY - lerped.y, bodyZ - lerped.z);
            poseStack.mulPose(Axis.YP.rotationDegrees(-yRot));
            poseStack.mulPose(Axis.XP.rotationDegrees(xRot));
            applySway(sway, poseStack);
            poseStack.translate(0.0F, BOX_LIFT, 0.0F);
            poseStack.scale(BOX_SCALE_X, BOX_SCALE_Y, (float) slot.type().length() / BOX_LENGTH);
            VertexConsumer body = buffers.getBuffer(RenderType.entityCutoutNoCull(WAGON_TEXTURE));
            WagonModel.BODY_MESH.emit(poseStack.last(), body, packedLight);
            poseStack.popPose();
            return;
        }
        // which of the model's light groups are on (SPEC §8): part of the bake
        long litMask = model.litMask(wagon::controlValue);
        BakedStockModel baked = bakedAt(model, slot.livery(), packedLight, litMask);
        boolean drawInterior = entityRenderDispatcher.distanceToSqr(bodyX, bodyY, bodyZ)
                <= INTERIOR_DRAW_DISTANCE * INTERIOR_DRAW_DISTANCE;

        // the body, oriented by the chord between the two bogies (SPEC §2.4);
        // a flipped wagon turns its model 180° in its own local frame (§5.5 step 3)
        poseStack.pushPose();
        poseStack.translate(bodyX - lerped.x, bodyY - lerped.y, bodyZ - lerped.z);
        poseStack.mulPose(Axis.YP.rotationDegrees(-yRot));
        poseStack.mulPose(Axis.XP.rotationDegrees(xRot));
        applySway(sway, poseStack); // in the pose frame, before the flip — riders sway the same
        if (flipped) {
            poseStack.mulPose(Axis.YP.rotationDegrees(180.0F));
        }
        Matrix4f bodyMatrix = new Matrix4f(poseStack.last().pose()); // model → camera-relative
        draw(baked.body(), poseStack);
        if (drawInterior) {
            draw(baked.interior(), poseStack);
        }
        drawDoors(baked, wagon, slot, partialTick, poseStack);
        drawControls(baked, wagon, slot, wagonIndex, drawInterior, partialTick, poseStack, buffers);
        if (ClientFloorDebug.shown()) {
            ClientFloorDebug.draw(poseStack, buffers, slot.type()); // SPEC §9.6 debug view
        }
        if (ClientCabInteract.seatHighlighted(wagon) && slot.type().cab() != null
                && slot.type().cab().seat() != null) {
            double[] box = ClientCabInteract.seatBox(slot.type().cab().seat());
            LevelRenderer.renderLineBox(poseStack, buffers.getBuffer(RenderType.lines()),
                    box[0], box[1], box[2], box[3], box[4], box[5],
                    OUTLINE_R, OUTLINE_G, OUTLINE_B, OUTLINE_A);
        }
        if (pose == null) {
            // no pose yet — ride the bogies rigidly at their pivots
            double[] pivots = slot.type().bogieOffsets();
            drawRigidBogie(baked.front(), pivots[0], poseStack);
            drawRigidBogie(baked.rear(), pivots[pivots.length - 1], poseStack);
        }
        poseStack.popPose();

        // bogies articulate: each at its own path point, turned to the local
        // tangent (SPEC §5.2); on a flipped wagon the model's front bogie is
        // the path-rear one and vice versa, each turned 180° like the body
        if (pose != null) {
            drawBogie(baked.front(), flipped ? pose.rear() : pose.front(),
                    flipped, lerped, poseStack);
            drawBogie(baked.rear(), flipped ? pose.front() : pose.rear(),
                    flipped, lerped, poseStack);
        }
        BATCH.flush();

        // headlight flares, beams and track light (SPEC §8): queued, drawn after translucents
        if (litMask != 0L && !model.headlights().isEmpty()) {
            float skyDarken = wagon.level() instanceof net.minecraft.client.multiplayer.ClientLevel client
                    ? client.getSkyDarken(partialTick) : 1.0F;
            float dayLight = Math.clamp((skyDarken - 0.2F) / 0.8F, 0.0F, 1.0F);
            LampEffects.collect(model, litMask, bodyMatrix,
                    entityRenderDispatcher.cameraOrientation(), packedLight, dayLight);
        }

        if (DEBUG_BOGIES && pose != null) {
            VertexConsumer lines = buffers.getBuffer(RenderType.lines());
            drawBogieMarker(poseStack, lines, lerped, pose.front(), 1.0F, 0.2F, 0.2F); // front: red
            drawBogieMarker(poseStack, lines, lerped, pose.rear(), 0.2F, 0.6F, 1.0F);  // rear: blue
        }
    }

    /**
     * The body's rocking on its springs (SPEC §10), exactly as
     * {@link Sway#apply} moves a rider: up by the bounce, turned about the
     * rocking centre — roll about +Z, then pitch about +X.
     */
    private static void applySway(Sway sway, PoseStack poseStack) {
        if (sway.equals(Sway.ZERO)) {
            return;
        }
        poseStack.translate(0.0, Sway.CENTRE_Y + sway.bounce(), 0.0);
        poseStack.mulPose(Axis.ZP.rotation((float) sway.roll()));
        poseStack.mulPose(Axis.XP.rotation((float) sway.pitch()));
        poseStack.translate(0.0, -Sway.CENTRE_Y, 0.0);
    }

    @SubscribeEvent
    static void onFrameStart(RenderFrameEvent.Pre event) {
        bakesThisFrame = 0;
    }

    /**
     * The model baked in this livery at this light value, baking on first
     * sight of the combination within the per-frame budget. Over budget, the
     * most recently used bake of the same model and livery at another light
     * stands in until a later frame bakes the right one; only a combination
     * with no bake at all bakes regardless.
     */
    private static BakedStockModel bakedAt(StockModel model, String livery, int packedLight,
            long litMask) {
        BakeKey key = new BakeKey(model, livery, packedLight, litMask);
        BakedStockModel baked = BAKED.get(key); // counts as a use for the LRU
        if (baked != null) {
            return baked;
        }
        if (bakesThisFrame >= BAKES_PER_FRAME) {
            BakedStockModel standIn = latestBakeOf(model, livery);
            if (standIn != null) {
                return standIn;
            }
        }
        bakesThisFrame++;
        baked = BakedStockModel.bake(model, livery, packedLight, litMask);
        BAKED.put(key, baked); // may free the least recently used other entry
        return baked;
    }

    /** The most recently used bake of {@code model} in {@code livery} at any light, or null. */
    private static BakedStockModel latestBakeOf(StockModel model, String livery) {
        BakedStockModel latest = null;
        for (Map.Entry<BakeKey, BakedStockModel> entry : BAKED.entrySet()) { // no reordering
            if (entry.getKey().model() == model && entry.getKey().livery().equals(livery)) {
                latest = entry.getValue(); // access order: later = more recent
            }
        }
        return latest;
    }

    /** Drop all baked buffers (logout, resource reload). */
    public static void clearBaked() {
        BAKED.values().forEach(BakedStockModel::close);
        BAKED.clear();
    }

    /**
     * One bogie at its path sample point, oriented by the local tangent; its
     * wheels spin about their axles by rolled distance / radius (the angle is
     * wrapped per revolution before the float cast so it stays precise far
     * from the origin). On a flipped wagon the local X axis is mirrored by the
     * 180° turn, so the spin sign flips to keep rolling forward.
     */
    private static void drawBogie(BakedStockModel.BakedBogie bogie, WagonPose.BogiePose pose,
            boolean flipped, Vec3 lerped, PoseStack poseStack) {
        poseStack.pushPose();
        poseStack.translate(pose.position().x - lerped.x,
                pose.position().y - lerped.y, pose.position().z - lerped.z);
        poseStack.mulPose(Axis.YP.rotationDegrees(-pose.yaw()));
        poseStack.mulPose(Axis.XP.rotationDegrees(pose.pitch()));
        if (flipped) {
            poseStack.mulPose(Axis.YP.rotationDegrees(180.0F));
        }
        draw(bogie.frame(), poseStack);
        for (BakedStockModel.BakedWheel wheel : bogie.wheels()) {
            double circumference = 2.0 * Math.PI * wheel.radius();
            float angle = (float) Math.toDegrees(
                    (pose.pathS() % circumference) / wheel.radius());
            if (flipped) {
                angle = -angle;
            }
            poseStack.pushPose();
            poseStack.translate(0.0, wheel.centerY(), wheel.centerZ());
            poseStack.mulPose(Axis.XP.rotationDegrees(angle));
            draw(wheel.meshes(), poseStack);
            poseStack.popPose();
        }
        poseStack.popPose();
    }

    /**
     * The animated doors at their current swing (SPEC v1.5): each piece gets
     * its keyframe for the door's open progress — interpolated between the
     * two nearest frames — on top of the body pose. Progress 0 is frame 0,
     * the rest pose, so a closed door draws exactly where the asset put it.
     * A leaf the asset moves by name (SPEC §9.5) turns/slides by the progress
     * of the type's door whose box holds it.
     */
    private static void drawDoors(BakedStockModel baked, WagonEntity wagon,
            ConsistComposition.Slot slot, float partialTick, PoseStack poseStack) {
        if (baked.doors().isEmpty() && baked.doorLeaves().isEmpty()) {
            return;
        }
        WagonType type = slot.type();
        for (BakedStockModel.BakedControl leaf : baked.doorLeaves()) {
            StockModel.Control control = leaf.control();
            int door = type.doorHolding((control.boxMin().x + control.boxMax().x) * 0.5,
                    (control.boxMin().y + control.boxMax().y) * 0.5,
                    (control.boxMin().z + control.boxMax().z) * 0.5);
            control.transform(door < 0 ? 0.0F : wagon.doorAnim(door, partialTick), CONTROL_FRAME);
            poseStack.pushPose();
            poseStack.mulPose(CONTROL_FRAME);
            draw(leaf.meshes(), poseStack);
            poseStack.popPose();
        }
        List<WagonType.Door> declared = type.doors();
        for (BakedStockModel.BakedDoor door : baked.doors()) {
            float progress = 0.0F;
            for (int i = 0; i < declared.size(); i++) {
                // the model's animation group and the type's door id match ignoring case
                // (SPEC §6.3): DOOR_5_..._CG_Trap1 makes a door "Trap1", its .anim "trap1"
                if (declared.get(i).id().equalsIgnoreCase(door.id())) {
                    progress = wagon.doorAnim(i, partialTick);
                    break;
                }
            }
            for (BakedStockModel.BakedPiece piece : door.pieces()) {
                Matrix4f[] frames = piece.frames();
                float f = progress * (frames.length - 1);
                int i0 = Math.min((int) f, frames.length - 1);
                int i1 = Math.min(i0 + 1, frames.length - 1);
                frames[i0].lerp(frames[i1], f - i0, DOOR_FRAME);
                poseStack.pushPose();
                poseStack.mulPose(DOOR_FRAME);
                draw(piece.meshes(), poseStack);
                poseStack.popPose();
            }
        }
    }

    /**
     * The cab's levers, switches and gauges (SPEC §9.3), each turned/slid by
     * its value: a lever by the consist's handle (only in the cab that drives),
     * a switch by the wagon's control group, a gauge by its reading. A lever
     * the local player is dragging shows where the mouse holds it, ahead of
     * the server's answer. Inside controls are skipped at a distance, like the
     * interior. The control under the crosshair gets an outline of its box,
     * moved with it.
     */
    private static void drawControls(BakedStockModel baked, WagonEntity wagon,
            ConsistComposition.Slot slot, int wagonIndex, boolean drawInterior, float partialTick,
            PoseStack poseStack, MultiBufferSource buffers) {
        if (baked.controls().isEmpty()) {
            return;
        }
        Handles handles = ClientConsists.handles(wagon.getConsistId());
        boolean activeCab = handles.activeCab() == wagonIndex;
        int consistId = wagon.getConsistId();
        ControlValue.Readings readings = new ControlValue.Readings(
                Math.abs(TrainPhysics.kmh(ClientConsists.speed(consistId))),
                slot.type().maxSpeedKmh(),
                ClientConsists.trainBrakePressure(consistId),
                ClientConsists.indBrakePressure(consistId),
                wagon.handbrakeAnim(partialTick));
        for (BakedStockModel.BakedControl bc : baked.controls()) {
            StockModel.Control control = bc.control();
            if (control.interior() && !drawInterior) {
                continue;
            }
            Float dragged = ClientCabInteract.draggedPosition(wagon, control);
            float position = dragged != null ? dragged : ControlValue.position(control.role(),
                    handles, activeCab, wagon.controlValue(control.role().group()), readings);
            if (!ControlValue.visible(control.role(), position)) {
                continue;
            }
            control.transform(ControlValue.value(control.role(), position), CONTROL_FRAME);
            poseStack.pushPose();
            poseStack.mulPose(CONTROL_FRAME);
            draw(bc.meshes(), poseStack);
            if (ClientCabInteract.highlighted(wagon, control)) {
                var lo = control.boxMin();
                var hi = control.boxMax();
                LevelRenderer.renderLineBox(poseStack, buffers.getBuffer(RenderType.lines()),
                        lo.x - OUTLINE_PAD, lo.y - OUTLINE_PAD, lo.z - OUTLINE_PAD,
                        hi.x + OUTLINE_PAD, hi.y + OUTLINE_PAD, hi.z + OUTLINE_PAD,
                        OUTLINE_R, OUTLINE_G, OUTLINE_B, OUTLINE_A);
            }
            poseStack.popPose();
        }
    }

    /** Fallback when no pose is known: bogie rides the body frame at its pivot offset. */
    private static void drawRigidBogie(BakedStockModel.BakedBogie bogie, double pivotZ,
            PoseStack poseStack) {
        poseStack.pushPose();
        poseStack.translate(0.0, 0.0, pivotZ);
        draw(bogie.frame(), poseStack);
        for (BakedStockModel.BakedWheel wheel : bogie.wheels()) {
            poseStack.pushPose();
            poseStack.translate(0.0, wheel.centerY(), wheel.centerZ());
            draw(wheel.meshes(), poseStack);
            poseStack.popPose();
        }
        poseStack.popPose();
    }

    /** Queue meshes at the current pose; {@link #BATCH} issues them at the end of the wagon. */
    private static void draw(List<GpuMesh> meshes, PoseStack poseStack) {
        for (GpuMesh mesh : meshes) {
            BATCH.add(mesh, poseStack.last().pose());
        }
    }

    /** Wireframe box centred on a bogie's world-space path sample point. */
    private static void drawBogieMarker(PoseStack poseStack, VertexConsumer lines, Vec3 lerped,
            WagonPose.BogiePose bogie, float r, float g, float b) {
        poseStack.pushPose();
        poseStack.translate(bogie.position().x - lerped.x,
                bogie.position().y - lerped.y, bogie.position().z - lerped.z);
        LevelRenderer.renderLineBox(poseStack, lines,
                -BOGIE_MARK, -BOGIE_MARK, -BOGIE_MARK, BOGIE_MARK, BOGIE_MARK, BOGIE_MARK,
                r, g, b, 1.0F);
        poseStack.popPose();
    }

    @Override
    public ResourceLocation getTextureLocation(WagonEntity wagon) {
        return WAGON_TEXTURE;
    }
}
