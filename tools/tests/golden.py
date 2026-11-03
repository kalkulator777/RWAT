"""The shared part of the Python golden runners (fixtures/golden/README.md).

fixtures/golden/<folder>/ holds one piece of logic the ports repeat: ports.json
names its reference and its ports, every other *.json is a file of cases
{id, note, input | input_file, expected}. A runner, tools/tests/test_golden_<folder>.py,
names its FOLDER and checks what it ports.

Where Python is a port, its runner compares with the file's tolerance: numbers
within it, "NaN"/"Infinity"/"-Infinity" against those values, the rest exactly.
Where Python is the reference (json_dump, validate), its runner compares exactly,
and run as a script with --update rewrites the expected of every case from the
code now, and nothing else of the file (with_expected, as Golden.withExpected):

    python -I tools/tests/test_golden_json_dump.py --update

An expected is laid out as the Java runners lay theirs (Golden.java): two-space
indents from its key, an array or object on one line while it fits in 110
columns, the file, its cases and each case a key a line."""

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

# an expected the update leaves as it is (the case's logic failed): None is JSON's null
KEEP = object()


def update(folder, compute, root=GOLDEN):
    """Rewrites the expected of every case of a folder Python is the reference of, and
    nothing else of its files (with_expected); a case whose logic fails keeps its own, and
    the update ends with an error naming it. A file the code agrees with is not written.
    root: where the folders are (the tests' own, in a temporary one)."""
    reference = json.loads((root / folder / "ports.json").read_text(encoding="utf-8"))["reference"]
    if reference != "python":
        raise SystemExit(f"{folder}: Python is no reference of it, its expected are written by {reference}")
    failed = []
    for path in sorted(p for p in (root / folder).glob("*.json") if p.name != "ports.json"):
        name = f"{folder}/{path.name}"
        text = path.read_text(encoding="utf-8")
        written = []
        for case in json.loads(text)["cases"]:
            try:
                written.append(compute(resolve_input(case)))
            except Exception as e:  # noqa: BLE001 (any failure of the logic keeps the case's expected)
                failed.append(f"{name} {case['id']}: {e!r}")
                written.append(KEEP)
        updated = with_expected(text, written)
        if updated != text:
            path.write_text(updated, encoding="utf-8")
            print(f"{name}: rewritten")
    if failed:
        raise SystemExit("the logic failed, the expected kept:\n  " + "\n  ".join(failed))


def with_expected(text, expected):
    """The text of a case file with the expected of each case replaced by expected (one per
    case, in order; KEEP keeps the case's own), laid out as write lays a value, indented as
    its key; everything else in the text stays as it was, character for character — an
    input's numbers as written (2.5e1), its escapes, its line breaks (Golden.withExpected)."""
    spans = _Spans(text).expected_of_cases()
    if len(spans) != len(expected):
        raise ValueError(f"{len(spans)} cases with an expected in the text, {len(expected)} given")
    out = text
    for (start, end, column), value in reversed(list(zip(spans, expected))):
        if value is not KEEP:
            out = out[:start] + write(value, column) + out[end:]
    return out


class _Spans:
    """Where the expected of each case lies in the text of a case file: (start, end, column
    of the key) per case, in order. A reader of JSON that keeps places, not values."""

    def __init__(self, text):
        self.text = text
        self.at = 0

    def expected_of_cases(self):
        spans = []

        def case_member(key, key_start):
            if key != "expected":
                self.value()
                return
            start = self.at
            self.value()
            spans.append((start, self.at, key_start - (self.text.rfind("\n", 0, key_start) + 1)))

        def member(key, _):
            if key == "cases":
                self.elements(lambda: self.members(case_member))
            else:
                self.value()

        self.members(member)
        self.blank()
        if self.at != len(self.text):
            raise self.error("text after the file's object")
        return spans

    def members(self, member):
        """An object at the place: each member's key to member(key, key_start), which reads its value."""
        self.blank()
        self.expect("{")
        self.blank()
        if self.peek() == "}":
            self.at += 1
            return
        while True:
            self.blank()
            key_start = self.at
            key = json.loads(self.text[key_start:self.skip_string()])
            self.blank()
            self.expect(":")
            self.blank()
            member(key, key_start)
            self.blank()
            if self.peek() == ",":
                self.at += 1
                continue
            self.expect("}")
            return

    def elements(self, element):
        """An array at the place: element() reads each element."""
        self.blank()
        self.expect("[")
        self.blank()
        if self.peek() == "]":
            self.at += 1
            return
        while True:
            self.blank()
            element()
            self.blank()
            if self.peek() == ",":
                self.at += 1
                continue
            self.expect("]")
            return

    def value(self):
        """Past any value at the place."""
        self.blank()
        c = self.peek()
        if c == "{":
            self.members(lambda key, key_start: self.value())
        elif c == "[":
            self.elements(self.value)
        elif c == '"':
            self.skip_string()
        else:
            start = self.at
            while self.at < len(self.text) and self.text[self.at] not in '{}[],: \t\r\n"':
                self.at += 1
            if self.at == start:
                raise self.error("no value")

    def skip_string(self):
        """Past the string at the place; its end."""
        self.expect('"')
        while self.at < len(self.text) and self.text[self.at] != '"':
            self.at += 2 if self.text[self.at] == "\\" else 1
        self.expect('"')
        return self.at

    def blank(self):
        while self.at < len(self.text) and self.text[self.at] in " \t\r\n":
            self.at += 1

    def peek(self):
        if self.at >= len(self.text):
            raise self.error("the text ends")
        return self.text[self.at]

    def expect(self, c):
        if self.peek() != c:
            raise self.error(f"'{c}' expected")
        self.at += 1

    def error(self, what):
        return ValueError(f"case file, at {self.at}: {what}")


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
