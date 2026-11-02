package com.muzhik17.trainsmod.client.sound;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonSyntaxException;

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
 * loops, {@code stop} once after; {@code pitch}/{@code volume} are its range
 * from rest to full (throttle for {@code idle}, speed for {@code wheels}).
 *
 * <p>Plain GSON, no MC types: unit-testable like {@code WagonModelDecl}.
 */
public record SoundSet(Loop idle, Loop horn, Loop bell, Loop wheels, String clack,
        Map<String, String> doors, Map<String, Control> controls) {

    public static final SoundSet NONE = new SoundSet(null, null, null, null, null, Map.of(), Map.of());

    /** The maps keep the declaration's order (a cab control of a kind is the first declared, {@link #control}). */
    public SoundSet {
        doors = Collections.unmodifiableMap(new LinkedHashMap<>(doors));
        controls = Collections.unmodifiableMap(new LinkedHashMap<>(controls));
    }

    /**
     * A looping sound with optional lead-in and tail.
     *
     * @param pitch  {from, to} across the loop's range, or null for the engine's default
     * @param volume the same for volume
     */
    public record Loop(String start, String main, String stop, float[] pitch, float[] volume) {
    }

    /** A cab control's sounds: {@code move} on every notch, {@code engage} when it starts moving. */
    public record Control(String move, String engage) {
    }

    /**
     * The cab control of a kind: the first declared whose key starts with
     * {@code kind} or {@code alias} ({@code THROTTLE_1} before
     * {@code THROTTLE_2}, as the pack lists them); null if none.
     */
    public Control control(String kind, String alias) {
        for (Map.Entry<String, Control> entry : controls.entrySet()) {
            if (entry.getKey().startsWith(kind) || (alias != null && entry.getKey().startsWith(alias))) {
                return entry.getValue();
            }
        }
        return null;
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

    /**
     * Parse a declaration's {@code "sounds"} object.
     *
     * @param namespace the declaring pack's namespace, for unqualified paths
     */
    public static SoundSet parse(String namespace, JsonObject json) {
        Map<String, String> doors = new LinkedHashMap<>();
        if (json.has("doors")) {
            for (Map.Entry<String, JsonElement> entry : json.getAsJsonObject("doors").entrySet()) {
                doors.put(entry.getKey().toLowerCase(Locale.ROOT), ref(namespace, entry.getValue()));
            }
        }
        Map<String, Control> controls = new LinkedHashMap<>();
        if (json.has("controls")) {
            for (Map.Entry<String, JsonElement> entry : json.getAsJsonObject("controls").entrySet()) {
                JsonObject control = entry.getValue().getAsJsonObject();
                controls.put(entry.getKey().toUpperCase(Locale.ROOT), new Control(
                        optionalRef(namespace, control, "move"),
                        optionalRef(namespace, control, "engage")));
            }
        }
        return new SoundSet(loop(namespace, json, "idle"), loop(namespace, json, "horn"),
                loop(namespace, json, "bell"), loop(namespace, json, "wheels"),
                optionalRef(namespace, json, "clack"), doors, controls);
    }

    private static Loop loop(String namespace, JsonObject json, String key) {
        if (!json.has(key)) {
            return null;
        }
        JsonElement element = json.get(key);
        if (element.isJsonPrimitive()) {
            return new Loop(null, ref(namespace, element), null, null, null);
        }
        JsonObject object = element.getAsJsonObject();
        if (!object.has("main")) {
            throw new JsonSyntaxException("sound '" + key + "' needs a 'main' loop");
        }
        return new Loop(optionalRef(namespace, object, "start"), ref(namespace, object.get("main")),
                optionalRef(namespace, object, "stop"), range(object, "pitch"), range(object, "volume"));
    }

    private static float[] range(JsonObject json, String key) {
        if (!json.has(key)) {
            return null;
        }
        var array = json.getAsJsonArray(key);
        if (array.size() != 2) {
            throw new JsonSyntaxException("'" + key + "' must be [from, to]");
        }
        return new float[] {array.get(0).getAsFloat(), array.get(1).getAsFloat()};
    }

    private static String optionalRef(String namespace, JsonObject json, String key) {
        return json.has(key) ? ref(namespace, json.get(key)) : null;
    }

    private static String ref(String namespace, JsonElement element) {
        String path = element.getAsString();
        if (path.isEmpty()) {
            throw new JsonSyntaxException("empty sound reference");
        }
        return path.indexOf(':') >= 0 ? path : namespace + ":" + path;
    }
}
