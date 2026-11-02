package com.muzhik17.trainsmod.golden;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.kinematics.FloorCheck;
import com.muzhik17.trainsmod.kinematics.RiderWalk;
import com.muzhik17.trainsmod.stock.FloorRegion;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypeParser;

/**
 * {@code fixtures/golden/floor_check/}: a type as the pack writes it (OBJ
 * frame) → what the floor check tells its author ({@link FloorCheck#problems}
 * after {@link WagonTypeParser#parse}), each as a finding
 * ({@link Golden#finding}); or its ways out ({@code exits_of}): for each hull
 * or gangway door, the pieces of the floor with every door between zones shut
 * a rider walks out through it from ({@code FloorCheck.walkablePieces}). Ported:
 * {@code tools/floorgen.py} ({@code Region.door_seeds}, the ways out),
 * {@code editor/src/ports/floorCheck.ts}.
 */
class FloorCheckGolden {

    static final String FOLDER = "floor_check";

    /**
     * {@code FloorCheck.walkablePieces(door, region)}: package-private in the
     * engine, read here by reflection until the check hands its ways out on
     * its own (editor.md 4.6, item 2).
     */
    private static final Method WALKABLE;

    static {
        try {
            WALKABLE = FloorCheck.class.getDeclaredMethod("walkablePieces", WagonType.Door.class, FloorRegion.class);
            WALKABLE.setAccessible(true);
        } catch (NoSuchMethodException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            if (in.has("exits_of")) {
                return exits(WagonTypeParser.parse("golden:case", in.getAsJsonObject("exits_of")));
            }
            WagonType type = WagonTypeParser.parse("golden:case", in.getAsJsonObject("type"));
            JsonArray findings = new JsonArray();
            FloorCheck.problems(type).forEach(text -> findings.add(Golden.finding(text)));
            return findings;
        });
    }

    @SuppressWarnings("unchecked")
    private static JsonElement exits(WagonType type) throws ReflectiveOperationException {
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
            ((List<Integer>) WALKABLE.invoke(null, door, shut)).forEach(pieces::add);
            exits.add(pieces);
        }
        return exits;
    }
}
