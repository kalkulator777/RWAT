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
 * -PquickPlay=<world copy> -Pautoscene=cab|walk|beam|gangway|er2|panel}. Off unless the system property
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
        if (scene.equals("beam")) {
            beam(mc);
            return;
        }
        if (scene.equals("gangway")) {
            gangway(mc);
            return;
        }
        if (scene.equals("er2")) {
            er2(mc);
            return;
        }
        if (scene.equals("panel")) {
            panel(mc);
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
            // the crosshair on the throttle, then on a light switch: outline + label (SPEC §9.3)
            case 426 -> {
                mc.options.hideGui = false;
                aimAt(mc, com.muzhik17.trainsmod.convention.ObjectRole.Kind.THROTTLE, null);
            }
            case 440 -> shot(mc, "rwat-walk-hover-throttle.png");
            case 441 -> aimAt(mc, com.muzhik17.trainsmod.convention.ObjectRole.Kind.WIDGET, "FHL");
            case 455 -> shot(mc, "rwat-walk-hover-switch.png");
            // look far round: the seated head stops at the chair's limit
            case 456 -> look(mc, 170.0F, 0.0F);
            case 466 -> report(mc, String.format(Locale.ROOT, "looked 170 off the desk: yaw %.1f, wagon %.1f",
                    mc.player.getYRot(), wagon(mc).getYRot()));
            case 470 -> mc.setScreen(new com.muzhik17.trainsmod.client.gui.DriverPanelScreen(wagon(mc)));
            case 485 -> shot(mc, "rwat-walk-driver-panel.png");
            case 495 -> mc.stop();
            default -> {
            }
        }
    }

    /**
     * {@code panel} (SPEC §9.7): the driver's instruments. A ChS4T with a
     * coach, the player in its cab (a cab without a walkable interior: at the
     * controls just by riding it), pulling away at notch 5, in a 1920×1080
     * window — the HUD at the automatic GUI scale (4) and at 2; then the
     * driver's panel, the mouse on the throttle's sixth lamp (outline and
     * tooltip), a click there, the panel once the handle has moved, and the
     * mouse on the reverser, locked on the move ({@code rwat-panel-*.png}).
     */
    private static void panel(Minecraft mc) {
        switch (ticks) {
            case 100 -> {
                // 1080p with the automatic GUI scale (4): the most common setup
                mc.getWindow().setWindowed(1920, 1080);
                mc.options.guiScale().set(0);
                mc.resizeDisplay();
                origin = mc.player.position().add(4000.0, 0.0, 0.0);
                command(mc, "gamemode creative");
                command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f 0 0", origin.x, origin.y, origin.z));
            }
            case 160 -> command(mc, "rwat spawn with chs4t amendorf");
            case 170 -> {
                command(mc, "gamerule doDaylightCycle false");
                command(mc, "time set noon");
                command(mc, "weather clear");
                // the ChS4T's own groups: its front headlight and cab light (lamps lit in the panel)
                command(mc, "rwat control head1HL 1");
                command(mc, "rwat control cab1 1");
            }
            // the loco is the far end of the train from where it was spawned
            case 180 -> command(mc, "ride @s mount @e[type=railswheelsandtrains:wagon,sort=furthest,limit=1]");
            case 190 -> {
                command(mc, "rwat handle reverser 1");
                command(mc, "rwat handle train_brake 0");
                command(mc, "rwat handle throttle 5");
                report(mc, "riding " + mc.player.getVehicle());
            }
            case 290 -> shot(mc, "rwat-panel-hud.png");
            case 295 -> {
                mc.options.guiScale().set(2);
                mc.resizeDisplay();
            }
            case 310 -> shot(mc, "rwat-panel-hud-wide.png");
            case 315 -> {
                mc.options.guiScale().set(0);
                mc.resizeDisplay();
                if (mc.player.getVehicle() instanceof WagonEntity cab) {
                    mc.setScreen(new com.muzhik17.trainsmod.client.gui.DriverPanelScreen(cab));
                }
            }
            case 330 -> {
                double[] at = panelPoint(mc, Consist.Handle.THROTTLE, 6);
                if (at != null) {
                    moveMouse(mc, at[0], at[1]);
                }
            }
            case 340 -> shot(mc, "rwat-panel-screen-hover.png");
            case 345 -> {
                double[] at = panelPoint(mc, Consist.Handle.THROTTLE, 6);
                if (at != null) {
                    mc.screen.mouseClicked(at[0], at[1], 0);
                }
            }
            case 360 -> {
                report(mc, "handles " + com.muzhik17.trainsmod.client.ClientConsists.handles(
                        mc.player.getVehicle() instanceof WagonEntity cab ? cab.getConsistId() : -1));
                shot(mc, "rwat-panel-screen-clicked.png");
            }
            // on the move the reverser is locked: no outline, the tooltip says why
            case 365 -> {
                double[] at = panelPoint(mc, Consist.Handle.REVERSER, -1);
                if (at != null) {
                    moveMouse(mc, at[0], at[1]);
                }
            }
            case 375 -> shot(mc, "rwat-panel-screen-reverser.png");
            case 380 -> mc.stop();
            default -> {
            }
        }
    }

    /**
     * Put the mouse at a GUI point. A warp ({@code glfwSetCursorPos}) is not
     * enough: GLFW on X11 drops the motion event of its own warp, so the game
     * never hears of it — the mouse handler is told directly.
     */
    private static void moveMouse(Minecraft mc, double guiX, double guiY) {
        double scale = mc.getWindow().getGuiScale();
        long window = mc.getWindow().getWindow();
        org.lwjgl.glfw.GLFW.glfwSetCursorPos(window, guiX * scale, guiY * scale);
        try {
            var onMove = net.minecraft.client.MouseHandler.class.getDeclaredMethod("onMove",
                    long.class, double.class, double.class);
            onMove.setAccessible(true);
            onMove.invoke(mc.mouseHandler, window, guiX * scale, guiY * scale);
        } catch (ReflectiveOperationException e) {
            RailsWheelsAndTrains.LOGGER.warn("[autoscene] can't move the mouse: {}", e.toString());
        }
    }

    /** A GUI point of the open driver's panel that stands for {@code handle} at {@code value}, or null. */
    private static double[] panelPoint(Minecraft mc, Consist.Handle handle, int value) {
        if (!(mc.screen instanceof com.muzhik17.trainsmod.client.gui.DriverPanelScreen screen)
                || !(mc.player.getVehicle() instanceof WagonEntity cab)) {
            return null;
        }
        var readout = com.muzhik17.trainsmod.client.gui.DriverPanel.readout(cab);
        if (readout == null) {
            return null;
        }
        int height = com.muzhik17.trainsmod.client.gui.DriverPanel.height(readout);
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < com.muzhik17.trainsmod.client.gui.DriverPanel.WIDTH; x++) {
                var target = com.muzhik17.trainsmod.client.gui.DriverPanel.targetAt(mc.font,
                        screen.panelX(), screen.panelY(), readout, screen.panelX() + x + 0.5,
                        screen.panelY() + y + 0.5);
                if (target != null && target.handle() == handle && target.value() == value) {
                    return new double[]{screen.panelX() + x + 1.5, screen.panelY() + y + 2.5};
                }
            }
        }
        return null;
    }

    /**
     * {@code beam} (SPEC §8): the ChME3's front headlight at midnight, from
     * low beside the beam (sky behind it — a deferred shader pack used to
     * paint the sky over it), from far beside it, from the driver's chair
     * down the hood, and from ahead into the lamp ({@code rwat-beam-*.png}).
     */
    private static void beam(Minecraft mc) {
        switch (ticks) {
            case 100 -> {
                origin = mc.player.position().add(4000.0, 0.0, 0.0);
                command(mc, "gamemode creative");
                command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f 0 0", origin.x, origin.y, origin.z));
            }
            case 160 -> command(mc, "rwat spawn with chme3");
            case 170 -> {
                command(mc, "gamerule doDaylightCycle false");
                command(mc, "time set midnight");
                command(mc, "weather clear");
                command(mc, "rwat control FHL 1");
                command(mc, "rwat control FBL 1");
                command(mc, "rwat handle train_brake 8");
            }
            case 190 -> {
                command(mc, "gamemode spectator");
                mc.options.hideGui = true;
                camera(mc, 6.0, 0.6, 14.0, 160.0F, -25.0F);
            }
            case 250 -> shot(mc, "rwat-beam-low.png");
            case 260 -> camera(mc, 22.0, 4.0, 14.0, 90.0F, 6.0F);
            case 320 -> shot(mc, "rwat-beam-side.png");
            case 330 -> camera(mc, -1.062, 2.49, -4.654, 0.0F, 12.0F);
            case 390 -> shot(mc, "rwat-beam-seat.png");
            case 400 -> camera(mc, 1.0, 2.5, 30.0, 180.0F, 2.0F);
            case 460 -> shot(mc, "rwat-beam-ahead.png");
            case 470 -> mc.stop();
            default -> {
            }
        }
    }

    /**
     * {@code gangway} (SPEC §9.5): two coupled platzkarts; from the ground in
     * through the rear car's front-right door, along to its front end, into
     * the shut gangway door, open it, on into the front car (its rear gangway
     * door opens as we pass), along it, then back into the rear car. Where
     * the player rides and stands is logged at each step; shots look back
     * through the gangway and over the front car with the floor wireframes
     * on ({@code rwat-gangway-*.png}).
     */
    private static void gangway(Minecraft mc) {
        switch (ticks) {
            case 100 -> {
                origin = mc.player.position().add(4000.0, 0.0, 0.0);
                command(mc, "gamemode creative");
                command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f 0 0", origin.x, origin.y, origin.z));
            }
            case 160 -> command(mc, "rwat spawn with amendorf amendorf");
            case 170 -> {
                command(mc, "time set noon");
                command(mc, "rwat handle train_brake 8");
            }
            // beside the rear car's front-right door (Door1, index 0), open it, step into the doorway
            case 180 -> placeOn(mc, carAt(mc, 1), 2.6, 0.0, 11.28, -90.0F, 0.0F);
            case 185 -> PacketDistributor.sendToServer(new DoorTogglePayload(carAt(mc, 1).getId(), 0));
            case 195 -> reportNear(mc, carAt(mc, 1), "door opened?");
            case 200 -> placeOn(mc, carAt(mc, 1), 1.3, 0.0, 11.28, -90.0F, 0.0F);
            case 203 -> reportNear(mc, carAt(mc, 1), "in the doorway");
            case 210 -> reportCar(mc, "boarded the rear car");
            // along the vestibule to the front end wall: the gangway door (Trap1, index 4) is shut
            case 211 -> {
                aimAtModel(mc, carAt(mc, 1), 0.0, 3.4, 13.0);
                mc.options.keyUp.setDown(true);
            }
            case 235 -> {
                mc.options.keyUp.setDown(false);
                reportCar(mc, "at the shut gangway door");
            }
            case 236 -> {
                PacketDistributor.sendToServer(new DoorTogglePayload(carAt(mc, 1).getId(), 4));
                aimAtModel(mc, carAt(mc, 1), 0.0, 2.9, 14.0);
            }
            // the gangway door swung open (its IR animation), the next car's end beyond
            case 249 -> mc.options.hideGui = true;
            case 290 -> shot(mc, "rwat-gangway-door-open.png");
            case 291 -> mc.options.hideGui = false;
            case 300 -> {
                aimAtModel(mc, carAt(mc, 1), 0.0, 3.4, 15.0);
                mc.options.keyUp.setDown(true);
            }
            case 312 -> {
                mc.options.keyUp.setDown(false);
                reportCar(mc, "through the gangway");
            }
            // walk on along the front car, then back into the rear one
            case 313 -> {
                aimAtModel(mc, carAt(mc, 0), 0.0, 3.4, 5.0);
                mc.options.keyUp.setDown(true);
            }
            case 335 -> {
                mc.options.keyUp.setDown(false);
                reportCar(mc, "walked on in the front car");
            }
            case 336 -> {
                aimAtModel(mc, carAt(mc, 0), 0.0, 3.4, -16.0);
                mc.options.keyUp.setDown(true);
            }
            case 390 -> {
                mc.options.keyUp.setDown(false);
                reportCar(mc, "walked back");
            }
            // the floor wireframes over the rear car's front vestibule: zone, side doors, gangway door
            case 391 -> {
                mc.options.hideGui = true;
                com.muzhik17.trainsmod.client.ClientFloorDebug.setShown(true);
                aimAtModel(mc, carAt(mc, 1), 0.0, 1.9, 12.0);
            }
            case 403 -> shot(mc, "rwat-gangway-floors.png");
            case 410 -> mc.stop();
            default -> {
            }
        }
    }

    /**
     * ER2 head + motor car (SPEC §8, §9.5): door leaves the asset moves by name.
     * By day the motor car's left side shut, then its left doors opened — one
     * click opens both doorways of the group, each pair of leaves sliding
     * apart — then from inside the saloon the front vestibule's sliding doors
     * and the hinged gangway door, shut and open. At night with the saloon,
     * cab, head and buffer lights on: the saloon inside, the side, the head
     * car's front ({@code rwat-er2-*.png}).
     */
    private static void er2(Minecraft mc) {
        switch (ticks) {
            case 100 -> {
                origin = mc.player.position().add(4000.0, 0.0, 0.0);
                command(mc, "gamemode creative");
                command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f 0 0", origin.x, origin.y, origin.z));
            }
            case 160 -> command(mc, "rwat spawn with er2h er2m");
            case 170 -> {
                command(mc, "gamerule doDaylightCycle false");
                command(mc, "time set noon");
                command(mc, "weather clear");
                command(mc, "rwat handle train_brake 8");
                command(mc, "gamemode spectator");
            }
            case 180 -> {
                mc.options.hideGui = true;
                placeOn(mc, carAt(mc, 1), 11.0, 1.2, 0.0, 90.0F, 0.0F);
            }
            case 190 -> aimAtModel(mc, carAt(mc, 1), 0.0, 2.6, 0.0);
            case 220 -> shot(mc, "rwat-er2-side-shut.png");
            // beside the front left doorway: open it (DrL, door 0) — DrL_3 (door 1) comes along
            case 225 -> placeOn(mc, carAt(mc, 1), 3.0, 1.0, 8.8, -90.0F, 0.0F);
            case 230 -> PacketDistributor.sendToServer(new DoorTogglePayload(carAt(mc, 1).getId(), 0));
            case 235 -> placeOn(mc, carAt(mc, 1), 11.0, 1.2, 0.0, 90.0F, 0.0F);
            case 240 -> {
                aimAtModel(mc, carAt(mc, 1), 0.0, 2.6, 0.0);
                reportNear(mc, carAt(mc, 1), "left doors");
            }
            case 290 -> shot(mc, "rwat-er2-side-open.png");
            case 295 -> placeOn(mc, carAt(mc, 1), 4.0, 1.0, 6.5, 90.0F, 0.0F);
            case 300 -> aimAtModel(mc, carAt(mc, 1), 1.7, 2.6, 8.8);
            case 330 -> shot(mc, "rwat-er2-doorway-open.png");
            // in the saloon looking forward: the vestibule's sliding doors (FrontD, 5), the gangway door (6)
            case 335 -> placeOn(mc, carAt(mc, 1), -0.3, 1.9, 5.2, 0.0F, 5.0F);
            case 340 -> aimAtModel(mc, carAt(mc, 1), 0.0, 3.2, 9.9);
            case 360 -> shot(mc, "rwat-er2-inner-shut.png");
            case 362 -> {
                PacketDistributor.sendToServer(new DoorTogglePayload(carAt(mc, 1).getId(), 5));
                PacketDistributor.sendToServer(new DoorTogglePayload(carAt(mc, 1).getId(), 6));
            }
            case 410 -> {
                reportNear(mc, carAt(mc, 1), "vestibule and gangway doors");
                shot(mc, "rwat-er2-inner-open.png");
            }
            // night: saloon (ER2L), cab (ER2H), head (HL) and buffer (BL) lights on
            case 415 -> {
                command(mc, "time set midnight");
                for (String group : new String[]{"ER2L", "ER2H", "HL", "BL"}) {
                    command(mc, "rwat control " + group + " 1");
                }
                placeOn(mc, carAt(mc, 1), 0.3, 1.9, -6.5, 0.0F, 8.0F);
            }
            case 420 -> aimAtModel(mc, carAt(mc, 1), 0.0, 3.0, 4.0);
            case 470 -> shot(mc, "rwat-er2-night-saloon.png");
            case 475 -> placeOn(mc, carAt(mc, 1), 13.0, 1.2, 10.0, 90.0F, 0.0F);
            case 480 -> aimAtModel(mc, carAt(mc, 1), 0.0, 2.6, 10.0);
            case 520 -> shot(mc, "rwat-er2-night-side.png");
            case 525 -> placeOn(mc, carAt(mc, 0), 3.0, 0.8, 24.0, 180.0F, 0.0F);
            case 530 -> aimAtModel(mc, carAt(mc, 0), 0.0, 2.4, 9.0);
            case 570 -> shot(mc, "rwat-er2-night-front.png");
            case 580 -> mc.stop();
            default -> {
            }
        }
    }

    /** The car at {@code index} of the consist nearest the scene origin, or null. */
    private static WagonEntity carAt(Minecraft mc, int index) {
        WagonEntity near = wagon(mc);
        if (near == null) {
            return null;
        }
        for (var entity : mc.level.entitiesForRendering()) {
            if (entity instanceof WagonEntity w && w.getConsistId() == near.getConsistId()
                    && w.getWagonIndex() == index) {
                return w;
            }
        }
        return null;
    }

    /** Teleport the player to a point of a car's model frame, looking {@code yaw} off its forward. */
    private static void placeOn(Minecraft mc, WagonEntity wagon, double x, double y, double z,
            float yaw, float pitch) {
        if (wagon == null) {
            RailsWheelsAndTrains.LOGGER.warn("[autoscene] no such car");
            return;
        }
        double flip = wagon.isFlipped() ? -1.0 : 1.0;
        Vector3d world = PoseMath.localToWorld(new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ()),
                wagon.getYRot(), wagon.getXRot(), new Vector3d(x * flip, y, z * flip));
        float worldYaw = wagon.getYRot() + yaw + (wagon.isFlipped() ? 180.0F : 0.0F);
        command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f %.1f %.1f",
                world.x, world.y, world.z, worldYaw, pitch));
    }

    /** Turn the player to look at a point of a car's model frame. */
    private static void aimAtModel(Minecraft mc, WagonEntity wagon, double x, double y, double z) {
        if (wagon == null) {
            return;
        }
        double flip = wagon.isFlipped() ? -1.0 : 1.0;
        Vector3d world = PoseMath.localToWorld(new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ()),
                wagon.getYRot(), wagon.getXRot(), new Vector3d(x * flip, y, z * flip));
        Vec3 eye = mc.player.getEyePosition();
        double dx = world.x - eye.x;
        double dy = world.y - eye.y;
        double dz = world.z - eye.z;
        float yaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
        float pitch = (float) -Math.toDegrees(Math.atan2(dy, Math.hypot(dx, dz)));
        mc.player.setYRot(yaw);
        mc.player.yRotO = yaw;
        mc.player.setXRot(pitch);
        mc.player.xRotO = pitch;
    }

    /** Log where the player is in a car's model frame, riding or not, and its open doors. */
    private static void reportNear(Minecraft mc, WagonEntity car, String what) {
        if (car == null) {
            RailsWheelsAndTrains.LOGGER.info("[autoscene] {}: no car", what);
            return;
        }
        Vector3d local = PoseMath.worldToLocal(new Vector3d(car.getX(), car.getY(), car.getZ()),
                car.getYRot(), car.getXRot(),
                new Vector3d(mc.player.getX(), mc.player.getY(), mc.player.getZ()));
        if (car.isFlipped()) {
            local.set(-local.x, local.y, -local.z);
        }
        RailsWheelsAndTrains.LOGGER.info("[autoscene] {}: car {} (flipped {}, type {}) local ({}, {}, {})"
                + " doors={} types doors={} vehicle={}", what, car.getWagonIndex(), car.isFlipped(),
                car.typeNow() == null ? "?" : car.typeNow().id(),
                String.format(Locale.ROOT, "%.2f", local.x), String.format(Locale.ROOT, "%.2f", local.y),
                String.format(Locale.ROOT, "%.2f", local.z), Integer.toBinaryString(car.doorMask()),
                car.typeNow() == null ? -1 : car.typeNow().doors().size(), mc.player.getVehicle());
    }

    /** Log which car of the consist the player rides and where in it. */
    private static void reportCar(Minecraft mc, String what) {
        String where = "on foot";
        if (mc.player.getVehicle() instanceof WagonEntity car) {
            Vector3d local = PoseMath.worldToLocal(new Vector3d(car.getX(), car.getY(), car.getZ()),
                    car.getYRot(), car.getXRot(),
                    new Vector3d(mc.player.getX(), mc.player.getY(), mc.player.getZ()));
            if (car.isFlipped()) {
                local.set(-local.x, local.y, -local.z);
            }
            where = String.format(Locale.ROOT, "car %d local (%.2f, %.2f, %.2f) doors=%s",
                    car.getWagonIndex(), local.x, local.y, local.z, Integer.toBinaryString(car.doorMask()));
        }
        RailsWheelsAndTrains.LOGGER.info("[autoscene] {}: {}", what, where);
    }

    /**
     * Turn the player to look at the box centre of the first control of
     * {@code kind} (of light/switch group {@code group}, if given) on the
     * nearest wagon's model.
     */
    private static void aimAt(Minecraft mc, com.muzhik17.trainsmod.convention.ObjectRole.Kind kind,
            String group) {
        WagonEntity wagon = wagon(mc);
        var slot = wagon == null ? null
                : com.muzhik17.trainsmod.client.ClientConsists.slot(wagon.getConsistId(), wagon.getWagonIndex());
        var model = slot == null ? null
                : com.muzhik17.trainsmod.client.render.model.StockModels.model(slot.type().id());
        if (model == null) {
            RailsWheelsAndTrains.LOGGER.warn("[autoscene] no model to aim at");
            return;
        }
        for (var control : model.controls()) {
            if (control.role().kind() != kind || (group != null && !group.equals(control.role().group()))) {
                continue;
            }
            double flip = wagon.isFlipped() ? -1.0 : 1.0;
            Vector3d world = PoseMath.localToWorld(new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ()),
                    wagon.getYRot(), wagon.getXRot(), new Vector3d(
                            (control.boxMin().x + control.boxMax().x) * 0.5 * flip,
                            (control.boxMin().y + control.boxMax().y) * 0.5,
                            (control.boxMin().z + control.boxMax().z) * 0.5 * flip));
            Vec3 eye = mc.player.getEyePosition();
            double dx = world.x - eye.x;
            double dy = world.y - eye.y;
            double dz = world.z - eye.z;
            float yaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
            float pitch = (float) -Math.toDegrees(Math.atan2(dy, Math.hypot(dx, dz)));
            mc.player.setYRot(yaw);
            mc.player.yRotO = yaw;
            mc.player.setXRot(pitch);
            mc.player.xRotO = pitch;
            RailsWheelsAndTrains.LOGGER.info("[autoscene] aim at {} ({})", control.role().key(), group);
            return;
        }
        RailsWheelsAndTrains.LOGGER.warn("[autoscene] no {} control ({})", kind, group);
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

    /**
     * Run a command as the player — in singleplayer on the integrated server
     * with operator rights, so a save without cheats (one a dedicated server
     * made) works too.
     */
    private static void command(Minecraft mc, String command) {
        RailsWheelsAndTrains.LOGGER.info("[autoscene] /{}", command);
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
                message -> RailsWheelsAndTrains.LOGGER.info("[autoscene] {}", message.getString()));
    }
}
