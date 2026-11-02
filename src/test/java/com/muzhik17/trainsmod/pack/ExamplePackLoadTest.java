package com.muzhik17.trainsmod.pack;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.function.Consumer;
import java.util.stream.Stream;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import com.muzhik17.trainsmod.client.render.model.IrAnim;
import com.muzhik17.trainsmod.client.render.model.Mesh;
import com.muzhik17.trainsmod.client.render.model.MtlParser;
import com.muzhik17.trainsmod.client.render.model.ObjLoader;
import com.muzhik17.trainsmod.client.render.model.WagonModelDecl;
import com.muzhik17.trainsmod.client.sound.SoundSet;
import com.muzhik17.trainsmod.convention.DoorLeaves;
import com.muzhik17.trainsmod.convention.ObjectRole;
import com.muzhik17.trainsmod.kinematics.CabArea;
import com.muzhik17.trainsmod.kinematics.FloorCheck;
import com.muzhik17.trainsmod.kinematics.RiderWalk;
import com.muzhik17.trainsmod.path.TileFootprint;
import com.muzhik17.trainsmod.stock.FloorRegion;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypeParser;

/**
 * The example pack ({@code run/rwat_packs/RwatExamplePack}, written by
 * {@code tools/gen_example_pack.py}, roadmap R11) loads as the game loads it
 * with nothing to report: no error and no warning from the type loader (the
 * reader's own and {@link FloorCheck}'s), the model and rail style readers,
 * {@code /rwatc packs validate}'s file check or the rwat block; every model
 * has its type and every type its model; every name has its lang key in both
 * languages; and the pack still shows the functions of the format it is
 * there to show (the OBJ naming convention, here; the JSON keys are held to
 * the schema by {@code tools/tests/test_example_pack.py}). The pack is in the
 * repository: this is never skipped.
 *
 * <p>The markup (format 1, the OBJ frame, read by the parser the loader
 * uses) is held to what the pack's README says it shows, walked as the engine
 * walks it ({@link RiderWalk}, {@link CabArea}): the coach's four zones are
 * reached through their doors, every way out and every gangway is where the
 * floor ends, the inner door is a wall shut and a passage open; the
 * shunter's steps lead out and both chairs are sat in, the second driving
 * back; every door leaf of a model lies in its door's box. Each of these
 * checks is shown to fail on a broken copy of the markup.
 */
class ExamplePackLoadTest {

    private static final Path PACK = Path.of("run/rwat_packs/RwatExamplePack");
    private static final String PACK_ID = "rwat/RwatExamplePack";
    private static final String NS = "rwat_example";
    private static final Set<String> TYPES = Set.of(NS + ":coach", NS + ":shunter", NS + ":gondola");

    /** {@code <root>/<ns>/<folder>/<id>.json} of the pack: id → file. */
    private static Map<String, Path> declarations(String root, String folder) throws IOException {
        assertTrue(Files.isDirectory(PACK), PACK + " is missing: python -I tools/gen_example_pack.py writes it");
        Map<String, Path> found = new TreeMap<>();
        Path base = PACK.resolve(root);
        try (Stream<Path> namespaces = Files.list(base)) {
            for (Path namespace : namespaces.sorted().toList()) {
                Path dir = namespace.resolve(folder);
                if (!Files.isDirectory(dir)) {
                    continue;
                }
                try (Stream<Path> files = Files.list(dir)) {
                    for (Path file : files.sorted().toList()) {
                        String name = file.getFileName().toString();
                        if (name.endsWith(".json")) {
                            found.put(namespace.getFileName() + ":" + name.substring(0, name.length() - 5), file);
                        }
                    }
                }
            }
        }
        return found;
    }

    private static JsonObject json(Path file) throws IOException {
        return JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject();
    }

    private static PackOrigin origin(Path file) {
        return new PackOrigin(PACK_ID, PACK.relativize(file).toString().replace('\\', '/'));
    }

    private static String lines(List<?> problems) {
        return "\n  " + String.join("\n  ", problems.stream().map(Object::toString).toList());
    }

    /** A location {@code ns:path} as a file of the pack. */
    private static Path file(String location) {
        int colon = location.indexOf(':');
        return PACK.resolve("assets").resolve(location.substring(0, colon)).resolve(location.substring(colon + 1));
    }

    private static Map<String, WagonModelDecl> models() throws IOException {
        Map<String, WagonModelDecl> models = new TreeMap<>();
        for (Map.Entry<String, Path> model : declarations("assets", "wagon_models").entrySet()) {
            models.put(model.getKey(), WagonModelDecl.parse(NS, json(model.getValue())));
        }
        return models;
    }

    /** The object names of an OBJ of the pack, in file order, each once. */
    private static List<String> objects(String location) throws IOException {
        Set<String> names = new LinkedHashSet<>();
        try (InputStream in = Files.newInputStream(file(location))) {
            ObjLoader.loadModel(in).parts().forEach(part -> names.add(part.object()));
        }
        return new ArrayList<>(names);
    }

    @Test
    void packMetaIsFormatOneUnderCc0WithNothingToSay() {
        RwatPackMeta.Result result = RwatPackMeta.read(PACK, PACK_ID);
        assertTrue(result.accepted(), lines(result.problems()));
        assertTrue(result.problems().isEmpty(), lines(result.problems()));
        assertEquals(1, result.meta().format());
        assertEquals("RWAT Example Pack", result.meta().name());
        assertEquals("CC0-1.0", result.meta().license());
        assertNotNull(result.meta().version());
        assertNotNull(result.meta().description());
        assertTrue(!result.meta().authors().isEmpty());
    }

    @Test
    void wagonTypesLoadWithNothingToReport() throws IOException {
        Map<String, Path> files = declarations("data", "wagon_types");
        assertEquals(TYPES, files.keySet());
        List<WagonTypeLoader.Declaration> declarations = new ArrayList<>();
        for (Map.Entry<String, Path> file : files.entrySet()) {
            declarations.add(new WagonTypeLoader.Declaration(file.getKey(), origin(file.getValue()),
                    json(file.getValue())));
        }
        // whole files with their aliases, as the registry takes them: no error, and no warning
        // either — the reader's (unknown keys, reserved fields) or FloorCheck's
        WagonTypeLoader.Result result = WagonTypeLoader.load(declarations);
        assertTrue(result.problems().isEmpty(), lines(result.problems()));
        assertEquals(TYPES, result.types().keySet());
        assertEquals(Map.of(NS + ":open_wagon", NS + ":gondola"), result.aliases());
    }

    @Test
    void modelsAndTheRailStyleParseWithoutAWarning_typesAndModelsPairUp() throws IOException {
        List<PackProblem> problems = new ArrayList<>();
        Map<String, PackOrigin> models = new TreeMap<>();
        for (Map.Entry<String, Path> file : declarations("assets", "wagon_models").entrySet()) {
            PackOrigin origin = origin(file.getValue());
            try {
                WagonModelDecl.parse(NS, json(file.getValue()), w -> problems.add(origin.warning(w)));
                models.put(file.getKey(), origin);
            } catch (RuntimeException e) {
                problems.add(origin.error(e.getMessage()));
            }
        }
        Map<String, Path> rails = declarations("assets", "rail_models");
        assertEquals(Set.of(NS + ":wooden_track"), rails.keySet());
        for (Path file : rails.values()) {
            PackOrigin origin = origin(file);
            try {
                RailStyleDecl.parse(NS, json(file), w -> problems.add(origin.warning(w)));
            } catch (RuntimeException e) {
                problems.add(origin.error(e.getMessage()));
            }
        }
        problems.addAll(PackReport.modelsWithoutType(models, TYPES));
        assertTrue(problems.isEmpty(), lines(problems));
        assertEquals(TYPES, models.keySet(), "every type has its model");
    }

    /** {@code /rwatc packs validate}: every file a model names is there, reads and draws — and no warning. */
    @Test
    void everyModelsFilesAreThereAndDrawWithoutAWarning() throws IOException {
        ModelCheck.Files files = new ModelCheck.Files() {
            @Override
            public boolean valid(String location) {
                return location.matches("[a-z0-9_.-]+:[a-z0-9/._-]+");
            }

            @Override
            public boolean exists(String location) {
                return Files.isRegularFile(file(location));
            }

            @Override
            public InputStream open(String location) throws IOException {
                if (!exists(location)) {
                    throw new FileNotFoundException(location);
                }
                return Files.newInputStream(file(location));
            }
        };
        List<PackProblem> problems = new ArrayList<>();
        for (Map.Entry<String, Path> file : declarations("assets", "wagon_models").entrySet()) {
            problems.addAll(ModelCheck.check(WagonModelDecl.parse(NS, json(file.getValue())), origin(file.getValue()),
                    files));
        }
        assertTrue(problems.isEmpty(), lines(problems));
    }

    /** No audio in the pack (R11): every sound is a vanilla sound event, named with its namespace. */
    @Test
    void soundsAreVanillaSoundEvents() throws IOException {
        int sounds = 0;
        for (Map.Entry<String, WagonModelDecl> model : models().entrySet()) {
            SoundSet set = model.getValue().sounds();
            assertTrue(set.files().isEmpty(), model.getKey() + " carries audio files: " + set.files());
            List<String> refs = new ArrayList<>();
            for (SoundSet.Loop loop : new SoundSet.Loop[]{set.idle(), set.horn(), set.bell(), set.wheels()}) {
                if (loop != null) {
                    refs.add(loop.main());
                    refs.add(loop.start());
                    refs.add(loop.stop());
                }
            }
            refs.add(set.clack());
            refs.addAll(set.doors().values());
            set.controls().values().forEach(control -> {
                refs.add(control.move());
                refs.add(control.engage());
            });
            for (String ref : refs) {
                if (ref != null) {
                    assertTrue(ref.startsWith("minecraft:"), model.getKey() + ": " + ref + " is no vanilla sound event");
                    sounds++;
                }
            }
        }
        assertTrue(sounds > 20, "only " + sounds + " sounds");
    }

    /** Every type, the rail style and every light group of a model is named in en_us and ru_ru alike. */
    @Test
    void everyNameHasItsLangKeyInBothLanguages() throws IOException {
        Map<String, Set<String>> keys = new TreeMap<>();
        for (String lang : List.of("en_us", "ru_ru")) {
            JsonObject json = json(PACK.resolve("assets/" + NS + "/lang/" + lang + ".json"));
            keys.put(lang, new TreeSet<>(json.keySet()));
        }
        assertEquals(keys.get("en_us"), keys.get("ru_ru"), "en_us and ru_ru name the same things");
        Set<String> wanted = new TreeSet<>();
        for (String type : TYPES) {
            wanted.add("wagon." + type.replace(':', '.'));
        }
        wanted.add("rail." + NS + ".wooden_track");
        for (Map.Entry<String, WagonModelDecl> model : models().entrySet()) {
            for (String object : objects(model.getValue().obj())) {
                String group = ObjectRole.parse(object).lightGroup();
                if (group != null) {
                    wanted.add("light." + model.getKey().replace(':', '.') + "." + group);
                }
            }
        }
        assertEquals(wanted, keys.get("en_us"));
    }

    /**
     * The pack shows the OBJ naming convention it is there to show: every
     * control kind (but the combined handle, which does nothing), every flag
     * and modifier, hinge markers and slides, door leaves of each kind, the
     * lights, the coupler heads in each state, bogies and wheelsets, interior,
     * dropped and skipped objects, the .anim's objects, the declared
     * handbrake, a livery, a Blender copy suffix read away; and a rail tile
     * of rails, base and a hidden object.
     */
    @Test
    void objectNamesShowTheConvention() throws IOException {
        Set<ObjectRole.Kind> kinds = EnumSet.noneOf(ObjectRole.Kind.class);
        Set<String> shown = new TreeSet<>();
        Map<String, List<String>> objectsByModel = new LinkedHashMap<>();
        for (Map.Entry<String, WagonModelDecl> entry : models().entrySet()) {
            WagonModelDecl decl = entry.getValue();
            List<String> objects = objects(decl.obj());
            objectsByModel.put(entry.getKey(), objects);
            Set<String> controlKeys = new TreeSet<>();
            for (String object : objects) {
                ObjectRole role = ObjectRole.parse(object);
                ObjectRole.Control control = role.control();
                if (control != null) {
                    kinds.add(control.kind());
                    controlKeys.add(control.key());
                    mark(shown, control.toggle(), "TOGGLE");
                    mark(shown, control.press(), "PRESS");
                    mark(shown, control.invert(), "INVERT");
                    mark(shown, control.hide(), "HIDE widget");
                    mark(shown, control.noTouch(), "NOTOUCH");
                    mark(shown, control.global(), "GLOBAL");
                    mark(shown, !control.group().equals(control.key()), "_CG_");
                    mark(shown, control.label() != null, "_LABEL_");
                    mark(shown, control.offset() != 0.0F, "_OFFSET_");
                    mark(shown, control.rangeMin() != 0.0F || control.rangeMax() != 1.0F, "_RANGE_");
                    mark(shown, control.slideX() != 0.0F || control.slideY() != 0.0F || control.slideZ() != 0.0F,
                            "TL_ on a control");
                }
                mark(shown, object.matches(".*\\.\\d{3}$") && !role.equals(ObjectRole.NONE)
                        && role.equals(ObjectRole.parse(object.substring(0, object.length() - 4))),
                        "copy suffix .001");
                mark(shown, role.pivot(), "_ROT_ marker");
                mark(shown, role.lightGroup() != null, "_LCG_");
                mark(shown, role.lightInvert(), "LINVERT");
                mark(shown, role.fullbright(), "FULLBRIGHT");
                mark(shown, role.headlight(), "HEADLIGHT_<n>");
                mark(shown, role.headlight() && role.rgb() != 0xFFFFFF, "_0X<RRGGBB>");
                mark(shown, ObjectRole.hasToken(object, "INTERIOR") && role.lightGroup() != null, "INTERIOR token");
                mark(shown, object.startsWith("INTERIOR"), "INTERIOR*");
                mark(shown, object.startsWith("CARGO_FILL"), "CARGO_FILL*");
                mark(shown, object.startsWith("BOGEY_FRONT") && !object.contains("_WHEEL_"), "BOGEY_FRONT frame");
                mark(shown, object.startsWith("BOGEY_REAR") && !object.contains("_WHEEL_"), "BOGEY_REAR frame");
                mark(shown, object.matches("^BOGEY_(?:FRONT|REAR).*_WHEEL_.*"), "wheelset");
                boolean widget = control != null && control.kind() == ObjectRole.Kind.WIDGET;
                ObjectRole.Coupled coupled = ObjectRole.coupled(object);
                mark(shown, object.contains("HIDE") && !widget && coupled == null, "HIDE dropped");
                if (coupled != null) {
                    shown.add("coupler " + (coupled.front() ? "front " : "rear ") + coupled.shown());
                }
                for (String prefix : decl.skip()) {
                    mark(shown, object.startsWith(prefix), "skip");
                }
                ObjectRole leaf = ObjectRole.door(object);
                if (leaf != null) {
                    mark(shown, leaf.pivot(), "door leaf on a hinge");
                    ObjectRole.Control c = leaf.control();
                    mark(shown, c.slideX() != 0.0F || c.slideY() != 0.0F || c.slideZ() != 0.0F, "sliding door leaf");
                }
            }
            for (String key : decl.handbrake()) {
                assertTrue(controlKeys.contains(key), entry.getKey() + ": handbrake " + key + " is no control");
                shown.add("declared handbrake");
            }
            for (Map.Entry<String, String> anim : decl.animations().entrySet()) {
                try (InputStream in = Files.newInputStream(file(anim.getValue()))) {
                    for (String object : IrAnim.parse(in).keySet()) {
                        assertTrue(objects.contains(object), anim.getValue() + " moves " + object + ", not in the OBJ");
                        shown.add(".anim objects");
                    }
                }
            }
            mark(shown, !decl.liveries().isEmpty(), "livery");
        }
        Set<ObjectRole.Kind> missing = EnumSet.allOf(ObjectRole.Kind.class);
        missing.removeAll(kinds);
        // DOOR is read only as a leaf (ObjectRole.door); THROTTLE_BRAKE does nothing in the engine
        assertEquals(EnumSet.of(ObjectRole.Kind.DOOR, ObjectRole.Kind.THROTTLE_BRAKE), missing,
                "control kinds the example doesn't show");
        Set<String> wanted = new TreeSet<>(List.of("TOGGLE", "PRESS", "INVERT", "HIDE widget", "NOTOUCH", "GLOBAL",
                "_CG_", "_LABEL_", "_OFFSET_", "_RANGE_", "TL_ on a control", "_ROT_ marker", "_LCG_", "LINVERT",
                "FULLBRIGHT", "HEADLIGHT_<n>", "_0X<RRGGBB>", "INTERIOR token", "INTERIOR*", "CARGO_FILL*",
                "BOGEY_FRONT frame", "BOGEY_REAR frame", "wheelset", "HIDE dropped", "skip", "door leaf on a hinge",
                "sliding door leaf", "declared handbrake", ".anim objects", "livery", "copy suffix .001"));
        for (String end : List.of("front ", "rear ")) {
            for (ObjectRole.Coupled.Shown when : ObjectRole.Coupled.Shown.values()) {
                wanted.add("coupler " + end + when);
            }
        }
        Set<String> notShown = new TreeSet<>(wanted);
        notShown.removeAll(shown);
        assertTrue(notShown.isEmpty(), "not shown: " + notShown);

        List<String> tile = objects(NS + ":track/wooden_track.obj");
        assertTrue(tile.stream().anyMatch(o -> TileFootprint.isRailObject(o) && !o.contains("HIDE")), "rails");
        assertTrue(tile.stream().anyMatch(o -> !TileFootprint.isRailObject(o) && o.startsWith("RAIL_")),
                "a RAIL_…BASE… object (base)");
        assertTrue(tile.stream().anyMatch(TileFootprint::isHiddenObject), "a hidden object");
    }

    // ---- the markup, as the engine walks it ----

    private static final double M = RiderWalk.PLAYER_HALF_WIDTH;
    private static final String COACH = NS + ":coach";
    private static final String SHUNTER = NS + ":shunter";

    /** The pack's type file {@code id}, read afresh (a copy to break). */
    private static JsonObject typeJson(String id) throws IOException {
        return json(declarations("data", "wagon_types").get(id));
    }

    /** A type of the pack as the loader's parser reads it: the markup turned from the OBJ frame into the model's. */
    private static WagonType type(String id) throws IOException {
        return WagonTypeParser.parse(id, typeJson(id));
    }

    /** The type {@code id} with its markup broken by {@code change}. */
    private static WagonType broken(String id, Consumer<JsonObject> change) throws IOException {
        JsonObject json = typeJson(id);
        change.accept(json);
        return WagonTypeParser.parse(id, json);
    }

    /** The JSON of door {@code id} in a type file. */
    private static JsonObject doorJson(JsonObject type, String id) {
        for (JsonElement door : type.getAsJsonArray("doors")) {
            if (door.getAsJsonObject().get("id").getAsString().equals(id)) {
                return door.getAsJsonObject();
            }
        }
        throw new IllegalArgumentException("no door " + id);
    }

    /** A box ({@code min}, {@code max}) or a chair ({@code at}) of a type file moved along OBJ axis {@code axis}. */
    private static void move(JsonObject box, int axis, double by) {
        for (String key : List.of("min", "max", "at")) {
            if (box.has(key)) {
                JsonArray xyz = box.getAsJsonArray(key);
                xyz.set(axis, new JsonPrimitive(xyz.get(axis).getAsDouble() + by));
            }
        }
    }

    /** The index of door {@code id} of a type; −1 if it has none. */
    private static int door(WagonType type, String id) {
        for (int i = 0; i < type.doors().size(); i++) {
            if (type.doors().get(i).id().equals(id)) {
                return i;
            }
        }
        return -1;
    }

    /** The doors of {@code ids} the type lacks, as problems. */
    private static List<String> missing(WagonType type, List<String> ids) {
        return ids.stream().filter(id -> door(type, id) < 0).map(id -> "no door " + id).toList();
    }

    /** Feet at (x, z) on the floor there. */
    private static Vector3d feet(WagonType type, double x, double z) {
        return new Vector3d(x, type.interior().floorAt(x, z, M), z);
    }

    /**
     * Walks a rider at {@code from} straight at (x, z), as far as the floor
     * lets them ({@link RiderWalk#toward}, sliding along walls), with the doors
     * of {@code openMask} open; true if they get there.
     */
    private static boolean walks(WagonType type, Vector3d from, double x, double z, int openMask) {
        Vector3d at = from;
        for (int leg = 0; leg < 8; leg++) {
            Vector3d next = RiderWalk.toward(at, x, z, type.interior(), type.doors(), openMask);
            if (next.distanceSquared(at) < 1.0e-8) {
                break;
            }
            at = next;
        }
        return Math.hypot(at.x - x, at.z - z) < 2.0e-3;
    }

    /**
     * A point of zone {@code i} a rider fits at and no other zone holds: its
     * middle, else the middle of one of its edges, a body's half-width in.
     */
    private static double[] ownPoint(List<WagonType.Interior.Zone> zones, int i) {
        WagonType.Interior.Zone zone = zones.get(i);
        double cx = (zone.minX() + zone.maxX()) / 2;
        double cz = (zone.minZ() + zone.maxZ()) / 2;
        for (double[] p : new double[][]{{cx, cz}, {zone.minX() + M, cz}, {zone.maxX() - M, cz},
                {cx, zone.minZ() + M}, {cx, zone.maxZ() - M}}) {
            boolean others = false;
            for (int j = 0; j < zones.size(); j++) {
                others |= j != i && zones.get(j).holds(p[0], p[1], M);
            }
            if (!others && zone.holds(p[0], p[1], M)) {
                return p;
            }
        }
        return new double[]{cx, cz};
    }

    /** The look yaw of a rider walking along (dx, dz) of the model frame, the wagon at yaw 0. */
    private static float yaw(double dx, double dz) {
        return (float) Math.toDegrees(Math.atan2(-dx, dz));
    }

    /**
     * Where a rider walks out through hull or gangway door {@code d}: up to
     * it, on the floor nearest its middle, then one step on through it
     * ({@link RiderWalk#exitDoor}, which takes a door only where the floor
     * ends within its slack of the inner face). The zone they stand in, or
     * −1 if the step doesn't take this door.
     */
    private static int exitsFrom(WagonType type, int d, int openMask) {
        WagonType.Door door = type.doors().get(d);
        FloorRegion floor = type.interior().region(M, type.doors(), openMask);
        double[] at = floor.nearest((door.minX() + door.maxX()) / 2, (door.minZ() + door.maxZ()) / 2);
        float yaw = door.axis() == 0 ? yaw(door.outward(), 0) : yaw(0, door.outward());
        int out = RiderWalk.exitDoor(feet(type, at[0], at[1]), 1.0, 0.0, yaw, 0.0F, type.interior(),
                type.doors(), openMask);
        if (out != d) {
            return -1;
        }
        List<WagonType.Interior.Zone> zones = type.interior().zones();
        for (int i = 0; i < zones.size(); i++) {
            if (zones.get(i).holds(at[0], at[1], M)) {
                return i;
            }
        }
        return -1;
    }

    /** The parts of a floor joined by the floor alone, no door bridging: piece → its part's least piece. */
    private static int[] partsByFloor(FloorRegion floor) {
        int[] part = new int[floor.pieces().size()];
        for (int i = 0; i < part.length; i++) {
            part[i] = i;
        }
        boolean merged = true;
        while (merged) {
            merged = false;
            for (int[] link : floor.links()) {
                int least = Math.min(part[link[0]], part[link[1]]);
                if (part[link[0]] != least || part[link[1]] != least) {
                    part[link[0]] = least;
                    part[link[1]] = least;
                    merged = true;
                }
            }
        }
        return part;
    }

    /** The parts of the floor (see {@link #partsByFloor}) that {@code zone} has pieces in. */
    private static Set<Integer> partsOf(FloorRegion floor, int[] part, WagonType.Interior.Zone zone) {
        Set<Integer> found = new TreeSet<>();
        for (int p = 0; p < part.length; p++) {
            if (floor.pieces().get(p).touches(zone.minX(), zone.minZ(), zone.maxX(), zone.maxZ())) {
                found.add(part[p]);
            }
        }
        return found;
    }

    /**
     * What the coach's markup gets wrong of what the pack's README says it
     * shows; empty if nothing. Its zones, in the generator's order: the front
     * vestibule, the salon aisle, the middle platform, the rear vestibule.
     */
    private static List<String> coachProblems(WagonType coach) {
        List<String> out = new ArrayList<>();
        List<WagonType.Interior.Zone> zones = coach.interior().zones();
        List<WagonType.Door> doors = coach.doors();
        out.addAll(missing(coach, List.of("door_fl", "door_fr", "door_rl", "door_rr", "gangway_front",
                "gangway_rear", "salon_door", "salon_arch")));
        if (zones.size() != 4) {
            out.add("four zones, not " + zones.size());
        }
        if (!out.isEmpty()) {
            return out;
        }
        int all = coach.leafDoors();
        int salonDoor = door(coach, "salon_door");
        int salonArch = door(coach, "salon_arch");
        // every zone is walked to from the salon with every door open; with salon_door shut,
        // all but the front vestibule (the rear one is past the arch, never shut)
        double[] salon = ownPoint(zones, 1);
        for (int z = 0; z < zones.size(); z++) {
            double[] to = ownPoint(zones, z);
            if (!walks(coach, feet(coach, salon[0], salon[1]), to[0], to[1], all)) {
                out.add("zone " + z + " isn't walked to from the salon with every door open");
            }
            if (walks(coach, feet(coach, salon[0], salon[1]), to[0], to[1], all & ~(1 << salonDoor)) != (z != 0)) {
                out.add("zone " + z + (z == 0 ? " is" : " isn't") + " walked to from the salon with salon_door shut");
            }
        }
        // the inner doorways walked through both ways, a block either side of the wall: the
        // bridge reaches both sides; salon_door shut is a wall
        for (int d : new int[]{salonDoor, salonArch}) {
            WagonType.Door door = doors.get(d);
            boolean side = door.axis() == 0;
            double along = (door.spanMin() + door.spanMax()) / 2;
            double wall = side ? (door.minX() + door.maxX()) / 2 : (door.minZ() + door.maxZ()) / 2;
            double[] in = side ? new double[]{wall - door.outward(), along}
                    : new double[]{along, wall - door.outward()};
            double[] beyond = side ? new double[]{wall + door.outward(), along}
                    : new double[]{along, wall + door.outward()};
            for (int mask : door.fixed() ? new int[]{0} : new int[]{all, 0}) {
                boolean open = door.open(mask, d);
                if (walks(coach, feet(coach, in[0], in[1]), beyond[0], beyond[1], mask) != open
                        || walks(coach, feet(coach, beyond[0], beyond[1]), in[0], in[1], mask) != open) {
                    out.add(door.id() + (open ? " open isn't walked through both ways" : " shut is walked through"));
                }
            }
        }
        // salon_door: the zones on its two sides don't meet in its doorway, and the floor
        // alone doesn't join them round it
        FloorRegion.Cut cut = FloorRegion.Cut.shut(doors.get(salonDoor), M);
        for (FloorRegion.Piece piece : coach.interior().region(M).pieces()) {
            if (cut.bites(piece)) {
                out.add("salon_door: the floor runs through its doorway, " + piece);
            }
        }
        FloorRegion shut = coach.interior().region(M, doors, 0);
        int[] part = partsByFloor(shut);
        Set<Integer> joined = partsOf(shut, part, zones.get(0));
        joined.retainAll(partsOf(shut, part, zones.get(1)));
        if (!joined.isEmpty()) {
            out.add("salon_door: the front vestibule and the salon are one floor without it");
        }
        // the ways out of each vestibule, its outer doors and its gangway: the floor ends at each
        Map<String, Integer> waysOut = new TreeMap<>(Map.of("door_fl", 0, "door_fr", 0, "gangway_front", 0,
                "door_rl", 3, "door_rr", 3, "gangway_rear", 3));
        waysOut.forEach((id, zone) -> {
            int d = door(coach, id);
            int from = exitsFrom(coach, d, all);
            if (from != zone) {
                out.add(id + " open isn't walked out through from zone " + zone
                        + (from < 0 ? ": the floor doesn't end at it" : " but from zone " + from));
            }
            if (exitsFrom(coach, d, 0) >= 0) {
                out.add(id + " shut is walked out through");
            }
        });
        // the gangways in the end walls: a rider coming along the train lands through them, on the floor
        for (int travel : new int[]{1, -1}) {
            String id = travel > 0 ? "gangway_rear" : "gangway_front";
            RiderWalk.Arrival in = RiderWalk.gangwayArrival(doors, coach.interior(), travel, 0.0, all);
            if (doors.get(door(coach, id)).axis() != 2) {
                out.add(id + " isn't in an end wall");
            } else if (in == null || in.door() != door(coach, id)
                    || !coach.interior().region(M, doors, all).fits(in.feet().x, in.feet().z)) {
                out.add("a rider coming " + (travel > 0 ? "forward" : "back") + " along the train doesn't land"
                        + " through " + id + " on the floor");
            }
        }
        return out;
    }

    /**
     * What the shunter's markup gets wrong of what the README says: the
     * steps lead out of the cab, a rider climbing in walks to within reach of
     * either chair, each chair has floor within reach and its cushion at a
     * sitting height above it, both are the one cab's, and the second faces
     * back, so it drives the other way.
     */
    private static List<String> shunterProblems(WagonType shunter) {
        List<String> out = new ArrayList<>(missing(shunter, List.of("steps_left", "steps_right")));
        if (!out.isEmpty()) {
            return out;
        }
        WagonType.Interior interior = shunter.interior();
        for (String id : List.of("steps_left", "steps_right")) {
            int d = door(shunter, id);
            if (!shunter.doors().get(d).fixed() || exitsFrom(shunter, d, 0) < 0) {
                out.add(id + " isn't a doorway without a leaf a rider walks out through");
            }
        }
        WagonType.Door steps = shunter.doors().get(door(shunter, "steps_left"));
        double[] climbedIn = interior.region(M).nearest((steps.minX() + steps.maxX()) / 2,
                (steps.minZ() + steps.maxZ()) / 2);
        List<WagonType.Seat> seats = shunter.cab().seats();
        CabArea cabs = CabArea.of(shunter);
        for (int i = 0; i < seats.size(); i++) {
            WagonType.Seat seat = seats.get(i);
            double[] floor = interior.region(M).nearest(seat.x(), seat.z());
            double reach = Math.hypot(floor[0] - seat.x(), floor[1] - seat.z());
            double cushion = seat.y() - interior.floorAt(floor[0], floor[1], M);
            if (!(reach <= RiderWalk.SEAT_REACH)) {
                out.add("cab.seats[" + i + "]: the floor is " + reach + " off, out of reach");
            }
            if (!(cushion >= FloorCheck.MIN_SEAT_HEIGHT && cushion <= FloorCheck.MAX_SEAT_HEIGHT)) {
                out.add("cab.seats[" + i + "]: the cushion is " + cushion + " above the floor");
            }
            Vector3d walked = RiderWalk.toward(feet(shunter, climbedIn[0], climbedIn[1]), seat.x(), seat.z(),
                    interior, shunter.doors(), 0);
            if (Math.hypot(walked.x - seat.x(), walked.z - seat.z()) > RiderWalk.SEAT_REACH) {
                out.add("cab.seats[" + i + "] isn't walked to within reach from the steps");
            }
            if (cabs.cabOfChair(i) != 0) {
                out.add("cab.seats[" + i + "] is in cab " + cabs.cabOfChair(i) + ", not the one cab");
            }
        }
        if (seats.size() != 2 || CabArea.facing(false, seats.get(0)) != 1
                || CabArea.facing(false, seats.get(1)) != -1) {
            out.add("two chairs, the first driving forward and the second back: " + seats);
        }
        return out;
    }

    /**
     * The door leaves of a model ({@link DoorLeaves}: {@code DOOR_<n>} with a
     * hinge marker or a slide, drawn, not a bogie's, not moved by an .anim),
     * each as the box of its textured parts in the OBJ frame. Key → {min, max}.
     */
    private static Map<String, double[][]> leaves(WagonModelDecl decl) throws IOException {
        ObjLoader.Model model;
        try (InputStream in = Files.newInputStream(file(decl.obj()))) {
            model = ObjLoader.loadModel(in);
        }
        String namespace = decl.obj().substring(0, decl.obj().indexOf(':'));
        String folder = MtlParser.folderOf(decl.obj().substring(namespace.length() + 1));
        Set<String> textured = new TreeSet<>();
        for (String library : model.materialLibraries()) {
            try (InputStream in = Files.newInputStream(file(namespace + ":" + MtlParser.resolve(folder, library)))) {
                textured.addAll(MtlParser.parse(in).keySet());
            }
        }
        Set<String> animated = new TreeSet<>();
        for (String anim : decl.animations().values()) {
            try (InputStream in = Files.newInputStream(file(anim))) {
                animated.addAll(IrAnim.parse(in).keySet());
            }
        }
        // the pack has no CARGO_FILL object: the declaration's skip is all the model drops
        DoorLeaves doorLeaves = DoorLeaves.of(model.parts().stream().map(ObjLoader.Part::object).toList(),
                decl.skip(), animated);
        Map<String, double[][]> boxes = new TreeMap<>();
        for (ObjLoader.Part part : model.parts()) {
            ObjectRole leaf = doorLeaves.leaf(part.object());
            if (leaf == null || !textured.contains(part.material())) {
                continue;
            }
            double[][] box = boxes.computeIfAbsent(leaf.control().key(), k -> new double[][]{
                    {Double.MAX_VALUE, Double.MAX_VALUE, Double.MAX_VALUE},
                    {-Double.MAX_VALUE, -Double.MAX_VALUE, -Double.MAX_VALUE}});
            for (Mesh.Quad q : part.mesh().quads()) {
                for (Mesh.Vertex v : new Mesh.Vertex[]{q.v0(), q.v1(), q.v2(), q.v3()}) {
                    double[] xyz = {v.x(), v.y(), v.z()};
                    for (int a = 0; a < 3; a++) {
                        box[0][a] = Math.min(box[0][a], xyz[a]);
                        box[1][a] = Math.max(box[1][a], xyz[a]);
                    }
                }
            }
        }
        return boxes;
    }

    /**
     * Every door leaf of the model lies in its own door's box: the centre of
     * its box finds a door ({@link DoorLeaves#door}, by {@link
     * WagonType#doorHolding} as the renderer looks it up), no two leaves the
     * same door; and every door with a leaf is moved by one, or by the .anim
     * named after it.
     */
    private static List<String> leafProblems(WagonType type, WagonModelDecl decl) throws IOException {
        List<String> out = new ArrayList<>();
        Map<Integer, String> held = new TreeMap<>();
        for (Map.Entry<String, double[][]> leaf : leaves(decl).entrySet()) {
            int d = DoorLeaves.door(type, leaf.getValue()[0], leaf.getValue()[1]);
            if (d < 0) {
                out.add(leaf.getKey() + ": its centre is in no door's box");
            } else if (held.containsKey(d)) {
                out.add(leaf.getKey() + " and " + held.get(d) + " are both door " + type.doors().get(d).id() + "'s");
            } else {
                held.put(d, leaf.getKey());
            }
        }
        for (int d = 0; d < type.doors().size(); d++) {
            WagonType.Door door = type.doors().get(d);
            if (!door.fixed() && !held.containsKey(d) && !decl.animations().containsKey(door.id())) {
                out.add("door " + door.id() + " has no leaf in the model and no .anim");
            }
        }
        return out;
    }

    /** FloorCheck finds nothing in any type of the pack (the loader would warn of it). */
    @Test
    void floorCheckFindsNothingInAnyType() throws IOException {
        for (String id : TYPES) {
            assertEquals(List.of(), FloorCheck.problems(type(id)), id);
        }
    }

    @Test
    void theCoachIsWalkedAsItsReadmeSays() throws IOException {
        assertEquals(List.of(), coachProblems(type(COACH)));
    }

    @Test
    void theShunterIsWalkedAsItsReadmeSays() throws IOException {
        assertEquals(List.of(), shunterProblems(type(SHUNTER)));
    }

    @Test
    void everyDoorLeafLiesInItsDoorsBox() throws IOException {
        Map<String, WagonModelDecl> models = models();
        int leaves = 0;
        for (String id : TYPES) {
            assertEquals(List.of(), leafProblems(type(id), models.get(id)), id);
            leaves += leaves(models.get(id)).size();
        }
        assertEquals(6, leaves, "the coach's four outer and two gangway leaves");
    }

    /** The checks above see a broken markup: each of these copies of the pack's types fails one. */
    @Test
    void theMarkupChecksSeeABrokenMarkup() throws IOException {
        Map<String, WagonType> coaches = new LinkedHashMap<>();
        // the salon aisle run up to the front vestibule, through salon_door's doorway
        coaches.put("aisle into the vestibule", broken(COACH, t -> t.getAsJsonArray("interior").get(1)
                .getAsJsonObject().getAsJsonArray("min").set(0, new JsonPrimitive(-7.9))));
        // salon_door a block into the salon: its bridge doesn't reach the vestibule
        coaches.put("salon_door in the salon", broken(COACH, t -> move(doorJson(t, "salon_door"), 0, 1.0)));
        // an outer door half a block off the side wall: the floor doesn't end at it
        coaches.put("door_fl off the wall", broken(COACH, t -> move(doorJson(t, "door_fl"), 2, 0.5)));
        // the arch a block aside, off the aisle: the rear vestibule is cut off the salon, though
        // FloorCheck finds nothing (the vestibule has its own doors, so it is reached anyway)
        coaches.put("salon_arch off the aisle", broken(COACH, t -> move(doorJson(t, "salon_arch"), 2, 1.0)));
        // a gangway in the side wall
        coaches.put("gangway_front in the side", broken(COACH, t -> {
            JsonObject gangway = doorJson(t, "gangway_front");
            gangway.add("min", JsonParser.parseString("[-9.5, 1.15, 1.45]"));
            gangway.add("max", JsonParser.parseString("[-8.6, 3.25, 1.51]"));
        }));
        coaches.forEach((what, coach) -> assertTrue(!coachProblems(coach).isEmpty(), what + " passes"));

        Map<String, WagonType> shunters = new LinkedHashMap<>();
        // FloorCheck finds nothing here either: a chair may face either way
        shunters.put("the second chair facing forward", broken(SHUNTER, t -> t.getAsJsonObject("cab")
                .getAsJsonArray("seats").get(1).getAsJsonObject().addProperty("yaw", 0)));
        // the cushion 0.5 above the cab floor raised to 1.7
        shunters.put("the first chair too high", broken(SHUNTER, t -> move(t.getAsJsonObject("cab")
                .getAsJsonArray("seats").get(0).getAsJsonObject(), 1, 1.2)));
        shunters.put("steps off the wall", broken(SHUNTER, t -> move(doorJson(t, "steps_left"), 2, 0.6)));
        shunters.forEach((what, shunter) -> assertTrue(!shunterProblems(shunter).isEmpty(), what + " passes"));

        WagonModelDecl coachModel = models().get(COACH);
        assertTrue(!leafProblems(broken(COACH, t -> move(doorJson(t, "door_rl"), 0, -2.0)), coachModel).isEmpty(),
                "a door box away from its leaf passes");
        assertTrue(!leafProblems(broken(COACH, t -> doorJson(t, "salon_door").addProperty("id", "inner")),
                coachModel).isEmpty(), "a door moved by nothing passes");
    }

    private static void mark(Set<String> shown, boolean condition, String what) {
        if (condition) {
            shown.add(what);
        }
    }
}
