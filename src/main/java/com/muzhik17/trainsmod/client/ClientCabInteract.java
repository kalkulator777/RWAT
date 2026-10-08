package com.muzhik17.trainsmod.client;

import java.util.List;

import org.joml.Matrix4f;
import org.joml.Vector3d;
import org.joml.Vector3f;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.Handles;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.convention.ControlValue;
import com.muzhik17.trainsmod.convention.ObjectRole;
import com.muzhik17.trainsmod.kinematics.HullCollision;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.network.CabLeverPayload;
import com.muzhik17.trainsmod.network.ControlGroupPayload;
import com.muzhik17.trainsmod.network.SeatPayload;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.phys.EntityHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.InputEvent;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * Working the cab with the mouse (SPEC §9.2–§9.3, IR-style): right-click a
 * control. A switch ({@code TOGGLE}) flips, a button ({@code PRESS}) is held
 * while the button is; anything else — a lever, a window, a chair — is
 * <b>dragged</b> while the button is held: each tick the control's travel is
 * set to the position whose grabbed point comes nearest the look ray at the
 * distance it was grabbed at, so the lever follows the view. A handle lever
 * snaps to its notches and sends the notch when it changes
 * ({@link CabLeverPayload}); other controls send their group value
 * ({@link ControlGroupPayload}). Right-clicking the driver's chair sits down.
 *
 * <p>Controls are picked like doors: the look ray goes into the wagon's local
 * frame (and the model's, for a turned wagon) and is tested against each
 * control's box where its value has moved it. A rider picks only on their own
 * wagon; from outside, the nearby wagons' controls within reach. A nearer
 * door, block or entity keeps the click.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientCabInteract {

    /** How far a control can be worked from, blocks (IR: 3). */
    private static final double REACH = 3.0;
    /** Click-box padding around a control (IR: 0.05). */
    private static final float PAD = 0.05F;
    /** Steps the travel search samples (fine enough for 8 notches and a 270° gauge). */
    private static final int SEARCH_STEPS = 64;
    /** A dragged group control sends again only after moving this much. */
    private static final float SEND_STEP = 0.02F;

    /** The control being dragged or held, or null. */
    private static Grab grab;
    /** False after a click until the use button is released (vanilla repeats use while held). */
    private static boolean armed = true;

    private record Grab(WagonEntity wagon, StockModel.Control control, Vector3f grabPoint,
            double distance, float[] position, float[] sent) {
    }

    private record Pick(WagonEntity wagon, StockModel.Control control, Vector3f hit,
            double distance, boolean seat) {
    }

    private ClientCabInteract() {
    }

    /**
     * Where the local player holds a control right now, or null if they don't
     * — the renderer shows a dragged lever there instead of where the server
     * last put it.
     */
    public static Float draggedPosition(WagonEntity wagon, StockModel.Control control) {
        Grab current = grab;
        return current != null && current.wagon == wagon && current.control == control
                ? current.position[0] : null;
    }

    @SubscribeEvent
    static void onUse(InputEvent.InteractionKeyMappingTriggered event) {
        if (!event.isUseItem() || event.getHand() != InteractionHand.MAIN_HAND) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer player = mc.player;
        if (player == null || mc.level == null) {
            return;
        }
        if (grab != null || !armed) {
            if (grab != null) {
                event.setCanceled(true); // still holding a control: not a new click
                event.setSwingHand(false);
            }
            return;
        }
        Pick pick = pick(mc, player);
        if (pick == null || ClientDoorInteract.doorDistance(mc, player) < pick.distance) {
            return; // nothing here, or a door in front of it takes the click
        }
        event.setCanceled(true);
        event.setSwingHand(false);
        armed = false;
        if (pick.seat) {
            PacketDistributor.sendToServer(new SeatPayload(pick.wagon.getId(), true));
            return;
        }
        StockModel.Control control = pick.control;
        ObjectRole.Control role = control.role();
        float now = position(pick.wagon, control);
        if (role.toggle()) {
            float flipped = now >= 0.5F ? 0.0F : 1.0F;
            send(pick.wagon, control, flipped);
            status(player, role, flipped);
            return;
        }
        if (role.press()) {
            send(pick.wagon, control, 1.0F);
        }
        // a lever, window, chair or held button: drag/hold until released
        Vector3f grabPoint = restPoint(control, now, pick.hit);
        grab = new Grab(pick.wagon, control, grabPoint, pick.distance,
                new float[]{now}, new float[]{now});
        status(player, role, now);
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        boolean held = mc.options.keyUse.isDown();
        if (!held) {
            armed = true;
        }
        Grab current = grab;
        if (current == null) {
            return;
        }
        LocalPlayer player = mc.player;
        if (player == null || !held || current.wagon.isRemoved()) {
            if (current.control.role().press()) {
                send(current.wagon, current.control, 0.0F);
            }
            grab = null;
            return;
        }
        if (current.control.role().press()) {
            return; // a button: just held down
        }
        drag(mc, player, current);
    }

    /** Follow the look ray: the travel whose grabbed point comes nearest it. */
    private static void drag(Minecraft mc, LocalPlayer player, Grab current) {
        float partialTick = mc.getTimer().getGameTimeDeltaPartialTick(true);
        Vec3 eye = player.getEyePosition(partialTick);
        Vec3 look = player.getViewVector(partialTick);
        Vec3 target = eye.add(look.scale(current.distance));
        Vector3f t = toModel(current.wagon, target);
        if (t == null) {
            return;
        }
        ObjectRole.Control role = current.control.role();
        Matrix4f m = new Matrix4f();
        Vector3f p = new Vector3f();
        float best = current.position[0];
        float bestDist = Float.MAX_VALUE;
        for (int i = 0; i <= SEARCH_STEPS; i++) {
            float pos = i / (float) SEARCH_STEPS;
            current.control.transform(ControlValue.value(role, pos), m).transformPosition(
                    current.grabPoint, p);
            float d = p.distanceSquared(t);
            if (d < bestDist) {
                bestDist = d;
                best = pos;
            }
        }
        Consist.Handle handle = ControlValue.handle(role.kind());
        if (handle != null) {
            int notch = Handles.fromTravel(handle, best);
            float snapped = new Handles(notch, notch, notch, notch, -1).travel(handle);
            current.position[0] = snapped;
            if (snapped != current.sent[0]) {
                current.sent[0] = snapped;
                PacketDistributor.sendToServer(new CabLeverPayload(current.wagon.getId(),
                        handle.ordinal(), notch));
                status(player, role, snapped);
            }
            return;
        }
        current.position[0] = best;
        if (Math.abs(best - current.sent[0]) >= SEND_STEP || (best != current.sent[0]
                && (best == 0.0F || best == 1.0F))) {
            current.sent[0] = best;
            send(current.wagon, current.control, best);
        }
    }

    /** Set a control: a handle lever by its notch, anything else by its group value. */
    private static void send(WagonEntity wagon, StockModel.Control control, float position) {
        ObjectRole.Control role = control.role();
        Consist.Handle handle = ControlValue.handle(role.kind());
        if (handle != null) {
            PacketDistributor.sendToServer(new CabLeverPayload(wagon.getId(), handle.ordinal(),
                    Handles.fromTravel(handle, position)));
        } else {
            PacketDistributor.sendToServer(new ControlGroupPayload(wagon.getId(), false,
                    role.group(), position));
        }
    }

    /** The control's name and setting on the action bar while it is worked. */
    private static void status(LocalPlayer player, ObjectRole.Control role, float position) {
        String name = role.label() != null && !role.label().isBlank() ? role.label()
                : Component.translatable("control.railswheelsandtrains."
                        + role.kind().name().toLowerCase(java.util.Locale.ROOT)).getString();
        Consist.Handle handle = ControlValue.handle(role.kind());
        String setting;
        if (handle == Consist.Handle.REVERSER) {
            int r = Handles.fromTravel(handle, position);
            setting = r > 0 ? "F" : r < 0 ? "R" : "N";
        } else if (handle != null) {
            setting = Handles.fromTravel(handle, position) + "/" + Consist.NOTCHES;
        } else if (role.toggle() || role.press()) {
            setting = Component.translatable(position >= 0.5F
                    ? "control.railswheelsandtrains.on" : "control.railswheelsandtrains.off").getString();
        } else {
            setting = Math.round(position * 100.0F) + "%";
        }
        player.displayClientMessage(Component.literal(name + ": " + setting), true);
    }

    /** A control's current raw position, as the renderer shows it. */
    private static float position(WagonEntity wagon, StockModel.Control control) {
        Handles handles = ClientConsists.handles(wagon.getConsistId());
        return ControlValue.position(control.role(), handles,
                handles.activeCab() == wagon.getWagonIndex(),
                wagon.controlValue(control.role().group()),
                new ControlValue.Readings(0.0, 0.0));
    }

    /** The hit point taken back to the control's rest pose (the point that moves with it). */
    private static Vector3f restPoint(StockModel.Control control, float position, Vector3f hit) {
        Matrix4f m = control.transform(ControlValue.value(control.role(), position), new Matrix4f());
        return m.invert().transformPosition(new Vector3f(hit));
    }

    /** The nearest control or driver's chair under the crosshair, within reach. */
    private static Pick pick(Minecraft mc, LocalPlayer player) {
        float partialTick = mc.getTimer().getGameTimeDeltaPartialTick(true);
        Vec3 eye = player.getEyePosition(partialTick);
        Vec3 look = player.getViewVector(partialTick);
        double reach = Math.min(REACH, player.blockInteractionRange());
        List<WagonEntity> wagons = player.getVehicle() instanceof WagonEntity own
                ? List.of(own)
                : mc.level.getEntitiesOfClass(WagonEntity.class,
                        player.getBoundingBox().inflate(reach + 16.0));
        Pick best = null;
        for (WagonEntity wagon : wagons) {
            ConsistComposition.Slot slot = ClientConsists.slot(wagon.getConsistId(), wagon.getWagonIndex());
            StockModel model = slot == null ? null : StockModels.model(slot.type().id());
            if (model == null) {
                continue;
            }
            Vector3f origin = toModel(wagon, eye);
            Vector3f far = toModel(wagon, eye.add(look));
            if (origin == null || far == null) {
                continue;
            }
            Vector3d o = new Vector3d(origin);
            Vector3d dir = new Vector3d(far).sub(o);
            // the driver's chair, for a rider of this wagon who isn't in it
            WagonType.Seat seat = slot.type().cab() != null ? slot.type().cab().seat() : null;
            if (seat != null && player.getVehicle() == wagon && !wagon.isSeated(player)) {
                double t = HullCollision.rayBox(o, dir, seat.x() - 0.35, seat.y() - 0.5, seat.z() - 0.35,
                        seat.x() + 0.35, seat.y() + 0.7, seat.z() + 0.35);
                if (t >= 0.0 && t <= reach && (best == null || t < best.distance)) {
                    best = new Pick(wagon, null, null, t, true);
                }
            }
            Matrix4f m = new Matrix4f();
            for (StockModel.Control control : model.controls()) {
                ObjectRole.Control role = control.role();
                if (role.noTouch() || role.kind().gauge()) {
                    continue;
                }
                float position = position(wagon, control);
                if (!ControlValue.visible(role, position)) {
                    continue;
                }
                control.transform(ControlValue.value(role, position), m);
                float[] box = movedBox(control, m);
                double t = HullCollision.rayBox(o, dir, box[0] - PAD, box[1] - PAD, box[2] - PAD,
                        box[3] + PAD, box[4] + PAD, box[5] + PAD);
                if (t < 0.0 || t > reach || (best != null && t >= best.distance)) {
                    continue;
                }
                Vector3f hit = new Vector3f((float) (o.x + dir.x * t), (float) (o.y + dir.y * t),
                        (float) (o.z + dir.z * t));
                best = new Pick(wagon, control, hit, t, false);
            }
        }
        if (best == null) {
            return null;
        }
        // something else nearer under the crosshair keeps the click (the
        // wagon's own small centre hitbox doesn't count)
        HitResult hit = mc.hitResult;
        if (hit != null && hit.getType() != HitResult.Type.MISS
                && !(hit instanceof EntityHitResult entityHit && entityHit.getEntity() == best.wagon)
                && hit.getLocation().distanceTo(eye) < best.distance - 0.05) {
            return null;
        }
        return best;
    }

    /** A control's rest box moved by {@code m}: the bounds of its eight moved corners. */
    private static float[] movedBox(StockModel.Control control, Matrix4f m) {
        float[] box = {Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE,
                -Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};
        Vector3f lo = control.boxMin();
        Vector3f hi = control.boxMax();
        Vector3f c = new Vector3f();
        for (int i = 0; i < 8; i++) {
            c.set((i & 1) == 0 ? lo.x : hi.x, (i & 2) == 0 ? lo.y : hi.y, (i & 4) == 0 ? lo.z : hi.z);
            m.transformPosition(c);
            box[0] = Math.min(box[0], c.x);
            box[1] = Math.min(box[1], c.y);
            box[2] = Math.min(box[2], c.z);
            box[3] = Math.max(box[3], c.x);
            box[4] = Math.max(box[4], c.y);
            box[5] = Math.max(box[5], c.z);
        }
        return box;
    }

    /**
     * A world point in the wagon's <b>model</b> frame: the pose frame, turned
     * 180° for a wagon running flipped (the renderer turns the model so).
     */
    private static Vector3f toModel(WagonEntity wagon, Vec3 world) {
        Vector3d local = PoseMath.worldToLocal(new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ()),
                wagon.getYRot(), wagon.getXRot(), new Vector3d(world.x, world.y, world.z));
        if (wagon.isFlipped()) {
            local.set(-local.x, local.y, -local.z);
        }
        return new Vector3f((float) local.x, (float) local.y, (float) local.z);
    }
}
