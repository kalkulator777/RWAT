package com.muzhik17.trainsmod.client;

import java.util.List;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.consist.CabAccess;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.HullCollision;
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
 * wagon's model frame and tested against its doors' leaves <b>where they are
 * drawn now</b> — an open door is closed by clicking its leaf — or, for a
 * leaf the model doesn't move, the door's box ({@link ClientWagonRay}). A
 * wall of the car's model in front of the leaf keeps the click from it (no
 * opening doors through partitions); without the model, from outside only a
 * leaf on the near face of the hull counts. A rider picks among their own
 * wagon's doors from inside, and the next car's gangway door across the
 * gangway. A nearer block or entity under the crosshair keeps the click.
 * The door is picked once per frame, against the car as drawn in it
 * ({@link ClientWagonRay}); a click takes what the last frame picked.
 *
 * <p>Holding the button doesn't flap the door: vanilla repeats the use action
 * every few ticks while held, so a door click is armed again only after the
 * button is released.
 *
 * <p>A door into a cab, on a server whose cabs want the driver's key (SPEC
 * §9.2), isn't sent without one: the action bar says the key is needed.
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
    /** The door under the crosshair in the last frame ({@link ClientWagonRay}), or null. */
    private static Pick framePick;

    private ClientDoorInteract() {
    }

    /** Pick the door under the crosshair for this frame (SPEC §9.3: as drawn, from the frame's eye). */
    static void frame(Minecraft mc, LocalPlayer player, ClientWagonRay.Look look) {
        framePick = pick(mc, player, look);
    }

    /**
     * The door of this wagon under the crosshair (its index in the type's
     * doors), −1 if none — or if a control or chair in front of it takes the
     * click ({@link ClientCabInteract#takesClick}): the outline shows what a
     * click works, never two things at once.
     */
    public static int highlightedDoor(WagonEntity wagon) {
        Pick pick = framePick;
        return pick != null && pick.wagon() == wagon && !ClientCabInteract.takesClick() ? pick.door() : -1;
    }

    /** True if the door under the crosshair won't open for the player: a cab door, no driver's key (SPEC §9.2). */
    public static boolean highlightLocked() {
        Pick pick = framePick;
        LocalPlayer player = Minecraft.getInstance().player;
        return pick != null && player != null && pick.wagon().cabArea().cabDoor(pick.door())
                && !CabAccess.mayWork(player);
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
        Pick pick = framePick;
        if (pick == null || pick.wagon().isRemoved()) {
            return;
        }
        event.setCanceled(true); // the click belongs to the door, not an item or block
        // a door into a cab wants the driver's key, if the server wants it (SPEC §9.2): not sent
        boolean locked = pick.wagon().cabArea().cabDoor(pick.door()) && !CabAccess.mayWork(player);
        event.setSwingHand(armed && !locked);
        if (armed) {
            armed = false;
            if (locked) {
                CabAccess.refuse(player);
            } else {
                PacketDistributor.sendToServer(new DoorTogglePayload(pick.wagon().getId(), pick.door()));
            }
        }
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        if (!Minecraft.getInstance().options.keyUse.isDown()) {
            armed = true;
        }
    }

    /** Drop the pick (logout, another level): its wagon went with the level. */
    public static void clear() {
        framePick = null;
    }

    /** A door under the crosshair; {@code byBox}: by the door's box, as its leaf isn't moved by the model. */
    private record Pick(WagonEntity wagon, int door, double distance, boolean byBox) {
    }

    /** How far along the look the rider's own car has a wall (its model's body and interior), or +∞. */
    private static double wallAhead(WagonEntity wagon, ClientWagonRay.Look look, double reach) {
        WagonType type = wagon.typeNow();
        StockModel model = type == null ? null : StockModels.model(type.id());
        if (model == null) {
            return Double.POSITIVE_INFINITY;
        }
        ClientWagonRay.LocalRay ray = ClientWagonRay.inModel(wagon, look);
        return ClientWagonRay.wall(type.id(), model, ray.origin(), ray.dir(), reach);
    }

    /** Distance to the door leaf under the crosshair this frame, or +∞ — a cab control behind it yields. */
    static double doorDistance() {
        Pick pick = framePick;
        return pick == null ? Double.POSITIVE_INFINITY : pick.distance();
    }

    /**
     * The nearest door leaf under the crosshair within reach, or null. A
     * rider picks among their own wagon's doors and, through the gangway,
     * the next car's connecting door: looking through their own open
     * connecting door at the next car's shut one, the click is that one's —
     * a shut door of the next car is wall until they open it (SPEC §9.5).
     */
    private static Pick pick(Minecraft mc, LocalPlayer player, ClientWagonRay.Look look) {
        float partialTick = look.partialTick();
        Vec3 eye = look.eye();
        double reach = player.blockInteractionRange();
        WagonEntity own = player.getVehicle() instanceof WagonEntity w ? w : null;
        double ownWall = own == null ? Double.POSITIVE_INFINITY : wallAhead(own, look, reach);
        List<WagonEntity> wagons = mc.level.getEntitiesOfClass(WagonEntity.class,
                player.getBoundingBox().inflate(reach + 16.0));

        Pick best = null;
        Pick shutBeyond = null; // the nearest shut connecting door of another car, for a rider
        for (WagonEntity wagon : wagons) {
            WagonType type = wagon.typeNow();
            if (type == null || type.doors().isEmpty()) {
                continue;
            }
            // the model frame as drawn this frame: the doors' boxes, the leaves and the walls are all in it
            ClientWagonRay.LocalRay ray = ClientWagonRay.inModel(wagon, look);
            Vector3d origin = ray.origin();
            Vector3d dir = ray.dir();
            boolean inside = own == wagon;
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
            // a door behind a wall of its car — or of the car the rider is in — isn't reached
            StockModel model = StockModels.model(type.id());
            double wall = model == null ? Double.POSITIVE_INFINITY
                    : ClientWagonRay.wall(type.id(), model, origin, dir, reach);
            double limit = Math.min(wall, inside ? Double.POSITIVE_INFINITY : ownWall) + ClientWagonRay.WALL_SLACK;
            for (int i = 0; i < type.doors().size() && i < 32; i++) {
                WagonType.Door d = type.doors().get(i);
                if (d.fixed() || (own != null && !inside && !d.connecting())) {
                    continue; // no leaf to click (SPEC §9.1); a rider reaches only the next car's gangway door
                }
                // the leaves where they are drawn now; a door whose leaf the model doesn't move: its box
                double t = model == null ? Double.NaN
                        : ClientWagonRay.leaves(wagon, type.id(), model, type, i, origin, dir, partialTick);
                boolean byBox = Double.isNaN(t);
                if (byBox) {
                    double padX = d.axis() == 0 ? PAD_ACROSS : PAD_EDGE;
                    double padZ = d.axis() == 0 ? PAD_EDGE : PAD_ACROSS;
                    t = HullCollision.rayBox(origin, dir,
                            d.minX() - padX, d.minY() - PAD_EDGE, d.minZ() - padZ,
                            d.maxX() + padX, d.maxY() + PAD_EDGE, d.maxZ() + padZ);
                    if (model == null && !inside && t > hullT + NEAR_FACE_SLACK) {
                        continue; // no walls to see by: from outside, only a leaf on the near face
                    }
                }
                if (t < 0.0 || t > reach || t > limit) {
                    continue;
                }
                if (best == null || t < best.distance()) {
                    best = new Pick(wagon, i, t, byBox);
                }
                if (own != null && !inside && !wagon.isDoorOpen(i)
                        && (shutBeyond == null || t < shutBeyond.distance())) {
                    shutBeyond = new Pick(wagon, i, t, byBox);
                }
            }
        }
        if (best == null) {
            return null;
        }
        if (shutBeyond != null && best.wagon() == own && best.byBox() && best.distance() < shutBeyond.distance()
                && own.typeNow().doors().get(best.door()).connecting() && own.isDoorOpen(best.door())) {
            // our open gangway door picked by its box (its leaf drawn shut in place) fills the
            // doorway we look through: the click is the next car's shut door beyond it
            best = shutBeyond;
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
