package com.muzhik17.trainsmod.golden;

import java.io.IOException;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.stock.ObjFrame;

/**
 * {@code fixtures/golden/obj_frame/}: points and boxes from the OBJ frame to
 * the model frame and back ({@link ObjFrame}). Ported: {@code tools/floorgen.py}
 * ({@code point_from_obj}, {@code point_to_obj}, {@code box_from_obj},
 * {@code box_to_obj}), {@code editor/src/ports/objFrame.ts}.
 */
class ObjFrameGolden {

    static final String FOLDER = "obj_frame";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            JsonObject out = new JsonObject();
            if (in.has("point_obj")) {
                double[] p = Golden.doubles(in.get("point_obj"));
                out.add("model", Golden.numbers(ObjFrame.point(p[0], p[1], p[2])));
            } else if (in.has("point_model")) {
                double[] p = Golden.doubles(in.get("point_model"));
                out.add("obj", Golden.numbers(ObjFrame.toObj(p[0], p[1], p[2])));
            } else if (in.has("box_obj")) {
                JsonObject box = in.getAsJsonObject("box_obj");
                double[] b = ObjFrame.box(Golden.doubles(box.get("min")), Golden.doubles(box.get("max")));
                out.add("model", box(b[0], b[1], b[2], b[3], b[4], b[5]));
            } else {
                // a model-frame box back: its least OBJ corner is the model's (min x, min y, max z), turned
                JsonObject box = in.getAsJsonObject("box_model");
                double[] lo = Golden.doubles(box.get("min"));
                double[] hi = Golden.doubles(box.get("max"));
                double[] min = ObjFrame.toObj(lo[0], lo[1], hi[2]);
                double[] max = ObjFrame.toObj(hi[0], hi[1], lo[2]);
                out.add("obj", box(min[0], min[1], min[2], max[0], max[1], max[2]));
            }
            return out;
        });
    }

    private static JsonObject box(double minX, double minY, double minZ, double maxX, double maxY, double maxZ) {
        JsonObject out = new JsonObject();
        out.add("min", Golden.numbers(minX, minY, minZ));
        out.add("max", Golden.numbers(maxX, maxY, maxZ));
        return out;
    }
}
