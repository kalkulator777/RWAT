"""A control or light group named longer than the engine takes (convention.GroupName,
32 characters) is dropped as the model loads; the converter says so while it converts,
once per name and type, before the pack reaches a game."""

import tempfile
import unittest
from pathlib import Path

import irpack
from irpack import ir2rwat

FITS = "G" * ir2rwat.MAX_GROUP_LENGTH
LONG = FITS + "X"


class GroupsTooLongTest(unittest.TestCase):

    def test_the_limit_is_the_engines(self):
        self.assertEqual(ir2rwat.MAX_GROUP_LENGTH, 32)  # convention/GroupName.java#MAX_LENGTH

    def test_a_switch_and_a_light_over_the_limit_are_found_a_name_at_it_is_not(self):
        names = [f"WIDGET_1_TOGGLE_CG_{LONG}", f"WIDGET_2_TOGGLE_CG_{FITS}", f"BODY_LCG_{LONG}_FULLBRIGHT",
                 f"BODY_LCG_{FITS}"]
        self.assertEqual(ir2rwat.groups_too_long(names), [LONG])

    def test_each_name_once_in_the_order_the_objects_come(self):
        other = "H" * 40
        names = [f"WIDGET_3_CG_{other}", f"WIDGET_1_CG_{LONG}", f"INTERIOR_LCG_{LONG}", f"WINDOW_2_CG_{other}.001"]
        self.assertEqual(ir2rwat.groups_too_long(names), [other, LONG])

    def test_a_name_is_read_without_the_copy_suffix(self):
        self.assertEqual(ir2rwat.groups_too_long([f"WIDGET_1_CG_{LONG}.001"]), [LONG])
        self.assertEqual(ir2rwat.groups_too_long([f"WIDGET_1_CG_{FITS}.001"]), [])

    def test_a_group_that_never_travels_is_no_problem(self):
        names = [f"GAUGE_SPEED_1_CG_{LONG}",       # a gauge
                 f"DOOR_7_EXTERNAL_CG_{LONG}",     # a door leaf
                 f"HANDBRAKE_1_CG_{LONG}",         # the handbrake wheel
                 f"THROTTLE_1_CG_{LONG}",          # a handle lever
                 f"BODY_CG_{LONG}"]                # no control at all
        self.assertEqual(ir2rwat.groups_too_long(names), [])

    def test_other_kinds_that_set_a_group_count(self):
        for kind in ("BELL_CONTROL", "WHISTLE_CONTROL", "HORN_CONTROL", "ENGINE_START", "WINDOW", "THROTTLE_BRAKE"):
            self.assertEqual(ir2rwat.groups_too_long([f"{kind}_1_CG_{LONG}"]), [LONG], kind)

    def test_a_character_beyond_the_bmp_is_two_to_java(self):
        sixteen = "\U0001F682" * 16  # 16 characters, 32 UTF-16 units: fits
        self.assertEqual(ir2rwat.groups_too_long([f"WIDGET_1_CG_{sixteen}"]), [])
        self.assertEqual(ir2rwat.groups_too_long([f"WIDGET_1_CG_{sixteen}\U0001F683"]), [sixteen + "\U0001F683"])


class ConverterWarnsTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        folder = Path(cls.tmp.name)
        box = irpack.cuboid((-1, 0, -1), (1, 1, 1))
        switch = irpack.cuboid((0.0, 1.0, 0.0), (0.1, 1.1, 0.1))
        files = {
            "pack.mcmeta": b'{"pack": {"pack_format": 3, "description": "test"}}',
            "LICENSE.txt": b"CC0\n",
            irpack.IR + "rolling_stock/stock.json": b'{"freight": ["long_groups", "short_groups"]}',
            irpack.IR + "rolling_stock/freight/long_groups.json": irpack.definition(
                name="Long groups",
                model="immersiverailroading:models/rolling_stock/freight/long_groups/long_groups.obj",
                properties={"weight_kg": 20000}, trucks={"front": 2.0, "rear": -2.0}),
            irpack.IR + "rolling_stock/freight/short_groups.json": irpack.definition(
                name="Short groups",
                model="immersiverailroading:models/rolling_stock/freight/short_groups/short_groups.obj",
                properties={"weight_kg": 20000}, trucks={"front": 2.0, "rear": -2.0}),
            # the same long switch group on two objects, a long light group, one that fits, a gauge's
            irpack.IR + "models/rolling_stock/freight/long_groups/long_groups.obj": irpack.obj([
                ("BODY", box),
                (f"WIDGET_1_TOGGLE_CG_{LONG}", switch),
                (f"WIDGET_2_TOGGLE_CG_{LONG}", switch),
                (f"LAMP_LCG_{'L' * 40}_FULLBRIGHT", switch),
                (f"WIDGET_3_TOGGLE_CG_{FITS}", switch),
                (f"GAUGE_SPEED_1_CG_{LONG}", switch),
            ]),
            irpack.IR + "models/rolling_stock/freight/short_groups/short_groups.obj": irpack.obj([
                ("BODY", box),
                (f"WIDGET_1_TOGGLE_CG_{FITS}", switch),
                (f"LAMP_LCG_{FITS}_FULLBRIGHT", switch),
            ]),
        }
        irpack.write_zip(folder / "ir.zip", files)
        recipe = irpack.write_recipe(folder, [("ir.zip", "stock")])
        cls.status, cls.out, cls.err = irpack.convert(recipe)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def warnings(self):
        return [line.strip() for line in self.out.splitlines() if "WARNING:" in line and "control group" in line]

    def test_the_run_goes_through(self):
        self.assertIn(self.status, (0, 1), self.out + self.err)
        self.assertNotIn("Traceback", self.out + self.err)

    def test_each_long_name_of_a_type_is_warned_once(self):
        warned = self.warnings()
        self.assertEqual(len(warned), 2, warned)
        self.assertIn(f"long_groups: control group '{LONG}' is longer than 32 characters", warned[0])
        self.assertIn(f"long_groups: control group '{'L' * 40}' is longer than 32 characters", warned[1])
        self.assertIn("its switches can't be worked, its lights stay off (an LINVERT one on)", warned[0])

    def test_names_that_fit_and_groups_that_never_travel_are_not_warned(self):
        self.assertFalse(any("short_groups" in line for line in self.warnings()))
        self.assertFalse(any(f"'{FITS}'" in line for line in self.warnings()))

    def test_the_pack_is_written_all_the_same(self):
        self.assertIn("2 stock type(s)", self.out)


if __name__ == "__main__":
    unittest.main()
