package com.muzhik17.trainsmod.client.render.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.convention.ObjectRole;

/**
 * What an object is called by its OBJ {@code o}/{@code g} line: the whole rest
 * of the line, the blanks inside kept, as Blender's importer and Immersive
 * Railroading read it ({@link ObjectRole#objectName}). The loader used to take
 * the first word and the converter the whole line, so {@code o Door Leaf} was
 * {@code Door} to the one and {@code Door Leaf} to the other. The line → name
 * cases are shared with the converter's port ({@code floorgen.object_name_of})
 * and the editor's: {@code fixtures/golden/obj/object_names.json}, run by {@code
 * ObjGolden}; here, the loader names its parts by that rule.
 */
class ObjectNamesTest {

    /** The loader names its parts so: faces before any o/g line are the default object's. */
    @Test
    void theLoaderKeepsASpacedName() throws IOException {
        ObjLoader.Model model = ObjLoader.loadModel(new ByteArrayInputStream("""
                v 0 0 0
                v 1 0 1
                v 1 0 0
                f 1 2 3
                o Door Leaf
                f 1 2 3
                g\tDOOR_1_ROT_90
                f 1 2 3
                o
                f 1 2 3
                """.getBytes(StandardCharsets.UTF_8)));
        List<String> objects = new ArrayList<>();
        model.parts().forEach(part -> objects.add(part.object()));
        assertEquals(Arrays.asList("default", "Door Leaf", "DOOR_1_ROT_90", "default"), objects);
    }
}
