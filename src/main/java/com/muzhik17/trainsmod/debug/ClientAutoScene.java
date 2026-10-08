package com.muzhik17.trainsmod.debug;

import java.util.Locale;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.network.CabLeverPayload;
import com.muzhik17.trainsmod.network.DoorTogglePayload;
import com.muzhik17.trainsmod.network.SeatPayload;

import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * Dev tool: a scripted scene with screenshots (debug, SPEC §2.4a), for looking
 * at world rendering from an automated run — {@code ./gradlew runClient
 * -PquickPlay=<world copy> -Pautoscene=cab|walk}. Off unless the system property
 * {@code rwat.autoscene} is set; use a throwaway copy of a save (it spawns a
 * train, changes time and game mode).
 *
 * <p>{@code cab} (SPEC §8–§9): a ChME3 on a straight debug path ahead (+Z) of
 * where the player stands, at midnight, every light group on, the throttle
 * at 4 with both brakes on (so it stands); then
 * {@code screenshots/rwat-scene-side/front/seat/cab/walkway.png} from beside
 * it, from ahead into its headlight, from the driver's chair, from the back
 * of the cab and from the walkway toward the cab, in spectator mode with the
 * HUD hidden — 4000 blocks east of the player, away from the save's own
 * rails. Quits the game at the end.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientAutoScene {

    private static final String PROPERTY = "rwat.autoscene";
    private static int ticks;
    private static Vec3 origin;

    private ClientAutoScene() {
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        String scene = System.getProperty(PROPERTY);
        Minecraft mc = Minecraft.getInstance();
        if (scene == null || mc.player == null || mc.level == null) {
            return;
        }
        ticks++;
        if (scene.equals("walk")) {
            walk(mc);
            return;
        }
        if (!scene.equals("cab")) {
            return;
        }
        switch (ticks) {
            case 100 -> {
                // off to empty ground, away from any rails or trains the save holds
                origin = mc.player.position().add(4000.0, 0.0, 0.0);
                command(mc, "gamemode creative");
                command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f 0 0", origin.x, origin.y, origin.z));
            }
            case 160 -> command(mc, "rwat spawn with chme3");
            case 170 -> {
                command(mc, "gamerule doDaylightCycle false");
                command(mc, "time set midnight");
                command(mc, "weather clear");
            }
            case 180 -> {
                for (String group : new String[]{"IL", "FHL", "FBL", "NL", "BgL", "FEL", "RBL"}) {
                    command(mc, "rwat control " + group + " 1");
                }
                command(mc, "rwat handle train_brake 8");
                command(mc, "rwat handle independent_brake 8");
                command(mc, "rwat handle reverser 1");
                command(mc, "rwat handle throttle 4");
            }
            case 190 -> {
                command(mc, "gamemode spectator");
                mc.options.hideGui = true;
                camera(mc, 7.0, 3.0, 2.0, 110.0F, 8.0F);
            }
            case 250 -> shot(mc, "rwat-scene-side.png");
            case 260 -> camera(mc, 4.0, 3.5, 24.0, 170.0F, 4.0F);
            case 320 -> shot(mc, "rwat-scene-front.png");
            case 330 -> camera(mc, -1.062, 2.49, -4.654, 0.0F, 30.0F);
            case 390 -> shot(mc, "rwat-scene-seat.png");
            case 400 -> camera(mc, 0.6, 2.311, -5.3, -20.0F, 20.0F);
            case 460 -> shot(mc, "rwat-scene-cab.png");
            case 470 -> camera(mc, 1.25, 2.311, 3.0, 180.0F, 10.0F);
            case 530 -> shot(mc, "rwat-scene-walkway.png");
            // the desk close up: as set (throttle 4, brakes on, forward, switches on) …
            case 540 -> camera(mc, -1.062, 2.49, -4.654, 0.0F, 55.0F);
            case 590 -> shot(mc, "rwat-scene-desk-set.png");
            // … everything at rest (levers home, reverser neutral, switches off but the cab light) …
            case 600 -> {
                for (String handle : new String[]{"throttle", "train_brake", "independent_brake", "reverser"}) {
                    command(mc, "rwat handle " + handle + " 0");
                }
                for (String group : new String[]{"FHL", "FBL", "NL", "BgL", "FEL", "RBL"}) {
                    command(mc, "rwat control " + group + " 0");
                }
            }
            case 650 -> shot(mc, "rwat-scene-desk-rest.png");
            // … and every lever at full travel
            case 660 -> {
                command(mc, "rwat handle train_brake 8");
                command(mc, "rwat handle independent_brake 8");
                command(mc, "rwat handle reverser 1");
                command(mc, "rwat handle throttle 8");
            }
            case 710 -> shot(mc, "rwat-scene-desk-full.png");
            case 730 -> mc.stop();
            default -> {
            }
        }
    }

    /**
     * {@code walk} (SPEC §9): the driver's way in, played with the keys and
     * the packets the mouse would send — climb the front step from the
     * ground, walk the +X walkway to the cab, open its door, walk in, sit in
     * the chair, pull the throttle; where the player is gets logged at each
     * step, with first- and third-person shots and the driver's light menu
     * ({@code rwat-walk-*.png}).
     */
    private static void walk(Minecraft mc) {
        switch (ticks) {
            case 100 -> {
                origin = mc.player.position().add(4000.0, 0.0, 0.0);
                command(mc, "gamemode creative");
                command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f 0 0", origin.x, origin.y, origin.z));
            }
            case 160 -> command(mc, "rwat spawn with chme3");
            case 170 -> {
                command(mc, "time set noon");
                command(mc, "rwat control IL 1");
                command(mc, "rwat handle train_brake 8");
            }
            // step into the opening of the front-right step from the ground: boards onto the platform
            case 190 -> place(mc, 1.62, 0.0, 7.95, 180.0F, 0.0F);
            case 200 -> report(mc, "after the step");
            // walk the +X walkway back to the cab (look −Z of the model)
            case 205 -> {
                look(mc, 180.0F, 5.0F);
                mc.options.keyUp.setDown(true);
            }
            case 310 -> {
                mc.options.keyUp.setDown(false);
                report(mc, "at the cab door (closed)");
            }
            case 315 -> {
                WagonEntity wagon = wagon(mc);
                if (wagon != null) {
                    PacketDistributor.sendToServer(new DoorTogglePayload(wagon.getId(), 1));
                }
            }
            case 330 -> {
                look(mc, 180.0F, 5.0F);
                mc.options.keyUp.setDown(true);
            }
            case 345 -> {
                mc.options.keyUp.setDown(false);
                report(mc, "through the door");
            }
            case 350 -> {
                mc.options.hideGui = true;
                look(mc, 160.0F, 20.0F);
            }
            case 360 -> shot(mc, "rwat-walk-in-cab.png");
            case 365 -> {
                WagonEntity wagon = wagon(mc);
                if (wagon != null) {
                    PacketDistributor.sendToServer(new SeatPayload(wagon.getId(), true));
                }
            }
            case 380 -> report(mc, "seated?");
            case 385 -> {
                WagonEntity wagon = wagon(mc);
                if (wagon != null) {
                    PacketDistributor.sendToServer(new CabLeverPayload(wagon.getId(),
                            Consist.Handle.THROTTLE.ordinal(), 5));
                }
            }
            case 400 -> shot(mc, "rwat-walk-seated.png");
            case 405 -> mc.options.setCameraType(net.minecraft.client.CameraType.THIRD_PERSON_FRONT);
            case 420 -> shot(mc, "rwat-walk-seated-3p.png");
            case 425 -> {
                mc.options.setCameraType(net.minecraft.client.CameraType.FIRST_PERSON);
                report(mc, "throttle " + com.muzhik17.trainsmod.client.ClientConsists
                        .handles(wagon(mc).getConsistId()));
            }
            case 430 -> mc.setScreen(new com.muzhik17.trainsmod.client.gui.TrainLightsScreen(
                    wagon(mc).getConsistId()));
            case 445 -> shot(mc, "rwat-walk-lights-menu.png");
            case 455 -> mc.stop();
            default -> {
            }
        }
    }

    /** Teleport the player to a point of the ChME3's model frame, looking {@code yaw} off its forward. */
    private static void place(Minecraft mc, double x, double y, double z, float yaw, float pitch) {
        camera(mc, x, y, z, yaw, pitch);
    }

    /** Turn the player to look {@code yaw} degrees off the ChME3's forward. */
    private static void look(Minecraft mc, float yaw, float pitch) {
        WagonEntity wagon = wagon(mc);
        if (wagon != null) {
            float y = wagon.getYRot() + yaw + (wagon.isFlipped() ? 180.0F : 0.0F);
            mc.player.setYRot(y);
            mc.player.yRotO = y;
            mc.player.setXRot(pitch);
        }
    }

    private static void report(Minecraft mc, String what) {
        WagonEntity wagon = wagon(mc);
        String where = "no wagon";
        if (wagon != null) {
            Vector3d local = PoseMath.worldToLocal(new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ()),
                    wagon.getYRot(), wagon.getXRot(),
                    new Vector3d(mc.player.getX(), mc.player.getY(), mc.player.getZ()));
            if (wagon.isFlipped()) {
                local.set(-local.x, local.y, -local.z);
            }
            where = String.format(Locale.ROOT, "local (%.2f, %.2f, %.2f) riding=%s seated=%s doors=%s",
                    local.x, local.y, local.z, mc.player.getVehicle() == wagon,
                    wagon.isSeated(mc.player), Integer.toBinaryString(wagon.doorMask()));
        }
        RailsWheelsAndTrains.LOGGER.info("[autoscene] {}: {}", what, where);
    }

    private static WagonEntity wagon(Minecraft mc) {
        WagonEntity nearest = null;
        for (var entity : mc.level.entitiesForRendering()) {
            if (entity instanceof WagonEntity w
                    && (nearest == null || w.distanceToSqr(origin) < nearest.distanceToSqr(origin))) {
                nearest = w;
            }
        }
        return nearest;
    }

    /**
     * Put the camera (the spectating player's feet) at a point of the ChME3's
     * <b>model</b> frame, looking {@code yaw} degrees off its forward — from
     * where the train actually stands, whatever the spawn chose.
     */
    private static void camera(Minecraft mc, double x, double y, double z, float yaw, float pitch) {
        WagonEntity wagon = null;
        for (var entity : mc.level.entitiesForRendering()) {
            if (entity instanceof WagonEntity w
                    && (wagon == null || w.distanceToSqr(origin) < wagon.distanceToSqr(origin))) {
                wagon = w;
            }
        }
        if (wagon == null) {
            RailsWheelsAndTrains.LOGGER.warn("[autoscene] no wagon near the spawn point");
            return;
        }
        double flip = wagon.isFlipped() ? -1.0 : 1.0;
        Vector3d world = PoseMath.localToWorld(new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ()),
                wagon.getYRot(), wagon.getXRot(), new Vector3d(x * flip, y, z * flip));
        float worldYaw = wagon.getYRot() + yaw + (wagon.isFlipped() ? 180.0F : 0.0F);
        command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f %.1f %.1f",
                world.x, world.y, world.z, worldYaw, pitch));
    }

    private static void command(Minecraft mc, String command) {
        RailsWheelsAndTrains.LOGGER.info("[autoscene] /{}", command);
        mc.player.connection.sendCommand(command);
    }

    private static void shot(Minecraft mc, String name) {
        Screenshot.grab(mc.gameDirectory, name, mc.getMainRenderTarget(),
                message -> RailsWheelsAndTrains.LOGGER.info("[autoscene] {}", message.getString()));
    }
}
