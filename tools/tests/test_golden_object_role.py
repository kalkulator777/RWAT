"""fixtures/golden/object_role/ (golden.py): what the converter reads of an object's
name by the engine's rules (convention.ObjectRole) — ir2rwat.object_name drops
Blender's copy suffix, then LIGHT_GROUP is the light group (_LCG_), DOOR_KEY the
door leaf's key (DOOR_<n>) and HEADLIGHT a headlight (HEADLIGHT_<n>). The rest of
a name's reading is the engine's and the editor's (the converter's control_group,
for one, skips a flag word the engine takes for a group)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import golden  # noqa: E402
import ir2rwat  # noqa: E402


def read(given, expected):
    name = ir2rwat.object_name(given["name"])
    lcg = ir2rwat.LIGHT_GROUP.search(name)
    door = ir2rwat.DOOR_KEY.search(name)
    actual = {"light_group": lcg.group(1) if lcg else None,
              "door": "DOOR_" + door.group(1) if door else None,
              "headlight": ir2rwat.HEADLIGHT.search(name) is not None}
    return actual, {"light_group": expected["light_group"],
                    "door": expected["door"]["key"] if expected["door"] else None,
                    "headlight": expected["headlight"]}


class ObjectRoleGolden(golden.PortTest):
    FOLDER = "object_role"

    def test_light_group_door_key_headlight(self):
        self.check(read)


if __name__ == "__main__":
    unittest.main()
