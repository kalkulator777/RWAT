package com.muzhik17.trainsmod.golden;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.joml.Matrix4f;
import org.junit.jupiter.api.DynamicContainer;
import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.DynamicTest;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;

/**
 * The shared part of the Java golden runners ({@code fixtures/golden/README.md}).
 * {@code fixtures/golden/<folder>/} holds one piece of logic the ports repeat:
 * {@code ports.json} names its reference and its ports, every other
 * {@code *.json} is a file of cases {@code {id, note, input | input_file,
 * expected}}. A runner ({@code <Logic>Golden}, one per folder) hands
 * {@link #run} what the engine makes of an input; each case becomes a test
 * named by its id, each file a container.
 *
 * <p>Java is the reference of every folder whose {@code ports.json} says so:
 * {@code ./gradlew test -Pgolden.update} (build.gradle passes it to the test
 * JVM as {@code golden.update}) rewrites the {@code expected} of each case
 * from what the code gives now and lays the files out anew; without it the
 * runner only compares, as JSON, exactly — the values are its own. The ports
 * compare with the file's {@code tolerance}.
 */
final class Golden {

    static final Path ROOT = Path.of("fixtures/golden");
    /** The only files a case may read by {@code input_file}: the example pack (CC0), never MVP. */
    static final String PACK_FILES = "run/rwat_packs/RwatExamplePack/";
    /** A case's id: stable, lower case, words by hyphens; unique in its folder. */
    static final Pattern ID = Pattern.compile("[a-z0-9]+(?:-[a-z0-9]+)*");
    /** The fewest cases a folder may have. */
    static final int MIN_CASES = 10;
    private static final Set<String> FILE_KEYS = Set.of("description", "frame", "tolerance", "cases");
    private static final Set<String> CASE_KEYS = Set.of("id", "note", "input", "input_file", "expected");
    private static final Set<String> FRAMES = Set.of("obj", "model", "none");
    /** The width an array or object is kept on one line within. */
    private static final int WIDTH = 110;
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    private Golden() {
    }

    /** What the engine makes of a case's input. */
    @FunctionalInterface
    interface Logic {
        JsonElement compute(JsonElement input) throws Exception;
    }

    static boolean updating() {
        return Boolean.getBoolean("golden.update");
    }

    /** The case files of a folder ({@code *.json} but {@code ports.json}), by name. */
    static List<Path> caseFiles(String folder) throws IOException {
        try (Stream<Path> files = Files.list(ROOT.resolve(folder))) {
            return files.filter(f -> f.getFileName().toString().endsWith(".json")
                    && !f.getFileName().toString().equals("ports.json")).sorted().toList();
        }
    }

    /** A folder's {@code ports.json}. */
    static JsonObject ports(String folder) throws IOException {
        return read(ROOT.resolve(folder).resolve("ports.json"));
    }

    /** True if {@code language} is the reference or a port of the folder. */
    static boolean reads(JsonObject ports, String language) {
        if (ports.get("reference").getAsString().equals(language)) {
            return true;
        }
        for (JsonElement port : ports.getAsJsonArray("ports")) {
            if (port.getAsString().equals(language)) {
                return true;
            }
        }
        return false;
    }

    static JsonObject read(Path file) throws IOException {
        return JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject();
    }

    /**
     * Every case of {@code folder}, as tests: checks (or, updating, rewrites)
     * each against what {@code logic} makes of its input.
     */
    static Stream<DynamicNode> run(String folder, Logic logic) throws IOException {
        assertTrue(reads(ports(folder), "java"), folder + "/ports.json doesn't name java");
        List<DynamicNode> files = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        int count = 0;
        for (Path file : caseFiles(folder)) {
            String name = folder + "/" + file.getFileName();
            JsonObject document = read(file);
            checkFile(name, document);
            List<DynamicTest> tests = new ArrayList<>();
            for (JsonElement element : document.getAsJsonArray("cases")) {
                JsonObject c = element.getAsJsonObject();
                String id = c.get("id").getAsString();
                assertTrue(ids.add(id), name + ": a second case " + id + " in " + folder);
                JsonElement actual;
                try {
                    actual = logic.compute(input(name, c));
                } catch (Exception | AssertionError e) {
                    tests.add(DynamicTest.dynamicTest(id, () -> {
                        throw new AssertionError(name + " " + id + ": " + e, e);
                    }));
                    continue;
                }
                if (updating()) {
                    c.add("expected", actual);
                }
                JsonElement expected = c.get("expected");
                tests.add(DynamicTest.dynamicTest(id, () -> assertEquals(expected, actual, name + " " + id
                        + " (if the change is meant: ./gradlew test -Pgolden.update)\n  expected "
                        + inline(expected) + "\n  but was  " + inline(actual))));
                count++;
            }
            if (updating()) {
                Files.writeString(file, write(document, 0) + "\n", StandardCharsets.UTF_8);
            }
            files.add(DynamicContainer.dynamicContainer(name, tests));
        }
        int cases = count;
        files.add(DynamicTest.dynamicTest(folder + " has enough cases",
                () -> assertTrue(cases >= MIN_CASES, folder + ": " + cases + " cases, at least " + MIN_CASES)));
        return files.stream();
    }

    /** The file's own keys and its cases' (the full format: fixtures/golden/schema.json). */
    private static void checkFile(String name, JsonObject document) {
        assertEquals(FILE_KEYS, document.keySet(), name + ": the keys of a case file");
        assertTrue(FRAMES.contains(document.get("frame").getAsString()), name + ": frame obj, model or none");
        assertTrue(document.get("tolerance").getAsDouble() >= 0.0, name + ": tolerance");
        for (JsonElement element : document.getAsJsonArray("cases")) {
            JsonObject c = element.getAsJsonObject();
            assertTrue(CASE_KEYS.containsAll(c.keySet()) && c.has("id") && c.has("note") && c.has("expected")
                    && (c.has("input") || c.has("input_file")), name + ": the keys of case " + c);
            assertTrue(ID.matcher(c.get("id").getAsString()).matches(), name + ": id " + c.get("id"));
        }
    }

    /**
     * A case's input: {@code input}, with what {@code input_file} reads. A
     * string names a file that is the whole input; an object, files that go
     * into the input under its keys. A {@code .json} file is read as JSON,
     * any other as its text.
     */
    static JsonElement input(String name, JsonObject c) throws IOException {
        JsonElement files = c.get("input_file");
        if (files == null) {
            return c.get("input");
        }
        if (files.isJsonPrimitive()) {
            assertTrue(!c.has("input"), name + " " + c.get("id") + ": input_file names the whole input");
            return packFile(files.getAsString());
        }
        JsonObject in = c.has("input") ? c.getAsJsonObject("input").deepCopy() : new JsonObject();
        for (Map.Entry<String, JsonElement> file : files.getAsJsonObject().entrySet()) {
            assertTrue(!in.has(file.getKey()), name + " " + c.get("id") + ": input has " + file.getKey());
            in.add(file.getKey(), packFile(file.getValue().getAsString()));
        }
        return in;
    }

    private static JsonElement packFile(String path) throws IOException {
        assertTrue(path.startsWith(PACK_FILES) && !path.contains("..") && !path.contains("\\"),
                path + ": a case reads only files of " + PACK_FILES);
        String text = Files.readString(Path.of(path), StandardCharsets.UTF_8);
        return path.endsWith(".json") ? JsonParser.parseString(text) : new JsonPrimitive(text);
    }

    // --- values: what the cases hold and what the runners give ---

    static JsonElement string(String s) {
        return s == null ? JsonNull.INSTANCE : new JsonPrimitive(s);
    }

    /** A number; NaN and the infinities, which JSON has no number for, as "NaN", "Infinity", "-Infinity". */
    static JsonElement number(double d) {
        if (Double.isNaN(d)) {
            return new JsonPrimitive("NaN");
        }
        if (Double.isInfinite(d)) {
            return new JsonPrimitive(d > 0 ? "Infinity" : "-Infinity");
        }
        return new JsonPrimitive(d + 0.0);
    }

    /** {@link #number(double)} with the sign of a zero kept: −0.0 is a text's {@code -0.00}. */
    static JsonElement signed(double d) {
        return d == 0.0 ? new JsonPrimitive(d) : number(d);
    }

    /** A float by its shortest decimal (0.6F is 0.6, not 0.6000000238418579): the float nearest it is it. */
    static JsonElement number(float f) {
        return Float.isFinite(f) ? new JsonPrimitive(Double.parseDouble(Float.toString(f + 0.0F))) : number((double) f);
    }

    /** A float by the exact value of its double (0.6F is 0.6000000238418579): for the float rules themselves. */
    static JsonElement exactFloat(float f) {
        return number((double) (f + 0.0F));
    }

    static JsonArray numbers(double... values) {
        JsonArray array = new JsonArray();
        for (double v : values) {
            array.add(number(v));
        }
        return array;
    }

    static JsonArray numbers(float... values) {
        JsonArray array = new JsonArray();
        for (float v : values) {
            array.add(number(v));
        }
        return array;
    }

    /** A number of a case: a JSON number, or "NaN", "Infinity", "-Infinity". */
    static double toDouble(JsonElement element) {
        if (element.isJsonPrimitive() && element.getAsJsonPrimitive().isString()) {
            return switch (element.getAsString()) {
                case "NaN" -> Double.NaN;
                case "Infinity" -> Double.POSITIVE_INFINITY;
                case "-Infinity" -> Double.NEGATIVE_INFINITY;
                default -> throw new IllegalArgumentException("no number: " + element);
            };
        }
        return element.getAsDouble();
    }

    static double[] doubles(JsonElement array) {
        JsonArray a = array.getAsJsonArray();
        double[] out = new double[a.size()];
        for (int i = 0; i < out.length; i++) {
            out[i] = toDouble(a.get(i));
        }
        return out;
    }

    static List<String> strings(JsonObject in, String key) {
        List<String> out = new ArrayList<>();
        if (in.has(key)) {
            in.getAsJsonArray(key).forEach(e -> out.add(e.getAsString()));
        }
        return out;
    }

    static boolean flag(JsonObject json, String key) {
        return json.has(key) && json.get(key).getAsBoolean();
    }

    /** A 4×4 as 16 floats, row by row (as an {@code .anim} writes a frame). */
    static JsonArray rowMajor(Matrix4f m) {
        return numbers(new Matrix4f(m).transpose().get(new float[16]));
    }

    /**
     * What the engine tells a pack author, as the editor shows it:
     * {@code {code, subject, index, params, text}}, of a message the engine
     * gives only the text of yet (the type reader's warnings and errors): the
     * other fields stay empty until it gives them, as the floor check does
     * ({@code FloorCheckGolden}).
     */
    static JsonObject finding(String text) {
        JsonObject out = new JsonObject();
        out.add("code", JsonNull.INSTANCE);
        out.add("subject", JsonNull.INSTANCE);
        out.add("index", JsonNull.INSTANCE);
        out.add("params", new JsonObject());
        out.addProperty("text", text);
        return out;
    }

    // --- writing: two-space indents, an array or object on one line while it fits ---

    private static String write(JsonElement element, int indent) {
        String flat = inline(element);
        if (!element.isJsonObject() && !element.isJsonArray()
                || indent + flat.length() <= WIDTH && !alwaysOpen(element)) {
            return flat;
        }
        String pad = " ".repeat(indent + 2);
        List<String> parts = new ArrayList<>();
        if (element.isJsonArray()) {
            for (JsonElement item : element.getAsJsonArray()) {
                parts.add(pad + write(item, indent + 2));
            }
            return parts.isEmpty() ? "[]" : "[\n" + String.join(",\n", parts) + "\n" + " ".repeat(indent) + "]";
        }
        for (Map.Entry<String, JsonElement> entry : element.getAsJsonObject().entrySet()) {
            parts.add(pad + GSON.toJson(entry.getKey()) + ": " + write(entry.getValue(), indent + 2));
        }
        return parts.isEmpty() ? "{}" : "{\n" + String.join(",\n", parts) + "\n" + " ".repeat(indent) + "}";
    }

    /** One line: ", " between items, ": " after keys. */
    static String inline(JsonElement element) {
        if (element == null) {
            return "(nothing)";
        }
        if (element.isJsonArray()) {
            List<String> items = new ArrayList<>();
            for (JsonElement item : element.getAsJsonArray()) {
                items.add(inline(item));
            }
            return "[" + String.join(", ", items) + "]";
        }
        if (element.isJsonObject()) {
            List<String> items = new ArrayList<>();
            for (Map.Entry<String, JsonElement> entry : element.getAsJsonObject().entrySet()) {
                items.add(GSON.toJson(entry.getKey()) + ": " + inline(entry.getValue()));
            }
            return "{" + String.join(", ", items) + "}";
        }
        return GSON.toJson(element);
    }

    /** The file itself, its list of cases and each case are written a key a line, so the cases stand apart. */
    private static boolean alwaysOpen(JsonElement element) {
        if (element.isJsonObject()) {
            JsonObject o = element.getAsJsonObject();
            return o.has("cases") || o.has("id") && o.has("expected");
        }
        if (element.isJsonArray()) {
            for (JsonElement item : element.getAsJsonArray()) {
                if (alwaysOpen(item)) {
                    return true;
                }
            }
        }
        return false;
    }
}
