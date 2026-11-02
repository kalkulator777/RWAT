"""fixtures/golden/json_dump/ (golden.py): how the pack's JSON files are written —
ir2rwat.dump, the reference (the editor's core/json/dump.ts is its port). A case gives
the JSON as text ("json") or reads a file of the example pack ("value", by
input_file), so that a port reads the numbers as written (100.0 is no 100 to dump);
expected is the text dump writes. Rewrite the expected after a meant change:

    python -I tools/tests/test_golden_json_dump.py --update"""

import json
import sys
import unittest  # noqa: F401  (golden.main runs it)
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import golden  # noqa: E402
import ir2rwat  # noqa: E402


class JsonDumpGolden(golden.ReferenceTest):
    FOLDER = "json_dump"

    def compute(self, given):
        value = json.loads(given["json"]) if "json" in given else given["value"]
        return ir2rwat.dump(value).decode("utf-8")


if __name__ == "__main__":
    golden.main(JsonDumpGolden)
