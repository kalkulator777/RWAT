package com.muzhik17.trainsmod.golden;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.joml.Matrix4f;
import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.client.render.model.IrAnim;

/**
 * {@code fixtures/golden/anim/}: an Immersive Railroading {@code .anim} → its
 * tracks as written ({@link IrAnim#parse}), or that it is broken; with a
 * {@code progress}, also each track's transform at it ({@link IrAnim#frameAt},
 * as a door's pieces are drawn). Ported: {@code editor/src/ports/anim.ts}
 * ({@code parse}, {@code frameAt}); the objects of the tracks also
 * {@code tools/ir2rwat.py} ({@code anim_objects}).
 */
class AnimGolden {

    static final String FOLDER = "anim";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            Map<String, List<float[]>> tracks = parse(input);
            if (tracks == null) {
                return broken();
            }
            JsonObject written = new JsonObject();
            tracks.forEach((object, frames) -> {
                JsonArray rows = new JsonArray();
                frames.forEach(frame -> rows.add(Golden.numbers(frame)));
                written.add(object, rows);
            });
            JsonObject out = new JsonObject();
            out.add("tracks", written);
            JsonObject in = input.getAsJsonObject();
            if (in.has("progress")) {
                float progress = (float) Golden.toDouble(in.get("progress"));
                JsonObject at = new JsonObject();
                tracks.forEach((object, frames) -> {
                    if (!frames.isEmpty()) {
                        Matrix4f[] matrices = new Matrix4f[frames.size()];
                        for (int i = 0; i < matrices.length; i++) {
                            matrices[i] = new Matrix4f().set(frames.get(i)).transpose(); // rows → JOML's columns
                        }
                        at.add(object, Golden.rowMajor(IrAnim.frameAt(matrices, progress, new Matrix4f())));
                    }
                });
                out.add("at", at);
            }
            return out;
        });
    }

    /** The tracks of the case's {@code text}, or null if the reader refuses it. */
    static Map<String, List<float[]>> parse(JsonElement input) {
        try {
            return IrAnim.parse(new ByteArrayInputStream(input.getAsJsonObject().get("text").getAsString()
                    .getBytes(StandardCharsets.UTF_8)));
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    static JsonObject broken() {
        JsonObject error = new JsonObject();
        error.addProperty("error", true);
        return error;
    }
}
