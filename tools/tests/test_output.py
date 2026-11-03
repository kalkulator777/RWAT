"""ir2rwat's writing: nothing converted writes nothing, a failed run keeps the
old pack, what ir2rwat didn't write is never replaced, --geometry never
overwrites the per-type files, --zip is reproducible."""

import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import irpack
from irpack import ir2rwat


class OutputTest(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name)
        irpack.write_zip(self.folder / "ir.zip", irpack.pack_files())
        self.recipe = irpack.write_recipe(self.folder, [("ir.zip", "stock")])
        self.out = self.folder / "out"
        self.pack = self.out / "TestPack"

    def tearDown(self):
        self.tmp.cleanup()

    def leftovers(self):
        """Anything next to the pack that isn't the pack: temporary folders and zips."""
        return sorted(p.name for p in self.out.iterdir() if p.name not in ("TestPack", "TestPack.zip"))

    def snapshot(self, folder):
        return {p.relative_to(folder).as_posix(): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}

    # ------------------------------------------------------------- T1

    def test_nothing_converted_writes_nothing_and_keeps_the_old_pack(self):
        status, out, err = irpack.convert(self.recipe)
        self.assertEqual(status, 0, out + err)
        before = self.snapshot(self.pack)
        # a zip with no IR pack in it (the wrong zip, say)
        irpack.write_zip(self.folder / "ir.zip", {"readme.txt": b"hi", "assets/minecraft/textures/x.png": b"x"})
        status, out, err = irpack.convert(self.recipe)
        self.assertEqual(status, 2)
        self.assertIn("ir2rwat: error: no rolling stock in ir.zip", err)
        self.assertIn("nothing written", err)
        self.assertEqual(self.snapshot(self.pack), before)
        self.assertEqual(self.leftovers(), [])

    def test_every_type_refused_writes_nothing(self):
        recipe = irpack.write_recipe(self.folder, [("ir.zip", "stock")], exclude=["test_coach", "hopper", "loco"])
        status, out, err = irpack.convert(recipe)
        self.assertEqual(status, 2)
        self.assertIn("no rolling stock converted (3 definition(s) found", err)
        self.assertFalse(self.out.exists())

    def test_a_run_failing_halfway_keeps_the_old_pack(self):
        irpack.convert(self.recipe)
        before = self.snapshot(self.pack)
        calls = []

        def failing(path, data):
            calls.append(path)
            if len(calls) == 5:
                raise OSError(28, "No space left on device", str(path))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

        with mock.patch.object(ir2rwat, "write_file", failing):
            status, out, err = irpack.convert(self.recipe)
        self.assertEqual(status, 2)
        self.assertIn("ir2rwat: error: No space left on device", err)
        self.assertEqual(self.snapshot(self.pack), before)
        self.assertEqual(self.leftovers(), [])

    def test_a_successful_run_replaces_the_old_pack_whole(self):
        irpack.convert(self.recipe)
        (self.pack / "stale.txt").write_text("from an older run")
        status, out, err = irpack.convert(self.recipe)
        self.assertEqual(status, 0, out + err)
        self.assertFalse((self.pack / "stale.txt").exists())
        self.assertTrue((self.pack / "pack.mcmeta").is_file())
        self.assertEqual(self.leftovers(), [])

    @unittest.skipIf(os.name != "posix", "file modes are POSIX")
    def test_the_pack_gets_the_usual_permissions_not_a_temporary_files(self):
        irpack.convert(self.recipe)
        irpack.convert(self.recipe, "--zip")
        mask = os.umask(0)
        os.umask(mask)
        self.assertEqual(self.pack.stat().st_mode & 0o777, 0o777 & ~mask)
        self.assertEqual((self.out / "TestPack.zip").stat().st_mode & 0o777, 0o666 & ~mask)

    def test_a_folder_ir2rwat_didnt_write_is_never_replaced(self):
        self.pack.mkdir(parents=True)
        (self.pack / "mine.txt").write_text("hand-made")
        status, out, err = irpack.convert(self.recipe)
        self.assertEqual(status, 2)
        self.assertIn("wasn't written by ir2rwat", err)
        self.assertEqual((self.pack / "mine.txt").read_text(), "hand-made")

    # ------------------------------------------------------------- T2

    def test_geometry_never_overwrites_the_per_type_files(self):
        overrides = self.folder / "tp"
        overrides.mkdir()
        (overrides / "hopper.json").write_text('{"name": {"ru_ru": "Хоппер"}}', encoding="utf-8")
        recipe = irpack.write_recipe(self.folder, [("ir.zip", "stock")], overrides_dir="tp")
        status, out, err = irpack.convert(recipe, "--geometry", overrides)
        self.assertEqual(status, 2)
        self.assertIn("is the recipe's \"overrides_dir\"", err)
        self.assertEqual((overrides / "hopper.json").read_text(encoding="utf-8"), '{"name": {"ru_ru": "Хоппер"}}')
        self.assertFalse(self.out.exists())

    def test_geometry_never_overwrites_a_file_that_isnt_a_digest(self):
        geometry = self.folder / "geometry"
        geometry.mkdir()
        (geometry / "loco.json").write_text('{"hand": "made"}')
        status, out, err = irpack.convert(self.recipe, "--geometry", geometry)
        self.assertEqual(status, 2)
        self.assertIn("loco.json exists and isn't a geometry digest", err)
        self.assertEqual((geometry / "loco.json").read_text(), '{"hand": "made"}')
        self.assertFalse(self.out.exists())

    def test_geometry_replaces_its_own_digests(self):
        geometry = self.folder / "geometry"
        irpack.convert(self.recipe, "--geometry", geometry)
        first = self.snapshot(geometry)
        status, out, err = irpack.convert(self.recipe, "--geometry", geometry)
        self.assertEqual(status, 0, out + err)
        self.assertEqual(self.snapshot(geometry), first)
        self.assertEqual(sorted(first), ["hopper.json", "loco.json", "test_coach.json"])

    # ------------------------------------------------------------- --zip

    def test_zip_is_the_same_bytes_every_run(self):
        status, out, err = irpack.convert(self.recipe, "--zip")
        self.assertEqual(status, 0, out + err)
        target = self.out / "TestPack.zip"
        first = target.read_bytes()
        os.utime(self.folder / "ir.zip", (0, 0))
        irpack.convert(self.recipe, "--zip")
        self.assertEqual(target.read_bytes(), first)
        with zipfile.ZipFile(target) as archive:
            infos = archive.infolist()
            self.assertEqual([i.filename for i in infos], sorted(i.filename for i in infos))
            self.assertEqual({i.date_time for i in infos}, {ir2rwat.ZIP_TIME})
            self.assertIn(ir2rwat.MARKER, archive.namelist())
            self.assertEqual(json.loads(archive.read("pack.mcmeta"))["rwat"]["format"], 1)
        self.assertEqual(self.leftovers(), [])

    # ------------------------------------------------------------- pack.mcmeta and the notice

    def test_the_rwat_block_is_format_1_and_the_conversion_is_in_the_notice(self):
        status, out, err = irpack.convert(self.recipe)
        self.assertEqual(status, 0, out + err)
        mcmeta = json.loads((self.pack / "pack.mcmeta").read_text("utf-8"))
        self.assertEqual(mcmeta["rwat"], {"format": 1, "name": "Test Pack", "license": "CC0"})
        self.assertEqual(mcmeta["pack"]["supported_formats"], [34, 48])
        notice = (self.pack / ir2rwat.MARKER).read_text("utf-8")
        self.assertIn("Namespace: tp (the stock and the rail styles are tp:<id>).", notice)
        self.assertIn("RWAT pack format: 1.", notice)
        self.assertIn("  - ir.zip (ir.zip) → assets/tp/stock/", notice)

    def test_the_recipes_version_and_authors_go_to_the_rwat_block(self):
        recipe = irpack.write_recipe(self.folder, [("ir.zip", "stock")], version="1.2.0",
                                     authors=["Ann", "Bob"])
        status, out, err = irpack.convert(recipe)
        self.assertEqual(status, 0, out + err)
        self.assertEqual(json.loads((self.pack / "pack.mcmeta").read_text("utf-8"))["rwat"],
                         {"format": 1, "name": "Test Pack", "version": "1.2.0", "authors": ["Ann", "Bob"],
                          "license": "CC0"})
        for extra, message in (({"version": 1}, "\"version\" must be a string"),
                               ({"authors": "Ann"}, "\"authors\" must be a list"),
                               ({"authors": ["Ann", 2]}, "\"authors\" must list strings")):
            with self.subTest(extra=extra):
                status, out, err = irpack.convert(irpack.write_recipe(self.folder, [("ir.zip", "stock")], **extra))
                self.assertEqual(status, 2, out + err)
                self.assertIn(message, err)

    def test_zip_holds_what_the_folder_holds(self):
        irpack.convert(self.recipe)
        irpack.convert(self.recipe, "--zip")
        with zipfile.ZipFile(self.out / "TestPack.zip") as archive:
            self.assertEqual({n: archive.read(n) for n in archive.namelist()}, self.snapshot(self.pack))

    def test_a_zip_ir2rwat_didnt_write_is_never_replaced(self):
        self.out.mkdir()
        irpack.write_zip(self.out / "TestPack.zip", {"pack.mcmeta": b"{}"})
        before = (self.out / "TestPack.zip").read_bytes()
        status, out, err = irpack.convert(self.recipe, "--zip")
        self.assertEqual(status, 2)
        self.assertIn("wasn't written by ir2rwat", err)
        self.assertEqual((self.out / "TestPack.zip").read_bytes(), before)
        (self.out / "TestPack.zip").write_bytes(b"not a zip")
        status, out, err = irpack.convert(self.recipe, "--zip")
        self.assertEqual(status, 2)
        self.assertEqual((self.out / "TestPack.zip").read_bytes(), b"not a zip")


class PathSafetyTest(unittest.TestCase):

    def test_safe_relative_refuses_absolute_paths_and_climbing(self):
        for path in ("../x", "a/../../x", "a/..", "/etc/passwd", "C:/x", "c:x", "", "./", "a/b/../../.."):
            self.assertIsNone(ir2rwat.safe_relative(path), path)
        self.assertEqual(ir2rwat.safe_relative("a/./b//c"), "a/b/c")
        self.assertEqual(ir2rwat.safe_relative("a..b/c."), "a..b/c.")

    def test_nothing_unsafe_is_written(self):
        converter = ir2rwat.Converter.__new__(ir2rwat.Converter)
        converter.generated = {"../escape.txt": b"x"}
        converter.files = {}
        with self.assertRaises(ir2rwat.ConversionError):
            converter.contents()


if __name__ == "__main__":
    unittest.main()
