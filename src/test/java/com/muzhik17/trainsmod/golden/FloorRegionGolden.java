package com.muzhik17.trainsmod.golden;

import java.io.IOException;
import java.util.function.Function;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.muzhik17.trainsmod.kinematics.RiderWalk;
import com.muzhik17.trainsmod.stock.FloorRegion;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypeParser;

/**
 * {@code fixtures/golden/floor_region/}: a type as the pack writes it (OBJ
 * frame), the doors open and the half-width of a rider → where the rider's
 * centre fits on its floor, in the model frame ({@link FloorRegion}, by
 * {@link WagonType.Interior#region(double, java.util.List, int)} after
 * {@link WagonTypeParser#parse}), and the answers to the case's questions,
 * asked in the model frame. Ported: {@code tools/floorgen.py} ({@code Region}:
 * pieces, cuts, fits, reach), {@code editor/src/ports/floorRegion.ts}.
 */
class FloorRegionGolden {

    static final String FOLDER = "floor_region";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            WagonType type = WagonTypeParser.parse("golden:floor", in.getAsJsonObject("type"));
            double margin = in.has("margin") ? in.get("margin").getAsDouble() : RiderWalk.PLAYER_HALF_WIDTH;
            int open = in.has("open") ? in.get("open").getAsInt() : 0;
            WagonType.Interior interior = type.interior();
            FloorRegion region = interior.region(margin, type.doors(), open);
            JsonObject out = new JsonObject();
            JsonArray pieces = new JsonArray();
            region.pieces().forEach(p -> pieces.add(Golden.numbers(p.minX(), p.minZ(), p.maxX(), p.maxZ())));
            out.add("pieces", pieces);
            JsonArray cuts = new JsonArray();
            region.cuts().forEach(c -> cuts.add(Golden.numbers(c.minX(), c.minZ(), c.maxX(), c.maxZ())));
            out.add("cuts", cuts);
            JsonArray links = new JsonArray();
            region.links().forEach(l -> {
                JsonArray pair = new JsonArray();
                pair.add(l[0]);
                pair.add(l[1]);
                links.add(pair);
            });
            out.add("links", links);
            out.add("fits", answers(in, "fits", q -> new JsonPrimitive(region.fits(q[0], q[1]))));
            out.add("nearest", answers(in, "nearest", q -> {
                double[] at = region.nearest(q[0], q[1]);
                return at == null ? JsonNull.INSTANCE : Golden.numbers(at);
            }));
            out.add("floor", answers(in, "floor", q -> Golden.number(interior.floorAt(q[0], q[1], margin))));
            out.add("reach", answers(in, "reach", q -> Golden.number(region.reach(q[0], q[1], (int) q[2], (int) q[3]))));
            return out;
        });
    }

    private static JsonArray answers(JsonObject in, String key, Function<double[], JsonElement> answer) {
        JsonArray out = new JsonArray();
        if (in.has(key)) {
            for (JsonElement question : in.getAsJsonArray(key)) {
                out.add(answer.apply(Golden.doubles(question)));
            }
        }
        return out;
    }
}
