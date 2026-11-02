package com.muzhik17.trainsmod.pack;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * What the content packs got wrong, by pack and file, as every loader last
 * found it — the registry behind {@code /rwat packs} and {@code /rwatc packs}
 * and the operators' notice on joining. One instance per side:
 * {@link #SERVER} holds the server's loaders (its scan of the pack folders
 * as data packs, wagon types, track beds), {@link #CLIENT} the client's (its
 * scan as resource packs, wagon models with their sounds, rail styles,
 * models without a type and types without a model, the model files' check,
 * its packs against the server's by hash).
 *
 * <p>Each loader owns its {@link Source} and replaces it wholesale on every
 * reload ({@link #replace}), so a fixed file's problems go with the reload
 * that fixed it and nothing goes stale. Besides the problems, a loader says
 * how many declarations each pack gave it, for the listing.
 *
 * <p>Plain Java: thread-safe (loaders apply on the server or render thread,
 * commands read on theirs), no MC types, unit-tested.
 */
public final class PackReport {

    /** The server's loaders: its pack scan, wagon types and the track bed under the rail styles. */
    public static final PackReport SERVER = new PackReport();
    /** This client's loaders: its pack scan, wagon models (with their sounds), rail styles and the checks on them. */
    public static final PackReport CLIENT = new PackReport();

    /** The pack id under which the client reports a type: it knows the type only by what the server synced. */
    public static final String SERVER_PACK = "server";

    /** A loader; each replaces only its own part of the report. */
    public enum Source {
        /**
         * The scan of the pack folders ({@code RwatPacks}): each pack's
         * {@code "rwat"} block, a pack left out (the data packs on the
         * server, the resource packs on the client). Counts nothing.
         */
        PACKS("packs"),
        /** {@code data/<ns>/wagon_types/} (server). */
        WAGON_TYPES("wagon_types"),
        /** The rail styles' tiles as the track bed reads them (server). */
        TRACK_BEDS("track_beds"),
        /** {@code assets/<ns>/wagon_models/} and their sounds (client). */
        WAGON_MODELS("wagon_models"),
        /** {@code assets/<ns>/rail_models/} as the client draws them. */
        RAIL_STYLES("rail_styles"),
        /**
         * The client's models against the types the server sent (client,
         * after the sync): models declared for no type, types with no model.
         */
        MODEL_TYPES("model_types"),
        /** The models' OBJ, MTL, texture and animation files, checked on demand (client). */
        MODEL_FILES("model_files"),
        /**
         * The server's packs against this client's by content hash, as the
         * server sent them on joining (client; not in a game that is its own
         * server).
         */
        PACK_SYNC("pack_sync");

        /** Lower-case name, for lang keys. */
        public final String key;

        Source(String key) {
            this.key = key;
        }
    }

    private record Part(Map<String, Integer> loaded, List<PackProblem> problems) {
    }

    /** Errors first, then by pack and file; a file's problems stay in the order found. */
    private static final Comparator<PackProblem> ORDER = Comparator
            .comparing((PackProblem p) -> !p.isError())
            .thenComparing(PackProblem::pack)
            .thenComparing(PackProblem::file);

    private final Map<Source, Part> parts = new EnumMap<>(Source.class);

    /**
     * The two sides' reports as one, for a game that is its own server
     * (single player, or the host of a LAN game): both sides read the same
     * pack files, so the pack scans each found the same problems with a
     * pack's {@code "rwat"} block, and listing both would say everything
     * twice. Each source keeps what its side reported; a problem both
     * reported is kept once, and a count both gave for a pack (the same files
     * read twice) is not added up. A snapshot: later changes to the sides
     * don't reach it.
     */
    public static PackReport merged(PackReport first, PackReport second) {
        PackReport merged = new PackReport();
        for (PackReport side : List.of(first, second)) {
            side.snapshot().forEach((source, part) -> merged.parts.merge(source, part, PackReport::join));
        }
        return merged;
    }

    private synchronized Map<Source, Part> snapshot() {
        return new EnumMap<>(parts);
    }

    private static Part join(Part a, Part b) {
        Map<String, Integer> loaded = new HashMap<>(a.loaded());
        b.loaded().forEach((pack, count) -> loaded.merge(pack, count, Math::max));
        List<PackProblem> problems = new ArrayList<>(a.problems());
        for (PackProblem problem : b.problems()) {
            if (!problems.contains(problem)) {
                problems.add(problem);
            }
        }
        return new Part(Map.copyOf(loaded), List.copyOf(problems));
    }

    /**
     * Replace what {@code source} reported last.
     *
     * @param loaded   pack → declarations it loaded, for the listing
     * @param problems everything the load found wrong
     */
    public synchronized void replace(Source source, Map<String, Integer> loaded, List<PackProblem> problems) {
        parts.put(source, new Part(Map.copyOf(loaded), List.copyOf(problems)));
    }

    /** Forget what {@code source} reported (its data went away, or it is stale). */
    public synchronized void clear(Source source) {
        parts.remove(source);
    }

    /** True if {@code source} has reported since it was last cleared. */
    public synchronized boolean has(Source source) {
        return parts.containsKey(source);
    }

    /** Every problem of every source: errors first, then by pack and file. */
    public synchronized List<PackProblem> problems() {
        List<PackProblem> all = new ArrayList<>();
        parts.values().forEach(part -> all.addAll(part.problems()));
        all.sort(ORDER);
        return all;
    }

    /** {@code source}'s problems, errors first, then by pack and file. */
    public synchronized List<PackProblem> problems(Source source) {
        Part part = parts.get(source);
        List<PackProblem> problems = part == null ? new ArrayList<>() : new ArrayList<>(part.problems());
        problems.sort(ORDER);
        return problems;
    }

    public synchronized int errors() {
        return (int) parts.values().stream().flatMap(p -> p.problems().stream()).filter(PackProblem::isError).count();
    }

    public synchronized int warnings() {
        return (int) parts.values().stream().flatMap(p -> p.problems().stream()).filter(p -> !p.isError()).count();
    }

    /** Pack → source → declarations it loaded, both sorted. */
    public synchronized Map<String, Map<Source, Integer>> loaded() {
        Map<String, Map<Source, Integer>> loaded = new TreeMap<>();
        parts.forEach((source, part) -> part.loaded().forEach((pack, count) ->
                loaded.computeIfAbsent(pack, p -> new EnumMap<>(Source.class)).merge(source, count, Integer::sum)));
        return loaded;
    }

    /** Every pack the report knows: one that loaded something or has a problem, sorted. */
    public synchronized Set<String> packs() {
        Set<String> packs = new TreeSet<>();
        parts.values().forEach(part -> {
            packs.addAll(part.loaded().keySet());
            part.problems().forEach(p -> packs.add(p.pack()));
        });
        return packs;
    }

    /**
     * The models declared for a wagon type nobody declares (fix list D4): a
     * model is tied to its type only by the id, so a typo in either file
     * name, or a type left out of the server's packs, leaves a model that is
     * never drawn — and the type the placeholder box — without a word.
     *
     * @param models  type id → where its model declaration came from
     * @param typeIds the wagon types there are
     */
    public static List<PackProblem> modelsWithoutType(Map<String, PackOrigin> models, Set<String> typeIds) {
        List<PackProblem> problems = new ArrayList<>();
        new TreeMap<>(models).forEach((id, origin) -> {
            if (!typeIds.contains(id)) {
                problems.add(origin.warning("no wagon type '" + id
                        + "' on the server: this model is never drawn (a model and its type share the id)"));
            }
        });
        return problems;
    }

    /**
     * The reverse of {@link #modelsWithoutType}: the wagon types this client
     * has no model declaration for, which it draws as a plain box. The server
     * sent the type, so a pack the server has is missing here, or a model
     * names another id. The client knows no more of a type than its id, so
     * the problem is reported against the type's file as the server's packs
     * would hold it ({@code data/<ns>/wagon_types/<path>.json}), under the
     * pack {@link #SERVER_PACK}.
     *
     * @param typeIds  the wagon types there are
     * @param modelIds the type ids this client has a model declaration for
     */
    public static List<PackProblem> typesWithoutModel(Set<String> typeIds, Set<String> modelIds) {
        List<PackProblem> problems = new ArrayList<>();
        new TreeSet<>(typeIds).forEach(id -> {
            if (!modelIds.contains(id)) {
                int colon = id.indexOf(':');
                String namespace = colon < 0 ? "minecraft" : id.substring(0, colon);
                String path = id.substring(colon + 1);
                problems.add(PackProblem.warning(SERVER_PACK,
                        PackOrigin.file("data", namespace, "wagon_types/" + path + ".json"),
                        "wagon type '" + id + "' has no model on this client: it is drawn as a box (declare it in"
                                + " assets/" + namespace + "/wagon_models/" + path + ".json of a pack this client has)"));
            }
        });
        return problems;
    }

    /**
     * The server's packs this client does not have as the server does
     * ({@link PackManifest#compare}) as warnings, one per pack, in the
     * server's order: the pack is not installed here, or is here with other
     * files, so wagons may lack models, rails their style, trains their
     * sounds. A problem with a pack as a whole is told where the pack lies:
     * {@code rwat_packs/<file or folder name>}, under the client's own pack
     * if it has one that stands for it, else under the server's.
     */
    public static List<PackProblem> packMismatches(List<PackManifest.Mismatch> mismatches) {
        List<PackProblem> problems = new ArrayList<>();
        for (PackManifest.Mismatch mismatch : mismatches) {
            PackManifest.Entry pack = mismatch.local() != null ? mismatch.local() : mismatch.server();
            problems.add(PackProblem.warning(PackInfo.idOf(pack.id()), "rwat_packs/" + pack.id(),
                    mismatch.describe()));
        }
        return problems;
    }

    /**
     * Both halves of the client's check of its models against the server's
     * types: the models without a type ({@link #modelsWithoutType}), then the
     * types without a model ({@link #typesWithoutModel}).
     */
    public static List<PackProblem> modelTypeProblems(Map<String, PackOrigin> models, Set<String> typeIds) {
        List<PackProblem> problems = modelsWithoutType(models, typeIds);
        problems.addAll(typesWithoutModel(typeIds, models.keySet()));
        return problems;
    }
}
