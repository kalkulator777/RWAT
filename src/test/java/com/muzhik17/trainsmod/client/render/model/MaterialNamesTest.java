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
 * texture. The cases of {@link #cases} are the same as the converter's
 * ({@code tools/tests/test_obj_names.py}, {@code ir2rwat.material_name}).
 */
class MaterialNamesTest {

    private static InputStream text(String contents) {
        return new ByteArrayInputStream(contents.getBytes(StandardCharsets.UTF_8));
    }

    /** {line, keyword, name or null}: keep in step with tools/tests/test_obj_names.py. */
    private static List<String[]> cases() {
        return List.of(
                new String[] {"newmtl body", "newmtl", "body"},
                new String[] {"newmtl Dark Wood", "newmtl", "Dark Wood"},
                new String[] {"usemtl Dark Wood.001", "usemtl", "Dark Wood.001"},
                new String[] {"  newmtl   Dark   Wood  ", "newmtl", "Dark   Wood"},
                new String[] {"newmtl\tDark Wood", "newmtl", "Dark Wood"},
                new String[] {"usemtl Wood # not a comment", "usemtl", "Wood # not a comment"},
                new String[] {"newmtl", "newmtl", null},
                new String[] {"newmtl   ", "newmtl", null},
                new String[] {"newmtlx body", "newmtl", null},
                new String[] {"usemtl body", "newmtl", null},
                new String[] {"# newmtl body", "newmtl", null},
                new String[] {"mtllib body.mtl", "usemtl", null});
    }

    @Test
    void aMaterialIsTheWholeRestOfItsLine() {
        for (String[] c : cases()) {
            assertEquals(c[2], MtlParser.materialName(c[0], c[1]), c[0] + " as " + c[1]);
        }
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
