package com.muzhik17.trainsmod.client;

import java.util.List;
import java.util.Locale;

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
import com.muzhik17.trainsmod.network.HandbrakePayload;
import com.muzhik17.trainsmod.network.SeatPayload;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.resources.language.I18n;
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
 * ({@link ControlGroupPayload}). Handle levers move only for the player at
 * the controls (SPEC §9.7: in the driver's chair); walking about the cab they
 * are named with a hint to sit down. Right-clicking the driver's chair sits down.
 *
 * <p>Controls are picked like doors: the look ray goes into the wagon's local
 * frame (and the model's, for a turned wagon) and is tested against each
 * control's box where its value has moved it. A rider picks only on their own
 * wagon; from outside, the nearby wagons' controls within reach. A nearer
 * door, block or entity keeps the click.
 *
 * <p>The ray is always taken at the <b>end of the tick</b> (eye and look at
 * partial tick 1), the moment the wagon's entity pose belongs to: clicks and
 * drags run in the tick, and an eye interpolated to the frame's partial tick
 * against the tick's wagon pose put the ray up to a tick's travel off on a
 * moving train — the dragged lever jumped between notches (play-test).
 *
 * <p>The control under the crosshair is <b>hovered</b> (SPEC §9.3): the
 * renderer outlines it and {@link ClientCabHud} names it with its setting.
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
    /** The pick ray's time: the end of the tick, when the wagon's entity pose is current. */
    private static final float RAY_TIME = 1.0F;

    /** The control being dragged or held, or null. */
    private static Grab grab;
    /** The control or chair under the crosshair (this tick), or null. */
    private static Pick hover;
    /** False after a click until the use button is released (vanilla repeats use while held). */
    private static boolean armed = true;

    private record Grab(WagonEntity wagon, StockModel.Control control, Vector3f grabPoint,
            double distance, float[] position, float[] sent) {
    }

    /** A control, or driver's chair {@code seat} (its index in {@code cab.seats}; −1 = a control). */
    private record Pick(WagonEntity wagon, StockModel.Control control, Vector3f hit,
            double distance, int seat) {
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

    /** True if this control is under the crosshair or in the player's hand (the renderer outlines it). */
    public static boolean highlighted(WagonEntity wagon, StockModel.Control control) {
        Grab current = grab;
        if (current != null) {
            return current.wagon == wagon && current.control == control;
        }
        Pick now = hover;
        return now != null && now.wagon == wagon && now.control == control;
    }

    /** The driver's chair of this wagon under the crosshair (its index in {@code cab.seats}), −1 if none. */
    public static int highlightedSeat(WagonEntity wagon) {
        Pick now = hover;
        return grab == null && now != null && now.wagon == wagon ? now.seat : -1;
    }

    /**
     * The crosshair label (SPEC §9.3): what the hovered or held control does
     * and its setting, or the chair's hint; empty when there's nothing.
     */
    public static List<Component> hudLines() {
        Grab current = grab;
        if (current != null) {
            return List.of(Component.literal(controlName(current.wagon, current.control.role())),
                    Component.literal(setting(current.control.role(), current.position[0]))
                            .withStyle(ChatFormatting.YELLOW));
        }
        Pick now = hover;
        if (now == null) {
            return List.of();
        }
        if (now.seat >= 0) {
            return List.of(Component.translatable("control.railswheelsandtrains.seat"),
                    Component.translatable("control.railswheelsandtrains.seat_hint")
                            .withStyle(ChatFormatting.GRAY));
        }
        ObjectRole.Control role = now.control.role();
        Component name = Component.literal(controlName(now.wagon, role));
        // the handbrake wheel is labelled by the handbrake itself, not by how far it has wound
        float shown = role.kind() == ObjectRole.Kind.HANDBRAKE
                ? (ClientConsists.handbrake(now.wagon.getConsistId(), now.wagon.getWagonIndex()) ? 1.0F : 0.0F)
                : position(now.wagon, now.control);
        Component value = Component.literal(setting(role, shown)).withStyle(ChatFormatting.GRAY);
        if (!mayWork(now.wagon, now.control)) {
            return List.of(name, value, Component.translatable("control.railswheelsandtrains.from_seat")
                    .withStyle(ChatFormatting.GRAY));
        }
        return List.of(name, value);
    }

    /**
     * True if the local player may work this control: a handle lever only at
     * the controls of its own wagon — in the driver's chair, or in a cab
     * without a walkable interior (SPEC §9.7: the server takes handles from
     * the driver only); switches, windows and the rest from anywhere in reach.
     */
    private static boolean mayWork(WagonEntity wagon, StockModel.Control control) {
        if (ControlValue.handle(control.role().kind()) == null) {
            return true;
        }
        LocalPlayer player = Minecraft.getInstance().player;
        return player != null && player.getVehicle() == wagon
                && ClientDriveInput.atControls(wagon, player);
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
        if (pick == null) {
            return; // nothing here, or a door in front of it takes the click
        }
        event.setCanceled(true);
        event.setSwingHand(false);
        armed = false;
        if (pick.seat >= 0) {
            PacketDistributor.sendToServer(new SeatPayload(pick.wagon.getId(), true, pick.seat));
            return;
        }
        StockModel.Control control = pick.control;
        if (!mayWork(pick.wagon, control)) {
            return; // a handle lever, not from here: the label says to sit down
        }
        ObjectRole.Control role = control.role();
        if (role.kind() == ObjectRole.Kind.HANDBRAKE) {
            // the wheel turns the wagon's handbrake (SPEC §5.3); it shows the state the server keeps
            PacketDistributor.sendToServer(new HandbrakePayload(pick.wagon.getId()));
            return;
        }
        float now = position(pick.wagon, control);
        if (role.toggle()) {
            send(pick.wagon, control, now >= 0.5F ? 0.0F : 1.0F);
            return;
        }
        if (role.press()) {
            send(pick.wagon, control, 1.0F);
        }
        // a lever, window, chair or held button: drag/hold until released
        Vector3f grabPoint = restPoint(control, now, pick.hit);
        grab = new Grab(pick.wagon, control, grabPoint, pick.distance,
                new float[]{now}, new float[]{now});
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        boolean held = mc.options.keyUse.isDown();
        if (!held) {
            armed = true;
        }
        LocalPlayer player = mc.player;
        Grab current = grab;
        if (current == null) {
            hover = player != null && mc.level != null && mc.screen == null && !player.isSpectator()
                    ? pick(mc, player) : null;
            return;
        }
        hover = null;
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
        drag(player, current);
    }

    /** Follow the look ray: the travel whose grabbed point comes nearest it. */
    private static void drag(LocalPlayer player, Grab current) {
        Vec3 eye = player.getEyePosition(RAY_TIME);
        Vec3 look = player.getViewVector(RAY_TIME);
        Vec3 target = eye.add(look.scale(current.distance));
        Vector3f t = toModel(current.wagon, target);
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
            PacketDistributor.sendToServer(new ControlGroupPayload(wagon.getId(), role.global()
                    ? ControlGroupPayload.Scope.GLOBAL_SWITCH : ControlGroupPayload.Scope.SWITCH,
                    role.group(), position));
        }
    }

    /**
     * What a control is called: the handbrake wheel by the mod's name, a light
     * switch by its light group's name ({@link LightNames}: the pack's for
     * this type, else the mod's), else the model's {@code _LABEL_}, else its
     * kind.
     */
    static String controlName(WagonEntity wagon, ObjectRole.Control role) {
        if (role.kind() == ObjectRole.Kind.HANDBRAKE) {
            return I18n.get("control.railswheelsandtrains.handbrake"); // the mod's word, not the model's
        }
        ConsistComposition.Slot slot = ClientConsists.slot(wagon.getConsistId(), wagon.getWagonIndex());
        String light = LightNames.of(slot != null ? slot.type().id() : null, role.group());
        if (light != null) {
            return light;
        }
        if (role.label() != null && !role.label().isBlank()) {
            return role.label();
        }
        String kind = role.kind().name().toLowerCase(Locale.ROOT);
        if (role.kind() == ObjectRole.Kind.WIDGET) {
            kind = role.toggle() ? "widget_toggle" : role.press() ? "widget_press" : "widget";
        }
        return I18n.get("control.railswheelsandtrains." + kind);
    }

    /** A control's setting as shown: reverser direction, notch, on/off, or percent. */
    static String setting(ObjectRole.Control role, float position) {
        if (role.kind() == ObjectRole.Kind.HANDBRAKE) {
            return I18n.get(position >= 0.5F ? "control.railswheelsandtrains.handbrake_set"
                    : "control.railswheelsandtrains.handbrake_released");
        }
        Consist.Handle handle = ControlValue.handle(role.kind());
        if (handle == Consist.Handle.REVERSER) {
            int r = Handles.fromTravel(handle, position);
            return I18n.get(r > 0 ? "control.railswheelsandtrains.forward"
                    : r < 0 ? "control.railswheelsandtrains.backward"
                            : "control.railswheelsandtrains.neutral");
        }
        if (handle != null) {
            return Handles.fromTravel(handle, position) + " / " + Consist.NOTCHES;
        }
        if (role.toggle() || role.press()) {
            return I18n.get(position >= 0.5F
                    ? "control.railswheelsandtrains.on" : "control.railswheelsandtrains.off");
        }
        return Math.round(position * 100.0F) + "%";
    }

    /** A control's current raw position, as the renderer shows it. */
    private static float position(WagonEntity wagon, StockModel.Control control) {
        Handles handles = ClientConsists.handles(wagon.getConsistId());
        return ControlValue.position(control.role(), handles,
                handles.activeCab() == wagon.getWagonIndex(),
                wagon.controlValue(control.role().group()),
                new ControlValue.Readings(0.0, 0.0, 0.0F, 0.0F, wagon.handbrakeAnim(RAY_TIME)));
    }

    /** The hit point taken back to the control's rest pose (the point that moves with it). */
    private static Vector3f restPoint(StockModel.Control control, float position, Vector3f hit) {
        Matrix4f m = control.transform(ControlValue.value(control.role(), position), new Matrix4f());
        return m.invert().transformPosition(new Vector3f(hit));
    }

    /**
     * The nearest control or driver's chair under the crosshair, within reach
     * and with no door, wall of the model ({@link ClientWagonRay}), block or
     * entity in front of it; null if none.
     */
    private static Pick pick(Minecraft mc, LocalPlayer player) {
        Vec3 eye = player.getEyePosition(RAY_TIME);
        Vec3 look = player.getViewVector(RAY_TIME);
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
            Vector3d o = new Vector3d(toModel(wagon, eye));
            Vector3d dir = new Vector3d(toModel(wagon, eye.add(look))).sub(o);
            // nothing behind a wall of the model is reached (the desk, a partition, the hull)
            double wall = ClientWagonRay.wall(slot.type().id(), model, o, dir, reach) + ClientWagonRay.WALL_SLACK;
            // the driver's chairs nobody sits in, for a rider of this wagon who isn't in one
            List<WagonType.Seat> chairs = slot.type().cab() != null ? slot.type().cab().seats() : List.of();
            int sittingIn = player.getVehicle() == wagon ? wagon.chairOf(player) : -1;
            if (player.getVehicle() == wagon && sittingIn < 0) {
                for (int i = 0; i < chairs.size(); i++) {
                    if (wagon.seatedIn(i) >= 0) {
                        continue;
                    }
                    double[] box = seatBox(chairs.get(i));
                    double t = HullCollision.rayBox(o, dir, box[0], box[1], box[2], box[3], box[4], box[5]);
                    if (t >= 0.0 && t <= reach && t <= wall && (best == null || t < best.distance)) {
                        best = new Pick(wagon, null, null, t, i);
                    }
                }
            }
            // the chair this player sits in (a WIDGET in the asset, ChME3 WIDGET_4) is under
            // every look down at the desk: it never takes the pick
            WagonType.Seat sitting = sittingIn >= 0 && sittingIn < chairs.size() ? chairs.get(sittingIn) : null;
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
                if (o.x > box[0] && o.x < box[3] && o.y > box[1] && o.y < box[4]
                        && o.z > box[2] && o.z < box[5]) {
                    continue; // the eye is inside it
                }
                double cushion = sitting == null ? 0.0 : sitting.y() - 0.05;
                if (sitting != null && sitting.x() >= box[0] && sitting.x() <= box[3]
                        && cushion >= box[1] && cushion <= box[4]
                        && sitting.z() >= box[2] && sitting.z() <= box[5]) {
                    continue; // the chair under the driver
                }
                double t = HullCollision.rayBox(o, dir, box[0] - PAD, box[1] - PAD, box[2] - PAD,
                        box[3] + PAD, box[4] + PAD, box[5] + PAD);
                if (t < 0.0 || t > reach || t > wall || (best != null && t >= best.distance)) {
                    continue;
                }
                Vector3f hit = new Vector3f((float) (o.x + dir.x * t), (float) (o.y + dir.y * t),
                        (float) (o.z + dir.z * t));
                best = new Pick(wagon, control, hit, t, -1);
            }
        }
        if (best == null || ClientDoorInteract.doorDistance(mc, player) < best.distance) {
            return null; // a door in front of it takes the click
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

    /**
     * A driver's chair click box in the model frame, {@code {minX, minY,
     * minZ, maxX, maxY, maxZ}}: the cushion top ± a chair's size.
     */
    public static double[] seatBox(WagonType.Seat seat) {
        return new double[]{seat.x() - 0.35, seat.y() - 0.5, seat.z() - 0.35,
                seat.x() + 0.35, seat.y() + 0.7, seat.z() + 0.35};
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
