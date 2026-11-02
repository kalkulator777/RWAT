"""fixtures/golden/floor_check/ (golden.py): the converter's port of the floor check's
ways out (kinematics.FloorCheck.walkablePieces) — floorgen.Region.door_seeds: for each
hull or gangway door of a type, the pieces of its floor, every door between zones shut,
a rider walks out through it from. The findings themselves are the engine's and the
editor's."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import golden  # noqa: E402
import floorgen  # noqa: E402


def exits(given, expected):
    t = given["exits_of"]
    if "interior" not in t:
        return None, expected
    interior = floorgen.interior_from_obj(t["interior"])
    zones = interior if isinstance(interior, list) else [interior]
    doors = floorgen.engine_doors(t.get("doors", []))
    shut = floorgen.Region([(z["min"][0], z["min"][2], z["max"][0], z["max"][2]) for z in zones],
                           floorgen.HALF_WIDTH, floorgen.shut_cuts(doors))
    return [None if d.inner else shut.door_seeds(d) for d in doors], expected


class FloorCheckGolden(golden.PortTest):
    FOLDER = "floor_check"

    def test_ways_out(self):
        self.check(exits, applies=lambda given, _: "exits_of" in given)


if __name__ == "__main__":
    unittest.main()
