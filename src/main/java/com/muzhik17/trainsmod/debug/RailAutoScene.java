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
import com.muzhik17.trainsmod.client.ClientRailGraph;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.ConsistManager;
import com.muzhik17.trainsmod.network.TrackPathSpec;
import com.muzhik17.trainsmod.path.BedRaster;
import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.RailNode;
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
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.piston.PistonBaseBlock;
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
 * {@code ./gradlew runClient -PquickPlay=<flat world copy> -Pautoscene=bedcut|trailing|railedit}.
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
 *
 * <p>{@code railedit}: what clicks with the rails cost and what they may
 * change — the cooldown, a held repaint, a held refused build, a forged
 * look, a piston at the bed, a switch thrown by redstone, chunks of far
 * markers and stands ({@link #railedit}).
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
    /** How often the world was asked about {@link #protectedBlock}: once per refused build. */
    private static volatile int protectedAsked;

    private RailAutoScene() {
    }

    @SubscribeEvent
    static void onBreak(BlockEvent.BreakEvent event) {
        if (event.getPos().equals(protectedBlock)) {
            event.setCanceled(true);
            protectedAsked++;
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
        } else if (scene.equals("railedit")) {
            ticks++;
            railedit(mc);
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

    // --- railedit ---

    /** The graph object the client held last tick, and how many new ones (full syncs) it has received. */
    private static RailGraph seenGraph;
    private static int graphsReceived;
    /** Where a measured phase started: graphs received, the client's generation and graph, the server's revision. */
    private static int phaseGraphs;
    private static int phaseGeneration;
    private static RailGraph phaseGraph;
    private static volatile int phaseRevision;
    /** The lone marker far out of every click's range, and the switch stand. */
    private static BlockPos farMarker;
    private static BlockPos stand;
    private static final RailSegment.Look STONE = new RailSegment.Look(RailSegment.DEFAULT_STYLE, "stone");

    /**
     * {@code railedit}: the rails used through the server's own item-use path
     * ({@code ServerPlayerGameMode.useItemOn}, where the item cooldown
     * holds), and what a click costs. A track built, then a second build
     * clicked inside the cooldown and after it; Shift+use held on the
     * track's bed for 4 seconds, a use every 4 ticks as a held key repeats —
     * one repaint, one graph sent, the rest nothing; a build refused by a
     * protected block held as long — how often the world is asked; a build
     * with a style and a bed material no picker sends — the defaults laid; a
     * piston against the bed — it doesn't move; a lone marker far out of
     * range in an unloaded chunk — clicks don't load it. Then a Y-switch is
     * thrown by redstone: the revision moves on, the client keeps its graph
     * (no full sync) and sets the switch as the server has it — shots of the
     * blades before and after ({@code rwat-rail-switch-0/1.png}). Last the
     * player flies 3000 blocks off: the switch stand's chunk must unload.
     */
    private static void railedit(Minecraft mc) {
        RailGraph graph = ClientRailGraph.graph();
        if (graph != seenGraph) {
            seenGraph = graph;
            graphsReceived++;
        }
        if (ticks < 100) {
            return;
        }
        int x = origin == null ? 0 : origin.getX();
        int y = origin == null ? 0 : origin.getY();
        int z = origin == null ? 0 : origin.getZ();
        // Shift+use held on track A's bed: a use every 4 ticks, 21 in all
        if (ticks >= 190 && ticks <= 270 && (ticks - 190) % 4 == 0) {
            if (ticks == 190) {
                startPhase(mc);
            }
            onServer(mc, (level, player) -> {
                BlockPos bed = bedUnder(level, x + 15, y, z);
                if (bed == null) {
                    RailsWheelsAndTrains.LOGGER.warn("[railscene] railedit: no bed under A at x {}", x + 15);
                    return;
                }
                useStack(level, player, "repaint A in stone", bed, rails(STONE.style(), STONE.bed()), true);
            });
            return;
        }
        // a build refused by a protected block, held as long
        if (ticks >= 290 && ticks <= 370 && (ticks - 290) % 4 == 0) {
            if (ticks == 290) {
                protectedAsked = 0;
                startPhase(mc);
            }
            use(mc, "refused build C", new BlockPos(x, y, z + 16), RailSegment.Look.DEFAULT, false);
            return;
        }
        switch (ticks) {
            case 100 -> {
                origin = BlockPos.containing(mc.player.position().add(4000.0, 0.0, 0.0));
                command(mc, "gamemode creative");
                command(mc, "gamerule doDaylightCycle false");
                command(mc, "time set noon");
                command(mc, "weather clear");
                command(mc, "difficulty peaceful");
                flyTo(mc, origin.getX() + 15.5, origin.getY() + 30.0, origin.getZ() + 20.0, 0.0F, 80.0F);
            }
            case 130 -> {
                marker(mc, x, y, z, false); // A: built, then repainted under a held key
                marker(mc, x + 30, y, z, false);
                // far out of every click's range (max_marker_distance 512), its chunk let go
                farMarker = new BlockPos(x + 700, y, z);
                command(mc, at("forceload add %d %d", farMarker.getX(), farMarker.getZ()));
                command(mc, at("setblock %d %d %d railswheelsandtrains:rail_marker[rotation=6]",
                        farMarker.getX(), farMarker.getY(), farMarker.getZ()));
                command(mc, at("forceload remove %d %d", farMarker.getX(), farMarker.getZ()));
            }
            case 135 -> use(mc, "build A", new BlockPos(x, y, z), RailSegment.Look.DEFAULT, false);
            case 137 -> {
                marker(mc, x, y, z + 8, false); // B: clicked inside the cooldown, then after it
                marker(mc, x + 30, y, z + 8, false);
            }
            case 141 -> use(mc, "build B inside the cooldown", new BlockPos(x, y, z + 8),
                    RailSegment.Look.DEFAULT, false);
            case 145 -> logSegments(mc, "after the click inside the cooldown (expect 1: A)");
            case 160 -> use(mc, "build B after the cooldown", new BlockPos(x, y, z + 8),
                    RailSegment.Look.DEFAULT, false);
            case 165 -> logSegments(mc, "after the click past the cooldown (expect 2: A, B)");
            case 280 -> endPhase(mc, "Shift+use held 4 s on A's bed, 21 uses, in stone (before the fix: 21 repaints, 21 graphs)");
            case 285 -> {
                marker(mc, x, y, z + 16, false);
                marker(mc, x + 20, y, z + 16, false);
                command(mc, at("setblock %d %d %d stone", x + 10, y, z + 16));
                protectedBlock = new BlockPos(x + 10, y, z + 16);
            }
            case 380 -> {
                endPhase(mc, "build C refused by a protected block, held 4 s, 21 uses");
                onServer(mc, (level, player) -> RailsWheelsAndTrains.LOGGER.info(
                        "[railscene] railedit: the protected block was asked {} time(s), once per refused build"
                                + " (before the fix: 21)", protectedAsked));
            }
            case 382 -> {
                protectedBlock = null;
                command(mc, at("fill %d %d %d %d %d %d air", x, y, z + 16, x + 20, y, z + 16)); // C's markers
                marker(mc, x, y, z + 24, false); // D: built with a look no picker sends
                marker(mc, x + 20, y, z + 24, false);
            }
            case 405 -> useForged(mc, x, y, z + 24);
            case 410 -> logLook(mc, x + 10, y, z + 24);
            case 415 -> piston(mc, x + 20, y, z);
            case 425 -> pistonResult(mc, x + 20, y, z);
            case 430 -> {
                marker(mc, x, y, z + 40, true); // the Y-switch: toe and stand at x, legs to x + 17
                marker(mc, x + 17, y, z + 40, false);
                marker(mc, x + 17, y, z + 44, false);
                stand = new BlockPos(x, y, z + 40);
            }
            case 435 -> use(mc, "build the Y-switch", stand, RailSegment.Look.DEFAULT, false);
            case 440 -> {
                mc.options.hideGui = true;
                flyTo(mc, x + 2.5, y + 5.0, z + 42.0, 0.0F, 90.0F);
            }
            case 460 -> {
                shot(mc, "rwat-rail-switch-0.png");
                startPhase(mc);
            }
            case 465 -> command(mc, at("setblock %d %d %d redstone_block", x, y - 2, z + 40));
            case 490 -> {
                shot(mc, "rwat-rail-switch-1.png");
                endPhase(mc, "switch thrown by redstone");
                switchState(mc);
            }
            case 500 -> {
                mc.options.hideGui = false;
                flyTo(mc, x + 3000.5, y + 30.0, z + 0.5, 0.0F, 30.0F);
            }
            case 700, 900 -> {
                int since = ticks - 500;
                onServer(mc, (level, player) -> RailsWheelsAndTrains.LOGGER.info(
                        "[railscene] railedit: {} ticks after flying off, the switch stand's chunk is {}loaded"
                                + " (track A's: {}loaded)", since,
                        level.hasChunk(stand.getX() >> 4, stand.getZ() >> 4) ? "" : "not ",
                        level.hasChunk(x >> 4, z >> 4) ? "" : "not "));
            }
            case 910 -> mc.stop();
            default -> {
            }
        }
    }

    /**
     * Use the rails on {@code pos} as the server's item-use path does
     * ({@code ServerPlayerGameMode.useItemOn}: the item cooldown is asked
     * there, not in {@code useOn}), held in the main hand, sneaking or not.
     */
    private static void use(Minecraft mc, String what, BlockPos pos, RailSegment.Look look, boolean sneak) {
        onServer(mc, (level, player) -> useStack(level, player, what, pos, rails(look.style(), look.bed()), sneak));
    }

    /** A rails stack whose components say {@code style} and {@code bed}, whatever they are. */
    private static ItemStack rails(String style, String bed) {
        ItemStack rails = new ItemStack(RailsWheelsAndTrains.RAIL_ITEM.get());
        rails.set(RailsWheelsAndTrains.RAIL_STYLE.get(), style);
        rails.set(RailsWheelsAndTrains.RAIL_BED.get(), bed);
        return rails;
    }

    /** The bed block in column x, z near the rails' height {@code y} (the bed sits under the rail foot), or null. */
    private static BlockPos bedUnder(ServerLevel level, int x, int y, int z) {
        for (int dy = 1; dy >= -2; dy--) {
            BlockPos pos = new BlockPos(x, y + dy, z);
            if (level.getBlockState(pos).getBlock() instanceof TrackBedBlock) {
                return pos;
            }
        }
        return null;
    }

    private static void useStack(ServerLevel level, ServerPlayer player, String what, BlockPos pos, ItemStack rails,
            boolean sneak) {
        player.setItemInHand(InteractionHand.MAIN_HAND, rails);
        player.setShiftKeyDown(sneak);
        int before = RailNetwork.get(level).revision();
        var result = player.gameMode.useItemOn(player, level, rails, InteractionHand.MAIN_HAND,
                new BlockHitResult(Vec3.atCenterOf(pos), Direction.UP, pos, false));
        player.setShiftKeyDown(false);
        RailsWheelsAndTrains.LOGGER.info("[railscene] railedit: {} at {} {} {}: {}, revision {} → {}{}", what,
                pos.getX(), pos.getY(), pos.getZ(), result, before, RailNetwork.get(level).revision(),
                player.getCooldowns().isOnCooldown(rails.getItem()) ? ", rails cooling down" : "");
    }

    /**
     * Build D with rails whose components say what no picker sends — a style
     * that is no resource location, a bed material that doesn't exist — and
     * look whether that clicks loaded the far marker's chunk.
     */
    private static void useForged(Minecraft mc, int x, int y, int z) {
        onServer(mc, (level, player) -> {
            ItemStack rails = rails("Not A Style!", "lava");
            boolean before = level.hasChunk(farMarker.getX() >> 4, farMarker.getZ() >> 4);
            useStack(level, player, "build D with a forged look", new BlockPos(x, y, z), rails, false);
            boolean after = level.hasChunk(farMarker.getX() >> 4, farMarker.getZ() >> 4);
            RailsWheelsAndTrains.LOGGER.info("[railscene] railedit: the far marker's chunk (700 blocks off) was {}loaded"
                    + " before the click and is {}loaded after it: {}", before ? "" : "not ", after ? "" : "not ",
                    !after ? "OK" : "LOADED BY THE CLICK");
        });
    }

    /** The look the segment through {@code x, y, z} was built with: the defaults for D. */
    private static void logLook(Minecraft mc, int x, int y, int z) {
        onServer(mc, (level, player) -> {
            RailSegment segment = RailNetwork.get(level).graph().segmentNear(new Vector3d(x + 0.5, y, z + 0.5), 2.0);
            if (segment == null) {
                RailsWheelsAndTrains.LOGGER.warn("[railscene] railedit: D was not built");
                return;
            }
            boolean defaults = segment.style().equals(RailSegment.DEFAULT_STYLE)
                    && segment.bed().equals(RailSegment.DEFAULT_BED);
            RailsWheelsAndTrains.LOGGER.info("[railscene] railedit: D #{} built in style '{}' on bed '{}': {}",
                    segment.id(), segment.style(), segment.bed(), defaults ? "the defaults, OK" : "NOT THE DEFAULTS");
        });
    }

    /** The bed cells of track A's column {@code x}, by z. */
    private static List<Integer> bedColumn(ServerLevel level, int x, int y, int z) {
        List<Integer> cells = new ArrayList<>();
        for (int dz = -4; dz <= 4; dz++) {
            if (level.getBlockState(new BlockPos(x, y, z + dz)).getBlock() instanceof TrackBedBlock) {
                cells.add(z + dz);
            }
        }
        return cells;
    }

    private static List<Integer> pistonColumn = List.of();
    /** The height of the bed the piston pushes at. */
    private static int pistonY;

    /** A piston beside track A's bed, pushing across it, and a redstone block to fire it. */
    private static void piston(Minecraft mc, int x, int y, int z) {
        onServer(mc, (level, player) -> {
            BlockPos bed = bedUnder(level, x, y, z);
            if (bed == null) {
                RailsWheelsAndTrains.LOGGER.warn("[railscene] railedit: no bed at x {}", x);
                return;
            }
            pistonY = bed.getY();
            pistonColumn = bedColumn(level, x, pistonY, z);
            int beside = pistonColumn.get(pistonColumn.size() - 1) + 1;
            level.setBlock(new BlockPos(x, pistonY, beside),
                    Blocks.PISTON.defaultBlockState().setValue(PistonBaseBlock.FACING, Direction.NORTH), Block.UPDATE_ALL);
            level.setBlock(new BlockPos(x, pistonY, beside + 1), Blocks.REDSTONE_BLOCK.defaultBlockState(),
                    Block.UPDATE_ALL);
            RailsWheelsAndTrains.LOGGER.info("[railscene] railedit: piston at z {}, y {} fired against the bed at z {}",
                    beside, pistonY, pistonColumn);
        });
    }

    private static void pistonResult(Minecraft mc, int x, int y, int z) {
        onServer(mc, (level, player) -> {
            List<Integer> now = bedColumn(level, x, pistonY, z);
            int beside = pistonColumn.isEmpty() ? z : pistonColumn.get(pistonColumn.size() - 1) + 1;
            BlockState piston = level.getBlockState(new BlockPos(x, pistonY, beside));
            boolean extended = piston.hasProperty(PistonBaseBlock.EXTENDED) && piston.getValue(PistonBaseBlock.EXTENDED);
            RailsWheelsAndTrains.LOGGER.info("[railscene] railedit: piston extended: {}, bed at z {} (was {}): {}",
                    extended, now, pistonColumn, !extended && now.equals(pistonColumn) ? "OK, not moved" : "MOVED");
        });
    }

    /** Remember where a measured phase starts: on the client now, on the server at its next task. */
    private static void startPhase(Minecraft mc) {
        phaseGraphs = graphsReceived;
        phaseGeneration = ClientRailGraph.generation();
        phaseGraph = ClientRailGraph.graph();
        onServer(mc, (level, player) -> phaseRevision = RailNetwork.get(level).revision());
    }

    /** What the phase cost: the server's revisions, the graphs the client received, its generation. */
    private static void endPhase(Minecraft mc, String what) {
        int graphs = graphsReceived - phaseGraphs;
        int changes = ClientRailGraph.generation() - phaseGeneration;
        boolean sameGraph = ClientRailGraph.graph() == phaseGraph;
        onServer(mc, (level, player) -> RailsWheelsAndTrains.LOGGER.info(
                "[railscene] railedit: {}: revision {} → {} (+{}), full graphs received by the client {}"
                        + " (same graph object: {}), client graph changes {}", what, phaseRevision,
                RailNetwork.get(level).revision(), RailNetwork.get(level).revision() - phaseRevision, graphs,
                sameGraph, changes));
    }

    /** The switch's setting on the server and in the client's copy. */
    private static void switchState(Minecraft mc) {
        Vector3d toe = new Vector3d(stand.getX() + 0.5, stand.getY(), stand.getZ() + 0.5);
        RailGraph client = ClientRailGraph.graph();
        RailNode clientNode = client == null ? null : client.nodeNear(toe);
        int clientSelection = clientNode == null ? -1 : client.switchSelection(clientNode.id());
        onServer(mc, (level, player) -> {
            RailGraph server = RailNetwork.get(level).graph();
            RailNode node = server.nodeNear(toe);
            int selection = node == null ? -1 : server.switchSelection(node.id());
            RailsWheelsAndTrains.LOGGER.info("[railscene] railedit: switch at the toe node #{}: server selection {},"
                    + " client selection {}: {}", node == null ? -1 : node.id(), selection, clientSelection,
                    selection == 1 && clientSelection == selection ? "OK" : "WRONG");
        });
    }

    /** The segments the server has, by id. */
    private static void logSegments(Minecraft mc, String when) {
        onServer(mc, (level, player) -> RailsWheelsAndTrains.LOGGER.info("[railscene] railedit: segments {}: {}",
                when, segmentIds(level)));
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
