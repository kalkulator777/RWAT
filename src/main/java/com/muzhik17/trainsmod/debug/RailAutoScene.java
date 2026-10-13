package com.muzhik17.trainsmod.debug;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.function.BiConsumer;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.ServerConfig;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.ConsistManager;
import com.muzhik17.trainsmod.network.TrackPathSpec;
import com.muzhik17.trainsmod.path.BedRaster;
import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.RailSegment;
import com.muzhik17.trainsmod.path.RoutePath;
import com.muzhik17.trainsmod.path.TrackPath;
import com.muzhik17.trainsmod.path.TrackSweep;
import com.muzhik17.trainsmod.rail.RailFootprints;
import com.muzhik17.trainsmod.rail.RailMarkerBlock;
import com.muzhik17.trainsmod.rail.RailNetwork;
import com.muzhik17.trainsmod.rail.TrackBedBlock;

import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.UseOnContext;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.event.level.BlockEvent;

/**
 * Dev tool: scripted rail scenes (SPEC §2.2), like {@link ClientAutoScene} —
 * {@code ./gradlew runClient -PquickPlay=<flat world copy> -Pautoscene=bedcut|trailing}.
 * Off unless the system property {@code rwat.autoscene} names one of them;
 * use a throwaway copy of a save. Logs {@code [railscene]} lines, shots go to
 * {@code screenshots/rwat-rail-*.png}, quits at the end.
 *
 * <p>{@code bedcut}: the bed clears its way — rails clicked through a stone
 * hill, a water patch and grass, up a slope through a dirt hill (the rail
 * heads reach above the bed), a switch through foliage; then refused at a
 * chest, at bedrock and at a block a break-event handler protects, and built
 * once the protection is off. Every built segment is checked against its
 * raster: bed under every piece of the model, headroom clear — and, in a
 * world whose server config has {@code clear_gauge} on, the loading gauge
 * clear too ({@code rwat-rail-portal*.png} look along the track into the
 * hills: a slot for the bed with the option off, the gauge with it on).
 *
 * <p>{@code trailing}: a loop with a passing siding, its entry switch set
 * for the siding and its exit switch for the main line; a train runs three
 * laps, coming off the siding against the exit switch each time. Logs every
 * segment the head enters and any stop; the switches must stay as set.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class RailAutoScene {

    private static final String PROPERTY = "rwat.autoscene";
    private static int ticks;
    /** The scene's corner: 4000 blocks off the spawn, at ground level (the first air cell). */
    private static BlockPos origin;
    /** Segment ids that existed before the latest click. */
    private static Set<Integer> before = Set.of();
    /** While set, break events inside it are cancelled — a stand-in for region protection. */
    private static volatile BlockPos protectedBlock;

    private RailAutoScene() {
    }

    @SubscribeEvent
    static void onBreak(BlockEvent.BreakEvent event) {
        if (event.getPos().equals(protectedBlock)) {
            event.setCanceled(true);
        }
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        String scene = System.getProperty(PROPERTY);
        Minecraft mc = Minecraft.getInstance();
        if (scene == null || mc.player == null || mc.level == null) {
            return;
        }
        if (scene.equals("bedcut")) {
            ticks++;
            bedcut(mc);
        } else if (scene.equals("trailing")) {
            ticks++;
            trailing(mc);
        }
    }

    // --- bedcut ---

    private static void bedcut(Minecraft mc) {
        if (ticks < 100) {
            return;
        }
        int x = origin == null ? 0 : origin.getX();
        int y = origin == null ? 0 : origin.getY();
        int z = origin == null ? 0 : origin.getZ();
        switch (ticks) {
            case 100 -> {
                origin = BlockPos.containing(mc.player.position().add(4000.0, 0.0, 0.0));
                command(mc, "gamemode creative");
                command(mc, "gamerule doDaylightCycle false");
                command(mc, "time set noon");
                command(mc, "weather clear");
                flyTo(mc, origin.getX() + 20.5, origin.getY() + 30.0, origin.getZ() - 20.0, 0.0F, 50.0F);
            }
            case 130 -> {
                // track 1 (z): a stone hill, a water patch, grass, foliage
                command(mc, at("fill %d %d %d %d %d %d stone", x + 8, y, z - 5, x + 18, y + 8, z + 5));
                // water in a glass basin (loose, it would wash the marker away)
                command(mc, at("fill %d %d %d %d %d %d glass", x + 2, y, z - 2, x + 6, y, z + 2));
                command(mc, at("fill %d %d %d %d %d %d water", x + 3, y, z - 1, x + 5, y, z + 1));
                command(mc, at("fill %d %d %d %d %d %d oak_leaves[persistent=true]", x + 24, y, z - 3, x + 29, y + 3, z + 3));
                command(mc, at("fill %d %d %d %d %d %d short_grass", x + 32, y, z - 1, x + 35, y, z + 1));
                // track 2 (z + 15): a dirt hill the track climbs into
                command(mc, at("fill %d %d %d %d %d %d dirt", x + 4, y, z + 10, x + 30, y + 6, z + 20));
                // track 3 (z + 30): a switch through foliage
                command(mc, at("fill %d %d %d %d %d %d oak_leaves[persistent=true]", x + 6, y, z + 26, x + 14, y + 3, z + 40));
            }
            case 140 -> {
                marker(mc, x, y, z, false);
                marker(mc, x + 40, y, z, false);
            }
            case 145 -> click(mc, x, y, z);
            case 150 -> verify(mc, "hill, water, foliage, grass");
            case 155 -> {
                marker(mc, x, y, z + 15, false);
                marker(mc, x + 26, y + 3, z + 15, false);
            }
            case 160 -> click(mc, x, y, z + 15);
            case 165 -> verify(mc, "slope into a hill");
            case 170 -> {
                marker(mc, x, y, z + 30, true);
                marker(mc, x + 24, y, z + 30, false);
                marker(mc, x + 24, y, z + 38, false);
            }
            case 175 -> click(mc, x, y, z + 30);
            case 180 -> verify(mc, "switch through foliage");
            // the portals, looked at along the track: a slot for the bed, or the gauge cleared
            case 182 -> {
                mc.options.hideGui = true;
                flyTo(mc, x - 1.5, y + 4.0, z + 0.5, -90.0F, 8.0F);
            }
            case 200 -> shot(mc, "rwat-rail-portal.png");
            case 202 -> flyTo(mc, x - 3.5, y + 3.5, z + 15.5, -90.0F, 6.0F);
            case 220 -> shot(mc, "rwat-rail-portal-slope.png");
            // cut the hills open to look at the bed inside
            case 225 -> {
                command(mc, at("fill %d %d %d %d %d %d air", x + 8, y, z - 5, x + 18, y + 8, z - 3));
                command(mc, at("fill %d %d %d %d %d %d air", x + 4, y, z + 10, x + 30, y + 6, z + 13));
            }
            case 230 -> {
                mc.options.hideGui = true;
                flyTo(mc, x + 13.5, y + 4.5, z - 9.0, 0.0F, 15.0F);
            }
            case 255 -> shot(mc, "rwat-rail-hill.png");
            case 260 -> flyTo(mc, x + 17.5, y + 4.5, z + 6.0, 0.0F, 22.0F);
            case 285 -> shot(mc, "rwat-rail-slope.png");
            case 290 -> flyTo(mc, x + 20.0, y + 28.0, z + 14.0, 0.0F, 80.0F);
            case 315 -> shot(mc, "rwat-rail-overview.png");
            // a chest in the way: refused, nothing changes
            case 320 -> {
                marker(mc, x, y, z + 48, false);
                marker(mc, x + 20, y, z + 48, false);
                command(mc, at("setblock %d %d %d chest", x + 10, y, z + 48));
            }
            case 325 -> click(mc, x, y, z + 48);
            case 330 -> refused(mc, "chest", x, y, z + 48, x + 20, y, z + 48);
            case 331 -> {
                mc.options.hideGui = false;
                flyTo(mc, x + 10.5, y + 3.0, z + 43.0, 0.0F, 25.0F);
            }
            case 332 -> click(mc, x, y, z + 48); // again, for the shot: message and red dust
            case 340 -> shot(mc, "rwat-rail-chest.png");
            case 345 -> command(mc, at("setblock %d %d %d bedrock", x + 10, y, z + 48));
            case 350 -> click(mc, x, y, z + 48);
            case 355 -> refused(mc, "bedrock", x, y, z + 48, x + 20, y, z + 48);
            case 360 -> {
                command(mc, at("setblock %d %d %d stone", x + 10, y, z + 48));
                protectedBlock = new BlockPos(x + 10, y, z + 48);
            }
            case 365 -> click(mc, x, y, z + 48);
            case 370 -> refused(mc, "protected stone", x, y, z + 48, x + 20, y, z + 48);
            case 375 -> protectedBlock = null;
            case 380 -> click(mc, x, y, z + 48);
            case 385 -> verify(mc, "stone, protection off");
            case 400 -> mc.stop();
            default -> {
            }
        }
    }

    private static String at(String format, Object... args) {
        return String.format(Locale.ROOT, format, args);
    }

    /** A rail marker (or switch marker) looking along +X. */
    private static void marker(Minecraft mc, int x, int y, int z, boolean switchMarker) {
        command(mc, at("setblock %d %d %d railswheelsandtrains:%s[rotation=6]", x, y, z,
                switchMarker ? "rail_switch_marker" : "rail_marker"));
    }

    /** Click the marker at x, y, z with rails, the way a player's right-click reaches {@code RailItem.useOn}. */
    private static void click(Minecraft mc, int x, int y, int z) {
        BlockPos pos = new BlockPos(x, y, z);
        onServer(mc, (level, player) -> {
            before = new HashSet<>(segmentIds(level));
            ItemStack rails = new ItemStack(RailsWheelsAndTrains.RAIL_ITEM.get());
            player.setItemInHand(InteractionHand.MAIN_HAND, rails);
            var result = rails.useOn(new UseOnContext(player, InteractionHand.MAIN_HAND,
                    new BlockHitResult(Vec3.atCenterOf(pos), Direction.UP, pos, false)));
            RailsWheelsAndTrains.LOGGER.info("[railscene] click {} {} {}: {}", x, y, z, result);
        });
    }

    private static Set<Integer> segmentIds(ServerLevel level) {
        Set<Integer> ids = new HashSet<>();
        for (RailSegment segment : RailNetwork.get(level).graph().segments()) {
            ids.add(segment.id());
        }
        return ids;
    }

    /**
     * The segments the last click built against their rasters: a bed block
     * in every bed cell, the headroom free of anything but air, fluid and bed.
     */
    private static void verify(Minecraft mc, String what) {
        onServer(mc, (level, player) -> {
            RailGraph graph = RailNetwork.get(level).graph();
            List<RailSegment> built = new ArrayList<>();
            for (RailSegment segment : graph.segments()) {
                if (!before.contains(segment.id())) {
                    built.add(segment);
                }
            }
            int bed = 0;
            int laid = 0;
            int headroom = 0;
            int clear = 0;
            List<String> problems = new ArrayList<>();
            for (RailSegment segment : built) {
                BedRaster.Raster raster = BedRaster.raster(TrackSweep.path(graph, segment),
                        RailFootprints.forStyle(segment.style()), null);
                for (BedRaster.Cell cell : raster.bed().keySet()) {
                    bed++;
                    BlockState state = level.getBlockState(new BlockPos(cell.x(), cell.y(), cell.z()));
                    if (state.getBlock() instanceof TrackBedBlock) {
                        laid++;
                    } else if (problems.size() < 8) {
                        problems.add("no bed at " + cell + ": " + state);
                    }
                }
                for (BedRaster.Cell cell : raster.headroom()) {
                    headroom++;
                    BlockState state = level.getBlockState(new BlockPos(cell.x(), cell.y(), cell.z()));
                    if (state.isAir() || !state.getFluidState().isEmpty() || state.getBlock() instanceof TrackBedBlock) {
                        clear++;
                    } else if (problems.size() < 8) {
                        problems.add("headroom blocked at " + cell + ": " + state);
                    }
                }
            }
            String gaugeReport = "";
            ServerConfig.Gauge clearance = ServerConfig.clearedGauge();
            if (clearance != null) {
                int gauge = 0;
                int open = 0;
                for (RailSegment segment : built) {
                    double top = RailFootprints.forStyle(segment.style()).top() + clearance.height();
                    for (BedRaster.Cell cell : BedRaster.gauge(TrackSweep.path(graph, segment),
                            clearance.halfWidth(), RailNetwork.GAUGE_FLOOR, top)) {
                        BlockState state = level.getBlockState(new BlockPos(cell.x(), cell.y(), cell.z()));
                        gauge++;
                        if (state.isAir() || !state.getFluidState().isEmpty() || state.getBlock() instanceof TrackBedBlock) {
                            open++;
                        } else if (problems.size() < 8) {
                            problems.add("gauge blocked at " + cell + ": " + state);
                        }
                    }
                }
                gaugeReport = String.format(Locale.ROOT, ", gauge %d/%d clear", open, gauge);
            }
            RailsWheelsAndTrains.LOGGER.info("[railscene] {}: {} segment(s) built, bed {}/{} laid, headroom {}/{} clear{}{}",
                    what, built.size(), laid, bed, clear, headroom, gaugeReport, problems.isEmpty() ? "" : " " + problems);
        });
    }

    /** A refused build: both markers still there, nothing built. */
    private static void refused(Minecraft mc, String what, int ax, int ay, int az, int bx, int by, int bz) {
        onServer(mc, (level, player) -> {
            boolean markers = level.getBlockState(new BlockPos(ax, ay, az)).getBlock() instanceof RailMarkerBlock
                    && level.getBlockState(new BlockPos(bx, by, bz)).getBlock() instanceof RailMarkerBlock;
            int built = segmentIds(level).size() - before.size();
            RailsWheelsAndTrains.LOGGER.info("[railscene] {}: {} (markers kept: {}, segments built: {})",
                    what, markers && built == 0 ? "refused, nothing changed" : "NOT REFUSED", markers, built);
        });
    }

    // --- trailing ---

    /** Laps the train runs; the route's length is about 330 blocks. */
    private static final int TRAILING_TICKS = 1800;
    private static final double TRAILING_SPEED = 0.6;
    private static int consistId = -1;
    private static int lastHeadSegment = -1;
    private static double lastS = Double.NaN;
    private static int stops;
    private static int stuck;
    /** The siding's segment into D, and how often the head has come off it. */
    private static int sidingExit = -1;
    private static volatile int offSiding;
    private static int shotAt = -1;
    private static int switchA = -1;
    private static int switchD = -1;
    private static final List<Integer> headSegments = new ArrayList<>();

    private static void trailing(Minecraft mc) {
        if (ticks < 100) {
            return;
        }
        if (ticks == 100) {
            origin = BlockPos.containing(mc.player.position().add(4000.0, 0.0, 0.0));
            command(mc, "gamemode creative");
            command(mc, "gamerule doDaylightCycle false");
            command(mc, "time set noon");
            command(mc, "weather clear");
            flyTo(mc, origin.getX() + 40.5, origin.getY() + 45.0, origin.getZ() + 20.0, 0.0F, 89.0F);
        } else if (ticks == 130) {
            buildOval(mc);
        } else if (ticks == 140) {
            flyTo(mc, origin.getX() + 8.5, origin.getY() + 2.0, origin.getZ() + 3.5, 0.0F, 0.0F);
        } else if (ticks == 150) {
            command(mc, "rwat spawn");
        } else if (ticks == 160) {
            onServer(mc, (level, player) -> {
                for (Consist consist : ConsistManager.get(level).all()) {
                    consistId = consist.id();
                }
                RailsWheelsAndTrains.LOGGER.info("[railscene] trailing: consist #{} spawned", consistId);
            });
            mc.options.hideGui = true;
        } else if (ticks == 165) {
            command(mc, "rwat handbrake " + consistId + " false");
        } else if (ticks > 170 && ticks < 170 + TRAILING_TICKS) {
            onServer(mc, RailAutoScene::drive);
            if (ticks == 200) {
                flyTo(mc, origin.getX() + 50.5, origin.getY() + 16.0, origin.getZ() + 14.0, 160.0F, 45.0F);
            }
            // the second time the head comes off the siding through D, the train straddles D a moment later
            if (offSiding == 2 && shotAt < 0) {
                shotAt = ticks + 20;
            }
            if (ticks == shotAt) {
                shot(mc, "rwat-rail-trailing.png");
            }
        } else if (ticks == 170 + TRAILING_TICKS) {
            onServer(mc, (level, player) -> {
                RailGraph graph = RailNetwork.get(level).graph();
                RailsWheelsAndTrains.LOGGER.info(
                        "[railscene] trailing: done — {} stop(s); head ran over {}; switch A at {}, D at {} (set 1 and 0)",
                        stops, headSegments, graph.switchSelection(switchA), graph.switchSelection(switchD));
            });
        } else if (ticks == 190 + TRAILING_TICKS) {
            mc.stop();
        }
    }

    /**
     * The loop: a straight bottom P0 → A → D → P1 along +X with a passing
     * siding A → Q → D beside it, closed by three chord-tangent sweeps back to
     * P0 (one build per segment). A is set for the siding, D for the main.
     */
    private static void buildOval(Minecraft mc) {
        onServer(mc, (level, player) -> {
            RailNetwork network = RailNetwork.get(level);
            Vector3d x = new Vector3d(1, 0, 0);
            double y = origin.getY();
            double ox = origin.getX() + 0.5;
            double oz = origin.getZ() + 0.5;
            Vector3d p0 = new Vector3d(ox, y, oz);
            Vector3d a = new Vector3d(ox + 24, y, oz);
            Vector3d q = new Vector3d(ox + 40, y, oz - 6);
            Vector3d d = new Vector3d(ox + 56, y, oz);
            Vector3d p1 = new Vector3d(ox + 80, y, oz);
            Vector3d c1 = new Vector3d(ox + 80, y, oz + 40);
            Vector3d c2 = new Vector3d(ox, y, oz + 40);
            List<RailNetwork.SegmentSpec> specs = List.of(
                    new RailNetwork.SegmentSpec(p0, x, a, x),
                    new RailNetwork.SegmentSpec(a, x, d, x),      // main
                    new RailNetwork.SegmentSpec(a, x, q, x),      // siding
                    new RailNetwork.SegmentSpec(q, x, d, x),
                    new RailNetwork.SegmentSpec(d, x, p1, x),
                    chord(p1, c1), chord(c1, c2), chord(c2, p0));
            for (RailNetwork.SegmentSpec spec : specs) {
                if (network.build(level, player, List.of(spec), RailSegment.Look.DEFAULT, List.of()) == null) {
                    RailsWheelsAndTrains.LOGGER.warn("[railscene] trailing: a segment of the loop was refused");
                }
            }
            RailGraph graph = network.graph();
            switchA = graph.nodeNear(a).id();
            switchD = graph.nodeNear(d).id();
            sidingExit = graph.segmentNear(new Vector3d(ox + 48, y, oz - 3), 3.0).id();
            graph.setSwitchSelection(switchA, 1); // into the siding
            graph.setSwitchSelection(switchD, 0); // set for the main line
            RailsWheelsAndTrains.LOGGER.info("[railscene] trailing: loop of {} segments, A (node {}) → siding, D (node {}) → main",
                    graph.segments().size(), switchA, switchD);
        });
    }

    private static RailNetwork.SegmentSpec chord(Vector3d from, Vector3d to) {
        Vector3d chord = new Vector3d(to).sub(from);
        return new RailNetwork.SegmentSpec(from, chord, to, chord);
    }

    /** Keep the train at speed and log where its head goes and whether it stops. */
    private static void drive(ServerLevel level, ServerPlayer player) {
        Consist consist = ConsistManager.get(level).byId(consistId);
        if (consist == null) {
            return;
        }
        RailNetwork network = RailNetwork.get(level);
        TrackPath path = consist.resolvePath(network.graph(), network.revision());
        if (!(path instanceof RoutePath route) || !(consist.pathSpec() instanceof TrackPathSpec.Route spec)) {
            return;
        }
        double s = consist.s();
        // checks run between server ticks, not once per tick: a stop is s standing three times running
        stuck = !Double.isNaN(lastS) && Math.abs(s - lastS) < 1.0e-6 ? stuck + 1 : 0;
        if (stuck == 3) {
            stops++;
            RailsWheelsAndTrains.LOGGER.warn("[railscene] trailing: STOPPED at s {} of {} (head on #{})",
                    s, route.length(), lastHeadSegment);
        }
        lastS = s;
        int head = spec.legs().get(route.partIndexAt(s)).segmentId();
        if (head != lastHeadSegment) {
            if (lastHeadSegment == sidingExit) {
                offSiding++;
            }
            lastHeadSegment = head;
            headSegments.add(head);
            RailsWheelsAndTrains.LOGGER.info("[railscene] trailing: head onto #{} (route {} legs, {})",
                    head, spec.legs().size(), route.loop() ? "loop" : "open");
        }
        consist.setSpeed(TRAILING_SPEED);
    }

    // --- helpers ---

    private static void flyTo(Minecraft mc, double x, double y, double z, float yaw, float pitch) {
        mc.player.getAbilities().mayfly = true;
        mc.player.getAbilities().flying = true;
        mc.player.onUpdateAbilities();
        command(mc, at("tp @s %.3f %.3f %.3f %.1f %.1f", x, y, z, yaw, pitch));
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
        RailsWheelsAndTrains.LOGGER.info("[railscene] /{}", command);
        onServer(mc, (level, player) -> level.getServer().getCommands().performPrefixedCommand(
                player.createCommandSourceStack().withPermission(4), command));
    }

    private static void shot(Minecraft mc, String name) {
        Screenshot.grab(mc.gameDirectory, name, mc.getMainRenderTarget(),
                message -> RailsWheelsAndTrains.LOGGER.info("[railscene] {}", message.getString()));
    }
}
