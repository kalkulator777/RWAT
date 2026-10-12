package com.muzhik17.trainsmod.debug;

import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.function.BiConsumer;

import org.joml.Vector3d;
import org.lwjgl.glfw.GLFW;

import com.mojang.authlib.GameProfile;
import com.mojang.blaze3d.platform.InputConstants;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.ServerConfig;
import com.muzhik17.trainsmod.client.ClientCabInteract;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientDoorInteract;
import com.muzhik17.trainsmod.client.ClientDriveInput;
import com.muzhik17.trainsmod.client.ClientWalk;
import com.muzhik17.trainsmod.client.gui.DriverPanelScreen;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.consist.CabAccess;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.ConsistManager;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.convention.ObjectRole;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.kinematics.RiderWalk;
import com.muzhik17.trainsmod.network.CabLeverPayload;
import com.muzhik17.trainsmod.network.ControlGroupPayload;
import com.muzhik17.trainsmod.network.DoorTogglePayload;
import com.muzhik17.trainsmod.network.SeatPayload;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.client.CameraType;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.components.AbstractSelectionList;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.options.controls.KeyBindsScreen;
import net.minecraft.network.chat.contents.TranslatableContents;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.decoration.ArmorStand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.common.util.FakePlayer;
import net.neoforged.neoforge.common.util.FakePlayerFactory;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * Dev tool (SPEC §2.4a, §9.2, §9.7): {@code -Pautoscene=driver} on a
 * throwaway save copy made by a server (its player no operator) — the
 * driver's key, levers worked standing, the leading post, the free camera
 * in the chair, the driving keys and the train page of the driver's panel.
 * An M62 (two cabs) with a coach, a coach turned round and an ER2 trailer;
 * the server's {@code cab_access} set to {@code KEY}, the player in survival:
 * <ol>
 * <li>without the key, standing in the front cab: sitting down, a lever, a
 * switch and the cab door are refused by the server (sent as a hacked client
 * would); the lever under the crosshair is outlined red, named with the key;
 * <li>with the key: the lever is taken standing, the door opens;
 * <li>the leading post (a second, fake player): seated at the front desk it
 * drives — a lever pulled standing in the rear cab is refused; standing at
 * the front it still does; gone, the one in the rear cab drives, facing back;
 * <li>seated: looking back (first person) and the drawn head (a camera beside
 * the chair); the driving keys W, S, A, Space as the keyboard sends them —
 * the player stays seated and in place; the Controls screen, conflicts logged;
 * <li>the driver's panel, train page: doors on the left of the whole train,
 * the lights, one car's right doors; from the rear cab "left" is the other side;
 * <li>up from the chair, W walks and the throttle stays; a real click on
 * the cab's door: without the key it stays shut, with it it opens.
 * </ol>
 * Everything is logged as {@code [driver]} lines; shots {@code rwat-driver-*.png}.
 * Quits the game at the end.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class DriverScene {

    private static final String TAG = "[driver]";
    private static int ticks;
    private static int waited;
    private static Vec3 origin;
    private static UUID fakeId;
    private static ArmorStand camera;
    /** Click the use (right) button at the start of the next tick, where real clicks land. */
    private static boolean pressUse;

    private DriverScene() {
    }

    /** The use clicks of the scene, as the mod's handlers left them: taken (canceled) or passed on. */
    @SubscribeEvent(priority = net.neoforged.bus.api.EventPriority.LOWEST, receiveCanceled = true)
    static void onUse(net.neoforged.neoforge.client.event.InputEvent.InteractionKeyMappingTriggered event) {
        Minecraft mc = Minecraft.getInstance();
        if ("driver".equals(System.getProperty("rwat.autoscene")) && event.isUseItem() && mc.player != null) {
            log(mc, "use click (" + event.getHand() + "): taken " + event.isCanceled() + ", crosshair "
                    + (mc.hitResult == null ? "-" : mc.hitResult.getType()) + ", door under it " + doorPick(mc));
        }
    }

    /** What the door handler picked in the last frame (its private pick, by reflection): "wagon/door" or "none". */
    private static String doorPick(Minecraft mc) {
        try {
            var pick = ClientDoorInteract.class.getDeclaredField("framePick");
            pick.setAccessible(true);
            Object result = pick.get(null);
            return result == null ? "none" : result.toString();
        } catch (ReflectiveOperationException e) {
            return "?";
        }
    }

    @SubscribeEvent
    static void onClientTickPre(ClientTickEvent.Pre event) {
        if (pressUse) {
            pressUse = false;
            KeyMapping.click(Minecraft.getInstance().options.keyUse.getKey());
        }
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        if (!"driver".equals(System.getProperty("rwat.autoscene")) || mc.player == null || mc.level == null) {
            return;
        }
        ticks++;
        WagonEntity loco = ticks > 160 ? carAt(mc, 0) : null;
        switch (ticks) {
            case 100 -> {
                // 1080p with the automatic GUI scale (4): the panel at its tightest
                mc.getWindow().setWindowed(1920, 1080);
                mc.options.guiScale().set(0);
                mc.resizeDisplay();
                origin = mc.player.position().add(4000.0, 0.0, 0.0);
                command(mc, "gamemode creative");
                command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f 0 0", origin.x, origin.y, origin.z));
            }
            case 150 -> command(mc, "rwat spawn with m62 amendorf !amendorf er2t");
            case 160 -> {
                command(mc, "gamerule doDaylightCycle false");
                command(mc, "time set noon");
                command(mc, "weather clear");
                command(mc, "rwat handle train_brake 8");
                command(mc, "rwat handle reverser 0");
            }
            case 179 -> {
                if ((carAt(mc, 3) == null || carAt(mc, 3).typeNow() == null) && waited++ < 600) {
                    ticks--; // hold till the train and its types have reached this client
                }
            }
            // --- the key: the server locks the cabs, the player has none ---
            case 180 -> {
                setCabAccess(mc, ServerConfig.CabAccess.KEY);
                command(mc, "gamemode survival");
                command(mc, "clear @s");
            }
            case 185 -> boardAt(mc, loco, 0);
            // beside the chair, in the aisle: the throttle in sight past the chair's back
            case 190 -> moveTo(mc, loco, 0.2, 7.7);
            case 195 -> log(mc, String.format(Locale.ROOT,
                    "locked %s, may work %s (creative %s, op %s, key %s), in cab %d",
                    ServerConfig.cabsLocked(), CabAccess.mayWork(mc.player), mc.player.isCreative(),
                    mc.player.hasPermissions(2), CabAccess.holdsKey(mc.player), loco.cabOf(mc.player)));
            case 200 -> {
                // what a hacked client would send: the server refuses it all
                PacketDistributor.sendToServer(new SeatPayload(loco.getId(), true, 0));
                PacketDistributor.sendToServer(new CabLeverPayload(loco.getId(), Consist.Handle.THROTTLE.ordinal(), 3));
                PacketDistributor.sendToServer(new ControlGroupPayload(loco.getId(),
                        ControlGroupPayload.Scope.SWITCH, "rwatTest", 1.0F));
                PacketDistributor.sendToServer(new DoorTogglePayload(loco.getId(), 0));
            }
            case 210 -> log(mc, "no key: seated " + loco.isSeated(mc.player) + ", throttle "
                    + handles(loco).throttle() + ", switch " + loco.controlValue("rwatTest")
                    + ", cab door " + loco.isDoorOpen(0) + ", action bar '" + actionBar(mc) + "'");
            case 212 -> {
                aimAtNearest(mc, loco, ObjectRole.Kind.THROTTLE);
                mc.gui.getChat().clearMessages(false);
            }
            case 216 -> log(mc, "no key, the throttle under the crosshair: " + lines()
                    + ", red " + ClientCabInteract.highlightRefused());
            case 218 -> shot(mc, "rwat-driver-nokey-lever.png");
            // --- with the key ---
            case 230 -> command(mc, "give @s railswheelsandtrains:driver_key");
            case 240 -> {
                aimAtNearest(mc, loco, ObjectRole.Kind.THROTTLE);
                mc.gui.getChat().clearMessages(false);
            }
            case 244 -> log(mc, "key " + CabAccess.holdsKey(mc.player) + ", the throttle under the crosshair: "
                    + lines() + ", red " + ClientCabInteract.highlightRefused());
            case 246 -> shot(mc, "rwat-driver-key-lever.png");
            case 250 -> {
                PacketDistributor.sendToServer(new CabLeverPayload(loco.getId(), Consist.Handle.THROTTLE.ordinal(), 3));
                PacketDistributor.sendToServer(new ControlGroupPayload(loco.getId(),
                        ControlGroupPayload.Scope.SWITCH, "rwatTest", 1.0F));
                PacketDistributor.sendToServer(new DoorTogglePayload(loco.getId(), 0));
            }
            case 262 -> {
                log(mc, "key, standing: throttle " + handles(loco).throttle() + " (3: taken standing), switch "
                        + loco.controlValue("rwatTest") + ", cab door " + loco.isDoorOpen(0));
                PacketDistributor.sendToServer(new CabLeverPayload(loco.getId(), Consist.Handle.THROTTLE.ordinal(), 0));
                PacketDistributor.sendToServer(new DoorTogglePayload(loco.getId(), 0));
            }
            // --- the leading post: a second player seated at the front desk ---
            case 270 -> {
                fakeSitsFront(mc, loco);
                moveTo(mc, loco, 2);
            }
            case 285 -> {
                reportDriver(mc, loco, "fake seated in front, the player standing in the rear cab");
                PacketDistributor.sendToServer(new CabLeverPayload(loco.getId(), Consist.Handle.THROTTLE.ordinal(), 5));
            }
            case 295 -> log(mc, "rear cab, front seated: throttle " + handles(loco).throttle() + " (0: refused), "
                    + "label " + labelAt(mc, loco));
            case 300 -> onServer(mc, loco, (wagon, player) -> {
                if (fake(player) != null) {
                    wagon.standDriver(fake(player));
                }
            });
            case 305 -> {
                reportDriver(mc, loco, "fake standing in front, the player standing in the rear cab");
                PacketDistributor.sendToServer(new CabLeverPayload(loco.getId(), Consist.Handle.THROTTLE.ordinal(), 4));
            }
            case 315 -> log(mc, "rear cab, front standing: throttle " + handles(loco).throttle() + " (0: refused)");
            case 320 -> fakeLeaves(mc, loco);
            case 325 -> {
                reportDriver(mc, loco, "alone, standing in the rear cab");
                PacketDistributor.sendToServer(new CabLeverPayload(loco.getId(), Consist.Handle.THROTTLE.ordinal(), 2));
            }
            case 335 -> {
                log(mc, "rear cab alone: throttle " + handles(loco).throttle() + " (2: taken), active cab "
                        + handles(loco).activeCab());
                PacketDistributor.sendToServer(new CabLeverPayload(loco.getId(), Consist.Handle.THROTTLE.ordinal(), 0));
            }
            // --- seated at the front desk: the free camera ---
            case 340 -> moveTo(mc, loco, 0);
            case 345 -> PacketDistributor.sendToServer(new SeatPayload(loco.getId(), true, 0));
            case 355 -> reportDriver(mc, loco, "seated in front");
            case 360 -> {
                mc.options.hideGui = true;
                faceChair(mc, loco, 0.0F, 10.0F);
            }
            case 370 -> shot(mc, "rwat-driver-seat-ahead.png");
            case 372 -> faceChair(mc, loco, 180.0F, 10.0F);
            case 380 -> {
                log(mc, String.format(Locale.ROOT, "looked back: yaw off the chair %.1f, head %.1f, body %.1f",
                        offChair(loco, mc.player.getYRot()), offChair(loco, mc.player.getYHeadRot()),
                        offChair(loco, mc.player.yBodyRot)));
                shot(mc, "rwat-driver-seat-back.png");
            }
            // a camera in the cab beside the chair, on the driver looking back: the body to the desk, the head turned
            case 385 -> {
                faceChair(mc, loco, 180.0F, 0.0F);
                cameraAt(mc, loco, 1.3, 4.3, 7.1, 75.0F, 30.0F);
            }
            case 395 -> shot(mc, "rwat-driver-seat-side.png");
            case 407 -> {
                mc.setCameraEntity(mc.player);
                if (camera != null) {
                    camera.discard();
                }
                mc.options.setCameraType(CameraType.FIRST_PERSON);
                mc.options.hideGui = false;
                faceChair(mc, loco, 0.0F, 20.0F);
            }
            // --- the driving keys, as the keyboard sends them ---
            case 410 -> {
                logKeys(mc, loco, "before the keys");
                press(GLFW.GLFW_KEY_SPACE, true);
            }
            case 412 -> press(GLFW.GLFW_KEY_SPACE, false);
            case 416 -> {
                logKeys(mc, loco, "Space (reverser, at a standstill: neutral -> forward)");
                press(GLFW.GLFW_KEY_W, true);
            }
            case 430 -> press(GLFW.GLFW_KEY_W, false);
            case 434 -> {
                logKeys(mc, loco, "W held 14 ticks (throttle up)");
                press(GLFW.GLFW_KEY_S, true);
            }
            case 450 -> press(GLFW.GLFW_KEY_S, false);
            case 454 -> {
                logKeys(mc, loco, "S held 16 ticks (throttle down)");
                press(GLFW.GLFW_KEY_A, true);
            }
            case 460 -> press(GLFW.GLFW_KEY_A, false);
            case 464 -> {
                logKeys(mc, loco, "A held 6 ticks (train brake released by notches)");
                press(GLFW.GLFW_KEY_D, true);
            }
            case 474 -> press(GLFW.GLFW_KEY_D, false);
            case 478 -> logKeys(mc, loco, "D held 10 ticks (train brake applied)");
            case 480 -> {
                KeyBindsScreen keys = new KeyBindsScreen(null, mc.options);
                mc.setScreen(keys);
                for (var child : keys.children()) {
                    if (child instanceof AbstractSelectionList<?> list) {
                        list.setScrollAmount(Double.MAX_VALUE);
                    }
                }
                logConflicts(mc);
            }
            case 486 -> shot(mc, "rwat-driver-controls.png");
            case 488 -> mc.setScreen(null);
            // --- the driver's panel, the train page ---
            case 490 -> {
                DriverPanelScreen panel = new DriverPanelScreen(loco);
                mc.setScreen(panel);
                panel.showTrain(true);
            }
            case 496 -> {
                logCars(mc, "panel open");
                shot(mc, "rwat-driver-panel-train.png");
            }
            case 498 -> pressButton(mc, "screen.railswheelsandtrains.driver_panel.open", 0);
            case 506 -> {
                logCars(mc, "doors on the left opened (expect car 1 1001, car 2 0110, car 3 11)");
                pressButton(mc, "screen.railswheelsandtrains.driver_panel.on", 0);
            }
            case 514 -> {
                logCars(mc, "lights inside on");
                shot(mc, "rwat-driver-panel-train-on.png");
            }
            case 516 -> pressToggle(mc, 2, 1); // the turned coach's right doors
            case 524 -> {
                logCars(mc, "car 2 (turned), right: expect 1111");
                shot(mc, "rwat-driver-panel-train-car.png");
            }
            case 526 -> {
                mc.setScreen(null);
                mc.options.hideGui = true;
                cameraAt(mc, carAt(mc, 1), 7.0, 3.0, -6.0, 135.0F, 5.0F);
            }
            case 536 -> shot(mc, "rwat-driver-doors-left.png");
            case 538 -> {
                mc.setCameraEntity(mc.player);
                if (camera != null) {
                    camera.discard();
                }
                mc.options.hideGui = false;
                PacketDistributor.sendToServer(new SeatPayload(loco.getId(), false, -1));
            }
            // the rear cab, looking back along the train: its left is the train's right
            case 545 -> moveTo(mc, loco, 2);
            case 550 -> PacketDistributor.sendToServer(new SeatPayload(loco.getId(), true, 2));
            case 560 -> {
                reportDriver(mc, loco, "seated in the rear cab");
                DriverPanelScreen panel = new DriverPanelScreen(loco);
                mc.setScreen(panel);
                panel.showTrain(true);
            }
            case 566 -> pressButton(mc, "screen.railswheelsandtrains.driver_panel.open", 0);
            case 574 -> {
                logCars(mc, "from the rear cab, doors on the left opened (expect all 1111 / 1111 / 1111)");
                shot(mc, "rwat-driver-panel-rear.png");
            }
            case 576 -> pressButton(mc, "screen.railswheelsandtrains.driver_panel.close", 1);
            case 584 -> logCars(mc, "from the rear cab, doors on the right closed (expect 0110 / 1001 / 1100)");
            // up from the chair: the keys walk again, the throttle stays
            case 586 -> {
                mc.setScreen(null);
                PacketDistributor.sendToServer(new SeatPayload(loco.getId(), false, -1));
            }
            case 592 -> {
                logWalk(mc, loco, "stood up");
                faceChair(mc, loco, 90.0F, 0.0F);
                press(GLFW.GLFW_KEY_W, true);
            }
            case 612 -> {
                press(GLFW.GLFW_KEY_W, false);
                logWalk(mc, loco, "W held 20 ticks standing (walks; the throttle stays)");
            }
            // a real click on the cab's door without the key, then with it
            case 616 -> {
                command(mc, "clear @s");
                moveTo(mc, loco, 0.35, 7.6);
            }
            case 640 -> logWalk(mc, loco, "by the cab door");
            // aimed a few ticks before the click: a click takes what the last frame picked (SPEC §9.3)
            case 672 -> aimAtModel(mc, loco, 0.35, 3.29, 6.94);
            case 679 -> shot(mc, "rwat-driver-nokey-door.png"); // the door under the crosshair: red
            case 680 -> {
                logWalk(mc, loco, "by the cab door, later");
                log(mc, "before the click: key " + CabAccess.holdsKey(mc.player) + ", may work "
                        + CabAccess.mayWork(mc.player) + ", door red " + ClientDoorInteract.highlightLocked());
                pressUse = true;
            }
            case 682 -> log(mc, "clicked the cab door without the key, at once: action bar '"
                    + actionBar(mc) + "'");
            case 700 -> log(mc, "clicked the cab door without the key: open " + loco.isDoorOpen(0)
                    + ", action bar '" + actionBar(mc) + "'");
            case 702 -> command(mc, "give @s railswheelsandtrains:driver_key");
            case 712 -> aimAtModel(mc, loco, 0.35, 3.29, 6.94);
            case 720 -> pressUse = true;
            case 740 -> log(mc, "clicked the cab door with the key: open " + loco.isDoorOpen(0));
            case 745 -> setCabAccess(mc, ServerConfig.CabAccess.OPEN);
            case 755 -> mc.stop();
            default -> {
            }
        }
    }

    // --- the scene's moves ---

    /** The server's {@code cab_access}, set in place (the save is thrown away; client and server share it). */
    private static void setCabAccess(Minecraft mc, ServerConfig.CabAccess access) {
        try {
            var field = ServerConfig.class.getDeclaredField("CAB_ACCESS");
            field.setAccessible(true);
            @SuppressWarnings("unchecked")
            var value = (net.neoforged.neoforge.common.ModConfigSpec.EnumValue<ServerConfig.CabAccess>) field.get(null);
            value.set(access);
            log(mc, "cab_access = " + access);
        } catch (ReflectiveOperationException e) {
            RailsWheelsAndTrains.LOGGER.warn("{} can't set cab_access", TAG, e);
        }
    }

    /** Board {@code wagon} on its floor by chair {@code chair} (server, the private {@code board} by reflection). */
    private static void boardAt(Minecraft mc, WagonEntity wagon, int chair) {
        WagonType.Seat seat = wagon.seat(chair);
        Vector3d at = PoseMath.localToWorld(new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ()),
                wagon.getYRot(), wagon.getXRot(), new Vector3d(seat.x(), seat.y() - 0.5, seat.z()));
        onServer(mc, wagon, (car, player) -> {
            player.teleportTo(at.x, at.y, at.z);
            try {
                var board = WagonEntity.class.getDeclaredMethod("board", ServerPlayer.class, WagonType.class);
                board.setAccessible(true);
                board.invoke(car, player, car.typeNow());
            } catch (ReflectiveOperationException e) {
                RailsWheelsAndTrains.LOGGER.warn("{} can't board", TAG, e);
            }
        });
    }

    /** Move the walking local player onto the floor nearest chair {@code chair}. */
    private static void moveTo(Minecraft mc, WagonEntity wagon, int chair) {
        WagonType.Seat seat = wagon.seat(chair);
        moveTo(mc, wagon, seat.x(), seat.z());
    }

    /**
     * Move the walking local player onto the floor nearest (x, z) of the
     * wagon's pose frame — the client's predicted feet and the server's
     * (private: reflection).
     */
    @SuppressWarnings("unchecked")
    private static void moveTo(Minecraft mc, WagonEntity wagon, double x, double z) {
        WagonType.Interior interior = wagon.typeNow().interior().inFrame(wagon.isFlipped());
        Vector3d feet = interior.clampFeet(new Vector3d(x, 0.0, z), RiderWalk.PLAYER_HALF_WIDTH);
        ClientWalk.put(mc.player.getId(), feet);
        onServer(mc, wagon, (car, player) -> {
            try {
                var field = WagonEntity.class.getDeclaredField("riderLocal");
                field.setAccessible(true);
                ((java.util.Map<UUID, Vector3d>) field.get(car)).put(player.getUUID(), new Vector3d(feet));
            } catch (ReflectiveOperationException e) {
                RailsWheelsAndTrains.LOGGER.warn("{} can't move the rider", TAG, e);
            }
        });
    }

    /**
     * A second player — a server-side fake with the key — rides the loco
     * and sits in its front chair. A fake player won't start riding, so it
     * is put aboard by hand (reflection), as {@code startRiding} would.
     */
    @SuppressWarnings("unchecked")
    private static void fakeSitsFront(Minecraft mc, WagonEntity wagon) {
        onServer(mc, wagon, (car, player) -> {
            FakePlayer fake = FakePlayerFactory.get(player.serverLevel(),
                    new GameProfile(UUID.nameUUIDFromBytes("rwat-driver-scene".getBytes()), "Assistant"));
            fakeId = fake.getUUID();
            fake.getInventory().add(new ItemStack(RailsWheelsAndTrains.DRIVER_KEY.get()));
            WagonType.Seat seat = car.seat(0);
            Vector3d feet = car.typeNow().interior().inFrame(car.isFlipped())
                    .clampFeet(new Vector3d(seat.x(), seat.y(), seat.z()), RiderWalk.PLAYER_HALF_WIDTH);
            try {
                var vehicle = Entity.class.getDeclaredField("vehicle");
                vehicle.setAccessible(true);
                vehicle.set(fake, car);
                var add = Entity.class.getDeclaredMethod("addPassenger", Entity.class);
                add.setAccessible(true);
                add.invoke(car, fake);
                var field = WagonEntity.class.getDeclaredField("riderLocal");
                field.setAccessible(true);
                ((java.util.Map<UUID, Vector3d>) field.get(car)).put(fake.getUUID(), feet);
            } catch (ReflectiveOperationException e) {
                RailsWheelsAndTrains.LOGGER.warn("{} can't seat the fake", TAG, e);
                return;
            }
            car.sitDriver(fake, 0);
            RailsWheelsAndTrains.LOGGER.info("{} fake aboard {}, seated {}", TAG, car.hasPassenger(fake),
                    car.isSeated(fake));
        });
    }

    private static void fakeLeaves(Minecraft mc, WagonEntity wagon) {
        onServer(mc, wagon, (car, player) -> {
            FakePlayer fake = fake(player);
            if (fake == null) {
                return;
            }
            try {
                // as stopRiding does: off the vehicle first, then out of its passengers
                var vehicle = Entity.class.getDeclaredField("vehicle");
                vehicle.setAccessible(true);
                vehicle.set(fake, null);
                var remove = Entity.class.getDeclaredMethod("removePassenger", Entity.class);
                remove.setAccessible(true);
                remove.invoke(car, fake);
            } catch (ReflectiveOperationException e) {
                RailsWheelsAndTrains.LOGGER.warn("{} can't drop the fake", TAG, e);
            }
        });
    }

    private static FakePlayer fake(ServerPlayer anyone) {
        return fakeId == null ? null : FakePlayerFactory.get(anyone.serverLevel(),
                new GameProfile(fakeId, "Assistant"));
    }

    /** Turn the player {@code yaw} degrees off the front chair's facing. */
    private static void faceChair(Minecraft mc, WagonEntity loco, float yaw, float pitch) {
        float facing = loco.getYRot() + loco.seat(0).yaw();
        mc.player.setYRot(facing + yaw);
        mc.player.yRotO = facing + yaw;
        mc.player.setXRot(pitch);
        mc.player.xRotO = pitch;
    }

    /** How far a yaw is off the seated player's chair facing, degrees (−180..180). */
    private static float offChair(WagonEntity loco, float yaw) {
        float facing = loco.seatFacing(Minecraft.getInstance().player);
        return net.minecraft.util.Mth.wrapDegrees(yaw - facing);
    }

    /**
     * Look through a camera stood at a point of {@code wagon}'s model frame,
     * {@code yaw} off the model's forward: an invisible armour stand.
     */
    private static void cameraAt(Minecraft mc, WagonEntity wagon, double x, double y, double z,
            float yaw, float pitch) {
        if (wagon == null) {
            return;
        }
        double flip = wagon.isFlipped() ? -1.0 : 1.0;
        Vector3d eye = PoseMath.localToWorld(new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ()),
                wagon.getYRot(), wagon.getXRot(), new Vector3d(x * flip, y, z * flip));
        if (camera != null) {
            camera.discard();
        }
        camera = new ArmorStand(mc.level, eye.x, eye.y, eye.z);
        camera.setInvisible(true);
        camera.setNoGravity(true);
        camera.setPos(eye.x, eye.y - camera.getEyeHeight(), eye.z);
        float worldYaw = wagon.getYRot() + yaw + (wagon.isFlipped() ? 180.0F : 0.0F);
        camera.setYRot(worldYaw);
        camera.yRotO = worldYaw;
        camera.setYHeadRot(worldYaw);
        camera.setXRot(pitch);
        camera.xRotO = pitch;
        mc.level.addEntity(camera);
        mc.setCameraEntity(camera);
    }

    /** A key as the keyboard sends it: every mapping on it whose context is active. */
    private static void press(int glfwKey, boolean down) {
        InputConstants.Key key = InputConstants.getKey(glfwKey, 0);
        if (down) {
            KeyMapping.click(key);
        }
        KeyMapping.set(key, down);
    }

    /** Press the {@code nth} button of the open screen labelled by translation {@code key}. */
    private static void pressButton(Minecraft mc, String key, int nth) {
        int seen = 0;
        for (var child : mc.screen == null ? List.<net.minecraft.client.gui.components.events.GuiEventListener>of()
                : mc.screen.children()) {
            if (child instanceof Button button && button.getMessage().getContents() instanceof TranslatableContents t
                    && t.getKey().equals(key) && seen++ == nth) {
                log(mc, "press '" + button.getMessage().getString() + "' (" + key + " #" + nth + ")");
                button.onPress();
                return;
            }
        }
        log(mc, "no button " + key + " #" + nth);
    }

    /** Press the switch of car row {@code row} (0 = the loco), column 0 left doors, 1 right, 2 lights. */
    private static void pressToggle(Minecraft mc, int row, int column) {
        int seen = 0;
        for (var child : mc.screen == null ? List.<net.minecraft.client.gui.components.events.GuiEventListener>of()
                : mc.screen.children()) {
            if (child instanceof Button button && child.getClass().getSimpleName().equals("CarToggle")
                    && seen++ == row * 3 + column) {
                log(mc, "press car row " + row + " column " + column + " (visible " + button.visible + ")");
                button.onPress();
                return;
            }
        }
        log(mc, "no car switch " + row + "/" + column);
    }

    // --- what is logged ---

    private static void logWalk(Minecraft mc, WagonEntity loco, String what) {
        Vector3d feet = ClientWalk.get(mc.player.getId());
        log(mc, String.format(Locale.ROOT, "%s: seated %s, feet %s, throttle %d, cab %d", what,
                loco.isSeated(mc.player), feet == null ? "-" : String.format(Locale.ROOT, "(%.2f, %.2f)", feet.x, feet.z),
                handles(loco).throttle(), loco.cabOf(mc.player)));
    }

    /** Turn the player to look at a point of a car's model frame. */
    private static void aimAtModel(Minecraft mc, WagonEntity wagon, double x, double y, double z) {
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

    private static void logKeys(Minecraft mc, WagonEntity loco, String what) {
        var h = handles(loco);
        log(mc, String.format(Locale.ROOT, "%s: reverser %d, throttle %d, brake %d | seated %s, riding %s,"
                        + " at (%.3f, %.3f, %.3f), on ground %s, keyUp down %s, throttle key down %s",
                what, h.reverser(), h.throttle(), h.trainBrake(), loco.isSeated(mc.player),
                mc.player.getVehicle() == loco, mc.player.getX(), mc.player.getY(), mc.player.getZ(),
                mc.player.onGround(), mc.options.keyUp.isDown(), ClientDriveInput.THROTTLE_UP.isDown()));
    }

    /** Every pair of key mappings the Controls screen marks red that involves a driving key or walking. */
    private static void logConflicts(Minecraft mc) {
        KeyMapping[] mine = {ClientDriveInput.THROTTLE_UP, ClientDriveInput.THROTTLE_DOWN,
            ClientDriveInput.BRAKE_APPLY, ClientDriveInput.BRAKE_RELEASE, ClientDriveInput.REVERSER,
            mc.options.keyUp, mc.options.keyDown, mc.options.keyLeft, mc.options.keyRight, mc.options.keyJump};
        StringBuilder out = new StringBuilder();
        for (KeyMapping key : mine) {
            for (KeyMapping other : mc.options.keyMappings) {
                if (other != key && (key.same(other) || other.hasKeyModifierConflict(key))) {
                    out.append(' ').append(key.getName()).append('~').append(other.getName());
                }
            }
        }
        log(mc, "Controls conflicts:" + (out.length() == 0 ? " none" : out));
    }

    /** Each car's open doors (as bits of its type's list) and its lights. */
    private static void logCars(Minecraft mc, String what) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < 4; i++) {
            WagonEntity car = carAt(mc, i);
            if (car == null) {
                continue;
            }
            out.append(String.format(Locale.ROOT, " | car %d %s%s doors %s lights %s", i,
                    car.typeNow() == null ? "?" : car.typeNow().id(), car.isFlipped() ? " (turned)" : "",
                    new StringBuilder(String.format("%4s", Integer.toBinaryString(car.doorMask() & 15))
                            .replace(' ', '0')).reverse(),
                    car.controls()));
        }
        log(mc, what + ":" + out);
    }

    private static void reportDriver(Minecraft mc, WagonEntity loco, String what) {
        onServer(mc, loco, (car, player) -> {
            var level = player.serverLevel();
            Consist consist = ConsistManager.get(level).byId(car.getConsistId());
            ConsistManager.Driver driver = consist == null ? null : ConsistManager.driverOf(level, consist);
            RailsWheelsAndTrains.LOGGER.info("{} {}: driver {} (seated {}, standing in cab {}), facing {},"
                            + " the train's cab facing {}; the player in cab {}, may move handles {}", TAG, what,
                    driver == null ? "none" : driver.player().getGameProfile().getName(),
                    driver != null && driver.seated(), driver == null ? -1 : driver.standingCab(),
                    driver == null ? 0 : driver.facing(), consist == null ? 0 : consist.cabFacing(),
                    car.cabOf(player), consist != null && ConsistManager.mayMoveHandles(level, consist, player));
        });
    }

    /** The crosshair label on a lever of the loco seen from where the player stands. */
    private static String labelAt(Minecraft mc, WagonEntity loco) {
        aimAtNearest(mc, loco, ObjectRole.Kind.THROTTLE);
        return lines();
    }

    private static String lines() {
        StringBuilder out = new StringBuilder();
        for (var line : ClientCabInteract.hudLines()) {
            out.append(out.length() == 0 ? "" : " / ").append(line.getString());
        }
        return "[" + out + "]";
    }

    private static String actionBar(Minecraft mc) {
        try {
            var field = net.minecraft.client.gui.Gui.class.getDeclaredField("overlayMessageString");
            field.setAccessible(true);
            Object message = field.get(mc.gui);
            return message instanceof net.minecraft.network.chat.Component c ? c.getString() : "";
        } catch (ReflectiveOperationException e) {
            return "?";
        }
    }

    private static com.muzhik17.trainsmod.consist.Handles handles(WagonEntity loco) {
        return ClientConsists.handles(loco.getConsistId());
    }

    /** Turn the player to the nearest control of {@code kind} on the wagon's model. */
    private static void aimAtNearest(Minecraft mc, WagonEntity wagon, ObjectRole.Kind kind) {
        var model = wagon == null || wagon.typeNow() == null ? null : StockModels.model(wagon.typeNow().id());
        if (model == null) {
            return;
        }
        Vec3 eye = mc.player.getEyePosition();
        Vector3d best = null;
        for (var control : model.controls()) {
            if (control.role().kind() != kind) {
                continue;
            }
            double flip = wagon.isFlipped() ? -1.0 : 1.0;
            Vector3d world = PoseMath.localToWorld(new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ()),
                    wagon.getYRot(), wagon.getXRot(), new Vector3d(
                            (control.boxMin().x + control.boxMax().x) * 0.5 * flip,
                            (control.boxMin().y + control.boxMax().y) * 0.5,
                            (control.boxMin().z + control.boxMax().z) * 0.5 * flip));
            if (best == null || world.distanceSquared(eye.x, eye.y, eye.z) < best.distanceSquared(eye.x, eye.y, eye.z)) {
                best = world;
            }
        }
        if (best == null) {
            log(mc, "no " + kind + " to aim at");
            return;
        }
        double dx = best.x - eye.x;
        double dy = best.y - eye.y;
        double dz = best.z - eye.z;
        float yaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
        float pitch = (float) -Math.toDegrees(Math.atan2(dy, Math.hypot(dx, dz)));
        mc.player.setYRot(yaw);
        mc.player.yRotO = yaw;
        mc.player.setXRot(pitch);
        mc.player.xRotO = pitch;
    }

    /** The scene's train's car {@code index}: the nearest such wagon to where the scene began. */
    private static WagonEntity carAt(Minecraft mc, int index) {
        WagonEntity found = null;
        for (var entity : mc.level.entitiesForRendering()) {
            if (entity instanceof WagonEntity w && w.getWagonIndex() == index && origin != null
                    && (found == null || w.distanceToSqr(origin) < found.distanceToSqr(origin))) {
                found = w;
            }
        }
        return found;
    }

    /** Run {@code action} on the integrated server's copy of a car, with the server player. */
    private static void onServer(Minecraft mc, WagonEntity car, BiConsumer<WagonEntity, ServerPlayer> action) {
        var server = mc.getSingleplayerServer();
        if (server == null || car == null) {
            return;
        }
        int carId = car.getId();
        UUID playerId = mc.player.getUUID();
        server.execute(() -> {
            var player = server.getPlayerList().getPlayer(playerId);
            if (player != null && player.serverLevel().getEntity(carId) instanceof WagonEntity wagon) {
                action.accept(wagon, player);
            }
        });
    }

    private static void command(Minecraft mc, String command) {
        RailsWheelsAndTrains.LOGGER.info("{} /{}", TAG, command);
        var server = mc.getSingleplayerServer();
        if (server == null) {
            mc.player.connection.sendCommand(command);
            return;
        }
        UUID id = mc.player.getUUID();
        server.execute(() -> {
            var player = server.getPlayerList().getPlayer(id);
            if (player != null) {
                server.getCommands().performPrefixedCommand(
                        player.createCommandSourceStack().withPermission(4), command);
            }
        });
    }

    private static void log(Minecraft mc, String what) {
        RailsWheelsAndTrains.LOGGER.info("{} t={} {}", TAG, ticks, what);
    }

    private static void shot(Minecraft mc, String name) {
        Screenshot.grab(mc.gameDirectory, name, mc.getMainRenderTarget(),
                message -> RailsWheelsAndTrains.LOGGER.info("{} {}", TAG, message.getString()));
    }
}
