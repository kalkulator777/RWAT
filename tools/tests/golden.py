"""The shared part of the Python golden runners (fixtures/golden/README.md).

fixtures/golden/<folder>/ holds one piece of logic the ports repeat: ports.json
names its reference and its ports, every other *.json is a file of cases
{id, note, input | input_file, expected}. A runner, tools/tests/test_golden_<folder>.py,
names its FOLDER and checks what it ports.

Where Python is a port, its runner compares with the file's tolerance: numbers
within it, "NaN"/"Infinity"/"-Infinity" against those values, the rest exactly.
Where Python is the reference (json_dump, validate), its runner compares exactly,
and run as a script with --update rewrites the expected of every case from the
code now:

    python -I tools/tests/test_golden_json_dump.py --update

The files are laid out as the Java runners lay theirs (Golden.java): two-space
indents, an array or object on one line while it fits in 110 columns, the file,
its cases and each case a key a line."""

import json
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = ROOT / "fixtures" / "golden"
TOOLS = ROOT / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

# the only files a case may read by input_file: the example pack (CC0), never MVP
PACK_FILES = "run/rwat_packs/RwatExamplePack/"
NON_FINITE = {"NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf}
WIDTH = 110


def ports(folder):
    return json.loads((GOLDEN / folder / "ports.json").read_text(encoding="utf-8"))


def reads(folder, language):
    """True if `language` is the reference or a port of the folder."""
    p = ports(folder)
    return p["reference"] == language or language in p["ports"]


def folders():
    return sorted(p.name for p in GOLDEN.iterdir() if p.is_dir())


def case_files(folder):
    return sorted(p for p in (GOLDEN / folder).glob("*.json") if p.name != "ports.json")


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def pack_file(path, raw=False):
    """A file of the example pack a case reads: JSON parsed, any other its text (or bytes, raw)."""
    if not path.startswith(PACK_FILES) or ".." in path or "\\" in path:
        raise ValueError(f"{path}: a case reads only files of {PACK_FILES}")
    data = (ROOT / path).read_bytes()
    if raw:
        return data
    text = data.decode("utf-8")
    return json.loads(text) if path.endswith(".json") else text


def resolve_input(case):
    """A case's input: input, with what input_file reads (a string: the whole input; an
    object: files that go into the input under its keys)."""
    files = case.get("input_file")
    if files is None:
        return case["input"]
    if isinstance(files, str):
        return pack_file(files)
    given = dict(case.get("input", {}))
    for key, path in files.items():
        given[key] = pack_file(path)
    return given


def cases(folder):
    """(file name, document, case, input) of every case of a folder, the files by name."""
    for path in case_files(folder):
        document = load(path)
        for case in document["cases"]:
            yield path.name, document, case, resolve_input(case)


def number(value):
    """A number as the cases write it: NaN and the infinities as strings."""
    if isinstance(value, float) and not math.isfinite(value):
        return "NaN" if math.isnan(value) else ("Infinity" if value > 0 else "-Infinity")
    return value


def close(actual, expected, tol):
    """True if a value agrees with what a case expects: numbers within tol, a non-finite
    one by its name, strings, booleans and null exactly; lists and objects item by item."""
    if isinstance(expected, str) and expected in NON_FINITE:
        if isinstance(actual, float) and not math.isfinite(actual):
            return number(actual) == expected
        return actual == expected
    if expected is None or isinstance(expected, bool) or isinstance(actual, bool):
        return actual is expected
    if isinstance(expected, (int, float)):
        return isinstance(actual, (int, float)) and math.isfinite(actual) and abs(actual - expected) <= tol
    if isinstance(expected, (list, tuple)):
        return isinstance(actual, (list, tuple)) and len(actual) == len(expected) \
            and all(close(a, e, tol) for a, e in zip(actual, expected))
    if isinstance(expected, dict):
        return isinstance(actual, dict) and list(actual) == list(expected) \
            and all(close(actual[k], expected[k], tol) for k in expected)
    return actual == expected


class PortTest(unittest.TestCase):
    """A port's runner: FOLDER, and check() for each case the port reads."""

    FOLDER = None

    def check(self, compute, applies=lambda given, expected: True, tolerance=None):
        """For every case of FOLDER the port reads (applies(input, expected)), compute(input,
        expected) gives what the port makes of it and the part of expected that is to
        agree with it, within the file's tolerance."""
        count = 0
        for name, document, case, given in cases(self.FOLDER):
            if not applies(given, case["expected"]):
                continue
            count += 1
            with self.subTest(f"{name} {case['id']}"):
                actual, expected = compute(given, case["expected"])
                tol = document["tolerance"] if tolerance is None else tolerance
                self.assertTrue(close(actual, expected, tol),
                                f"{self.FOLDER}/{name} {case['id']}:\n  expected {expected}\n  but was  {actual}")
        self.assertGreater(count, 0, f"no case of {self.FOLDER} this port reads")
        return count


# ---------------------------------------------------------------- the reference

def update(folder, compute):
    """Rewrites the expected of every case of a folder Python is the reference of."""
    if ports(folder)["reference"] != "python":
        raise SystemExit(f"{folder}: Python is no reference of it, its expected are written by "
                         f"{ports(folder)['reference']}")
    for path in case_files(folder):
        document = load(path)
        for case in document["cases"]:
            case["expected"] = compute(resolve_input(case))
        path.write_text(write(document) + "\n", encoding="utf-8")
        print(f"{path.relative_to(ROOT)}: {len(document['cases'])} case(s) written")


class ReferenceTest(unittest.TestCase):
    """The runner of a folder Python is the reference of: FOLDER and compute(input)."""

    FOLDER = None

    def compute(self, given):
        raise NotImplementedError

    def test_every_case(self):
        self.assertEqual(ports(self.FOLDER)["reference"], "python")
        for name, _, case, given in cases(self.FOLDER):
            with self.subTest(f"{name} {case['id']}"):
                self.assertEqual(self.compute(given), case["expected"],
                                 f"{self.FOLDER}/{name} {case['id']} (if the change is meant: "
                                 f"python -I tools/tests/test_golden_{self.FOLDER}.py --update)")


def main(test_class):
    """A reference runner run as a script: --update rewrites, otherwise the tests run."""
    if "--update" in sys.argv[1:]:
        update(test_class.FOLDER, test_class().compute)
    else:
        unittest.main(argv=[sys.argv[0]] + [a for a in sys.argv[1:] if a != "--update"])


# ---------------------------------------------------------------- writing

def inline(value):
    """One line: ", " between items, ": " after keys."""
    if isinstance(value, list):
        return "[" + ", ".join(inline(v) for v in value) + "]"
    if isinstance(value, dict):
        return "{" + ", ".join(json.dumps(k, ensure_ascii=False) + ": " + inline(v) for k, v in value.items()) + "}"
    return json.dumps(value, ensure_ascii=False)


def always_open(value):
    if isinstance(value, dict):
        return "cases" in value or ("id" in value and "expected" in value)
    if isinstance(value, list):
        return any(always_open(v) for v in value)
    return False


def write(value, indent=0):
    flat = inline(value)
    if not isinstance(value, (list, dict)) or (indent + len(flat) <= WIDTH and not always_open(value)):
        return flat
    pad = " " * (indent + 2)
    if isinstance(value, list):
        if not value:
            return "[]"
        return "[\n" + ",\n".join(pad + write(v, indent + 2) for v in value) + "\n" + " " * indent + "]"
    if not value:
        return "{}"
    return "{\n" + ",\n".join(pad + json.dumps(k, ensure_ascii=False) + ": " + write(v, indent + 2)
                             for k, v in value.items()) + "\n" + " " * indent + "}"
