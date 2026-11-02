"""The recipe and the per-type files: typos are warned about, null survives
the layering, what can't be followed is refused with the field named."""

import json
import tempfile
import unittest
from pathlib import Path

import irpack
from irpack import ir2rwat


class RecipeTest(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name)
        irpack.write_zip(self.folder / "ir.zip", irpack.pack_files())
        self.pack = self.folder / "out" / "TestPack"

    def tearDown(self):
        self.tmp.cleanup()

    def recipe(self, **extra):
        return irpack.write_recipe(self.folder, [("ir.zip", "stock")], **extra)

    def per_type(self, name, value, folder="tp"):
        (self.folder / folder).mkdir(exist_ok=True)
        path = self.folder / folder / f"{name}.json"
        path.write_text(value if isinstance(value, str) else json.dumps(value), encoding="utf-8")
        return path

    def wagon(self, type_id):
        return json.loads((self.pack / f"data/tp/wagon_types/{type_id}.json").read_text("utf-8"))

    # ------------------------------------------------------------- T4: warnings

    def test_unknown_recipe_key_is_warned_with_the_nearest_known(self):
        status, out, err = irpack.convert(self.recipe(overides_dir="tp"))
        self.assertEqual(status, 0, out + err)
        self.assertIn("recipe.json: unknown key \"overides_dir\", ignored — did you mean \"overrides_dir\"?", out)

    def test_overrides_dir_that_isnt_a_folder_is_warned(self):
        status, out, err = irpack.convert(self.recipe(overrides_dir="nowhere"))
        self.assertEqual(status, 0, out + err)
        self.assertIn("\"overrides_dir\" 'nowhere'", out)
        self.assertIn("is not a folder: no per-type files read", out)

    def test_per_type_file_for_no_type_is_warned(self):
        self.per_type("hoper", {"name": {"ru_ru": "Хоппер"}})
        status, out, err = irpack.convert(self.recipe(overrides_dir="tp"))
        self.assertEqual(status, 0, out + err)
        self.assertIn("hoper.json: no stock type 'hoper' in the packs, not used — did you mean \"hopper\"?", out)

    def test_unknown_key_in_a_per_type_file_is_warned(self):
        self.per_type("hopper", {"flor": {}, "name": {"ru_ru": "Хоппер"}})
        status, out, err = irpack.convert(self.recipe(overrides_dir="tp"))
        self.assertEqual(status, 0, out + err)
        self.assertIn("hopper.json: unknown key \"flor\", ignored — did you mean \"floor\"?", out)
        lang = json.loads((self.pack / "assets/tp/lang/ru_ru.json").read_text("utf-8"))
        self.assertEqual(lang["wagon.tp.hopper"], "Хоппер")

    def test_exclude_and_rail_entries_for_no_id_are_warned(self):
        status, out, err = irpack.convert(self.recipe(exclude=["hoppr"], rail_exclude=["rail_b"],
                                                      rail_overrides={"rail_c": {"tile_length": 2.0}}))
        self.assertEqual(status, 0, out + err)
        self.assertIn("\"exclude\": no stock type 'hoppr' in the packs — did you mean \"hopper\"?", out)
        self.assertIn("\"rail_exclude\": no track 'rail_b' in the packs", out)
        self.assertIn("\"rail_overrides\": no track 'rail_c' in the packs, not used", out)

    def test_unknown_source_key_and_missing_root_file_are_warned(self):
        recipe = self.recipe(copy_root_files=["LICENSE.txt", "Credits.txt"])
        data = json.loads(recipe.read_text("utf-8"))
        data["sources"][0]["lable"] = "x"
        recipe.write_text(json.dumps(data), encoding="utf-8")
        status, out, err = irpack.convert(recipe)
        self.assertEqual(status, 0, out + err)
        self.assertIn("sources[0]: unknown key \"lable\", ignored — did you mean \"label\"?", out)
        self.assertIn("\"copy_root_files\": Credits.txt is not in ir.zip", out)

    def test_comment_keys_are_dropped_silently_at_any_depth(self):
        self.per_type("test_coach", {
            "_comment": "the coach of the test pack",
            "name": {"_why": "a note", "ru_ru": "Вагон"},
            "floor": {"_comment": "the defaults", "clearance": 0.1},
            "type": {"_comment": "heavier", "mass_t": 31.0,
                     "doors": {"_comment": "not a door", "door_3": {"_why": "a note", "inner": None}}},
            "model": {"_comment": "a note", "sway": 1.5},
        })
        recipe = self.recipe(overrides_dir="tp", _comment="the recipe's own note",
                             rail_overrides={"rail_a": {"_comment": "a note", "tile_length": 2.0}},
                             sound_defaults={"_comment": "none", "clack": "sounds/coach/hum.ogg"})
        data = json.loads(recipe.read_text("utf-8"))
        data["sources"][0]["_comment"] = "the only source"
        recipe.write_text(json.dumps(data), encoding="utf-8")
        status, out, err = irpack.convert(recipe)
        self.assertEqual(status, 0, out + err)
        self.assertNotIn("unknown key", out)
        self.assertNotIn("_comment", out + err)
        wagon = self.wagon("test_coach")
        self.assertEqual(wagon["mass_t"], 31.0)
        self.assertEqual({d["id"]: d.get("inner") for d in wagon["doors"]}["door_3"], None)
        written = [p.read_text("utf-8") for p in self.pack.rglob("*.json")] + [(self.pack / "pack.mcmeta").read_text()]
        self.assertFalse(any("_comment" in text or "_why" in text for text in written))
        rail = json.loads((self.pack / "assets/tp/rail_models/rail_a.json").read_text("utf-8"))
        self.assertEqual(rail["tile_length"], 2.0)

    def test_a_comment_key_is_no_language_no_id_and_no_field_of_a_listed_object(self):
        # where a key is a language, a light group or a door id, a comment would become one;
        # in an object inside a list it would be merged as a field
        self.per_type("test_coach", {
            "name": {"_c": "a note", "ru_ru": "Вагон"},
            "lights": {"_c": {"en_us": "not a group"}},
            "type": {
                "interior": [{"_c": "the saloon", "min": [-4.5, 0.9, -1.3], "max": [4.5, 3.4, 1.3]}],
                "doors": [{"_c": "a note", "id": "door_1", "min": [-1.0, 0.9, 1.35], "max": [0.0, 3.0, 1.45]}],
                "cab": {"seats": [{"_c": "the driver", "at": [-4.0, 1.4, 0.6]}]},
            },
            "model": {"animations": {"_c": "not a door"}},
        })
        status, out, err = irpack.convert(self.recipe(overrides_dir="tp"))
        self.assertEqual(status, 0, out + err)
        self.assertEqual(sorted(p.name for p in (self.pack / "assets/tp/lang").iterdir()), ["en_us.json", "ru_ru.json"])
        for lang in ("en_us", "ru_ru"):
            keys = json.loads((self.pack / f"assets/tp/lang/{lang}.json").read_text("utf-8"))
            self.assertFalse([k for k in keys if "_c" in k.split(".")], keys)
        wagon = self.wagon("test_coach")
        self.assertEqual(wagon["interior"], [{"min": [-4.5, 0.9, -1.3], "max": [4.5, 3.4, 1.3]}])
        self.assertEqual(wagon["doors"], [{"id": "door_1", "min": [-1.0, 0.9, 1.35], "max": [0.0, 3.0, 1.45]}])
        self.assertEqual(wagon["cab"], {"seats": [{"at": [-4.0, 1.4, 0.6]}]})
        model = json.loads((self.pack / "assets/tp/wagon_models/test_coach.json").read_text("utf-8"))
        self.assertNotIn("_c", model.get("animations", {}))

    def test_without_comments_reaches_into_lists(self):
        self.assertEqual(ir2rwat.without_comments({"_a": 1, "b": [{"_c": 2, "d": [{"_e": 3, "f": 4}]}, "_g"]}),
                         {"b": [{"d": [{"f": 4}]}, "_g"]})

    def test_unknown_sound_defaults_key_is_warned(self):
        status, out, err = irpack.convert(self.recipe(sound_defaults={"clak": "sounds/coach/hum.ogg"}))
        self.assertEqual(status, 0, out + err)
        self.assertIn("recipe.json: \"sound_defaults\": unknown key \"clak\", ignored — did you mean \"clack\"?", out)
        self.assertEqual(ir2rwat.SOUND_DEFAULTS_KEYS, ("clack", "wheels"))

    # ------------------------------------------------------------- null and layering

    def test_null_in_the_per_type_file_survives_the_inline_override(self):
        self.per_type("hopper", {"type": {"max_speed_kmh": None, "mass_t": 12.5}})
        recipe = self.recipe(overrides_dir="tp", overrides={"hopper": {"type": {"max_speed_kmh": 80, "mass_t": 10}}})
        irpack.convert(recipe)
        self.assertNotIn("max_speed_kmh", self.wagon("hopper"))
        self.assertEqual(self.wagon("hopper")["mass_t"], 12.5)
        # and the IR value (the coach's 100 km/h) is removed the same way
        self.per_type("test_coach", {"type": {"max_speed_kmh": None}})
        irpack.convert(self.recipe(overrides_dir="tp", overrides={"test_coach": {"type": {"max_speed_kmh": 90}}}))
        self.assertNotIn("max_speed_kmh", self.wagon("test_coach"))

    def test_door_removed_by_null_through_both_layers(self):
        self.per_type("test_coach", {"type": {"doors": {"door_3": None}}})
        recipe = self.recipe(overrides_dir="tp", overrides={"test_coach": {"type": {"doors": {"door_3": {"inner": None}}}}})
        status, out, err = irpack.convert(recipe)
        self.assertEqual(status, 0, out + err)
        self.assertEqual({d["id"] for d in self.wagon("test_coach")["doors"]}, {"door_1", "DoorA"})

    def test_layer_keeps_none_and_deep_merge_removes(self):
        layered = ir2rwat.layer({"type": {"a": 1, "b": {"c": 2}}}, {"type": {"a": None, "b": {"d": 3}}})
        self.assertEqual(layered, {"type": {"a": None, "b": {"c": 2, "d": 3}}})
        self.assertEqual(ir2rwat.deep_merge({"a": 5, "b": {"c": 1}}, layered["type"]), {"b": {"c": 2, "d": 3}})

    # ------------------------------------------------------------- refusals

    def test_unreadable_recipe_is_refused_with_its_place(self):
        path = self.folder / "recipe.json"
        path.write_text('{"namespace": "tp",\n "pack_dir": }', encoding="utf-8")
        status, out, err = irpack.convert(path)
        self.assertEqual(status, 2)
        self.assertIn("not valid JSON — Expecting value at line 2, column 14", err)

    def test_recipe_fields_are_checked(self):
        cases = [
            ({"namespace": "Bad NS"}, "\"namespace\" must be a Minecraft namespace"),
            ({"pack_dir": "../up"}, "\"pack_dir\" must be a folder name"),
            ({"sources": []}, "\"sources\" is empty"),
            ({"sources": [{"zip": "ir.zip", "root": "../x"}]}, "sources[0].root must be a folder path"),
            ({"sources": [{"zip": "ir.zip", "root": "lang"}]}, "sources[0].root must be a folder path"),
            ({"sources": [{"zip": "ir.zip", "root": "a"}, {"zip": "ir.zip", "root": "a"}]},
             "sources[1].root 'a' is sources[0]'s too"),
            ({"sources": [{"zip": "missing.zip", "root": "a"}]}, "sources[0].zip: no file"),
            ({"exclude": "hopper"}, "\"exclude\" must be a list"),
            ({"copy_root_files": ["pack.mcmeta"]}, "\"copy_root_files\" can't name 'pack.mcmeta'"),
            ({"copy_root_files": ["../LICENSE.txt"]}, "\"copy_root_files\" can't name '../LICENSE.txt'"),
            ({"overrides": {"hopper": []}}, "\"overrides\".hopper must be an object"),
        ]
        for extra, message in cases:
            with self.subTest(extra=extra):
                status, out, err = irpack.convert(self.recipe(**extra))
                self.assertEqual(status, 2, out + err)
                self.assertIn(message, err)
                self.assertNotIn("Traceback", err)

    def test_a_zip_that_isnt_one_is_refused(self):
        (self.folder / "ir.zip").write_bytes(b"not a zip")
        status, out, err = irpack.convert(self.recipe())
        self.assertEqual(status, 2)
        self.assertIn("not a readable zip", err)

    def test_broken_per_type_file_is_refused_before_anything_is_written(self):
        self.per_type("hopper", '{"name": {"ru_ru": "Хоппер"},}')
        status, out, err = irpack.convert(self.recipe(overrides_dir="tp"))
        self.assertEqual(status, 2)
        self.assertIn("hopper.json: not valid JSON", err)
        self.assertFalse(self.pack.exists())
        self.per_type("hopper", {"type": [1, 2]})
        status, out, err = irpack.convert(self.recipe(overrides_dir="tp"))
        self.assertEqual(status, 2)
        self.assertIn("hopper.json: \"type\" must be an object", err)

    def test_no_output_folder_is_refused_before_converting(self):
        recipe = self.recipe()
        data = json.loads(recipe.read_text("utf-8"))
        del data["out"]
        recipe.write_text(json.dumps(data), encoding="utf-8")
        status, out, err = irpack.convert(recipe)
        self.assertEqual(status, 2)
        self.assertIn("no \"out\" — name the output folder with --out", err)
        self.assertNotIn("Source", out)

    # ------------------------------------------------------------- the floor

    def test_invalid_floor_options_are_an_error_and_the_ir_floor_is_used(self):
        self.per_type("test_coach", {"floor": {"clearence": 0.1}})
        status, out, err = irpack.convert(self.recipe(overrides_dir="tp"))
        self.assertEqual(status, 1, out + err)
        self.assertIn("ERROR: test_coach: no generated floor — \"floor\": unknown key(s) ['clearence']", out)
        interior = self.wagon("test_coach")["interior"]
        self.assertIsInstance(interior, dict)  # IR's passenger area: one zone, in the OBJ frame
        self.assertEqual(interior["min"][0], -4.5)
        self.assertEqual(interior["max"][2], 1.3)

    def test_floor_false_keeps_the_ir_floor_without_complaint(self):
        self.per_type("test_coach", {"floor": False})
        status, out, err = irpack.convert(self.recipe(overrides_dir="tp"))
        self.assertEqual(status, 0, out + err)
        self.assertIsInstance(self.wagon("test_coach")["interior"], dict)


if __name__ == "__main__":
    unittest.main()
