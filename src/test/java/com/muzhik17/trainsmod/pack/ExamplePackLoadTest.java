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
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.muzhik17.trainsmod.client.render.model.IrAnim;
import com.muzhik17.trainsmod.client.render.model.ObjLoader;
import com.muzhik17.trainsmod.client.render.model.WagonModelDecl;
import com.muzhik17.trainsmod.client.sound.SoundSet;
import com.muzhik17.trainsmod.convention.ObjectRole;
import com.muzhik17.trainsmod.path.TileFootprint;
import com.muzhik17.trainsmod.stock.WagonTypeParser;

/**
 * The example pack ({@code run/rwat_packs/RwatExamplePack}, written by
 * {@code tools/gen_example_pack.py}, roadmap R11) loads as the game loads it
 * with nothing to report: no error and no warning from the type, model and
 * rail style readers, from {@code /rwatc packs validate}'s file check or from
 * the rwat block; every model has its type and every type its model; every
 * name has its lang key in both languages; and the pack still shows the
 * functions of the format it is there to show (the OBJ naming convention,
 * here; the JSON keys are held to the schema by
 * {@code tools/tests/test_example_pack.py}). The pack is in the repository:
 * this is never skipped.
 *
 * <p>Not here: {@code FloorCheck} over the types' floors. The pack's markup
 * is in the OBJ frame of format 1, which the engine reads once the frame
 * change (R6) is in; until then its floor is read in the old frame.
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
    void wagonTypesLoadWithoutAnErrorOrAWarningOfTheReader() throws IOException {
        Map<String, Path> files = declarations("data", "wagon_types");
        assertEquals(TYPES, files.keySet());
        List<String> warnings = new ArrayList<>();
        List<WagonTypeLoader.Declaration> declarations = new ArrayList<>();
        for (Map.Entry<String, Path> file : files.entrySet()) {
            JsonObject json = json(file.getValue());
            // the reader's own warnings (unknown keys, reserved fields): none
            WagonTypeParser.parse(file.getKey(), json, w -> warnings.add(file.getKey() + ": " + w));
            declarations.add(new WagonTypeLoader.Declaration(file.getKey(), origin(file.getValue()), json));
        }
        assertTrue(warnings.isEmpty(), lines(warnings));
        // whole files with their aliases, as the registry takes them; the loader's FloorCheck
        // warnings wait for the frame change (see the class comment)
        WagonTypeLoader.Result result = WagonTypeLoader.load(declarations);
        List<PackProblem> errors = result.problems().stream().filter(PackProblem::isError).toList();
        assertTrue(errors.isEmpty(), lines(errors));
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

    private static void mark(Set<String> shown, boolean condition, String what) {
        if (condition) {
            shown.add(what);
        }
    }
}
