"""fixtures/golden/mtl/ (golden.py): the converter's port of the MTL reader
(client.render.model.MtlParser) — ir2rwat.material_name, what a newmtl/usemtl line
names, and ir2rwat.parse_mtl, material -> its map_Kd path. The paths' rules
(resolve, folderOf, fileNameOf) are the engine's and the editor's."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import golden  # noqa: E402
import ir2rwat  # noqa: E402


class MtlGolden(golden.PortTest):
    FOLDER = "mtl"

    def test_material_names(self):
        self.check(lambda given, expected: (ir2rwat.material_name(given["line"], given["keyword"]), expected),
                   applies=lambda given, _: "line" in given)

    def test_maps(self):
        self.check(lambda given, expected: (ir2rwat.parse_mtl(given["text"].encode("utf-8")), expected),
                   applies=lambda given, _: "text" in given)


if __name__ == "__main__":
    unittest.main()
