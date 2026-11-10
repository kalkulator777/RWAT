package com.muzhik17.trainsmod.pack;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import com.google.gson.JsonElement;
import com.muzhik17.trainsmod.kinematics.FloorCheck;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypeParser;

/**
 * The wagon types of a set of packs, as the registry and the report get them
 * (SPEC §5.5 step 5, §6.4): each {@code data/<ns>/wagon_types/<id>.json}
 * parsed ({@link WagonTypeParser}), its aliases resolved, its problems kept
 * by pack and file. The server's reload listener feeds it the files; tests
 * feed it the generated packs.
 *
 * <ul>
 * <li>A file loads <b>whole or not at all</b>: the type and its
 *     {@code aliases} are read together, and either failing skips the file —
 *     a broken alias list no longer leaves its type loaded without it.</li>
 * <li>Types are taken in id order, so the outcome never depends on the
 *     order the packs listed their files in. An alias two types claim goes
 *     to the lower id, and both files get an error naming the other; an
 *     alias that is itself a loaded type's id is refused.</li>
 * <li>What the parser tolerated (unknown keys, reserved fields) and what
 *     {@link FloorCheck} finds in the floor are warnings: the type loads.</li>
 * </ul>
 *
 * <p>Plain Java, no MC types.
 */
public final class WagonTypeLoader {

    private WagonTypeLoader() {
    }

    /**
     * One wagon type file.
     *
     * @param id     the type id, {@code <ns>:<id>} from the file's location
     * @param origin the pack and the file, for the report
     * @param json   the file's contents
     */
    public record Declaration(String id, PackOrigin origin, JsonElement json) {
    }

    /**
     * What the files gave.
     *
     * @param types    id → type, the files that loaded, in id order
     * @param aliases  old id → the type id that took it over
     * @param problems what the files got wrong
     * @param loaded   pack → types it gave
     */
    public record Result(Map<String, WagonType> types, Map<String, String> aliases,
            List<PackProblem> problems, Map<String, Integer> loaded) {
    }

    /** Parse every file and resolve the aliases. */
    public static Result load(Collection<Declaration> declarations) {
        List<Declaration> sorted = new ArrayList<>(declarations);
        sorted.sort(Comparator.comparing(Declaration::id));
        Map<String, WagonType> types = new LinkedHashMap<>();
        Map<String, List<String>> declaredAliases = new LinkedHashMap<>();
        Map<String, PackOrigin> origins = new HashMap<>();
        List<PackProblem> problems = new ArrayList<>();
        Map<String, Integer> loaded = new TreeMap<>();
        for (Declaration declaration : sorted) {
            PackOrigin origin = declaration.origin();
            List<String> warnings = new ArrayList<>();
            WagonType type;
            List<String> aliases;
            try {
                if (declaration.json() == null || !declaration.json().isJsonObject()) {
                    throw new IllegalArgumentException("the file must be a JSON object {…}, got "
                            + PackJson.describe(declaration.json()));
                }
                type = WagonTypeParser.parse(declaration.id(), declaration.json().getAsJsonObject(), warnings::add);
                aliases = WagonTypeParser.aliases(declaration.json().getAsJsonObject());
            } catch (RuntimeException e) {
                problems.add(origin.error("wagon type " + declaration.id() + " not loaded: " + message(e)));
                continue;
            }
            types.put(declaration.id(), type);
            declaredAliases.put(declaration.id(), aliases);
            origins.put(declaration.id(), origin);
            loaded.merge(origin.pack(), 1, Integer::sum);
            warnings.forEach(warning -> problems.add(origin.warning(warning)));
            // a floor nobody can walk is a pack bug, not a crash: say so (SPEC §9.6)
            FloorCheck.problems(type).forEach(problem -> problems.add(origin.warning(problem)));
        }
        return new Result(types, aliases(declaredAliases, types.keySet(), origins, problems), problems, loaded);
    }

    /** Old id → type id; the lower type id wins a contested alias, both sides told. */
    private static Map<String, String> aliases(Map<String, List<String>> declared, Set<String> typeIds,
            Map<String, PackOrigin> origins, List<PackProblem> problems) {
        Map<String, String> table = new LinkedHashMap<>();
        declared.forEach((id, oldIds) -> {
            PackOrigin origin = origins.get(id);
            Set<String> seen = new HashSet<>();
            for (String oldId : oldIds) {
                if (!seen.add(oldId)) {
                    problems.add(origin.warning("alias '" + oldId + "' is listed twice"));
                } else if (typeIds.contains(oldId)) {
                    problems.add(origin.error("alias '" + oldId + "' is the id of a loaded wagon type, ignored"));
                } else if (table.containsKey(oldId)) {
                    String owner = table.get(oldId);
                    problems.add(origin.error("alias '" + oldId + "' is also claimed by wagon type " + owner
                            + ", which keeps it (the lower id): ignored here"));
                    problems.add(origins.get(owner).error("alias '" + oldId + "' is also claimed by wagon type "
                            + id + ": this type keeps it (the lower id)"));
                } else {
                    table.put(oldId, id);
                }
            }
        });
        return table;
    }

    private static String message(RuntimeException e) {
        return e.getMessage() != null ? e.getMessage() : e.toString();
    }
}
