"""Converter.derived: what the converter derives for a stock type before any
override — the layer the editor puts an override on (editor/src/ir/recipe/merge.ts)."""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import irpack
from irpack import ir2rwat


class DerivedTest(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name)
        irpack.write_zip(self.folder / "ir.zip", irpack.pack_files())

    def tearDown(self):
        self.tmp.cleanup()

    def converter(self, per_type=None):
        if per_type is not None:
            (self.folder / "tp").mkdir(exist_ok=True)
            (self.folder / "tp" / "test_coach.json").write_text(json.dumps(per_type), encoding="utf-8")
        recipe = irpack.write_recipe(self.folder, [("ir.zip", "stock")], overrides_dir="tp")
        with contextlib.redirect_stdout(io.StringIO()):
            return ir2rwat.Converter(recipe)

    def derived(self, converter, type_id):
        with contextlib.redirect_stdout(io.StringIO()):  # its warnings are the conversion's
            return converter.derived(type_id)

    def test_the_coach_is_derived_from_its_definition_and_model(self):
        derived = self.derived(self.converter(), "test_coach")
        self.assertEqual(derived["category"], "passenger")
        self.assertEqual(derived["name"], "Test Coach")
        self.assertEqual(derived["type"]["mass_t"], 30.0)
        self.assertEqual([d["id"] for d in derived["doors"]], ["door_1", "door_3", "DoorA"])
        self.assertEqual(derived["interior"]["min"][0], -4.5)  # IR's passenger area
        self.assertEqual(list(derived["model"]), ["obj", "animations", "liveries", "sounds"])
        self.assertEqual(derived["model"]["animations"], {"doora": "stock/rolling_stock/passenger/test_coach/anim/doora.anim"})
        self.assertEqual(derived["lights"], [])

    def test_it_keeps_every_door_animation_whatever_the_per_type_file_says(self):
        converter = self.converter({"type": {"doors": []}})
        derived = self.derived(converter, "test_coach")
        self.assertIn("doora", derived["model"]["animations"])
        self.assertNotIn("doors", derived["type"])
        with contextlib.redirect_stdout(io.StringIO()):
            converter.convert()
        model = json.loads(converter.generated["assets/tp/wagon_models/test_coach.json"])
        self.assertNotIn("animations", model)  # the conversion keeps only the type's doors' animations

    def test_an_unknown_type_is_a_value_error(self):
        with self.assertRaisesRegex(ValueError, "no stock type 'nope'"):
            self.derived(self.converter(), "nope")


if __name__ == "__main__":
    unittest.main()
