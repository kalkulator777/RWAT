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
 * flat save copy — the switch blades' visual regression check. Builds a
 * Y-switch with a trunk, the way a player does (markers + a rails click), in
 * each rail style — the mod's standard rail, {@code mvp:rail} and
 * {@code mvp:rail_bridge} ({@code switch:<style>,<style>…} for others,
 * {@code standard} = the mod's) — 24 blocks apart, 4000 blocks east of the
 * player. Every switch is shot set straight and set diverging, from above
 * ({@code rwat-switch-<style>-top-0/1.png}), close to the blade tips
 * ({@code -toe-}) and from aside ({@code -view-}), and the throw in between
 * frame by frame ({@code -throw-<n>.png}). The redstone throws it as a player
 * would: a block under the switch stand. Then a TGM23 runs from the trunk
 * through the first {@code mvp:rail} switch (or the first one) in either
 * setting; the log tells which leg its head took ({@code [switch]} lines,
 * {@code rwat-switch-train-0/1.png}) — the route must follow the blades.
 * Quits the game at the end.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class SwitchScene {

    private static final String[] STYLES = {"standard", "mvp:rail", "mvp:rail_bridge"};
    /** Ticks for one style's shots. */
    private static final int PER_STYLE = 320;
    /** First tick of the shots. */
    private static final int SHOTS = 260;
    /** Columns apart, blocks. */
    private static final int SPACING = 24;

    private static int ticks;
    private static String[] styles;
    /** The trunk's end at the toe — the marker block cell of switch 0. */
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
            styles = scene.startsWith("switch:") ? scene.substring("switch:".length()).split(",") : STYLES;
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
        if (styles == null) {
            return;
        }
        // build one switch every 20 ticks: its trunk, then the Y onto the trunk's end
        int build = ticks - 160;
        if (build >= 0 && build < styles.length * 20) {
            int i = build / 20;
            BlockPos toe = column(i);
            String style = styles[i].equals("standard") ? "" : styles[i];
            switch (build % 20) {
                case 0 -> {
                    marker(mc, toe.offset(0, 0, -20), false);
                    marker(mc, toe, false);
                }
                case 4 -> useRails(mc, toe.offset(0, 0, -20), style);
                case 8 -> {
                    // one block past the trunk's end: the switch snaps onto its node
                    marker(mc, toe.offset(0, 0, 1), true);
                    marker(mc, toe.offset(0, 0, 17), false);
                    marker(mc, toe.offset(4, 0, 17), false);
                }
                case 12 -> useRails(mc, toe.offset(0, 0, 1), style);
                case 16 -> logGraph(mc, i);
                default -> {
                }
            }
            return;
        }
        if (ticks == 240) {
            command(mc, "gamemode spectator");
            mc.options.hideGui = true;
        }
        int shot = ticks - SHOTS;
        if (shot >= 0 && shot < styles.length * PER_STYLE) {
            styleShots(mc, shot / PER_STYLE, shot % PER_STYLE);
            return;
        }
        train(mc, shot - styles.length * PER_STYLE);
    }

    /** The shots of switch {@code i}, {@code t} ticks in: set straight, the throw, set diverging. */
    private static void styleShots(Minecraft mc, int i, int t) {
        String name = "rwat-switch-" + styles[i].replace(':', '_');
        BlockPos toe = column(i);
        if (t < 140) {
            views(mc, toe, name + "-%s-0.png", t);
            return;
        }
        if (t >= 170 && t < 310) {
            views(mc, toe, name + "-%s-1.png", t - 170);
            return;
        }
        if (t > 150 && t < 166) {
            shot(mc, name + "-throw-" + (t - 150) + ".png"); // the throw, tick by tick
        }
        switch (t) {
            case 140 -> tip(mc, toe);
            case 150 -> throwSwitch(mc, toe, true);
            case 166 -> throwSwitch(mc, toe, false);
            // back to straight for the train run
            case 310 -> throwSwitch(mc, toe, true);
            case 316 -> throwSwitch(mc, toe, false);
            default -> {
            }
        }
    }

    /** The four views of a switch as it is set, {@code t} ticks in (0–139). */
    private static void views(Minecraft mc, BlockPos toe, String name, int t) {
        switch (t) {
            case 0 -> top(mc, toe);
            case 30 -> shot(mc, String.format(Locale.ROOT, name, "top"));
            case 35 -> tip(mc, toe);
            case 65 -> shot(mc, String.format(Locale.ROOT, name, "tip"));
            case 70 -> toeView(mc, toe);
            case 100 -> shot(mc, String.format(Locale.ROOT, name, "toe"));
            case 105 -> sideView(mc, toe);
            case 135 -> shot(mc, String.format(Locale.ROOT, name, "view"));
            default -> {
            }
        }
    }

    /**
     * The train run, {@code t} ticks after the style shots: a TGM23 on the
     * trunk runs through the switch set straight, then — after the switch
     * is thrown — set diverging.
     */
    private static void train(Minecraft mc, int t) {
        int i = 0;
        for (int k = 0; k < styles.length; k++) {
            if (styles[k].equals("mvp:rail")) {
                i = k;
                break;
            }
        }
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
            // behind the switch, above the trunk: the blades in front, the train going through
            case 40 -> camera(mc, toe.getX() + 0.5, toe.getY() + 5.0, toe.getZ() - 6.0, -8.0F, 32.0F);
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
                throwSwitch(mc, toe, true);
            }
        }
        if (run == 286 && setting == 0) {
            throwSwitch(mc, toe, false);
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
     * Pulse the switch stand — the cell the switch marker stood in, one past
     * the toe — through a redstone block two below it: on (a rising edge
     * throws the switch), or back to dirt.
     */
    private static void throwSwitch(Minecraft mc, BlockPos toe, boolean on) {
        BlockPos under = toe.offset(0, -2, 1);
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
                RailsWheelsAndTrains.LOGGER.warn("[switch] {}: no node at the toe", styles[i]);
                return;
            }
            List<String> legs = new ArrayList<>();
            for (int id : node.segments()) {
                RailSegment segment = graph.segment(id);
                legs.add("#" + id + " " + (segment.style().isEmpty() ? "standard" : segment.style()));
            }
            RailsWheelsAndTrains.LOGGER.info("[switch] {}: toe node #{} with segments {}, selection {}",
                    styles[i], node.id(), legs, graph.switchSelection(node.id()));
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
