package com.muzhik17.trainsmod.debug;

import java.util.Locale;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientDriveInput;
import com.muzhik17.trainsmod.client.ClientRide;
import com.muzhik17.trainsmod.client.sound.TrainSounds;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.kinematics.Sway;
import com.muzhik17.trainsmod.network.SeatPayload;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * Dev tool (SPEC §2.4a, §10): {@code -Pautoscene=ride} on a throwaway save
 * copy — a ChS4T with two coaches on a 1500-block straight, the player in
 * the driver's chair: full throttle, the horn, then the whistle, screenshots ahead, out
 * of the side window and from behind at speed, braking to a stop, standing
 * up from the chair. Every second the log gets the speed, how the loco and the first coach
 * rock ({@code [ride]} lines) and what is sounding ({@link TrainSounds#describe}).
 * Quits the game at the end.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class RideScene {

    private static int ticks;

    private RideScene() {
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        if (!"ride".equals(System.getProperty("rwat.autoscene")) || mc.player == null || mc.level == null) {
            return;
        }
        ticks++;
        if (ticks >= 200 && ticks % 20 == 0) {
            report(mc);
        }
        // into the loco's driver's chair: wagon 0 of the train (a selector by distance
        // picked a coach), tried until the client knows it and the driver sits
        if (ticks >= 180 && ticks < 260 && ticks % 10 == 0 && !atControls(mc)) {
            WagonEntity loco = wagonAt(mc, 0);
            if (loco != null) {
                sitDriver(mc, loco.getUUID());
            }
        }
        switch (ticks) {
            case 100 -> {
                Vec3 origin = mc.player.position().add(4000.0, 0.0, 0.0);
                command(mc, "gamemode creative");
                command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f 0 0", origin.x, origin.y, origin.z));
            }
            case 160 -> command(mc, "rwat spawn 1500 with chs4t amendorf amendorf");
            case 170 -> {
                command(mc, "gamerule doDaylightCycle false");
                command(mc, "time set noon");
                command(mc, "weather clear");
            }
            case 270 -> {
                RailsWheelsAndTrains.LOGGER.info("[ride] riding {}", mc.player.getVehicle());
                command(mc, "rwat handle reverser 1");
                command(mc, "rwat handle train_brake 0");
                command(mc, "rwat handle throttle 8");
            }
            case 380 -> ClientDriveInput.HORN.setDown(true);
            case 420 -> ClientDriveInput.HORN.setDown(false);
            case 460 -> ClientDriveInput.WHISTLE.setDown(true);
            case 480 -> ClientDriveInput.WHISTLE.setDown(false);
            case 680 -> {
                mc.options.hideGui = true;
                mc.player.setXRot(5.0F);
            }
            case 690 -> shot(mc, "rwat-ride-ahead.png");
            case 700 -> mc.player.setYRot(mc.player.getYRot() + 80.0F);
            case 710 -> shot(mc, "rwat-ride-side.png");
            case 720 -> {
                mc.player.setYRot(mc.player.getYRot() - 80.0F);
                mc.options.setCameraType(CameraType.THIRD_PERSON_BACK);
            }
            case 740 -> shot(mc, "rwat-ride-behind.png");
            case 750 -> {
                mc.options.setCameraType(CameraType.FIRST_PERSON);
                mc.options.hideGui = false;
                command(mc, "rwat handle throttle 0");
                command(mc, "rwat handle train_brake 6");
            }
            // the driver stands up: nobody at the controls of a train at rest, the engine stops
            case 1180 -> {
                if (mc.player.getVehicle() instanceof WagonEntity loco) {
                    PacketDistributor.sendToServer(new SeatPayload(loco.getId(), false, -1));
                }
            }
            case 1240 -> mc.stop();
            default -> {
            }
        }
    }

    private static void report(Minecraft mc) {
        WagonEntity loco = mc.player.getVehicle() instanceof WagonEntity wagon ? wagon : null;
        if (loco == null) {
            RailsWheelsAndTrains.LOGGER.info("[ride] t={} on foot; {}", ticks, TrainSounds.describe());
            return;
        }
        double kmh = Math.abs(ClientConsists.tickSpeed(loco.getConsistId())) * 72.0;
        WagonEntity coach = wagonAt(mc, 1);
        RailsWheelsAndTrains.LOGGER.info("[ride] t={} {} km/h | riding #{} | loco {} | coach {} | {}", ticks,
                String.format(Locale.ROOT, "%.1f", kmh), loco.getWagonIndex(), sway(loco),
                coach == null ? "-" : sway(coach), TrainSounds.describe());
    }

    private static boolean atControls(Minecraft mc) {
        return mc.player.getVehicle() instanceof WagonEntity wagon
                && ClientDriveInput.atControls(wagon, mc.player);
    }

    /**
     * Board the loco at its chair and sit down (server, a dev shortcut past
     * the doors): stand at the chair, board as a walking rider ({@code board}
     * is private — reflection, like the other scenes), sit. A cab without a
     * walkable interior is simply ridden.
     */
    private static void sitDriver(Minecraft mc, java.util.UUID locoId) {
        var server = mc.getSingleplayerServer();
        if (server == null) {
            return;
        }
        java.util.UUID playerId = mc.player.getUUID();
        server.execute(() -> {
            var player = server.getPlayerList().getPlayer(playerId);
            if (player == null || !(player.serverLevel().getEntity(locoId) instanceof WagonEntity loco)) {
                return;
            }
            WagonType type = loco.typeNow();
            if (type == null || type.interior() == null || loco.seat(0) == null) {
                player.startRiding(loco, true);
                return;
            }
            if (player.getVehicle() != loco) {
                WagonType.Seat seat = loco.seat(0);
                Vector3d chair = PoseMath.localToWorld(new Vector3d(loco.getX(), loco.getY(), loco.getZ()),
                        loco.getYRot(), loco.getXRot(), new Vector3d(seat.x(), seat.y(), seat.z()));
                player.stopRiding();
                player.teleportTo(chair.x, chair.y, chair.z);
                try {
                    var board = WagonEntity.class.getDeclaredMethod("board",
                            net.minecraft.server.level.ServerPlayer.class, WagonType.class);
                    board.setAccessible(true);
                    board.invoke(loco, player, type);
                } catch (ReflectiveOperationException e) {
                    RailsWheelsAndTrains.LOGGER.warn("[ride] can't board", e);
                    return;
                }
            }
            loco.sitDriver(player, 0);
            RailsWheelsAndTrains.LOGGER.info("[ride] seated: {}", loco.isSeated(player));
        });
    }

    /** The nearest wagon with this index in its train (the scene's own train, spawned at the player). */
    private static WagonEntity wagonAt(Minecraft mc, int index) {
        WagonEntity found = null;
        for (var entity : mc.level.entitiesForRendering()) {
            if (entity instanceof WagonEntity w && w.getWagonIndex() == index
                    && (found == null || w.distanceToSqr(mc.player) < found.distanceToSqr(mc.player))) {
                found = w;
            }
        }
        return found;
    }

    private static String sway(WagonEntity wagon) {
        Sway sway = ClientRide.current(wagon.getId());
        return String.format(Locale.ROOT, "roll %+.2f° pitch %+.2f° bounce %+.1f mm",
                Math.toDegrees(sway.roll()), Math.toDegrees(sway.pitch()), sway.bounce() * 1000.0);
    }

    /** A command as the player, with operator rights on the integrated server. */
    private static void command(Minecraft mc, String command) {
        RailsWheelsAndTrains.LOGGER.info("[ride] /{}", command);
        var server = mc.getSingleplayerServer();
        if (server == null) {
            mc.player.connection.sendCommand(command);
            return;
        }
        java.util.UUID id = mc.player.getUUID();
        server.execute(() -> {
            var player = server.getPlayerList().getPlayer(id);
            if (player != null) {
                server.getCommands().performPrefixedCommand(
                        player.createCommandSourceStack().withPermission(4), command);
            }
        });
    }

    private static void shot(Minecraft mc, String name) {
        Screenshot.grab(mc.gameDirectory, name, mc.getMainRenderTarget(),
                message -> RailsWheelsAndTrains.LOGGER.info("[ride] {}", message.getString()));
    }
}
