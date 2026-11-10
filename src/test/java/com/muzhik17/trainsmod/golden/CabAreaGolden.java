package com.muzhik17.trainsmod.golden;

import java.io.IOException;
import java.util.List;
import java.util.function.Function;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.muzhik17.trainsmod.kinematics.CabArea;
import com.muzhik17.trainsmod.kinematics.RiderWalk;
import com.muzhik17.trainsmod.stock.FloorRegion;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypeParser;

/**
 * {@code fixtures/golden/cab_area/}: a type as the pack writes it (OBJ frame)
 * → its driver's cabs ({@link CabArea#of} after {@link WagonTypeParser#parse}):
 * how many, the cab of each chair, the cab of each piece of the floor with
 * every door between zones shut (by {@link CabArea#cabAt} at the piece's
 * centre, the pieces in the order of {@code floor_region}), the doors that
 * want the driver's key, the passengers' side doors of each side, and the
 * answers to the case's questions, asked in the model frame
 * ({@link CabArea#cabAt}, {@link CabArea#nearestChair}, {@link CabArea#cabDoor},
 * {@link CabArea#facing}, {@link CabArea#leftSide}). Ported:
 * {@code editor/src/ports/cabArea.ts}.
 */
class CabAreaGolden {

    static final String FOLDER = "cab_area";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            WagonType type = WagonTypeParser.parse("golden:cab", in.getAsJsonObject("type"));
            CabArea area = CabArea.of(type);
            List<WagonType.Seat> seats = type.cab() != null ? type.cab().seats() : List.of();
            JsonObject out = new JsonObject();
            out.addProperty("cabs", area.cabs());
            JsonArray chairs = new JsonArray();
            for (int c = 0; c < seats.size(); c++) {
                chairs.add(area.cabOfChair(c));
            }
            out.add("cab_of_chair", chairs);
            JsonArray pieces = new JsonArray();
            if (type.interior() != null) {
                FloorRegion shut = type.interior().region(RiderWalk.PLAYER_HALF_WIDTH, type.doors(), 0);
                for (FloorRegion.Piece p : shut.pieces()) {
                    pieces.add(area.cabAt((p.minX() + p.maxX()) * 0.5, (p.minZ() + p.maxZ()) * 0.5));
                }
            }
            out.add("cab_of_piece", pieces);
            out.addProperty("cab_doors", area.cabDoors());
            JsonArray sides = new JsonArray();
            sides.add(CabArea.passengerSideDoors(type, 1));
            sides.add(CabArea.passengerSideDoors(type, -1));
            out.add("passenger_side_doors", sides);
            out.add("cab_at", each(in, "cab_at", q -> {
                double[] p = Golden.doubles(q);
                return new JsonPrimitive(area.cabAt(p[0], p[1]));
            }));
            out.add("nearest_chair", each(in, "nearest_chair", q -> {
                double[] p = Golden.doubles(q);
                return new JsonPrimitive(area.nearestChair((int) p[0], p[1], p[2]));
            }));
            out.add("cab_door", each(in, "cab_door", q -> new JsonPrimitive(area.cabDoor(q.getAsInt()))));
            out.add("facing", each(in, "facing", q -> {
                JsonArray flippedAndChair = q.getAsJsonArray();
                int chair = flippedAndChair.get(1).getAsInt();
                return new JsonPrimitive(CabArea.facing(flippedAndChair.get(0).getAsBoolean(),
                        chair < 0 ? null : seats.get(chair)));
            }));
            out.add("left_side", each(in, "left_side", q -> {
                JsonArray flippedAndFacing = q.getAsJsonArray();
                return new JsonPrimitive(CabArea.leftSide(flippedAndFacing.get(0).getAsBoolean(),
                        flippedAndFacing.get(1).getAsInt()));
            }));
            return out;
        });
    }

    private static JsonArray each(JsonObject in, String key, Function<JsonElement, JsonElement> answer) {
        JsonArray out = new JsonArray();
        if (in.has(key)) {
            in.getAsJsonArray(key).forEach(q -> out.add(answer.apply(q)));
        }
        return out;
    }
}
