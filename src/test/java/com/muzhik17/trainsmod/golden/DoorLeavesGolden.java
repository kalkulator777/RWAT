package com.muzhik17.trainsmod.golden;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.convention.DoorLeaves;
import com.muzhik17.trainsmod.convention.ObjectRole;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypeParser;

/**
 * {@code fixtures/golden/door_leaves/}: a model's objects (name, textured or
 * not, box in the OBJ frame), its skip and animated objects, and the type's
 * doors as the pack writes them → its door leaves and the door each is
 * ({@link DoorLeaves}; the door by {@link WagonType#doorHolding} at the
 * centre of the leaf's textured box). To be ported with the model's reading
 * ({@code editor/src/ports/modelParts.ts}, editor.md 4.1).
 */
class DoorLeavesGolden {

    static final String FOLDER = "door_leaves";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            List<String> names = new ArrayList<>();
            in.getAsJsonArray("objects").forEach(o -> names.add(o.getAsJsonObject().get("name").getAsString()));
            DoorLeaves leaves = DoorLeaves.of(names, Golden.strings(in, "skip"),
                    new LinkedHashSet<>(Golden.strings(in, "animated")));
            // only the doors matter: the rest makes a wagon of them
            JsonObject typeJson = new JsonObject();
            typeJson.addProperty("length", 30.0);
            typeJson.add("bogies", Golden.numbers(8.0, -8.0));
            typeJson.addProperty("mass_t", 40.0);
            typeJson.add("doors", in.has("doors") ? in.get("doors") : new JsonArray());
            WagonType type = WagonTypeParser.parse("golden:leaves", typeJson);
            Map<String, List<String>> objects = new LinkedHashMap<>();
            Map<String, double[]> boxes = new LinkedHashMap<>();
            for (JsonElement element : in.getAsJsonArray("objects")) {
                JsonObject o = element.getAsJsonObject();
                ObjectRole leaf = leaves.leaf(o.get("name").getAsString());
                if (leaf == null) {
                    continue;
                }
                String key = leaf.control().key();
                objects.computeIfAbsent(key, k -> new ArrayList<>()).add(o.get("name").getAsString());
                if (o.has("textured") && !o.get("textured").getAsBoolean()) {
                    continue; // drawn by nothing: no box
                }
                double[] lo = Golden.doubles(o.get("min"));
                double[] hi = Golden.doubles(o.get("max"));
                double[] box = boxes.computeIfAbsent(key, k -> new double[]{Double.MAX_VALUE, Double.MAX_VALUE,
                        Double.MAX_VALUE, -Double.MAX_VALUE, -Double.MAX_VALUE, -Double.MAX_VALUE});
                for (int a = 0; a < 3; a++) {
                    box[a] = Math.min(box[a], lo[a]);
                    box[a + 3] = Math.max(box[a + 3], hi[a]);
                }
            }
            JsonArray keys = new JsonArray();
            leaves.keys().forEach(keys::add);
            JsonArray built = new JsonArray();
            objects.forEach((key, parts) -> {
                JsonObject leaf = new JsonObject();
                leaf.addProperty("key", key);
                JsonArray partNames = new JsonArray();
                parts.forEach(partNames::add);
                leaf.add("objects", partNames);
                double[] box = boxes.get(key);
                leaf.addProperty("drawn", box != null);
                int door = box == null ? -1 : DoorLeaves.door(type, new double[]{box[0], box[1], box[2]},
                        new double[]{box[3], box[4], box[5]});
                leaf.add("door", door < 0 ? JsonNull.INSTANCE : Golden.string(type.doors().get(door).id()));
                built.add(leaf);
            });
            JsonObject out = new JsonObject();
            out.add("keys", keys);
            out.add("leaves", built);
            return out;
        });
    }
}
