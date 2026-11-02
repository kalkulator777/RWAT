package com.muzhik17.trainsmod.client.sound;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonSyntaxException;
import com.muzhik17.trainsmod.convention.ObjectRole;
import com.muzhik17.trainsmod.pack.PackJson;

/**
 * A wagon's sounds as its model declaration names them (SPEC §10), under
 * {@code "sounds"} in {@code assets/<ns>/wagon_models/<id>.json}:
 *
 * <pre>{@code
 * "sounds": {
 *   "idle":   { "main": "stock/sounds/diesel/mvp_chme3/idle.ogg", "pitch": [1.0, 1.4] },
 *   "horn":   { "start": "…/tifon_start.ogg", "main": "…/tifon_main.ogg", "stop": "…/tifon_end.ogg" },
 *   "bell":   "stock/sounds/diesel/mvp_chme3/bell.ogg",
 *   "wheels": "stock/sounds/default/mvp_pass_stock_wheels.ogg",
 *   "clack":  "stock/sounds/default/mvp_clack_wheelset_2-axle.ogg",
 *   "doors":  { "door1": "stock/sounds/control/door/mvp_controls_door_close_1.ogg" },
 *   "controls": { "THROTTLE_1": { "move": "…/mvp_control_throttle.ogg" },
 *                 "TRAIN_BRAKE_1": { "engage": "…/mvp_control_pnevmo2.ogg" } }
 * }
 * }</pre>
 *
 * The keys are IR's, so a converted pack keeps its meaning: {@code idle} is
 * the engine, {@code horn} the loud horn (тифон), {@code bell} the second
 * signal (a whistle — свисток — on MVP's stock), {@code wheels} the rolling,
 * {@code clack} a bogie over a rail joint. A sound is a path ending in
 * {@code .ogg} (an Ogg Vorbis file anywhere in the pack; no namespace = the
 * declaring pack's) or a sound event id from a {@code sounds.json}
 * ({@code "minecraft:entity.minecart.riding"}). A loop is a sound or
 * {@code {start, main, stop}}: {@code start} plays once before {@code main}
 * loops, {@code stop} once after. {@code pitch}/{@code volume} are
 * {@code [from, to]}: for {@code idle} and {@code wheels} the range from rest
 * to full (throttle for {@code idle}, speed for {@code wheels}); a signal
 * ({@code horn}, {@code bell}) sounds at one level, the second number
 * ({@code to}), the first is read and unused. A {@code controls} key is a
 * control's name as an object's is ({@link ObjectRole}): its sound plays for
 * the handle of exactly that kind ({@code THROTTLE_1} for the throttle;
 * {@code THROTTLE_BRAKE_1}, a combined handle the mod only draws, is no
 * throttle), and only the handles of the train sound: throttle, train brake,
 * independent brake ({@code INDEPENDENT_BRAKE_<n>} or {@code IND_BRAKE_<n>}),
 * reverser.
 *
 * <p>Plain GSON, no MC types: unit-testable like {@code WagonModelDecl}.
 */
public record SoundSet(Loop idle, Loop horn, Loop bell, Loop wheels, String clack,
        Map<String, String> doors, Map<String, Control> controls) {

    public static final SoundSet NONE = new SoundSet(null, null, null, null, null, Map.of(), Map.of());

    /** The keys of the {@code sounds} object. */
    public static final Set<String> KEYS = PackJson.keys("idle", "horn", "bell", "wheels", "clack", "doors",
            "controls");
    /** The keys of a loop given as an object ({@code idle}, {@code horn}, {@code bell}, {@code wheels}). */
    public static final Set<String> LOOP_KEYS = PackJson.keys("start", "main", "stop", "pitch", "volume");
    /** The keys of each {@code controls} entry. */
    public static final Set<String> CONTROL_KEYS = PackJson.keys("move", "engage");

    /** Where the set sits in a model declaration, for the field paths in messages. */
    private static final String WHERE = "sounds";

    /** The maps keep the declaration's order (a cab control of a kind is the first declared, {@link #control}). */
    public SoundSet {
        doors = Collections.unmodifiableMap(new LinkedHashMap<>(doors));
        controls = Collections.unmodifiableMap(new LinkedHashMap<>(controls));
    }

    /**
     * A looping sound with optional lead-in and tail.
     *
     * @param pitch  {from, to}, or null for the engine's default: across the
     *               loop's range for {@code idle}/{@code wheels} (rest to full);
     *               a signal ({@code horn}, {@code bell}) uses only {@code to}
     * @param volume the same for volume
     */
    public record Loop(String start, String main, String stop, float[] pitch, float[] volume) {
    }

    /** A cab control's sounds: {@code move} on every notch, {@code engage} when it starts moving. */
    public record Control(String move, String engage) {
    }

    /**
     * The cab control of a kind: the first declared whose key names a control
     * of exactly that kind, read the way an object's name is
     * ({@link ObjectRole}): {@code THROTTLE_1} before {@code THROTTLE_2}, as
     * the pack lists them; {@code IND_BRAKE_1} is an
     * {@link ObjectRole.Kind#INDEPENDENT_BRAKE}, and {@code THROTTLE_BRAKE_1}
     * is a {@link ObjectRole.Kind#THROTTLE_BRAKE}, not a throttle. A key that
     * names no control of the convention matches no kind. Null if none.
     */
    public Control control(ObjectRole.Kind kind) {
        for (Map.Entry<String, Control> entry : controls.entrySet()) {
            if (kindOf(entry.getKey()) == kind) {
                return entry.getValue();
            }
        }
        return null;
    }

    /** The kind of control a {@code controls} key names, or null if it names none ({@code MY_LEVER}). */
    static ObjectRole.Kind kindOf(String key) {
        ObjectRole.Control control = ObjectRole.parse(key).control();
        return control == null ? null : control.kind();
    }

    /** True if a sound reference names a file rather than a sound event. */
    public static boolean isFile(String ref) {
        return ref.endsWith(".ogg");
    }

    /** Every Ogg file the set names, each once ({@code ns:path}; sound event ids left out). */
    public Set<String> files() {
        Set<String> files = new LinkedHashSet<>();
        for (Loop loop : new Loop[] {idle, horn, bell, wheels}) {
            if (loop != null) {
                addFile(files, loop.start());
                addFile(files, loop.main());
                addFile(files, loop.stop());
            }
        }
        addFile(files, clack);
        doors.values().forEach(ref -> addFile(files, ref));
        for (Control control : controls.values()) {
            addFile(files, control.move());
            addFile(files, control.engage());
        }
        return files;
    }

    private static void addFile(Set<String> files, String ref) {
        if (ref != null && isFile(ref)) {
            files.add(ref);
        }
    }

    /** {@link #parse(String, JsonObject, Consumer)} with the warnings dropped. */
    public static SoundSet parse(String namespace, JsonObject json) {
        return parse(namespace, json, warning -> {
        });
    }

    /**
     * Parse a declaration's {@code "sounds"} object, strictly ({@code PackJson}):
     * a key the format doesn't know ({@link #KEYS}, {@link #LOOP_KEYS},
     * {@link #CONTROL_KEYS}) is a warning with the nearest known one as a
     * hint; a {@code null} or a wrongly typed value is an error naming the
     * field ({@code sounds.idle.pitch}). {@code doors} and {@code controls}
     * are keyed by the pack's own names, so their keys aren't checked.
     *
     * @param namespace the declaring pack's namespace, for unqualified paths
     * @param warnings  told what the declaration says that means nothing
     */
    public static SoundSet parse(String namespace, JsonObject json, Consumer<String> warnings) {
        PackJson.checkKeys(json, KEYS, WHERE, warnings);
        Map<String, String> doors = new LinkedHashMap<>();
        JsonObject doorJson = PackJson.optionalObject(json, "doors", WHERE);
        if (doorJson != null) {
            for (Map.Entry<String, JsonElement> entry : doorJson.entrySet()) {
                doors.put(entry.getKey().toLowerCase(Locale.ROOT),
                        ref(namespace, entry.getValue(), PackJson.at(WHERE + ".doors", entry.getKey())));
            }
        }
        Map<String, Control> controls = new LinkedHashMap<>();
        JsonObject controlJson = PackJson.optionalObject(json, "controls", WHERE);
        if (controlJson != null) {
            for (Map.Entry<String, JsonElement> entry : controlJson.entrySet()) {
                String where = PackJson.at(WHERE + ".controls", entry.getKey());
                JsonObject control = PackJson.object(entry.getValue(), where);
                PackJson.checkKeys(control, CONTROL_KEYS, where, warnings);
                controls.put(entry.getKey().toUpperCase(Locale.ROOT), new Control(
                        optionalRef(namespace, control, "move", where),
                        optionalRef(namespace, control, "engage", where)));
            }
        }
        return new SoundSet(loop(namespace, json, "idle", warnings), loop(namespace, json, "horn", warnings),
                loop(namespace, json, "bell", warnings), loop(namespace, json, "wheels", warnings),
                optionalRef(namespace, json, "clack", WHERE), doors, controls);
    }

    private static Loop loop(String namespace, JsonObject json, String key, Consumer<String> warnings) {
        JsonElement element = json.get(key);
        String where = PackJson.at(WHERE, key);
        if (element == null) {
            return null;
        }
        if (element.isJsonPrimitive()) {
            return new Loop(null, ref(namespace, element, where), null, null, null);
        }
        if (!element.isJsonObject()) {
            throw PackJson.wrongType(where, "a sound or an object {start, main, stop, pitch, volume}", element);
        }
        JsonObject object = element.getAsJsonObject();
        PackJson.checkKeys(object, LOOP_KEYS, where, warnings);
        if (!object.has("main")) {
            throw new JsonSyntaxException("sound '" + where + "' needs a 'main' loop");
        }
        return new Loop(optionalRef(namespace, object, "start", where),
                ref(namespace, object.get("main"), PackJson.at(where, "main")),
                optionalRef(namespace, object, "stop", where),
                range(object, "pitch", where), range(object, "volume", where));
    }

    private static float[] range(JsonObject json, String key, String where) {
        JsonArray array = PackJson.optionalArray(json, key, where);
        if (array == null) {
            return null;
        }
        String path = PackJson.at(where, key);
        if (array.size() != 2) {
            throw new JsonSyntaxException("'" + path + "' must be [from, to]");
        }
        return new float[] {(float) PackJson.number(array.get(0), PackJson.at(path, 0)),
                (float) PackJson.number(array.get(1), PackJson.at(path, 1))};
    }

    private static String optionalRef(String namespace, JsonObject json, String key, String where) {
        return json.has(key) ? ref(namespace, json.get(key), PackJson.at(where, key)) : null;
    }

    private static String ref(String namespace, JsonElement element, String path) {
        String ref = PackJson.string(element, path);
        if (ref.isEmpty()) {
            throw new JsonSyntaxException("'" + path + "' is an empty sound reference");
        }
        return ref.indexOf(':') >= 0 ? ref : namespace + ":" + ref;
    }
}
