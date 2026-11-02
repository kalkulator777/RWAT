package com.muzhik17.trainsmod.golden;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

import org.joml.Matrix4f;
import org.junit.jupiter.api.Test;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.client.render.model.IrAnim;
import com.muzhik17.trainsmod.client.render.model.MtlParser;
import com.muzhik17.trainsmod.convention.DoorLeaves;
import com.muzhik17.trainsmod.convention.ObjectRole;
import com.muzhik17.trainsmod.convention.PivotAxis;
import com.muzhik17.trainsmod.kinematics.FloorCheck;
import com.muzhik17.trainsmod.kinematics.RiderWalk;
import com.muzhik17.trainsmod.stock.FloorRegion;
import com.muzhik17.trainsmod.stock.ObjFrame;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypeParser;

/**
 * The engine against the shared golden data of {@code fixtures/golden/} — the
 * cases the converter's Python ports ({@code tools/tests/test_golden.py}) and
 * the editor's TypeScript run too. Each method reads one file; the README there
 * says what its input and expected hold.
 */
class GoldenTest {

    /** {@code o}/{@code g} line → the object's name ({@link ObjectRole#objectName}). */
    @Test
    void objectNames() throws IOException {
        Golden.check("object_names.json", in -> Golden.string(ObjectRole.objectName(in.get("line").getAsString())));
    }

    /** {@code newmtl}/{@code usemtl} line → the material's name ({@link MtlParser#materialName}). */
    @Test
    void materialNames() throws IOException {
        Golden.check("material_names.json", in -> Golden.string(
                MtlParser.materialName(in.get("line").getAsString(), in.get("keyword").getAsString())));
    }

    /** Object name → what the convention reads in it ({@link ObjectRole}). */
    @Test
    void objectRoles() throws IOException {
        Golden.check("object_roles.json", in -> {
            String name = in.get("name").getAsString();
            ObjectRole role = ObjectRole.parse(name);
            JsonObject out = new JsonObject();
            out.add("control", control(role.control()));
            out.add("pivot_degrees", role.pivot() ? Golden.number(role.pivotDegrees()) : JsonNull.INSTANCE);
            out.add("light_group", Golden.string(role.lightGroup()));
            out.addProperty("light_invert", role.lightInvert());
            out.addProperty("fullbright", role.fullbright());
            out.addProperty("headlight", role.headlight());
            out.addProperty("rgb", String.format("%06X", role.rgb()));
            out.addProperty("interior_token", ObjectRole.hasToken(name, "INTERIOR"));
            ObjectRole door = ObjectRole.door(name);
            if (door == null) {
                out.add("door", JsonNull.INSTANCE);
            } else {
                JsonObject leaf = control(door.control()).getAsJsonObject();
                leaf.add("pivot_degrees", door.pivot() ? Golden.number(door.pivotDegrees()) : JsonNull.INSTANCE);
                out.add("door", leaf);
            }
            ObjectRole.Coupled coupled = ObjectRole.coupled(name);
            if (coupled == null) {
                out.add("coupled", JsonNull.INSTANCE);
            } else {
                JsonObject head = new JsonObject();
                head.addProperty("front", coupled.front());
                head.addProperty("shown", coupled.shown().name());
                out.add("coupled", head);
            }
            return out;
        });
    }

    private static JsonElement control(ObjectRole.Control c) {
        if (c == null) {
            return JsonNull.INSTANCE;
        }
        JsonObject out = new JsonObject();
        out.addProperty("kind", c.kind().name());
        out.addProperty("gauge", c.kind().gauge());
        out.addProperty("id", c.id());
        out.addProperty("key", c.key());
        out.addProperty("group", c.group());
        out.add("label", Golden.string(c.label()));
        out.addProperty("toggle", c.toggle());
        out.addProperty("press", c.press());
        out.addProperty("invert", c.invert());
        out.addProperty("hide", c.hide());
        out.addProperty("no_touch", c.noTouch());
        out.addProperty("global", c.global());
        out.add("offset", Golden.number(c.offset()));
        out.add("range", Golden.numbers(c.rangeMin(), c.rangeMax()));
        out.add("slide", Golden.numbers(c.slideX(), c.slideY(), c.slideZ()));
        return out;
    }

    /** Points and boxes from the OBJ frame to the model frame and back ({@link ObjFrame}). */
    @Test
    void objFrame() throws IOException {
        Golden.check("obj_frame.json", in -> {
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

    /** A hinge marker's corners → its hinge and axis ({@link PivotAxis}). */
    @Test
    void pivotAxis() throws IOException {
        Golden.check("pivot_axis.json", in -> {
            List<float[]> corners = new ArrayList<>();
            for (JsonElement corner : in.getAsJsonArray("corners")) {
                double[] c = Golden.doubles(corner);
                corners.add(new float[]{(float) c[0], (float) c[1], (float) c[2]});
            }
            double[][] pa = PivotAxis.of(corners);
            JsonObject out = new JsonObject();
            out.addProperty("points", PivotAxis.points(corners).size());
            out.add("centre", Golden.numbers(pa[0]));
            out.add("axis", Golden.numbers(pa[1]));
            return out;
        });
    }

    /** An IR {@code .anim} → its tracks as written and each frame in the model frame ({@link IrAnim}). */
    @Test
    void anim() throws IOException {
        Golden.check("anim.json", in -> {
            Map<String, List<float[]>> tracks;
            try {
                tracks = IrAnim.parse(new ByteArrayInputStream(in.get("text").getAsString().getBytes(StandardCharsets.UTF_8)));
            } catch (IOException | RuntimeException e) {
                JsonObject error = new JsonObject();
                error.addProperty("error", true);
                return error;
            }
            JsonObject written = new JsonObject();
            JsonObject model = new JsonObject();
            tracks.forEach((object, frames) -> {
                JsonArray rows = new JsonArray();
                JsonArray turned = new JsonArray();
                for (float[] frame : frames) {
                    rows.add(Golden.numbers(frame));
                    // row-major, as the file writes a frame
                    float[] m = new Matrix4f(IrAnim.toModelSpace(frame, (float) ObjFrame.Y_LIFT)).transpose().get(new float[16]);
                    turned.add(Golden.numbers(m));
                }
                written.add(object, rows);
                model.add(object, turned);
            });
            JsonObject out = new JsonObject();
            out.add("tracks", written);
            out.add("model", model);
            return out;
        });
    }

    /**
     * A floor of zones and doors, all in the model frame → where a rider's centre
     * fits ({@link FloorRegion}, by {@link WagonType.Interior#region(double, List, int)}),
     * and the answers to the case's questions.
     */
    @Test
    void floor() throws IOException {
        Golden.check("floor.json", in -> {
            List<WagonType.Interior.Zone> zones = new ArrayList<>();
            for (JsonElement zone : in.getAsJsonArray("zones")) {
                double[] z = Golden.doubles(zone);
                zones.add(new WagonType.Interior.Zone(z[0], z[1], z[2], z[3], z[4], z[5]));
            }
            List<WagonType.Door> doors = new ArrayList<>();
            if (in.has("doors")) {
                for (JsonElement element : in.getAsJsonArray("doors")) {
                    JsonObject d = element.getAsJsonObject();
                    double[] lo = Golden.doubles(d.get("min"));
                    double[] hi = Golden.doubles(d.get("max"));
                    doors.add(new WagonType.Door(d.get("id").getAsString(), lo[0], lo[1], lo[2], hi[0], hi[1], hi[2],
                            flag(d, "inner"), flag(d, "fixed"), flag(d, "connecting"), null));
                }
            }
            double margin = in.has("margin") ? in.get("margin").getAsDouble() : RiderWalk.PLAYER_HALF_WIDTH;
            int open = in.has("open") ? in.get("open").getAsInt() : 0;
            WagonType.Interior interior = new WagonType.Interior(zones);
            FloorRegion region = interior.region(margin, doors, open);
            JsonObject out = new JsonObject();
            JsonArray pieces = new JsonArray();
            region.pieces().forEach(p -> pieces.add(Golden.numbers(p.minX(), p.minZ(), p.maxX(), p.maxZ())));
            out.add("pieces", pieces);
            JsonArray cuts = new JsonArray();
            region.cuts().forEach(c -> cuts.add(Golden.numbers(c.minX(), c.minZ(), c.maxX(), c.maxZ())));
            out.add("cuts", cuts);
            JsonArray links = new JsonArray();
            region.links().forEach(l -> {
                JsonArray pair = new JsonArray();
                pair.add(l[0]);
                pair.add(l[1]);
                links.add(pair);
            });
            out.add("links", links);
            out.add("fits", answers(in, "fits", q -> new com.google.gson.JsonPrimitive(region.fits(q[0], q[1]))));
            out.add("nearest", answers(in, "nearest", q -> {
                double[] at = region.nearest(q[0], q[1]);
                return at == null ? JsonNull.INSTANCE : Golden.numbers(at);
            }));
            out.add("floor", answers(in, "floor", q -> Golden.number(interior.floorAt(q[0], q[1], margin))));
            out.add("reach", answers(in, "reach", q -> Golden.number(region.reach(q[0], q[1], (int) q[2], (int) q[3]))));
            return out;
        });
    }

    private static boolean flag(JsonObject json, String key) {
        return json.has(key) && json.get(key).getAsBoolean();
    }

    private static JsonArray answers(JsonObject in, String key, java.util.function.Function<double[], JsonElement> answer) {
        JsonArray out = new JsonArray();
        if (in.has(key)) {
            for (JsonElement question : in.getAsJsonArray(key)) {
                out.add(answer.apply(Golden.doubles(question)));
            }
        }
        return out;
    }

    /** A wagon type as the pack writes it (OBJ frame) → what the floor check says of it ({@link FloorCheck}). */
    @Test
    void floorCheck() throws IOException {
        Golden.check("floor_check.json", in -> {
            WagonType type = WagonTypeParser.parse("golden:case", in.getAsJsonObject("type"));
            JsonArray out = new JsonArray();
            FloorCheck.problems(type).forEach(out::add);
            return out;
        });
    }

    /**
     * A model's objects (name, textured or not, box in the OBJ frame), its skip
     * and animated objects, and the type's doors as the pack writes them → its
     * door leaves and the door each is ({@link DoorLeaves}).
     */
    @Test
    void doorLeaves() throws IOException {
        Golden.check("door_leaves.json", in -> {
            List<String> names = new ArrayList<>();
            in.getAsJsonArray("objects").forEach(o -> names.add(o.getAsJsonObject().get("name").getAsString()));
            DoorLeaves leaves = DoorLeaves.of(names, strings(in, "skip"), new LinkedHashSet<>(strings(in, "animated")));
            JsonObject typeJson = new JsonObject();
            typeJson.addProperty("length", 30.0);
            typeJson.add("bogies", Golden.numbers(8.0, -8.0));
            typeJson.addProperty("mass_t", 40.0);
            typeJson.add("doors", in.has("doors") ? in.get("doors") : new JsonArray());
            WagonType type = WagonTypeParser.parse("golden:leaves", typeJson);
            Map<String, List<String>> objects = new LinkedHashMap<>();
            Map<String, double[]> boxes = new LinkedHashMap<>();
            for (JsonElement element : in.getAsJsonArray("objects")) {
                JsonObject o = element.getAsJsonObject();
                ObjectRole leaf = leaves.leaf(o.get("name").getAsString());
                if (leaf == null) {
                    continue;
                }
                String key = leaf.control().key();
                objects.computeIfAbsent(key, k -> new ArrayList<>()).add(o.get("name").getAsString());
                if (o.has("textured") && !o.get("textured").getAsBoolean()) {
                    continue; // drawn by nothing: no box
                }
                double[] lo = Golden.doubles(o.get("min"));
                double[] hi = Golden.doubles(o.get("max"));
                double[] box = boxes.computeIfAbsent(key, k -> new double[]{Double.MAX_VALUE, Double.MAX_VALUE,
                        Double.MAX_VALUE, -Double.MAX_VALUE, -Double.MAX_VALUE, -Double.MAX_VALUE});
                for (int a = 0; a < 3; a++) {
                    box[a] = Math.min(box[a], lo[a]);
                    box[a + 3] = Math.max(box[a + 3], hi[a]);
                }
            }
            JsonArray keys = new JsonArray();
            leaves.keys().forEach(keys::add);
            JsonArray built = new JsonArray();
            objects.forEach((key, parts) -> {
                JsonObject leaf = new JsonObject();
                leaf.addProperty("key", key);
                JsonArray partNames = new JsonArray();
                parts.forEach(partNames::add);
                leaf.add("objects", partNames);
                double[] box = boxes.get(key);
                leaf.addProperty("drawn", box != null);
                int door = box == null ? -1 : DoorLeaves.door(type, new double[]{box[0], box[1], box[2]},
                        new double[]{box[3], box[4], box[5]});
                leaf.add("door", door < 0 ? JsonNull.INSTANCE : Golden.string(type.doors().get(door).id()));
                built.add(leaf);
            });
            JsonObject out = new JsonObject();
            out.add("keys", keys);
            out.add("leaves", built);
            return out;
        });
    }

    private static List<String> strings(JsonObject in, String key) {
        List<String> out = new ArrayList<>();
        if (in.has(key)) {
            in.getAsJsonArray(key).forEach(e -> out.add(e.getAsString()));
        }
        return out;
    }
}
