package com.muzhik17.trainsmod.client.render;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.joml.Matrix4d;
import org.joml.Matrix4f;
import org.joml.Vector3d;
import org.joml.Vector3f;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.math.Axis;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.ClientCabInteract;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientDoorInteract;
import com.muzhik17.trainsmod.client.ClientFloorDebug;
import com.muzhik17.trainsmod.client.ClientRide;
import com.muzhik17.trainsmod.client.ClientWagonRay;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.client.render.model.WagonModel;
import com.muzhik17.trainsmod.consist.Handles;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.convention.ControlValue;
import com.muzhik17.trainsmod.kinematics.CouplerAim;
import com.muzhik17.trainsmod.kinematics.EdgeOutline;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.kinematics.Sway;
import com.muzhik17.trainsmod.kinematics.WagonPose;
import com.muzhik17.trainsmod.physics.TrainPhysics;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.renderer.LevelRenderer;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.core.BlockPos;
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
    /**
     * Debug (SPEC §2.4a): coupler heads drawn straight, as before they
     * turned — the {@code couplers} autoscene flips it (by reflection) to
     * show both side by side.
     */
    private static boolean debugStraightCouplers;
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
    /**
     * The outline round the control, chair or door under the crosshair (SPEC
     * §9.3): the vanilla block outline's lines render type and width, in warm
     * white — vanilla's black at 40 % vanishes on the black levers and
     * switches of the cabs (play-test, 2026-10-12).
     */
    private static final float OUTLINE_R = 1.0F;
    private static final float OUTLINE_G = 0.92F;
    private static final float OUTLINE_B = 0.7F;
    private static final float OUTLINE_A = 0.8F;
    /** Outline gap round a box drawn for a part without a mesh, blocks. */
    private static final float OUTLINE_PAD = 0.01F;
    /** Scratch for the camera in a part's frame (render thread only). */
    private static final Matrix4f TO_PART = new Matrix4f();

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
        // the door under the crosshair is outlined by its leaves, or by its box if the model moves none
        int hoveredDoor = ClientDoorInteract.highlightedDoor(wagon);
        if (!drawDoors(baked, wagon, slot, partialTick, hoveredDoor, poseStack, buffers) && hoveredDoor >= 0
                && hoveredDoor < slot.type().doors().size()) {
            WagonType.Door door = slot.type().doors().get(hoveredDoor);
            outlineBox(poseStack, buffers, door.minX(), door.minY(), door.minZ(),
                    door.maxX(), door.maxY(), door.maxZ());
        }
        // the chair under the crosshair: by the control that is the chair (ChME3 WIDGET_4), else its box
        int chair = ClientCabInteract.highlightedSeat(wagon);
        WagonType.Seat seat = chair >= 0 && slot.type().cab() != null && chair < slot.type().cab().seats().size()
                ? slot.type().cab().seats().get(chair) : null;
        if (!drawControls(baked, wagon, slot, wagonIndex, drawInterior, partialTick, seat, poseStack, buffers)
                && seat != null) {
            double[] box = ClientCabInteract.seatBox(seat);
            outlineBox(poseStack, buffers, box[0], box[1], box[2], box[3], box[4], box[5]);
        }
        drawCouplers(baked, wagon, slot, wagonIndex, partialTick, poseStack);
        if (ClientFloorDebug.shown()) {
            ClientFloorDebug.draw(poseStack, buffers, slot.type()); // SPEC §9.6 debug view
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
     * of the type's door whose box holds it. The {@code hovered} door's leaves
     * and pieces are outlined by their contours (SPEC §9.3).
     *
     * @return true if the hovered door was outlined so (false: the model moves no leaf of it)
     */
    private static boolean drawDoors(BakedStockModel baked, WagonEntity wagon,
            ConsistComposition.Slot slot, float partialTick, int hovered, PoseStack poseStack,
            MultiBufferSource buffers) {
        if (baked.doors().isEmpty() && baked.doorLeaves().isEmpty()) {
            return false;
        }
        boolean outlined = false;
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
            if (door >= 0 && door == hovered) {
                outlined |= drawOutline(control.outline(), poseStack, buffers);
            }
            poseStack.popPose();
        }
        List<WagonType.Door> declared = type.doors();
        for (BakedStockModel.BakedDoor door : baked.doors()) {
            float progress = 0.0F;
            int index = -1;
            for (int i = 0; i < declared.size(); i++) {
                // the model's animation group and the type's door id match ignoring case
                // (SPEC §6.3): DOOR_5_..._CG_Trap1 makes a door "Trap1", its .anim "trap1"
                if (declared.get(i).id().equalsIgnoreCase(door.id())) {
                    progress = wagon.doorAnim(i, partialTick);
                    index = i;
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
                if (index >= 0 && index == hovered) {
                    outlined |= drawOutline(piece.outline(), poseStack, buffers);
                }
                poseStack.popPose();
            }
        }
        return outlined;
    }

    /**
     * The cab's levers, switches and gauges (SPEC §9.3), each turned/slid by
     * its value: a lever by the consist's handle (only in the cab that drives),
     * a switch by the wagon's control group, a gauge by its reading. A lever
     * the local player is dragging shows where the mouse holds it, ahead of
     * the server's answer. Inside controls are skipped at a distance, like the
     * interior. The control under the crosshair is outlined by its contour,
     * moved with it — as is the control that is the {@code chair} under the
     * crosshair, if one is (its cushion in the control's box).
     *
     * @return true if the chair was outlined so
     */
    private static boolean drawControls(BakedStockModel baked, WagonEntity wagon,
            ConsistComposition.Slot slot, int wagonIndex, boolean drawInterior, float partialTick,
            WagonType.Seat chair, PoseStack poseStack, MultiBufferSource buffers) {
        if (baked.controls().isEmpty()) {
            return false;
        }
        boolean chairOutlined = false;
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
            boolean isChair = chair != null && holds(control, chair);
            if (ClientCabInteract.highlighted(wagon, control) || isChair) {
                if (!drawOutline(control.outline(), poseStack, buffers)) {
                    var lo = control.boxMin();
                    var hi = control.boxMax();
                    outlineBox(poseStack, buffers, lo.x, lo.y, lo.z, hi.x, hi.y, hi.z);
                }
                chairOutlined |= isChair;
            }
            poseStack.popPose();
        }
        return chairOutlined;
    }

    /**
     * The coupler heads (SPEC §6.12): at each end the head of that end's
     * state — coupled, or hanging free — on the body, so it sways with it; a
     * coupled head turned on its pivot toward the middle of its pivot and the
     * next car's, both cars as drawn, so the two heads meet in a curve
     * instead of parting at an angle, within {@link CouplerAim#LIMIT_DEGREES}.
     */
    private static void drawCouplers(BakedStockModel baked, WagonEntity wagon, ConsistComposition.Slot slot,
            int wagonIndex, float partialTick, PoseStack poseStack) {
        if (baked.couplers().isEmpty()) {
            return;
        }
        int consistId = wagon.getConsistId();
        Matrix4d toWorld = null;
        for (boolean front : new boolean[]{true, false}) {
            // the model's front is the path-front end (toward index − 1) unless the car runs turned
            boolean pathFront = front != slot.flipped();
            int next = pathFront ? wagonIndex - 1 : wagonIndex + 1;
            boolean coupled = next >= 0 && ClientConsists.slot(consistId, next) != null;
            double[] turn = null;
            for (BakedStockModel.BakedCoupler head : baked.couplers()) {
                StockModel.Coupler coupler = head.coupler();
                if (coupler.front() != front || !coupler.shown().at(coupled)) {
                    continue;
                }
                Vector3f pivot = coupler.pivot();
                if (turn == null) {
                    if (coupled && toWorld == null) {
                        toWorld = ClientWagonRay.drawn(wagon, partialTick);
                    }
                    turn = coupled && !debugStraightCouplers
                            ? aimCoupler(toWorld, pivot, front, consistId, next, pathFront, partialTick)
                            : new double[]{0.0, 0.0};
                }
                poseStack.pushPose();
                poseStack.translate(pivot.x, pivot.y, pivot.z);
                poseStack.mulPose(Axis.YP.rotation((float) turn[0]));
                poseStack.mulPose(Axis.XP.rotation((float) turn[1]));
                poseStack.translate(-pivot.x, -pivot.y, -pivot.z);
                draw(head.meshes(), poseStack);
                poseStack.popPose();
            }
        }
    }

    /**
     * The turn of a coupled head on {@code pivot} (model frame of a car drawn
     * by {@code toWorld}): toward the middle of its pivot and the facing
     * pivot of the next car {@code next}, that car as drawn.
     */
    private static double[] aimCoupler(Matrix4d toWorld, Vector3f pivot, boolean front, int consistId, int next,
            boolean pathFront, float partialTick) {
        Matrix4d nextToWorld = ClientWagonRay.drawnAt(consistId, next, partialTick);
        ConsistComposition.Slot nextSlot = ClientConsists.slot(consistId, next);
        if (nextToWorld == null || nextSlot == null) {
            return new double[]{0.0, 0.0};
        }
        // the car ahead faces us with its path-rear end, the car behind with its path-front;
        // its model front is its path front unless it runs turned
        boolean nextFront = !pathFront != nextSlot.flipped();
        Vector3d theirs = nextToWorld.transformPosition(couplerPivot(nextSlot, nextFront, pivot.y));
        Vector3d meet = toWorld.transformPosition(new Vector3d(pivot.x, pivot.y, pivot.z)).add(theirs).mul(0.5);
        Vector3d local = toWorld.invertAffine(new Matrix4d()).transformPosition(meet);
        return CouplerAim.angles(pivot.x, pivot.y, pivot.z, local.x, local.y, local.z, front,
                CouplerAim.LIMIT_DEGREES);
    }

    /**
     * A car's coupler pivot at its model {@code front} end or rear (model
     * frame): its heads' pivot, or — a model without heads — its coupler
     * point at height {@code y}.
     */
    private static Vector3d couplerPivot(ConsistComposition.Slot slot, boolean front, float y) {
        StockModel model = StockModels.model(slot.type().id());
        if (model != null) {
            for (StockModel.Coupler coupler : model.couplers()) {
                if (coupler.front() == front) {
                    return new Vector3d(coupler.pivot());
                }
            }
        }
        double reach = slot.type().couplerReach(front);
        return new Vector3d(0.0, y, front ? reach : -reach);
    }

    /** True if a control's rest box holds the top of the chair's cushion: the control is the chair. */
    private static boolean holds(StockModel.Control control, WagonType.Seat chair) {
        double cushion = chair.y() - 0.05;
        return chair.x() >= control.boxMin().x && chair.x() <= control.boxMax().x
                && cushion >= control.boxMin().y && cushion <= control.boxMax().y
                && chair.z() >= control.boxMin().z && chair.z() <= control.boxMax().z;
    }

    /**
     * A part's hover outline at the current pose (SPEC §9.3): its creases and
     * boundary, and its smooth edges on the silhouette from the camera — at
     * the origin of the entity pose stack's space, so taken into the part's
     * frame by the pose's inverse — in the vanilla block outline's look.
     *
     * @return false if the part has no outline (no mesh): the caller draws a box
     */
    private static boolean drawOutline(EdgeOutline outline, PoseStack poseStack, MultiBufferSource buffers) {
        if (outline.fixedCount() == 0 && outline.smoothCount() == 0) {
            return false;
        }
        PoseStack.Pose pose = poseStack.last();
        Vector3f eye = pose.pose().invertAffine(TO_PART).transformPosition(new Vector3f());
        VertexConsumer lines = buffers.getBuffer(RenderType.lines());
        outline.forEach(eye.x, eye.y, eye.z, (x0, y0, z0, x1, y1, z1) -> {
            float dx = x1 - x0;
            float dy = y1 - y0;
            float dz = z1 - z0;
            float length = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (length < 1.0e-6F) {
                return;
            }
            dx /= length;
            dy /= length;
            dz /= length;
            lines.addVertex(pose, x0, y0, z0).setColor(OUTLINE_R, OUTLINE_G, OUTLINE_B, OUTLINE_A)
                    .setNormal(pose, dx, dy, dz);
            lines.addVertex(pose, x1, y1, z1).setColor(OUTLINE_R, OUTLINE_G, OUTLINE_B, OUTLINE_A)
                    .setNormal(pose, dx, dy, dz);
        });
        return true;
    }

    /** A box outline at the current pose, for a part without a mesh, in the vanilla block outline's look. */
    private static void outlineBox(PoseStack poseStack, MultiBufferSource buffers,
            double minX, double minY, double minZ, double maxX, double maxY, double maxZ) {
        LevelRenderer.renderLineBox(poseStack, buffers.getBuffer(RenderType.lines()),
                minX - OUTLINE_PAD, minY - OUTLINE_PAD, minZ - OUTLINE_PAD,
                maxX + OUTLINE_PAD, maxY + OUTLINE_PAD, maxZ + OUTLINE_PAD,
                OUTLINE_R, OUTLINE_G, OUTLINE_B, OUTLINE_A);
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

    /**
     * The block whose chunk section must be built for this car to be drawn
     * (SPEC §2.4, {@code LevelRendererWagonSectionMixin}); null — draw it
     * regardless — for a car of the train the local player rides. Vanilla
     * asks about the entity's position, the centre of a car up to 26 blocks
     * long: from its end, looking back on a fast train, that section is one
     * never in view and never built. Any other car is asked about at its
     * hull's point nearest the camera — the part of it the player sees first.
     */
    public static BlockPos testedSection(WagonEntity wagon, Vec3 camera) {
        LocalPlayer player = Minecraft.getInstance().player;
        if (player != null && player.getVehicle() instanceof WagonEntity ridden
                && ridden.getConsistId() == wagon.getConsistId()) {
            return null;
        }
        WagonType.Hull hull = wagon.collisionHull();
        if (hull == null) {
            return wagon.blockPosition();
        }
        Vector3d body = new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ());
        Vector3d local = PoseMath.worldToLocal(body, wagon.getYRot(), wagon.getXRot(),
                new Vector3d(camera.x, camera.y, camera.z));
        local.set(Math.clamp(local.x, hull.minX(), hull.maxX()), Math.clamp(local.y, hull.minY(), hull.maxY()),
                Math.clamp(local.z, hull.minZ(), hull.maxZ()));
        Vector3d nearest = PoseMath.localToWorld(body, wagon.getYRot(), wagon.getXRot(), local);
        return BlockPos.containing(nearest.x, nearest.y, nearest.z);
    }

    @Override
    public ResourceLocation getTextureLocation(WagonEntity wagon) {
        return WAGON_TEXTURE;
    }
}
