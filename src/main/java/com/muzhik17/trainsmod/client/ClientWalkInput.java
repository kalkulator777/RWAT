package com.muzhik17.trainsmod.client;

import java.util.List;
import java.util.Locale;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.kinematics.RiderWalk;
import com.muzhik17.trainsmod.network.SeatPayload;
import com.muzhik17.trainsmod.network.WalkInputPayload;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.protocol.game.ServerboundPlayerCommandPacket;
import net.minecraft.util.Mth;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * Drives a walking rider while aboard a boardable wagon (SPEC v1.5-б): reads
 * WASD as floor movement, predicts the rider's local feet each tick (the same
 * pure {@link RiderWalk} step the server runs, so {@link ClientWalk} matches
 * the authoritative position with no round-trip), and forwards the input to the
 * server, numbered: the server's feet come back with the number of the input
 * they are after, and should they be off the prediction after it, they win
 * ({@link ClientWalkLog}). Right-click (use) requests an exit on a door-less type; one with
 * doors is left by walking out an open door ({@code WagonEntity}), and the
 * click is the door's ({@link ClientDoorInteract}). The cab driver is handled by
 * {@link ClientDriveInput} instead — this only engages on wagons with a
 * boardable interior.
 *
 * <p>Cosmetics (SPEC v1.5-б): the camera <b>follows the car</b> — the wagon's
 * yaw change each tick is added to the player's {@code yRot} <i>only</i> (not
 * {@code yRotO}, which {@code Entity.baseTick} re-snapshots next tick), so the
 * per-frame {@code lerp(yRotO, yRot)} carries the view round the curve smoothly,
 * in step with the interpolated world; the mouse still moves both in lockstep,
 * so it stays as responsive as vanilla. ({@code Entity.turn} moved both, making
 * the follow a 20&nbsp;Hz step against the smooth world — the "jelly" feel.)
 * The player also stands ({@code WagonEntity.shouldRiderSit}), turns the model
 * toward the <b>direction of the floor walk</b> (vanilla's body-turn reads the
 * world delta, ≈0 for a rider, so strafing never turned the body), and gets a
 * <b>walk animation</b>, the view bob and footsteps from the local step
 * distance ({@link ClientRiderSteps}).
 *
 * <p>Shift <b>crouches</b> (SPEC v1.5-б): the step is a creep and an open hull
 * door doesn't let the rider out ({@code RiderWalk.exitDoor}) — the same
 * rule the server runs on the sneak flag of the input. Sneaking never
 * dismounts from a walkable car (a mixin on {@code wantsToStopRiding}); in
 * the driver's chair it stands up.
 *
 * <p>Coupling can <b>turn</b> the wagon in its consist (SPEC §6.12: it joined
 * a train running the other way, its {@code flipped} flag toggles): the pose
 * frame turns 180° about the standing car. The predicted local feet are
 * mirrored to match (the server mirrors its own copy) and the 180° is taken out
 * of the camera follow — the car didn't move, so neither does the view.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientWalkInput {

    /** Use-key state, to send the exit as a single edge; true while not riding so a held boarding click doesn't exit. */
    private static boolean useWasDown = true;
    /** Wagon yaw last tick, to turn the camera by its per-tick change; null when not aboard. */
    private static Float prevWagonYaw;
    /** The ridden wagon's flipped flag last tick, to notice a coupling turning it; null when not aboard. */
    private static Boolean prevFlipped;
    /** The driver's chair this player sat in last tick (pose frame, SPEC §9), null if none. */
    private static WagonType.Seat prevSeat;
    /** Sneak-key state, to send the stand-up as a single edge. */
    private static boolean sneakWasDown = true;
    /** Entity id of the wagon the predicted feet belong to, or -1 when not walking one. */
    private static int walkedWagon = -1;
    /** The walk inputs sent on that wagon the server hasn't acknowledged, to check its feet against. */
    private static final ClientWalkLog WALK_LOG = new ClientWalkLog();
    /**
     * The most a car turns in a tick, degrees: well past a train's (300 km/h
     * on the tightest curve ≈ 16°). A bigger jump of its yaw is its pose frame
     * turned (a coupling) or a glitch — the car didn't turn, so the view isn't carried.
     */
    private static final float MAX_CAR_TURN = 30.0F;

    private ClientWalkInput() {
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer player = mc.player;
        if (player == null || !(player.getVehicle() instanceof WagonEntity wagon)) {
            if (player != null && walkedWagon != -1) {
                // off a walkable car: aboard, the sneak key reached the server
                // with the riding input, which stops with the ride, and vanilla
                // sends it on foot only when it changes — say what it is now, or
                // the server keeps the rider crouched (Shift-use, the pose) after
                // they let go of the key at the door
                player.connection.send(new ServerboundPlayerCommandPacket(player, player.isShiftKeyDown()
                        ? ServerboundPlayerCommandPacket.Action.PRESS_SHIFT_KEY
                        : ServerboundPlayerCommandPacket.Action.RELEASE_SHIFT_KEY));
            }
            useWasDown = true;
            prevWagonYaw = null;
            prevFlipped = null;
            prevSeat = null;
            walkedWagon = -1;
            WALK_LOG.clear();
            ClientWalk.takeServerFeet();
            ClientWalk.clearLocalOwner();
            ClientRiderSteps.resetLocal();
            if (player != null) {
                ClientWalk.remove(player.getId());
            }
            return;
        }
        WagonType.Interior interior = interiorOf(wagon);
        if (interior == null) {
            // a driver's cab, not a walkable interior — leave it to ClientDriveInput
            useWasDown = true;
            prevWagonYaw = null;
            prevFlipped = null;
            walkedWagon = -1;
            WALK_LOG.clear();
            ClientWalk.takeServerFeet();
            ClientWalk.clearLocalOwner();
            ClientRiderSteps.resetLocal();
            ClientWalk.remove(player.getId());
            return;
        }
        int wagonId = wagon.getId();
        if (wagonId != walkedWagon) {
            // aboard another wagon (boarded, or a gangway carried us on, SPEC
            // §9.5): its own frame — drop the last car's feet, yaw and flip, and
            // start from the server's spot if it gave one, else from the feet
            // the server synced on this car, else the world position
            walkedWagon = wagonId;
            prevWagonYaw = null;
            prevFlipped = null;
            WALK_LOG.clear();
            Vector3d synced = ClientWalk.on(player.getId(), wagonId);
            if (synced != null) {
                ClientWalk.put(player.getId(), wagonId, synced);
            } else {
                ClientWalk.remove(player.getId());
            }
        }
        // a spot the server gave on this car wins over the prediction (taken once)
        Vector3d placed = ClientWalk.takePlacement(wagonId);
        if (placed != null) {
            ClientWalk.put(player.getId(), wagonId, placed);
        }
        // this player's local feet are predicted here — keep the server sync
        // (which lists everyone) from overwriting them with a round-trip-stale value
        ClientWalk.setLocalOwner(player.getId());

        // camera follows the car: add the wagon's per-tick yaw change to yRot only
        // (baseTick re-snapshots yRotO next tick, so the frame lerp carries the
        // view round the curve smoothly), then read the input in that turned frame
        // so "forward" stays forward relative to the car
        float wagonYaw = wagon.getYRot();
        boolean flipped = wagon.isFlipped();
        boolean turned = prevFlipped != null && flipped != prevFlipped;
        if (turned) {
            // a coupling turned the car in its consist: same spot, mirrored frame
            RailsWheelsAndTrains.LOGGER.info("[ride-debug] wagon {} (consist #{}[{}]) turned round in its consist,"
                    + " yaw {} -> {}: feet mirrored", wagonId, wagon.getConsistId(), wagon.getWagonIndex(),
                    prevWagonYaw, wagonYaw);
            Vector3d feet = ClientWalk.get(player.getId());
            if (feet != null) {
                ClientWalk.put(player.getId(), wagonId, new Vector3d(-feet.x, feet.y, -feet.z));
            }
            WALK_LOG.mirror();
        }
        prevFlipped = flipped;
        if (prevWagonYaw != null) {
            float dYaw = Mth.wrapDegrees(wagonYaw - prevWagonYaw - (turned ? 180.0f : 0.0f));
            if (Math.abs(dYaw) > MAX_CAR_TURN) {
                // not the car turning: its frame or its pose jumped — the view stays (2026-10-14)
                RailsWheelsAndTrains.LOGGER.info(
                        "[ride-debug] wagon {} (consist #{}[{}]) yaw jumped {} -> {}{}: view not carried",
                        wagonId, wagon.getConsistId(), wagon.getWagonIndex(), prevWagonYaw, wagonYaw,
                        turned ? " as it turned round" : "");
            } else if (dYaw != 0.0f) {
                player.setYRot(player.getYRot() + dYaw);
            }
        }
        prevWagonYaw = wagonYaw;

        // a driver's chair (SPEC §9): seated, the keys drive (ClientDriveInput)
        // and sneaking stands up; the feet are the chair's, not predicted
        WagonType.Seat seat = wagon.seatOf(player);
        if (seat != null) {
            float facing = wagonYaw + seat.yaw();
            if (prevSeat == null) {
                player.setYRot(facing); // sit down facing the desk
                player.yRotO = facing;
                sneakWasDown = true;   // the key held while sitting down doesn't count
            }
            player.setYBodyRot(facing);
            boolean sneak = mc.options.keyShift.isDown();
            if (sneak && !sneakWasDown) {
                PacketDistributor.sendToServer(new SeatPayload(wagon.getId(), false, -1));
            }
            sneakWasDown = sneak;
            prevSeat = seat;
            useWasDown = true;
            ClientWalk.takeServerFeet(); // the chair's feet aren't walked
            return;
        }
        if (prevSeat != null) {
            // stood up: the server walks the feet from where they sat down from to
            // beside the chair — predict the same (the feet kept from before sitting)
            Vector3d feet = wagon.standingFeet(ClientWalk.get(player.getId()), prevSeat);
            if (feet != null) {
                ClientWalk.put(player.getId(), wagonId, feet);
            }
        }
        prevSeat = null;

        float forward = (mc.options.keyUp.isDown() ? 1f : 0f) - (mc.options.keyDown.isDown() ? 1f : 0f);
        float strafe = (mc.options.keyLeft.isDown() ? 1f : 0f) - (mc.options.keyRight.isDown() ? 1f : 0f);
        // the look in the car's frame as drawn: the server steps with this very
        // number, not with its own (a few ticks newer) yaw of the car
        float relativeYaw = Mth.wrapDegrees(player.getYRot() - wagonYaw);
        // read the key, not the player: crouched is what the server is told
        boolean sneak = mc.options.keyShift.isDown();

        boolean useDown = mc.options.keyUse.isDown();
        boolean exit = useDown && !useWasDown && !doorsOnly(wagon);
        useWasDown = useDown;

        // predict the local feet (seed from the world position on the first tick aboard)
        Vector3d local = ClientWalk.get(player.getId());
        if (local == null) {
            Vector3d body = new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ());
            local = interior.clampFeet(
                    PoseMath.worldToLocal(body, wagon.getYRot(), wagon.getXRot(),
                            new Vector3d(player.getX(), player.getY(), player.getZ())),
                    RiderWalk.PLAYER_HALF_WIDTH);
        }
        // the server's feet after one of our inputs must be where the prediction
        // had them after it; if they drifted off, the server's win — else it
        // keeps the rider where the client isn't: doors out of reach, the
        // doorway never reached — and the inputs still on their way are walked
        // again from them, on the car as it is now (ClientWalkLog: no round
        // trip is too long, nobody is pulled back to where they stood)
        List<WagonType.Door> doors = wagon.framedDoors();
        int doorMask = wagon.doorMask();
        ClientWalk.ServerFeet server = ClientWalk.takeServerFeet();
        if (server != null && server.wagonId() == wagonId) {
            Vector3d fixed = WALK_LOG.acknowledged(server.local(), server.ack(), (from, input) ->
                    RiderWalk.step(from, input.forward(), input.strafe(), input.relativeYaw(), 0.0F,
                            interior, doors, doorMask, input.sneak()));
            if (fixed != null && fixed.distance(local) > ClientWalkLog.TOLERANCE) {
                RailsWheelsAndTrains.LOGGER.info(
                        "[ride-debug] feet on wagon {} re-synced from the server after input {}, off by {}:"
                                + " client {} now {}", wagonId, server.ack(),
                        String.format(Locale.ROOT, "%.2f", fixed.distance(local)), fmt(local), fmt(fixed));
            }
            if (fixed != null) {
                local = fixed;
            }
        }
        Vector3d next = RiderWalk.step(local, forward, strafe, relativeYaw, 0.0F, interior,
                doors, doorMask, sneak);
        ClientWalk.put(player.getId(), wagonId, next);

        // the body turns toward where it walks, the legs, the view bob and the
        // footsteps follow the floor step (vanilla's see ≈0 world delta)
        ClientRiderSteps.localStep(player, wagon, next.x - local.x, next.z - local.z, sneak);
        player.setYHeadRot(player.getYRot());

        int seq = WALK_LOG.sent(forward, strafe, relativeYaw, sneak, next);
        PacketDistributor.sendToServer(new WalkInputPayload(wagonId, seq, forward, strafe, relativeYaw, sneak, exit));
    }

    /** Local feet for the debug log, two decimals. */
    private static String fmt(Vector3d v) {
        return String.format(Locale.ROOT, "(%.2f %.2f %.2f)", v.x, v.y, v.z);
    }

    /** True if the ridden wagon is left only through its doors (no right-click exit). */
    private static boolean doorsOnly(WagonEntity wagon) {
        ConsistComposition.Slot slot =
                ClientConsists.slot(wagon.getConsistId(), wagon.getWagonIndex());
        return slot != null && slot.type().doorsOnly();
    }

    /** The synced floor of the wagon the player rides, in its pose frame, or null if not boardable. */
    private static WagonType.Interior interiorOf(WagonEntity wagon) {
        ConsistComposition.Slot slot =
                ClientConsists.slot(wagon.getConsistId(), wagon.getWagonIndex());
        return slot != null && slot.type().interior() != null
                ? slot.type().interior().inFrame(slot.flipped()) : null;
    }
}
