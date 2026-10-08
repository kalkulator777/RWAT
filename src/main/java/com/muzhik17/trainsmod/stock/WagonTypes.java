package com.muzhik17.trainsmod.stock;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

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
     * The loaded layer. Replaced wholesale on server datapack (re)load and on
     * the client by the sync payload; volatile because the network thread may
     * hand the payload off while the render thread reads.
     */
    private static volatile Map<String, WagonType> loaded = Map.of();

    /**
     * Old id → current id (SPEC §6.4 {@code aliases}): a pack that renames or
     * takes over a type keeps the saves that reference the old id working.
     * Server-side only — snapshots already carry resolved ids.
     */
    private static volatile Map<String, String> aliases = Map.of();

    private WagonTypes() {
    }

    /** Type by namespaced id (aliases followed); null if no pack declares it. */
    public static WagonType byId(String id) {
        WagonType type = loaded.get(id);
        if (type == null) {
            String target = aliases.get(id);
            type = target != null ? loaded.get(target) : null;
        }
        return type;
    }

    /** Type by id, or the {@link #missing} placeholder for an unknown one — never null. */
    public static WagonType resolve(String id) {
        WagonType type = byId(id);
        return type != null ? type : missing(id);
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
                new WagonType.Resistance(20.0 * MISSING_MASS_T, 0.9 * MISSING_MASS_T, 9.0),
                null, null,
                new WagonType.Brakes(2.0 * MISSING_MASS_T, 0.0, 0.0, 0.0, 0.4 * MISSING_MASS_T),
                null);
    }

    /** Replace the loaded layer (server reload listener / client sync handler). */
    public static void load(Map<String, WagonType> types) {
        load(types, Map.of());
    }

    /** Replace the loaded layer and the alias table (server reload listener). */
    public static void load(Map<String, WagonType> types, Map<String, String> typeAliases) {
        loaded = Map.copyOf(types);
        aliases = Map.copyOf(typeAliases);
    }

    /** The current loaded layer, for syncing to clients. */
    public static Map<String, WagonType> loadedTypes() {
        return loaded;
    }

    /** Every loaded type, sorted by id (stable listing/suggestion order). */
    public static List<WagonType> all() {
        List<WagonType> all = new ArrayList<>(loaded.values());
        all.sort((a, b) -> a.id().compareTo(b.id()));
        return all;
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
