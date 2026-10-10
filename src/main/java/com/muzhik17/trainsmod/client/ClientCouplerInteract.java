package com.muzhik17.trainsmod.client;

import java.util.List;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.HullCollision;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.network.HandbrakePayload;
import com.muzhik17.trainsmod.network.UncouplePayload;
import com.muzhik17.trainsmod.stock.ConsistComposition;
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
 * Right-click a coupler with the crowbar to uncouple there (SPEC §6.12), or a
 * wagon's body away from its coupled ends to turn its handbrake wheel
 * (SPEC §5.3).
 * The wagon entity's own hitbox is a small box at the body centre, so — like
 * {@link ClientDoorInteract} — the coupler is picked here: the look ray is
 * taken into each nearby wagon's local frame and tested against
 * <ul>
 *   <li>the <b>coupler</b> at each coupled end — a box across the track
 *       around the coupler point, spanning the
 *       {@link ConsistComposition#COUPLER_GAP} plus a bit of either frame,
 *       from the rail up to buffer height; and
 *   <li>the <b>hull near a coupled end</b> — clicking a car's end (within
 *       {@link #END_ZONE}) means its coupler, the natural aim from the side.
 * </ul>
 * The nearest hit wins; a hull in front of it (aiming through a car) or a
 * nearer block keeps the click. A hull hit anywhere else on the car is its
 * handbrake. Runs before the door pick: with the crowbar
 * in hand a coupler beats a door next to it, and a miss falls through to the
 * doors and the item (which hints what it is for).
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientCouplerInteract {

    /** Half-width of the coupler pick box across the track. */
    private static final double HALF_WIDTH = 1.2;
    /** Height of the coupler pick box in model space: rail level up to above the buffers. */
    private static final double MIN_Y = 0.0;
    private static final double MAX_Y = 2.4;
    /** How far the coupler box reaches into each frame end past the gap. */
    private static final double INTO_FRAME = 0.75;
    /** Clicking the hull within this of a coupled end picks that end's coupler. */
    private static final double END_ZONE = 2.5;
    /** A coupler hit this far behind the nearest hull hit is seen through a car — not taken. */
    private static final double OCCLUSION_SLACK = 0.3;

    /** False after an uncouple click until the use button is released. */
    private static boolean armed = true;

    private ClientCouplerInteract() {
    }

    @SubscribeEvent(priority = EventPriority.HIGH)
    static void onUse(InputEvent.InteractionKeyMappingTriggered event) {
        if (!event.isUseItem() || event.getHand() != InteractionHand.MAIN_HAND) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer player = mc.player;
        if (player == null || mc.level == null
                || !player.getMainHandItem().is(RailsWheelsAndTrains.CROWBAR.get())) {
            return;
        }
        Pick pick = pick(mc, player);
        if (pick == null) {
            return; // no coupler under the crosshair: doors / the item's hint
        }
        event.setCanceled(true); // the click belongs to the coupler / the handbrake
        event.setSwingHand(armed);
        if (armed) {
            armed = false;
            PacketDistributor.sendToServer(pick.handbrake()
                    ? new HandbrakePayload(pick.wagon().getId())
                    : new UncouplePayload(pick.wagon().getId(), pick.front()));
        }
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        if (!Minecraft.getInstance().options.keyUse.isDown()) {
            armed = true;
        }
    }

    /**
     * A coupler — the {@code front} (towards index − 1) or rear end of
     * {@code wagon} — or, if {@code handbrake}, the wagon's handbrake.
     */
    private record Pick(WagonEntity wagon, boolean front, boolean handbrake, double distance) {
    }

    /** The nearest coupler (or handbrake) under the crosshair within reach, or null. */
    private static Pick pick(Minecraft mc, LocalPlayer player) {
        float partialTick = mc.getTimer().getGameTimeDeltaPartialTick(true);
        Vec3 eye = player.getEyePosition(partialTick);
        Vec3 look = player.getViewVector(partialTick);
        double reach = player.blockInteractionRange();
        List<WagonEntity> wagons = mc.level.getEntitiesOfClass(WagonEntity.class,
                player.getBoundingBox().inflate(reach + 16.0));

        Pick best = null;
        double nearestHull = Double.MAX_VALUE;
        for (WagonEntity wagon : wagons) {
            int consistId = wagon.getConsistId();
            int index = wagon.getWagonIndex();
            ConsistComposition.Slot slot = ClientConsists.slot(consistId, index);
            if (slot == null) {
                continue;
            }
            boolean hasFront = index > 0 && ClientConsists.slot(consistId, index - 1) != null;
            boolean hasRear = ClientConsists.slot(consistId, index + 1) != null;

            Vector3d body = new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ());
            Vector3d origin = PoseMath.worldToLocal(body, wagon.getYRot(), wagon.getXRot(),
                    new Vector3d(eye.x, eye.y, eye.z));
            Vector3d dir = PoseMath.worldToLocal(body, wagon.getYRot(), wagon.getXRot(),
                    new Vector3d(eye.x + look.x, eye.y + look.y, eye.z + look.z)).sub(origin);

            // the pose frame's +Z is the path-forward end (towards index − 1),
            // whichever way the model is turned; the frame is centred on the body
            if (hasRear) {
                double rear = slot.rearCouplerReach();
                best = nearer(best, wagon, false, reach, HullCollision.rayBox(origin, dir,
                        -HALF_WIDTH, MIN_Y, -rear - ConsistComposition.COUPLER_GAP - INTO_FRAME,
                        HALF_WIDTH, MAX_Y, -rear + INTO_FRAME));
            }
            if (hasFront) {
                double front = slot.frontCouplerReach();
                best = nearer(best, wagon, true, reach, HullCollision.rayBox(origin, dir,
                        -HALF_WIDTH, MIN_Y, front - INTO_FRAME,
                        HALF_WIDTH, MAX_Y, front + ConsistComposition.COUPLER_GAP + INTO_FRAME));
            }

            // the hull: an end-zone hit means that end's coupler, any hit occludes
            WagonType.Hull hull = wagon.collisionHull();
            if (hull == null || player.getVehicle() == wagon) {
                continue; // from inside, only the coupler boxes count
            }
            double t = HullCollision.rayBox(origin, dir, hull.minX(), hull.minY(), hull.minZ(),
                    hull.maxX(), hull.maxY(), hull.maxZ());
            if (t < 0.0) {
                continue;
            }
            nearestHull = Math.min(nearestHull, t);
            double z = origin.z + dir.z * t;
            if (hasRear && z < hull.minZ() + END_ZONE) {
                best = nearer(best, wagon, false, reach, t);
            } else if (hasFront && z > hull.maxZ() - END_ZONE) {
                best = nearer(best, wagon, true, reach, t);
            } else {
                best = nearer(best, new Pick(wagon, false, true, t), reach);
            }
        }
        if (best == null || best.distance() > nearestHull + OCCLUSION_SLACK) {
            return null;
        }
        // something else nearer under the crosshair keeps the click (a wagon's
        // own small centre hitbox doesn't count — the coupler is its part)
        HitResult hit = mc.hitResult;
        if (hit != null && hit.getType() != HitResult.Type.MISS
                && !(hit instanceof EntityHitResult entityHit && entityHit.getEntity() instanceof WagonEntity)
                && hit.getLocation().distanceTo(eye) < best.distance() - 0.05) {
            return null;
        }
        return best;
    }

    /** {@code best}, or the coupler hit at {@code t} if it is a nearer one within reach. */
    private static Pick nearer(Pick best, WagonEntity wagon, boolean front, double reach, double t) {
        return nearer(best, new Pick(wagon, front, false, t), reach);
    }

    /** {@code best}, or {@code hit} if it is a nearer one within reach. */
    private static Pick nearer(Pick best, Pick hit, double reach) {
        double t = hit.distance();
        if (t < 0.0 || t > reach || (best != null && t >= best.distance())) {
            return best;
        }
        return hit;
    }
}
