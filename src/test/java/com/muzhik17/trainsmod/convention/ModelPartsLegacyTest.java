package com.muzhik17.trainsmod.convention;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.joml.Vector3f;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.ObjLoader;
import com.muzhik17.trainsmod.stock.ObjFrame;

/**
 * The refactor gate of {@link ModelParts} (editor.md 4.6, item 1): on every
 * wagon model of the example pack and, if it is here, of MVP, the parts read
 * by {@link ModelParts} are what the model loader made of them before
 * ({@code IrStockModel.load} at bbfd510, transcribed below as {@link Legacy}
 * — the same steps on the same floats, its meshes left out): each part's
 * place, owner and light tag, the light groups, the controls and door leaves
 * with their flags, hinges, slides and boxes, the animated doors, the
 * bogies' pivots and wheelsets, the coupler heads and pivots, the cabin
 * lamps (as a set: their order within one glowing part is new), the
 * headlights, the groups dropped as too long and the count of parts not
 * drawn. Compared bit for bit; what differs is named by model and line,
 * and only counts are printed — no MVP geometry leaves the test.
 *
 * <p>{@link Legacy} is frozen: it is the old loader, not a second copy of the
 * rules to keep in step. When {@link ModelParts} departs from it on purpose,
 * this test goes (the golden {@code model_parts} cases pin the behaviour).
 */
class ModelPartsLegacyTest {

    private static final Path EXAMPLE = Path.of("run/rwat_packs/RwatExamplePack");
    private static final Path MVP = Path.of("run/rwat_packs/MatoiVanillaPack");

    @Test
    void theExamplePackReadsAsTheOldLoaderReadIt() throws IOException {
        int[] counts = compare(EXAMPLE);
        assertEquals(3, counts[0], "the example pack's models");
    }

    @Test
    void mvpReadsAsTheOldLoaderReadIt() throws IOException {
        assumeTrue(Files.isDirectory(MVP), "no MVP pack in " + MVP + " (roadmap R12): its models are not compared");
        int[] counts = compare(MVP);
        assertTrue(counts[0] >= 40, "MVP's models: " + counts[0]);
    }

    /** {models, parts, controls, lamps, headlights} compared in the pack; fails on the first model that differs. */
    private static int[] compare(Path pack) throws IOException {
        int[] counts = new int[5];
        List<String> differing = new ArrayList<>();
        for (PackModels.Model model : PackModels.of(pack)) {
            List<String> old = Legacy.read(model.obj(), model.textured(), model.animated(), model.decl().bogies(),
                    model.decl().skip(), model.decl().handbrake());
            ModelParts parts = ModelParts.of(model.parts(), model.declaration());
            List<String> now = summary(model.obj(), parts);
            if (!old.equals(now)) {
                differing.add(model.id() + " " + firstDifference(old, now));
            }
            counts[0]++;
            counts[1] += model.obj().parts().size();
            counts[2] += parts.controls().size() + parts.doorLeaves().size();
            counts[3] += parts.lamps().size();
            counts[4] += parts.headlights().size();
        }
        System.out.printf("%s: %d models, %d parts, %d controls and leaves, %d cabin lamps, %d headlights"
                + " read as before%n", pack.getFileName(), counts[0], counts[1], counts[2], counts[3], counts[4]);
        assertTrue(differing.isEmpty(), "read otherwise than the old loader: " + differing);
        return counts;
    }

    /** The first line where two summaries part (by its number: the lines may hold the model's numbers). */
    private static String firstDifference(List<String> old, List<String> now) {
        for (int i = 0; i < Math.min(old.size(), now.size()); i++) {
            if (!old.get(i).equals(now.get(i))) {
                String what = old.get(i).split(" ", 2)[0];
                return "at line " + i + " (" + what + ")";
            }
        }
        return "in length: " + old.size() + " lines before, " + now.size() + " now";
    }

    // --- the summary of what ModelParts read ---

    private static List<String> summary(ObjLoader.Model obj, ModelParts parts) {
        List<String> lines = new ArrayList<>();
        for (int i = 0; i < obj.parts().size(); i++) {
            ModelParts.Role role = parts.roles().get(i);
            lines.add(partLine(i, role.place().name(), role.front(), role.owner(), tag(role.light())));
        }
        lines.add("groups " + parts.lightGroups());
        for (ModelParts.Control c : parts.controls()) {
            lines.add(controlLine("control", c.role(), c.interior(), c.pivot(), c.axis(), c.degrees(), c.slide(),
                    c.boxMin(), c.boxMax()));
        }
        for (ModelParts.Control c : parts.doorLeaves()) {
            lines.add(controlLine("leaf", c.role(), c.interior(), c.pivot(), c.axis(), c.degrees(), c.slide(),
                    c.boxMin(), c.boxMax()));
        }
        for (ModelParts.Door door : parts.doors()) {
            lines.add("door " + door.id() + " " + door.objects());
        }
        for (ModelParts.Bogie bogie : new ModelParts.Bogie[]{parts.frontBogie(), parts.rearBogie()}) {
            lines.add("bogie " + bits(bogie.pivotZ()));
            for (ModelParts.Wheel w : bogie.wheels()) {
                lines.add("wheel " + w.object() + " " + bits(w.centerY(), w.centerZ(), w.radius()));
            }
        }
        for (ModelParts.Coupler c : parts.couplers()) {
            lines.add("coupler " + c.front() + " " + c.shown() + " " + bits(c.pivot()));
        }
        List<String> lamps = new ArrayList<>();
        for (ModelParts.Lamp lamp : parts.lamps()) {
            lamps.add(bits(lamp.x(), lamp.y(), lamp.z()) + " " + lamp.group());
        }
        lamps.sort(null);
        lamps.forEach(lamp -> lines.add("lamp " + lamp));
        for (ModelParts.Headlight h : parts.headlights()) {
            lines.add("headlight " + bits(h.x(), h.y(), h.z(), h.dirZ(), h.radius()) + " " + h.rgb() + " "
                    + h.group());
        }
        lines.add("dropped " + parts.droppedGroups());
        lines.add("skipped " + parts.skipped());
        return lines;
    }

    private static int tag(ModelParts.Light light) {
        return Legacy.tag(light.group(), light.fullbright(), light.interior(), light.invert());
    }

    private static String partLine(int i, String place, boolean front, String owner, int tag) {
        return "part " + i + " " + place + " " + front + " " + owner + " " + tag;
    }

    private static String controlLine(String what, ObjectRole.Control role, boolean interior, float[] pivot,
            float[] axis, float degrees, float[] slide, float[] boxMin, float[] boxMax) {
        return what + " " + role + " " + interior + " " + (pivot == null ? "null" : bits(pivot)) + " "
                + bits(axis) + " " + bits(degrees) + " " + bits(slide) + " " + bits(boxMin) + " " + bits(boxMax);
    }

    private static String bits(float... values) {
        StringBuilder s = new StringBuilder();
        for (float v : values) {
            s.append(Integer.toHexString(Float.floatToRawIntBits(v))).append(',');
        }
        return s.toString();
    }

    private static float[] array(Vector3f v) {
        return v == null ? null : new float[]{v.x, v.y, v.z};
    }

    /**
     * {@code IrStockModel.load} as it stood at bbfd510, before {@link ModelParts}:
     * its loop over the parts, its builders and its lamp islands, word for
     * word but for the textures (a material is textured or not) and the
     * meshes it built (left out; what it measured from them is kept). Frozen.
     */
    static final class Legacy {

        private static final float Y_LIFT = (float) ObjFrame.Y_LIFT;
        private static final float WHEEL_RADIUS = 0.53F;
        private static final List<String> DEFAULT_SKIP_PREFIXES = List.of("CARGO_FILL");
        private static final float MIN_LAMP_SIZE = 0.3F;

        private Legacy() {
        }

        static int tag(int group, boolean fullbright, boolean interior, boolean linvert) {
            return (group + 1 & 0xFF) | (fullbright ? 1 << 8 : 0) | (interior ? 1 << 9 : 0) | (linvert ? 1 << 10 : 0);
        }

        private static final class ControlBuilder {
            ObjectRole.Control role;
            boolean meshes;
            boolean interior;
            String pivotObject;
            float degrees;
            final List<float[]> pivotCorners = new ArrayList<>();
            final float[] box = {Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE,
                -Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};

            void add(ObjectRole objectRole, String object, ObjLoader.Part part) {
                role = role == null ? objectRole.control() : merge(role, objectRole.control());
                interior |= ObjectRole.hasToken(object, "INTERIOR");
                if (objectRole.pivot() && pivotObject == null) {
                    pivotObject = object;
                    degrees = objectRole.pivotDegrees();
                }
                if (object.equals(pivotObject)) {
                    for (Mesh.Quad q : part.mesh().quads()) {
                        for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                            pivotCorners.add(new float[]{v.x(), v.y(), v.z()});
                        }
                    }
                }
            }

            void bound(Mesh placed) {
                float[] b = bounds(placed);
                for (int i = 0; i < 3; i++) {
                    box[i] = Math.min(box[i], b[i]);
                    box[i + 3] = Math.max(box[i + 3], b[i + 3]);
                }
            }

            String build(String what, boolean handbrake) {
                if (!meshes || box[0] > box[3]) {
                    return null;
                }
                Vector3f pivot = null;
                Vector3f axis = new Vector3f(0.0F, 1.0F, 0.0F);
                if (!pivotCorners.isEmpty()) {
                    double[][] pa = PivotAxis.of(pivotCorners);
                    pivot = new Vector3f((float) pa[0][2], (float) (pa[0][1] + ObjFrame.Y_LIFT), (float) -pa[0][0]);
                    axis = new Vector3f((float) pa[1][2], (float) pa[1][1], (float) -pa[1][0]);
                }
                Vector3f slide = new Vector3f(role.slideZ(), role.slideY(), -role.slideX());
                ObjectRole.Control built = handbrake ? role.withKind(ObjectRole.Kind.HANDBRAKE) : role;
                return controlLine(what, built, interior, array(pivot), array(axis), degrees, array(slide),
                        new float[]{box[0], box[1], box[2]}, new float[]{box[3], box[4], box[5]});
            }

            private static ObjectRole.Control merge(ObjectRole.Control a, ObjectRole.Control b) {
                return new ObjectRole.Control(a.kind(), a.id(), a.key(),
                        a.group().equals(a.key()) ? b.group() : a.group(),
                        a.label() != null ? a.label() : b.label(),
                        a.toggle() || b.toggle(), a.press() || b.press(), a.invert() || b.invert(),
                        a.hide() || b.hide(), a.noTouch() || b.noTouch(), a.global() || b.global(),
                        a.offset() != 0.0F ? a.offset() : b.offset(),
                        b.rangeMin() != 0.0F || b.rangeMax() != 1.0F ? b.rangeMin() : a.rangeMin(),
                        b.rangeMin() != 0.0F || b.rangeMax() != 1.0F ? b.rangeMax() : a.rangeMax(),
                        b.slideX() != 0.0F ? b.slideX() : a.slideX(),
                        b.slideY() != 0.0F ? b.slideY() : a.slideY(),
                        b.slideZ() != 0.0F ? b.slideZ() : a.slideZ());
            }
        }

        private static final class CouplerBuilder {
            boolean meshes;
            final float[] box = {Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE,
                -Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};

            void bound(Mesh placed) {
                float[] b = bounds(placed);
                for (int i = 0; i < 3; i++) {
                    box[i] = Math.min(box[i], b[i]);
                    box[i + 3] = Math.max(box[i + 3], b[i + 3]);
                }
            }
        }

        private static final class BogieBuilder {
            final float pivotZ;
            final Map<String, WheelBuilder> wheels = new LinkedHashMap<>();

            BogieBuilder(double pivot) {
                this.pivotZ = (float) pivot;
            }
        }

        private static final class WheelBuilder {
            float minX = Float.MAX_VALUE;
            float maxX = -Float.MAX_VALUE;
            float minY = Float.MAX_VALUE;
            float maxY = -Float.MAX_VALUE;

            void add(ObjLoader.Part part) {
                for (Mesh.Quad q : part.mesh().quads()) {
                    for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                        minX = Math.min(minX, v.x());
                        maxX = Math.max(maxX, v.x());
                        minY = Math.min(minY, v.y());
                        maxY = Math.max(maxY, v.y());
                    }
                }
            }
        }

        static List<String> read(ObjLoader.Model obj, Set<String> textured, Map<String, String> animated,
                double[] declBogies, List<String> declSkip, List<String> handbrake) {
            List<String> lines = new ArrayList<>();
            double[] pivots = declBogies != null ? declBogies : measurePivots(obj.parts());
            List<String> skipPrefixes = new ArrayList<>(DEFAULT_SKIP_PREFIXES);
            skipPrefixes.addAll(declSkip);
            Map<String, Set<String>> doors = new LinkedHashMap<>();
            Map<String, ControlBuilder> controls = new LinkedHashMap<>();
            Map<String, ControlBuilder> leaves = new LinkedHashMap<>();
            DoorLeaves doorLeaves = DoorLeaves.of(obj.parts().stream().map(ObjLoader.Part::object).toList(),
                    skipPrefixes, animated.keySet());
            List<String> lightGroups = new ArrayList<>();
            Set<Integer> interiorGroups = new HashSet<>();
            List<float[]> lampCandidates = new ArrayList<>();
            List<String> headlights = new ArrayList<>();
            BogieBuilder front = new BogieBuilder(pivots[0]);
            BogieBuilder rear = new BogieBuilder(pivots[pivots.length - 1]);
            Map<ObjectRole.Coupled, CouplerBuilder> couplers = new LinkedHashMap<>();
            Set<String> droppedGroups = new LinkedHashSet<>();
            // where each part went, the index-free half of the line: its index comes from the lists
            List<Object[]> placed = new ArrayList<>();
            int skipped = 0;
            for (ObjLoader.Part part : obj.parts()) {
                String object = part.object();
                ObjectRole parsed = ObjectRole.parse(object);
                droppedGroups.addAll(GroupName.tooLong(parsed));
                ObjectRole role = GroupName.fit(parsed);
                boolean widget = role.control() != null && role.control().kind() == ObjectRole.Kind.WIDGET;
                ObjectRole.Coupled coupled = ObjectRole.coupled(object);
                if (object.contains("HIDE") && !widget && coupled == null) {
                    skipped++;
                    placed.add(new Object[]{"HIDDEN", false, null, 0});
                    continue;
                }
                if (startsWithAny(object, skipPrefixes)) {
                    skipped++;
                    placed.add(new Object[]{"SKIPPED", false, null, 0});
                    continue;
                }
                BogieBuilder bogie = coupled != null ? null : object.startsWith("BOGEY_FRONT") ? front
                        : object.startsWith("BOGEY_REAR") ? rear : null;
                CouplerBuilder coupler = coupled != null
                        ? couplers.computeIfAbsent(coupled, c -> new CouplerBuilder()) : null;
                if (bogie != null && object.contains("_WHEEL_")) {
                    bogie.wheels.computeIfAbsent(object, n -> new WheelBuilder()).add(part);
                    placed.add(new Object[]{textured.contains(part.material()) ? "WHEEL" : "UNTEXTURED",
                        bogie == front, object, 0});
                    continue;
                }
                String track = bogie == null && coupler == null ? animated.get(object) : null;
                ObjectRole leafRole = doorLeaves.leaf(object);
                ControlBuilder control = leafRole != null
                        ? leaves.computeIfAbsent(leafRole.control().key(), k -> new ControlBuilder())
                        : bogie == null && track == null && role.control() != null
                                ? controls.computeIfAbsent(role.control().key(), k -> new ControlBuilder())
                                : null;
                String key = leafRole != null ? leafRole.control().key()
                        : control != null ? role.control().key() : null;
                if (control != null) {
                    control.add(leafRole != null ? leafRole : role, object, part);
                }
                if (!textured.contains(part.material())) {
                    skipped++;
                    placed.add(new Object[]{"UNTEXTURED", false, key != null ? key : track, 0});
                    continue;
                }
                int group = -1;
                if (role.lightGroup() != null) {
                    group = lightGroups.indexOf(role.lightGroup());
                    if (group < 0) {
                        group = lightGroups.size();
                        lightGroups.add(role.lightGroup());
                    }
                }
                boolean interiorLit = ObjectRole.hasToken(object, "INTERIOR");
                if (interiorLit && group >= 0) {
                    interiorGroups.add(group);
                }
                int tag = tag(group, role.fullbright(), interiorLit, role.lightInvert());
                String place;
                boolean atFront = false;
                if (track != null) {
                    doors.computeIfAbsent(track, id -> new LinkedHashSet<>()).add(object);
                    place = "ANIMATED";
                    key = track;
                } else if (control != null) {
                    control.meshes = true;
                    place = leafRole != null ? "DOOR_LEAF" : "CONTROL";
                } else if (coupler != null) {
                    coupler.meshes = true;
                    place = "COUPLER";
                    atFront = coupled.front();
                } else if (bogie != null) {
                    place = "BOGIE";
                    atFront = bogie == front;
                } else {
                    place = object.startsWith("INTERIOR") ? "INTERIOR" : "BODY";
                }
                placed.add(new Object[]{place, atFront, key, tag});
                float pivotZ = bogie != null ? bogie.pivotZ : 0.0F;
                Mesh placedMesh = new Mesh();
                for (Mesh.Quad q : part.mesh().quads()) {
                    placedMesh.add(new Mesh.Quad(
                            toModelSpace(q.v0(), pivotZ), toModelSpace(q.v1(), pivotZ),
                            toModelSpace(q.v2(), pivotZ), toModelSpace(q.v3(), pivotZ),
                            q.r(), q.g(), q.b(), q.a(), tag));
                }
                if (control != null) {
                    control.bound(placedMesh);
                }
                if (coupler != null) {
                    coupler.bound(placedMesh);
                }
                if (bogie == null && track == null) {
                    if (role.headlight()) {
                        headlights.add(headlight(placedMesh, role, group));
                    } else if (role.fullbright() && control == null) {
                        lampCandidates.addAll(lampIslands(placedMesh, group));
                    }
                }
            }
            for (int i = 0; i < placed.size(); i++) {
                Object[] p = placed.get(i);
                lines.add(partLine(i, (String) p[0], (Boolean) p[1], (String) p[2], (Integer) p[3]));
            }
            lines.add("groups " + lightGroups);
            controls.forEach((key, control) -> {
                String built = control.build("control", handbrake.contains(key));
                if (built != null) {
                    lines.add(built);
                }
            });
            leaves.forEach((key, leaf) -> {
                String built = leaf.build("leaf", false);
                if (built != null) {
                    lines.add(built);
                }
            });
            doors.forEach((id, objects) -> lines.add("door " + id + " " + new ArrayList<>(objects)));
            for (BogieBuilder bogie : new BogieBuilder[]{front, rear}) {
                lines.add("bogie " + bits(bogie.pivotZ));
                bogie.wheels.forEach((object, wheel) -> {
                    float axleX = (wheel.minX + wheel.maxX) / 2.0F;
                    float axleY = (wheel.minY + wheel.maxY) / 2.0F;
                    lines.add("wheel " + object + " " + bits(axleY + Y_LIFT, -axleX - bogie.pivotZ, WHEEL_RADIUS));
                });
            }
            for (boolean atFront : new boolean[]{true, false}) {
                float[] box = {Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE,
                    -Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};
                couplers.forEach((coupled, coupler) -> {
                    if (coupled.front() == atFront && coupler.meshes) {
                        for (int i = 0; i < 3; i++) {
                            box[i] = Math.min(box[i], coupler.box[i]);
                            box[i + 3] = Math.max(box[i + 3], coupler.box[i + 3]);
                        }
                    }
                });
                if (box[0] > box[3]) {
                    continue;
                }
                float[] pivot = {0.0F, (box[1] + box[4]) * 0.5F, atFront ? box[2] : box[5]};
                couplers.forEach((coupled, coupler) -> {
                    if (coupled.front() == atFront && coupler.meshes) {
                        lines.add("coupler " + atFront + " " + coupled.shown() + " " + bits(pivot));
                    }
                });
            }
            List<String> lamps = new ArrayList<>();
            for (float[] lamp : lampCandidates) {
                int group = (int) lamp[3];
                if (group >= 0 && interiorGroups.contains(group)) {
                    lamps.add(bits(lamp[0], lamp[1], lamp[2]) + " " + group);
                }
            }
            lamps.sort(null);
            lamps.forEach(lamp -> lines.add("lamp " + lamp));
            lines.addAll(headlights);
            lines.add("dropped " + droppedGroups);
            lines.add("skipped " + skipped);
            return lines;
        }

        private static String headlight(Mesh placed, ObjectRole role, int group) {
            float[] box = bounds(placed);
            float cz = (box[2] + box[5]) * 0.5F;
            boolean forward = cz >= 0.0F;
            return "headlight " + bits((box[0] + box[3]) * 0.5F, (box[1] + box[4]) * 0.5F,
                    forward ? box[5] + 0.02F : box[2] - 0.02F, forward ? 1.0F : -1.0F,
                    Math.max(box[3] - box[0], box[4] - box[1]) * 0.5F) + " " + role.rgb() + " " + group;
        }

        static float[] bounds(Mesh mesh) {
            float[] box = {Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE,
                -Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};
            for (Mesh.Quad q : mesh.quads()) {
                for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                    box[0] = Math.min(box[0], v.x());
                    box[1] = Math.min(box[1], v.y());
                    box[2] = Math.min(box[2], v.z());
                    box[3] = Math.max(box[3], v.x());
                    box[4] = Math.max(box[4], v.y());
                    box[5] = Math.max(box[5], v.z());
                }
            }
            return box;
        }

        private static double[] measurePivots(List<ObjLoader.Part> parts) {
            float[] frontX = {Float.MAX_VALUE, -Float.MAX_VALUE};
            float[] rearX = {Float.MAX_VALUE, -Float.MAX_VALUE};
            for (ObjLoader.Part part : parts) {
                String object = part.object();
                float[] range = object.startsWith("BOGEY_FRONT") ? frontX
                        : object.startsWith("BOGEY_REAR") ? rearX : null;
                if (range == null || object.contains("_WHEEL_") || object.contains("HIDE")) {
                    continue;
                }
                for (Mesh.Quad q : part.mesh().quads()) {
                    for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                        range[0] = Math.min(range[0], v.x());
                        range[1] = Math.max(range[1], v.x());
                    }
                }
            }
            double front = frontX[0] <= frontX[1] ? -(frontX[0] + frontX[1]) / 2.0 : 0.0;
            double rear = rearX[0] <= rearX[1] ? -(rearX[0] + rearX[1]) / 2.0 : 0.0;
            return new double[]{front, rear};
        }

        private static boolean startsWithAny(String name, List<String> prefixes) {
            for (String prefix : prefixes) {
                if (name.startsWith(prefix)) {
                    return true;
                }
            }
            return false;
        }

        private static Mesh.Vertex toModelSpace(Mesh.Vertex v, float pivotZ) {
            return new Mesh.Vertex(
                    v.z(), v.y() + Y_LIFT, -v.x() - pivotZ,
                    v.u(), v.v(),
                    v.nz(), v.ny(), -v.nx());
        }

        /** The old {@code LampIslands.of}: islands by a hashed corner key, in a hash map's order. */
        static List<float[]> lampIslands(Mesh mesh, int group) {
            List<Mesh.Quad> quads = mesh.quads();
            int[] parent = new int[quads.size()];
            for (int i = 0; i < parent.length; i++) {
                parent[i] = i;
            }
            Map<Long, Integer> firstQuadAt = new HashMap<>();
            for (int i = 0; i < quads.size(); i++) {
                Mesh.Quad q = quads.get(i);
                for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                    Integer other = firstQuadAt.putIfAbsent(hashKey(v.x(), v.y(), v.z()), i);
                    if (other != null) {
                        union(parent, i, other);
                    }
                }
            }
            Map<Integer, float[]> boxes = new HashMap<>();
            for (int i = 0; i < quads.size(); i++) {
                float[] box = boxes.computeIfAbsent(find(parent, i), r -> new float[]{
                    Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE,
                    -Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE});
                Mesh.Quad q = quads.get(i);
                for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                    box[0] = Math.min(box[0], v.x());
                    box[1] = Math.min(box[1], v.y());
                    box[2] = Math.min(box[2], v.z());
                    box[3] = Math.max(box[3], v.x());
                    box[4] = Math.max(box[4], v.y());
                    box[5] = Math.max(box[5], v.z());
                }
            }
            List<float[]> lamps = new ArrayList<>();
            for (float[] box : boxes.values()) {
                float dx = box[3] - box[0];
                float dy = box[4] - box[1];
                float dz = box[5] - box[2];
                if (Math.sqrt(dx * dx + dy * dy + dz * dz) >= MIN_LAMP_SIZE) {
                    lamps.add(new float[]{(box[0] + box[3]) * 0.5F, (box[1] + box[4]) * 0.5F,
                        (box[2] + box[5]) * 0.5F, group});
                }
            }
            return lamps;
        }

        /** The old corner key: the rounded position hashed into 64 bits, which two far corners could share. */
        static long hashKey(float x, float y, float z) {
            long kx = Math.round(x * 1.0e4F);
            long ky = Math.round(y * 1.0e4F);
            long kz = Math.round(z * 1.0e4F);
            return (kx * 73856093L) ^ (ky * 19349663L) ^ (kz * 83492791L);
        }

        private static int find(int[] parent, int i) {
            while (parent[i] != i) {
                parent[i] = parent[parent[i]];
                i = parent[i];
            }
            return i;
        }

        private static void union(int[] parent, int a, int b) {
            int ra = find(parent, a);
            int rb = find(parent, b);
            if (ra != rb) {
                parent[ra] = rb;
            }
        }
    }
}
