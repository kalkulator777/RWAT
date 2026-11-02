package com.muzhik17.trainsmod.golden;

import java.io.IOException;
import java.util.function.Function;
import java.util.stream.Stream;

import org.joml.Vector3d;
import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.google.gson.JsonSyntaxException;
import com.muzhik17.trainsmod.kinematics.RiderWalk;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypeParser;

/**
 * {@code fixtures/golden/wagon_type/}: a type as the pack writes it (OBJ
 * frame) → what the engine holds of it, in the model frame
 * ({@link WagonTypeParser#parse}: the markup turned, the defaults filled in,
 * the geometry checked; its warnings and its error as findings), what each
 * door is ({@link WagonType.Door}: axis, outward, faces, span), and the
 * answers to the case's questions, asked in the model frame
 * ({@link WagonType#doorHolding}, {@link WagonType#doorsWorkedBy},
 * {@link WagonType#doorsOpenedWith}, {@link WagonType.Door#open},
 * {@link WagonType.Interior#floorAt}, {@link WagonType.Interior#clampFeet}).
 * Ported: {@code editor/src/ports/wagonType.ts}.
 */
class WagonTypeGolden {

    static final String FOLDER = "wagon_type";

    private static final double M = RiderWalk.PLAYER_HALF_WIDTH;

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            JsonArray warnings = new JsonArray();
            JsonObject out = new JsonObject();
            WagonType type;
            try {
                type = WagonTypeParser.parse("golden:type", in.getAsJsonObject("type"),
                        w -> warnings.add(Golden.finding(w)));
            } catch (JsonSyntaxException e) {
                out.add("error", Golden.finding(e.getMessage()));
                out.add("warnings", warnings);
                out.add("type", JsonNull.INSTANCE);
                out.add("answers", JsonNull.INSTANCE);
                return out;
            }
            out.add("error", JsonNull.INSTANCE);
            out.add("warnings", warnings);
            out.add("type", type(type));
            out.add("answers", answers(type, in));
            return out;
        });
    }

    private static JsonObject type(WagonType t) {
        JsonObject out = new JsonObject();
        out.add("length", Golden.number(t.length()));
        out.add("bogies", Golden.numbers(t.bogieOffsets()));
        out.add("mass_t", Golden.number(t.massT()));
        out.add("max_speed_kmh", Golden.number(t.maxSpeedKmh()));
        out.add("resistance", StockDefaultsGolden.resistance(t.resistance()));
        if (t.traction() == null) {
            out.add("traction", JsonNull.INSTANCE);
        } else {
            JsonObject traction = new JsonObject();
            traction.add("power_kw", Golden.number(t.traction().powerKw()));
            traction.add("max_tractive_effort_kn", Golden.number(t.traction().maxTractiveEffortKn()));
            traction.add("adhesion", Golden.number(t.traction().adhesion()));
            traction.add("ramp_s", Golden.number(t.traction().rampS()));
            out.add("traction", traction);
        }
        if (t.cab() == null) {
            out.add("cab", JsonNull.INSTANCE);
        } else {
            JsonArray seats = new JsonArray();
            for (WagonType.Seat s : t.cab().seats()) {
                JsonObject seat = new JsonObject();
                seat.add("at", Golden.numbers(s.x(), s.y(), s.z()));
                seat.add("yaw", Golden.number(s.yaw()));
                seat.addProperty("faces_back", s.facesBack());
                seats.add(seat);
            }
            JsonObject cab = new JsonObject();
            cab.add("seats", seats);
            out.add("cab", cab);
        }
        out.add("brakes", StockDefaultsGolden.brakes(t.brakes()));
        if (t.interior() == null) {
            out.add("interior", JsonNull.INSTANCE);
        } else {
            JsonArray zones = new JsonArray();
            t.interior().zones().forEach(z -> zones.add(Golden.numbers(z.minX(), z.minY(), z.minZ(),
                    z.maxX(), z.maxY(), z.maxZ())));
            JsonObject interior = new JsonObject();
            interior.add("zones", zones);
            interior.add("floor_y", Golden.number(t.interior().floorY()));
            out.add("interior", interior);
        }
        JsonArray doors = new JsonArray();
        for (WagonType.Door d : t.doors()) {
            JsonObject door = new JsonObject();
            door.addProperty("id", d.id());
            door.add("box", Golden.numbers(d.minX(), d.minY(), d.minZ(), d.maxX(), d.maxY(), d.maxZ()));
            door.addProperty("inner", d.inner());
            door.addProperty("fixed", d.fixed());
            door.addProperty("connecting", d.connecting());
            door.add("group", Golden.string(d.group()));
            door.addProperty("external", d.external());
            door.addProperty("axis", d.axis());
            door.addProperty("outward", d.outward());
            door.add("inner_face", Golden.number(d.innerFace()));
            door.add("outer_face", Golden.number(d.outerFace()));
            door.add("span", Golden.numbers(d.spanMin(), d.spanMax()));
            doors.add(door);
        }
        out.add("doors", doors);
        JsonObject couplers = new JsonObject();
        couplers.add("front", Golden.number(t.couplers().front()));
        couplers.add("rear", Golden.number(t.couplers().rear()));
        couplers.add("reach", Golden.numbers(t.couplerReach(true), t.couplerReach(false)));
        out.add("couplers", couplers);
        WagonType.Hull h = t.collidableHull();
        out.add("hull", Golden.numbers(h.minX(), h.minY(), h.minZ(), h.maxX(), h.maxY(), h.maxZ()));
        out.addProperty("powered", t.powered());
        out.addProperty("drivable", t.drivable());
        out.addProperty("boardable", t.boardable());
        out.addProperty("doors_only", t.doorsOnly());
        out.add("wheelbase", Golden.number(t.wheelbase()));
        out.addProperty("leaf_doors", t.leafDoors());
        return out;
    }

    private static JsonObject answers(WagonType t, JsonObject in) {
        JsonObject out = new JsonObject();
        int open = in.has("open") ? in.get("open").getAsInt() : 0;
        out.add("door_holding", each(in, "door_holding", q -> {
            double[] p = Golden.doubles(q);
            return new JsonPrimitive(t.doorHolding(p[0], p[1], p[2]));
        }));
        out.add("doors_worked_by", each(in, "doors_worked_by", q -> new JsonPrimitive(t.doorsWorkedBy(q.getAsString()))));
        out.add("doors_opened_with", each(in, "doors_opened_with", q -> new JsonPrimitive(t.doorsOpenedWith(q.getAsInt()))));
        out.add("door_open", each(in, "door_open", q -> {
            JsonArray maskAndIndex = q.getAsJsonArray();
            int index = maskAndIndex.get(1).getAsInt();
            return new JsonPrimitive(t.doors().get(index).open(maskAndIndex.get(0).getAsInt(), index));
        }));
        out.add("floor_at", each(in, "floor_at", q -> {
            double[] p = Golden.doubles(q);
            return Golden.number(t.interior().floorAt(p[0], p[1], M));
        }));
        out.add("clamp_feet", each(in, "clamp_feet", q -> {
            double[] p = Golden.doubles(q);
            Vector3d feet = t.interior().clampFeet(new Vector3d(p[0], p[1], p[2]), M, t.doors(), open);
            return Golden.numbers(feet.x, feet.y, feet.z);
        }));
        return out;
    }

    private static JsonArray each(JsonObject in, String key, Function<JsonElement, JsonElement> answer) {
        JsonArray out = new JsonArray();
        if (in.has(key)) {
            in.getAsJsonArray(key).forEach(q -> out.add(answer.apply(q)));
        }
        return out;
    }
}
