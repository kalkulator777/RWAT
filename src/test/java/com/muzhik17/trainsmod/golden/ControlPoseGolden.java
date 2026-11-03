package com.muzhik17.trainsmod.golden;

import java.io.IOException;
import java.util.stream.Stream;

import org.joml.Matrix4f;
import org.joml.Vector3f;
import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.convention.ControlPose;
import com.muzhik17.trainsmod.convention.ControlValue;
import com.muzhik17.trainsmod.convention.ObjectRole;

/**
 * {@code fixtures/golden/control_pose/}: a control's name, where it stands
 * (its raw position 0…1) and its hinge → the value that drives it
 * ({@link ControlValue#value}), whether it shows ({@link ControlValue#visible})
 * and how it is moved: the transform at that value ({@link ControlPose#transform},
 * which {@code StockModel.Control.transform} draws by), a slide by value ×
 * {@code TL}, then a turn of value × the {@code ROT} degrees about the hinge.
 * The transform is the same in any frame; the cases give the hinge and read
 * the slide in the OBJ frame, where the editor shows the model. Ported:
 * {@code editor/src/ports/controlPose.ts}.
 */
class ControlPoseGolden {

    static final String FOLDER = "control_pose";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            ObjectRole role = ObjectRole.parse(in.get("name").getAsString());
            ObjectRole.Control c = role.control();
            float position = (float) Golden.toDouble(in.get("position"));
            float value = ControlValue.value(c, position);
            Vector3f pivot = in.has("pivot") ? vector(in, "pivot") : null;
            Vector3f axis = in.has("axis") ? vector(in, "axis") : new Vector3f(0.0F, 1.0F, 0.0F);
            Matrix4f transform = ControlPose.transform(value, new Vector3f(c.slideX(), c.slideY(), c.slideZ()), pivot,
                    axis, role.pivot() ? role.pivotDegrees() : 0.0F, new Matrix4f());
            JsonObject out = new JsonObject();
            out.add("value", Golden.number(value));
            out.addProperty("visible", ControlValue.visible(c, position));
            out.add("transform", Golden.rowMajor(transform));
            return out;
        });
    }

    private static Vector3f vector(JsonObject in, String key) {
        double[] v = Golden.doubles(in.get(key));
        return new Vector3f((float) v[0], (float) v[1], (float) v[2]);
    }
}
