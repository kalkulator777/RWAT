package com.muzhik17.trainsmod.golden;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.ObjLoader;
import com.muzhik17.trainsmod.convention.ObjectRole;

/**
 * {@code fixtures/golden/obj/}: an OBJ's text → its parts as the loader
 * splits it ({@link ObjLoader#loadModel}: by {@code o}/{@code g} and
 * {@code usemtl}, quads kept, a triangle a quad with its last corner twice,
 * a polygon fanned), and an {@code o}/{@code g} line → the object's name
 * ({@link ObjectRole#objectName}). Ported: {@code editor/src/ports/obj.ts};
 * the object name also {@code tools/floorgen.py} ({@code object_name_of}).
 */
class ObjGolden {

    static final String FOLDER = "obj";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> {
            JsonObject in = input.getAsJsonObject();
            if (in.has("line")) {
                return Golden.string(ObjectRole.objectName(in.get("line").getAsString()));
            }
            ObjLoader.Model model;
            try {
                model = ObjLoader.loadModel(new ByteArrayInputStream(
                        in.get("text").getAsString().getBytes(StandardCharsets.UTF_8)));
            } catch (IOException | RuntimeException e) {
                JsonObject error = new JsonObject();
                error.addProperty("error", true);
                return error;
            }
            boolean summary = Golden.flag(in, "summary");
            JsonObject out = new JsonObject();
            JsonArray libraries = new JsonArray();
            model.materialLibraries().forEach(libraries::add);
            out.add("libraries", libraries);
            JsonArray parts = new JsonArray();
            for (ObjLoader.Part part : model.parts()) {
                JsonObject p = new JsonObject();
                p.addProperty("object", part.object());
                p.addProperty("material", part.material());
                p.add("quads", summary ? summary(part.mesh()) : quads(part.mesh()));
                parts.add(p);
            }
            out.add("parts", parts);
            return out;
        });
    }

    private static Mesh.Vertex[] corners(Mesh.Quad q) {
        return new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()};
    }

    /** Every quad: four corners, each {@code [x, y, z, u, v, nx, ny, nz]}. */
    private static JsonArray quads(Mesh mesh) {
        JsonArray quads = new JsonArray();
        for (Mesh.Quad q : mesh.quads()) {
            JsonArray quad = new JsonArray();
            for (Mesh.Vertex v : corners(q)) {
                quad.add(Golden.numbers(v.x(), v.y(), v.z(), v.u(), v.v(), v.nx(), v.ny(), v.nz()));
            }
            quads.add(quad);
        }
        return quads;
    }

    /** A whole model's part in short: how many quads (of them triangles), the box of its corners, its first quad. */
    private static JsonElement summary(Mesh mesh) {
        float[] min = {Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE};
        float[] max = {-Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};
        int triangles = 0;
        for (Mesh.Quad q : mesh.quads()) {
            if (q.v2().equals(q.v3())) {
                triangles++;
            }
            for (Mesh.Vertex v : corners(q)) {
                float[] xyz = {v.x(), v.y(), v.z()};
                for (int a = 0; a < 3; a++) {
                    min[a] = Math.min(min[a], xyz[a]);
                    max[a] = Math.max(max[a], xyz[a]);
                }
            }
        }
        JsonObject out = new JsonObject();
        out.addProperty("count", mesh.quads().size());
        out.addProperty("triangles", triangles);
        out.add("min", Golden.numbers(min));
        out.add("max", Golden.numbers(max));
        JsonArray first = new JsonArray();
        for (Mesh.Vertex v : corners(mesh.quads().get(0))) {
            first.add(Golden.numbers(v.x(), v.y(), v.z()));
        }
        out.add("first", first);
        return out;
    }
}
