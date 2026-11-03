"""ir2rwat on an IR pack that isn't MVP (tools/tests/irpack.py): paths in any
letter case, files outside models/, paths Minecraft can't take, an unknown
era, broken types next to good ones."""

import json
import posixpath
import tempfile
import unittest
import zipfile
from pathlib import Path

import irpack
from irpack import ir2rwat

NS = "tp"
ROOT = "stock"


class ForeignPackTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        folder = Path(cls.tmp.name)
        files = irpack.pack_files()
        files.update(irpack.broken_files())
        files.update(irpack.zip_slip_files())
        cls.zip = irpack.write_zip(folder / "ir.zip", files)
        cls.recipe = irpack.write_recipe(folder, [("ir.zip", ROOT)])
        cls.status, cls.out, cls.err = irpack.convert(cls.recipe, "--geometry", folder / "geometry")
        cls.pack = folder / "out" / "TestPack"
        cls.source = zipfile.ZipFile(cls.zip)

    @classmethod
    def tearDownClass(cls):
        cls.source.close()
        cls.tmp.cleanup()

    def read(self, path):
        return (self.pack / path).read_bytes()

    def json(self, path):
        return json.loads(self.read(path).decode("utf-8"))

    def model(self, type_id):
        return self.json(f"assets/{NS}/wagon_models/{type_id}.json")

    def wagon(self, type_id):
        return self.json(f"data/{NS}/wagon_types/{type_id}.json")

    # ---------------------------------------------------------------- the run

    def test_broken_types_are_errors_and_the_rest_is_written(self):
        self.assertEqual(self.status, 1, self.out + self.err)
        for broken in ("bad_json", "no_model", "no_model_key", "bad_trucks", "bad_obj", "livery_twins", "clash"):
            self.assertIn(f"rolling_stock/freight/{broken}.json: skipped", self.out)
            self.assertFalse((self.pack / f"data/{NS}/wagon_types/{broken}.json").exists(), broken)
        for good in ("test_coach", "hopper", "loco"):
            self.assertTrue((self.pack / f"data/{NS}/wagon_types/{good}.json").exists(), good)
        self.assertTrue((self.pack / f"assets/{NS}/rail_models/rail_a.json").exists())
        self.assertNotIn("Traceback", self.out + self.err)

    def test_error_messages_say_what_is_wrong(self):
        self.assertIn("bad_json.json: skipped — invalid JSON", self.out)
        self.assertIn("no_model.json: skipped — model assets/immersiverailroading/models/rolling_stock/freight/"
                      "nothing/nothing.obj not in the pack", self.out)
        self.assertIn("no_model_key.json: skipped — no 'model' in it", self.out)
        self.assertIn("bad_trucks.json: skipped — AttributeError", self.out)
        self.assertIn("bad_obj.json: skipped — IndexError", self.out)

    def test_ids_that_collide_after_sanitizing_are_both_refused(self):
        self.assertIn("Twin Car.json, assets/immersiverailroading/rolling_stock/tank/twin_car.json: skipped — "
                      "they all convert to the id 'twin_car'", self.out)
        self.assertFalse((self.pack / f"data/{NS}/wagon_types/twin_car.json").exists())

    def test_liveries_that_collide_refuse_the_type(self):
        self.assertIn("livery_twins.json: skipped — liveries 'Red' and 'red' both convert to the id 'red'",
                      self.out)

    def test_two_files_on_one_path_refuse_the_type(self):
        self.assertRegex(self.out, r"clash\.json: skipped — .*A B\.png and .*a_b\.png would both be "
                                   r"assets/tp/stock/rolling_stock/freight/clash/a_b\.png")
        self.assertFalse((self.pack / f"assets/{NS}/{ROOT}/rolling_stock/freight/clash").exists())

    def test_a_refused_type_leaves_no_files_behind(self):
        # bad_obj's model was never copied, though its definition was read
        self.assertFalse((self.pack / f"assets/{NS}/{ROOT}/rolling_stock/freight/bad_obj").exists())

    def test_unknown_era_is_a_warning_and_the_engine_sound_keeps_the_mods_range(self):
        self.assertIn("test_coach: IR era 'steam' isn't one the converter knows (diesel, electric)", self.out)
        idle = self.model("test_coach")["sounds"]["idle"]
        self.assertEqual(idle, f"{ROOT}/sounds/coach/hum.ogg")  # no "pitch"/"volume": the mod's own range
        loco = self.model("loco")["sounds"]["idle"]
        self.assertEqual(loco["pitch"], ir2rwat.ENGINE_RANGES["diesel"]["pitch"])

    # ---------------------------------------------------------------- paths

    def test_every_resource_path_is_one_minecraft_takes(self):
        for path in self.pack.rglob("*"):
            if path.is_file():
                relative = path.relative_to(self.pack).as_posix()
                if relative.startswith("assets/") or relative.startswith("data/"):
                    self.assertRegex(relative, r"^[a-z0-9_.\-/]+$")

    def test_files_are_found_in_any_letter_case(self):
        # the definition names test_coach/Test Coach.obj, the zip has Test_Coach/Test Coach.obj
        obj = self.model("test_coach")["obj"]
        self.assertEqual(obj, f"{ROOT}/rolling_stock/passenger/test_coach/test_coach.obj")
        self.assertEqual(self.read(f"assets/{NS}/{obj}"),
                         self.source.read(irpack.COACH_DIR + "Test Coach.obj").replace(
                             b"mtllib Coach Mats.mtl", b"mtllib coach_mats.mtl"))

    def test_assets_outside_models_land_under_their_own_folder(self):
        self.assertEqual(self.read(f"assets/{NS}/{ROOT}/textures/coach/body.png"), b"body-png")
        self.assertEqual(self.read(f"assets/{NS}/{ROOT}/sounds/coach/hum.ogg"), b"hum-ogg")

    def resolve(self, obj, written):
        """A model file's path as the engine reads it: from the OBJ's folder (IrStockModel)."""
        return posixpath.normpath(posixpath.join(posixpath.dirname(f"assets/{NS}/{obj}"), written))

    def test_renamed_files_are_reached_through_rewritten_paths(self):
        obj = self.model("test_coach")["obj"]
        lines = self.read(f"assets/{NS}/{obj}").decode().splitlines()
        library = next(line[len("mtllib "):] for line in lines if line.startswith("mtllib "))
        mtl_path = self.resolve(obj, library)
        mtl = (self.pack / mtl_path).read_bytes()
        maps = ir2rwat.parse_mtl(mtl)
        self.assertEqual(set(maps), {"body", "glass"})
        for material, written in maps.items():
            self.assertTrue((self.pack / self.resolve(obj, written)).is_file(), (material, written))
        # only the map_Kd lines changed, line endings and all
        self.assertEqual(mtl, b"newmtl body\nmap_Kd ../../../textures/coach/body.png\n"
                              b"newmtl glass\r\nmap_Kd glass.png\r\n")

    def test_livery_folder_follows_its_renamed_files(self):
        model = self.model("test_coach")
        self.assertEqual(model["liveries"], {"red_line": "l_red"})
        folder = self.resolve(model["obj"], model["liveries"]["red_line"])
        self.assertEqual((self.pack / folder / "body.png").read_bytes(), b"red-body-png")

    def test_animation_and_widget_door_are_converted(self):
        model = self.model("test_coach")
        self.assertEqual(model["animations"], {"doora": f"{ROOT}/rolling_stock/passenger/test_coach/anim/doora.anim"})
        doors = {d["id"]: d for d in self.wagon("test_coach")["doors"]}
        self.assertTrue(doors["DoorA"]["inner"])

    def test_a_door_with_blenders_copy_suffix_is_a_door(self):
        doors = {d["id"] for d in self.wagon("test_coach")["doors"]}
        self.assertEqual(doors, {"door_1", "door_3", "DoorA"})

    def test_valid_files_are_copied_byte_for_byte(self):
        for name in ("hopper.obj", "hopper.mtl", "hopper.png", "l_green/hopper.png"):
            self.assertEqual(self.read(f"assets/{NS}/{ROOT}/rolling_stock/freight/hopper/{name}"),
                             self.source.read(irpack.HOPPER_DIR + name))
        self.assertEqual(self.model("hopper")["liveries"], {"green": "l_green"})

    def test_the_notice_lists_what_was_renamed_or_rewritten(self):
        notice = self.read(ir2rwat.MARKER).decode("utf-8")
        self.assertIn("copied\nunchanged except as listed at the end", notice)
        self.assertIn(f"Test Coach.obj → assets/{NS}/{ROOT}/rolling_stock/passenger/test_coach/test_coach.obj "
                      f"(paths in it rewritten)", notice)
        self.assertIn(f"textures/Coach/Body.png → assets/{NS}/{ROOT}/textures/coach/body.png", notice)
        self.assertNotIn("hopper", notice.split("Renamed or rewritten")[1])

    def test_strings_survive_lenient_reading_and_writing(self):
        lang = self.json(f"assets/{NS}/lang/en_us.json")
        self.assertEqual(lang[f"wagon.{NS}.hopper"], "Hopper [ 15-1443 ] car, // not a comment")

    # ---------------------------------------------------------------- zip slip

    def test_entries_outside_the_pack_are_never_read(self):
        self.assertIn("ir.zip: 3 entries with an absolute path or a \"..\" never read", self.out)
        folder = Path(self.tmp.name)
        self.assertEqual(sorted(p.name for p in folder.rglob("*evil*")), [])
        self.assertIn("climber: livery Out folder ../../../../../../../../../tmp is empty or missing", self.out)
        for path in self.pack.rglob("*"):
            self.assertTrue(path.resolve().is_relative_to(self.pack.resolve()))

    # ---------------------------------------------------------------- geometry

    def test_geometry_digests_are_written_for_converted_types(self):
        digests = sorted(p.stem for p in (Path(self.tmp.name) / "geometry").glob("*.json"))
        self.assertEqual(digests, ["climber", "hopper", "loco", "test_coach"])
        coach = json.loads((Path(self.tmp.name) / "geometry" / "test_coach.json").read_text("utf-8"))
        self.assertIn("DOOR_3.001", coach["objects"])
        self.assertEqual(coach["door_motion"]["DOOR_3"]["moves"], "none")


class WrappedPackTest(unittest.TestCase):
    """A pack zipped with its folder, a macOS __MACOSX/ beside it, the namespace folder in capitals."""

    def test_the_pack_inside_a_folder_is_read_from_there(self):
        with tempfile.TemporaryDirectory() as tmp:
            files = {name.replace("assets/immersiverailroading/", "assets/ImmersiveRailroading/"): data
                     for name, data in irpack.pack_files().items()}
            files = {"MyPack/" + name: data for name, data in files.items()}
            files["__MACOSX/MyPack/._pack.mcmeta"] = b"junk"
            files["__MACOSX/MyPack/assets/ImmersiveRailroading/rolling_stock/freight/._hopper.json"] = b"junk"
            irpack.write_zip(Path(tmp) / "ir.zip", files)
            recipe = irpack.write_recipe(tmp, [("ir.zip", ROOT)])
            status, out, err = irpack.convert(recipe)
            self.assertEqual(status, 0, out + err)
            self.assertIn("the IR pack sits in MyPack/", out)
            pack = Path(tmp) / "out" / "TestPack"
            for type_id in ("test_coach", "hopper", "loco"):
                self.assertTrue((pack / f"data/{NS}/wagon_types/{type_id}.json").is_file(), type_id)
            self.assertEqual((pack / "LICENSE.txt").read_bytes(), b"CC0\n")

    def test_two_packs_in_one_zip_are_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            files = {"A/" + n: d for n, d in irpack.pack_files().items()}
            files.update({"B/" + n: d for n, d in irpack.pack_files().items()})
            irpack.write_zip(Path(tmp) / "ir.zip", files)
            recipe = irpack.write_recipe(tmp, [("ir.zip", ROOT)])
            status, out, err = irpack.convert(recipe)
            self.assertEqual(status, 2)
            self.assertIn("several IR packs in one zip (A/, B/)", err)


if __name__ == "__main__":
    unittest.main()
