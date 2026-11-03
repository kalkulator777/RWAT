"""fixtures/golden/floor_region/ (golden.py): the converter's port of stock.FloorRegion —
floorgen.Region (pieces, cuts, fits, reach) of a type's floor, the pack's zones and
doors turned into the model frame (floorgen.box_from_obj, engine_doors) and the shut
inner doors cut out (Door.cut), as WagonType.Interior.region does. The links, nearest
and floor answers are the engine's and the editor's."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import golden  # noqa: E402
import floorgen  # noqa: E402


def region(given):
    """The floorgen region of a case: its type's zones and the cuts of its shut inner doors."""
    margin = given.get("margin", floorgen.HALF_WIDTH)
    mask = given.get("open", 0)
    interior = floorgen.interior_from_obj(given["type"]["interior"])
    zones = interior if isinstance(interior, list) else [interior]
    doors = floorgen.engine_doors(given["type"].get("doors", []))
    # Door.open: a fixed doorway is always open, the first 32 by their bits
    cuts = [d.cut(margin) for i, d in enumerate(doors) if d.inner and not (d.fixed or (i < 32 and mask >> i & 1))]
    return floorgen.Region([(z["min"][0], z["min"][2], z["max"][0], z["max"][2]) for z in zones], margin, cuts)


def answers(given, expected):
    r = region(given)
    actual = {"pieces": r.pieces, "cuts": r.cuts,
              "fits": [r.fits(x, z) for x, z in given.get("fits", [])],
              "reach": [golden.number(r.reach(x, z, int(a), int(d))) for x, z, a, d in given.get("reach", [])]}
    return actual, {key: expected[key] for key in actual}


class FloorRegionGolden(golden.PortTest):
    FOLDER = "floor_region"

    def test_pieces_cuts_fits_reach(self):
        self.check(answers)


if __name__ == "__main__":
    unittest.main()
