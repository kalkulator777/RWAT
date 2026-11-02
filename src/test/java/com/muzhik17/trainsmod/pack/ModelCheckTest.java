package com.muzhik17.trainsmod.pack;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.ByteArrayInputStream;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
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

    /** An in-memory pack: {@code ns:path} → contents. */
    private static final class Pack implements ModelCheck.Files {
        final Map<String, String> files = new HashMap<>();

        Pack with(String location, String contents) {
            files.put(location, contents);
            return this;
        }

        @Override
        public boolean valid(String location) {
            return location.matches("[a-z0-9_.-]+:[a-z0-9/._-]+");
        }

        @Override
        public boolean exists(String location) {
            return files.containsKey(location);
        }

        @Override
        public InputStream open(String location) throws FileNotFoundException {
            String contents = files.get(location);
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

    @Test
    void animationsAndLiveries() {
        assertEquals(List.of("E animation 'door2': file t:car/door2.anim not found",
                "W livery 'blue' replaces no texture (folder blue next to the model)"), check("""
                { "obj": "car/car.obj", "animations": { "door2": "car/door2.anim" },
                  "liveries": { "blue": "blue" } }""", good()));
    }
}
