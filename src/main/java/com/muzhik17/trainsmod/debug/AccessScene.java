package com.muzhik17.trainsmod.debug;

import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.BiConsumer;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.ServerConfig;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientDoorInteract;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.consist.WalkBudget;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.network.ControlGroupPayload;
import com.muzhik17.trainsmod.network.DoorTogglePayload;
import com.muzhik17.trainsmod.network.HandbrakePayload;
import com.muzhik17.trainsmod.network.UncouplePayload;
import com.muzhik17.trainsmod.network.WalkInputPayload;
import com.muzhik17.trainsmod.physics.PhysicsTuning;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.common.ModConfigSpec;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * Dev tool (SPEC §2.4a, §9.2–§9.3; batch B): {@code -Pautoscene=access} on a
 * throwaway save copy made by a server (its player no operator) — who may
 * touch a wagon ({@code consist.TouchRules}). An M62 with a platzkart coach
 * behind; the server's {@code cab_access} set to {@code KEY}, the
 * realistic profile (handbrakes by hand), the player in survival:
 * <ol>
 * <li>a spectator beside the coach's door: the door isn't picked under the
 * crosshair, a real click and a door packet leave it shut; with the
 * crowbar by the coupler, the uncouple packet leaves the train whole (M1).
 * In survival the same door packet opens the door;
 * <li>the handbrake from 10 blocks off: without the crowbar and with it, the
 * coach's handbrake stays as it was (M3); with the crowbar 3 blocks off, and
 * by its wheel from aboard, it turns;
 * <li>aboard the coach without the driver's key: a {@code GLOBAL} switch
 * packet for the M62's cab door group leaves that door shut (M2); the
 * coach's own switch is set; a NaN value is not kept (M4). With the key the
 * {@code GLOBAL} switch opens the cab door;
 * <li>twenty walk inputs in one tick step the rider about one step, not
 * twenty (M5); an infinite walk input moves nobody to NaN (M4);
 * <li>uncoupling in adventure mode is refused; in survival it cuts the train.
 * </ol>
 * Packets are sent as a hacked client would (the client's own picks don't
 * send what the server would refuse). Everything is logged as {@code
 * [access]} lines, each with what it should say; shots {@code
 * rwat-access-*.png}. Quits the game at the end.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class AccessScene {

    private static final String TAG = "[access]";
    private static final String SCENE = "access";
    /** The M62's cab door its {@code GLOBAL} switch would open (door 0, {@code CabDoor1}). */
    private static final String CAB_DOOR_GROUP = "CabDoor1";
    private static int ticks;
    private static int waited;
    private static Vec3 origin;
    /** Click the use (right) button at the start of the next tick, where real clicks land. */
    private static boolean pressUse;
    /** The coach's handbrake when the scene last looked, to tell a turn. */
    private static boolean handbrakeBefore;
    /** The rider's server feet before the burst of walk inputs (server thread writes, client reads). */
    private static volatile Vector3d feetBefore;
    /** The loco's and the coach's entity ids, once known: uncoupled, the coach heads a train of its own. */
    private static int locoId = -1;
    private static int coachId = -1;

    private AccessScene() {
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
        if (!SCENE.equals(System.getProperty("rwat.autoscene")) || mc.player == null || mc.level == null) {
            return;
        }
        ticks++;
        WagonEntity loco = ticks <= 160 ? null
                : locoId >= 0 && mc.level.getEntity(locoId) instanceof WagonEntity w ? w : carAt(mc, 0);
        WagonEntity coach = ticks <= 160 ? null
                : coachId >= 0 && mc.level.getEntity(coachId) instanceof WagonEntity w ? w : carAt(mc, 1);
        switch (ticks) {
            case 100 -> {
                mc.getWindow().setWindowed(1920, 1080);
                mc.options.guiScale().set(0);
                mc.resizeDisplay();
                origin = mc.player.position().add(4000.0, 0.0, 0.0);
                command(mc, "gamemode creative");
                command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f 0 0", origin.x, origin.y, origin.z));
            }
            case 150 -> command(mc, "rwat spawn with m62 amendorf");
            case 160 -> {
                command(mc, "gamerule doDaylightCycle false");
                command(mc, "time set noon");
                command(mc, "weather clear");
                command(mc, "rwat handle train_brake 8");
            }
            case 179 -> {
                if ((coach == null || coach.typeNow() == null || loco == null) && waited++ < 600) {
                    ticks--; // hold till the train and its types have reached this client
                }
            }
            case 180 -> {
                setConfig(mc, "CAB_ACCESS", ServerConfig.CabAccess.KEY);
                setConfig(mc, "PROFILE", PhysicsTuning.Profile.REALISTIC);
                command(mc, "gamemode survival");
                command(mc, "clear @s");
            }
            case 185 -> {
                locoId = loco.getId();
                coachId = coach.getId();
                log(mc, "train: loco " + loco.typeNow().id() + " #" + loco.getConsistId() + ", coach "
                        + coach.typeNow().id() + " #" + coach.getConsistId() + "; coach door 0 "
                        + coach.framedDoors().get(0).id() + " open " + coach.isDoorOpen(0) + ", loco door 0 "
                        + loco.framedDoors().get(0).id() + " open " + loco.isDoorOpen(0));
            }
            // --- 1. a spectator: no door, no coupler (M1) ---
            case 190 -> standByDoor(mc, coach, 0);
            case 192 -> {
                command(mc, "gamemode spectator");
                command(mc, "give @s railswheelsandtrains:crowbar");
            }
            case 196 -> aimAtDoor(mc, coach, 0);
            case 200 -> {
                log(mc, "spectator by the coach's door: picked door " + ClientDoorInteract.highlightedDoor(coach)
                        + " (expect -1: nothing picked)");
                shot(mc, "rwat-access-spectator-door.png");
                pressUse = true;
            }
            case 204 -> PacketDistributor.sendToServer(new DoorTogglePayload(coach.getId(), 0));
            case 206 -> standAt(mc, coach, 2.5, 0.0, coach.collisionHull().maxZ());
            case 208 -> PacketDistributor.sendToServer(new UncouplePayload(coach.getId(), true));
            case 218 -> log(mc, "spectator clicked and sent the door, sent the uncouple: coach door 0 open "
                    + coach.isDoorOpen(0) + " (expect false), coach in consist #" + coach.getConsistId()
                    + " with the loco's #" + loco.getConsistId() + " (expect the same)");
            case 220 -> {
                command(mc, "gamemode survival");
                command(mc, "clear @s");
                standByDoor(mc, coach, 0);
            }
            case 224 -> aimAtDoor(mc, coach, 0);
            case 228 -> {
                log(mc, "survival by the coach's door: picked door " + ClientDoorInteract.highlightedDoor(coach)
                        + " (expect 0)");
                shot(mc, "rwat-access-survival-door.png");
                PacketDistributor.sendToServer(new DoorTogglePayload(coach.getId(), 0));
            }
            case 238 -> {
                log(mc, "survival sent the door: open " + coach.isDoorOpen(0) + " (expect true)");
                PacketDistributor.sendToServer(new DoorTogglePayload(coach.getId(), 0));
            }
            // --- 2. the handbrake from afar (M3) ---
            case 248 -> {
                handbrakeBefore = handbrake(coach);
                log(mc, "coach door 0 open " + coach.isDoorOpen(0) + " (expect false); coach handbrake "
                        + handbrakeBefore);
                standAt(mc, coach, 10.0, 0.0, 0.0);
            }
            case 252 -> PacketDistributor.sendToServer(new HandbrakePayload(coach.getId()));
            case 262 -> {
                logHandbrake(mc, coach, "10 blocks off, no crowbar", false);
                command(mc, "give @s railswheelsandtrains:crowbar");
            }
            case 266 -> PacketDistributor.sendToServer(new HandbrakePayload(coach.getId()));
            case 276 -> {
                logHandbrake(mc, coach, "10 blocks off, the crowbar in hand ("
                        + mc.player.getMainHandItem().getItem() + ")", false);
                standAt(mc, coach, 3.0, 0.0, 0.0);
            }
            case 280 -> PacketDistributor.sendToServer(new HandbrakePayload(coach.getId()));
            case 290 -> {
                logHandbrake(mc, coach, "3 blocks off, the crowbar in hand", true);
                command(mc, "clear @s");
                command(mc, "ride @s mount " + coach.getUUID());
            }
            case 300 -> PacketDistributor.sendToServer(new HandbrakePayload(coach.getId()));
            case 310 -> logHandbrake(mc, coach, "aboard the coach (riding " + (mc.player.getVehicle() == coach)
                    + "), by its wheel, no crowbar", true);
            // --- 3. a GLOBAL switch without the key (M2), a NaN value (M4) ---
            case 312 -> PacketDistributor.sendToServer(new ControlGroupPayload(coach.getId(),
                    ControlGroupPayload.Scope.GLOBAL_SWITCH, CAB_DOOR_GROUP, 1.0F));
            case 314 -> PacketDistributor.sendToServer(new ControlGroupPayload(coach.getId(),
                    ControlGroupPayload.Scope.SWITCH, "rwatTest", 1.0F));
            case 316 -> PacketDistributor.sendToServer(new ControlGroupPayload(coach.getId(),
                    ControlGroupPayload.Scope.SWITCH, "rwatNaN", Float.NaN));
            case 326 -> log(mc, "aboard the coach, no key: GLOBAL " + CAB_DOOR_GROUP + " -> loco door 0 open "
                    + loco.isDoorOpen(0) + " (expect false), loco groups " + loco.controls() + " (expect no "
                    + CAB_DOOR_GROUP + "); coach groups " + coach.controls()
                    + " (expect rwatTest:1.0f, no rwatNaN)");
            case 328 -> command(mc, "give @s railswheelsandtrains:driver_key");
            case 332 -> PacketDistributor.sendToServer(new ControlGroupPayload(coach.getId(),
                    ControlGroupPayload.Scope.GLOBAL_SWITCH, CAB_DOOR_GROUP, 1.0F));
            case 342 -> {
                log(mc, "aboard the coach, with the key: GLOBAL " + CAB_DOOR_GROUP + " -> loco door 0 open "
                        + loco.isDoorOpen(0) + " (expect true)");
                PacketDistributor.sendToServer(new ControlGroupPayload(coach.getId(),
                        ControlGroupPayload.Scope.GLOBAL_SWITCH, CAB_DOOR_GROUP, 0.0F));
            }
            case 344 -> command(mc, "clear @s"); // after the switch back: a command can overtake a packet
            // --- 4. the walk: a step a tick (M5), no NaN feet (M4) ---
            case 346 -> putFeetInTheAisle(mc, coach);
            case 352 -> {
                for (int i = 0; i < 20; i++) {
                    PacketDistributor.sendToServer(new WalkInputPayload(coach.getId(), 1_000_000 + i,
                            1.0F, 0.0F, 0.0F, false, false));
                }
            }
            case 356 -> onServer(mc, coach, (car, player) -> {
                Vector3d now = feet(car, player);
                Vector3d before = feetBefore;
                RailsWheelsAndTrains.LOGGER.info("{} twenty walk inputs in one tick: feet {} -> {}, moved {}"
                                + " (expect at most the {} steps of 0.12 the budget keeps; twenty were 2.4)",
                        TAG, fmt(before), fmt(now), now == null || before == null ? "?"
                                : String.format(Locale.ROOT, "%.2f", now.distance(before)), WalkBudget.BURST);
            });
            case 358 -> {
                PacketDistributor.sendToServer(new WalkInputPayload(coach.getId(), 2_000_000,
                        Float.POSITIVE_INFINITY, 0.0F, 0.0F, false, false));
                PacketDistributor.sendToServer(new WalkInputPayload(coach.getId(), 2_000_001,
                        0.0F, Float.NaN, 0.0F, false, false));
            }
            case 364 -> onServer(mc, coach, (car, player) -> RailsWheelsAndTrains.LOGGER.info(
                    "{} after an infinite and a NaN walk input: feet {}, player at {} (expect numbers)", TAG,
                    fmt(feet(car, player)), player.position()));
            // --- 5. uncoupling: adventure mode refused, survival cuts ---
            case 368 -> {
                standAt(mc, coach, 2.5, 0.0, coach.collisionHull().maxZ());
                command(mc, "gamemode adventure");
                command(mc, "give @s railswheelsandtrains:crowbar");
            }
            case 374 -> PacketDistributor.sendToServer(new UncouplePayload(coach.getId(), true));
            case 384 -> {
                log(mc, "adventure mode, crowbar by the coupler (riding " + mc.player.getVehicle()
                        + "): coach #" + coach.getConsistId() + ", loco #" + loco.getConsistId()
                        + " (expect the same)");
                command(mc, "gamemode survival");
            }
            case 388 -> PacketDistributor.sendToServer(new UncouplePayload(coach.getId(), true));
            case 398 -> log(mc, "survival, crowbar by the coupler: coach #" + coach.getConsistId() + ", loco #"
                    + loco.getConsistId() + " (expect two consists)");
            case 400 -> {
                setConfig(mc, "CAB_ACCESS", ServerConfig.CabAccess.OPEN);
                setConfig(mc, "PROFILE", PhysicsTuning.Profile.STANDARD);
            }
            case 405 -> mc.stop();
            default -> {
            }
        }
    }

    // --- the scene's moves ---

    /** A server config value, set in place (the save is thrown away; client and server share it). */
    private static <T extends Enum<T>> void setConfig(Minecraft mc, String field, T value) {
        try {
            var spec = ServerConfig.class.getDeclaredField(field);
            spec.setAccessible(true);
            @SuppressWarnings("unchecked")
            var config = (ModConfigSpec.EnumValue<T>) spec.get(null);
            config.set(value);
            log(mc, field + " = " + value);
        } catch (ReflectiveOperationException e) {
            RailsWheelsAndTrains.LOGGER.warn("{} can't set {}", TAG, field, e);
        }
    }

    /** Stand 2.5 blocks outside door {@code index} of {@code car}, level with it. */
    private static void standByDoor(Minecraft mc, WagonEntity car, int index) {
        WagonType.Door door = car.framedDoors().get(index);
        double cx = (door.minX() + door.maxX()) * 0.5;
        double cz = (door.minZ() + door.maxZ()) * 0.5;
        double out = door.outward() * 2.5;
        standAt(mc, car, door.axis() == 0 ? cx + out : cx, door.minY(), door.axis() == 0 ? cz : cz + out);
    }

    /** Teleport the player's feet to a point of {@code car}'s pose frame. */
    private static void standAt(Minecraft mc, WagonEntity car, double x, double y, double z) {
        Vector3d world = PoseMath.localToWorld(new Vector3d(car.getX(), car.getY(), car.getZ()),
                car.getYRot(), car.getXRot(), new Vector3d(x, y, z));
        command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f", world.x, world.y, world.z));
    }

    /** Turn the player to look at the middle of door {@code index} of {@code car}. */
    private static void aimAtDoor(Minecraft mc, WagonEntity car, int index) {
        WagonType.Door door = car.framedDoors().get(index);
        Vector3d world = PoseMath.localToWorld(new Vector3d(car.getX(), car.getY(), car.getZ()),
                car.getYRot(), car.getXRot(), new Vector3d((door.minX() + door.maxX()) * 0.5,
                        (door.minY() + door.maxY()) * 0.5, (door.minZ() + door.maxZ()) * 0.5));
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

    /**
     * Put the riding player's server feet at the start of the coach's longest
     * stretch of floor along it, to walk forward along it (reflection on the
     * private {@code riderLocal}); and note them.
     */
    @SuppressWarnings("unchecked")
    private static void putFeetInTheAisle(Minecraft mc, WagonEntity coach) {
        WagonType.Interior interior = coach.typeNow().interior().inFrame(coach.isFlipped());
        WagonType.Interior.Zone longest = interior.zones().get(0);
        for (WagonType.Interior.Zone zone : interior.zones()) {
            if (zone.maxZ() - zone.minZ() > longest.maxZ() - longest.minZ()) {
                longest = zone;
            }
        }
        Vector3d spot = new Vector3d((longest.minX() + longest.maxX()) * 0.5, longest.minY(), longest.minZ() + 1.0);
        double length = longest.maxZ() - longest.minZ();
        onServer(mc, coach, (car, player) -> {
            try {
                var field = WagonEntity.class.getDeclaredField("riderLocal");
                field.setAccessible(true);
                ((Map<UUID, Vector3d>) field.get(car)).put(player.getUUID(), new Vector3d(spot));
                feetBefore = new Vector3d(spot);
                RailsWheelsAndTrains.LOGGER.info("{} feet put at {} (a stretch of floor {} long)", TAG, fmt(spot),
                        String.format(Locale.ROOT, "%.1f", length));
            } catch (ReflectiveOperationException e) {
                RailsWheelsAndTrains.LOGGER.warn("{} can't move the rider", TAG, e);
            }
        });
    }

    /** The player's server feet on {@code car} (reflection on the private {@code riderLocal}), or null. */
    @SuppressWarnings("unchecked")
    private static Vector3d feet(WagonEntity car, ServerPlayer player) {
        try {
            var field = WagonEntity.class.getDeclaredField("riderLocal");
            field.setAccessible(true);
            Vector3d feet = ((Map<UUID, Vector3d>) field.get(car)).get(player.getUUID());
            return feet == null ? null : new Vector3d(feet);
        } catch (ReflectiveOperationException e) {
            return null;
        }
    }

    private static boolean handbrake(WagonEntity car) {
        return ClientConsists.handbrake(car.getConsistId(), car.getWagonIndex());
    }

    /** The coach's handbrake now against before; {@code turns}: whether it should have turned. */
    private static void logHandbrake(Minecraft mc, WagonEntity coach, String how, boolean turns) {
        boolean now = handbrake(coach);
        log(mc, how + ": handbrake " + handbrakeBefore + " -> " + now + " (expect "
                + (turns ? "turned" : "unchanged") + ": " + (now != handbrakeBefore ? "turned" : "unchanged") + ")");
        handbrakeBefore = now;
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

    private static String fmt(Vector3d v) {
        return v == null ? "-" : String.format(Locale.ROOT, "(%.2f %.2f %.2f)", v.x, v.y, v.z);
    }

    private static void log(Minecraft mc, String what) {
        RailsWheelsAndTrains.LOGGER.info("{} t={} {}", TAG, ticks, what);
    }

    private static void shot(Minecraft mc, String name) {
        Screenshot.grab(mc.gameDirectory, name, mc.getMainRenderTarget(),
                message -> RailsWheelsAndTrains.LOGGER.info("{} {}", TAG, message.getString()));
    }
}
