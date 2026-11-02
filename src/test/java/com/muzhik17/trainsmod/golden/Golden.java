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
import java.util.function.Function;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;

/**
 * The shared golden data of {@code fixtures/golden/} (see its README): one file
 * per piece of logic the editor ports, an array of cases {@code {name, input,
 * expected}}. Java is the source of truth: run with {@code -Dgolden.update=true}
 * ({@code ./gradlew test -Dgolden.update=true}) a file's {@code expected} are
 * rewritten from what the code gives now; without it each must be equal.
 */
final class Golden {

    static final Path DIR = Path.of("fixtures/golden");
    /** The width an array or object is kept on one line within. */
    private static final int WIDTH = 110;
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    private Golden() {
    }

    static boolean updating() {
        return Boolean.getBoolean("golden.update");
    }

    /**
     * Checks (or, updating, rewrites) every case of {@code file}: {@code compute}
     * turns a case's {@code input} into what the code gives.
     */
    static void check(String file, Function<JsonObject, JsonElement> compute) throws IOException {
        Path path = DIR.resolve(file);
        JsonObject document = JsonParser.parseString(Files.readString(path, StandardCharsets.UTF_8)).getAsJsonObject();
        JsonArray cases = document.getAsJsonArray("cases");
        Set<String> names = new HashSet<>();
        List<String> failures = new ArrayList<>();
        for (JsonElement element : cases) {
            JsonObject c = element.getAsJsonObject();
            String name = c.get("name").getAsString();
            assertTrue(names.add(name), file + ": two cases named " + name);
            JsonElement actual;
            try {
                actual = compute.apply(c.getAsJsonObject("input"));
            } catch (RuntimeException e) {
                throw new AssertionError(file + " " + name + ": " + e, e);
            }
            if (updating()) {
                c.add("expected", actual);
            } else if (!actual.equals(c.get("expected"))) {
                failures.add(name + ":\n  expected " + c.get("expected") + "\n  but was  " + actual);
            }
        }
        if (updating()) {
            Files.writeString(path, write(document, 0) + "\n", StandardCharsets.UTF_8);
        }
        assertEquals("", String.join("\n", failures), file + " (rewrite with -Dgolden.update=true if the change is meant)");
        assertTrue(cases.size() >= 10, file + ": " + cases.size() + " cases");
    }

    // --- building values ---

    static JsonElement string(String s) {
        return s == null ? JsonNull.INSTANCE : new JsonPrimitive(s);
    }

    /** A number as JSON; NaN and the infinities (no JSON for them) as null. */
    static JsonElement number(double d) {
        return Double.isFinite(d) ? new JsonPrimitive(d + 0.0) : JsonNull.INSTANCE;
    }

    /** A float by its shortest decimal (0.6F is 0.6, not 0.6000000238418579). */
    static JsonElement number(float f) {
        return Float.isFinite(f) ? new JsonPrimitive(Double.parseDouble(Float.toString(f + 0.0F)))
                : JsonNull.INSTANCE;
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

    static double[] doubles(JsonElement array) {
        JsonArray a = array.getAsJsonArray();
        double[] out = new double[a.size()];
        for (int i = 0; i < out.length; i++) {
            out[i] = a.get(i).getAsDouble();
        }
        return out;
    }

    // --- writing: two-space indents, an array or object on one line while it fits ---

    private static String write(JsonElement element, int indent) {
        String flat = inline(element);
        if (!element.isJsonObject() && !element.isJsonArray() || indent + flat.length() <= WIDTH
                && !(element.isJsonObject() && element.getAsJsonObject().has("cases"))
                && !isCase(element)) {
            return flat;
        }
        String pad = " ".repeat(indent + 2);
        List<String> parts = new ArrayList<>();
        if (element.isJsonArray()) {
            for (JsonElement item : element.getAsJsonArray()) {
                parts.add(pad + write(item, indent + 2));
            }
            return "[\n" + String.join(",\n", parts) + "\n" + " ".repeat(indent) + "]";
        }
        for (Map.Entry<String, JsonElement> entry : element.getAsJsonObject().entrySet()) {
            parts.add(pad + GSON.toJson(entry.getKey()) + ": " + write(entry.getValue(), indent + 2));
        }
        return "{\n" + String.join(",\n", parts) + "\n" + " ".repeat(indent) + "}";
    }

    /** One line: ", " between items, ": " after keys. */
    private static String inline(JsonElement element) {
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

    /** A case is always written one key a line, so its input and expected stand apart. */
    private static boolean isCase(JsonElement element) {
        return element.isJsonObject() && element.getAsJsonObject().has("input")
                && element.getAsJsonObject().has("name");
    }
}
