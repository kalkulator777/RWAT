package com.muzhik17.trainsmod.stock;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The rolling-stock registry (SPEC §5.1, §6). The mod ships no stock of its
 * own: every type comes from a content pack's {@code data/<ns>/wagon_types/}
 * — the server fills the registry on (re)load and syncs it to clients;
 * consumers call {@link #byId}/{@link #resolve} unchanged (the §5.5 step 5
 * promise that only the registry's <i>source</i> changes).
 *
 * <p>An id the registry doesn't know — a pack removed from the server, a
 * client that hasn't had the sync yet — resolves to a {@link #missing}
 * placeholder <b>carrying that same id</b>, so a saved consist keeps its
 * make-up and comes back intact once the pack does (SPEC §6.5).
 *
 * <p><b>One registry, two writers.</b> The registry is static, so in single
 * player (and for a LAN host) the integrated server and its own client share
 * it. The server's load ({@link #load(Map, Map)}) brings the types and their
 * aliases; the client's sync ({@link #load(Map)}) brings the types alone. The
 * sync never takes the aliases away (D2, 2026-11-02): the integrated server
 * resolves the items and saves that carry an old id through them. When the
 * sync is the server's own layer coming back — decoded anew, but declaring
 * the same — the server's layer is kept as it is, instances and all. Once
 * that server stops ({@link #serverStopped}) its layer stands for nothing.
 *
 * <p><b>Reloads.</b> Every change of the layer counts a {@link #generation}:
 * the server's consists hold their types as instances, and take the new ones
 * by id ({@link #rebind}) when they see it move (D1: {@code /reload}).
 */
public final class WagonTypes {

    /**
     * Placeholder geometry for an unknown type: a mid-size car, unpowered and
     * cab-less, braked so it doesn't roll off on a grade. Only the shape of a
     * plausible wagon — what it was is unknowable without its pack.
     */
    private static final double MISSING_LENGTH = 20.0;
    private static final double[] MISSING_BOGIES = {7.0, -7.0};
    private static final double MISSING_MASS_T = 40.0;

    /**
     * One loaded set of types with the aliases that go with it (old id →
     * current id, SPEC §6.4 {@code aliases}: a pack that renames or takes over
     * a type keeps the saves that reference the old id working) and its
     * longest type's length. Replaced whole, so no reader sees the types of
     * one load with the aliases of another.
     */
    private record Layer(Map<String, WagonType> types, Map<String, String> aliases, double longest) {

        static Layer of(Map<String, WagonType> types, Map<String, String> aliases) {
            Map<String, WagonType> copy = Map.copyOf(types);
            return new Layer(copy, Map.copyOf(aliases),
                    copy.values().stream().mapToDouble(WagonType::length).reduce(MISSING_LENGTH, Math::max));
        }

        WagonType byId(String id) {
            WagonType type = types.get(id);
            if (type == null) {
                String target = aliases.get(id);
                type = target != null ? types.get(target) : null;
            }
            return type;
        }

        WagonType resolve(String id) {
            WagonType type = byId(id);
            return type != null ? type : missing(id);
        }
    }

    private static final Layer EMPTY = Layer.of(Map.of(), Map.of());

    /** What the registry answers with now. Volatile: the client thread may swap it while the server reads. */
    private static volatile Layer layer = EMPTY;

    /** The layer the server (in this JVM) loaded last, or null; guarded by the class lock. */
    private static Layer serverLayer;

    /** How many times {@link #layer} changed; written under the class lock only. */
    private static volatile int generation;

    private WagonTypes() {
    }

    /**
     * The length of the longest car there can be now, blocks: the longest
     * loaded type, never under the {@link #missing} placeholder's (an unknown
     * id is drawn and collided at that length). How far from a car's centre
     * its hull may reach, for whoever looks for cars near a point.
     */
    public static double longest() {
        return layer.longest();
    }

    /** Type by namespaced id (aliases followed); null if no pack declares it. */
    public static WagonType byId(String id) {
        return layer.byId(id);
    }

    /** Type by id, or the {@link #missing} placeholder for an unknown one — never null. */
    public static WagonType resolve(String id) {
        return layer.resolve(id);
    }

    /** True if a loaded pack declares {@code id} (directly or by alias). */
    public static boolean isKnown(String id) {
        return byId(id) != null;
    }

    /**
     * Stand-in for a type no pack declares: keeps {@code id} (so NBT round-trips
     * it unchanged) with generic placeholder geometry and physics.
     */
    public static WagonType missing(String id) {
        return new WagonType(id, MISSING_LENGTH, MISSING_BOGIES.clone(), MISSING_MASS_T, 100.0,
                StockDefaults.resistance(MISSING_MASS_T),
                null, null,
                StockDefaults.brakes(StockDefaults.DEFAULT_BRAKE_SYSTEM, MISSING_MASS_T, false),
                null);
    }

    /**
     * The client's sync of the server's types (SPEC §5.5 step 5). The aliases
     * stay (D2): a sync carries none, and in single player the registry is
     * the integrated server's too, which needs them — only those whose type
     * the sync no longer has go, they couldn't resolve. If the sync declares
     * exactly what this JVM's running server loaded last ({@link #sameDeclaration},
     * type by type), it is that server's own layer coming back and the
     * server's layer stays, with the instances its consists hold.
     */
    public static synchronized void load(Map<String, WagonType> types) {
        if (serverLayer != null && sameTypes(serverLayer.types(), types)) {
            swap(serverLayer);
            return;
        }
        Map<String, String> kept = new HashMap<>();
        layer.aliases().forEach((oldId, target) -> {
            if (types.containsKey(target) && !types.containsKey(oldId)) {
                kept.put(oldId, target);
            }
        });
        swap(Layer.of(types, kept));
    }

    /** The server's (re)load: the types and their alias table, replacing everything (SPEC §6.4). */
    public static synchronized void load(Map<String, WagonType> types, Map<String, String> typeAliases) {
        serverLayer = Layer.of(types, typeAliases);
        swap(serverLayer);
    }

    /**
     * This JVM's server stopped (single player: the world was left). Its
     * load no longer answers {@link #loadedTypes} nor stands for the sync of
     * the next server this client joins, which may declare the same; the
     * layer stays until that sync, as a client keeps the last server's types.
     */
    public static synchronized void serverStopped() {
        serverLayer = null;
    }

    /** Make {@code next} the layer, counting a generation if it is another one. */
    private static void swap(Layer next) {
        if (next != layer) {
            layer = next;
            generation++;
        }
    }

    /**
     * Counts every change of the loaded layer — a server (re)load, a client
     * sync that brought other types. Whoever holds types as instances (the
     * server's consists) {@linkplain #rebind takes the current ones} when it
     * sees this move.
     */
    public static int generation() {
        return generation;
    }

    /**
     * The types the server syncs to its clients: what it loaded itself —
     * never a copy its own client's sync left in the shared registry.
     */
    public static Map<String, WagonType> loadedTypes() {
        synchronized (WagonTypes.class) {
            if (serverLayer != null) {
                return serverLayer.types();
            }
        }
        return layer.types();
    }

    /**
     * The types the registry answers with now — on a client, what the last
     * sync brought (in single player the server's own layer). Unlike
     * {@link #loadedTypes} never the integrated server's load when this
     * client has since joined another server. Another map whenever the layer
     * changes, so a reader may watch it by identity.
     */
    public static Map<String, WagonType> currentTypes() {
        return layer.types();
    }

    /** Every loaded type, sorted by id (stable listing/suggestion order). */
    public static List<WagonType> all() {
        List<WagonType> all = new ArrayList<>(layer.types().values());
        all.sort((a, b) -> a.id().compareTo(b.id()));
        return all;
    }

    /**
     * The make-up with each wagon's type looked up again by the id it carries
     * (D1, after a reload): the type as it is now, a renamed one through its
     * alias, a removed one as the {@link #missing} placeholder with that id —
     * the same as a save loading. Every slot from one layer, so one train
     * never holds two loads of a type; orientation and livery kept. The
     * composition itself if no wagon's type changed.
     */
    public static ConsistComposition rebind(ConsistComposition composition) {
        Layer now = layer;
        List<ConsistComposition.Slot> slots = new ArrayList<>(composition.wagonCount());
        boolean changed = false;
        for (ConsistComposition.Slot slot : composition.slots()) {
            WagonType type = now.resolve(slot.type().id());
            changed |= type != slot.type();
            slots.add(new ConsistComposition.Slot(type, slot.flipped(), slot.livery()));
        }
        return changed ? new ConsistComposition(slots) : composition;
    }

    /**
     * The open doors of a wagon whose type went from {@code before} to
     * {@code after} (D1): door state lives by id (SPEC §9.8), so each door of
     * {@code after} is open if a door of that id was open in {@code before},
     * wherever the reload put it in the list; a door gone is forgotten, a new
     * one is shut, and one that is a {@code fixed} doorway now takes no bit
     * ({@link WagonType#leafDoors}). Bit {@code i} = door {@code i}, the first
     * 32 as everywhere.
     */
    public static int openDoorsAfter(WagonType before, WagonType after, int openMask) {
        if (before == null || after == null) {
            return 0;
        }
        Set<String> open = new HashSet<>();
        for (int i = 0; i < before.doors().size() && i < 32; i++) {
            if ((openMask >> i & 1) != 0) {
                open.add(before.doors().get(i).id());
            }
        }
        int mask = 0;
        for (int i = 0; i < after.doors().size() && i < 32; i++) {
            if (open.contains(after.doors().get(i).id())) {
                mask |= 1 << i;
            }
        }
        return mask & after.leafDoors();
    }

    /** True if both declare the same ids, each the same way ({@link #sameDeclaration}). */
    static boolean sameTypes(Map<String, WagonType> a, Map<String, WagonType> b) {
        if (a.size() != b.size()) {
            return false;
        }
        for (Map.Entry<String, WagonType> entry : a.entrySet()) {
            if (!sameDeclaration(entry.getValue(), b.get(entry.getKey()))) {
                return false;
            }
        }
        return true;
    }

    /**
     * True if two types declare the same — as a type decoded from the sync
     * does the one the server parsed. Value for value: the record compares
     * its bogie array by reference, so that is compared on its own.
     */
    static boolean sameDeclaration(WagonType a, WagonType b) {
        if (a == b) {
            return true;
        }
        if (a == null || b == null || !Arrays.equals(a.bogieOffsets(), b.bogieOffsets())) {
            return false;
        }
        return a.equals(new WagonType(b.id(), b.length(), a.bogieOffsets(), b.massT(), b.maxSpeedKmh(),
                b.resistance(), b.traction(), b.cab(), b.brakes(), b.interior(), b.doors(), b.couplers()));
    }

    /**
     * Default consist for a bare {@code /rwat spawn}: the first drivable type
     * hauling the first boardable non-drivable one (by id), so a fresh install
     * with any pack gets a train to drive and walk; whatever exists if the
     * packs offer no such pair. Null if no pack declares any stock.
     */
    public static ConsistComposition defaultConsist() {
        List<WagonType> all = all();
        if (all.isEmpty()) {
            return null;
        }
        WagonType head = all.stream().filter(WagonType::drivable).findFirst().orElse(all.get(0));
        WagonType car = all.stream()
                .filter(t -> t.boardable() && !t.drivable())
                .findFirst()
                .orElse(all.stream().filter(t -> !t.drivable()).findFirst().orElse(null));
        List<ConsistComposition.Slot> slots = new ArrayList<>();
        slots.add(new ConsistComposition.Slot(head, false));
        if (car != null) {
            slots.add(new ConsistComposition.Slot(car, false));
        }
        return new ConsistComposition(slots);
    }
}
