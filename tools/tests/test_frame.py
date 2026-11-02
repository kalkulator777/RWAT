"""The OBJ frame (roadmap R6): what the tools write and read — the pack's zones
and doors, the per-type file's "interior", "doors" and "floor", the geometry
digest, objinfo — is in the model's own coordinates, as Blender shows them;
the generator works in the engine's model frame inside and translates at the
edges, exactly (stock.ObjFrame is the Java side of it)."""

import json
import tempfile
import unittest
from pathlib import Path

import irpack
from irpack import floorgen, ir2rwat

import objinfo  # noqa: E402  (irpack put tools/ on the path)


class FrameTest(unittest.TestCase):
    """floorgen's translation, the port of stock.ObjFrame."""

    def test_the_lift_is_the_engines(self):
        self.assertEqual(floorgen.Y_LIFT, 0.43625)

    def test_a_point_turns_a_quarter_about_y_and_lifts(self):
        self.assertEqual(floorgen.point_from_obj([-8.75, 1.9, 0.6]), [0.6, 2.33625, 8.75])
        self.assertEqual(floorgen.point_to_obj([0.6, 2.33625, 8.75]), [-8.75, 1.9, 0.6])

    def test_a_box_trades_min_and_max_along_the_car(self):
        # the platzkart's vestibule door, as docs/pack-format.md shows it
        legacy = {"id": "DoorTambur", "min": [0.344, 1.811, -10.844], "max": [1.031, 4.061, -10.781], "inner": True}
        obj = floorgen.box_to_obj(legacy)
        self.assertEqual(obj, {"id": "DoorTambur", "min": [10.781, 1.37475, 0.344], "max": [10.844, 3.62475, 1.031],
                               "inner": True})
        self.assertEqual(floorgen.box_from_obj(obj), legacy)

    def test_translation_is_exact_both_ways(self):
        # a value with a few decimals comes back as itself, never with float noise or as -0.0
        for value in ([0.0, 0.0, 0.0], [-12.5, 2.311, 1.4375], [9.0, 0.43625, -1.7]):
            self.assertEqual(floorgen.point_from_obj(floorgen.point_to_obj(value)), value)
        self.assertEqual(repr(floorgen.point_to_obj([0.0, 1.0, 0.0])[0]), "0.0")

    def test_an_interior_of_one_zone_or_a_list(self):
        zone = {"min": [-1.0, 1.0, -4.0], "max": [1.0, 3.0, 4.0]}
        self.assertEqual(floorgen.interior_to_obj(zone), {"min": [-4.0, 0.56375, -1.0], "max": [4.0, 2.56375, 1.0]})
        self.assertEqual(floorgen.interior_to_obj([zone]), [floorgen.interior_to_obj(zone)])
        self.assertEqual(floorgen.interior_from_obj(floorgen.interior_to_obj([zone])), [zone])

    def test_a_flat_box(self):
        self.assertEqual(floorgen.flat_box_to_obj([-1.4, 1.33625, -5.0, 1.4, 1.33625, 5.0]),
                         [-5.0, 0.9, -1.4, 5.0, 0.9, 1.4])


class ConvertedFrameTest(unittest.TestCase):
    """The converter and the tools around it on the synthetic IR pack: its coach
    has a floor at OBJ y 0.9 over x -5..5, z -1.4..1.4, a side door DOOR_1 at
    x -1..0 in the +z wall, an inner WIDGET door across the car at x 2.95..3.05."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name)
        irpack.write_zip(self.folder / "ir.zip", irpack.pack_files())
        self.pack = self.folder / "out" / "TestPack"

    def tearDown(self):
        self.tmp.cleanup()

    def per_type(self, name, value):
        (self.folder / "tp").mkdir(exist_ok=True)
        (self.folder / "tp" / f"{name}.json").write_text(json.dumps(value), encoding="utf-8")

    def convert(self, *args, **extra):
        status, out, err = irpack.convert(irpack.write_recipe(self.folder, [("ir.zip", "stock")], **extra), *args)
        self.assertEqual(status, 0, out + err)
        return out

    def wagon(self):
        return json.loads((self.pack / "data/tp/wagon_types/test_coach.json").read_text("utf-8"))

    def test_the_generated_doors_and_floor_are_in_the_obj_frame(self):
        self.convert()
        wagon = self.wagon()
        doors = {d["id"]: d for d in wagon["doors"]}
        # x and z as the OBJ has them; y found in the engine's frame and rounded there (1.336 - 0.43625)
        self.assertEqual([doors["door_1"]["min"][0], doors["door_1"]["min"][2]], [-1.0, 1.35])
        self.assertEqual([doors["door_1"]["max"][0], doors["door_1"]["max"][2]], [0.0, 1.45])
        self.assertAlmostEqual(doors["door_1"]["min"][1], 0.9, delta=1e-3)
        self.assertEqual([doors["DoorA"]["min"][0], doors["DoorA"]["max"][0]], [2.95, 3.05])
        for zone in wagon["interior"]:
            self.assertEqual(zone["min"][1], 0.89975)
            self.assertTrue(-5.0 <= zone["min"][0] < zone["max"][0] <= 5.0, zone)
            self.assertTrue(-1.4 <= zone["min"][2] < zone["max"][2] <= 1.4, zone)

    def test_the_per_type_files_markup_is_read_in_the_obj_frame(self):
        # a floor level at the OBJ's 0.9: in the engine's frame there is no surface near 0.9
        self.per_type("test_coach", {"floor": {"level": 0.9, "remove": [{"min": [-5.0, 0.9, -1.4], "max": [-4.0, 0.9, 1.4]}]},
                                     "type": {"doors": {"door_9": {"min": [4.9, 0.9, -0.5], "max": [5.0, 2.9, 0.5],
                                                                   "connecting": True}}}})
        self.convert(overrides_dir="tp")
        wagon = self.wagon()
        self.assertEqual(wagon["doors"][-1], {"id": "door_9", "min": [4.9, 0.9, -0.5], "max": [5.0, 2.9, 0.5],
                                              "connecting": True})
        self.assertEqual({zone["min"][1] for zone in wagon["interior"]}, {0.9})
        self.assertTrue(all(zone["min"][0] >= -4.0 for zone in wagon["interior"]),
                        "the removed box is the front metre, OBJ x -5..-4")
        # a hand interior and chairs go to the pack as written
        self.per_type("test_coach", {"type": {"interior": [{"min": [-4.5, 0.9, -1.3], "max": [4.5, 3.4, 1.3]}],
                                              "cab": {"seats": [{"at": [-4.0, 1.4, 0.6], "yaw": 180}]}}})
        self.convert(overrides_dir="tp")
        wagon = self.wagon()
        self.assertEqual(wagon["interior"], [{"min": [-4.5, 0.9, -1.3], "max": [4.5, 3.4, 1.3]}])
        self.assertEqual(wagon["cab"], {"seats": [{"at": [-4.0, 1.4, 0.6], "yaw": 180}]})

    def test_the_geometry_digest_is_in_the_obj_frame(self):
        geometry = self.folder / "geometry"
        self.convert("--geometry", geometry)
        digest = json.loads((geometry / "test_coach.json").read_text("utf-8"))
        self.assertIn("OBJ frame", digest["_about"])
        self.assertIn("tools/ir2rwat.py --geometry", digest["_about"])  # still known as a digest
        self.assertEqual(digest["objects"]["FLOOR"], [-5.0, 0.9, -1.4, 5.0, 0.9, 1.4])
        self.assertEqual(digest["objects"]["DOOR_1_EXTERNAL"], [-1.0, 0.9, 1.35, 0.0, 3.0, 1.45])
        level = next(lv for lv in digest["floor_levels"] if lv["y"] == 0.9)
        self.assertEqual((level["plan_min_x_z"], level["plan_max_x_z"]), ([-5.0, -1.4], [5.0, 1.4]))
        self.assertEqual(digest["derived"]["floor"]["levels"], [0.89975])
        self.assertEqual(digest["doors_in_model"], self.wagon()["doors"])
        self.assertEqual(digest["derived"]["interior"], self.wagon()["interior"])

    def test_objinfo_prints_the_obj_frame(self):
        self.convert()
        status, out, err = irpack.quiet(objinfo.main, ["test_coach", "--pack", str(self.pack), "--grep", "^FLOOR$"])
        self.assertEqual(status, 0, err)
        self.assertIn("[ -5.000,   0.900,   -1.400] .. [  5.000,   0.900,    1.400]", out)
        status, out, err = irpack.quiet(objinfo.main, ["test_coach", "--pack", str(self.pack), "--floors",
                                                       "--x", "-6", "6", "--z", "-2", "2"])
        self.assertEqual(status, 0, err)
        self.assertIn("y   0.900", out)
        self.assertIn("x  -5.000..  5.000  z   -1.400..   1.400", out)

    def test_floorgen_window_and_level_are_obj(self):
        recipe = irpack.write_recipe(self.folder, [("ir.zip", "stock")])
        status, out, err = irpack.quiet(floorgen.main, [str(recipe), "test_coach", "--ascii", "--level", "0.9",
                                                        "--x", "-1", "1"])
        self.assertEqual(status, 0, err)
        self.assertIn("level(s) [0.9]", out)
        rows = [float(line.split()[0]) for line in out.splitlines()[3:] if line.strip()]
        self.assertTrue(rows and all(-1.0 - 0.07 <= x <= 1.0 + 0.07 for x in rows), rows)
        self.assertGreater(rows[0], rows[-1], "the rows run towards the front, -x")


class DoorsTest(unittest.TestCase):

    def test_model_doors_come_in_the_obj_frame(self):
        _, _, _, boxes = ir2rwat.parse_obj(irpack.COACH_OBJ)
        doors = {d["id"]: d for d in ir2rwat.model_doors(boxes, set())}
        self.assertEqual(doors["door_3"]["min"][0], -4.0)
        self.assertEqual(doors["door_3"]["max"][2], -1.35)
        # the derived ones, before the pack sees them, are the engine's
        engine = {d["id"]: d for d in ir2rwat.derive_doors(boxes)}
        self.assertEqual(floorgen.box_to_obj(engine["door_3"]), doors["door_3"])


if __name__ == "__main__":
    unittest.main()
