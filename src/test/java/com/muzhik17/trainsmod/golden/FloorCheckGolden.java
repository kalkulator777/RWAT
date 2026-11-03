package com.muzhik17.trainsmod.golden;

import java.io.IOException;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.kinematics.FloorCheck;
import com.muzhik17.trainsmod.kinematics.FloorFinding;
import com.muzhik17.trainsmod.kinematics.RiderWalk;
import com.muzhik17.trainsmod.stock.FloorRegion;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypeParser;

/**
 * {@code fixtures/golden/floor_check/}: a type as the pack writes it (OBJ
 * frame) → what the floor check tells its author ({@link FloorCheck#findings}
 * after {@link WagonTypeParser#parse}), each finding as the editor reads it:
 * {@code {code, subject, index, params, text}} ({@link FloorFinding}: the
 * code's name, its subject's key, the index or −1, the params in the order
 * of the line, the line); or its ways out ({@code exits_of}): for each hull
 * or gangway door, the pieces of the floor with every door between zones shut
 * a rider walks out through it from ({@code FloorCheck.walkablePieces}); or
 * where its inner doors' bridges meet that floor ({@code bridges_of}): for each
 * door, the pieces before and behind its leaf and on how many sides
 * ({@link FloorCheck#bridgeSides}), null for a hull or gangway door. Ported:
 * {@code tools/floorgen.py} ({@code Region.door_seeds}, the ways out),
 * {@code editor/src/ports/floorCheck.ts}.
 */
class FloorCheckGolden {

    static final String FOLDER = "floor_check";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            if (in.has("exits_of")) {
                return exits(WagonTypeParser.parse("golden:case", in.getAsJsonObject("exits_of")));
            }
            if (in.has("bridges_of")) {
                return bridges(WagonTypeParser.parse("golden:case", in.getAsJsonObject("bridges_of")));
            }
            WagonType type = WagonTypeParser.parse("golden:case", in.getAsJsonObject("type"));
            JsonArray findings = new JsonArray();
            FloorCheck.findings(type).forEach(f -> findings.add(finding(f)));
            return findings;
        });
    }

    private static JsonObject finding(FloorFinding f) {
        JsonObject params = new JsonObject();
        f.params().forEach((name, value) -> params.add(name, param(value)));
        JsonObject out = new JsonObject();
        out.addProperty("code", f.code().name());
        out.addProperty("subject", f.subject().key);
        out.addProperty("index", f.index());
        out.add("params", params);
        out.addProperty("text", f.text());
        return out;
    }

    /**
     * A param: a number (NaN and the infinities as strings, the sign of a zero
     * kept: the line prints it), a string (a door's id), a list of zone indices.
     */
    private static JsonElement param(Object value) {
        if (value instanceof Number number) {
            return Golden.signed(number.doubleValue());
        }
        if (value instanceof List<?> list) {
            JsonArray array = new JsonArray();
            list.forEach(item -> array.add((Integer) item));
            return array;
        }
        return Golden.string((String) value);
    }

    private static JsonElement bridges(WagonType type) {
        if (type.interior() == null) {
            return JsonNull.INSTANCE;
        }
        FloorRegion shut = type.interior().region(RiderWalk.PLAYER_HALF_WIDTH, type.doors(), 0);
        JsonArray bridges = new JsonArray();
        for (WagonType.Door door : type.doors()) {
            if (!door.inner()) {
                bridges.add(JsonNull.INSTANCE);
                continue;
            }
            FloorCheck.BridgeSides sides = FloorCheck.bridgeSides(door, shut);
            JsonArray before = new JsonArray();
            sides.before().forEach(before::add);
            JsonArray behind = new JsonArray();
            sides.behind().forEach(behind::add);
            JsonObject bridge = new JsonObject();
            bridge.add("before", before);
            bridge.add("behind", behind);
            bridge.addProperty("reach", sides.reach().key);
            bridges.add(bridge);
        }
        return bridges;
    }

    private static JsonElement exits(WagonType type) {
        if (type.interior() == null) {
            return JsonNull.INSTANCE;
        }
        FloorRegion shut = type.interior().region(RiderWalk.PLAYER_HALF_WIDTH, type.doors(), 0);
        JsonArray exits = new JsonArray();
        for (WagonType.Door door : type.doors()) {
            if (door.inner()) {
                exits.add(JsonNull.INSTANCE);
                continue;
            }
            JsonArray pieces = new JsonArray();
            FloorCheck.walkablePieces(door, shut).forEach(pieces::add);
            exits.add(pieces);
        }
        return exits;
    }
}
