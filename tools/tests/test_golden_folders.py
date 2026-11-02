"""The meta-test of the golden data and the Python runners (editor.md 4.4, item 4;
fixtures/golden/README.md): every file of fixtures/golden/ follows its schema
(fixtures/golden/schema.json, read by validate_pack's validator: a case file, or a
folder's ports.json by its $defs/ports), the ids of a folder are its own, the files
keep their size, and every folder that names Python is read by its runner,
tools/tests/test_golden_<folder>.py. The Java suite checks its runners the same way
(GoldenFoldersTest)."""

import importlib
import json
import sys
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


if __name__ == "__main__":
    unittest.main()
