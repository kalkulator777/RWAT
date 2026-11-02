"""The pieces: JSON in and out, door names, objinfo --doors against the
converter, floorgen's options, and every command line failing without a
traceback."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import irpack
from irpack import ir2rwat

sys.path.insert(0, str(irpack.TOOLS))
import floorgen  # noqa: E402
import objinfo  # noqa: E402


class JsonTest(unittest.TestCase):

    def test_dump_never_touches_strings(self):
        value = {"name": "Tank [ 15-1443 ] car", "list": ["a,b", " c ", "[ x ]"], "n": [1, 2.5]}
        text = ir2rwat.dump(value).decode("utf-8")
        self.assertEqual(json.loads(text), value)
        self.assertIn('"Tank [ 15-1443 ] car"', text)
        self.assertIn('["a,b", " c ", "[ x ]"]', text)

    def test_dump_keeps_scalar_arrays_on_one_line(self):
        value = {"min": [1.0, 2.0, 3.0], "doors": [{"id": "a", "max": [1, 2, 3]}], "empty": [], "obj": {},
                 "nested": [[1, 2], [3, 4]], "имя": "Плацкарт"}
        self.assertEqual(ir2rwat.dump(value).decode("utf-8"),
                         '{\n'
                         '  "min": [1.0, 2.0, 3.0],\n'
                         '  "doors": [\n'
                         '    {\n'
                         '      "id": "a",\n'
                         '      "max": [1, 2, 3]\n'
                         '    }\n'
                         '  ],\n'
                         '  "empty": [],\n'
                         '  "obj": {},\n'
                         '  "nested": [\n'
                         '    [1, 2],\n'
                         '    [3, 4]\n'
                         '  ],\n'
                         '  "имя": "Плацкарт"\n'
                         '}\n')

    def test_lenient_json_drops_comments_and_trailing_commas_outside_strings(self):
        raw = ('﻿// head\n{"a": "x, ]", /* block, } */ "b": [1, 2,], // tail\n'
               '"c": "// not a comment", "d": "/* nor this */", "e": "\\", ]",}').encode("utf-8")
        self.assertEqual(ir2rwat.lenient_json(raw),
                         {"a": "x, ]", "b": [1, 2], "c": "// not a comment", "d": "/* nor this */", "e": '", ]'})

    def test_lenient_json_errors_point_at_the_file(self):
        with self.assertRaises(json.JSONDecodeError) as caught:
            ir2rwat.lenient_json(b'// one\n// two\n{"a": 1,\n "b": }')
        self.assertEqual((caught.exception.lineno, caught.exception.colno), (4, 7))


class DoorNameTest(unittest.TestCase):

    BOX = [0.0, 1.0, 0.0, 0.1, 3.0, 1.0]

    def test_door_with_blenders_copy_suffix_is_recognized(self):
        doors = ir2rwat.derive_doors({"DOOR_3.001": self.BOX})
        self.assertEqual([d["id"] for d in doors], ["door_3"])
        self.assertEqual(ir2rwat.door_motion({"DOOR_3.001": self.BOX}, set()), {"DOOR_3": {"group": None, "moves": "none"}})

    def test_widget_door_and_handbrake_with_copy_suffix(self):
        doors = ir2rwat.widget_doors({"WIDGET_4_TOGGLE_CG_Door.002": self.BOX}, {"door"})
        self.assertEqual([d["id"] for d in doors], ["Door"])
        self.assertEqual(ir2rwat.derive_handbrake(["WIDGET_5_LABEL_Hand^Brake.001"]), ["WIDGET_5"])


class ConverterParityTest(unittest.TestCase):
    """objinfo --doors and floorgen read the type the way the converter does."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        irpack.write_zip(Path(cls.tmp.name) / "ir.zip", irpack.pack_files())
        cls.recipe = irpack.write_recipe(cls.tmp.name, [("ir.zip", "stock")])

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_objinfo_doors_are_the_converters(self):
        status, out, err = irpack.quiet(objinfo.main, ["test_coach", "--doors", "--recipe", str(self.recipe)])
        self.assertEqual(status, 0, err)
        printed = json.loads(out.split("\n", 1)[1])
        converter, _, _ = irpack.quiet(ir2rwat.Converter, self.recipe)
        plan, _, _ = irpack.quiet(converter.plan, "test_coach")
        self.assertEqual(printed, plan["doors_in_model"])
        # the WIDGET door is there: the DOOR_<n> rule alone (objinfo's old answer) has two doors, not three
        self.assertEqual([d["id"] for d in printed], ["door_1", "door_3", "DoorA"])
        self.assertEqual(len(ir2rwat.derive_doors(plan["boxes"])), 2)

    def test_objinfo_on_a_bare_obj_says_what_it_leaves_out(self):
        obj = Path(self.tmp.name) / "coach.obj"
        obj.write_bytes(irpack.COACH_OBJ)
        status, out, err = irpack.quiet(objinfo.main, [str(obj), "--doors"])
        self.assertEqual(status, 0, err)
        self.assertIn("no WIDGET doors", out.split("\n", 1)[0])
        self.assertEqual([d["id"] for d in json.loads(out.split("\n", 1)[1])], ["door_1", "door_3"])

    def test_floorgen_reports_a_type_without_a_floor(self):
        status, out, err = irpack.quiet(floorgen.main, [str(self.recipe), "hopper"])
        self.assertEqual(status, 1)
        self.assertIn("floorgen: error: hopper: no floor generated — ", err)

    def test_floorgen_maps_the_coach(self):
        status, out, err = irpack.quiet(floorgen.main, [str(self.recipe), "test_coach", "--ascii", "--json"])
        self.assertEqual(status, 0, err)
        # the floor at OBJ y 0.9, found in the engine's frame and rounded there (1.336): 0.89975
        self.assertIn("test_coach: level(s) [0.89975]", out)
        self.assertIn("level 0.89975 (OBJ frame)", out)


class FloorConfigTest(unittest.TestCase):

    def test_bad_options_name_the_member(self):
        cases = [
            ({"clearance": "0.1"}, "\"floor\".clearance must be a number"),
            ({"clearance": -1}, "clearance can't be negative"),
            ({"level": []}, "\"floor\".level is a height"),
            ({"level": [1.0, "x"]}, "\"floor\".level must be a number"),
            ({"add": {"min": [0, 0, 0]}}, "\"floor\".add must be a list"),
            ({"add": [{"min": [0, 0], "max": [1, 1, 1]}]}, "\"floor\".add: each entry"),
            ({"remove": [{"min": [0, 0, "a"], "max": [1, 1, 1]}]}, "\"floor\".remove must be a number"),
            ({"ignore": ["("]}, "isn't a valid regex"),
            ({"ignore": [3]}, "\"floor\".ignore lists"),
            ({"slab": [0.3]}, "\"floor\".slab is [from, to]"),
            ({"slab": [1.8, 0.3]}, "its top must be above its bottom"),
            ({"cell": 0}, "\"floor\".cell is a grid step"),
            ({"step_down": None}, "\"floor\".step_down must be a number"),
            ({"clearence": 0.1}, "unknown key(s) ['clearence']"),
            ([1, 2], "\"floor\" must be an object"),
        ]
        for options, message in cases:
            with self.subTest(options=options):
                with self.assertRaises(floorgen.FloorConfigError) as caught:
                    floorgen.FloorConfig(options)
                self.assertIn(message, str(caught.exception))
                self.assertIsInstance(caught.exception, ValueError)

    def test_good_options(self):
        config = floorgen.FloorConfig({"level": 1.375, "clearance": 0, "slab": [0.3, 1.8], "ignore": ["SEAT_.*"],
                                       "add": [{"min": [-1, 1.375, 0.5], "max": [2, 1.375, 1]}],
                                       "remove": [{"min": [3, 1.375, -1], "max": [4, 1.375, 1]}]})
        self.assertEqual(config.clearance, 0.0)
        # written in the OBJ frame, kept in the engine's: x = z, y + 0.43625, z = -x (min and max trade along it)
        self.assertEqual(config.levels, [1.81125])
        self.assertEqual(config.add, [{"min": [0.5, 1.81125, -2.0], "max": [1.0, 1.81125, 1.0]}])
        self.assertEqual(config.remove, [{"min": [-1.0, 1.81125, -4.0], "max": [1.0, 1.81125, -3.0]}])


class CommandLineTest(unittest.TestCase):
    """Each tool run as a user runs it (python -I), failing: a message, an exit status, no traceback."""

    def run_tool(self, tool, *args):
        done = subprocess.run([sys.executable, "-I", str(irpack.TOOLS / tool), *map(str, args)],
                              capture_output=True, text=True, encoding="utf-8")
        self.assertNotIn("Traceback", done.stdout + done.stderr)
        return done

    def test_ir2rwat_bad_recipe(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = self.run_tool("ir2rwat.py", Path(tmp) / "nothing.json")
            self.assertEqual(missing.returncode, 2)
            self.assertIn("ir2rwat: error: cannot read the recipe", missing.stderr)
            broken = Path(tmp) / "broken.json"
            broken.write_text("{", encoding="utf-8")
            done = self.run_tool("ir2rwat.py", broken)
            self.assertEqual(done.returncode, 2)
            self.assertIn("not valid JSON", done.stderr)

    def test_ir2rwat_converts_and_reports_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            files = irpack.pack_files()
            files.update(irpack.broken_files())
            irpack.write_zip(Path(tmp) / "ir.zip", files)
            done = self.run_tool("ir2rwat.py", irpack.write_recipe(tmp, [("ir.zip", "stock")]))
            self.assertEqual(done.returncode, 1, done.stderr)
            self.assertIn("error(s), see above", done.stdout)

    def test_floorgen_and_objinfo(self):
        with tempfile.TemporaryDirectory() as tmp:
            irpack.write_zip(Path(tmp) / "ir.zip", irpack.pack_files())
            recipe = irpack.write_recipe(tmp, [("ir.zip", "stock")])
            done = self.run_tool("floorgen.py", recipe, "no_such_type")
            self.assertEqual(done.returncode, 2)
            self.assertIn("floorgen: error: no stock type 'no_such_type'", done.stderr)
            done = self.run_tool("floorgen.py", recipe, "loco")
            self.assertEqual(done.returncode, 1)
            self.assertIn("floorgen: error: loco: no floor generated", done.stderr)
            done = self.run_tool("objinfo.py", "no_such_type", "--pack", tmp)
            self.assertEqual(done.returncode, 1)
            self.assertIn("objinfo: error: no model 'no_such_type'", done.stderr)
            done = self.run_tool("objinfo.py", "no_such_type", "--doors", "--recipe", recipe)
            self.assertEqual(done.returncode, 1)
            self.assertIn("objinfo: error: no stock type 'no_such_type'", done.stderr)


if __name__ == "__main__":
    unittest.main()
