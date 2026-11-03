package com.muzhik17.trainsmod.client.render.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

/**
 * What a material is called in an OBJ's {@code usemtl} and an MTL's
 * {@code newmtl}: the whole rest of the line, spaces inside kept (as Blender
 * reads and writes them). The OBJ loader used to take the first word and the
 * MTL parser the whole line, so a material named {@code Dark Wood} found no
 * texture. The line → name cases are shared with the converter's port
 * ({@code ir2rwat.material_name}) and the editor's: {@code
 * fixtures/golden/mtl/material_names.json}, run by {@code MtlGolden}.
 */
class MaterialNamesTest {

    private static InputStream text(String contents) {
        return new ByteArrayInputStream(contents.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void theMtlKeepsASpacedName() throws IOException {
        Map<String, String> maps = MtlParser.parse(text(
                "newmtl Dark Wood\nmap_Kd wood.png\nnewmtl glass\r\nmap_Kd ../glass.png\r\nnewmtl\tBrass Pipe \nmap_Kd brass.png\n"));
        assertEquals(Map.of("Dark Wood", "wood.png", "glass", "../glass.png", "Brass Pipe", "brass.png"), maps);
    }

    @Test
    void theObjKeepsASpacedName() throws IOException {
        ObjLoader.Model model = ObjLoader.loadModel(text("""
                v 0 0 0
                v 1 0 0
                v 1 1 0
                o PANEL
                usemtl Dark Wood
                f 1 2 3
                usemtl   body
                f 1 2 3
                usemtl
                f 1 2 3
                """));
        assertEquals(List.of("Dark Wood", "body", ""),
                model.parts().stream().map(ObjLoader.Part::material).toList());
    }

    /** The point of it: the name the OBJ uses finds the texture the MTL gives. */
    @Test
    void theObjsMaterialFindsTheMtlsTexture() throws IOException {
        ObjLoader.Model model = ObjLoader.loadModel(text(
                "mtllib mats.mtl\nv 0 0 0\nv 1 0 0\nv 1 1 0\no PANEL\nusemtl Dark Wood\nf 1 2 3\n"));
        Map<String, String> maps = MtlParser.parse(text("newmtl Dark Wood\nmap_Kd wood.png\n"));
        assertEquals(1, model.parts().size());
        assertTrue(maps.containsKey(model.parts().get(0).material()),
                "material '" + model.parts().get(0).material() + "' of " + maps.keySet());
        assertNull(MtlParser.materialName("map_Kd wood.png", "newmtl"));
    }
}
