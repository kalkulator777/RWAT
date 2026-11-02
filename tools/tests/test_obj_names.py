"""What a material is called in an OBJ's "usemtl" and an MTL's "newmtl": the whole
rest of the line, the spaces inside kept (as Blender reads and writes them). The
mod's OBJ loader used to take the first word and its MTL parser the whole line, so
a material named "Dark Wood" found no texture; the mod now reads both with
MtlParser.materialName, and this is the converter's port of the same rule. The
cases are the same as MaterialNamesTest.cases (src/test/java/.../client/render/model)."""

import unittest

from irpack import ir2rwat

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


if __name__ == "__main__":
    unittest.main()
