package com.muzhik17.trainsmod.debug;

import java.util.Locale;
import java.util.UUID;

import org.joml.Matrix4d;
import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.ClientCabInteract;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientDoorInteract;
import com.muzhik17.trainsmod.client.ClientWagonRay;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.ClickReach;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.kinematics.RiderWalk;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RenderLevelStageEvent;
import net.neoforged.neoforge.client.event.ViewportEvent;

/**
 * Dev tool (SPEC §2.4, §9.3): {@code -Pautoscene=speed} on a throwaway save
 * copy — a train at ~115 km/h on a 1500-block straight (ChS4T and two
 * platzkarts).
 * <ol>
 *   <li>Standing at the rear end of a coach, looking back (and out to the
 *       side): is the car drawn? Every half second the log has, per car,
 *       whether the frustum takes it, whether the section of its entity
 *       position is compiled (vanilla draws an entity only then) and the
 *       entity count drawn ({@code rwat-speed-back-*.png}).</li>
 *   <li>The same in a single car (the rear coach uncoupled at speed).</li>
 *   <li>In the driver's chair, the crosshair on the throttle at speed: the
 *       hover and its outline ({@code rwat-speed-cab.png}); a light switch
 *       right-clicked at speed, its group before and after.</li>
 *   <li>On the ground beside the track as the train passes: the camera
 *       follows a door leaf of the first coach where it is drawn; once the
 *       frames have picked that door, it is right-clicked, and the server's
 *       reach with and without the sweep back to where the client drew the
 *       car is logged ({@code rwat-speed-door.png}).</li>
 * </ol>
 * Throughout, each frame measures how far the old picking rays — the tick
 * pose, the eye at the end of the tick (controls) or at the frame's partial
 * tick (doors) — land from the ray through the car as drawn, two blocks out
 * ({@code [speed] drift} lines). Quits the game at the end.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class SpeedScene {

    /** Speed held, blocks/tick (~115 km/h). */
    private static final double SPEED = 1.6;

    private static int ticks;
    private static Vec3 origin;
    /** The scene train's consist id, −1 until it is seen. */
    private static int trainId = -1;
    private static boolean pressUse;
    /** The car the drift is measured on, or null. */
    private static WagonEntity measured;
    private static double driftControls;
    private static double driftDoors;
    private static int frames;
    private static boolean clicked;
    /** The coach door the camera follows on the ground, −1 until one is near; frames it was picked, running. */
    private static int trackedDoor = -1;
    private static int hoveredTicks;
    private static int clickedAt = -1;
    private static WagonEntity clickedCar;
    private static int clickedDoor = -1;
    private static boolean diagnose;
    /** The light switch clicked in the cab, and its group's value before. */
    private static String switchGroup = "";
    private static float switchBefore;

    private SpeedScene() {
    }

    private static boolean active() {
        return "speed".equals(System.getProperty("rwat.autoscene"));
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
        if (!active() || mc.player == null || mc.level == null) {
            return;
        }
        ticks++;
        WagonEntity loco = ticks >= 180 ? carAt(mc, 0) : null;
        int consist = loco == null ? -1 : loco.getConsistId();
        if (ticks % 10 == 0 && measured != null) {
            report(mc);
        }
        // hold the speed (no driver in most of it: the train would coast down)
        if (ticks >= 220 && ticks < 1050 && ticks % 40 == 0 && consist >= 0) {
            command(mc, String.format(Locale.ROOT, "rwat speed %d %.2f", consist, SPEED));
            WagonEntity single = singleCar(mc, consist);
            if (single != null) {
                command(mc, String.format(Locale.ROOT, "rwat speed %d %.2f", single.getConsistId(), SPEED * 0.85));
            }
        }
        switch (ticks) {
            case 100 -> {
                origin = mc.player.position().add(4000.0, 0.0, 0.0);
                mc.options.chatVisibility().set(net.minecraft.world.entity.player.ChatVisiblity.HIDDEN);
                command(mc, "gamemode creative");
                command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f 0 0", origin.x, origin.y, origin.z));
            }
            case 160 -> command(mc, "rwat spawn 1500 with chs4t amendorf amendorf");
            case 170 -> {
                command(mc, "gamerule doDaylightCycle false");
                command(mc, "time set noon");
                command(mc, "weather clear");
            }
            case 200 -> {
                if (consist >= 0) {
                    command(mc, "rwat handbrake " + consist + " false");
                }
            }
            // 1. at the rear end of the first coach, looking back
            case 210 -> boardRear(mc, carAt(mc, 1));
            case 220 -> {
                lookAlong(mc, carAt(mc, 1), 180.0F, 5.0F);
                measured = carAt(mc, 1);
                diagnose = true;
            }
            case 400, 480, 560 -> {
                mc.options.hideGui = true;
                shot(mc, "rwat-speed-back-" + ticks + ".png");
            }
            case 590 -> lookAlong(mc, carAt(mc, 1), 140.0F, 5.0F);
            case 620 -> shot(mc, "rwat-speed-back-side.png");
            // 2. a single car: the rear coach uncoupled at speed, ridden at its rear end
            case 630 -> {
                if (consist >= 0) {
                    command(mc, "rwat uncouple " + consist + " 2");
                }
            }
            case 650 -> {
                WagonEntity single = singleCar(mc, consist);
                RailsWheelsAndTrains.LOGGER.info("[speed] single car {}", single);
                leave(mc);
                boardRear(mc, single);
            }
            case 660 -> {
                WagonEntity single = singleCar(mc, consist);
                lookAlong(mc, single, 180.0F, 5.0F);
                measured = single;
            }
            case 740, 790 -> shot(mc, "rwat-speed-single-" + ticks + ".png");
            // 3. the driver's chair, the crosshair on the throttle
            case 800 -> {
                diagnose = false;
                mc.options.hideGui = false;
                leave(mc);
                sitDriver(mc, loco);
                command(mc, "rwat handle reverser 1");
                command(mc, "rwat handle train_brake 0");
                command(mc, "rwat handle throttle 8");
                measured = loco;
            }
            case 830, 835, 840, 845, 850 -> aimAtControl(mc, loco, c -> c.role().kind()
                    == com.muzhik17.trainsmod.convention.ObjectRole.Kind.THROTTLE);
            case 852 -> shot(mc, "rwat-speed-cab.png");
            // a light switch flipped by a right-click at speed
            case 855, 858 -> switchGroup = aimAtControl(mc, loco, c -> c.role().toggle()
                    && c.role().kind() == com.muzhik17.trainsmod.convention.ObjectRole.Kind.WIDGET);
            case 860 -> {
                switchBefore = loco.controlValue(switchGroup);
                shot(mc, "rwat-speed-cab-switch.png");
                pressUse = true;
            }
            case 875 -> RailsWheelsAndTrains.LOGGER.info("[speed] switch {} clicked at {} km/h: {} -> {}",
                    switchGroup, f(kmh(loco)), switchBefore, loco.controlValue(switchGroup));
            // 4. on the ground ahead, beside the track, looking at door height
            case 880 -> {
                leave(mc);
                standAhead(mc, loco, 110.0, 3.4);
                measured = carAt(mc, 1);
            }
            case 1060 -> RailsWheelsAndTrains.LOGGER.info("[speed] clicked door {} of {} at tick {}: open now {}",
                    clickedDoor, clickedCar, clickedAt, clickedCar != null && clickedCar.isDoorOpen(clickedDoor));
            case 1080 -> mc.stop();
            default -> {
            }
        }
        if (ticks > 890 && ticks < 1050) {
            watchDoors(mc);
        }
        if (clickedAt >= 0 && ticks == clickedAt + 15) {
            RailsWheelsAndTrains.LOGGER.info("[speed] 15 ticks after the click: door {} open {}",
                    clickedDoor, clickedCar.isDoorOpen(clickedDoor));
        }
    }

    /**
     * On the ground: the camera follows the nearest leaf of the first coach
     * as it passes ({@link #onCameraAngles}); once the frames have picked
     * that door two ticks running, it is right-clicked — once.
     */
    private static void watchDoors(Minecraft mc) {
        WagonEntity coach = carAt(mc, 1);
        if (coach == null) {
            return;
        }
        if (trackedDoor < 0) {
            trackedDoor = nearestLeaf(mc, coach, 6.0);
            if (trackedDoor >= 0) {
                RailsWheelsAndTrains.LOGGER.info("[speed] following door {} of the coach", trackedDoor);
            }
            return;
        }
        int hovered = ClientDoorInteract.highlightedDoor(coach);
        RailsWheelsAndTrains.LOGGER.info("[speed] t={} {} km/h: door under the crosshair {} (following {})",
                ticks, f(kmh(coach)), hovered, trackedDoor);
        hoveredTicks = hovered == trackedDoor ? hoveredTicks + 1 : 0;
        if (hoveredTicks == 2 && !clicked) {
            clicked = true;
            clickedAt = ticks;
            clickedCar = coach;
            clickedDoor = trackedDoor;
            pressUse = true; // a real right-click, next tick: what the last frame picked
            shot(mc, "rwat-speed-door.png");
            serverReach(mc, coach, trackedDoor);
        }
    }

    /** The coach door with a moving leaf nearest the eye within {@code reach}, −1 if none. */
    private static int nearestLeaf(Minecraft mc, WagonEntity car, double reach) {
        WagonType type = car.typeNow();
        StockModel model = type == null ? null : StockModels.model(type.id());
        if (model == null) {
            return -1;
        }
        Vec3 eye = mc.player.getEyePosition(1.0F);
        int best = -1;
        double bestDistance = reach;
        for (int i = 0; i < type.doors().size(); i++) {
            Vector3d leaf = ClientWagonRay.leafCentre(car, model, type, i, 1.0F);
            if (leaf == null || type.doors().get(i).connecting()) {
                continue;
            }
            Vector3d world = ClientWagonRay.drawn(car, 1.0F).transformPosition(leaf);
            double distance = world.distance(eye.x, eye.y, eye.z);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = i;
            }
        }
        return best;
    }

    /**
     * The camera on the followed leaf, where it is drawn this frame: the
     * pick of each frame is tested on a car going by at speed.
     */
    @SubscribeEvent(priority = EventPriority.LOWEST)
    static void onCameraAngles(ViewportEvent.ComputeCameraAngles event) {
        Minecraft mc = Minecraft.getInstance();
        if (!active() || trackedDoor < 0 || clickedAt >= 0 && ticks > clickedAt + 5 || mc.player == null) {
            return;
        }
        WagonEntity coach = carAt(mc, 1);
        WagonType type = coach == null ? null : coach.typeNow();
        StockModel model = type == null ? null : StockModels.model(type.id());
        if (model == null) {
            return;
        }
        float pt = (float) event.getPartialTick();
        Vector3d leaf = ClientWagonRay.leafCentre(coach, model, type, trackedDoor, pt);
        if (leaf == null) {
            return;
        }
        Vector3d world = ClientWagonRay.drawn(coach, pt).transformPosition(leaf);
        Vec3 eye = mc.player.getEyePosition(pt);
        double dx = world.x - eye.x;
        double dy = world.y - eye.y;
        double dz = world.z - eye.z;
        if (dx * dx + dy * dy + dz * dz > 4.0 * 4.0) {
            return;
        }
        event.setYaw((float) Math.toDegrees(Math.atan2(-dx, dz)));
        event.setPitch((float) -Math.toDegrees(Math.atan2(dy, Math.hypot(dx, dz))));
    }

    /** The server's reach to the clicked door: where it has the car, and swept back to where the client drew it. */
    private static void serverReach(Minecraft mc, WagonEntity car, int door) {
        onServer(mc, car, (wagon, player) -> {
            WagonType.Door d = wagon.framedDoors().get(door);
            double cx = (d.minX() + d.maxX()) * 0.5;
            double cy = (d.minY() + d.maxY()) * 0.5;
            double cz = (d.minZ() + d.maxZ()) * 0.5;
            Vector3d eye = wagon.localEye(player);
            double sweep = wagon.clickSweep(player);
            double plain = Math.sqrt(ClickReach.distanceSq(eye.x, eye.y, eye.z, 0.0, cx, cy, cz, cx, cy, cz));
            double swept = Math.sqrt(ClickReach.distanceSq(eye.x, eye.y, eye.z, sweep, cx, cy, cz, cx, cy, cz));
            RailsWheelsAndTrains.LOGGER.info("[speed] server: door {} at {} from the eye where the server has the car,"
                    + " {} swept back {} blocks; reach {}", door, f(plain), f(swept), f(sweep),
                    f(player.blockInteractionRange() + 1.5));
        });
    }

    /**
     * Every frame: the drift of the old picking rays from the ray through
     * the car as drawn, and the render diagnosis of the scene's train.
     */
    @SubscribeEvent(priority = EventPriority.LOW)
    static void onRenderStage(RenderLevelStageEvent event) {
        Minecraft mc = Minecraft.getInstance();
        if (!active() || event.getStage() != RenderLevelStageEvent.Stage.AFTER_SKY || mc.player == null
                || measured == null || measured.isRemoved()) {
            return;
        }
        float pt = event.getPartialTick().getGameTimeDeltaPartialTick(true);
        ClientWagonRay.Look look = ClientWagonRay.look(event.getCamera(), mc.player, pt);
        ClientWagonRay.LocalRay drawn = ClientWagonRay.inModel(measured, look);
        Vector3d now = point(drawn, 2.0);
        Vector3d controls = point(tickRay(measured, mc.player.getEyePosition(1.0F),
                mc.player.getViewVector(1.0F)), 2.0);
        Vector3d doors = point(tickRay(measured, mc.player.getEyePosition(pt), mc.player.getViewVector(pt)), 2.0);
        driftControls = Math.max(driftControls, controls.distance(now));
        driftDoors = Math.max(driftDoors, doors.distance(now));
        frames++;
        if (diagnose && ticks % 10 == 0) {
            Vec3 cam = event.getCamera().getPosition();
            StringBuilder cars = new StringBuilder();
            for (var entity : mc.level.entitiesForRendering()) {
                if (entity instanceof WagonEntity car && car.distanceTo(mc.player) < 64.0) {
                    cars.append(String.format(Locale.ROOT, " #%d/%d[frustum %s, section compiled %s, riding %s]",
                            car.getConsistId(), car.getWagonIndex(),
                            mc.getEntityRenderDispatcher().shouldRender(car, event.getFrustum(), cam.x, cam.y, cam.z),
                            mc.levelRenderer.isSectionCompiled(car.blockPosition()),
                            car.hasIndirectPassenger(mc.player)));
                }
            }
            RailsWheelsAndTrains.LOGGER.info("[speed] t={} render:{} | {}", ticks, cars,
                    mc.levelRenderer.getEntityStatistics());
        }
    }

    /** The old rays: the eye against the car's tick pose (its entity position), model frame. */
    private static ClientWagonRay.LocalRay tickRay(WagonEntity car, Vec3 eye, Vec3 dir) {
        Matrix4d tick = PoseMath.drawnBody(new Vector3d(car.getX(), car.getY(), car.getZ()),
                car.getYRot(), car.getXRot(), com.muzhik17.trainsmod.kinematics.Sway.ZERO, car.isFlipped());
        return ClientWagonRay.into(tick, new ClientWagonRay.Look(eye, dir, 1.0F));
    }

    private static Vector3d point(ClientWagonRay.LocalRay ray, double t) {
        return new Vector3d(ray.dir()).mul(t).add(ray.origin());
    }

    private static void report(Minecraft mc) {
        RailsWheelsAndTrains.LOGGER.info("[speed] t={} {} km/h car #{}/{} | drift of the old rays 2 blocks out,"
                        + " max over {} frames: controls {} m, doors {} m | hover {} | door {}",
                ticks, f(kmh(measured)), measured.getConsistId(), measured.getWagonIndex(), frames,
                f(driftControls), f(driftDoors),
                ClientCabInteract.hudLines().stream().map(c -> c.getString()).toList(),
                ClientDoorInteract.highlightedDoor(measured));
        driftControls = 0.0;
        driftDoors = 0.0;
        frames = 0;
    }

    private static double kmh(WagonEntity car) {
        return Math.abs(ClientConsists.tickSpeed(car.getConsistId())) * 72.0;
    }

    /**
     * The scene train's car at {@code index}: the train spawned at the origin
     * (its id kept, as uncoupling gives the rear part a new consist).
     */
    private static WagonEntity carAt(Minecraft mc, int index) {
        if (trainId < 0) {
            for (var entity : mc.level.entitiesForRendering()) {
                if (entity instanceof WagonEntity car && origin != null && car.distanceToSqr(origin) < 100.0 * 100.0
                        && ClientConsists.composition(car.getConsistId()) != null
                        && ClientConsists.composition(car.getConsistId()).wagonCount() == 3) {
                    trainId = car.getConsistId();
                }
            }
        }
        for (var entity : mc.level.entitiesForRendering()) {
            if (entity instanceof WagonEntity car && car.getConsistId() == trainId && car.getWagonIndex() == index) {
                return car;
            }
        }
        return null;
    }

    /** The uncoupled coach: a car of another consist than the loco's. */
    private static WagonEntity singleCar(Minecraft mc, int consist) {
        for (var entity : mc.level.entitiesForRendering()) {
            if (entity instanceof WagonEntity car && consist >= 0 && car.getConsistId() != consist) {
                return car;
            }
        }
        return null;
    }

    /** Board a car on its floor at the rear end (server, by reflection: a dev shortcut past the doors). */
    private static void boardRear(Minecraft mc, WagonEntity car) {
        onServer(mc, car, (wagon, player) -> {
            WagonType type = wagon.typeNow();
            if (type == null || type.interior() == null) {
                return;
            }
            WagonType.Interior interior = type.interior().inFrame(wagon.isFlipped());
            Vector3d local = interior.clampFeet(new Vector3d(0.0, interior.floorY(), -100.0),
                    RiderWalk.PLAYER_HALF_WIDTH);
            try {
                var boardAt = WagonEntity.class.getDeclaredMethod("boardAt", ServerPlayer.class, Vector3d.class);
                boardAt.setAccessible(true);
                boardAt.invoke(wagon, player, local);
            } catch (ReflectiveOperationException e) {
                RailsWheelsAndTrains.LOGGER.warn("[speed] can't board", e);
            }
            RailsWheelsAndTrains.LOGGER.info("[speed] boarded car #{}/{} at {}", wagon.getConsistId(),
                    wagon.getWagonIndex(), local);
        });
    }

    /** Get off whatever car the player rides (server, the sanctioned dismount by reflection). */
    private static void leave(Minecraft mc) {
        if (!(mc.player.getVehicle() instanceof WagonEntity car)) {
            return;
        }
        onServer(mc, car, (wagon, player) -> {
            try {
                var exit = WagonEntity.class.getDeclaredMethod("exitRider", ServerPlayer.class);
                exit.setAccessible(true);
                exit.invoke(wagon, player);
            } catch (ReflectiveOperationException e) {
                RailsWheelsAndTrains.LOGGER.warn("[speed] can't get off", e);
            }
        });
    }

    /** Into the loco's first driver's chair (as {@link RideScene} does). */
    private static void sitDriver(Minecraft mc, WagonEntity loco) {
        onServer(mc, loco, (wagon, player) -> {
            WagonType type = wagon.typeNow();
            WagonType.Seat seat = wagon.seat(0);
            if (type == null || seat == null) {
                return;
            }
            Vector3d chair = PoseMath.localToWorld(new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ()),
                    wagon.getYRot(), wagon.getXRot(), new Vector3d(seat.x(), seat.y(), seat.z()));
            player.teleportTo(chair.x, chair.y, chair.z);
            try {
                var board = WagonEntity.class.getDeclaredMethod("board", ServerPlayer.class, WagonType.class);
                board.setAccessible(true);
                board.invoke(wagon, player, type);
            } catch (ReflectiveOperationException e) {
                RailsWheelsAndTrains.LOGGER.warn("[speed] can't board the loco", e);
                return;
            }
            wagon.sitDriver(player, 0);
            RailsWheelsAndTrains.LOGGER.info("[speed] seated: {}", wagon.isSeated(player));
        });
    }

    /** Turn the player {@code yaw} degrees off the car's forward (its pose frame), pitched. */
    private static void lookAlong(Minecraft mc, WagonEntity car, float yaw, float pitch) {
        if (car == null) {
            return;
        }
        float y = car.getYRot() + yaw;
        mc.player.setYRot(y);
        mc.player.yRotO = y;
        mc.player.setXRot(pitch);
        mc.player.xRotO = pitch;
    }

    /**
     * Look at the middle of the car's control nearest the eye that {@code which}
     * takes, where it is drawn at the end of the tick; its group, or "" if none.
     */
    private static String aimAtControl(Minecraft mc, WagonEntity car,
            java.util.function.Predicate<StockModel.Control> which) {
        var slot = car == null ? null : ClientConsists.slot(car.getConsistId(), car.getWagonIndex());
        StockModel model = slot == null ? null : StockModels.model(slot.type().id());
        if (model == null) {
            return "";
        }
        Vec3 eye = mc.player.getEyePosition(1.0F);
        Vector3d best = null;
        String group = "";
        for (StockModel.Control control : model.controls()) {
            if (!which.test(control)) {
                continue;
            }
            Vector3d centre = ClientWagonRay.drawn(car, 1.0F).transformPosition(new Vector3d(
                    (control.boxMin().x + control.boxMax().x) * 0.5, (control.boxMin().y + control.boxMax().y) * 0.5,
                    (control.boxMin().z + control.boxMax().z) * 0.5));
            if (best == null || centre.distanceSquared(eye.x, eye.y, eye.z) < best.distanceSquared(eye.x, eye.y, eye.z)) {
                best = centre;
                group = control.role().group();
            }
        }
        if (best == null) {
            return "";
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
        return group;
    }

    /** Stand on the ground {@code ahead} blocks ahead of the loco and {@code aside} to its left, facing the track. */
    private static void standAhead(Minecraft mc, WagonEntity loco, double ahead, double aside) {
        if (loco == null) {
            return;
        }
        double yaw = Math.toRadians(loco.getYRot());
        double fx = -Math.sin(yaw);
        double fz = Math.cos(yaw);
        // left of the forward direction (MC: +X is left of +Z)
        double lx = fz;
        double lz = -fx;
        double x = loco.getX() + fx * ahead + lx * aside;
        double z = loco.getZ() + fz * ahead + lz * aside;
        float face = (float) Math.toDegrees(Math.atan2(lx, -lz)); // looking along −left, at the track
        command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f %.1f -12", x, loco.getY(), z, face));
    }

    private static void onServer(Minecraft mc, WagonEntity car,
            java.util.function.BiConsumer<WagonEntity, ServerPlayer> action) {
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

    /** A command as the player, with operator rights on the integrated server. */
    private static void command(Minecraft mc, String command) {
        RailsWheelsAndTrains.LOGGER.info("[speed] /{}", command);
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

    private static void shot(Minecraft mc, String name) {
        Screenshot.grab(mc.gameDirectory, name, mc.getMainRenderTarget(),
                message -> RailsWheelsAndTrains.LOGGER.info("[speed] {}", message.getString()));
    }

    private static String f(double value) {
        return String.format(Locale.ROOT, "%.3f", value);
    }
}
