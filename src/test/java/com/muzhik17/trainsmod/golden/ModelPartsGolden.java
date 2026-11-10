package com.muzhik17.trainsmod.golden;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.client.render.model.IrAnim;
import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.MtlParser;
import com.muzhik17.trainsmod.client.render.model.ObjLoader;
import com.muzhik17.trainsmod.client.render.model.WagonModelDecl;
import com.muzhik17.trainsmod.convention.ModelParts;
import com.muzhik17.trainsmod.convention.ObjectRole;

/**
 * {@code fixtures/golden/model_parts/}: a wagon model — its OBJ, which
 * materials have a texture (an MTL's {@code map_Kd}, or named), its
 * declaration as the pack writes it and the {@code .anim}s of its doors →
 * what every part is to the engine ({@link ModelParts}): place, owner, light;
 * the light groups, bogies and wheelsets, controls and door leaves with
 * their merged flags and hinges, animated doors, coupler heads, cabin lamps,
 * headlights. Ported: {@code editor/src/ports/modelParts.ts} (M3).
 */
class ModelPartsGolden {

    static final String FOLDER = "model_parts";

    @TestFactory
    Stream<DynamicNode> cases() throws IOException {
        return Golden.run(FOLDER, input -> write(read(input.getAsJsonObject())));
    }

    /** A model read from a case's input, with the names of its parts in order. */
    record Read(List<String> objects, ModelParts parts) {
    }

    /**
     * The model of a case: {@code obj} (OBJ text), {@code mtl} (MTL text: a
     * material whose {@code map_Kd} stays inside the pack from the folder of
     * the declaration's {@code obj} has a texture) and/or {@code textured}
     * (material names), {@code model} (the wagon model declaration:
     * {@code bogies}, {@code skip}, {@code handbrake}…), {@code anim_<door>}
     * (the {@code .anim} text of door {@code <door>}: its objects with a frame
     * move with it).
     */
    static Read read(JsonObject in) throws IOException {
        ObjLoader.Model obj = ObjLoader.loadModel(stream(in.get("obj").getAsString()));
        WagonModelDecl decl = WagonModelDecl.parse("golden",
                in.has("model") ? in.getAsJsonObject("model") : objOnly());
        // a map is relative to the OBJ's folder, as the loader resolves it
        String folder = MtlParser.folderOf(decl.obj().substring(decl.obj().indexOf(':') + 1));
        Set<String> textured = new LinkedHashSet<>(in.has("textured") ? Golden.strings(in, "textured") : List.of());
        if (in.has("mtl")) {
            MtlParser.parse(stream(in.get("mtl").getAsString())).forEach((material, map) -> {
                if (MtlParser.resolve(folder, map) != null) {
                    textured.add(material);
                }
            });
        }
        Map<String, String> animated = new LinkedHashMap<>();
        for (Map.Entry<String, JsonElement> entry : in.entrySet()) {
            if (entry.getKey().startsWith("anim_")) {
                String door = entry.getKey().substring("anim_".length()).toLowerCase(Locale.ROOT);
                IrAnim.parse(stream(entry.getValue().getAsString())).forEach((object, frames) -> {
                    if (!frames.isEmpty()) {
                        animated.put(object, door);
                    }
                });
            }
        }
        List<ModelParts.Part> parts = new ArrayList<>();
        List<String> objects = new ArrayList<>();
        for (ObjLoader.Part part : obj.parts()) {
            parts.add(new ModelParts.Part(part.object(), part.material(), textured.contains(part.material()),
                    corners(part.mesh())));
            objects.add(part.object());
        }
        return new Read(objects, ModelParts.of(parts, new ModelParts.Declaration(decl.bogies(), decl.skip(),
                animated, decl.handbrake())));
    }

    private static JsonObject objOnly() {
        JsonObject json = new JsonObject();
        json.addProperty("obj", "model.obj");
        return json;
    }

    private static ByteArrayInputStream stream(String text) {
        return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8));
    }

    private static float[] corners(Mesh mesh) {
        float[] corners = new float[mesh.quads().size() * 12];
        int n = 0;
        for (Mesh.Quad q : mesh.quads()) {
            for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                corners[n++] = v.x();
                corners[n++] = v.y();
                corners[n++] = v.z();
            }
        }
        return corners;
    }

    private static JsonObject write(Read read) {
        ModelParts parts = read.parts();
        JsonObject out = new JsonObject();
        JsonArray roles = new JsonArray();
        for (int i = 0; i < read.objects().size(); i++) {
            ModelParts.Role role = parts.roles().get(i);
            JsonObject r = new JsonObject();
            r.addProperty("object", read.objects().get(i));
            r.addProperty("place", role.place().name());
            r.addProperty("front", role.front());
            r.add("owner", Golden.string(role.owner()));
            r.addProperty("index", role.index());
            r.add("light", light(role.light()));
            roles.add(r);
        }
        out.add("parts", roles);
        JsonArray groups = new JsonArray();
        parts.lightGroups().forEach(groups::add);
        out.add("light_groups", groups);
        JsonArray bogies = new JsonArray();
        for (ModelParts.Bogie bogie : new ModelParts.Bogie[]{parts.frontBogie(), parts.rearBogie()}) {
            JsonObject b = new JsonObject();
            b.add("pivot_z", Golden.number(bogie.pivotZ()));
            JsonArray wheels = new JsonArray();
            for (ModelParts.Wheel w : bogie.wheels()) {
                JsonObject wheel = new JsonObject();
                wheel.addProperty("object", w.object());
                wheel.add("axle_obj", Golden.numbers(w.axleX(), w.axleY()));
                wheel.add("center", Golden.numbers(w.centerY(), w.centerZ()));
                wheel.add("radius", Golden.number(w.radius()));
                wheels.add(wheel);
            }
            b.add("wheels", wheels);
            bogies.add(b);
        }
        out.add("bogies", bogies);
        out.add("controls", controls(parts.controls()));
        out.add("door_leaves", controls(parts.doorLeaves()));
        JsonArray doors = new JsonArray();
        for (ModelParts.Door door : parts.doors()) {
            JsonObject d = new JsonObject();
            d.addProperty("id", door.id());
            JsonArray objects = new JsonArray();
            door.objects().forEach(objects::add);
            d.add("objects", objects);
            doors.add(d);
        }
        out.add("doors", doors);
        JsonArray couplers = new JsonArray();
        for (ModelParts.Coupler c : parts.couplers()) {
            JsonObject coupler = new JsonObject();
            coupler.addProperty("front", c.front());
            coupler.addProperty("shown", c.shown().name());
            coupler.add("pivot", Golden.numbers(c.pivot()));
            couplers.add(coupler);
        }
        out.add("couplers", couplers);
        JsonArray lamps = new JsonArray();
        for (ModelParts.Lamp lamp : parts.lamps()) {
            JsonObject l = new JsonObject();
            l.add("at", Golden.numbers(lamp.x(), lamp.y(), lamp.z()));
            l.addProperty("group", lamp.group());
            l.addProperty("invert", lamp.invert());
            lamps.add(l);
        }
        out.add("lamps", lamps);
        JsonArray headlights = new JsonArray();
        for (ModelParts.Headlight h : parts.headlights()) {
            JsonObject l = new JsonObject();
            l.add("at", Golden.numbers(h.x(), h.y(), h.z()));
            l.add("dir_z", Golden.number(h.dirZ()));
            l.add("radius", Golden.number(h.radius()));
            l.addProperty("rgb", String.format(Locale.ROOT, "%06X", h.rgb()));
            l.addProperty("group", h.group());
            l.addProperty("invert", h.invert());
            headlights.add(l);
        }
        out.add("headlights", headlights);
        JsonArray dropped = new JsonArray();
        parts.droppedGroups().forEach(dropped::add);
        out.add("dropped_groups", dropped);
        out.addProperty("skipped", parts.skipped());
        return out;
    }

    /** {group, fullbright, interior, invert} of a light. */
    private static JsonArray light(ModelParts.Light light) {
        JsonArray l = new JsonArray();
        l.add(light.group());
        l.add(light.fullbright());
        l.add(light.interior());
        l.add(light.invert());
        return l;
    }

    private static JsonArray controls(List<ModelParts.Control> controls) {
        JsonArray out = new JsonArray();
        for (ModelParts.Control c : controls) {
            ObjectRole.Control role = c.role();
            JsonObject control = new JsonObject();
            control.addProperty("key", role.key());
            control.addProperty("kind", role.kind().name());
            control.addProperty("group", role.group());
            control.add("label", Golden.string(role.label()));
            JsonArray flags = new JsonArray();
            if (role.toggle()) {
                flags.add("TOGGLE");
            }
            if (role.press()) {
                flags.add("PRESS");
            }
            if (role.invert()) {
                flags.add("INVERT");
            }
            if (role.hide()) {
                flags.add("HIDE");
            }
            if (role.noTouch()) {
                flags.add("NOTOUCH");
            }
            if (role.global()) {
                flags.add("GLOBAL");
            }
            control.add("flags", flags);
            control.add("offset", Golden.number(role.offset()));
            control.add("range", Golden.numbers(role.rangeMin(), role.rangeMax()));
            control.addProperty("interior", c.interior());
            control.add("pivot", c.pivot() == null ? com.google.gson.JsonNull.INSTANCE : Golden.numbers(c.pivot()));
            control.add("axis", Golden.numbers(c.axis()));
            control.add("degrees", Golden.number(c.degrees()));
            control.add("slide", Golden.numbers(c.slide()));
            control.add("box_min", Golden.numbers(c.boxMin()));
            control.add("box_max", Golden.numbers(c.boxMax()));
            out.add(control);
        }
        return out;
    }
}
