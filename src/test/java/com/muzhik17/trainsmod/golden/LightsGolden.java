package com.muzhik17.trainsmod.golden;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.function.ToDoubleFunction;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.convention.ModelParts;

/**
 * {@code fixtures/golden/lights/}: when a light shines (SPEC §8) — a glowing
 * face, a cabin lamp, a headlight alike. A model's light groups and their
 * control groups' values → the groups on ({@link ModelParts#litMask}: value
 * above 0, the first 64) and, for each light (its group by name or none,
 * {@code LINVERT}), whether it shines ({@link ModelParts#lit}). A case with a
 * model ({@code obj}… as {@code model_parts} reads it) asks it of the model's
 * own lights: its headlights, cabin lamps and glowing parts. Ported:
 * {@code editor/src/ports/lights.ts} (M3).
 */
class LightsGolden {

    static final String FOLDER = "lights";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            JsonObject values = in.has("values") ? in.getAsJsonObject("values") : new JsonObject();
            ToDoubleFunction<String> value = group -> values.has(group) ? Golden.toDouble(values.get(group)) : 0.0;
            JsonObject out = new JsonObject();
            if (in.has("obj")) {
                ModelPartsGolden.Read read = ModelPartsGolden.read(in);
                ModelParts parts = read.parts();
                long mask = ModelParts.litMask(parts.lightGroups(), value);
                out.add("on", on(parts.lightGroups(), mask));
                JsonArray headlights = new JsonArray();
                parts.headlights().forEach(h -> headlights.add(h.lit(mask)));
                out.add("headlights", headlights);
                JsonArray lamps = new JsonArray();
                parts.lamps().forEach(l -> lamps.add(l.lit(mask)));
                out.add("lamps", lamps);
                JsonArray glowing = new JsonArray();
                for (int i = 0; i < read.objects().size(); i++) {
                    ModelParts.Role role = parts.roles().get(i);
                    if (role.place().drawn() && role.light().fullbright()) {
                        JsonArray part = new JsonArray();
                        part.add(read.objects().get(i));
                        part.add(role.light().lit(mask));
                        glowing.add(part);
                    }
                }
                out.add("glowing", glowing);
                return out;
            }
            List<String> groups = Golden.strings(in, "groups");
            long mask = ModelParts.litMask(groups, value);
            out.add("on", on(groups, mask));
            JsonArray lit = new JsonArray();
            for (JsonElement element : in.getAsJsonArray("lights")) {
                JsonObject light = element.getAsJsonObject();
                int group = light.get("group").isJsonNull() ? -1 : groups.indexOf(light.get("group").getAsString());
                lit.add(ModelParts.lit(group, Golden.flag(light, "invert"), mask));
            }
            out.add("lit", lit);
            return out;
        });
    }

    /** The names of the groups on, in the model's order. */
    private static JsonArray on(List<String> groups, long mask) {
        List<String> names = new ArrayList<>();
        for (int i = 0; i < groups.size() && i < ModelParts.MAX_LIGHT_GROUPS; i++) {
            if ((mask >> i & 1L) != 0) {
                names.add(groups.get(i));
            }
        }
        JsonArray out = new JsonArray();
        names.forEach(out::add);
        return out;
    }
}
