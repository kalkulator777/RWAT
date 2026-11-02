package com.muzhik17.trainsmod.golden;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.ObjLoader;
import com.muzhik17.trainsmod.convention.PivotAxis;

/**
 * {@code fixtures/golden/pivot_axis/}: a hinge marker → its hinge and axis
 * ({@link PivotAxis}), from its corners in file order or from the text of an
 * OBJ and the marker's name. From the text the corners are those the model
 * loader keeps of every face of every part of that object, in order
 * ({@link ObjLoader}: four a quad, a triangle's last twice, a polygon fanned)
 * — what {@code IrStockModel}'s control builder hands {@link PivotAxis}.
 * Ported: {@code editor/src/ports/pivotAxis.ts}.
 */
class PivotAxisGolden {

    static final String FOLDER = "pivot_axis";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            List<float[]> corners = in.has("corners") ? corners(in) : corners(in.get("obj").getAsString(),
                    in.get("object").getAsString());
            double[][] pa = PivotAxis.of(corners);
            JsonObject out = new JsonObject();
            out.addProperty("points", PivotAxis.points(corners).size());
            out.add("centre", Golden.numbers(pa[0]));
            out.add("axis", Golden.numbers(pa[1]));
            return out;
        });
    }

    /** The corners as written, read as float32 as the OBJ loader reads them. */
    private static List<float[]> corners(JsonObject in) {
        List<float[]> corners = new ArrayList<>();
        for (JsonElement corner : in.getAsJsonArray("corners")) {
            double[] c = Golden.doubles(corner);
            corners.add(new float[]{(float) c[0], (float) c[1], (float) c[2]});
        }
        return corners;
    }

    private static List<float[]> corners(String obj, String object) throws IOException {
        List<float[]> corners = new ArrayList<>();
        for (ObjLoader.Part part : ObjLoader.loadModel(new ByteArrayInputStream(
                obj.getBytes(StandardCharsets.UTF_8))).parts()) {
            if (!part.object().equals(object)) {
                continue;
            }
            for (Mesh.Quad q : part.mesh().quads()) {
                for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                    corners.add(new float[]{v.x(), v.y(), v.z()});
                }
            }
        }
        assertTrue(!corners.isEmpty(), "no faces of " + object);
        return corners;
    }
}
