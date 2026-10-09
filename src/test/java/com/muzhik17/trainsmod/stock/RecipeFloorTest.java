package com.muzhik17.trainsmod.stock;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.muzhik17.trainsmod.kinematics.FloorCheck;

/**
 * The MVP recipe's walkable floors, checked without the IR packs (SPEC §9.6):
 * each type's geometry digest ({@code packs/mvp/geometry/<id>.json}, written
 * by {@code tools/ir2rwat.py --geometry}) plus its override file
 * ({@code packs/mvp/<id>.json}) give the floor, doors and chair the converter
 * would write — interior: the override's, else the one derived from IR's
 * passenger area; doors: the override's, else (with a floor) the model's
 * EXTERNAL/CONNECTING doors; cab: the override's, else an empty cab for a
 * locomotive — and {@link FloorCheck} must find nothing wrong. Where the IR
 * packs are at hand, {@link PackFloorTest} checks the generated pack itself.
 */
class RecipeFloorTest {

    private static final Path RECIPE = Path.of("packs/mvp");
    private static final Path DIGESTS = RECIPE.resolve("geometry");

    @TestFactory
    Stream<DynamicTest> everyRecipeFloorIsWalkable() throws IOException {
        assumeTrue(Files.isDirectory(DIGESTS), "no geometry digests in " + DIGESTS);
        List<Path> digests;
        try (Stream<Path> files = Files.list(DIGESTS)) {
            digests = files.filter(p -> p.toString().endsWith(".json")).sorted().toList();
        }
        return digests.stream().map(path -> {
            String stem = path.getFileName().toString().replace(".json", "");
            return DynamicTest.dynamicTest("mvp:" + stem, () -> {
                JsonObject digest = read(path);
                Path overridePath = RECIPE.resolve(stem + ".json");
                JsonObject override = Files.exists(overridePath) && read(overridePath).has("type")
                        ? read(overridePath).getAsJsonObject("type") : new JsonObject();
                WagonType type = WagonTypeParser.parse("mvp:" + stem, effective(digest, override));
                List<String> problems = FloorCheck.problems(type);
                assertTrue(problems.isEmpty(), "mvp:" + stem + ":\n  " + String.join("\n  ", problems));
            });
        });
    }

    /** The floor, doors and cab ir2rwat would write, on stub physics. */
    static JsonObject effective(JsonObject digest, JsonObject override) {
        JsonObject type = new JsonObject();
        type.addProperty("length", digest.get("length").getAsDouble());
        JsonArray bogies = new JsonArray();
        bogies.add(1.0);
        bogies.add(-1.0);
        type.add("bogies", bogies);
        type.addProperty("mass_t", 40.0);
        type.addProperty("max_speed_kmh", 100.0);
        JsonObject derived = digest.getAsJsonObject("derived");
        JsonElement interior = present(override, "interior") ? override.get("interior")
                : present(derived, "interior") ? derived.get("interior") : null;
        if (interior != null) {
            type.add("interior", interior);
        }
        if (present(override, "doors")) {
            type.add("doors", override.get("doors"));
        } else if (interior != null) {
            type.add("doors", digest.get("doors_in_model"));
        }
        if (present(override, "cab")) {
            type.add("cab", override.get("cab"));
        } else if (!override.has("cab") && "locomotives".equals(digest.get("category").getAsString())) {
            type.add("cab", new JsonObject());
        }
        return type;
    }

    private static boolean present(JsonObject json, String key) {
        return json.has(key) && !json.get(key).isJsonNull();
    }

    private static JsonObject read(Path path) throws IOException {
        return JsonParser.parseString(Files.readString(path, StandardCharsets.UTF_8)).getAsJsonObject();
    }
}
