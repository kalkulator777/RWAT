"""The example pack (roadmap R11): the committed run/rwat_packs/RwatExamplePack
is exactly what tools/gen_example_pack.py writes, byte for byte and on every
run; it passes validate_pack without an error or a warning; and it uses every
key the format's declarations have, but the reserved and deprecated ones —
so a key added to the schema is shown in the example too (CLAUDE.md, "Формат
паков"). Its OBJ names and its loading in the mod are ExamplePackLoadTest's."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urldefrag, urljoin

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

import gen_example_pack  # noqa: E402
import validate_pack  # noqa: E402

PACK = gen_example_pack.DEFAULT_OUT
REGENERATE = "regenerate the pack: python -I tools/gen_example_pack.py"


def tree(folder):
    """{path relative to folder: bytes} of every file under it."""
    return {p.relative_to(folder).as_posix(): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}


class GeneratedTest(unittest.TestCase):

    def test_the_committed_pack_is_what_the_generator_writes(self):
        built = gen_example_pack.build()
        committed = tree(PACK)
        self.assertEqual(sorted(committed), sorted(built), REGENERATE)
        self.assertEqual([path for path in built if built[path] != committed[path]], [], REGENERATE)

    def test_two_runs_write_the_same_bytes(self):
        # separate processes: under -I each gets its own string hash seed, so nothing may hang on set order
        with tempfile.TemporaryDirectory() as temp:
            runs = []
            for run in ("a", "b"):
                out = Path(temp) / run / gen_example_pack.PACK_DIR
                subprocess.run([sys.executable, "-I", str(TOOLS / "gen_example_pack.py"), "--out", str(out)],
                               check=True, capture_output=True)
                runs.append(tree(out))
        self.assertEqual(sorted(runs[0]), sorted(runs[1]))
        self.assertEqual([path for path in runs[0] if runs[0][path] != runs[1][path]], [])
        self.assertEqual(runs[0], gen_example_pack.build())

    def test_it_replaces_only_a_folder_it_wrote(self):
        with tempfile.TemporaryDirectory() as temp:
            foreign = Path(temp) / "SomePack"
            foreign.mkdir()
            (foreign / "pack.mcmeta").write_text('{"pack": {}, "rwat": {"format": 1, "name": "Other"}}')
            with self.assertRaises(SystemExit):
                gen_example_pack.main(["--out", str(foreign)])
            self.assertEqual(sorted(p.name for p in foreign.iterdir()), ["pack.mcmeta"])


class FormatTest(unittest.TestCase):

    def test_the_pack_passes_validate_pack_without_an_error_or_a_warning(self):
        report = validate_pack.Report()
        validate_pack.validate_pack(validate_pack.Validator(validate_pack.SchemaStore()), PACK, report)
        issues = [f"{label}: {issue}" for label, found in report.files.items() for issue in found]
        self.assertEqual(issues, [])
        self.assertEqual(report.counts(), (8, 0, 0))  # pack.mcmeta, 3 types, 3 models, 1 rail style

    def test_the_pack_uses_every_key_of_the_format_but_the_reserved_and_deprecated(self):
        store = validate_pack.SchemaStore()
        validator = validate_pack.Validator(store)
        declared, exempt, used = set(), set(), set()
        files = tree(PACK)
        for kind in ("wagon_type", "wagon_model", "rail_model", "pack_mcmeta_rwat"):
            uri, schema = store.root(kind)
            schema_keys(store, uri, "", schema, declared, exempt, set())
            for path, data in files.items():
                pattern = next(p for p, k in validate_pack.DECLARATIONS if k == kind)
                if pattern.match(path):
                    value, problem = validate_pack.load_json(data, path)
                    self.assertIsNone(problem, path)
                    used_keys(store, validator, uri, "", schema, value, used)
        self.assertEqual(sorted(name(k) for k in declared - used), [],
                         "keys of the format the example pack doesn't show")
        # what is left out on purpose, so a new reserved or deprecated key is a conscious choice
        self.assertEqual(sorted(name(k) for k in exempt),
                         ["wagon_type.schema.json#/$defs/brakes: dynamic_fade_kmh",
                          "wagon_type.schema.json#/$defs/brakes: dynamic_kn",
                          "wagon_type.schema.json#/$defs/cab: seat",
                          "wagon_type.schema.json#/$defs/cab: seat_yaw"])


def skipped(schema):
    return schema.get("deprecated") is True or schema.get("x-status") == "reserved"


def resolve(store, uri, ref):
    """(document, JSON pointer, subschema) a $ref names."""
    target, fragment = urldefrag(urljoin(uri, ref))
    return (target, fragment) + (store.resolve(uri, ref)[1],)


def schema_keys(store, uri, pointer, schema, declared, exempt, seen):
    """Every (document, pointer of the object schema, key) reachable: the
    reserved and deprecated ones into `exempt`, the rest into `declared`."""
    if not isinstance(schema, dict) or (uri, pointer) in seen or skipped(schema):
        return
    seen.add((uri, pointer))
    if "$ref" in schema:
        target, fragment, sub = resolve(store, uri, schema["$ref"])
        schema_keys(store, target, fragment, sub, declared, exempt, seen)
    for key, sub in schema.get("properties", {}).items():
        (exempt if skipped(sub) else declared).add((uri, pointer, key))
        schema_keys(store, uri, f"{pointer}/properties/{key}", sub, declared, exempt, seen)
    for word in ("additionalProperties", "items"):
        if isinstance(schema.get(word), dict):
            schema_keys(store, uri, f"{pointer}/{word}", schema[word], declared, exempt, seen)
    for word in ("oneOf", "anyOf", "allOf"):
        for i, sub in enumerate(schema.get(word, [])):
            schema_keys(store, uri, f"{pointer}/{word}/{i}", sub, declared, exempt, seen)


def used_keys(store, validator, uri, pointer, schema, value, used):
    """The same triples for the keys a declaration writes, walking it with its schema."""
    if not isinstance(schema, dict):
        return
    if "$ref" in schema:
        target, fragment, sub = resolve(store, uri, schema["$ref"])
        used_keys(store, validator, target, fragment, sub, value, used)
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        for key, item in value.items():
            if key in properties:
                used.add((uri, pointer, key))
                used_keys(store, validator, uri, f"{pointer}/properties/{key}", properties[key], item, used)
            elif isinstance(schema.get("additionalProperties"), dict):
                used_keys(store, validator, uri, f"{pointer}/additionalProperties",
                          schema["additionalProperties"], item, used)
    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        for item in value:
            used_keys(store, validator, uri, f"{pointer}/items", schema["items"], item, used)
    for word in ("oneOf", "anyOf", "allOf"):
        for i, sub in enumerate(schema.get(word, [])):
            if word == "allOf" or not validate_pack.errors(validator.check(value, sub, uri, "$")):
                used_keys(store, validator, uri, f"{pointer}/{word}/{i}", sub, value, used)


def name(key):
    uri, pointer, prop = key
    return f"{uri.rsplit('/', 1)[-1]}#{pointer}: {prop}"


if __name__ == "__main__":
    unittest.main()
