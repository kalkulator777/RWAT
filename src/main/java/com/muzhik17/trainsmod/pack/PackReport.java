package com.muzhik17.trainsmod.pack;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * What the content packs got wrong, by pack and file, as every loader last
 * found it — the registry behind {@code /rwat packs} and {@code /rwatc packs}
 * and the operators' notice on joining. One instance per side:
 * {@link #SERVER} holds the server's loaders (wagon types, track beds),
 * {@link #CLIENT} the client's (wagon models with their sounds, rail styles,
 * models without a type, the model files' check).
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

    /** The server's loaders: wagon types and the track bed under the rail styles. */
    public static final PackReport SERVER = new PackReport();
    /** This client's loaders: wagon models (with their sounds), rail styles and the checks on them. */
    public static final PackReport CLIENT = new PackReport();

    /** A loader; each replaces only its own part of the report. */
    public enum Source {
        /** {@code data/<ns>/wagon_types/} (server). */
        WAGON_TYPES("wagon_types"),
        /** The rail styles' tiles as the track bed reads them (server). */
        TRACK_BEDS("track_beds"),
        /** {@code assets/<ns>/wagon_models/} and their sounds (client). */
        WAGON_MODELS("wagon_models"),
        /** {@code assets/<ns>/rail_models/} as the client draws them. */
        RAIL_STYLES("rail_styles"),
        /** Models declared for no wagon type the server sent (client, after the sync). */
        MODEL_TYPES("model_types"),
        /** The models' OBJ, MTL, texture and animation files, checked on demand (client). */
        MODEL_FILES("model_files");

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
            .comparing((PackProblem p) -> !p.error())
            .thenComparing(PackProblem::pack)
            .thenComparing(PackProblem::file);

    private final Map<Source, Part> parts = new EnumMap<>(Source.class);

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
        return (int) parts.values().stream().flatMap(p -> p.problems().stream()).filter(PackProblem::error).count();
    }

    public synchronized int warnings() {
        return (int) parts.values().stream().flatMap(p -> p.problems().stream()).filter(p -> !p.error()).count();
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
}
