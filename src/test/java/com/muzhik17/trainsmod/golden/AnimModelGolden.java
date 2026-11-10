package com.muzhik17.trainsmod.golden;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.client.render.model.IrAnim;
import com.muzhik17.trainsmod.stock.ObjFrame;

/**
 * {@code fixtures/golden/anim_model/}: each frame of an {@code .anim} in the
 * model frame ({@link IrAnim#toModelSpace} with the lift
 * {@link ObjFrame#Y_LIFT}, as the model loader moves door leaves). Not
 * ported (editor.md 4.2: the editor's view works in the OBJ frame); kept as
 * the engine's own record of the cases {@code anim/} once held.
 */
class AnimModelGolden {

    static final String FOLDER = "anim_model";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            Map<String, List<float[]>> tracks = AnimGolden.parse(input);
            if (tracks == null) {
                return AnimGolden.broken();
            }
            JsonObject model = new JsonObject();
            tracks.forEach((object, frames) -> {
                JsonArray turned = new JsonArray();
                frames.forEach(frame -> turned.add(Golden.rowMajor(IrAnim.toModelSpace(frame, (float) ObjFrame.Y_LIFT))));
                model.add(object, turned);
            });
            JsonObject out = new JsonObject();
            out.add("model", model);
            return out;
        });
    }
}
