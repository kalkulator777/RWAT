package com.muzhik17.trainsmod.client;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.BogieReach;
import com.muzhik17.trainsmod.kinematics.HullCollision;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.kinematics.WagonPose;
import com.muzhik17.trainsmod.network.WagonStrikePayload;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.phys.EntityHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.InputEvent;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * Left-click a wagon's bogie to strike it (SPEC §6.11): a few blows break the
 * wagon in survival, one in creative, as a minecart. The wagon entity's own
 * pick box is a small cube at the body centre, so — like doors and couplers —
 * the bogie is picked here: the look ray goes into each bogie's <b>own</b>
 * frame (bogies turn apart from the body through curves, SPEC §5.2), at the
 * pose drawn this frame, and is tested against the bogie's box — its model's
 * frame and wheels, or {@link BogieReach}'s default box without a model. The
 * car's body in front of the bogie (its model's walls, or the hull box) keeps
 * the blow: a blow at the body breaks nothing, so a stray click at the car
 * you walk about in never knocks it down. A nearer block or entity under the
 * crosshair keeps the click too; a rider never strikes (aboard, the world is
 * out of reach — {@code AboardGuard}).
 *
 * <p>One blow per click: holding the button doesn't keep striking (vanilla
 * attacks an entity once per click), nor mine the ground behind the bogie.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientBogieHit {

    /** False after a blow until the attack button is released. */
    private static boolean armed = true;

    /** Bogie boxes of a type's model ({@code front}, {@code rear}: model frame), for the model they came from. */
    private record Boxes(StockModel model, double[] front, double[] rear) {
    }

    private static final Map<String, Boxes> BOXES = new HashMap<>();

    /** A bogie under the crosshair: {@code front} = the one ahead along the path. */
    private record Pick(WagonEntity wagon, boolean front, double distance) {
    }

    private ClientBogieHit() {
    }

    @SubscribeEvent(priority = EventPriority.HIGH)
    static void onAttack(InputEvent.InteractionKeyMappingTriggered event) {
        if (!event.isAttack()) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer player = mc.player;
        if (player == null || mc.level == null || player.isSpectator()
                || player.getVehicle() instanceof WagonEntity) {
            return;
        }
        Pick pick = pick(mc, player);
        if (pick == null) {
            return;
        }
        event.setCanceled(true); // the blow is the bogie's, not the block's behind it
        event.setSwingHand(armed);
        if (armed) {
            armed = false;
            PacketDistributor.sendToServer(new WagonStrikePayload(pick.wagon().getId(), pick.front()));
            player.resetAttackStrengthTicker(); // as vanilla's attack does
        }
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        if (!Minecraft.getInstance().options.keyAttack.isDown()) {
            armed = true;
        }
    }

    /** The nearest bogie under the crosshair within entity reach, not behind its car's body, or null. */
    private static Pick pick(Minecraft mc, LocalPlayer player) {
        float partialTick = mc.getTimer().getGameTimeDeltaPartialTick(true);
        Vec3 eye = player.getEyePosition(partialTick);
        Vec3 look = player.getViewVector(partialTick);
        double reach = player.entityInteractionRange();
        List<WagonEntity> wagons = mc.level.getEntitiesOfClass(WagonEntity.class,
                player.getBoundingBox().inflate(reach + 16.0));
        Pick best = null;
        for (WagonEntity wagon : wagons) {
            int consistId = wagon.getConsistId();
            int index = wagon.getWagonIndex();
            ConsistComposition.Slot slot = ClientConsists.slot(consistId, index);
            WagonPose pose = slot == null ? null : ClientConsists.renderPose(consistId, index, partialTick);
            if (pose == null) {
                continue;
            }
            WagonType type = slot.type();
            boolean flipped = slot.flipped();
            StockModel model = StockModels.model(type.id());
            boolean hasModel = model != null && !model.isEmpty();
            // the body: its model's walls, or the hull box without one
            Vector3d origin = toFrame(pose.body(), pose.yaw(), pose.pitch(), flipped, eye);
            Vector3d dir = toFrame(pose.body(), pose.yaw(), pose.pitch(), flipped, eye.add(look)).sub(origin);
            double body;
            if (hasModel) {
                body = ClientWagonRay.wall(type.id(), model, origin, dir, reach);
            } else {
                WagonType.Hull hull = type.collidableHull();
                body = HullCollision.rayBox(origin, dir, hull.minX(), hull.minY(), hull.minZ(),
                        hull.maxX(), hull.maxY(), hull.maxZ());
                body = body < 0.0 ? Double.POSITIVE_INFINITY : body;
            }
            Boxes boxes = hasModel ? boxes(type.id(), model) : null;
            for (boolean front : new boolean[] {true, false}) {
                // a flipped wagon's model is turned: its front bogie runs at the path's rear
                boolean modelFront = front != flipped;
                double[] box = boxes == null ? null : modelFront ? boxes.front() : boxes.rear();
                if (box == null) {
                    box = new double[] {-BogieReach.DEFAULT_HALF_WIDTH, 0.0, -BogieReach.DEFAULT_HALF_LENGTH,
                            BogieReach.DEFAULT_HALF_WIDTH, BogieReach.DEFAULT_HEIGHT, BogieReach.DEFAULT_HALF_LENGTH};
                }
                WagonPose.BogiePose bogie = front ? pose.front() : pose.rear();
                Vector3d o = toFrame(bogie.position(), bogie.yaw(), bogie.pitch(), flipped, eye);
                Vector3d d = toFrame(bogie.position(), bogie.yaw(), bogie.pitch(), flipped, eye.add(look)).sub(o);
                double t = HullCollision.rayBox(o, d, box[0], box[1], box[2], box[3], box[4], box[5]);
                if (t < 0.0 || t > reach || t > body + ClientWagonRay.WALL_SLACK) {
                    continue;
                }
                if (best == null || t < best.distance()) {
                    best = new Pick(wagon, front, t);
                }
            }
        }
        if (best == null) {
            return null;
        }
        // something else nearer under the crosshair keeps the click (a
        // wagon's own small centre hitbox doesn't count — the bogie is its part)
        HitResult hit = mc.hitResult;
        if (hit != null && hit.getType() != HitResult.Type.MISS
                && !(hit instanceof EntityHitResult entityHit && entityHit.getEntity() instanceof WagonEntity)
                && hit.getLocation().distanceTo(eye) < best.distance() - 0.05) {
            return null;
        }
        return best;
    }

    /** A world point in a frame at {@code origin} turned by yaw/pitch — and 180° more for a flipped wagon's model. */
    private static Vector3d toFrame(Vector3d origin, float yaw, float pitch, boolean flipped, Vec3 world) {
        Vector3d local = PoseMath.worldToLocal(origin, yaw, pitch, new Vector3d(world.x, world.y, world.z));
        if (flipped) {
            local.set(-local.x, local.y, -local.z);
        }
        return local;
    }

    /** The model's bogie boxes, built the first time the model is asked about. */
    private static Boxes boxes(String typeId, StockModel model) {
        Boxes boxes = BOXES.get(typeId);
        if (boxes == null || boxes.model() != model) {
            boxes = new Boxes(model, box(model.frontBogie()), box(model.rearBogie()));
            BOXES.put(typeId, boxes);
        }
        return boxes;
    }

    /**
     * A bogie's box {@code {minX, minY, minZ, maxX, maxY, maxZ}} in its own
     * frame: its frame's meshes, and each wheelset as it spins — across as
     * drawn, round the axle out to its furthest vertex. Null if the model
     * has no geometry for it.
     */
    private static double[] box(StockModel.Bogie bogie) {
        double[] box = {Double.MAX_VALUE, Double.MAX_VALUE, Double.MAX_VALUE,
                -Double.MAX_VALUE, -Double.MAX_VALUE, -Double.MAX_VALUE};
        for (Mesh mesh : bogie.meshes().values()) {
            for (Mesh.Quad q : mesh.quads()) {
                for (Mesh.Vertex v : List.of(q.v0(), q.v1(), q.v2(), q.v3())) {
                    grow(box, v.x(), v.y(), v.z());
                }
            }
        }
        for (StockModel.Wheel wheel : bogie.wheels()) {
            double reach = 0.0;
            for (Map.Entry<ResourceLocation, Mesh> part : wheel.meshes().entrySet()) {
                for (Mesh.Quad q : part.getValue().quads()) {
                    for (Mesh.Vertex v : List.of(q.v0(), q.v1(), q.v2(), q.v3())) {
                        reach = Math.max(reach, Math.hypot(v.y(), v.z()));
                        grow(box, v.x(), wheel.centerY(), wheel.centerZ());
                    }
                }
            }
            if (reach > 0.0) {
                grow(box, box[0], wheel.centerY() - reach, wheel.centerZ() - reach);
                grow(box, box[0], wheel.centerY() + reach, wheel.centerZ() + reach);
            }
        }
        return box[0] <= box[3] ? box : null;
    }

    private static void grow(double[] box, double x, double y, double z) {
        box[0] = Math.min(box[0], x);
        box[1] = Math.min(box[1], y);
        box[2] = Math.min(box[2], z);
        box[3] = Math.max(box[3], x);
        box[4] = Math.max(box[4], y);
        box[5] = Math.max(box[5], z);
    }
}
