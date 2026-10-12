package com.muzhik17.trainsmod.debug;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.ConsistManager;
import com.muzhik17.trainsmod.consist.Coupling;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.network.TrackPathSpec;
import com.muzhik17.trainsmod.path.RailSegment;
import com.muzhik17.trainsmod.path.TrackPath;
import com.muzhik17.trainsmod.physics.TrainPhysics;
import com.muzhik17.trainsmod.rail.RailNetwork;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypes;

import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;

/**
 * Dev tool (SPEC §2.1, chunk loading, 2026-10-12): {@code -Pautoscene=row}
 * on a throwaway save copy, best with a short render distance (4–6) — the
 * user's case of a long row of uncoupled cars. A straight line of track
 * 4000 blocks east of the player, a ChME3 at its start and 36 platzkarts
 * standing 2 blocks apart ahead of it (≈ 980 blocks), each set down as a
 * player would, walking along; back at the loco the far cars are unloaded
 * (logged), and the client tells how far it draws the frozen ones beyond the
 * simulation distance. The player sits in the driver's chair and pushes
 * into the row at 5–9 km/h (throttle on and off). Every two seconds the log
 * gets the train's make-up, speed, chunks held and how many of its cars are
 * loaded ({@code [row]} lines); a train front running more than the overlap
 * past a standing car is reported as {@code PASSED THROUGH}. Ends with
 * {@code [row] RESULT} — how many of the row coupled — the driver getting
 * out, and the chunks held 22 s later (the linger is 20 s); screenshots
 * {@code rwat-row-before/end.png}; quits the game. With
 * {@code [chunk_loading] mode = "OFF"} in the save's server config it shows
 * the coupling alone: no chunks held, the far cars stay unloaded and couple
 * all the same.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class CouplingRowScene {

    private static final int ROW = 36;
    /** Between the cars' frames as they stand, blocks. */
    private static final double SPACING = 2.0;
    private static final double LINE_LENGTH = 1300.0;
    private static final double SEGMENT = 100.0;
    /** Cars set down per stop of the walk along the row. */
    private static final int BATCH = 4;
    private static final int BATCHES = (ROW + BATCH - 1) / BATCH;
    private static final int WALK_START = 200;
    private static final int WALK_STEP = 40;
    private static final int BACK = WALK_START + BATCHES * WALK_STEP + 20;
    private static final int DRIVE = BACK + 300;
    private static final int TIMEOUT = DRIVE + 6000;

    private static int ticks;
    private static Vec3 origin;
    private static int finishedAt = -1;

    // server thread
    private static TrackPathSpec spec;
    private static TrackPath path;
    private static double rowStart;
    private static int trainId = -1;
    private static final List<UUID> rowCars = new ArrayList<>();
    private static volatile boolean finished;
    private static volatile boolean seated;
    /** Where the loco stands at the end (the camera looks at it). */
    private static volatile double locoX;
    private static int lastWagons;

    private CouplingRowScene() {
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        if (!"row".equals(System.getProperty("rwat.autoscene")) || mc.player == null || mc.level == null) {
            return;
        }
        ticks++;
        if (ticks == 100) {
            origin = mc.player.position().add(4000.0, 0.0, 0.0);
            command(mc, "gamemode creative");
            command(mc, "gamerule doDaylightCycle false");
            command(mc, "time set noon");
            command(mc, "weather clear");
            command(mc, tp(origin.x - 10.0, origin.y + 1.0, origin.z + 6.0, -90.0F, 20.0F));
        } else if (ticks == 140) {
            server(mc, CouplingRowScene::layTrack);
        } else if (ticks == 180) {
            server(mc, CouplingRowScene::spawnLoco);
        } else if (ticks >= WALK_START && ticks < BACK - 20) {
            // walk along the row, setting the cars down near the player
            int at = ticks - WALK_START;
            int batch = at / WALK_STEP;
            if (at % WALK_STEP == 0) {
                double s = rowStart + (batch * BATCH + BATCH * 0.5) * (25.0 + SPACING);
                command(mc, tp(origin.x + s, origin.y + 3.0, origin.z + 6.0, -90.0F, 20.0F));
            } else if (at % WALK_STEP == 20) {
                server(mc, server -> spawnBatch(server, batch));
            }
        } else if (ticks == BACK) {
            command(mc, tp(origin.x - 10.0, origin.y + 1.0, origin.z + 6.0, -90.0F, 20.0F));
        } else if (ticks == BACK + 180) {
            command(mc, tp(origin.x - 10.0, origin.y + 12.0, origin.z + 14.0, -100.0F, 12.0F));
        } else if (ticks == BACK + 195) {
            shot(mc, "rwat-row-before.png");
            seen(mc);
        } else if (ticks == BACK + 200) {
            server(mc, server -> report(server, "before the run"));
        } else if (ticks >= BACK + 220 && ticks < DRIVE && ticks % 10 == 0 && !seated) {
            server(mc, CouplingRowScene::sitDriver);
        } else if (ticks >= DRIVE && finishedAt < 0) {
            if (ticks % 5 == 0) {
                server(mc, CouplingRowScene::drive);
            }
            if (ticks % 40 == 0) {
                server(mc, server -> report(server, "t=" + ticks));
            }
            if (finished || ticks >= TIMEOUT) {
                finishedAt = ticks;
                server(mc, CouplingRowScene::result);
            }
        } else if (finishedAt > 0 && ticks == finishedAt + 40) {
            // out of the cab and up: the loco and the cars it took up, from above
            server(mc, CouplingRowScene::leaveCab);
        } else if (finishedAt > 0 && ticks == finishedAt + 50) {
            command(mc, "gamemode spectator");
            command(mc, tp(locoX + 45.0, origin.y + 14.0, origin.z + 22.0, 115.0F, 14.0F));
        } else if (finishedAt > 0 && ticks == finishedAt + 120) {
            shot(mc, "rwat-row-end.png");
            seen(mc);
        } else if (finishedAt > 0 && ticks == finishedAt + 560) {
            // standing with nobody at the controls: 20 s on, it has let its chunks go
            server(mc, server -> report(server, "22 s after the driver left"));
        } else if (finishedAt > 0 && ticks == finishedAt + 580) {
            server(mc, CouplingRowScene::letRoll);
        } else if (finishedAt > 0 && ticks == finishedAt + 640) {
            // rolling with nobody at the controls: it holds its chunks again
            server(mc, server -> report(server, "3 s into an unmanned roll"));
        } else if (finishedAt > 0 && ticks == finishedAt + 660) {
            mc.stop();
        }
    }

    // --- server side ---

    private static void layTrack(MinecraftServer server) {
        ServerLevel level = server.overworld();
        RailNetwork network = RailNetwork.get(level);
        Vector3d dir = new Vector3d(1.0, 0.0, 0.0);
        RailSegment first = null;
        for (double x = 0.0; x < LINE_LENGTH; x += SEGMENT) {
            Vector3d a = new Vector3d(Math.floor(origin.x) + x + 0.5, Math.floor(origin.y), Math.floor(origin.z) + 0.5);
            Vector3d b = new Vector3d(a).add(SEGMENT, 0.0, 0.0);
            RailSegment segment = network.createSegment(level, a, dir, b, dir, RailSegment.Look.DEFAULT);
            first = first == null ? segment : first;
        }
        TrackPathSpec.Route route = TrackPathSpec.Route.of(network.graph().walkRoute(first.id()));
        TrackPath walked = route.resolve(network.graph());
        // every consist of the scene on one route running +X, so s grows eastwards
        spec = walked.samplePosition(0.0).x < walked.samplePosition(walked.length()).x ? route : route.inverted();
        path = spec.resolve(network.graph());
        RailsWheelsAndTrains.LOGGER.info("[row] track laid: {} blocks", String.format(Locale.ROOT, "%.0f", path.length()));
    }

    private static void spawnLoco(MinecraftServer server) {
        ServerLevel level = server.overworld();
        ConsistComposition loco = composition("chme3");
        double front = 8.0 + loco.totalLength();
        double head = front - Coupling.frontEndS(loco, 0.0);
        Consist consist = ConsistManager.get(level).spawn(level, spec, path, loco, head);
        trainId = consist.id();
        rowStart = front + 6.0;
        RailsWheelsAndTrains.LOGGER.info("[row] loco #{} front at s={}, the row from s={}", trainId,
                front, rowStart);
    }

    private static void spawnBatch(MinecraftServer server, int batch) {
        ServerLevel level = server.overworld();
        ConsistComposition car = composition("amendorf");
        double pitch = car.slot(0).type().length() + SPACING;
        for (int k = batch * BATCH; k < Math.min(ROW, (batch + 1) * BATCH); k++) {
            double rear = rowStart + k * pitch;
            double head = rear - Coupling.rearEndS(car, 0.0);
            Consist consist = ConsistManager.get(level).spawn(level, spec, path, car, head);
            rowCars.add(consist.wagonIds().get(0));
        }
        RailsWheelsAndTrains.LOGGER.info("[row] set down cars {}..{}", batch * BATCH,
                Math.min(ROW, (batch + 1) * BATCH) - 1);
    }

    private static ConsistComposition composition(String name) {
        for (WagonType type : WagonTypes.all()) {
            if (type.id().endsWith(":" + name)) {
                return new ConsistComposition(List.of(new ConsistComposition.Slot(type, false)));
            }
        }
        throw new IllegalStateException("no " + name + " in the packs");
    }

    private static void sitDriver(MinecraftServer server) {
        ServerLevel level = server.overworld();
        Consist train = ConsistManager.get(level).byId(trainId);
        ServerPlayer player = server.getPlayerList().getPlayers().get(0);
        if (train == null || !(level.getEntity(train.wagonIds().get(train.wagonIds().size() - 1))
                instanceof WagonEntity loco)) {
            return;
        }
        WagonType type = loco.typeNow();
        if (type == null) {
            return;
        }
        if (type.interior() == null || loco.seat(0) == null) {
            player.startRiding(loco, true);
        } else {
            if (player.getVehicle() != loco) {
                WagonType.Seat seat = loco.seat(0);
                Vector3d chair = PoseMath.localToWorld(new Vector3d(loco.getX(), loco.getY(), loco.getZ()),
                        loco.getYRot(), loco.getXRot(), new Vector3d(seat.x(), seat.y(), seat.z()));
                player.stopRiding();
                player.teleportTo(chair.x, chair.y, chair.z);
                try {
                    var board = WagonEntity.class.getDeclaredMethod("board", ServerPlayer.class, WagonType.class);
                    board.setAccessible(true);
                    board.invoke(loco, player, type);
                } catch (ReflectiveOperationException e) {
                    RailsWheelsAndTrains.LOGGER.warn("[row] can't board", e);
                    return;
                }
            }
            loco.sitDriver(player, 0);
        }
        ConsistManager.Driver driver = ConsistManager.driverOf(level, train);
        seated = driver != null;
        if (seated) {
            // forward is where the chair looks: pull towards +s, into the row
            train.setHandle(Consist.Handle.REVERSER, driver.facing());
            train.setHandle(Consist.Handle.TRAIN_BRAKE, 0);
            train.setHandle(Consist.Handle.INDEPENDENT_BRAKE, 0);
        }
        RailsWheelsAndTrains.LOGGER.info("[row] driver seated: {}", seated);
    }

    /** Throttle on below 5 km/h, off above 9 (the row couples at up to 15); watch for a run-through. */
    private static void drive(MinecraftServer server) {
        ServerLevel level = server.overworld();
        ConsistManager manager = ConsistManager.get(level);
        Consist train = manager.byId(trainId);
        if (train == null) {
            RailsWheelsAndTrains.LOGGER.warn("[row] the train #{} is gone", trainId);
            finished = true;
            return;
        }
        double kmh = Math.abs(TrainPhysics.kmh(train.speed()));
        if (kmh > 9.0) {
            train.setHandle(Consist.Handle.THROTTLE, 0);
        } else if (kmh < 5.0) {
            train.setHandle(Consist.Handle.THROTTLE, 8);
        }
        double front = path.samplePosition(Coupling.frontEndS(train.composition(), train.s())).x;
        for (UUID car : rowCars) {
            Consist standing = manager.ownerOf(car);
            if (standing == null || standing == train) {
                continue;
            }
            double rear = path.samplePosition(Coupling.rearEndS(standing.composition(), standing.s())).x;
            if (front > rear + Coupling.MAX_OVERLAP) {
                RailsWheelsAndTrains.LOGGER.error("[row] PASSED THROUGH consist #{} (front x {} past its rear x {})",
                        standing.id(), String.format(Locale.ROOT, "%.1f", front), String.format(Locale.ROOT, "%.1f", rear));
                finished = true;
                return;
            }
        }
        if (train.composition().wagonCount() >= ROW + 1) {
            train.setHandle(Consist.Handle.THROTTLE, 0);
            train.setHandle(Consist.Handle.TRAIN_BRAKE, 6);
            finished = true;
        }
        if (train.composition().wagonCount() != lastWagons) {
            lastWagons = train.composition().wagonCount();
            RailsWheelsAndTrains.LOGGER.info("[row] coupled: {} wagons", lastWagons);
        }
    }

    private static void report(MinecraftServer server, String when) {
        ServerLevel level = server.overworld();
        ConsistManager manager = ConsistManager.get(level);
        int unloaded = 0;
        for (UUID car : rowCars) {
            if (level.getEntity(car) == null) {
                unloaded++;
            }
        }
        Consist train = manager.byId(trainId);
        if (train == null) {
            return;
        }
        int loaded = 0;
        for (UUID wagon : train.wagonIds()) {
            if (level.getEntity(wagon) instanceof WagonEntity) {
                loaded++;
            }
        }
        RailsWheelsAndTrains.LOGGER.info(String.format(Locale.ROOT,
                "[row] %s: train #%d %d wagons (%d loaded) %.1f km/h throttle %d, holds %d chunks;"
                        + " %d consists in the world, %d of the %d row cars unloaded",
                when, train.id(), train.composition().wagonCount(), loaded,
                Math.abs(TrainPhysics.kmh(train.speed())), train.throttleNotch(), manager.chunksHeld(train.id()),
                manager.all().size(), unloaded, rowCars.size()));
    }

    /** Brakes off and a shove: the train rolls away east at 29 km/h with nobody aboard. */
    private static void letRoll(MinecraftServer server) {
        Consist train = ConsistManager.get(server.overworld()).byId(trainId);
        if (train != null) {
            train.setHandle(Consist.Handle.TRAIN_BRAKE, 0);
            train.setAllHandbrakes(false);
            train.setSpeed(0.4);
        }
    }

    private static void leaveCab(MinecraftServer server) {
        ServerPlayer player = server.getPlayerList().getPlayers().get(0);
        if (!(player.getVehicle() instanceof WagonEntity cab)) {
            return;
        }
        try {
            var exit = WagonEntity.class.getDeclaredMethod("exitRider", ServerPlayer.class);
            exit.setAccessible(true);
            exit.invoke(cab, player);
        } catch (ReflectiveOperationException e) {
            RailsWheelsAndTrains.LOGGER.warn("[row] can't get off", e);
        }
    }

    private static void result(MinecraftServer server) {
        report(server, "end");
        Consist train = ConsistManager.get(server.overworld()).byId(trainId);
        if (train != null) {
            locoX = path.samplePosition(train.composition().bodyCenterS(train.s(),
                    train.composition().wagonCount() - 1)).x;
        }
        int coupled = train == null ? 0 : train.composition().wagonCount() - 1;
        RailsWheelsAndTrains.LOGGER.info("[row] RESULT: {} of {} row cars coupled", coupled, ROW);
    }

    // --- client side ---

    /**
     * The wagons this client has and how many of them it can draw (it knows
     * their consist), and the farthest drawable one: cars that stand frozen
     * past the simulation distance must stay drawable.
     */
    private static void seen(Minecraft mc) {
        int wagons = 0;
        int drawable = 0;
        double farthest = 0.0;
        for (var entity : mc.level.entitiesForRendering()) {
            if (entity instanceof WagonEntity wagon) {
                wagons++;
                if (ClientConsists.slot(wagon.getConsistId(), wagon.getWagonIndex()) != null) {
                    drawable++;
                    farthest = Math.max(farthest, wagon.distanceTo(mc.player));
                }
            }
        }
        RailsWheelsAndTrains.LOGGER.info(String.format(Locale.ROOT,
                "[row] this client has %d wagons, %d drawable, the farthest drawable %.0f blocks away",
                wagons, drawable, farthest));
    }

    private static String tp(double x, double y, double z, float yaw, float pitch) {
        return String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f %.1f %.1f", x, y, z, yaw, pitch);
    }

    private interface ServerTask {
        void run(MinecraftServer server);
    }

    private static void server(Minecraft mc, ServerTask task) {
        MinecraftServer server = mc.getSingleplayerServer();
        if (server != null) {
            server.execute(() -> task.run(server));
        }
    }

    /** A command as the player, with operator rights on the integrated server. */
    private static void command(Minecraft mc, String command) {
        RailsWheelsAndTrains.LOGGER.info("[row] /{}", command);
        MinecraftServer server = mc.getSingleplayerServer();
        if (server == null) {
            mc.player.connection.sendCommand(command);
            return;
        }
        UUID id = mc.player.getUUID();
        server.execute(() -> {
            ServerPlayer player = server.getPlayerList().getPlayer(id);
            if (player != null) {
                server.getCommands().performPrefixedCommand(
                        player.createCommandSourceStack().withPermission(4), command);
            }
        });
    }

    private static void shot(Minecraft mc, String name) {
        Screenshot.grab(mc.gameDirectory, name, mc.getMainRenderTarget(),
                message -> RailsWheelsAndTrains.LOGGER.info("[row] {}", message.getString()));
    }
}
