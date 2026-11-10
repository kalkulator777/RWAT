package com.muzhik17.trainsmod.client.render.model;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonSyntaxException;
import com.muzhik17.trainsmod.client.sound.SoundSet;
import com.muzhik17.trainsmod.pack.PackJson;

/**
 * The client half of a stock declaration (SPEC §6.3): which OBJ draws a wagon
 * type and how — read from {@code assets/<ns>/wagon_models/<name>.json}, the
 * model of type {@code <ns>:<name>}:
 *
 * <pre>{@code
 * {
 *   "obj": "stock/rolling_stock/locomotives/mvp_ir_chme3/mvp_ir_chme3.obj",
 *   "bogies": [4.44, -4.44],
 *   "skip": ["WIPER_"],
 *   "animations": { "door1": "stock/.../anim/mvp_ir_amendorf_door1.anim" },
 *   "liveries": { "leader_770": "l_leader_770" },
 *   "handbrake": ["WIDGET_5"],
 *   "sounds": { "idle": "stock/sounds/diesel/mvp_chme3/idle.ogg", … },
 *   "sway": 0.7
 * }
 * }</pre>
 *
 * <p>Asset paths without a namespace are in the declaring pack's namespace.
 * Paths stay strings ({@code ns:path}) — GSON only, no MC types, so the
 * parser is unit-testable; the loader turns them into resource locations.
 * The keys are {@link #KEYS}; one the format doesn't know is a warning, a
 * {@code null} or a wrongly typed value an error ({@link PackJson}).
 *
 * @param obj        the model, {@code ns:path}
 * @param bogies     bogie pivot offsets in the OBJ, +forward, front first;
 *                   null = measured from the {@code BOGEY_*} meshes
 * @param skip       extra object-name prefixes left out of the render (on top
 *                   of the convention's {@code HIDE}/{@code CARGO_FILL})
 * @param animations animated group → its IR {@code .anim} ({@code ns:path});
 *                   the group id (lower case) matches a door id of the type;
 *                   in the file's order
 * @param liveries   livery id → folder next to the OBJ whose same-named
 *                   textures replace the base ones; in the file's order
 * @param handbrake  controls ({@code <KIND>_<n>} keys) that are the wagon's
 *                   handbrake wheel (SPEC §5.3): a click turns the handbrake,
 *                   the wheel shows it — e.g. MVP's {@code WIDGET}s labelled
 *                   "Hand Brake"; an object named {@code HANDBRAKE_<n>} needs
 *                   no entry
 * @param sounds     engine, horns, wheels, joints, doors and controls (SPEC §10);
 *                   {@link SoundSet#NONE} if the pack gives none
 * @param sway       how hard this type's body rocks on its springs, on top of
 *                   the client's {@code swayStrength} (SPEC §10.2): 1 = as
 *                   designed, 0 = never, up to {@link #MAX_SWAY}
 */
public record WagonModelDecl(
        String obj,
        double[] bogies,
        List<String> skip,
        Map<String, String> animations,
        Map<String, String> liveries,
        List<String> handbrake,
        SoundSet sounds,
        double sway) {

    /** The most a type may scale its rocking by (as much as the client setting allows). */
    public static final double MAX_SWAY = 3.0;

    /** The keys of a model declaration's top level ({@code sounds} has its own, {@link SoundSet#KEYS}). */
    public static final Set<String> KEYS = PackJson.keys("obj", "bogies", "skip", "animations", "liveries",
            "handbrake", "sounds", "sway");

    public WagonModelDecl {
        skip = List.copyOf(skip);
        animations = ordered(animations);
        liveries = ordered(liveries);
        handbrake = List.copyOf(handbrake);
    }

    /**
     * An unmodifiable copy in the order given — the file's — where {@link
     * Map#copyOf} keeps none: what is said of the animations and liveries
     * ({@code ModelCheck}) comes in the order the author wrote them, and of
     * two animations that move one object the later in the file wins
     * ({@code IrStockModel.loadAnimations}), every time. No nulls, as there.
     */
    private static Map<String, String> ordered(Map<String, String> map) {
        Map<String, String> copy = new LinkedHashMap<>();
        map.forEach((key, value) -> copy.put(Objects.requireNonNull(key), Objects.requireNonNull(value)));
        return Collections.unmodifiableMap(copy);
    }

    /** {@link #parse(String, JsonObject, Consumer)} with the warnings dropped. */
    public static WagonModelDecl parse(String namespace, JsonObject json) {
        return parse(namespace, json, warning -> {
        });
    }

    /**
     * Parse one declaration, strictly ({@link PackJson}): a key the format
     * doesn't know ({@link #KEYS}, {@link SoundSet#KEYS}…) is a warning with
     * the nearest known one as a hint; a {@code null} or a wrongly typed
     * value is an error naming the field.
     *
     * @param namespace the declaring file's namespace, for unqualified paths
     * @param warnings  told what the declaration says that means nothing
     * @throws JsonSyntaxException on a missing {@code obj}, a {@code null} or
     *                             wrongly typed value
     */
    public static WagonModelDecl parse(String namespace, JsonObject json, Consumer<String> warnings) {
        PackJson.checkKeys(json, KEYS, "", warnings);
        String path = PackJson.requiredString(json, "obj", "");
        if (path.isEmpty()) {
            throw new JsonSyntaxException("'obj' is empty");
        }
        String obj = qualify(namespace, path);

        double[] bogies = null;
        JsonArray array = PackJson.optionalArray(json, "bogies", "");
        if (array != null) {
            if (array.isEmpty()) {
                throw new JsonSyntaxException("'bogies' must list at least one pivot offset");
            }
            bogies = new double[array.size()];
            for (int i = 0; i < bogies.length; i++) {
                bogies[i] = PackJson.number(array.get(i), PackJson.at("bogies", i));
            }
        }

        List<String> skip = strings(json, "skip");

        Map<String, String> animations = new LinkedHashMap<>();
        strings(json, "animations", (group, file) ->
                animations.put(group.toLowerCase(Locale.ROOT), qualify(namespace, file)));

        Map<String, String> liveries = new LinkedHashMap<>();
        strings(json, "liveries", liveries::put);

        List<String> handbrake = strings(json, "handbrake");

        JsonObject soundJson = PackJson.optionalObject(json, "sounds", "");
        SoundSet sounds = soundJson != null ? SoundSet.parse(namespace, soundJson, warnings) : SoundSet.NONE;
        double sway = 1.0;
        if (json.has("sway")) {
            JsonElement element = json.get("sway");
            sway = element.isJsonPrimitive() && element.getAsJsonPrimitive().isNumber()
                    ? element.getAsDouble() : Double.NaN;
            if (!(sway >= 0.0 && sway <= MAX_SWAY)) {
                throw new JsonSyntaxException("'sway' must be a number from 0 to " + MAX_SWAY
                        + ", got " + PackJson.describe(element));
            }
        }
        return new WagonModelDecl(obj, bogies, skip, animations, liveries, handbrake, sounds, sway);
    }

    /** The array of strings {@code key}, empty when absent. */
    private static List<String> strings(JsonObject json, String key) {
        List<String> strings = new ArrayList<>();
        JsonArray array = PackJson.optionalArray(json, key, "");
        if (array != null) {
            for (int i = 0; i < array.size(); i++) {
                strings.add(PackJson.string(array.get(i), PackJson.at(key, i)));
            }
        }
        return strings;
    }

    /** Each entry of the object {@code key} whose values are strings, in order; nothing when absent. */
    private static void strings(JsonObject json, String key, BiConsumer<String, String> entries) {
        JsonObject object = PackJson.optionalObject(json, key, "");
        if (object != null) {
            for (Map.Entry<String, JsonElement> entry : object.entrySet()) {
                entries.accept(entry.getKey(), PackJson.string(entry.getValue(), PackJson.at(key, entry.getKey())));
            }
        }
    }

    /** {@code path} → {@code namespace:path}; an already qualified path is kept. */
    static String qualify(String namespace, String path) {
        return path.indexOf(':') >= 0 ? path : namespace + ":" + path;
    }
}
