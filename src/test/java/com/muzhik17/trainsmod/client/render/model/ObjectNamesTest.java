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
 * {@code Door} to the one and {@code Door Leaf} to the other. The cases of
 * {@link #cases} are the converter's too ({@code tools/tests/test_obj_names.py},
 * {@code floorgen.object_name_of}).
 */
class ObjectNamesTest {

    /** {line, name or null}: keep in step with tools/tests/test_obj_names.py. */
    private static List<String[]> cases() {
        return List.of(
                new String[] {"o BODY", "BODY"},
                new String[] {"g BODY", "BODY"},
                new String[] {"o Door Leaf", "Door Leaf"},
                new String[] {"o  Door   Leaf  ", "Door   Leaf"},
                new String[] {"o\tDOOR_1_ROT_90", "DOOR_1_ROT_90"},
                new String[] {"  o BODY\r", "BODY"},
                new String[] {"o DOOR_3.001", "DOOR_3.001"},
                new String[] {"g a b", "a b"},
                new String[] {"o Тележка", "Тележка"},
                new String[] {"o", "default"},
                new String[] {"o   ", "default"},
                new String[] {"o BODY ", "BODY "},
                new String[] {"o BODY", null},
                new String[] {"off", null},
                new String[] {"obj BODY", null},
                new String[] {"oBODY", null},
                new String[] {"# o BODY", null},
                new String[] {"v 1 2 3", null},
                new String[] {"usemtl body", null},
                new String[] {"", null});
    }

    @Test
    void anObjectIsTheWholeRestOfItsLine() {
        for (String[] c : cases()) {
            assertEquals(c[1], ObjectRole.objectName(c[0]), c[0]);
        }
    }

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
