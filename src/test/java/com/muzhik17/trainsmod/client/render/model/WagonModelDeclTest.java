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
}
