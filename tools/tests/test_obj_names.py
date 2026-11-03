"""What a material is called in an OBJ's "usemtl" and an MTL's "newmtl", and an
object in an OBJ's "o" or "g": the whole rest of the line, the spaces inside kept
(as Blender reads them, and Immersive Railroading its objects). The mod's OBJ
loader used to take the first word of both and its MTL parser the whole line, so
a material named "Dark Wood" found no texture, and an object "o Door Leaf" was
"Door" to the mod and "Door Leaf" to the converter. The mod reads materials with
MtlParser.materialName and objects with ObjectRole.objectName; the converter's
ports are ir2rwat.material_name and floorgen.object_name_of. Their line -> name
cases are the shared golden data (fixtures/golden/mtl/material_names.json and
fixtures/golden/obj/object_names.json, test_golden_mtl.py and test_golden_obj.py); here, the readers that use them."""

import unittest

from irpack import floorgen, ir2rwat


class MaterialNameTest(unittest.TestCase):

    def test_the_mtl_keeps_a_spaced_name(self):
        mtl = (b"newmtl Dark Wood\nmap_Kd wood.png\nnewmtl glass\r\nmap_Kd ../glass.png\r\n"
               b"newmtl\tBrass Pipe \nmap_Kd brass.png\n")
        self.assertEqual(ir2rwat.parse_mtl(mtl),
                         {"Dark Wood": "wood.png", "glass": "../glass.png", "Brass Pipe": "brass.png"})


class ObjectNameTest(unittest.TestCase):

    def test_a_line_end_is_no_part_of_the_name(self):
        # the tools read lines with their "\n" (the golden cases have none)
        self.assertEqual(floorgen.object_name_of("o Door Leaf\n"), "Door Leaf")
        self.assertEqual(floorgen.object_name_of("o\r\n"), "default")

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
