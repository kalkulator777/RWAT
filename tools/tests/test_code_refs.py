"""The code references of the schemas (obj-conventions.json "code", pack-layout.json
"code", the file schemas' "x-code") and the pack-format.md links made of them point at
symbols, not lines: a line number moved with every edit of the file it pointed into,
and nothing noticed. validate_pack.py --self-check finds every symbol in its file."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import irpack

sys.path.insert(0, str(irpack.TOOLS))
import gen_pack_docs  # noqa: E402
import validate_pack  # noqa: E402


def problems(store):
    found = []
    validate_pack.check_code_references(store, lambda where, message: found.append(f"{where}: {message}"))
    return found


class CodeReferenceTest(unittest.TestCase):

    def test_every_reference_of_the_schemas_is_found(self):
        self.assertEqual(problems(validate_pack.SchemaStore()), [])

    def test_a_reference_names_a_declared_symbol(self):
        java = "public final class A {\n" \
               "    private static final Pattern COPY_SUFFIX = Pattern.compile(\"x\");\n" \
               "    public enum Kind {\n        GAUGE_SPEED(\"G\", true),\n        DOOR(\"D\", false);\n    }\n" \
               "    public static ObjectRole door(String name) {\n        return parse(name);\n    }\n" \
               "    private static <T> List<T> each(List<T> all) {\n        send(all);\n    }\n}\n"
        for name in ("A", "COPY_SUFFIX", "Kind", "GAUGE_SPEED", "DOOR", "door", "each"):
            self.assertTrue(validate_pack.declares(java, name, False), name)
        for name in ("parse", "send", "Pattern", "name", "B"):  # called or used, never declared
            self.assertFalse(validate_pack.declares(java, name, False), name)
        python = "FLAG_WORDS = {1}\n\n\ndef derive_doors(boxes):\n    return control_group(boxes)\n\n\n" \
                 "class Door:\n    def bridge(self):\n        pass\n"
        for name in ("FLAG_WORDS", "derive_doors", "Door", "bridge"):
            self.assertTrue(validate_pack.declares(python, name, True), name)
        self.assertFalse(validate_pack.declares(python, "control_group", True))

    def test_a_line_a_missing_symbol_or_file_is_a_problem(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "schema"
            shutil.copytree(validate_pack.SCHEMA_DIR, folder)
            path = folder / "obj-conventions.json"
            conventions = json.loads(path.read_text(encoding="utf-8"))
            conventions["naming"]["token"]["code"] = [
                "convention/ObjectRole.java:268",           # a line
                "convention/ObjectRole.java#noSuchMethod",  # a symbol the file doesn't declare
                "convention/NoSuchFile.java",               # a file that isn't there
                "convention/ObjectRole.java#Kind.NO_KIND",  # a nested symbol, its inner part missing
            ]
            path.write_text(json.dumps(conventions), encoding="utf-8")
            found = problems(validate_pack.SchemaStore(folder))
        self.assertEqual(len(found), 4, found)
        self.assertIn("points at a line", found[0])
        self.assertIn("declares no noSuchMethod", found[1])
        self.assertIn("no file convention/NoSuchFile.java", found[2])
        self.assertIn("declares no NO_KIND", found[3])

    def test_the_docs_link_a_symbol_to_its_file(self):
        self.assertEqual(gen_pack_docs.code_link("convention/ObjectRole.java#COPY_SUFFIX"),
                         "[ObjectRole.java#COPY_SUFFIX](../src/main/java/com/muzhik17/trainsmod/convention/ObjectRole.java)")
        self.assertEqual(gen_pack_docs.code_link("tools/ir2rwat.py#derive_doors"),
                         "[ir2rwat.py#derive_doors](../tools/ir2rwat.py)")
        self.assertEqual(gen_pack_docs.code_link("client/LightNames.java:24"),
                         "[LightNames.java:24](../src/main/java/com/muzhik17/trainsmod/client/LightNames.java#L24)")


if __name__ == "__main__":
    unittest.main()
