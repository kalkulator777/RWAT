package com.muzhik17.trainsmod.debug;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.ConsistManager;
import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.RailNode;
import com.muzhik17.trainsmod.path.RailSegment;
import com.muzhik17.trainsmod.path.TrackPath;
import com.muzhik17.trainsmod.rail.RailNetwork;

import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.UseOnContext;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;

/**
 * Dev tool (SPEC §2.2 v1, §2.4a): {@code -Pautoscene=switch} on a throwaway
 * flat save copy — the switch blades' and frogs' visual regression check.
 * Builds switches the way a player does (markers + a rails click), one per
 * column, 24 blocks apart, 4000 blocks east of the player: a Y-switch with a
 * trunk, its legs 17 blocks to a parallel track 4 over, in the mod's
 * standard rail, {@code mvp:rail} and {@code mvp:rail_bridge}; a gentle Y,
 * 33 blocks long ({@code long:mvp:rail}); and an N-crossover whose diagonal
 * goes 4 over in 8 ({@code n:mvp:rail}, the sharpest frog). Other columns:
 * {@code switch:<column>,<column>…}, a column being a style id
 * ({@code standard} = the mod's) with an optional {@code long:}/{@code n:}.
 * Every switch is shot set straight and set diverging, from above
 * ({@code rwat-switch-<column>-top-0/1.png}), straight down onto the blade
 * tips ({@code -tip-}), low behind the toe ({@code -toe-}) and from aside
 * ({@code -view-}); its frog from above and low ({@code -frog-0},
 * {@code -froglow-0} — the frog doesn't move); and the throw in between
 * tick by tick from above the tips ({@code -throw-<n>.png}). The redstone
 * throws it as a player would: a block under the switch stand. Then a TGM23
 * runs from the trunk through the first {@code mvp:rail} Y (or the first
 * column) in either setting; the log tells which leg its head took
 * ({@code [switch] set … OK/WRONG}, {@code rwat-switch-train-0/1.png}) — the
 * route must follow the blades. Quits the game at the end. A 1920×1080
 * window (the shots' size) is {@code earlyWindowWidth/Height} in
 * {@code run/config/fml.toml}.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class SwitchScene {

    private static final String[] COLUMNS = {"standard", "mvp:rail", "mvp:rail_bridge", "long:mvp:rail",
            "n:mvp:rail"};
    /** Ticks for one column's shots. */
    private static final int PER_COLUMN = 400;
    /** Columns apart, blocks. */
    private static final int SPACING = 24;

    /**
     * One switch of the scene: a Y ({@code length} ahead to a track 4 over,
     * with a trunk) or an N-crossover ({@code crossover}: the diagonal
     * {@code length} long, no trunk); {@code frog} is roughly how far ahead
     * of the toe cell its frog lies — where the frog shots look.
     */
    private record Column(String name, String style, boolean crossover, int length, double frog) {

        static Column parse(String token) {
            String name = token.replace(':', '_');
            if (token.startsWith("long:")) {
                return new Column(name, styleOf(token.substring(5)), false, 33, 14.6);
            }
            if (token.startsWith("n:")) {
                return new Column(name, styleOf(token.substring(2)), true, 8, 4.4);
            }
            return new Column(name, styleOf(token), false, 17, 8.1);
        }

        private static String styleOf(String id) {
            return id.equals("standard") ? "" : id;
        }

        /** The switch stand: the cell the clicked switch marker stood in. */
        BlockPos stand(BlockPos toe) {
            return crossover ? toe : toe.offset(0, 0, 1);
        }
    }

    private static int ticks;
    private static List<Column> columns;
    /** The toe cell of column 0: the trunk's end marker of a Y, the switch marker of an N. */
    private static BlockPos base;
    /** The toe node's segments of the switch the train runs: straight leg, diverging leg. */
    private static int straightLeg = -1;
    private static int divergingLeg = -1;
    private static int trainId = -1;

    private SwitchScene() {
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        String scene = System.getProperty("rwat.autoscene");
        Minecraft mc = Minecraft.getInstance();
        if (scene == null || !(scene.equals("switch") || scene.startsWith("switch:"))
                || mc.player == null || mc.level == null) {
            return;
        }
        ticks++;
        if (ticks == 100) {
            columns = new ArrayList<>();
            for (String token : scene.startsWith("switch:") ? scene.substring("switch:".length()).split(",")
                    : COLUMNS) {
                columns.add(Column.parse(token));
            }
            Vec3 origin = mc.player.position().add(4000.0, 0.0, 0.0);
            base = BlockPos.containing(origin);
            command(mc, "gamemode creative");
            command(mc, String.format(Locale.ROOT, "tp @s %d %d %d 0 0", base.getX(), base.getY(), base.getZ()));
            command(mc, "gamerule doDaylightCycle false");
            command(mc, "time set noon");
            command(mc, "weather clear");
            command(mc, "difficulty peaceful"); // no slimes of the flat world in the shots
            return;
        }
        if (columns == null) {
            return;
        }
        // build one switch every 20 ticks
        int build = ticks - 160;
        if (build >= 0 && build < columns.size() * 20) {
            build(mc, build / 20, build % 20);
            return;
        }
        int built = 160 + columns.size() * 20;
        if (ticks == built + 20) {
            command(mc, "gamemode spectator");
            mc.options.hideGui = true;
        }
        int shot = ticks - (built + 40);
        if (shot < 0) {
            return;
        }
        if (shot < columns.size() * PER_COLUMN) {
            columnShots(mc, shot / PER_COLUMN, shot % PER_COLUMN);
            return;
        }
        train(mc, shot - columns.size() * PER_COLUMN);
    }

    /** Build column {@code i}, {@code t} ticks in. */
    private static void build(Minecraft mc, int i, int t) {
        Column column = columns.get(i);
        BlockPos toe = column(i);
        int length = column.length();
        if (column.crossover()) {
            // two switch markers looking along their parallel tracks, two plain ones beyond
            switch (t) {
                case 0 -> {
                    marker(mc, toe, true);
                    marker(mc, toe.offset(4, 0, length), true);
                    marker(mc, toe.offset(0, 0, length + 12), false);
                    marker(mc, toe.offset(4, 0, length + 20), false);
                }
                case 4 -> useRails(mc, toe, column.style());
                case 16 -> logGraph(mc, i);
                default -> {
                }
            }
            return;
        }
        // a trunk, then the Y onto its end
        switch (t) {
            case 0 -> {
                marker(mc, toe.offset(0, 0, -20), false);
                marker(mc, toe, false);
            }
            case 4 -> useRails(mc, toe.offset(0, 0, -20), column.style());
            case 8 -> {
                // one block past the trunk's end: the switch snaps onto its node
                marker(mc, toe.offset(0, 0, 1), true);
                marker(mc, toe.offset(0, 0, length), false);
                marker(mc, toe.offset(4, 0, length), false);
            }
            case 12 -> useRails(mc, toe.offset(0, 0, 1), column.style());
            case 16 -> logGraph(mc, i);
            default -> {
            }
        }
    }

    /** The shots of column {@code i}, {@code t} ticks in: set straight, the throw, set diverging. */
    private static void columnShots(Minecraft mc, int i, int t) {
        Column column = columns.get(i);
        String name = "rwat-switch-" + column.name();
        BlockPos toe = column(i);
        if (t < 210) {
            views(mc, column, toe, name + "-%s-0.png", t, true);
            return;
        }
        if (t >= 240 && t < 380) {
            views(mc, column, toe, name + "-%s-1.png", t - 240, false);
            return;
        }
        if (t > 220 && t < 236) {
            shot(mc, name + "-throw-" + (t - 220) + ".png"); // the throw, tick by tick
        }
        switch (t) {
            case 210 -> tip(mc, toe);
            case 220 -> throwSwitch(mc, column, toe, true);
            case 236 -> throwSwitch(mc, column, toe, false);
            // back to straight for the train run
            case 380 -> throwSwitch(mc, column, toe, true);
            case 386 -> throwSwitch(mc, column, toe, false);
            default -> {
            }
        }
    }

    /**
     * The views of a switch as it is set, {@code t} ticks in, 35 apart: the
     * four of the throat, and with {@code frog} the two of the frog.
     */
    private static void views(Minecraft mc, Column column, BlockPos toe, String name, int t, boolean frog) {
        String[] names = {"top", "tip", "toe", "view", "frog", "froglow"};
        int view = t / 35;
        if (view >= (frog ? 6 : 4)) {
            return;
        }
        if (t % 35 == 30) {
            shot(mc, String.format(Locale.ROOT, name, names[view]));
            return;
        }
        if (t % 35 != 0) {
            return;
        }
        switch (view) {
            case 0 -> top(mc, toe);
            case 1 -> tip(mc, toe);
            case 2 -> toeView(mc, toe);
            case 3 -> sideView(mc, toe);
            // the frog lies on the straight track's inner rail, +X of its axis
            case 4 -> camera(mc, toe.getX() + 1.3, toe.getY() + 1.8, toe.getZ() + column.frog(), 0.0F, 90.0F);
            default -> camera(mc, toe.getX() + 0.7, toe.getY() + 0.6, toe.getZ() + column.frog() - 2.4,
                    -10.0F, 15.0F);
        }
    }

    /**
     * The train run, {@code t} ticks after the style shots: a TGM23 on the
     * trunk runs through the switch set straight, then — after the switch
     * is thrown — set diverging.
     */
    private static void train(Minecraft mc, int t) {
        int i = 0;
        for (int k = columns.size() - 1; k >= 0; k--) {
            Column candidate = columns.get(k);
            if (candidate.style().equals("mvp:rail") && candidate.length() == 17 && !candidate.crossover()) {
                i = k;
            }
        }
        Column column = columns.get(i);
        BlockPos toe = column(i);
        int run = t % 300;
        int setting = t / 300;
        if (setting >= 2) {
            if (run == 20) {
                mc.stop();
            }
            return;
        }
        if (t == 0) {
            findLegs(mc, toe);
        }
        switch (run) {
            case 0 -> command(mc, String.format(Locale.ROOT, "tp @s %.1f %d %.1f 0 0",
                    toe.getX() + 0.5, toe.getY(), toe.getZ() - 17.5));
            case 20 -> command(mc, "rwat spawn with mvp:tgm23");
            // aside the throat, on the straight side: the train going through
            case 40 -> camera(mc, toe.getX() - 6.5, toe.getY() + 5.0, toe.getZ() + 1.0, -90.0F, 35.0F);
            // high above: trunk, throat and both legs, the train on the one it took
            case 180 -> camera(mc, toe.getX() + 2.5, toe.getY() + 14.0, toe.getZ() + 4.5, 0.0F, 90.0F);
            default -> {
            }
        }
        if (run >= 40 && run < 260 && run % 5 == 0) {
            drive(mc, run % 40 == 0);
        }
        if (run == 175) {
            shot(mc, "rwat-switch-train-" + setting + "-throat.png");
        }
        if (run == 265) {
            shot(mc, "rwat-switch-train-" + setting + ".png");
            report(mc, setting);
        }
        if (run == 280) {
            removeTrain(mc);
            if (setting == 0) {
                throwSwitch(mc, column, toe, true);
            }
        }
        if (run == 286 && setting == 0) {
            throwSwitch(mc, column, toe, false);
        }
    }

    /** The toe cell of switch {@code i}: the trunk's end marker. */
    private static BlockPos column(int i) {
        return base.offset(i * SPACING, 0, 0);
    }

    /** Straight down onto the throat. */
    private static void top(Minecraft mc, BlockPos toe) {
        camera(mc, toe.getX() + 1.0, toe.getY() + 3.2, toe.getZ() + 2.2, 0.0F, 90.0F);
    }

    /** Straight down onto the blade tips, close. */
    private static void tip(Minecraft mc, BlockPos toe) {
        camera(mc, toe.getX() + 0.5, toe.getY() + 1.5, toe.getZ() + 1.4, 0.0F, 90.0F);
    }

    /** Low, just behind the toe, looking along the blades. */
    private static void toeView(Minecraft mc, BlockPos toe) {
        camera(mc, toe.getX() - 0.4, toe.getY() + 1.1, toe.getZ() - 0.9, -20.0F, 32.0F);
    }

    /** The whole throat from aside and behind. */
    private static void sideView(Minecraft mc, BlockPos toe) {
        camera(mc, toe.getX() - 3.0, toe.getY() + 3.5, toe.getZ() - 3.5, -30.0F, 32.0F);
    }

    private static void camera(Minecraft mc, double x, double y, double z, float yaw, float pitch) {
        command(mc, String.format(Locale.ROOT, "tp @s %.3f %.3f %.3f %.1f %.1f", x, y, z, yaw, pitch));
    }

    /**
     * Pulse the switch stand — the cell the clicked switch marker stood in —
     * through a redstone block two below it: on (a rising edge throws the
     * switch), or back to dirt.
     */
    private static void throwSwitch(Minecraft mc, Column column, BlockPos toe, boolean on) {
        BlockPos under = column.stand(toe).below(2);
        command(mc, String.format(Locale.ROOT, "setblock %d %d %d %s", under.getX(), under.getY(), under.getZ(),
                on ? "minecraft:redstone_block" : "minecraft:dirt"));
    }

    private static void marker(Minecraft mc, BlockPos pos, boolean switchMarker) {
        command(mc, String.format(Locale.ROOT, "setblock %d %d %d railswheelsandtrains:%s[rotation=0]",
                pos.getX(), pos.getY(), pos.getZ(), switchMarker ? "rail_switch_marker" : "rail_marker"));
    }

    /** Click a marker with a rails stack of {@code style}, on the integrated server — as the player would. */
    private static void useRails(Minecraft mc, BlockPos marker, String style) {
        onServer(mc, (level, player) -> {
            ItemStack rails = new ItemStack(RailsWheelsAndTrains.RAIL_ITEM.get());
            rails.set(RailsWheelsAndTrains.RAIL_STYLE.get(), style);
            player.setItemInHand(InteractionHand.MAIN_HAND, rails);
            rails.useOn(new UseOnContext(player, InteractionHand.MAIN_HAND,
                    new BlockHitResult(Vec3.atCenterOf(marker), Direction.UP, marker, false)));
        });
    }

    private static void logGraph(Minecraft mc, int i) {
        BlockPos toe = column(i);
        onServer(mc, (level, player) -> {
            RailGraph graph = RailNetwork.get(level).graph();
            RailNode node = graph.nodeNear(new Vector3d(toe.getX() + 0.5, toe.getY(), toe.getZ() + 0.5));
            if (node == null) {
                RailsWheelsAndTrains.LOGGER.warn("[switch] {}: no node at the toe", columns.get(i).name());
                return;
            }
            List<String> legs = new ArrayList<>();
            for (int id : node.segments()) {
                RailSegment segment = graph.segment(id);
                legs.add("#" + id + " " + (segment.style().isEmpty() ? "standard" : segment.style()));
            }
            RailsWheelsAndTrains.LOGGER.info("[switch] {}: toe node #{} with segments {}, selection {}",
                    columns.get(i).name(), node.id(), legs, graph.switchSelection(node.id()));
        });
    }

    /** The straight and diverging legs of the switch at {@code toe}, by where they end. */
    private static void findLegs(Minecraft mc, BlockPos toe) {
        onServer(mc, (level, player) -> {
            RailGraph graph = RailNetwork.get(level).graph();
            RailNode node = graph.nodeNear(new Vector3d(toe.getX() + 0.5, toe.getY(), toe.getZ() + 0.5));
            for (int id : node.segments()) {
                RailSegment segment = graph.segment(id);
                Vector3d far = graph.node(segment.nodeA() == node.id() ? segment.nodeB() : segment.nodeA())
                        .position();
                if (far.z > toe.getZ() + 2.0) {
                    if (Math.abs(far.x - (toe.getX() + 0.5)) < 0.5) {
                        straightLeg = id;
                    } else {
                        divergingLeg = id;
                    }
                }
            }
            RailsWheelsAndTrains.LOGGER.info("[switch] train switch: straight leg #{}, diverging leg #{}",
                    straightLeg, divergingLeg);
        });
    }

    /**
     * Keep the newest consist rolling toward the switch (the physics bleeds
     * a debug speed off): along +s if its route starts at the trunk's end.
     */
    private static void drive(Minecraft mc, boolean log) {
        onServer(mc, (level, player) -> {
            Consist consist = newest(level);
            if (consist == null) {
                return;
            }
            trainId = consist.id();
            RailNetwork network = RailNetwork.get(level);
            TrackPath path = consist.resolvePath(network.graph(), network.revision());
            if (path == null) {
                return;
            }
            boolean fromTrunk = path.samplePosition(0.0).z < path.samplePosition(path.length()).z;
            consist.setSpeed(fromTrunk ? 0.15 : -0.15);
            if (log) {
                Vector3d head = path.samplePosition(consist.s());
                RailsWheelsAndTrains.LOGGER.info(String.format(Locale.ROOT,
                        "[switch] train #%d head at (%.2f, %.2f) s=%.1f/%.1f on #%s",
                        consist.id(), head.x, head.z, consist.s(), path.length(), segmentAt(network.graph(), head)));
            }
        });
    }

    /** Which leg the train's head took, against the switch setting. */
    private static void report(Minecraft mc, int setting) {
        onServer(mc, (level, player) -> {
            Consist consist = newest(level);
            RailNetwork network = RailNetwork.get(level);
            if (consist == null) {
                RailsWheelsAndTrains.LOGGER.warn("[switch] no train");
                return;
            }
            TrackPath path = consist.resolvePath(network.graph(), network.revision());
            Vector3d head = path.samplePosition(consist.s());
            int on = segmentAt(network.graph(), head);
            int expected = setting == 0 ? straightLeg : divergingLeg;
            RailsWheelsAndTrains.LOGGER.info("[switch] set {}: the head is on #{} — the {} leg is #{}: {}",
                    setting == 0 ? "straight" : "diverging", on, setting == 0 ? "straight" : "diverging",
                    expected, on == expected ? "OK" : "WRONG");
        });
    }

    private static void removeTrain(Minecraft mc) {
        if (trainId > 0) {
            command(mc, "rwat remove " + trainId);
        }
    }

    private static Consist newest(ServerLevel level) {
        Consist newest = null;
        for (Consist consist : ConsistManager.get(level).all()) {
            if (newest == null || consist.id() > newest.id()) {
                newest = consist;
            }
        }
        return newest;
    }

    private static int segmentAt(RailGraph graph, Vector3d point) {
        RailGraph.SegmentHit hit = graph.nearestPoint(point, 3.0);
        return hit == null ? -1 : hit.segment().id();
    }

    /** Run {@code action} on the integrated server with the player's server side. */
    private static void onServer(Minecraft mc, java.util.function.BiConsumer<ServerLevel, ServerPlayer> action) {
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

    /** Run a command as the player, with operator rights (see {@link ClientAutoScene}). */
    private static void command(Minecraft mc, String command) {
        RailsWheelsAndTrains.LOGGER.info("[switch] /{}", command);
        onServer(mc, (level, player) -> level.getServer().getCommands().performPrefixedCommand(
                player.createCommandSourceStack().withPermission(4), command));
    }

    private static void shot(Minecraft mc, String name) {
        Screenshot.grab(mc.gameDirectory, name, mc.getMainRenderTarget(),
                message -> RailsWheelsAndTrains.LOGGER.info("[switch] {}", message.getString()));
    }
}
