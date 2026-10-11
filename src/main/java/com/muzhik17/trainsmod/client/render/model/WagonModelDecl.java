package com.muzhik17.trainsmod.client.render.model;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonSyntaxException;
import com.muzhik17.trainsmod.client.sound.SoundSet;

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
 *   "sounds": { "idle": "stock/sounds/diesel/mvp_chme3/idle.ogg", … }
 * }
 * }</pre>
 *
 * <p>Asset paths without a namespace are in the declaring pack's namespace.
 * Paths stay strings ({@code ns:path}) — GSON only, no MC types, so the
 * parser is unit-testable; the loader turns them into resource locations.
 *
 * @param obj        the model, {@code ns:path}
 * @param bogies     bogie pivot offsets in the OBJ, +forward, front first;
 *                   null = measured from the {@code BOGEY_*} meshes
 * @param skip       extra object-name prefixes left out of the render (on top
 *                   of the convention's {@code HIDE}/{@code SEAT_}/{@code CARGO_FILL})
 * @param animations animated group → its IR {@code .anim} ({@code ns:path});
 *                   the group id (lower case) matches a door id of the type
 * @param liveries   livery id → folder next to the OBJ whose same-named
 *                   textures replace the base ones
 * @param handbrake  controls ({@code <KIND>_<n>} keys) that are the wagon's
 *                   handbrake wheel (SPEC §5.3): a click turns the handbrake,
 *                   the wheel shows it — e.g. MVP's {@code WIDGET}s labelled
 *                   "Hand Brake"; an object named {@code HANDBRAKE_<n>} needs
 *                   no entry
 * @param sounds     engine, horns, wheels, joints, doors and controls (SPEC §10);
 *                   {@link SoundSet#NONE} if the pack gives none
 */
public record WagonModelDecl(
        String obj,
        double[] bogies,
        List<String> skip,
        Map<String, String> animations,
        Map<String, String> liveries,
        List<String> handbrake,
        SoundSet sounds) {

    public WagonModelDecl {
        skip = List.copyOf(skip);
        animations = Map.copyOf(animations);
        liveries = Map.copyOf(liveries);
        handbrake = List.copyOf(handbrake);
    }

    /**
     * Parse one declaration.
     *
     * @param namespace the declaring file's namespace, for unqualified paths
     * @throws JsonSyntaxException on a missing {@code obj} or a bad shape
     */
    public static WagonModelDecl parse(String namespace, JsonObject json) {
        if (!json.has("obj")) {
            throw new JsonSyntaxException("missing required field 'obj'");
        }
        String obj = qualify(namespace, json.get("obj").getAsString());

        double[] bogies = null;
        if (json.has("bogies")) {
            JsonArray array = json.getAsJsonArray("bogies");
            if (array.isEmpty()) {
                throw new JsonSyntaxException("'bogies' must list at least one pivot offset");
            }
            bogies = new double[array.size()];
            for (int i = 0; i < bogies.length; i++) {
                bogies[i] = array.get(i).getAsDouble();
            }
        }

        List<String> skip = new ArrayList<>();
        if (json.has("skip")) {
            for (JsonElement prefix : json.getAsJsonArray("skip")) {
                skip.add(prefix.getAsString());
            }
        }

        Map<String, String> animations = new LinkedHashMap<>();
        if (json.has("animations")) {
            for (Map.Entry<String, JsonElement> entry : json.getAsJsonObject("animations").entrySet()) {
                animations.put(entry.getKey().toLowerCase(Locale.ROOT),
                        qualify(namespace, entry.getValue().getAsString()));
            }
        }

        Map<String, String> liveries = new LinkedHashMap<>();
        if (json.has("liveries")) {
            for (Map.Entry<String, JsonElement> entry : json.getAsJsonObject("liveries").entrySet()) {
                liveries.put(entry.getKey(), entry.getValue().getAsString());
            }
        }
        List<String> handbrake = new ArrayList<>();
        if (json.has("handbrake")) {
            for (JsonElement key : json.getAsJsonArray("handbrake")) {
                handbrake.add(key.getAsString());
            }
        }
        SoundSet sounds = json.has("sounds")
                ? SoundSet.parse(namespace, json.getAsJsonObject("sounds")) : SoundSet.NONE;
        return new WagonModelDecl(obj, bogies, skip, animations, liveries, handbrake, sounds);
    }

    /** {@code path} → {@code namespace:path}; an already qualified path is kept. */
    static String qualify(String namespace, String path) {
        return path.indexOf(':') >= 0 ? path : namespace + ":" + path;
    }
}
