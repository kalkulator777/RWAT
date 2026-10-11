package com.muzhik17.trainsmod.stock;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/**
 * The MVP recipe's doors and light names against the models, without the IR
 * packs (SPEC §8, §9.5, §9.6) — from the geometry digests and the per-type
 * override files, like {@link RecipeFloorTest}:
 * <ul>
 *   <li>a door leaf the model moves by name ({@code DOOR_<n>} with
 *       {@code ROT_}/{@code TL_}) must lie in one of the type's door boxes
 *       ({@link WagonType#doorHolding}), or it is drawn shut;</li>
 *   <li>a leaf an IR animation moves swings only if the door holding it is
 *       named after the animation's control group;</li>
 *   <li>a type's {@code "lights"} names only light groups its model has.</li>
 * </ul>
 */
class RecipeDoorsAndLightsTest {

    private static final Path RECIPE = Path.of("packs/mvp");
    private static final Path DIGESTS = RECIPE.resolve("geometry");
    private static final Pattern DOOR_KEY = Pattern.compile("(?:^|_)DOOR_(\\d+)(?=_|$)");

    @Test
    void doorHolding_findsTheDoorOfALeaf() {
        // ER2's left doorway (two sliding leaves, one door) and its gangway door
        WagonType.Door doorway = new WagonType.Door("DrL", 1.677, 1.471, 8.156, 1.756, 3.915, 9.431);
        WagonType.Door step = new WagonType.Door("step", 1.6, 1.0, 5.0, 1.7, 3.0, 6.0, false, true);
        WagonType.Door gangway = new WagonType.Door("door_13", -0.4, 1.949, 9.909, 0.397, 3.915, 9.962,
                false, false, true);
        WagonType type = new WagonType("mvp:er2t", 21.0, new double[]{1.0, -1.0}, 40.0, 100.0,
                WagonType.Resistance.NONE, null, null, WagonType.Brakes.NONE, null,
                List.of(step, doorway, gangway));
        assertEquals(1, type.doorHolding(1.729, 2.693, 9.112)); // DOOR_1, the +Z leaf
        assertEquals(1, type.doorHolding(1.729, 2.693, 8.475)); // DOOR_2, the other one
        assertEquals(2, type.doorHolding(0.0, 2.93, 9.94));     // the gangway leaf with its hinge
        assertEquals(-1, type.doorHolding(1.65, 2.0, 5.5));     // an opening has no leaf
        assertEquals(-1, type.doorHolding(0.0, 2.9, 0.0));      // nowhere near a door
        // the other left doorway opens with this one (one IR control group); a door alone never
        WagonType.Door other = new WagonType.Door("DrL_3", 1.677, 1.471, -9.425, 1.756, 3.915, -8.15,
                false, false, false, "DrL");
        WagonType.Door grouped = new WagonType.Door("DrL", 1.677, 1.471, 8.156, 1.756, 3.915, 9.431,
                false, false, false, "DrL");
        assertTrue(grouped.groupedWith(other));
        assertTrue(!doorway.groupedWith(gangway) && !gangway.groupedWith(gangway));
        assertEquals("DrL", other.inFrame(true).group());
    }

    @Test
    void doorsWorkedBy_theGroupsDoors_caseAside() {
        WagonType.Door left = new WagonType.Door("DrL", 1.677, 1.471, 8.156, 1.756, 3.915, 9.431,
                false, false, false, "DrL");
        WagonType.Door left3 = new WagonType.Door("DrL_3", 1.677, 1.471, -9.425, 1.756, 3.915, -8.15,
                false, false, false, "DrL");
        WagonType.Door alone = new WagonType.Door("Trap1", -0.4, 1.9, 11.4, 0.4, 3.9, 11.5, false, false, true);
        WagonType.Door step = new WagonType.Door("DrR", -1.7, 1.0, 5.0, -1.6, 3.0, 6.0, false, true);
        WagonType type = new WagonType("mvp:test", 21.0, new double[]{1.0, -1.0}, 40.0, 100.0,
                WagonType.Resistance.NONE, null, null, WagonType.Brakes.NONE, null,
                List.of(left, alone, left3, step));
        assertEquals(0b101, type.doorsWorkedBy("DrL"));
        assertEquals(0b010, type.doorsWorkedBy("trap1")); // named after the group, as animations match
        assertEquals(0, type.doorsWorkedBy("DrR"));       // a doorway without a leaf isn't worked
        assertEquals(0, type.doorsWorkedBy("IL"));
    }

    /** ER2's head-car switches {@code CG_DrL_GLOBAL}/{@code CG_DrR_GLOBAL}, DR1's {@code DL}/{@code DR}: both doorways of a side, in every car. */
    @Test
    void cabDoorSwitches_workBothDoorwaysOfTheirSide() throws IOException {
        assumeTrue(Files.isDirectory(DIGESTS), "no geometry digests in " + DIGESTS);
        String[][] cases = {{"er2h", "DrL", "DrR"}, {"er2h_reversed", "DrL", "DrR"}, {"er2m", "DrL", "DrR"},
                {"er2t", "DrL", "DrR"}, {"dr1a_motorhead", "DL", "DR"}, {"dr1a_trailed", "DL", "DR"}};
        for (String[] c : cases) {
            Path overridePath = RECIPE.resolve(c[0] + ".json");
            JsonObject override = Files.exists(overridePath) ? read(overridePath) : new JsonObject();
            JsonObject recipeType = override.has("type") ? override.getAsJsonObject("type") : new JsonObject();
            WagonType type = WagonTypeParser.parse("mvp:" + c[0],
                    RecipeFloorTest.effective(read(DIGESTS.resolve(c[0] + ".json")), recipeType));
            for (int side = 1; side <= 2; side++) {
                assertEquals(2, Integer.bitCount(type.doorsWorkedBy(c[side])), c[0] + " " + c[side]);
            }
        }
    }

    @TestFactory
    Stream<DynamicTest> everyDoorLeafHasItsDoor() throws IOException {
        return perType((stem, digest, override) -> {
            JsonObject recipeType = override.has("type") ? override.getAsJsonObject("type") : new JsonObject();
            WagonType type = WagonTypeParser.parse("mvp:" + stem, RecipeFloorTest.effective(digest, recipeType));
            List<String> problems = new ArrayList<>();
            if (type.doors().isEmpty() || !digest.has("door_motion")) {
                return problems; // no walkable floor (yet): nothing opens
            }
            JsonObject objects = digest.getAsJsonObject("objects");
            for (Map.Entry<String, JsonElement> entry : digest.getAsJsonObject("door_motion").entrySet()) {
                JsonObject motion = entry.getValue().getAsJsonObject();
                String moves = motion.get("moves").getAsString();
                if (moves.equals("none")) {
                    continue;
                }
                double[] c = leafCentre(objects, entry.getKey());
                if (c == null) {
                    continue;
                }
                int door = type.doorHolding(c[0], c[1], c[2]);
                if (!moves.equals("anim") && door < 0) {
                    problems.add(String.format(Locale.ROOT,
                            "%s (%s) lies in no door's box, centre (%.2f, %.2f, %.2f): it is drawn shut",
                            entry.getKey(), moves, c[0], c[1], c[2]));
                }
                String group = motion.get("group").isJsonNull() ? null : motion.get("group").getAsString();
                if (moves.equals("anim") && door >= 0 && !animatedWith(type, type.doors().get(door), group)) {
                    problems.add(entry.getKey() + " is animated by group " + group + " but its door is named '"
                            + type.doors().get(door).id() + "': name the door " + group + ", or give it"
                            + " \"group\": \"" + group + "\" next to a door named so, or it is drawn shut");
                }
            }
            return problems;
        });
    }

    @TestFactory
    Stream<DynamicTest> lightNamesNameTheModelsGroups() throws IOException {
        return perType((stem, digest, override) -> {
            List<String> problems = new ArrayList<>();
            if (!override.has("lights")) {
                return problems;
            }
            JsonObject groups = digest.has("lights") ? digest.getAsJsonObject("lights") : new JsonObject();
            for (Map.Entry<String, JsonElement> entry : override.getAsJsonObject("lights").entrySet()) {
                if (!groups.has(entry.getKey())) {
                    problems.add("\"lights\" names " + entry.getKey() + ", the model's light groups are "
                            + groups.keySet());
                }
                if (!entry.getValue().isJsonObject()) {
                    problems.add(entry.getKey() + ": a name is {\"en_us\": \"…\", \"ru_ru\": \"…\"}");
                    continue;
                }
                for (Map.Entry<String, JsonElement> name : entry.getValue().getAsJsonObject().entrySet()) {
                    if (!name.getKey().matches("[a-z]{2}_[a-z]{2}") || !name.getValue().isJsonPrimitive()
                            || name.getValue().getAsString().isBlank()) {
                        problems.add(entry.getKey() + ": bad name " + name);
                    }
                }
            }
            return problems;
        });
    }

    /**
     * True if the IR animation of {@code group} plays whenever {@code door}
     * opens: the animation is driven by the door named after it, and this
     * door is that one or opens with it.
     */
    private static boolean animatedWith(WagonType type, WagonType.Door door, String group) {
        for (WagonType.Door named : type.doors()) {
            if (named.id().equalsIgnoreCase(group) && (named == door || named.groupedWith(door))) {
                return true;
            }
        }
        return false;
    }

    /** The centre of every object of {@code DOOR_<n>} together (the leaf the engine builds), or null. */
    private static double[] leafCentre(JsonObject objects, String key) {
        double[] box = {Double.MAX_VALUE, Double.MAX_VALUE, Double.MAX_VALUE,
                -Double.MAX_VALUE, -Double.MAX_VALUE, -Double.MAX_VALUE};
        boolean any = false;
        for (Map.Entry<String, JsonElement> object : objects.entrySet()) {
            Matcher m = DOOR_KEY.matcher(object.getKey());
            if (object.getKey().contains("HIDE") || !m.find() || !key.equals("DOOR_" + m.group(1))) {
                continue;
            }
            JsonArray b = object.getValue().getAsJsonArray();
            for (int i = 0; i < 3; i++) {
                box[i] = Math.min(box[i], b.get(i).getAsDouble());
                box[i + 3] = Math.max(box[i + 3], b.get(i + 3).getAsDouble());
            }
            any = true;
        }
        return any ? new double[]{(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2} : null;
    }

    private interface Check {
        List<String> problems(String stem, JsonObject digest, JsonObject override) throws IOException;
    }

    private static Stream<DynamicTest> perType(Check check) throws IOException {
        assumeTrue(Files.isDirectory(DIGESTS), "no geometry digests in " + DIGESTS);
        List<Path> digests;
        try (Stream<Path> files = Files.list(DIGESTS)) {
            digests = files.filter(p -> p.toString().endsWith(".json")).sorted().toList();
        }
        return digests.stream().map(path -> {
            String stem = path.getFileName().toString().replace(".json", "");
            return DynamicTest.dynamicTest("mvp:" + stem, () -> {
                Path overridePath = RECIPE.resolve(stem + ".json");
                JsonObject override = Files.exists(overridePath) ? read(overridePath) : new JsonObject();
                List<String> problems = check.problems(stem, read(path), override);
                assertTrue(problems.isEmpty(), "mvp:" + stem + ":\n  " + String.join("\n  ", problems));
            });
        });
    }

    private static JsonObject read(Path path) throws IOException {
        return JsonParser.parseString(Files.readString(path, StandardCharsets.UTF_8)).getAsJsonObject();
    }
}
