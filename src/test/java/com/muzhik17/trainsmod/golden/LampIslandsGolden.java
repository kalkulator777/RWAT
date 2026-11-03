package com.muzhik17.trainsmod.golden;

import java.io.IOException;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.convention.LampIslands;

/**
 * {@code fixtures/golden/lamp_islands/}: the faces of a glowing part (four
 * corners each, as {@code float}s) → its cabin lamps ({@link LampIslands#of}):
 * islands of faces meeting at a corner rounded to 1e-4, the centre of each
 * island's box at least {@link LampIslands#MIN_LAMP_SIZE} across, in the
 * order of the islands' first faces. Ported: {@code editor/src/ports/lampIslands.ts}.
 */
class LampIslandsGolden {

    static final String FOLDER = "lamp_islands";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonArray faces = input.getAsJsonObject().getAsJsonArray("faces");
            float[] corners = new float[faces.size() * 12];
            int n = 0;
            for (JsonElement face : faces) {
                double[] values = Golden.doubles(face);
                if (values.length != 12) {
                    throw new IllegalArgumentException("a face is 4 corners, 12 numbers: " + face);
                }
                for (double v : values) {
                    corners[n++] = (float) v;
                }
            }
            JsonArray lamps = new JsonArray();
            LampIslands.of(corners).forEach(lamp -> lamps.add(Golden.numbers(lamp)));
            JsonObject out = new JsonObject();
            out.add("lamps", lamps);
            return out;
        });
    }
}
