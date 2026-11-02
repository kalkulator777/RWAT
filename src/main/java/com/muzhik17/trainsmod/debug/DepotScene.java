package com.muzhik17.trainsmod.debug;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.render.BakeCache;
import com.muzhik17.trainsmod.client.render.WagonRenderer;
import com.muzhik17.trainsmod.client.render.model.StockModel;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.stock.ConsistComposition;

import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.world.entity.Entity;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RenderFrameEvent;

/**
 * Dev tool (SPEC §2.4a): {@code -Pautoscene=depot} on a throwaway save copy —
 * the wagon renderer's bake cache and draw path under load (H11, M29). A depot
 * of {@link #TRACKS} side by side, 4000 blocks east of the player: 32 wagons
 * of 32 different types and liveries of the MVP and the example pack, at
 * midnight, some trains with their lights on, glowstone between the tracks
 * so the cars stand in different light — more bake combinations than the
 * cache's capacity, all in one view from above. Once every car's model has
 * loaded and a warm-up has passed, a {@link #WINDOW_TICKS}-tick window is
 * measured: frames and their times, and what the bake cache did
 * ({@code [depot]} lines in the log); then {@code rwat-depot.png}, and
 * {@code rwat-depot-beam.png} from ahead of the first train's leading
 * headlight looking away from it — its light on the track with the car
 * behind the camera (M28). Quits the game at the end.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class DepotScene {

    /** The depot's trains, front first, one track each ({@code /rwat spawn with}). */
    static final String[] TRACKS = {
        "shunter coach@blue coach gondola",
        "shunter@green chme3 chme3@koshmar004_4844 chme3@evgenygp_4434",
        "m62@mvp_1 m62@mvp_2 tank_15-1443@mvp_1 tank_15-1443@ilyxa_bensin",
        "chs4t@mvp_1 amendorf@mvp_1 amendorf@mvp_2 amendorf@mvp_rzd",
        "vl80c@mvp_extra vl80c@mvp_sme_3 dgku@mvp_red dgku@andrpv_red",
        "2te116@evgenygp_364 fitflat@mvp_black_1 fitflat@mvp_blue_1 hopper",
        "tem2y@mvp_1 freight freight_break fridge",
        "tep70 er2h er2m er2t",
    };
    /** The light groups switched on, per track. */
    private static final String[][] LIGHTS = {
        {"IL", "FHL"}, {"IL", "FHL"}, {}, {"IL"}, {"FHL"}, {}, {"IL", "FHL"}, {"IL"},
    };
    /** Across the tracks, blocks: room for a glowstone column between two cars. */
    private static final double SPACING = 6.0;
    /** Along each gap between tracks, glowstone this far from the tracks' start, blocks. */
    private static final int[][] GLOW = {{8, 50}, {20}, {35, 70}, {5, 60}, {28}, {45, 12}, {66}};
    /**
     * The beam shot's camera this far ahead of the leading car's front, blocks:
     * past the car's former culling box (half the longest car + 3.4 from its
     * centre), short of the end of its light on the track (22 past the lamp).
     */
    private static final double BEAM_VIEW_AHEAD = 14.0;
    private static final int WARMUP_TICKS = 400;
    private static final int WINDOW_TICKS = 400;
    private static final int MODEL_WAIT_TICKS = 2400;

    private static int ticks;
    private static int x0;
    private static int y0;
    private static int z0;
    /** The tick the cars all had their models (0 = not yet). */
    private static int ready;
    private static boolean measuring;
    private static long lastFrame;
    private static final List<Long> FRAMES = new ArrayList<>();
    private static BakeCache.Stats windowStart;
    private static BakeCache.Stats secondStart;
    private static int secondFrames;

    private DepotScene() {
    }

    private static boolean active() {
        return "depot".equals(System.getProperty("rwat.autoscene"));
    }

    @SubscribeEvent
    static void onFrame(RenderFrameEvent.Pre event) {
        if (!measuring) {
            return;
        }
        long now = System.nanoTime();
        if (lastFrame != 0L) {
            FRAMES.add(now - lastFrame);
        }
        lastFrame = now;
        secondFrames++;
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        if (!active() || mc.player == null || mc.level == null) {
            return;
        }
        ticks++;
        if (ticks == 100) {
            x0 = (int) Math.floor(mc.player.getX()) + 4000;
            y0 = (int) Math.floor(mc.player.getY());
            z0 = (int) Math.floor(mc.player.getZ());
            command(mc, "gamemode creative");
            command(mc, "gamerule doDaylightCycle false");
            command(mc, "gamerule doMobSpawning false");
            command(mc, "time set midnight");
            command(mc, "weather clear");
            tp(mc, x0 + 0.5, y0, z0 + 0.5, 0.0F, 0.0F);
        }
        int track = (ticks - 140) / 10;
        if (ticks >= 140 && track < TRACKS.length && (ticks - 140) % 10 == 0) {
            // on its own straight debug path (no rails near), front first along +Z
            tp(mc, trackX(track), y0, z0 + 0.5, 0.0F, 0.0F);
            command(mc, "rwat spawn 120 with " + TRACKS[track]);
        }
        if (ticks >= 140 && track < TRACKS.length && (ticks - 140) % 10 == 5) {
            // beside the train just spawned: it is the nearest one
            tp(mc, trackX(track) + 2.0, y0, z0 + 10.5, 0.0F, 0.0F);
            for (String group : LIGHTS[track]) {
                command(mc, "rwat control " + group + " 1");
            }
            command(mc, "rwat handle train_brake 8");
        }
        int setUp = 140 + TRACKS.length * 10;
        if (ticks == setUp) {
            for (int gap = 0; gap < GLOW.length; gap++) {
                for (int z : GLOW[gap]) {
                    int x = (int) Math.floor(trackX(gap)) + 3;
                    command(mc, String.format(Locale.ROOT, "fill %d %d %d %d %d %d minecraft:glowstone",
                            x, y0, z0 + z, x, y0 + 1, z0 + z));
                }
            }
            command(mc, "kill @e[type=minecraft:slime]");
            command(mc, "gamemode spectator");
            mc.options.hideGui = true;
            overview(mc);
        }
        if (ticks > setUp && ready == 0) {
            int[] cars = cars(mc);
            if (cars[0] >= wagonCount() && cars[1] == cars[0] || ticks > setUp + MODEL_WAIT_TICKS) {
                ready = ticks;
                RailsWheelsAndTrains.LOGGER.info("[depot] t={} {} cars, {} with their model; {}", ticks, cars[0],
                        cars[1], keys(mc));
            }
            return;
        }
        if (ready == 0) {
            return;
        }
        int t = ticks - ready;
        if (t == WARMUP_TICKS) {
            measuring = true;
            FRAMES.clear();
            lastFrame = 0L;
            secondFrames = 0;
            windowStart = WagonRenderer.bakeStats();
            secondStart = windowStart;
            RailsWheelsAndTrains.LOGGER.info("[depot] window opens: {}; {}", keys(mc),
                    mc.levelRenderer.getEntityStatistics());
        }
        if (measuring && t > WARMUP_TICKS && (t - WARMUP_TICKS) % 20 == 0) {
            BakeCache.Stats now = WagonRenderer.bakeStats();
            BakeCache.Stats second = now.since(secondStart);
            RailsWheelsAndTrains.LOGGER.info("[depot] +{}s: {} frames (fps {}), bakes {}, hits {}, stand-ins {},"
                    + " deferred {}, evicted {}, cached {}; {}", (t - WARMUP_TICKS) / 20, secondFrames,
                    mc.getFps(), second.bakes(), second.hits(), second.standIns(), second.deferred(),
                    second.evictions(), now.size(), mc.levelRenderer.getEntityStatistics());
            secondStart = now;
            secondFrames = 0;
        }
        if (t == WARMUP_TICKS + WINDOW_TICKS) {
            measuring = false;
            report(WagonRenderer.bakeStats().since(windowStart));
        }
        if (t == WARMUP_TICKS + WINDOW_TICKS + 10) {
            shot(mc, "rwat-depot.png");
        }
        if (t == WARMUP_TICKS + WINDOW_TICKS + 20) {
            beamView(mc);
        }
        if (t == WARMUP_TICKS + WINDOW_TICKS + 120) {
            shot(mc, "rwat-depot-beam.png");
        }
        if (t == WARMUP_TICKS + WINDOW_TICKS + 140) {
            mc.stop();
        }
    }

    private static double trackX(int track) {
        return x0 + 0.5 + track * SPACING;
    }

    private static int wagonCount() {
        int n = 0;
        for (String train : TRACKS) {
            n += train.split(" ").length;
        }
        return n;
    }

    /** Over the depot from behind its start, looking down along the tracks. */
    private static void overview(Minecraft mc) {
        tp(mc, trackX(0) + (TRACKS.length - 1) * SPACING * 0.5, y0 + 30.0, z0 - 25.0, 0.0F, 35.0F);
    }

    /**
     * {@link #BEAM_VIEW_AHEAD} blocks ahead of the first train's leading car,
     * looking on along the track: the car is behind the camera, its light on
     * the track ahead.
     */
    private static void beamView(Minecraft mc) {
        double front = z0 + 0.5;
        for (Entity entity : mc.level.entitiesForRendering()) {
            if (entity instanceof WagonEntity wagon && Math.abs(wagon.getX() - trackX(0)) < 1.0) {
                ConsistComposition.Slot slot = ClientConsists.slot(wagon.getConsistId(), wagon.getWagonIndex());
                double length = slot != null ? slot.type().length() : 0.0;
                front = Math.max(front, wagon.getZ() + length * 0.5);
            }
        }
        tp(mc, trackX(0), y0 + 2.5, front + BEAM_VIEW_AHEAD, 0.0F, 30.0F);
    }

    /** {cars in the depot, cars whose model has loaded}. */
    private static int[] cars(Minecraft mc) {
        int cars = 0;
        int loaded = 0;
        for (Entity entity : mc.level.entitiesForRendering()) {
            if (entity instanceof WagonEntity wagon) {
                cars++;
                ConsistComposition.Slot slot = ClientConsists.slot(wagon.getConsistId(), wagon.getWagonIndex());
                if (slot != null && StockModels.model(slot.type().id()) != null) {
                    loaded++;
                }
            }
        }
        return new int[]{cars, loaded};
    }

    /** How many bake combinations (model, livery, light, lit groups) the cars in the depot make. */
    private static String keys(Minecraft mc) {
        Set<String> models = new HashSet<>();
        Set<String> keys = new HashSet<>();
        Set<Integer> lights = new HashSet<>();
        for (Entity entity : mc.level.entitiesForRendering()) {
            if (entity instanceof WagonEntity wagon) {
                ConsistComposition.Slot slot = ClientConsists.slot(wagon.getConsistId(), wagon.getWagonIndex());
                StockModel model = slot == null ? null : StockModels.model(slot.type().id());
                if (model == null) {
                    continue;
                }
                int light = mc.getEntityRenderDispatcher().getPackedLightCoords(wagon, 1.0F);
                long lit = model.litMask(wagon::controlValue);
                models.add(slot.type().id() + "@" + slot.livery());
                keys.add(slot.type().id() + "@" + slot.livery() + "/" + light + "/" + lit);
                lights.add(light);
            }
        }
        return models.size() + " models × liveries, " + lights.size() + " light values, " + keys.size()
                + " bake combinations";
    }

    private static void report(BakeCache.Stats bakes) {
        long[] times = FRAMES.stream().mapToLong(Long::longValue).sorted().toArray();
        if (times.length == 0) {
            RailsWheelsAndTrains.LOGGER.warn("[depot] no frames measured");
            return;
        }
        double total = Arrays.stream(times).sum() / 1.0e6;
        RailsWheelsAndTrains.LOGGER.info(String.format(Locale.ROOT,
                "[depot] RESULT %d frames in %.1f s: %.1f fps, frame ms mean %.1f, p50 %.1f, p95 %.1f, max %.1f;"
                        + " bakes %d (%.2f a frame), hits %d, stand-ins %d, deferred %d, evicted %d, cached %d",
                times.length, total / 1000.0, times.length / (total / 1000.0), total / times.length,
                times[times.length / 2] / 1.0e6, times[(int) (times.length * 0.95)] / 1.0e6,
                times[times.length - 1] / 1.0e6, bakes.bakes(), bakes.bakes() / (double) times.length,
                bakes.hits(), bakes.standIns(), bakes.deferred(), bakes.evictions(), bakes.size()));
    }

    private static void tp(Minecraft mc, double x, double y, double z, float yaw, float pitch) {
        command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f %.1f %.1f", x, y, z, yaw, pitch));
    }

    /** As the player, on the integrated server with operator rights (as {@link ClientAutoScene} does). */
    private static void command(Minecraft mc, String command) {
        RailsWheelsAndTrains.LOGGER.info("[depot] /{}", command);
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
                message -> RailsWheelsAndTrains.LOGGER.info("[depot] {}", message.getString()));
    }
}
