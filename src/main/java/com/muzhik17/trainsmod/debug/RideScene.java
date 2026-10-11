package com.muzhik17.trainsmod.debug;

import java.util.Locale;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientDriveInput;
import com.muzhik17.trainsmod.client.ClientRide;
import com.muzhik17.trainsmod.client.sound.TrainSounds;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.Sway;

import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;

/**
 * Dev tool (SPEC §2.4a, §10): {@code -Pautoscene=ride} on a throwaway save
 * copy — a ChS4T with two coaches on a 1500-block straight, the player in
 * the cab: full throttle, the horn, then the whistle, screenshots ahead, out
 * of the side window and from behind at speed, braking to a stop, getting
 * off. Every second the log gets the speed, how the loco and the first coach
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
        // into the loco's cab: wagon 0 of the train (a selector by distance picked a coach),
        // tried until the client knows it and the ride has taken
        if (ticks >= 180 && ticks < 260 && ticks % 10 == 0
                && !(mc.player.getVehicle() instanceof WagonEntity)) {
            WagonEntity loco = wagonAt(mc, 0);
            if (loco != null) {
                command(mc, "ride @s mount " + loco.getUUID());
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
            case 1180 -> command(mc, "ride @s dismount");
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
