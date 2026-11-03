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
 * from what the code gives now, and nothing else: each value is laid out
 * anew in its place ({@link #withExpected}), while the rest of the file —
 * the inputs with their numbers as written ({@code 2.5e1}), the notes, the
 * layout — stays as it is, byte for byte. Without the flag the runner only
 * compares, as JSON, exactly — the values are its own. The ports compare
 * with the file's {@code tolerance}.
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
        return caseFiles(ROOT.resolve(folder));
    }

    private static List<Path> caseFiles(Path dir) throws IOException {
        try (Stream<Path> files = Files.list(dir)) {
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
        return run(ROOT, folder, logic, updating());
    }

    /**
     * {@link #run(String, Logic)} on the folders under {@code root}; with
     * {@code update}, each file's {@code expected} are rewritten from
     * {@code logic} ({@link #withExpected}) — a case whose logic fails keeps
     * its own.
     */
    static Stream<DynamicNode> run(Path root, String folder, Logic logic, boolean update) throws IOException {
        Path dir = root.resolve(folder);
        assertTrue(reads(read(dir.resolve("ports.json")), "java"), folder + "/ports.json doesn't name java");
        List<DynamicNode> files = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        int count = 0;
        for (Path file : caseFiles(dir)) {
            String name = folder + "/" + file.getFileName();
            String text = Files.readString(file, StandardCharsets.UTF_8);
            JsonObject document = JsonParser.parseString(text).getAsJsonObject();
            checkFile(name, document);
            List<DynamicTest> tests = new ArrayList<>();
            List<JsonElement> written = new ArrayList<>();
            for (JsonElement element : document.getAsJsonArray("cases")) {
                JsonObject c = element.getAsJsonObject();
                String id = c.get("id").getAsString();
                assertTrue(ids.add(id), name + ": a second case " + id + " in " + folder);
                JsonElement actual;
                try {
                    actual = logic.compute(input(name, c));
                } catch (Exception | AssertionError e) {
                    written.add(null);
                    tests.add(DynamicTest.dynamicTest(id, () -> {
                        throw new AssertionError(name + " " + id + ": " + e, e);
                    }));
                    continue;
                }
                written.add(actual);
                JsonElement expected = update ? actual : c.get("expected");
                tests.add(DynamicTest.dynamicTest(id, () -> assertEquals(expected, actual, name + " " + id
                        + " (if the change is meant: ./gradlew test -Pgolden.update)\n  expected "
                        + inline(expected) + "\n  but was  " + inline(actual))));
                count++;
            }
            if (update) {
                String updated = withExpected(text, written);
                if (!updated.equals(text)) {
                    Files.writeString(file, updated, StandardCharsets.UTF_8);
                }
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

    // --- updating: only the expected of each case changes in the file's text ---

    /**
     * The text of a case file with the {@code expected} of each case replaced
     * by {@code expected} (one per case, in order; null keeps the case's own),
     * laid out as {@link #write} lays a value, indented as its key; everything
     * else in the text stays as it was, byte for byte — an input's numbers as
     * written ({@code 2.5e1}), its escapes, its line breaks.
     */
    static String withExpected(String text, List<JsonElement> expected) {
        List<int[]> spans = new Spans(text).expectedOfCases();
        if (spans.size() != expected.size()) {
            throw new IllegalArgumentException(spans.size() + " cases with an expected in the text, " + expected.size() + " given");
        }
        StringBuilder out = new StringBuilder(text);
        for (int i = spans.size() - 1; i >= 0; i--) {
            JsonElement value = expected.get(i);
            if (value != null) {
                int[] span = spans.get(i);
                out.replace(span[0], span[1], write(value, span[2]));
            }
        }
        return out.toString();
    }

    /**
     * Where the {@code expected} of each case lies in the text of a case file:
     * {@code [start, end, column of the key]} per case, in order. A reader of
     * JSON that keeps places, not values.
     */
    private static final class Spans {

        private final String text;
        private int at;

        Spans(String text) {
            this.text = text;
        }

        List<int[]> expectedOfCases() {
            List<int[]> spans = new ArrayList<>();
            members((key, keyStart) -> {
                if (!key.equals("cases")) {
                    value();
                    return;
                }
                elements(() -> members((caseKey, caseKeyStart) -> {
                    if (!caseKey.equals("expected")) {
                        value();
                        return;
                    }
                    int start = at;
                    value();
                    spans.add(new int[] {start, at, caseKeyStart - (text.lastIndexOf('\n', caseKeyStart) + 1)});
                }));
            });
            blank();
            if (at != text.length()) {
                throw error("text after the file's object");
            }
            return spans;
        }

        private interface Member {
            void read(String key, int keyStart);
        }

        /** An object at {@code at}: each member's key to {@code member}, which reads its value. */
        private void members(Member member) {
            blank();
            expect('{');
            blank();
            if (peek() == '}') {
                at++;
                return;
            }
            while (true) {
                blank();
                int keyStart = at;
                String key = JsonParser.parseString(text.substring(keyStart, skipString())).getAsString();
                blank();
                expect(':');
                blank();
                member.read(key, keyStart);
                blank();
                if (peek() == ',') {
                    at++;
                    continue;
                }
                expect('}');
                return;
            }
        }

        /** An array at {@code at}: {@code element} reads each element. */
        private void elements(Runnable element) {
            blank();
            expect('[');
            blank();
            if (peek() == ']') {
                at++;
                return;
            }
            while (true) {
                blank();
                element.run();
                blank();
                if (peek() == ',') {
                    at++;
                    continue;
                }
                expect(']');
                return;
            }
        }

        /** Past any value at {@code at}. */
        private void value() {
            blank();
            char c = peek();
            if (c == '{') {
                members((key, keyStart) -> value());
            } else if (c == '[') {
                elements(this::value);
            } else if (c == '"') {
                skipString();
            } else {
                int start = at;
                while (at < text.length() && "{}[],: \t\r\n\"".indexOf(text.charAt(at)) < 0) {
                    at++;
                }
                if (at == start) {
                    throw error("no value");
                }
            }
        }

        /** Past the string at {@code at}; its end. */
        private int skipString() {
            expect('"');
            while (at < text.length() && text.charAt(at) != '"') {
                at += text.charAt(at) == '\\' ? 2 : 1;
            }
            expect('"');
            return at;
        }

        private void blank() {
            while (at < text.length() && " \t\r\n".indexOf(text.charAt(at)) >= 0) {
                at++;
            }
        }

        private char peek() {
            if (at >= text.length()) {
                throw error("the text ends");
            }
            return text.charAt(at);
        }

        private void expect(char c) {
            if (peek() != c) {
                throw error("'" + c + "' expected");
            }
            at++;
        }

        private IllegalArgumentException error(String what) {
            return new IllegalArgumentException("case file, at " + at + ": " + what);
        }
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
