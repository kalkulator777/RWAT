package com.muzhik17.trainsmod.client.render.model;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.google.gson.JsonParser;
import com.google.gson.JsonSyntaxException;

/** The client half of a pack's stock declaration (SPEC §6.3): model JSON and MTL paths. */
class WagonModelDeclTest {

    private static WagonModelDecl parse(String text) {
        return WagonModelDecl.parse("mvp", JsonParser.parseString(text).getAsJsonObject());
    }

    @Test
    void parsesFullDeclarationQualifyingPathsWithThePackNamespace() {
        WagonModelDecl decl = parse("""
                {
                  "obj": "stock/amendorf/mvp_ir_amendorf.obj",
                  "bogies": [8.5, -8.5],
                  "skip": ["WIPER_"],
                  "animations": { "Door1": "stock/amendorf/anim/door1.anim",
                                  "door2": "other:anim/door2.anim" },
                  "liveries": { "mvp_rzd": "l_mvp_rzd" }
                }""");
        assertEquals("mvp:stock/amendorf/mvp_ir_amendorf.obj", decl.obj());
        assertArrayEquals(new double[]{8.5, -8.5}, decl.bogies());
        assertEquals(List.of("WIPER_"), decl.skip());
        // group ids are matched against door ids case-insensitively → stored lower case
        assertEquals("mvp:stock/amendorf/anim/door1.anim", decl.animations().get("door1"));
        assertEquals("other:anim/door2.anim", decl.animations().get("door2"));
        assertEquals(Map.of("mvp_rzd", "l_mvp_rzd"), decl.liveries());
    }

    @Test
    void onlyTheObjIsRequired() {
        WagonModelDecl decl = parse("""
                { "obj": "mvp:stock/up4/mvp_ir_up4.obj" }""");
        assertNull(decl.bogies(), "pivots are measured from the mesh when absent");
        assertTrue(decl.skip().isEmpty());
        assertTrue(decl.animations().isEmpty());
        assertTrue(decl.liveries().isEmpty());
        assertEquals(1.0, decl.sway(), "a type rocks as designed unless its pack says otherwise");
    }

    /** A type's own sway factor (SPEC §10.2): a number from 0 (never rocks) to 3. */
    @Test
    void swayIsAFactorFromZeroToThree() {
        assertEquals(0.6, parse("""
                { "obj": "a.obj", "sway": 0.6 }""").sway());
        assertEquals(0.0, parse("""
                { "obj": "a.obj", "sway": 0 }""").sway());
        assertEquals(3.0, parse("""
                { "obj": "a.obj", "sway": 3 }""").sway());
        for (String bad : new String[] {"-0.5", "3.5", "\"strong\"", "true", "[1]", "null"}) {
            assertThrows(JsonSyntaxException.class,
                    () -> parse("{ \"obj\": \"a.obj\", \"sway\": " + bad + " }"), "sway " + bad);
        }
    }

    @Test
    void missingObjThrows() {
        assertThrows(JsonSyntaxException.class, () -> parse("""
                { "bogies": [1, -1] }"""));
    }

    @Test
    void mtlMapsMaterialsToTheirDiffuseTextures() throws IOException {
        String mtl = """
                # Blender MTL File
                newmtl body_map
                Kd 1.0 1.0 1.0
                map_Kd mvp_chme3_body_map.png

                newmtl controls
                map_Kd ../../common/mvp_controls_map.png

                newmtl untextured
                Kd 0.5 0.5 0.5
                """;
        Map<String, String> maps = MtlParser.parse(
                new ByteArrayInputStream(mtl.getBytes(StandardCharsets.UTF_8)));
        assertEquals(Map.of(
                "body_map", "mvp_chme3_body_map.png",
                "controls", "../../common/mvp_controls_map.png"), maps);
    }

    @Test
    void relativePathsResolveAgainstTheObjFolder() {
        String folder = MtlParser.folderOf("stock/rolling_stock/locomotives/mvp_ir_chme3/mvp_ir_chme3.obj");
        assertEquals("stock/rolling_stock/locomotives/mvp_ir_chme3", folder);
        assertEquals("stock/rolling_stock/common/mvp_controls_map.png",
                MtlParser.resolve(folder, "../../common/mvp_controls_map.png"));
        assertEquals("stock/rolling_stock/locomotives/mvp_ir_chme3/l_leader_770/body.png",
                MtlParser.resolve(folder, "./l_leader_770\\body.png"));
        assertNull(MtlParser.resolve("a", "../../escape.png"), "cannot climb out of the namespace");
        assertEquals("body.png", MtlParser.fileNameOf("x/y/body.png"));
    }
    /** The handbrake wheels a model declares (SPEC §5.3): control keys; none by default. */
    @Test
    void handbrakeWheels() {
        assertEquals(java.util.List.of("WIDGET_13", "WIDGET_14"), parse("""
                { "obj": "mvp:stock/m62/mvp_ir_m62.obj", "handbrake": ["WIDGET_13", "WIDGET_14"] }""")
                .handbrake());
        assertTrue(parse("""
                { "obj": "mvp:stock/up4/mvp_ir_up4.obj" }""").handbrake().isEmpty());
    }

    /** Fix list D4: a typo in a model key warns with the key it missed, down into the sounds. */
    @Test
    void unknownKeys_warnWithTheNearestKnownOne() {
        List<String> warnings = new java.util.ArrayList<>();
        WagonModelDecl decl = WagonModelDecl.parse("mvp", JsonParser.parseString("""
                { "obj": "a.obj", "livery": { "x": "y" }, "swya": 2,
                  "sounds": { "horns": "h.ogg", "idle": { "main": "i.ogg", "pich": [1, 2] } } }""")
                .getAsJsonObject(), warnings::add);
        assertEquals(List.of(
                "unknown key 'livery' (ignored) — did you mean 'liveries'?",
                "unknown key 'swya' (ignored) — did you mean 'sway'?",
                "unknown key 'sounds.horns' (ignored) — did you mean 'sounds.horn'?",
                "unknown key 'sounds.idle.pich' (ignored) — did you mean 'sounds.idle.pitch'?"), warnings);
        assertEquals(1.0, decl.sway(), "the typo's field keeps its default");
    }

    /** A null or a wrongly typed value is an error naming the field, not a bare exception. */
    @Test
    void nullsAndWrongTypes_nameTheField() {
        assertEquals("'obj' must be a string, got null", assertThrows(JsonSyntaxException.class,
                () -> parse("{ \"obj\": null }")).getMessage());
        assertEquals("'skip[1]' must be a string, got the number 3", assertThrows(JsonSyntaxException.class,
                () -> parse("{ \"obj\": \"a.obj\", \"skip\": [\"A\", 3] }")).getMessage());
        assertEquals("'liveries.red' must be a string, got null", assertThrows(JsonSyntaxException.class,
                () -> parse("{ \"obj\": \"a.obj\", \"liveries\": { \"red\": null } }")).getMessage());
        assertEquals("'animations' must be an object, got an array", assertThrows(JsonSyntaxException.class,
                () -> parse("{ \"obj\": \"a.obj\", \"animations\": [] }")).getMessage());
        assertEquals("'sounds' must be an object, got null", assertThrows(JsonSyntaxException.class,
                () -> parse("{ \"obj\": \"a.obj\", \"sounds\": null }")).getMessage());
        assertEquals("'bogies[0]' must be a finite number, got null", assertThrows(JsonSyntaxException.class,
                () -> parse("{ \"obj\": \"a.obj\", \"bogies\": [null] }")).getMessage());
    }
}
