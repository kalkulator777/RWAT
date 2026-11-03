package com.muzhik17.trainsmod.pack;

import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.google.gson.JsonSyntaxException;

/**
 * Strict reading of the pack format's JSON, shared by every declaration
 * parser (wagon type, model, sounds, rail style). Each parser knows its keys
 * section by section; this class does the rest the same way everywhere:
 *
 * <ul>
 * <li>a key a section doesn't know is a <b>warning</b>, never an error, with
 *     the nearest known key as a hint ({@link #checkKeys}) — in a format where
 *     a missing field is the engine's default, a typo ({@code max_speed} for
 *     {@code max_speed_kmh}) would otherwise silently mean "no limit";</li>
 * <li>a JSON {@code null} or a value of the wrong type is an <b>error</b>
 *     naming the field and the type expected
 *     ({@code 'brakes.train_kn' must be a number, got null}), thrown as
 *     {@link JsonSyntaxException} like every other declaration error;</li>
 * <li>numbers must be finite (a lenient reader lets {@code NaN} through).</li>
 * </ul>
 *
 * <p>Fields are named by their dotted path in the file ({@code doors[2].min},
 * {@code sounds.idle.pitch}); {@code where} is the path of the object being
 * read, empty at the top level. GSON only, no MC types: the core parsers
 * ({@code stock.WagonTypeParser}) and their tests use it.
 *
 * <p>Ported: {@code editor/src/ports/packJson.ts}; golden: through
 * {@code fixtures/golden/wagon_type/}.
 */
public final class PackJson {

    private PackJson() {
    }

    /** A section's known keys, kept in the order given (the order hints are tried in). */
    public static Set<String> keys(String... keys) {
        return Collections.unmodifiableSet(new LinkedHashSet<>(List.of(keys)));
    }

    /** The path of {@code key} in the object at {@code where}. */
    public static String at(String where, String key) {
        return where.isEmpty() ? key : where + "." + key;
    }

    /** The path of element {@code index} of the array at {@code where}. */
    public static String at(String where, int index) {
        return where + "[" + index + "]";
    }

    /**
     * Warn about every key of {@code object} that {@code known} doesn't list:
     * {@code unknown key 'max_speed' (ignored) — did you mean 'max_speed_kmh'?}.
     */
    public static void checkKeys(JsonObject object, Set<String> known, String where, Consumer<String> warnings) {
        for (Map.Entry<String, JsonElement> entry : object.entrySet()) {
            String key = entry.getKey();
            if (known.contains(key)) {
                continue;
            }
            String hint = nearest(key, known);
            warnings.accept("unknown key '" + at(where, key) + "' (ignored)"
                    + (hint != null ? " — did you mean '" + at(where, hint) + "'?" : ""));
        }
    }

    /**
     * The known key {@code key} most likely is a typo of, or null if none is
     * close: the fewest edits (a swap of two neighbours counts as one), at
     * most about a third of the known key's length ({@code livery} →
     * {@code liveries}; a key of one or two letters only case aside); or one
     * contains the other, underscores aside ({@code max_speed} →
     * {@code max_speed_kmh}, {@code mass} → {@code mass_t}). Ties go to the
     * key listed first.
     */
    public static String nearest(String key, Collection<String> known) {
        String lower = key.toLowerCase(Locale.ROOT);
        String bare = bare(lower);
        String best = null;
        int bestDistance = Integer.MAX_VALUE;
        for (String candidate : known) {
            String other = candidate.toLowerCase(Locale.ROOT);
            String otherBare = bare(other);
            int distance = distance(lower, other);
            int allowed = other.length() <= 2 ? 0 : Math.max(1, (other.length() + 1) / 3);
            boolean close = distance <= allowed
                    || bare.length() >= 3 && otherBare.contains(bare)
                    || otherBare.length() >= 3 && bare.contains(otherBare);
            if (close && distance < bestDistance) {
                best = candidate;
                bestDistance = distance;
            }
        }
        return best;
    }

    private static String bare(String key) {
        return key.replace("_", "").replace("-", "").replace(" ", "");
    }

    /** Optimal string alignment distance: insertions, deletions, substitutions, neighbour swaps. */
    static int distance(String a, String b) {
        int[][] d = new int[a.length() + 1][b.length() + 1];
        for (int i = 0; i <= a.length(); i++) {
            d[i][0] = i;
        }
        for (int j = 0; j <= b.length(); j++) {
            d[0][j] = j;
        }
        for (int i = 1; i <= a.length(); i++) {
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                int best = Math.min(Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1), d[i - 1][j - 1] + cost);
                if (i > 1 && j > 1 && a.charAt(i - 1) == b.charAt(j - 2) && a.charAt(i - 2) == b.charAt(j - 1)) {
                    best = Math.min(best, d[i - 2][j - 2] + 1);
                }
                d[i][j] = best;
            }
        }
        return d[a.length()][b.length()];
    }

    // ---- values ----------------------------------------------------------------

    /** The object at {@code path}, or an error naming what is there instead. */
    public static JsonObject object(JsonElement element, String path) {
        if (element == null || !element.isJsonObject()) {
            throw wrongType(path, "an object", element);
        }
        return element.getAsJsonObject();
    }

    /** The array at {@code path}, or an error naming what is there instead. */
    public static JsonArray array(JsonElement element, String path) {
        if (element == null || !element.isJsonArray()) {
            throw wrongType(path, "an array", element);
        }
        return element.getAsJsonArray();
    }

    /** The finite number at {@code path}, or an error naming what is there instead. */
    public static double number(JsonElement element, String path) {
        if (element instanceof JsonPrimitive primitive && primitive.isNumber()) {
            double value = primitive.getAsDouble();
            if (Double.isFinite(value)) {
                return value;
            }
        }
        throw wrongType(path, "a finite number", element);
    }

    /** The string at {@code path}, or an error naming what is there instead. */
    public static String string(JsonElement element, String path) {
        if (element instanceof JsonPrimitive primitive && primitive.isString()) {
            return primitive.getAsString();
        }
        throw wrongType(path, "a string", element);
    }

    /** The {@code true}/{@code false} at {@code path}, or an error naming what is there instead. */
    public static boolean bool(JsonElement element, String path) {
        if (element instanceof JsonPrimitive primitive && primitive.isBoolean()) {
            return primitive.getAsBoolean();
        }
        throw wrongType(path, "true or false", element);
    }

    // ---- fields ----------------------------------------------------------------

    /** The value of a field that must be there (a {@code null} is there, and fails its type check). */
    public static JsonElement required(JsonObject object, String key, String where) {
        JsonElement element = object.get(key);
        if (element == null) {
            throw new JsonSyntaxException("missing required field '" + at(where, key) + "'");
        }
        return element;
    }

    public static double requiredNumber(JsonObject object, String key, String where) {
        return number(required(object, key, where), at(where, key));
    }

    /** A number field, {@code fallback} when absent. */
    public static double optionalNumber(JsonObject object, String key, String where, double fallback) {
        return object.has(key) ? number(object.get(key), at(where, key)) : fallback;
    }

    public static String requiredString(JsonObject object, String key, String where) {
        return string(required(object, key, where), at(where, key));
    }

    /** A string field, null when absent. */
    public static String optionalString(JsonObject object, String key, String where) {
        return object.has(key) ? string(object.get(key), at(where, key)) : null;
    }

    /** A {@code true}/{@code false} field, {@code fallback} when absent. */
    public static boolean optionalBool(JsonObject object, String key, String where, boolean fallback) {
        return object.has(key) ? bool(object.get(key), at(where, key)) : fallback;
    }

    public static JsonObject requiredObject(JsonObject object, String key, String where) {
        return object(required(object, key, where), at(where, key));
    }

    /** An object field, null when absent. */
    public static JsonObject optionalObject(JsonObject object, String key, String where) {
        return object.has(key) ? object(object.get(key), at(where, key)) : null;
    }

    public static JsonArray requiredArray(JsonObject object, String key, String where) {
        return array(required(object, key, where), at(where, key));
    }

    /** An array field, null when absent. */
    public static JsonArray optionalArray(JsonObject object, String key, String where) {
        return object.has(key) ? array(object.get(key), at(where, key)) : null;
    }

    /** {@code 'path' must be <expected>, got <what is there>}. */
    public static JsonSyntaxException wrongType(String path, String expected, JsonElement found) {
        return new JsonSyntaxException("'" + path + "' must be " + expected + ", got " + describe(found));
    }

    /** What a value is, for an error message: {@code null}, {@code the string "95"}, {@code an object}. */
    public static String describe(JsonElement element) {
        if (element == null) {
            return "nothing";
        }
        if (element.isJsonNull()) {
            return "null";
        }
        if (element.isJsonObject()) {
            return "an object";
        }
        if (element.isJsonArray()) {
            return "an array";
        }
        JsonPrimitive primitive = element.getAsJsonPrimitive();
        if (primitive.isBoolean()) {
            return primitive.getAsString();
        }
        if (primitive.isNumber()) {
            return "the number " + primitive.getAsString();
        }
        String text = primitive.getAsString();
        return "the string \"" + (text.length() > 40 ? text.substring(0, 40) + "…" : text) + "\"";
    }
}
