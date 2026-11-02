"""fixtures/golden/obj_frame/ (golden.py): the converter's port of stock.ObjFrame —
floorgen.point_from_obj, point_to_obj, box_from_obj, box_to_obj."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import golden  # noqa: E402
import floorgen  # noqa: E402


def turned(given, expected):
    if "point_obj" in given:
        return {"model": floorgen.point_from_obj(given["point_obj"])}, expected
    if "point_model" in given:
        return {"obj": floorgen.point_to_obj(given["point_model"])}, expected
    if "box_obj" in given:
        return {"model": floorgen.box_from_obj(given["box_obj"])}, expected
    return {"obj": floorgen.box_to_obj(given["box_model"])}, expected


class ObjFrameGolden(golden.PortTest):
    FOLDER = "obj_frame"

    def test_points_and_boxes(self):
        self.check(turned)


if __name__ == "__main__":
    unittest.main()
