package com.muzhik17.trainsmod.debug;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.function.BiConsumer;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.ClientRailGraph;
import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.RailSegment;
import com.muzhik17.trainsmod.rail.RailNetwork;

import net.minecraft.Util;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.renderer.culling.Frustum;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.AABB;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RenderLevelStageEvent;

/**
 * Dev tool: the rail renderer's own checks (SPEC §2.4), like
 * {@link ClientAutoScene} — {@code ./gradlew runClient -PquickPlay=<flat
 * world copy> -Pautoscene=railperf|railedge|railfar}. Off unless the system
 * property {@code rwat.autoscene} names one of them; use a throwaway copy of
 * a save. Logs {@code [railrender]} lines, shots go to
 * {@code screenshots/rwat-rail{perf,edge,far}*.png}, quits at the end. The
 * scenes measure from outside the renderer — the time between the first and
 * the last listener of the stage the rails draw in — so they read the same
 * on any version of it.
 *
 * <p>{@code railperf}: a grid of {@value #GRID_COLUMNS}×{@value #GRID_ROWS}
 * Y-switches in {@code mvp:rail}, 4000 blocks east of the player; one of
 * them is thrown by redstone every two seconds, six times seen from close by
 * it ({@code close}: a few regions in view) and six times with the whole
 * grid in view from above ({@code grid}). Per view the log gives the rail
 * pass's time per frame — idle, on the frame a switch state arrives, and
 * while its blades move — and the frame time; {@code rwat-railperf-<view>.png}.
 *
 * <p>{@code railedge}: a {@code mvp:crossbridge} crossing (deck ±4 blocks
 * across) and a {@code mvp:rail_bridge} bridge (±2.6), 200 blocks apart;
 * over each, the camera stands on the deck near its edge, looking away from
 * the track and down — the centre line behind it, out of view, the deck's
 * edge in front ({@code rwat-railedge-<style>.png}: the deck must be there),
 * then turned back at the track ({@code -ref}). The log says whether the
 * frame's frustum takes the centre line ± 2 blocks and the deck beyond.
 *
 * <p>{@code railfar}: a straight and a curve in {@code mvp:rail} at
 * x = z = 300 000, looked at from a hand's breadth over the curve's rails
 * ({@code rwat-railfar-<n>.png}, the camera 0.008 blocks further along X and
 * Z each shot): the rails must keep their shape and sit on their bed as they
 * do near the origin, moving with it from shot to shot.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class RailRenderScene {

    private static final String TAG = "[railrender]";
    private static final int GRID_COLUMNS = 8;
    private static final int GRID_ROWS = 6;
    /** Ticks between two throws of the measured switch. */
    private static final int THROW_EVERY = 40;
    /** Throws measured per view. */
    private static final int THROWS = 6;
    /** The views the throws are measured from: by the thrown switch, then the whole grid. */
    private static final String[] VIEWS = {"close", "grid"};
    /** How long after a switch state arrives its blades count as moving, ms (the animation is 500). */
    private static final long MOVING_MS = 550;

    private static int ticks;
    private static BlockPos origin;
    /** The redstone cell under the measured switch's stand. */
    private static BlockPos pulse;
    /** The measured switch's toe node. */
    private static volatile Vector3d toe;

    // --- railperf timing, render thread ---
    private static boolean measuring;
    private static long passStart;
    private static long lastFrame;
    private static int lastGeneration;
    private static long movingUntil;
    private static boolean syncFrame;
    private static final List<Long> idlePass = new ArrayList<>();
    private static final List<Long> syncPass = new ArrayList<>();
    private static final List<Long> movingPass = new ArrayList<>();
    private static final List<Long> idleFrame = new ArrayList<>();
    private static final List<Long> movingFrame = new ArrayList<>();

    // --- railedge ---
    private static Frustum frustum;

    private RailRenderScene() {
    }

    private static String scene() {
        String scene = System.getProperty("rwat.autoscene");
        return scene != null && (scene.equals("railperf") || scene.equals("railedge") || scene.equals("railfar"))
                ? scene : null;
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        String scene = scene();
        Minecraft mc = Minecraft.getInstance();
        if (scene == null || mc.player == null || mc.level == null) {
            return;
        }
        ticks++;
        if (ticks < 100) {
            return;
        }
        if (ticks == 100) {
            command(mc, "gamemode creative");
            command(mc, "gamerule doDaylightCycle false");
            command(mc, "time set noon");
            command(mc, "weather clear");
            command(mc, "difficulty peaceful");
        }
        switch (scene) {
            case "railperf" -> perf(mc);
            case "railedge" -> edge(mc);
            default -> far(mc);
        }
    }

    // --- railperf ---

    private static void perf(Minecraft mc) {
        if (ticks == 100) {
            origin = BlockPos.containing(mc.player.position().add(4000.0, 0.0, 0.0));
            return;
        }
        if (ticks == 120) {
            onServer(mc, RailRenderScene::buildGrid);
            return;
        }
        if (ticks == 140) {
            command(mc, "gamemode spectator"); // flies where it is put
            mc.options.hideGui = true;
            return;
        }
        if (ticks < 160 || toe == null) {
            return;
        }
        // per view: the camera, 100 ticks to settle (every region baked), then the throws
        int perView = 100 + THROWS * THROW_EVERY;
        int view = (ticks - 160) / perView;
        int t = (ticks - 160) % perView;
        if (view >= VIEWS.length) {
            if (ticks == 160 + VIEWS.length * perView + 20) {
                mc.stop();
            }
            return;
        }
        if (t == 0) {
            if (view == 0) {
                // by the thrown switch, looking along its legs
                camera(mc, toe.x - 4.0, toe.y + 6.0, toe.z + 2.0, -90.0F, 40.0F);
            } else {
                camera(mc, origin.getX() + 115.0, origin.getY() + 70.0, origin.getZ() - 40.0, 0.0F, 55.0F);
            }
        } else if (t == 100) {
            idlePass.clear();
            syncPass.clear();
            movingPass.clear();
            idleFrame.clear();
            movingFrame.clear();
            lastFrame = 0;
            lastGeneration = ClientRailGraph.generation();
            measuring = true;
        } else if (t > 100) {
            int into = (t - 100) % THROW_EVERY;
            if (into == 10) {
                setblock(mc, pulse, "minecraft:redstone_block"); // a rising edge throws the switch
            } else if (into == 30) {
                setblock(mc, pulse, "minecraft:dirt");
            }
            if (t == 100 + 14) {
                shot(mc, "rwat-railperf-" + VIEWS[view] + ".png");
            }
        }
        if (t == perView - 1) {
            measuring = false;
            RailsWheelsAndTrains.LOGGER.info("{} perf {}: {} switches, rail pass per frame — idle {}; state arrives {};"
                    + " blades moving {}", TAG, VIEWS[view], GRID_COLUMNS * GRID_ROWS, stats(idlePass),
                    stats(syncPass), stats(movingPass));
            RailsWheelsAndTrains.LOGGER.info("{} perf {}: frame time — idle {}; blades moving {}", TAG, VIEWS[view],
                    stats(idleFrame), stats(movingFrame));
        }
    }

    /**
     * The grid: per switch a trunk of 8 blocks into the toe node, a straight
     * leg of 17 and a diverging one 4 over, all along +X. The middle one gets
     * a switch stand with redstone two cells under it.
     */
    private static void buildGrid(ServerLevel level, ServerPlayer player) {
        RailNetwork network = RailNetwork.get(level);
        RailSegment.Look look = new RailSegment.Look("mvp:rail", null);
        Vector3d x = new Vector3d(1, 0, 0);
        double y = origin.getY();
        int refused = 0;
        for (int i = 0; i < GRID_COLUMNS; i++) {
            for (int j = 0; j < GRID_ROWS; j++) {
                double bx = origin.getX() + 0.5 + 30 * i;
                double bz = origin.getZ() + 0.5 + 12 * j;
                Vector3d start = new Vector3d(bx, y, bz);
                Vector3d toe = new Vector3d(bx + 8, y, bz);
                for (RailNetwork.SegmentSpec spec : List.of(
                        new RailNetwork.SegmentSpec(start, x, toe, x),
                        new RailNetwork.SegmentSpec(toe, x, new Vector3d(bx + 25, y, bz), x),
                        new RailNetwork.SegmentSpec(toe, x, new Vector3d(bx + 25, y, bz + 4), x))) {
                    if (network.build(level, player, List.of(spec), look, List.of()) == null) {
                        refused++;
                    }
                }
                if (i == GRID_COLUMNS / 2 && j == GRID_ROWS / 2) {
                    BlockPos stand = BlockPos.containing(toe.x, y, toe.z);
                    network.registerSwitchStand(stand, toe);
                    pulse = stand.below(2);
                    RailRenderScene.toe = toe;
                }
            }
        }
        RailGraph graph = network.graph();
        RailsWheelsAndTrains.LOGGER.info("{} perf: built {} segments, {} nodes ({} refused), stand under {}", TAG,
                graph.segments().size(), graph.nodes().size(), refused, pulse);
    }

    @SubscribeEvent(priority = EventPriority.HIGHEST)
    static void beforeRails(RenderLevelStageEvent event) {
        if (scene() == null) {
            return;
        }
        if (event.getStage() == RenderLevelStageEvent.Stage.AFTER_SKY && measuring) {
            long now = System.nanoTime();
            if (lastFrame != 0) {
                (Util.getMillis() < movingUntil ? movingFrame : idleFrame).add(now - lastFrame);
            }
            lastFrame = now;
        }
        if (event.getStage() != RenderLevelStageEvent.Stage.AFTER_BLOCK_ENTITIES) {
            return;
        }
        frustum = event.getFrustum();
        int generation = ClientRailGraph.generation();
        syncFrame = generation != lastGeneration;
        if (syncFrame) {
            lastGeneration = generation;
            movingUntil = Util.getMillis() + MOVING_MS;
        }
        passStart = System.nanoTime();
    }

    @SubscribeEvent(priority = EventPriority.LOWEST)
    static void afterRails(RenderLevelStageEvent event) {
        if (!measuring || event.getStage() != RenderLevelStageEvent.Stage.AFTER_BLOCK_ENTITIES) {
            return;
        }
        long pass = System.nanoTime() - passStart;
        if (syncFrame) {
            syncPass.add(pass);
        } else {
            (Util.getMillis() < movingUntil ? movingPass : idlePass).add(pass);
        }
    }

    /** n, mean, median and max of nanosecond samples, in ms. */
    private static String stats(List<Long> samples) {
        if (samples.isEmpty()) {
            return "n=0";
        }
        List<Long> sorted = new ArrayList<>(samples);
        Collections.sort(sorted);
        double sum = 0.0;
        for (long sample : sorted) {
            sum += sample;
        }
        return String.format(Locale.ROOT, "n=%d mean %.3f ms, median %.3f ms, max %.3f ms", sorted.size(),
                sum / sorted.size() / 1.0e6, sorted.get(sorted.size() / 2) / 1.0e6,
                sorted.get(sorted.size() - 1) / 1.0e6);
    }

    // --- railedge ---

    /** The deck's styles, the camera's offset from their centre lines (on the deck, near its edge). */
    private static final String[] DECKS = {"mvp:crossbridge", "mvp:rail_bridge"};
    private static final double[] DECK_CAMERA = {2.6, 2.3};
    /** Tracks apart, blocks: each in regions of its own. */
    private static final int DECK_SPACING = 200;

    private static void edge(Minecraft mc) {
        if (ticks == 100) {
            origin = BlockPos.containing(mc.player.position().add(4000.0, 0.0, 0.0));
            return;
        }
        if (ticks == 120) {
            onServer(mc, (level, player) -> {
                for (int i = 0; i < DECKS.length; i++) {
                    straight(level, player, DECKS[i], origin.getX() + 0.5 + DECK_SPACING * i, origin.getY(),
                            origin.getZ() + 0.5);
                }
            });
            return;
        }
        if (ticks == 140) {
            command(mc, "gamemode spectator");
            mc.options.hideGui = true;
        }
        // per deck: standing over it near its edge, looking away from the track and down, then back at it
        for (int i = 0; i < DECKS.length; i++) {
            int at = 160 + i * 120;
            double x = origin.getX() + 0.5 + DECK_SPACING * i + DECK_CAMERA[i];
            double y = origin.getY() + 1.5;
            double z = origin.getZ() + 0.5;
            String name = "rwat-railedge-" + DECKS[i].substring(DECKS[i].indexOf(':') + 1);
            if (ticks == at) {
                camera(mc, x, y, z, -90.0F, 50.0F); // facing +X, away from the centre line
            } else if (ticks == at + 40 && !holdForTerrain(mc)) {
                logFrustum(mc, DECKS[i], x - DECK_CAMERA[i]);
                shot(mc, name + ".png");
            } else if (ticks == at + 50) {
                camera(mc, x, y, z, 90.0F, 50.0F); // facing −X, at the track
            } else if (ticks == at + 90 && !holdForTerrain(mc)) {
                shot(mc, name + "-ref.png");
            }
        }
        if (ticks == 160 + DECKS.length * 120) {
            mc.stop();
        }
    }

    /**
     * Whether the frame's frustum takes the track's centre line ± 2 blocks
     * (the old cull box around the tile centres) and its deck's far side.
     */
    private static void logFrustum(Minecraft mc, String style, double centreX) {
        if (frustum == null) {
            return;
        }
        double y = origin.getY();
        double z = origin.getZ() + 0.5;
        boolean centreBox = frustum.isVisible(new AABB(centreX - 2.0, y - 2.0, z - 48.0, centreX + 2.0, y + 2.0,
                z + 48.0));
        boolean deck = frustum.isVisible(new AABB(centreX + 2.0, y, z - 1.0, centreX + 4.0, y + 0.4, z + 1.0));
        RailsWheelsAndTrains.LOGGER.info("{} edge {}: centre line ± 2 in view {}, the deck beyond it in view {}",
                TAG, style, centreBox, deck);
    }

    /** A straight track along Z through {@code (x, y, z)}, 96 blocks, in two segments. */
    private static void straight(ServerLevel level, ServerPlayer player, String style, double x, double y,
            double z) {
        RailNetwork network = RailNetwork.get(level);
        Vector3d along = new Vector3d(0, 0, 1);
        RailSegment.Look look = new RailSegment.Look(style, null);
        for (RailNetwork.SegmentSpec spec : List.of(
                new RailNetwork.SegmentSpec(new Vector3d(x, y, z - 48.0), along, new Vector3d(x, y, z), along),
                new RailNetwork.SegmentSpec(new Vector3d(x, y, z), along, new Vector3d(x, y, z + 48.0), along))) {
            if (network.build(level, player, List.of(spec), look, List.of()) == null) {
                RailsWheelsAndTrains.LOGGER.warn("{} a {} segment was refused", TAG, style);
            }
        }
    }

    // --- railfar ---

    private static final int FAR = 300_000;

    /** Shots of the close-up, the camera {@link #FAR_STEP} further along X and Z each. */
    private static final int FAR_SHOTS = 8;
    private static final double FAR_STEP = 0.008;

    private static void far(Minecraft mc) {
        if (ticks == 100) {
            origin = new BlockPos(FAR, mc.player.blockPosition().getY(), FAR);
            camera(mc, FAR + 6.5, origin.getY() + 2.0, FAR - 6.0, 0.0F, 45.0F);
            return;
        }
        if (ticks == 200) {
            onServer(mc, (level, player) -> {
                RailNetwork network = RailNetwork.get(level);
                RailSegment.Look look = new RailSegment.Look("mvp:rail", null);
                double y = origin.getY();
                double x0 = FAR + 0.5;
                double z0 = FAR + 0.5;
                Vector3d x = new Vector3d(1, 0, 0);
                Vector3d z = new Vector3d(0, 0, 1);
                for (RailNetwork.SegmentSpec spec : List.of(
                        new RailNetwork.SegmentSpec(new Vector3d(x0, y, z0), x, new Vector3d(x0 + 24, y, z0), x),
                        new RailNetwork.SegmentSpec(new Vector3d(x0, y, z0 + 6), x,
                                new Vector3d(x0 + 16, y, z0 + 22), z))) {
                    if (network.build(level, player, List.of(spec), look, List.of()) == null) {
                        RailsWheelsAndTrains.LOGGER.warn("{} a far segment was refused", TAG);
                    }
                }
            });
            return;
        }
        if (ticks == 220) {
            command(mc, "gamemode spectator");
            mc.options.hideGui = true;
        }
        // a hand's breadth over the curve's middle, looking along it; then a little further each shot
        for (int n = 0; n < FAR_SHOTS; n++) {
            int at = 300 + n * 20;
            if (ticks == at) {
                double step = n * FAR_STEP;
                camera(mc, FAR + 11.8 + step, origin.getY() + 1.0, FAR + 11.2 + step, -45.0F, 60.0F);
            }
            if (ticks == at + 15 && !holdForTerrain(mc)) {
                shot(mc, "rwat-railfar-" + n + ".png");
            }
        }
        int wide = 300 + FAR_SHOTS * 20;
        if (ticks == wide) {
            camera(mc, FAR + 4.0, origin.getY() + 4.0, FAR - 3.0, 20.0F, 40.0F);
        }
        if (ticks == wide + 30 && !holdForTerrain(mc)) {
            shot(mc, "rwat-railfar-wide.png");
        }
        if (ticks == wide + 50) {
            mc.stop();
        }
    }

    // --- helpers ---

    /** Ticks a shot has waited for the terrain. */
    private static int waited;

    /**
     * Hold the scene's clock (this tick runs again) while vanilla still has
     * terrain sections to compile, up to 30 s: on a busy machine the rails,
     * which need only the chunk's data, are drawn before the ground under
     * them, and the shot would show them over the sky.
     */
    private static boolean holdForTerrain(Minecraft mc) {
        if (!mc.levelRenderer.hasRenderedAllSections() && waited++ < 600) {
            ticks--;
            return true;
        }
        waited = 0;
        return false;
    }

    private static void camera(Minecraft mc, double x, double y, double z, float yaw, float pitch) {
        command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f %.1f %.1f", x, y, z, yaw, pitch));
    }

    private static void setblock(Minecraft mc, BlockPos pos, String block) {
        if (pos != null) {
            command(mc, String.format(Locale.ROOT, "setblock %d %d %d %s", pos.getX(), pos.getY(), pos.getZ(),
                    block));
        }
    }

    private static void onServer(Minecraft mc, BiConsumer<ServerLevel, ServerPlayer> action) {
        var server = mc.getSingleplayerServer();
        if (server == null) {
            return;
        }
        java.util.UUID id = mc.player.getUUID();
        server.execute(() -> {
            ServerPlayer player = server.getPlayerList().getPlayer(id);
            if (player != null) {
                action.accept(player.serverLevel(), player);
            }
        });
    }

    private static void command(Minecraft mc, String command) {
        RailsWheelsAndTrains.LOGGER.info("{} /{}", TAG, command);
        onServer(mc, (level, player) -> level.getServer().getCommands().performPrefixedCommand(
                player.createCommandSourceStack().withPermission(4), command));
    }

    private static void shot(Minecraft mc, String name) {
        Screenshot.grab(mc.gameDirectory, name, mc.getMainRenderTarget(),
                message -> RailsWheelsAndTrains.LOGGER.info("{} {}", TAG, message.getString()));
    }
}
