package com.muzhik17.trainsmod.pack;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.ByteArrayInputStream;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.google.gson.JsonParser;
import com.muzhik17.trainsmod.client.render.model.WagonModelDecl;

/** The model files' check of {@code /rwatc packs validate}, over files in memory. */
class ModelCheckTest {

    private static final PackOrigin ORIGIN = new PackOrigin("rwat/Test", "assets/t/wagon_models/car.json");

    private static final String QUAD = """
            v 0 0 0
            v 1 0 0
            v 1 1 0
            v 0 1 0
            vt 0 0
            """;

    /** An in-memory pack: {@code ns:path} → contents, a location naming its file as Minecraft does ({@code :a} is {@code minecraft:a}). */
    private static final class Pack implements ModelCheck.Files {
        final Map<String, String> files = new HashMap<>();

        Pack with(String location, String contents) {
            files.put(ResourceLocations.normal(location), contents);
            return this;
        }

        @Override
        public boolean valid(String location) {
            return ResourceLocations.valid(location);
        }

        @Override
        public boolean exists(String location) {
            return valid(location) && files.containsKey(ResourceLocations.normal(location));
        }

        @Override
        public InputStream open(String location) throws FileNotFoundException {
            String contents = valid(location) ? files.get(ResourceLocations.normal(location)) : null;
            if (contents == null) {
                throw new FileNotFoundException(location);
            }
            return new ByteArrayInputStream(contents.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static List<String> check(String decl, Pack pack) {
        WagonModelDecl parsed = WagonModelDecl.parse("t", JsonParser.parseString(decl).getAsJsonObject());
        return ModelCheck.check(parsed, ORIGIN, pack).stream()
                .map(p -> (p.isError() ? "E " : "W ") + p.message()).toList();
    }

    private static Pack good() {
        return new Pack()
                .with("t:car/car.obj", "mtllib car.mtl\n" + QUAD + "o BODY\nusemtl body\nf 1/1 2/1 3/1 4/1\n")
                .with("t:car/car.mtl", "newmtl body\nmap_Kd ../tex/body.png\n")
                .with("t:tex/body.png", "png")
                .with("t:car/red/body.png", "png")
                .with("t:car/door1.anim", "");
    }

    @Test
    void aSoundModel_hasNoProblems() {
        assertEquals(List.of(), check("""
                { "obj": "car/car.obj", "animations": { "door1": "car/door1.anim" },
                  "liveries": { "red": "red" } }""", good()));
    }

    /**
     * Blender writes a material named "Dark Wood" as it is in both files. The
     * OBJ loader cut it to "Dark", the MTL entry stayed whole: the check said
     * "draws nothing" of a model the game would have drawn.
     */
    @Test
    void aMaterialNamedWithSpacesFindsItsTexture() {
        Pack pack = good()
                .with("t:car/car.obj", "mtllib car.mtl\n" + QUAD + "o BODY\nusemtl Dark Wood\nf 1/1 2/1 3/1 4/1\n")
                .with("t:car/car.mtl", "newmtl Dark Wood\nmap_Kd ../tex/body.png\n");
        assertEquals(List.of(), check("{ \"obj\": \"car/car.obj\" }", pack));
        // a different name is another material, as ever: no texture
        pack.with("t:car/car.obj", "mtllib car.mtl\n" + QUAD + "o BODY\nusemtl Dark Oak\nf 1/1 2/1 3/1 4/1\n");
        assertEquals(List.of("E model t:car/car.obj draws nothing: no face has a textured material"),
                check("{ \"obj\": \"car/car.obj\" }", pack));
    }

    /**
     * A switch or light group named longer than 32 characters cut the client
     * off its server when it was sent (M9); the loader drops it, the check
     * says so — once a name, however many objects carry it.
     */
    @Test
    void aControlGroupTooLongToSend_isNamed() {
        String name = "ThisSwitchNameIsFarTooLongToEverBeSentXY";
        String face = "\nusemtl body\nf 1/1 2/1 3/1 4/1\n";
        Pack pack = good().with("t:car/car.obj", "mtllib car.mtl\n" + QUAD + "o BODY" + face
                + "o WIDGET_1_CG_" + name + "_TOGGLE" + face
                + "o WIDGET_1_CG_" + name + "_ROT_90" + face
                + "o LAMP_LCG_" + name + "_FULLBRIGHT" + face
                + "o THROTTLE_1_CG_" + name + face // a lever's group never travels
                + "o LAMP_LCG_IL_FULLBRIGHT" + face);
        assertEquals(List.of("W model t:car/car.obj: control group '" + name + "' is longer than 32 characters"
                + " and is dropped: its switches can't be worked, its lights stay off (an LINVERT one on)"),
                check("{ \"obj\": \"car/car.obj\" }", pack));
    }

    /**
     * A location that starts with a colon is Minecraft's ({@code
     * ResourceLocation.tryParse}), and so are the libraries and textures the
     * model loader finds next to its OBJ: the check named them {@code
     * :car/car.mtl}, a file the game never looks for under that name.
     */
    @Test
    void aLocationWithAnEmptyNamespaceIsMinecrafts() {
        assertEquals("minecraft", ModelCheck.namespace(":car/car.obj"));
        assertEquals("minecraft", ModelCheck.namespace("car/car.obj"));
        assertEquals("t", ModelCheck.namespace("t:car/car.obj"));
        assertEquals("car/car.obj", ModelCheck.path(":car/car.obj"));
        assertEquals("b:c", ModelCheck.path("a:b:c"));
        Pack pack = new Pack().with("minecraft:car/car.obj", "mtllib car.mtl\n" + QUAD + "o BODY\nusemtl body\nf 1 2 3\n");
        assertEquals(List.of("E model :car/car.obj: material library minecraft:car/car.mtl not found",
                "E model :car/car.obj draws nothing: no face has a textured material"),
                check("{ \"obj\": \":car/car.obj\" }", pack));
        pack.with("minecraft:car/car.mtl", "newmtl body\nmap_Kd body.png\n").with("minecraft:car/body.png", "png");
        assertEquals(List.of(), check("{ \"obj\": \":car/car.obj\", \"liveries\": { \"red\": \"red\" } }",
                pack.with("minecraft:car/red/body.png", "png")));
    }

    /** What Minecraft takes for a location: the rule the tests' packs answer {@code valid} by. */
    @Test
    void aLocationIsValidAsMinecraftTakesIt() {
        for (String taken : List.of("t:car/car.obj", "car/car.obj", ":car/car.obj", "t:", ":", "", "my-pack.v2:a_b/c-d.e",
                "t:../car.obj", "t:a//b")) {
            assertEquals(true, ResourceLocations.valid(taken), taken);
        }
        for (String refused : List.of("T:car.obj", "t:Car.obj", "t:car.obj:x", "a b:c", "t:my car.obj", "t:вагон.obj",
                "t/x:car.obj", "t:car\\car.obj")) {
            assertEquals(false, ResourceLocations.valid(refused), refused);
        }
    }

    @Test
    void missingOrInvalidObj() {
        assertEquals(List.of("E model file t:car/gone.obj not found"),
                check("{ \"obj\": \"car/gone.obj\" }", good()));
        assertEquals(List.of("E model path 't:Car/Car.obj' is not a valid resource location"),
                check("{ \"obj\": \"Car/Car.obj\" }", good()));
    }

    /** A face index past the vertices (or a negative one) used to show only when the wagon first came into view. */
    @Test
    void badFaceIndex() {
        Pack pack = good().with("t:car/car.obj", QUAD + "usemtl body\nf 1 2 3 9\n");
        List<String> problems = check("{ \"obj\": \"car/car.obj\" }", pack);
        assertEquals(1, problems.size());
        assertEquals(true, problems.get(0).startsWith("E model t:car/car.obj: a face refers to a vertex"),
                problems.get(0));
        pack.with("t:car/car.obj", QUAD + "usemtl body\nf -1 -2 -3\n");
        assertEquals(true, check("{ \"obj\": \"car/car.obj\" }", pack).get(0).contains("negative ones"));
    }

    @Test
    void emptyModels() {
        assertEquals(List.of("E model t:car/car.obj has no faces"),
                check("{ \"obj\": \"car/car.obj\" }", good().with("t:car/car.obj", QUAD)));
        // faces, but none with a texture: nothing is drawn
        assertEquals(List.of("E model t:car/car.obj draws nothing: no face has a textured material"),
                check("{ \"obj\": \"car/car.obj\" }",
                        good().with("t:car/car.obj", QUAD + "usemtl paint\nf 1 2 3\n")));
    }

    @Test
    void missingTexturesAndLibraries() {
        Pack noTexture = good();
        noTexture.files.remove("t:tex/body.png");
        assertEquals(List.of("E model t:car/car.obj: texture t:tex/body.png of material body not found"),
                check("{ \"obj\": \"car/car.obj\" }", noTexture));
        Pack noMtl = good();
        noMtl.files.remove("t:car/car.mtl");
        assertEquals(List.of("E model t:car/car.obj: material library t:car/car.mtl not found",
                "E model t:car/car.obj draws nothing: no face has a textured material"),
                check("{ \"obj\": \"car/car.obj\" }", noMtl));
    }

    /** Drawn faces without a texture are named; hidden and skipped objects don't count. */
    @Test
    void untexturedFaces_warn() {
        Pack pack = good().with("t:car/car.obj", "mtllib car.mtl\n" + QUAD
                + "o BODY\nusemtl body\nf 1 2 3\no GLASS\nusemtl glass\nf 1 2 3\n"
                + "o HIDE_ME\nusemtl helper\nf 1 2 3\no WIPER_1\nusemtl wiper\nf 1 2 3\n");
        assertEquals(List.of("W model t:car/car.obj: faces with no texture (map_Kd) aren't drawn, material(s) glass"),
                check("{ \"obj\": \"car/car.obj\", \"skip\": [\"WIPER_\"] }", pack));
    }

    /**
     * The engine draws a {@code HIDE} widget (shown by its value), so a face of
     * it with no texture is named like any other; a plain {@code HIDE} part
     * and a {@code CARGO_FILL} one are not.
     */
    @Test
    void aHideWidgetIsDrawnByTheEngine_soItsUntexturedFacesWarn() {
        Pack pack = good().with("t:car/car.obj", "mtllib car.mtl\n" + QUAD
                + "o BODY\nusemtl body\nf 1 2 3\no WIDGET_4_HIDE_LAMP\nusemtl glow\nf 1 2 3\n"
                + "o CARGO_FILL_20\nusemtl cargo\nf 1 2 3\no PLAIN_HIDE\nusemtl helper\nf 1 2 3\n");
        assertEquals(List.of("W model t:car/car.obj: faces with no texture (map_Kd) aren't drawn, material(s) glow"),
                check("{ \"obj\": \"car/car.obj\" }", pack));
    }

    /**
     * A hinge marker ({@code <KEY>_ROT…} of a control or a door leaf) is read
     * for its axis whether it has a texture or not, and IR leaves it
     * untextured, drawn by nothing: that is no mistake to warn about. The
     * same material on anything else still is.
     */
    @Test
    void untexturedHingeMarkers_dontWarn() {
        String markers = "mtllib car.mtl\n" + QUAD + "o BODY\nusemtl body\nf 1 2 3\n"
                + "o THROTTLE_1_ROT_30\nusemtl marker\nf 1 2 3\no THROTTLE_1_LEVER\nusemtl body\nf 1 2 3\n"
                + "o DOOR_2_ROT_-90\nusemtl marker\nf 1 2 3\no DOOR_2_LEAF\nusemtl body\nf 1 2 3\n"
                + "o WIDGET_3_ROT.001\nusemtl marker\nf 1 2 3\n";
        Pack pack = good().with("t:car/car.obj", markers);
        assertEquals(List.of(), check("{ \"obj\": \"car/car.obj\" }", pack));
        // ROT on no control's key, a control's other part: not markers
        pack.with("t:car/car.obj", markers + "o BODY_ROT_90\nusemtl marker\nf 1 2 3\n");
        assertEquals(List.of("W model t:car/car.obj: faces with no texture (map_Kd) aren't drawn, material(s) marker"),
                check("{ \"obj\": \"car/car.obj\" }", pack));
        pack.with("t:car/car.obj", markers + "o THROTTLE_1_KNOB\nusemtl knob\nf 1 2 3\n");
        assertEquals(List.of("W model t:car/car.obj: faces with no texture (map_Kd) aren't drawn, material(s) knob"),
                check("{ \"obj\": \"car/car.obj\" }", pack));
    }

    /** The findings of a declaration, after checking that the problems are their lines with their severity. */
    private static List<ModelFinding> findings(String decl, Pack pack) {
        WagonModelDecl parsed = WagonModelDecl.parse("t", JsonParser.parseString(decl).getAsJsonObject());
        List<ModelFinding> findings = ModelCheck.findings(parsed, pack);
        assertEquals(findings.stream().map(f -> new PackProblem(f.severity(), ORIGIN.pack(), ORIGIN.file(), f.text()))
                .toList(), ModelCheck.check(parsed, ORIGIN, pack));
        return findings;
    }

    /** {@code finding} is of {@code code}, with these params (name, value, … in this order) and this line. */
    private static void assertFinding(ModelFinding finding, ModelFinding.Code code, String text, Object... params) {
        assertEquals(code, finding.code(), finding.text());
        List<Object> actual = new ArrayList<>();
        finding.params().forEach((name, value) -> {
            actual.add(name);
            actual.add(value);
        });
        assertEquals(List.of(params), actual, finding.text());
        assertEquals(text, finding.text());
    }

    /**
     * What the check finds is data before it is a line: a code the editor
     * words and links by, and the names and numbers the line is made of —
     * the line itself made of those alone, word for word as ever.
     */
    @Test
    void eachFindingIsItsCodeAndTheParamsOfItsLine() {
        Pack noTexture = good();
        noTexture.files.remove("t:tex/body.png");
        List<ModelFinding> found = findings("""
                { "obj": "car/car.obj", "animations": { "door2": "car/door2.anim" },
                  "liveries": { "blue": "blue" } }""", noTexture);
        assertEquals(3, found.size(), found.toString());
        assertFinding(found.get(0), ModelFinding.Code.MISSING_TEXTURE,
                "model t:car/car.obj: texture t:tex/body.png of material body not found",
                "path", "t:car/car.obj", "texture", "t:tex/body.png", "material", "body");
        assertFinding(found.get(1), ModelFinding.Code.MISSING_ANIMATION,
                "animation 'door2': file t:car/door2.anim not found", "door", "door2", "path", "t:car/door2.anim");
        assertFinding(found.get(2), ModelFinding.Code.LIVERY_REPLACES_NOTHING,
                "livery 'blue' replaces no texture (folder blue next to the model)", "livery", "blue", "folder", "blue");

        String name = "ThisSwitchNameIsFarTooLongToEverBeSentXY";
        Pack longGroup = good().with("t:car/car.obj", "mtllib car.mtl\n" + QUAD + "o BODY\nusemtl body\nf 1 2 3\n"
                + "o WIDGET_1_CG_" + name + "_TOGGLE\nusemtl glass\nf 1 2 3\n");
        found = findings("{ \"obj\": \"car/car.obj\" }", longGroup);
        assertFinding(found.get(0), ModelFinding.Code.UNTEXTURED_FACES,
                "model t:car/car.obj: faces with no texture (map_Kd) aren't drawn, material(s) glass",
                "path", "t:car/car.obj", "materials", "glass");
        assertFinding(found.get(1), ModelFinding.Code.GROUP_TOO_LONG, "model t:car/car.obj: control group '" + name
                + "' is longer than 32 characters and is dropped: its switches can't be worked, its lights stay off"
                + " (an LINVERT one on)", "path", "t:car/car.obj", "group", name, "limit", 32);

        found = findings("{ \"obj\": \"car/car.obj\" }", good().with("t:car/car.obj", QUAD + "usemtl body\nf 1 2 3 9\n"));
        assertFinding(found.get(0), ModelFinding.Code.BAD_FACE_INDEX, "model t:car/car.obj: a face refers to a vertex,"
                + " texture coordinate or normal that isn't there (Index 8 out of bounds for length 4); indices count"
                + " from 1, negative ones aren't supported", "path", "t:car/car.obj",
                "detail", "Index 8 out of bounds for length 4");
    }

    /**
     * The codes are the editor's ({@code editor/src/ports/modelCheck.ts},
     * {@code MODEL_CODES}; its checks say {@code model.<key>}), in the
     * check's order, each with how bad it is.
     */
    @Test
    void theCodesAreTheEditorsKeysInTheChecksOrder() {
        List<String> keys = new ArrayList<>();
        for (ModelFinding.Code code : ModelFinding.Code.values()) {
            keys.add(code.key() + (code.severity() == PackProblem.Severity.ERROR ? "" : " (warning)"));
        }
        assertEquals(List.of("bad-path", "missing", "bad-face-index", "unreadable", "no-faces", "bad-library-path",
                "missing-library", "unreadable-library", "bad-texture-path", "missing-texture", "draws-nothing",
                "untextured-faces (warning)", "group-too-long (warning)", "bad-animation-path", "missing-animation",
                "unreadable-animation", "livery-replaces-nothing (warning)"), keys);
    }

    @Test
    void animationsAndLiveries() {
        assertEquals(List.of("E animation 'door2': file t:car/door2.anim not found",
                "W livery 'blue' replaces no texture (folder blue next to the model)"), check("""
                { "obj": "car/car.obj", "animations": { "door2": "car/door2.anim" },
                  "liveries": { "blue": "blue" } }""", good()));
    }
}
