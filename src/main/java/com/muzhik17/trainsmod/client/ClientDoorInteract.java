package com.muzhik17.trainsmod.client;

import java.util.List;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.HullCollision;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.network.DoorTogglePayload;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.InteractionHand;
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
 * Right-click a wagon door to open or close it (SPEC v1.5, doors, IR-style).
 * The wagon entity's own hitbox is a small box at the body centre, so the door
 * leaves are picked here instead: the look ray is taken into each nearby
 * wagon's local frame and tested against its door boxes. From outside, a leaf
 * only counts if it is on the near face of the hull (not seen through the
 * car); a rider picks among their own wagon's doors from inside. A nearer
 * block or entity under the crosshair keeps the click.
 *
 * <p>Holding the button doesn't flap the door: vanilla repeats the use action
 * every few ticks while held, so a door click is armed again only after the
 * button is released.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientDoorInteract {

    /** Click-box padding across the wall (the leaf is ~0.1 thick) … */
    private static final double PAD_ACROSS = 0.15;
    /** … and around its edges. */
    private static final double PAD_EDGE = 0.02;
    /**
     * From outside, how far behind the point where the ray enters the hull a
     * leaf may sit and still be on the near face (the leaf is inset ~0.15–0.25
     * from the hull face; the far side is a car width away).
     */
    private static final double NEAR_FACE_SLACK = 0.6;

    /** False after a door click until the use button is released. */
    private static boolean armed = true;

    private ClientDoorInteract() {
    }

    @SubscribeEvent(priority = EventPriority.LOW) // after the cab's controls (ClientCabInteract)
    static void onUse(InputEvent.InteractionKeyMappingTriggered event) {
        if (!event.isUseItem() || event.getHand() != InteractionHand.MAIN_HAND) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer player = mc.player;
        if (player == null || mc.level == null) {
            return;
        }
        Pick pick = pick(mc, player);
        if (pick == null) {
            return;
        }
        event.setCanceled(true); // the click belongs to the door, not an item or block
        event.setSwingHand(armed);
        if (armed) {
            armed = false;
            PacketDistributor.sendToServer(new DoorTogglePayload(pick.wagon().getId(), pick.door()));
        }
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        if (!Minecraft.getInstance().options.keyUse.isDown()) {
            armed = true;
        }
    }

    private record Pick(WagonEntity wagon, int door, double distance) {
    }

    /** Distance to the door leaf under the crosshair, or +∞ — a cab control behind it yields. */
    static double doorDistance(Minecraft mc, LocalPlayer player) {
        Pick pick = pick(mc, player);
        return pick == null ? Double.POSITIVE_INFINITY : pick.distance();
    }

    /** The nearest door leaf under the crosshair within reach, or null. */
    private static Pick pick(Minecraft mc, LocalPlayer player) {
        float partialTick = mc.getTimer().getGameTimeDeltaPartialTick(true);
        Vec3 eye = player.getEyePosition(partialTick);
        Vec3 look = player.getViewVector(partialTick);
        double reach = player.blockInteractionRange();
        List<WagonEntity> wagons = player.getVehicle() instanceof WagonEntity own
                ? List.of(own)
                : mc.level.getEntitiesOfClass(WagonEntity.class,
                        player.getBoundingBox().inflate(reach + 16.0));

        Pick best = null;
        for (WagonEntity wagon : wagons) {
            List<WagonType.Door> doors = wagon.framedDoors();
            if (doors.isEmpty()) {
                continue;
            }
            Vector3d body = new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ());
            Vector3d origin = PoseMath.worldToLocal(body, wagon.getYRot(), wagon.getXRot(),
                    new Vector3d(eye.x, eye.y, eye.z));
            Vector3d dir = PoseMath.worldToLocal(body, wagon.getYRot(), wagon.getXRot(),
                    new Vector3d(eye.x + look.x, eye.y + look.y, eye.z + look.z)).sub(origin);
            boolean inside = player.getVehicle() == wagon;
            double hullT = 0.0;
            if (!inside) {
                WagonType.Hull hull = wagon.collisionHull();
                if (hull == null) {
                    continue;
                }
                hullT = HullCollision.rayBox(origin, dir, hull.minX(), hull.minY(), hull.minZ(),
                        hull.maxX(), hull.maxY(), hull.maxZ());
                if (hullT < 0.0) {
                    continue; // the ray misses the car; its doors are inside the hull box
                }
            }
            for (int i = 0; i < doors.size(); i++) {
                WagonType.Door d = doors.get(i);
                if (d.fixed()) {
                    continue; // an opening without a leaf: nothing to click (SPEC §9.1)
                }
                double padX = d.axis() == 0 ? PAD_ACROSS : PAD_EDGE;
                double padZ = d.axis() == 0 ? PAD_EDGE : PAD_ACROSS;
                double t = HullCollision.rayBox(origin, dir,
                        d.minX() - padX, d.minY() - PAD_EDGE, d.minZ() - padZ,
                        d.maxX() + padX, d.maxY() + PAD_EDGE, d.maxZ() + padZ);
                if (t < 0.0 || t > reach || (!inside && t > hullT + NEAR_FACE_SLACK)) {
                    continue;
                }
                if (best == null || t < best.distance()) {
                    best = new Pick(wagon, i, t);
                }
            }
        }
        if (best == null) {
            return null;
        }
        // something else nearer under the crosshair keeps the click (the
        // wagon's own small centre hitbox doesn't count — the door is its part)
        HitResult hit = mc.hitResult;
        if (hit != null && hit.getType() != HitResult.Type.MISS
                && !(hit instanceof EntityHitResult entityHit && entityHit.getEntity() == best.wagon())
                && hit.getLocation().distanceTo(eye) < best.distance() - 0.05) {
            return null;
        }
        return best;
    }
}
