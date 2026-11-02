"""fixtures/golden/anim/ (golden.py): the converter's port of the objects an .anim
moves (client.render.model.IrAnim.parse) — ir2rwat.anim_objects. The frames are the
engine's and the editor's; a file the engine refuses is the engine's to refuse, the
converter reads only its names."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import golden  # noqa: E402
import ir2rwat  # noqa: E402


class AnimGolden(golden.PortTest):
    FOLDER = "anim"

    def test_objects(self):
        self.check(lambda given, expected: (ir2rwat.anim_objects(given["text"].encode("utf-8")),
                                            list(expected["tracks"])),
                   applies=lambda given, expected: "error" not in expected)


if __name__ == "__main__":
    unittest.main()
