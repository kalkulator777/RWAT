"""fixtures/golden/obj/ (golden.py): the converter's port of what an OBJ "o"/"g" line
names (convention.ObjectRole.objectName) — floorgen.object_name_of. The parts of a
model are the engine's and the editor's: the converter reads names and boxes only."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import golden  # noqa: E402
import floorgen  # noqa: E402


class ObjGolden(golden.PortTest):
    FOLDER = "obj"

    def test_object_names(self):
        self.check(lambda given, expected: (floorgen.object_name_of(given["line"]), expected),
                   applies=lambda given, _: "line" in given)


if __name__ == "__main__":
    unittest.main()
