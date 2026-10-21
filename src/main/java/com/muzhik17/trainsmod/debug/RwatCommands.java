package com.muzhik17.trainsmod.debug;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

import org.joml.Vector3d;

import com.mojang.brigadier.arguments.BoolArgumentType;
import com.mojang.brigadier.arguments.DoubleArgumentType;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.exceptions.SimpleCommandExceptionType;
import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.ConsistManager;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypes;
import com.muzhik17.trainsmod.network.TrackPathSpec;
import com.muzhik17.trainsmod.path.RailSegment;
import com.muzhik17.trainsmod.path.TrackPath;
import com.muzhik17.trainsmod.rail.BedMaterial;
import com.muzhik17.trainsmod.rail.RailNetwork;

import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.SharedSuggestionProvider;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ChunkMap;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerPlayerConnection;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.ChunkPos;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

/**
 * {@code /rwat} debug command (SPEC §2.4a): spawn/remove a consist, set its
 * speed, teleport to it, list the installed stock. v0 spawn lays a straight
 * debug path from the player along their horizontal look direction.
 *
 * <p>{@code /rwat spawn with <stock>} takes the consist front first as
 * space-separated wagon types from the packs (SPEC §6):
 * {@code [!]<type>[@<livery>]} — {@code !} turns the wagon backwards, a type
 * may drop its namespace while that stays unambiguous, e.g.
 * {@code /rwat spawn with chme3 amendorf@mvp_rzd !chme3}.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID)
public final class RwatCommands {

    private static final double DEFAULT_LENGTH = 100.0;

    private static final SimpleCommandExceptionType NO_STOCK = new SimpleCommandExceptionType(
            Component.literal("No rolling stock installed: put a content pack into the "
                    + "rwat_packs folder of the game directory and restart."));

    private RwatCommands() {
    }

    @SubscribeEvent
    static void onRegisterCommands(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("rwat")
                .requires(source -> source.hasPermission(Commands.LEVEL_GAMEMASTERS))
                .then(Commands.literal("spawn")
                        .executes(ctx -> spawn(ctx, DEFAULT_LENGTH, defaultConsist()))
                        .then(Commands.literal("with")
                                .then(Commands.argument("stock", StringArgumentType.greedyString())
                                        .suggests(RwatCommands::suggestStock)
                                        .executes(ctx -> spawn(ctx, DEFAULT_LENGTH, parseConsist(
                                                StringArgumentType.getString(ctx, "stock"))))))
                        .then(Commands.argument("length", DoubleArgumentType.doubleArg(2.0, 10000.0))
                                .executes(ctx -> spawn(ctx, DoubleArgumentType.getDouble(ctx, "length"),
                                        defaultConsist()))
                                .then(Commands.literal("with")
                                        .then(Commands.argument("stock", StringArgumentType.greedyString())
                                                .suggests(RwatCommands::suggestStock)
                                                .executes(ctx -> spawn(ctx,
                                                        DoubleArgumentType.getDouble(ctx, "length"),
                                                        parseConsist(StringArgumentType.getString(ctx, "stock"))))))))
                .then(Commands.literal("types")
                        .executes(RwatCommands::types))
                .then(Commands.literal("list")
                        .executes(RwatCommands::list))
                .then(Commands.literal("speed")
                        .then(Commands.argument("id", IntegerArgumentType.integer(1))
                                .then(Commands.argument("speed", DoubleArgumentType.doubleArg(-3.0, 3.0))
                                        .executes(ctx -> speed(ctx,
                                                IntegerArgumentType.getInteger(ctx, "id"),
                                                DoubleArgumentType.getDouble(ctx, "speed"))))))
                .then(Commands.literal("remove")
                        .then(Commands.argument("id", IntegerArgumentType.integer(1))
                                .executes(ctx -> remove(ctx, IntegerArgumentType.getInteger(ctx, "id")))))
                .then(Commands.literal("tp")
                        .then(Commands.argument("id", IntegerArgumentType.integer(1))
                                .executes(ctx -> teleport(ctx, IntegerArgumentType.getInteger(ctx, "id")))))
                .then(Commands.literal("uncouple")
                        .then(Commands.argument("id", IntegerArgumentType.integer(1))
                                .then(Commands.argument("index", IntegerArgumentType.integer(1))
                                        .executes(ctx -> uncouple(ctx,
                                                IntegerArgumentType.getInteger(ctx, "id"),
                                                IntegerArgumentType.getInteger(ctx, "index"))))))
                .then(Commands.literal("handbrake")
                        .then(Commands.argument("id", IntegerArgumentType.integer(1))
                                .then(Commands.argument("set", BoolArgumentType.bool())
                                        .executes(ctx -> handbrake(ctx,
                                                IntegerArgumentType.getInteger(ctx, "id"),
                                                BoolArgumentType.getBool(ctx, "set"))))))
                .then(Commands.literal("rail")
                        .then(Commands.literal("remove")
                                .executes(RwatCommands::railRemove))
                        .then(Commands.literal("rebed")
                                .executes(RwatCommands::railRebed))
                        .then(Commands.literal("style")
                                .then(Commands.argument("style", StringArgumentType.greedyString())
                                        .executes(ctx -> railStyle(ctx,
                                                StringArgumentType.getString(ctx, "style")))))
                        .then(Commands.literal("bed")
                                .then(Commands.argument("material", StringArgumentType.word())
                                        .suggests((ctx, builder) ->
                                                SharedSuggestionProvider.suggest(BedMaterial.ids(), builder))
                                        .executes(ctx -> railBed(ctx,
                                                StringArgumentType.getString(ctx, "material"))))))
                .then(Commands.literal("track")
                        .executes(RwatCommands::trackDump))
                .then(Commands.literal("control")
                        .then(Commands.argument("group", StringArgumentType.word())
                                .then(Commands.argument("value", DoubleArgumentType.doubleArg(0.0, 1.0))
                                        .executes(ctx -> control(ctx,
                                                StringArgumentType.getString(ctx, "group"),
                                                DoubleArgumentType.getDouble(ctx, "value"))))))
                .then(Commands.literal("handle")
                        .then(Commands.argument("handle", StringArgumentType.word())
                                .then(Commands.argument("value", IntegerArgumentType.integer(-1, Consist.NOTCHES))
                                        .executes(ctx -> handle(ctx,
                                                StringArgumentType.getString(ctx, "handle"),
                                                IntegerArgumentType.getInteger(ctx, "value")))))));
    }

    /** The consist with a wagon nearest the command's source, within 64 blocks, or null. */
    private static Consist nearestConsist(CommandContext<CommandSourceStack> ctx) {
        ServerLevel level = ctx.getSource().getLevel();
        net.minecraft.world.phys.Vec3 at = ctx.getSource().getPosition();
        WagonEntity nearest = null;
        for (WagonEntity wagon : level.getEntitiesOfClass(WagonEntity.class,
                new net.minecraft.world.phys.AABB(at, at).inflate(64.0))) {
            if (nearest == null || wagon.distanceToSqr(at) < nearest.distanceToSqr(at)) {
                nearest = wagon;
            }
        }
        return nearest == null ? null : ConsistManager.get(level).byId(nearest.getConsistId());
    }

    /**
     * {@code /rwat control <group> <value>} — set a control group (a light, a
     * switch; SPEC §8–§9) on every wagon of the nearest train. Debug and
     * scripted screenshots; players use the cab switches and the light menu.
     */
    private static int control(CommandContext<CommandSourceStack> ctx, String group, double value) {
        Consist consist = nearestConsist(ctx);
        if (consist == null) {
            ctx.getSource().sendFailure(Component.literal("No train within 64 blocks."));
            return 0;
        }
        ServerLevel level = ctx.getSource().getLevel();
        for (java.util.UUID id : consist.wagonIds()) {
            if (level.getEntity(id) instanceof WagonEntity wagon) {
                wagon.setControl(group, (float) value);
            }
        }
        ctx.getSource().sendSuccess(() -> Component.literal(
                "Consist #" + consist.id() + ": " + group + " = " + value), false);
        return 1;
    }

    /**
     * {@code /rwat handle <reverser|throttle|train_brake|independent_brake> <value>}
     * — put a driver's handle of the nearest train (SPEC §9), as a cab lever would.
     */
    private static int handle(CommandContext<CommandSourceStack> ctx, String name, int value) {
        Consist consist = nearestConsist(ctx);
        Consist.Handle handle;
        try {
            handle = Consist.Handle.valueOf(name.toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException e) {
            ctx.getSource().sendFailure(Component.literal(
                    "Handles: reverser, throttle, train_brake, independent_brake"));
            return 0;
        }
        if (consist == null) {
            ctx.getSource().sendFailure(Component.literal("No train within 64 blocks."));
            return 0;
        }
        consist.setHandle(handle, value);
        ctx.getSource().sendSuccess(() -> Component.literal("Consist #" + consist.id() + ": "
                + name + " = " + consist.handle(handle)), false);
        return 1;
    }

    /**
     * Dump vanilla entity-tracking state for every consist wagon and every
     * player (debug, tracking bugs of 2026-06-12). For each (entity, player)
     * pair it answers the exact questions {@code TrackedEntity.updatePlayer}
     * asks: horizontal distance, entity's chunk inside the player's tracking
     * view, that chunk still pending in the chunk sender, and whether the
     * pairing actually exists ({@code seenBy}). {@code entityMap}/{@code seenBy}
     * are private — read via reflection (mojmap names; the NeoForge runtime
     * uses them in dev and production). Output goes to chat and the log.
     */
    private static int trackDump(CommandContext<CommandSourceStack> ctx) {
        ServerLevel level = ctx.getSource().getLevel();
        Map<Integer, Object> entityMap;
        try {
            entityMap = reflectEntityMap(level.getChunkSource().chunkMap);
        } catch (ReflectiveOperationException e) {
            ctx.getSource().sendFailure(Component.literal("tracking reflection failed: " + e));
            return 0;
        }
        List<String> lines = new ArrayList<>();
        for (Consist consist : ConsistManager.get(level).all()) {
            int index = 0;
            for (UUID uuid : consist.wagonIds()) {
                String label = "consist#" + consist.id() + " wagon[" + (index++) + "]";
                if (level.getEntity(uuid) instanceof WagonEntity wagon) {
                    probeEntity(label, wagon, entityMap, level, lines);
                } else {
                    lines.add(label + "  NOT LOADED (" + uuid + ")");
                }
            }
        }
        for (ServerPlayer subject : level.players()) {
            probeEntity("player " + subject.getGameProfile().getName(), subject,
                    entityMap, level, lines);
        }
        for (String line : lines) {
            RailsWheelsAndTrains.LOGGER.info("[rwat track] {}", line);
            ctx.getSource().sendSuccess(() -> Component.literal(line), false);
        }
        return lines.size();
    }

    /** One subject entity vs every player: the updatePlayer conditions + the actual pairing. */
    private static void probeEntity(String label, Entity subject, Map<Integer, Object> entityMap,
            ServerLevel level, List<String> lines) {
        Object tracked = entityMap.get(subject.getId());
        ChunkPos chunk = subject.chunkPosition();
        StringBuilder line = new StringBuilder(String.format("%s id=%d @[%.0f %.0f %.0f] chunk[%d %d]%s",
                label, subject.getId(), subject.getX(), subject.getY(), subject.getZ(),
                chunk.x, chunk.z, tracked == null ? "  NOT IN entityMap!" : ""));
        for (ServerPlayer player : level.players()) {
            if (player == subject) {
                continue;
            }
            double dx = player.getX() - subject.getX();
            double dz = player.getZ() - subject.getZ();
            boolean inView = player.getChunkTrackingView().contains(chunk.x, chunk.z);
            boolean pending = player.connection.chunkSender.isPending(chunk.toLong());
            String seen;
            try {
                seen = tracked == null ? "-" : String.valueOf(reflectSeenBy(tracked, player));
            } catch (ReflectiveOperationException e) {
                seen = "?";
            }
            line.append(String.format(" | %s: dist=%.0f view=%s pending=%s paired=%s",
                    player.getGameProfile().getName(), Math.sqrt(dx * dx + dz * dz),
                    inView, pending, seen));
        }
        lines.add(line.toString());
    }

    /** ChunkMap.entityMap (private): entity id → TrackedEntity. */
    @SuppressWarnings("unchecked")
    private static Map<Integer, Object> reflectEntityMap(ChunkMap chunkMap)
            throws ReflectiveOperationException {
        Field field = ChunkMap.class.getDeclaredField("entityMap");
        field.setAccessible(true);
        return (Map<Integer, Object>) field.get(chunkMap);
    }

    /** TrackedEntity.seenBy (private) contains this player's connection? */
    private static boolean reflectSeenBy(Object trackedEntity, ServerPlayer player)
            throws ReflectiveOperationException {
        Field field = trackedEntity.getClass().getDeclaredField("seenBy");
        field.setAccessible(true);
        for (Object connection : (Set<?>) field.get(trackedEntity)) {
            if (connection instanceof ServerPlayerConnection seen && seen.getPlayer() == player) {
                return true;
            }
        }
        return false;
    }

    /**
     * Spawn a consist: on the rail route through the nearest segment if rails
     * are within reach, otherwise on a straight debug path along the player's
     * look direction (the Layer 0 fallback).
     */
    private static int spawn(CommandContext<CommandSourceStack> ctx, double length,
            ConsistComposition composition) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        ServerLevel level = ctx.getSource().getLevel();
        Vector3d playerPos = new Vector3d(player.getX(), player.getY(), player.getZ());

        RailNetwork network = RailNetwork.get(level);
        TrackPathSpec spec;
        String where;
        RailSegment nearSegment = network.graph().segmentNear(playerPos, 16.0);
        if (nearSegment != null) {
            spec = TrackPathSpec.Route.of(network.graph().walkRoute(nearSegment.id()));
            where = "on the rail route";
        } else {
            Vector3d direction = new Vector3d(player.getLookAngle().x, 0.0, player.getLookAngle().z);
            if (direction.lengthSquared() < 1.0e-6) {
                direction.set(0.0, 0.0, 1.0);
            }
            direction.normalize();
            Vector3d end = new Vector3d(direction).mul(length).add(playerPos);
            spec = TrackPathSpec.Straight.of(playerPos, end);
            where = "on a straight debug path (no rails nearby)";
        }

        TrackPath path = spec.resolve(network.graph());
        // keep the whole train on the path: head sits at least its full length in
        double minHeadS = Math.min(composition.totalLength(), path.length());
        double startS = Math.max(nearestS(path, playerPos), minHeadS);

        Consist consist = ConsistManager.get(level).spawn(level, spec, path, composition, startS);
        if (consist == null) {
            ctx.getSource().sendFailure(Component.literal("A wagon could not join the level: nothing spawned."));
            return 0;
        }

        double pathLength = path.length();
        ctx.getSource().sendSuccess(() -> Component.literal(String.format(
                "Consist #%d spawned %s with %d wagons (length %.0f, s=%.1f). /rwat speed %d 0.5 to move it.",
                consist.id(), where, composition.wagonCount(), pathLength, startS, consist.id())), false);
        return consist.id();
    }

    /** The packs' default train (first drivable type + first car), or a failure without packs. */
    private static ConsistComposition defaultConsist() throws CommandSyntaxException {
        ConsistComposition composition = WagonTypes.defaultConsist();
        if (composition == null) {
            throw NO_STOCK.create();
        }
        return composition;
    }

    /** {@code [!]<type>[@<livery>] ...} → composition, front first; fails on an unknown type. */
    private static ConsistComposition parseConsist(String input) throws CommandSyntaxException {
        if (WagonTypes.all().isEmpty()) {
            throw NO_STOCK.create();
        }
        List<ConsistComposition.Slot> slots = new ArrayList<>();
        for (String token : input.trim().split("\\s+")) {
            boolean flipped = token.startsWith("!");
            String spec = flipped ? token.substring(1) : token;
            int at = spec.indexOf('@');
            String livery = at >= 0 ? spec.substring(at + 1) : ConsistComposition.Slot.BASE_LIVERY;
            String typeName = at >= 0 ? spec.substring(0, at) : spec;
            slots.add(new ConsistComposition.Slot(findType(typeName), flipped, livery));
        }
        return new ConsistComposition(slots);
    }

    /** A type by full id, or by its path alone while only one namespace has it. */
    private static WagonType findType(String name) throws CommandSyntaxException {
        WagonType exact = WagonTypes.byId(name);
        if (exact != null) {
            return exact;
        }
        List<WagonType> byPath = new ArrayList<>();
        for (WagonType type : WagonTypes.all()) {
            if (type.id().substring(type.id().indexOf(':') + 1).equals(name)) {
                byPath.add(type);
            }
        }
        if (byPath.size() == 1) {
            return byPath.get(0);
        }
        String problem = byPath.isEmpty()
                ? "Unknown wagon type '" + name + "' (see /rwat types)"
                : "Ambiguous wagon type '" + name + "', use the full id";
        throw new SimpleCommandExceptionType(Component.literal(problem)).create();
    }

    /** Suggest type ids for the token being typed (liveries are client data — not suggested). */
    private static CompletableFuture<Suggestions> suggestStock(CommandContext<CommandSourceStack> ctx,
            SuggestionsBuilder builder) {
        String input = builder.getRemaining();
        int tokenStart = input.lastIndexOf(' ') + 1;
        String token = input.substring(tokenStart);
        String flip = token.startsWith("!") ? "!" : "";
        String typed = token.substring(flip.length());
        SuggestionsBuilder tokenBuilder = builder.createOffset(builder.getStart() + tokenStart);
        if (!typed.contains("@")) {
            for (WagonType type : WagonTypes.all()) {
                String path = type.id().substring(type.id().indexOf(':') + 1);
                if (type.id().startsWith(typed) || path.startsWith(typed)) {
                    tokenBuilder.suggest(flip + type.id());
                }
            }
        }
        return tokenBuilder.buildFuture();
    }

    /** List the installed stock: id, display name (translated on the client), length, mass, capabilities. */
    private static int types(CommandContext<CommandSourceStack> ctx) {
        List<WagonType> all = WagonTypes.all();
        if (all.isEmpty()) {
            ctx.getSource().sendFailure(Component.literal("No rolling stock installed: put a content "
                    + "pack into the rwat_packs folder of the game directory and restart."));
            return 0;
        }
        for (WagonType type : all) {
            String key = "wagon." + type.id().replace(':', '.');
            String caps = (type.powered() ? " traction" : "") + (type.drivable() ? " cab" : "")
                    + (type.boardable() ? " boardable" : "");
            Component line = Component.literal(type.id() + "  ")
                    .append(Component.translatableWithFallback(key, type.id()))
                    .append(Component.literal(String.format("  %.1f m, %.0f t%s",
                            type.length(), type.massT(), caps)));
            ctx.getSource().sendSuccess(() -> line, false);
        }
        return all.size();
    }

    /** s on the path closest to the point (coarse 1-block sampling — debug precision). */
    private static double nearestS(TrackPath path, Vector3d point) {
        double bestS = 0.0;
        double bestDistSq = Double.MAX_VALUE;
        double length = path.length();
        double step = Math.max(0.5, length / 2048.0);
        for (double s = 0.0; s <= length; s += step) {
            double distSq = path.samplePosition(s).distanceSquared(point);
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                bestS = s;
            }
        }
        return bestS;
    }

    private static int railRemove(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        ServerLevel level = ctx.getSource().getLevel();
        RailSegment removed = RailNetwork.get(level).removeSegmentNear(level,
                new Vector3d(player.getX(), player.getY(), player.getZ()), 16.0);
        if (removed == null) {
            ctx.getSource().sendFailure(Component.literal("No rail segment within 16 blocks."));
            return 0;
        }
        ctx.getSource().sendSuccess(() -> Component.literal(
                "Rail segment #" + removed.id() + " removed."), false);
        return 1;
    }

    /**
     * Re-lay the track bed of every segment of this dimension (SPEC §2.2): the
     * bed follows the drawn rails, blocks no rail touches come out — for
     * worlds whose bed was laid before that (2026-10-09), or after a pack
     * changed a rail style's tile.
     */
    private static int railRebed(CommandContext<CommandSourceStack> ctx) {
        ServerLevel level = ctx.getSource().getLevel();
        int count = RailNetwork.get(level).rebed(level);
        ctx.getSource().sendSuccess(() -> Component.literal(
                "Track bed re-laid under " + count + " rail segment(s)."), false);
        return count;
    }

    /**
     * Redraw every segment of this dimension in a rail style (SPEC §6.10) —
     * e.g. to bring a network built before styles back to a pack's look.
     * {@code standard} = the mod's own rail. Styles are client resources: an
     * id this server can't verify is applied as given.
     */
    private static int railStyle(CommandContext<CommandSourceStack> ctx, String style) {
        String id = style.equals("standard") ? RailSegment.DEFAULT_STYLE : style;
        if (!id.isEmpty() && ResourceLocation.tryParse(id) == null) {
            ctx.getSource().sendFailure(Component.literal("Not a style id: " + style));
            return 0;
        }
        ServerLevel level = ctx.getSource().getLevel();
        int count = RailNetwork.get(level).restyleAll(level, id);
        ctx.getSource().sendSuccess(() -> Component.literal(
                count + " rail segment(s) now drawn as " + (id.isEmpty() ? "standard" : id) + "."), false);
        return count;
    }

    /**
     * Re-lay the bed of every segment of this dimension in a bed material
     * (SPEC §2.2), rail styles kept.
     */
    private static int railBed(CommandContext<CommandSourceStack> ctx, String id) {
        BedMaterial material = BedMaterial.byId(id);
        if (material == null) {
            ctx.getSource().sendFailure(Component.literal(
                    "Not a bed material: " + id + " (one of " + String.join(", ", BedMaterial.ids()) + ")"));
            return 0;
        }
        ServerLevel level = ctx.getSource().getLevel();
        int count = RailNetwork.get(level).rebedAll(level, material);
        ctx.getSource().sendSuccess(() -> Component.literal(
                count + " rail segment(s) now on a " + material.id() + " bed."), false);
        return count;
    }

    private static int list(CommandContext<CommandSourceStack> ctx) {
        ServerLevel level = ctx.getSource().getLevel();
        ConsistManager manager = ConsistManager.get(level);
        if (manager.all().isEmpty()) {
            ctx.getSource().sendSuccess(() -> Component.literal("No consists in this dimension."), false);
            return 0;
        }
        RailNetwork network = RailNetwork.get(level);
        for (Consist consist : manager.all()) {
            TrackPath path = consist.resolvePath(network.graph(), network.revision());
            String line;
            if (path == null) {
                line = String.format("#%d  STRANDED, not placed yet (none of its wagons loaded)  wagons=%d",
                        consist.id(), consist.wagonIds().size());
            } else {
                Vector3d pos = path.samplePosition(consist.s());
                line = String.format("#%d  s=%.1f/%.1f  v=%.2f  at [%.0f %.0f %.0f]  wagons=%d  chunks=%d%s",
                        consist.id(), consist.s(), path.length(), consist.speed(),
                        pos.x, pos.y, pos.z, consist.wagonIds().size(), manager.chunksHeld(consist.id()),
                        consist.pathSpec() instanceof TrackPathSpec.Stranded ? "  STRANDED (its rails are gone)" : "");
            }
            ctx.getSource().sendSuccess(() -> Component.literal(line), false);
        }
        return manager.all().size();
    }

    private static int speed(CommandContext<CommandSourceStack> ctx, int id, double speed) {
        ServerLevel level = ctx.getSource().getLevel();
        ConsistManager manager = ConsistManager.get(level);
        Consist consist = manager.byId(id);
        if (consist == null) {
            ctx.getSource().sendFailure(Component.literal("No consist #" + id));
            return 0;
        }
        consist.setSpeed(speed);
        manager.setDirty();
        ctx.getSource().sendSuccess(() -> Component.literal(
                "Consist #" + id + " speed set to " + speed + " blocks/tick"), false);
        return 1;
    }

    private static int remove(CommandContext<CommandSourceStack> ctx, int id) {
        ServerLevel level = ctx.getSource().getLevel();
        ConsistManager manager = ConsistManager.get(level);
        Consist consist = manager.remove(id);
        if (consist == null) {
            ctx.getSource().sendFailure(Component.literal("No consist #" + id));
            return 0;
        }
        for (UUID uuid : consist.wagonIds()) {
            if (level.getEntity(uuid) != null) {
                level.getEntity(uuid).discard();
            }
        }
        ctx.getSource().sendSuccess(() -> Component.literal("Consist #" + id + " removed."), false);
        return 1;
    }

    /**
     * Uncouple consist {@code id} in front of wagon {@code index} (SPEC §6.12,
     * the crowbar without the aiming): wagons {@code [0, index)} stay, the rest
     * become a new consist.
     */
    private static int uncouple(CommandContext<CommandSourceStack> ctx, int id, int index) {
        ServerLevel level = ctx.getSource().getLevel();
        ConsistManager manager = ConsistManager.get(level);
        Consist consist = manager.byId(id);
        if (consist == null) {
            ctx.getSource().sendFailure(Component.literal("No consist #" + id));
            return 0;
        }
        Consist rear = manager.split(level, consist, index);
        if (rear == null) {
            ctx.getSource().sendFailure(Component.literal(String.format(
                    "Consist #%d has %d wagons: uncouple at 1..%d", id,
                    consist.composition().wagonCount(), consist.composition().wagonCount() - 1)));
            return 0;
        }
        ctx.getSource().sendSuccess(() -> Component.literal(String.format(
                "Consist #%d uncoupled: #%d keeps %d wagons, #%d takes %d.", id, id,
                consist.composition().wagonCount(), rear.id(), rear.composition().wagonCount())),
                false);
        return rear.id();
    }

    /**
     * Set or release every handbrake of consist {@code id} (SPEC §5.3, the
     * crowbar wagon by wagon). Under a profile with auto handbrakes they
     * follow the throttle again on the next tick.
     */
    private static int handbrake(CommandContext<CommandSourceStack> ctx, int id, boolean set) {
        ServerLevel level = ctx.getSource().getLevel();
        ConsistManager manager = ConsistManager.get(level);
        Consist consist = manager.byId(id);
        if (consist == null) {
            ctx.getSource().sendFailure(Component.literal("No consist #" + id));
            return 0;
        }
        consist.setAllHandbrakes(set);
        manager.setDirty();
        ctx.getSource().sendSuccess(() -> Component.literal(String.format(
                "Consist #%d: handbrakes %s on %d of %d wagons.", id, set ? "set" : "released",
                consist.handbrakesSet(), consist.wagonIds().size())), false);
        return consist.handbrakesSet();
    }

    private static int teleport(CommandContext<CommandSourceStack> ctx, int id) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        ServerLevel level = ctx.getSource().getLevel();
        Consist consist = ConsistManager.get(level).byId(id);
        if (consist == null) {
            ctx.getSource().sendFailure(Component.literal("No consist #" + id));
            return 0;
        }
        RailNetwork network = RailNetwork.get(level);
        TrackPath path = consist.resolvePath(network.graph(), network.revision());
        if (path == null) {
            ctx.getSource().sendFailure(Component.literal(
                    "Consist #" + id + " is stranded and not placed yet (none of its wagons loaded)."));
            return 0;
        }
        Vector3d pos = path.samplePosition(consist.s());
        player.teleportTo(level, pos.x, pos.y + 1.0, pos.z, player.getYRot(), player.getXRot());
        ctx.getSource().sendSuccess(() -> Component.literal("Teleported to consist #" + id), false);
        return 1;
    }
}
