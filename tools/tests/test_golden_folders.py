"""The meta-test of the golden data and the Python runners (editor.md 4.4, item 4;
fixtures/golden/README.md): every file of fixtures/golden/ follows its schema
(fixtures/golden/schema.json, read by validate_pack's validator: a case file, or a
folder's ports.json by its $defs/ports), the ids of a folder are its own, the files
keep their size, and every folder that names Python is read by its runner,
tools/tests/test_golden_<folder>.py. The Java suite checks its runners the same way
(GoldenFoldersTest). And the update of a folder Python is the reference of rewrites
nothing but the expected (GoldenUpdateTest, as GoldenUpdateTest.java)."""

import contextlib
import importlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import golden  # noqa: E402
import validate_pack  # noqa: E402

SCHEMA = golden.GOLDEN / "schema.json"
MAX_FILE = 200 * 1024
MAX_TOTAL = 3 * 1024 * 1024


class GoldenStore(validate_pack.SchemaStore):
    """validate_pack's schema store holding the golden format's one schema."""

    def __init__(self):
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        self.folder = golden.GOLDEN
        self.by_id = {schema["$id"]: schema}
        self.by_name = {"golden.schema.json": schema["$id"]}


class GoldenFormatTest(unittest.TestCase):

    def setUp(self):
        self.validator = validate_pack.Validator(GoldenStore())
        self.schema_id = json.loads(SCHEMA.read_text(encoding="utf-8"))["$id"]

    def issues(self, document, pointer=""):
        uri, schema = self.validator.store.resolve(self.schema_id, "#" + pointer)
        return [str(i) for i in self.validator.check(document, schema, uri, "$")]

    def test_every_file_follows_the_schema(self):
        for folder in golden.folders():
            with self.subTest(folder):
                self.assertEqual(self.issues(golden.ports(folder), "/$defs/ports"), [], f"{folder}/ports.json")
                files = golden.case_files(folder)
                self.assertTrue(files, f"{folder} has no case file")
                for path in files:
                    self.assertEqual(self.issues(golden.load(path)), [], f"{folder}/{path.name}")

    def test_only_case_files_ports_and_the_readme(self):
        stray = [p.relative_to(golden.GOLDEN).as_posix() for p in golden.GOLDEN.rglob("*")
                 if p.is_file() and p.parent != golden.GOLDEN and p.suffix != ".json"]
        top = sorted(p.name for p in golden.GOLDEN.iterdir() if p.is_file())
        self.assertEqual(stray, [])
        self.assertEqual(top, ["README.md", "schema.json"])

    def test_the_ids_of_a_folder_are_its_own(self):
        for folder in golden.folders():
            ids = [case["id"] for _, _, case, _ in golden.cases(folder)]
            self.assertEqual(sorted(i for i in set(ids) if ids.count(i) > 1), [], folder)
            self.assertGreaterEqual(len(ids), 10, f"{folder}: {len(ids)} cases")

    def test_input_and_input_file(self):
        for folder in golden.folders():
            for path in golden.case_files(folder):
                for case in golden.load(path)["cases"]:
                    if isinstance(case.get("input_file"), str):
                        self.assertNotIn("input", case, f"{folder}/{path.name} {case['id']}")
                    if isinstance(case.get("input_file"), dict):
                        self.assertFalse(set(case["input_file"]) & set(case.get("input", {})),
                                         f"{folder}/{path.name} {case['id']}")
                    golden.resolve_input(case)  # every file is there and of the example pack

    def test_sizes(self):
        total = 0
        for path in golden.GOLDEN.rglob("*"):
            if path.is_file():
                size = path.stat().st_size
                total += size
                self.assertLessEqual(size, MAX_FILE, path.relative_to(golden.ROOT).as_posix())
        self.assertLessEqual(total, MAX_TOTAL)

    def test_every_folder_naming_python_has_its_runner(self):
        named = [f for f in golden.folders() if golden.reads(f, "python")]
        self.assertTrue(named)
        for folder in named:
            with self.subTest(folder):
                module = importlib.import_module(f"test_golden_{folder}")
                runners = [v for v in vars(module).values() if isinstance(v, type)
                           and issubclass(v, (golden.PortTest, golden.ReferenceTest)) and v.FOLDER == folder]
                self.assertTrue(runners, f"test_golden_{folder}.py has no runner of {folder}")

    def test_every_runner_reads_a_folder_naming_python(self):
        for path in sorted(Path(__file__).resolve().parent.glob("test_golden_*.py")):
            folder = path.stem[len("test_golden_"):]
            if folder == "folders":
                continue
            with self.subTest(folder):
                self.assertTrue((golden.GOLDEN / folder).is_dir(), f"{path.name}: no folder {folder}")
                self.assertTrue(golden.reads(folder, "python"), f"{folder}/ports.json doesn't name python")

    def test_close(self):
        self.assertTrue(golden.close(float("nan"), "NaN", 0))
        self.assertTrue(golden.close(float("-inf"), "-Infinity", 0))
        self.assertFalse(golden.close(None, "NaN", 0))
        self.assertFalse(golden.close(float("nan"), None, 0))
        self.assertTrue(golden.close([1.0 + 1e-10, {"a": True}], [1, {"a": True}], 1e-9))
        self.assertFalse(golden.close([1.0 + 1e-8], [1], 1e-9))
        self.assertFalse(golden.close(1, True, 0))
        self.assertFalse(golden.close({"b": 1, "a": 2}, {"a": 2, "b": 1}, 0))


class GoldenUpdateTest(unittest.TestCase):
    """The update of a folder Python is the reference of (--update, golden.update) rewrites
    the expected of the cases and nothing else of a case file, as the Java one does
    (GoldenUpdateTest.java): an input keeps its numbers as written (2.5e1, 1E1, -0.0), its
    escapes and its line breaks, a case whose logic fails keeps its expected, and a file the
    code agrees with is not touched. It used to lay the whole file out anew, from its value:
    2.5e1 came back 25.0."""

    # a file not as the writer would lay it: numbers in exponent form, an escape, an input over two lines
    FILE = """{
  "description": "numbers as a pack writes them \\u2014 and a case to fill in",
  "frame": "none",
  "tolerance": 0,
  "cases": [
    {
      "id": "exponents",
      "note": "2.5e1 and 1E1 are numbers",
      "input": {"type": {"length": 2.5e1, "bogies": [1E1, -1E1],
                "mass_t": 100.0}},
      "expected": [1, 2]
    },
    {
      "id": "a-new-case",
      "note": "written with expected null",
      "input": {"length": -0.0, "bogies": []},
      "expected": null
    },
    {
      "id": "fails",
      "note": "the logic throws: the expected stays",
      "input": {"fail": true},
      "expected": {"kept":   true}
    }
  ]
}
"""
    AGREED = FILE.replace('"expected": [1, 2]', '"expected": {"length": 25.0, "bogies": [10.0, -10.0]}') \
        .replace('"expected": null', '"expected": {"length": -0.0, "bogies": []}')

    @staticmethod
    def logic(given):
        """The reference's stand-in: the length and the bogies it reads, or a failure."""
        if "fail" in given:
            raise ValueError("no logic for this case")
        t = given.get("type", given)
        return {"length": float(t["length"]), "bogies": [float(b) for b in t["bogies"]]}

    def folder(self, root, text):
        folder = Path(root) / "numbers"
        folder.mkdir()
        (folder / "ports.json").write_text('{"reference": "python", "ports": ["ts"]}\n', encoding="utf-8")
        path = folder / "cases.json"
        path.write_text(text, encoding="utf-8")
        return path

    def run_update(self, root):
        with self.assertRaises(SystemExit) as failed, contextlib.redirect_stdout(io.StringIO()):
            golden.update("numbers", self.logic, Path(root))
        self.assertIn("numbers/cases.json fails", str(failed.exception))

    def test_the_update_rewrites_only_the_expected(self):
        with tempfile.TemporaryDirectory() as root:
            path = self.folder(root, self.FILE)
            self.run_update(root)
            self.assertEqual(path.read_text(encoding="utf-8"), self.AGREED)

    def test_a_file_the_code_agrees_with_stays_as_it_is(self):
        with tempfile.TemporaryDirectory() as root:
            path = self.folder(root, self.AGREED)
            before = path.stat().st_mtime_ns
            self.run_update(root)
            self.assertEqual(path.read_text(encoding="utf-8"), self.AGREED)
            self.assertEqual(path.stat().st_mtime_ns, before)

    def test_a_long_expected_is_laid_out_at_the_indent_of_its_key(self):
        text = '{"cases": [\n    {"id": "a",\n      "expected": 0}\n]}\n'
        value = ["x" * 60, "y" * 60]
        self.assertEqual(golden.with_expected(text, [value]),
                         '{"cases": [\n    {"id": "a",\n      "expected": [\n        "' + "x" * 60
                         + '",\n        "' + "y" * 60 + '"\n      ]}\n]}\n')

    def test_keys_and_strings_are_read_with_their_escapes(self):
        text = '{"no\\u0074e": "a \\"cases\\": [] \\\\", "cases": [{"expected": 1, "x": {"expected": 2}}]}'
        self.assertEqual(golden.with_expected(text, [3]), text.replace('"expected": 1', '"expected": 3'))

    def test_the_cases_of_the_text_are_the_cases_given(self):
        text = '{"cases": [{"expected": 1}, {"expected": 2}]}'
        with self.assertRaises(ValueError):
            golden.with_expected(text, [1])
        with self.assertRaises(ValueError):
            golden.with_expected(text + " x", [golden.KEEP, golden.KEEP])
        self.assertEqual(golden.with_expected(text, [golden.KEEP, None]), '{"cases": [{"expected": 1}, {"expected": null}]}')


if __name__ == "__main__":
    unittest.main()
