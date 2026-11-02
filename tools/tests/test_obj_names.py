"""What a material is called in an OBJ's "usemtl" and an MTL's "newmtl", and an
object in an OBJ's "o" or "g": the whole rest of the line, the spaces inside kept
(as Blender reads them, and Immersive Railroading its objects). The mod's OBJ
loader used to take the first word of both and its MTL parser the whole line, so
a material named "Dark Wood" found no texture, and an object "o Door Leaf" was
"Door" to the mod and "Door Leaf" to the converter. The mod reads materials with
MtlParser.materialName and objects with ObjectRole.objectName; these are the
converter's ports of the same rules (ir2rwat.material_name, floorgen.object_name_of).
The cases are the same as MaterialNamesTest.cases and ObjectNamesTest.cases
(src/test/java/.../client/render/model)."""

import unittest

from irpack import floorgen, ir2rwat

# (line, keyword, name or None): keep in step with MaterialNamesTest.cases
CASES = [
    ("newmtl body", "newmtl", "body"),
    ("newmtl Dark Wood", "newmtl", "Dark Wood"),
    ("usemtl Dark Wood.001", "usemtl", "Dark Wood.001"),
    ("  newmtl   Dark   Wood  ", "newmtl", "Dark   Wood"),
    ("newmtl\tDark Wood", "newmtl", "Dark Wood"),
    ("usemtl Wood # not a comment", "usemtl", "Wood # not a comment"),
    ("newmtl", "newmtl", None),
    ("newmtl   ", "newmtl", None),
    ("newmtlx body", "newmtl", None),
    ("usemtl body", "newmtl", None),
    ("# newmtl body", "newmtl", None),
    ("mtllib body.mtl", "usemtl", None),
]

# (line, name or None): keep in step with ObjectNamesTest.cases
OBJECT_CASES = [
    ("o BODY", "BODY"),
    ("g BODY", "BODY"),
    ("o Door Leaf", "Door Leaf"),
    ("o  Door   Leaf  ", "Door   Leaf"),
    ("o\tDOOR_1_ROT_90", "DOOR_1_ROT_90"),
    ("  o BODY\r", "BODY"),
    ("o DOOR_3.001", "DOOR_3.001"),
    ("g a b", "a b"),
    ("o Тележка", "Тележка"),
    ("o", "default"),
    ("o   ", "default"),
    ("o BODY ", "BODY "),
    ("o BODY", None),
    ("off", None),
    ("obj BODY", None),
    ("oBODY", None),
    ("# o BODY", None),
    ("v 1 2 3", None),
    ("usemtl body", None),
    ("", None),
]


class MaterialNameTest(unittest.TestCase):

    def test_a_material_is_the_whole_rest_of_its_line(self):
        for line, keyword, name in CASES:
            with self.subTest(line=line, keyword=keyword):
                self.assertEqual(ir2rwat.material_name(line, keyword), name)

    def test_the_mtl_keeps_a_spaced_name(self):
        mtl = (b"newmtl Dark Wood\nmap_Kd wood.png\nnewmtl glass\r\nmap_Kd ../glass.png\r\n"
               b"newmtl\tBrass Pipe \nmap_Kd brass.png\n")
        self.assertEqual(ir2rwat.parse_mtl(mtl),
                         {"Dark Wood": "wood.png", "glass": "../glass.png", "Brass Pipe": "brass.png"})


class ObjectNameTest(unittest.TestCase):

    def test_an_object_is_the_whole_rest_of_its_line(self):
        for line, name in OBJECT_CASES:
            with self.subTest(line=line):
                self.assertEqual(floorgen.object_name_of(line), name)
                self.assertEqual(floorgen.object_name_of(line + "\n"), name)

    def test_every_reader_of_the_tools_names_objects_so(self):
        # faces before any o/g line are the default object's, as in the engine's loader
        obj = (b"v 0 0 0\nv 1 0 1\nv 1 0 0\nf 1 2 3\no Door Leaf\nf 1 2 3\n"
               b"g\tDOOR_1_ROT_90\nf 1 2 3\no\nf 1 2 3\n")
        _, objects, _, boxes = ir2rwat.parse_obj(obj)
        self.assertEqual(objects, ["default", "Door Leaf", "DOOR_1_ROT_90", "default"])
        self.assertEqual(sorted(boxes), ["DOOR_1_ROT_90", "Door Leaf", "default"])
        names, triangles = floorgen.read_triangles(obj)
        self.assertEqual(names, ["default", "Door Leaf", "DOOR_1_ROT_90"])
        self.assertEqual([names[i] for i, _ in triangles], ["default", "Door Leaf", "DOOR_1_ROT_90", "default"])
        levels = ir2rwat.floor_levels(obj, min_area=0.0)
        self.assertEqual(levels[0][3], ["DOOR_1_ROT_90", "Door Leaf", "default"])


if __name__ == "__main__":
    unittest.main()
