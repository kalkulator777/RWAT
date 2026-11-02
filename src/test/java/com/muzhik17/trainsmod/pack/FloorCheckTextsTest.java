package com.muzhik17.trainsmod.pack;

import static com.muzhik17.trainsmod.pack.ExamplePackLoadTest.move;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import com.muzhik17.trainsmod.kinematics.FloorCheck;
import com.muzhik17.trainsmod.stock.WagonType;

/**
 * What the floor check says of a type, word for word as the type loader
 * turns it into the log's and {@code /rwat packs}' warnings, held to what
 * it said before its findings got codes (editor plan §4.6, item 2): the
 * lines of {@link FloorCheck#problems} for every type of the example pack
 * and of the MVP pack, each as written and broken in the ways of {@link
 * #breaks} (a door moved, thickened, narrowed or made a gangway, a zone
 * narrowed or moved, a chair moved, the floor or the chairs taken away), and for the
 * broken copies {@link ExamplePackLoadTest} walks, against a summary of
 * what the check said of them then
 * ({@code src/test/resources/fixtures/floor_check_texts.json}: the type ids,
 * the breaks and the lines, nothing of the MVP's models but what the lines
 * say). The packs are read as the game reads them: each file through the
 * type loader, its markup in the OBJ frame.
 *
 * <p>The example pack is in the repository for good; the MVP pack until it
 * leaves it (roadmap R12): without it, its part is skipped, not passed. A
 * run that disagrees with the summary leaves what it found in
 * {@code build/floor_check_texts/<part>.json}; the summary is not rewritten
 * by a flag, because these lines are not meant to change.
 */
class FloorCheckTextsTest {

    private static final Path PACKS = Path.of("run/rwat_packs");
    private static final Path EXAMPLE = PACKS.resolve("RwatExamplePack");
    private static final Path MVP = PACKS.resolve("MatoiVanillaPack");
    private static final String SUMMARY = "/fixtures/floor_check_texts.json";
    private static final Path ACTUAL = Path.of("build/floor_check_texts");

    /** A type file to load: the type's id, where it comes from, its contents (a copy, maybe broken). */
    private record Case(String id, PackOrigin origin, JsonObject json) {
    }

    @Test
    void theExamplePacksTypesSayWhatTheySaid() throws IOException {
        assertTrue(Files.isDirectory(EXAMPLE), EXAMPLE + " is missing: python -I tools/gen_example_pack.py writes it");
        check("example", packCases(EXAMPLE, true));
    }

    @Test
    void theMvpTypesSayWhatTheySaid() throws IOException {
        assumeTrue(Files.isDirectory(MVP), "no MVP pack in " + MVP + " (roadmap R12): its types are not checked");
        check("mvp", packCases(MVP, false));
    }

    @Test
    void theBrokenCopiesExamplePackLoadTestWalksSayWhatTheySaid() throws IOException {
        Map<String, Case> cases = new LinkedHashMap<>();
        addBroken(cases, ExamplePackLoadTest.COACH, ExamplePackLoadTest.coachBreaks());
        addBroken(cases, ExamplePackLoadTest.SHUNTER, ExamplePackLoadTest.shunterBreaks());
        addBroken(cases, ExamplePackLoadTest.COACH, ExamplePackLoadTest.coachLeafBreaks());
        check("broken", cases);
    }

    private static void addBroken(Map<String, Case> cases, String id, Map<String, Consumer<JsonObject>> breaks)
            throws IOException {
        Path file = typeFile(EXAMPLE, id);
        for (Map.Entry<String, Consumer<JsonObject>> broken : breaks.entrySet()) {
            JsonObject json = read(file);
            broken.getValue().accept(json);
            cases.put(id + " / " + broken.getKey(), new Case(id, origin(EXAMPLE, file), json));
        }
    }

    /** Every type file of a pack folder, as written and broken in each of the ways of {@link #breaks}. */
    private static Map<String, Case> packCases(Path pack, boolean all) throws IOException {
        List<Path> files;
        try (Stream<Path> walk = Files.walk(pack)) {
            files = walk.filter(p -> pack.relativize(p).toString().replace('\\', '/')
                    .matches("data/[^/]+/wagon_types/[^/]+\\.json")).sorted().toList();
        }
        assertTrue(!files.isEmpty(), "no wagon types in " + pack);
        Map<String, Case> cases = new LinkedHashMap<>();
        for (Path file : files) {
            String namespace = file.getParent().getParent().getFileName().toString();
            String name = file.getFileName().toString();
            String id = namespace + ":" + name.substring(0, name.length() - ".json".length());
            cases.put(id, new Case(id, origin(pack, file), read(file)));
            for (Map.Entry<String, Consumer<JsonObject>> broken : breaks(read(file), all).entrySet()) {
                JsonObject json = read(file);
                broken.getValue().accept(json);
                cases.put(id + " / " + broken.getKey(), new Case(id, origin(pack, file), json));
            }
        }
        return cases;
    }

    /**
     * The ways a type file is broken here, by what it has: what → the change.
     * Places and sizes are the OBJ frame's (x along the car, y up, z
     * across); zones, doors and chairs are named by their index, not their
     * id. {@code all}: each zone and each door broken in every way, as for
     * the example pack; else (the MVP's types, many and large) the first
     * zone, and each door moved along the car.
     */
    static Map<String, Consumer<JsonObject>> breaks(JsonObject type, boolean all) {
        Map<String, Consumer<JsonObject>> breaks = new LinkedHashMap<>();
        int zones = type.has("interior") ? type.getAsJsonArray("interior").size() : 0;
        if (zones > 0) {
            breaks.put("no interior", t -> t.remove("interior"));
        }
        if (zones > 0 && all) {
            breaks.put("every zone 0.4 across", t -> t.getAsJsonArray("interior")
                    .forEach(zone -> squeeze(zone.getAsJsonObject(), 2, 0.4)));
        }
        for (int i = 0; i < (all ? zones : Math.min(zones, 1)); i++) {
            int z = i;
            breaks.put("zone " + z + " 0.4 across", t -> squeeze(element(t, "interior", z), 2, 0.4));
            breaks.put("zone " + z + " 2.0 aside", t -> move(element(t, "interior", z), 2, 2.0));
            breaks.put("zone " + z + " 1.0 along", t -> move(element(t, "interior", z), 0, 1.0));
        }
        if (type.has("cab")) {
            breaks.put("no chairs", t -> t.getAsJsonObject("cab").remove("seats"));
        }
        int doors = type.has("doors") ? type.getAsJsonArray("doors").size() : 0;
        for (int i = 0; i < doors; i++) {
            int d = i;
            breaks.put("door " + d + " 1.0 along", t -> move(element(t, "doors", d), 0, 1.0));
            if (!all) {
                continue;
            }
            breaks.put("door " + d + " 0.5 across", t -> move(element(t, "doors", d), 2, 0.5));
            // the box's thinner horizontal side is the door's thickness (WagonType.Door.axis)
            breaks.put("door " + d + " 0.8 thick", t -> squeeze(element(t, "doors", d),
                    thin(element(t, "doors", d)), 0.8));
            breaks.put("door " + d + " 0.15 wide", t -> squeeze(element(t, "doors", d),
                    2 - thin(element(t, "doors", d)), 0.15));
            breaks.put("door " + d + " a gangway", t -> element(t, "doors", d).addProperty("connecting", true));
        }
        int seats = type.has("cab") && type.getAsJsonObject("cab").has("seats")
                ? type.getAsJsonObject("cab").getAsJsonArray("seats").size() : 0;
        for (int i = 0; i < seats; i++) {
            int s = i;
            breaks.put("seat " + s + " 1.2 up", t -> move(seat(t, s), 1, 1.2));
            breaks.put("seat " + s + " 3.0 across", t -> move(seat(t, s), 2, 3.0));
        }
        return breaks;
    }

    /**
     * Load every case as the registry does and hold what the floor check
     * says of it to the summary's part {@code part}: the same cases, the same
     * lines in the same order, and the loader passing them on as they are.
     */
    private static void check(String part, Map<String, Case> cases) throws IOException {
        Map<String, List<String>> expected = summary(part);
        Map<String, List<String>> actual = new LinkedHashMap<>();
        List<String> wrong = new ArrayList<>();
        for (Map.Entry<String, Case> entry : cases.entrySet()) {
            Case c = entry.getValue();
            WagonTypeLoader.Result loaded = WagonTypeLoader.load(List.of(
                    new WagonTypeLoader.Declaration(c.id(), c.origin(), c.json())));
            WagonType type = loaded.types().get(c.id());
            assertNotNull(type, entry.getKey() + " isn't loaded: " + loaded.problems());
            List<String> lines = FloorCheck.problems(type);
            actual.put(entry.getKey(), lines);
            // the loader warns of each line as it is, after what the parser tolerated
            List<PackProblem> problems = loaded.problems();
            List<PackProblem> floor = problems.subList(problems.size() - lines.size(), problems.size());
            for (int i = 0; i < lines.size(); i++) {
                assertEquals(c.origin().warning(lines.get(i)), floor.get(i), entry.getKey());
            }
            if (!lines.equals(expected.get(entry.getKey()))) {
                wrong.add(entry.getKey() + ":\n    now  " + lines + "\n    was  " + expected.get(entry.getKey()));
            }
        }
        for (String name : expected.keySet()) {
            if (!cases.containsKey(name)) {
                wrong.add(name + ": in the summary, not checked");
            }
        }
        if (!wrong.isEmpty()) {
            Files.createDirectories(ACTUAL);
            Path out = ACTUAL.resolve(part + ".json");
            JsonObject json = new JsonObject();
            actual.forEach((name, lines) -> {
                JsonArray array = new JsonArray();
                lines.forEach(array::add);
                json.add(name, array);
            });
            Files.writeString(out, new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create().toJson(json)
                    + "\n", StandardCharsets.UTF_8);
            fail(wrong.size() + " of " + cases.size() + " cases say otherwise than the summary's '" + part
                    + "' (what they say now: " + out + "):\n  "
                    + String.join("\n  ", wrong.subList(0, Math.min(wrong.size(), 20))));
        }
    }

    /** The summary's part {@code part}: case → the lines, in order. */
    private static Map<String, List<String>> summary(String part) throws IOException {
        Map<String, List<String>> out = new LinkedHashMap<>();
        try (InputStream in = FloorCheckTextsTest.class.getResourceAsStream(SUMMARY)) {
            assertNotNull(in, SUMMARY + " is missing");
            JsonObject summary = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8))
                    .getAsJsonObject();
            if (!summary.has(part)) {
                return out;
            }
            for (Map.Entry<String, JsonElement> entry : summary.getAsJsonObject(part).entrySet()) {
                List<String> lines = new ArrayList<>();
                entry.getValue().getAsJsonArray().forEach(line -> lines.add(line.getAsString()));
                out.put(entry.getKey(), lines);
            }
        }
        return out;
    }

    private static Path typeFile(Path pack, String id) {
        int colon = id.indexOf(':');
        return pack.resolve("data").resolve(id.substring(0, colon)).resolve("wagon_types")
                .resolve(id.substring(colon + 1) + ".json");
    }

    private static PackOrigin origin(Path pack, Path file) {
        return new PackOrigin("rwat/" + pack.getFileName(), pack.relativize(file).toString().replace('\\', '/'));
    }

    private static JsonObject read(Path file) throws IOException {
        return JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject();
    }

    private static JsonObject element(JsonObject type, String key, int i) {
        return type.getAsJsonArray(key).get(i).getAsJsonObject();
    }

    private static JsonObject seat(JsonObject type, int i) {
        return type.getAsJsonObject("cab").getAsJsonArray("seats").get(i).getAsJsonObject();
    }

    /** OBJ axis 0 (x) or 2 (z): the thinner horizontal side of a box. */
    private static int thin(JsonObject box) {
        double x = coordinate(box, "max", 0) - coordinate(box, "min", 0);
        double z = coordinate(box, "max", 2) - coordinate(box, "min", 2);
        return z <= x ? 2 : 0;
    }

    private static double coordinate(JsonObject box, String key, int axis) {
        return box.getAsJsonArray(key).get(axis).getAsDouble();
    }

    /** A box made {@code size} along OBJ axis {@code axis}, about its middle. */
    private static void squeeze(JsonObject box, int axis, double size) {
        double middle = (coordinate(box, "min", axis) + coordinate(box, "max", axis)) / 2;
        box.getAsJsonArray("min").set(axis, new JsonPrimitive(middle - size / 2));
        box.getAsJsonArray("max").set(axis, new JsonPrimitive(middle + size / 2));
    }
}
