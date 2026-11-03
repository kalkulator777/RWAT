"""fixtures/golden/validate/ (golden.py): what tools/validate_pack.py, the reference,
finds in a file by its schema (the editor checks with Ajv on the same schemas and
ports the hint of an unknown key, validate_pack.suggestion). A case is a document
and the schema it is checked against ("issues": each finding's place as a JSON
pointer, RFC 6901, its severity and its text), or a key and the known ones
("suggestion": the hint validate_pack appends). Rewrite the expected after a meant
change:

    python -I tools/tests/test_golden_validate.py --update"""

import json
import re
import sys
import unittest  # noqa: F401  (golden.main runs it)
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import golden  # noqa: E402
import validate_pack  # noqa: E402

PATH_STEP = re.compile(r'\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]')


def pointer(path):
    """validate_pack's place of an issue ("$.doors[2].min", '$["a b"]') as a JSON pointer."""
    if not path.startswith("$"):
        raise ValueError(path)
    out, at = "", 1
    while at < len(path):
        step = PATH_STEP.match(path, at)
        if step is None:
            raise ValueError(f"{path} at {at}")
        name = step.group(1) or step.group(2) or json.loads(step.group(3))
        out += "/" + name.replace("~", "~0").replace("/", "~1")
        at = step.end()
    return out


class ValidateGolden(golden.ReferenceTest):
    FOLDER = "validate"
    VALIDATOR = validate_pack.Validator(validate_pack.SchemaStore())

    def compute(self, given):
        if "key" in given:
            return validate_pack.suggestion(given["key"], given["known"])
        return [{"pointer": pointer(issue.path), "severity": issue.level, "text": issue.message}
                for issue in self.VALIDATOR.validate(given["document"], given["schema"])]


if __name__ == "__main__":
    golden.main(ValidateGolden)
