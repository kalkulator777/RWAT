"""The converter's ports of the engine's logic against the shared golden data of
fixtures/golden/ (see its README): the same cases the engine's GoldenTest runs, with
the values Java computed. Only what is ported here is checked: object and material
names, the OBJ frame, the floor region (pieces, cuts, fits, reach) and the objects of
an .anim; the rest of each file is for the engine and the editor."""

import json
import math
import unittest
from pathlib import Path

from irpack import floorgen, ir2rwat

GOLDEN = Path(__file__).resolve().parents[2] / "fixtures" / "golden"


def cases(name):
    return json.loads((GOLDEN / name).read_text(encoding="utf-8"))["cases"]


def close(actual, expected, tol=1e-9):
    """True if two JSON-like values agree, numbers within tol; NaN agrees with null
    (JSON has no NaN: the golden files write it null)."""
    if expected is None:
        return actual is None or (isinstance(actual, float) and math.isnan(actual))
    if isinstance(expected, bool) or isinstance(actual, bool):
        return actual is expected
    if isinstance(expected, (int, float)):
        return isinstance(actual, (int, float)) and abs(actual - expected) <= tol
    if isinstance(expected, (list, tuple)):
        return isinstance(actual, (list, tuple)) and len(actual) == len(expected) \
            and all(close(a, e, tol) for a, e in zip(actual, expected))
    if isinstance(expected, dict):
        return isinstance(actual, dict) and actual.keys() == expected.keys() \
            and all(close(actual[k], expected[k], tol) for k in expected)
    return actual == expected


class GoldenTest(unittest.TestCase):

    def check(self, name, actual, expected):
        self.assertTrue(close(actual, expected), f"{name}:\n  expected {expected}\n  but was  {actual}")

    def test_object_names(self):
        for c in cases("object_names.json"):
            with self.subTest(c["name"]):
                self.check(c["name"], floorgen.object_name_of(c["input"]["line"]), c["expected"])

    def test_material_names(self):
        for c in cases("material_names.json"):
            with self.subTest(c["name"]):
                self.check(c["name"], ir2rwat.material_name(c["input"]["line"], c["input"]["keyword"]), c["expected"])

    def test_obj_frame(self):
        for c in cases("obj_frame.json"):
            given, expected = c["input"], c["expected"]
            with self.subTest(c["name"]):
                if "point_obj" in given:
                    actual = {"model": floorgen.point_from_obj(given["point_obj"])}
                elif "point_model" in given:
                    actual = {"obj": floorgen.point_to_obj(given["point_model"])}
                elif "box_obj" in given:
                    actual = {"model": floorgen.box_from_obj(given["box_obj"])}
                else:
                    actual = {"obj": floorgen.box_to_obj(given["box_model"])}
                self.check(c["name"], actual, expected)

    def test_floor(self):
        for c in cases("floor.json"):
            given, expected = c["input"], c["expected"]
            with self.subTest(c["name"]):
                margin = given.get("margin", floorgen.HALF_WIDTH)
                mask = given.get("open", 0)
                doors = [floorgen.Door(d) for d in given.get("doors", [])]
                cuts = [d.cut(margin) for i, d in enumerate(doors)
                        if d.inner and not (d.fixed or (i < 32 and mask >> i & 1))]
                region = floorgen.Region([(z[0], z[2], z[3], z[5]) for z in given["zones"]], margin, cuts)
                self.check(c["name"] + " pieces", region.pieces, expected["pieces"])
                self.check(c["name"] + " cuts", region.cuts, expected["cuts"])
                self.check(c["name"] + " fits", [region.fits(x, z) for x, z in given.get("fits", [])], expected["fits"])
                self.check(c["name"] + " reach", [region.reach(x, z, int(a), int(d))
                                                  for x, z, a, d in given.get("reach", [])], expected["reach"])

    def test_anim_objects(self):
        for c in cases("anim.json"):
            if c["expected"].get("error"):
                continue  # the converter reads only the names; a broken frame is the engine's to refuse
            with self.subTest(c["name"]):
                self.check(c["name"], ir2rwat.anim_objects(c["input"]["text"].encode("utf-8")),
                           list(c["expected"]["tracks"]))


if __name__ == "__main__":
    unittest.main()
