#!/usr/bin/env python3
"""validate_pack — check RWAT packs, conversion recipes and override files
against the format schemas in schema/ (roadmap R4).

A minimal validator for the subset of JSON Schema draft 2020-12 the RWAT
schemas use: type, enum, const, minimum/maximum and their exclusive forms,
minLength, pattern, minItems/maxItems, items, properties, patternProperties,
required, additionalProperties, propertyNames, dependentRequired, $ref (across the
schema files, with JSON pointers), allOf/anyOf/oneOf, not. "deprecated: true"
on a subschema that applies is a warning, not an error.

What it walks:

    a pack folder or zip   pack.mcmeta, data/*/wagon_types/**.json,
                           assets/*/wagon_models/**.json, assets/*/rail_models/**.json
    a recipe (.json with "sources")
                           the recipe, then every <overrides_dir>/*.json as an override
    --as <schema> FILE     one file against one schema (wagon_type, wagon_model,
                           rail_model, pack_mcmeta_rwat, recipe, recipe_override)

--self-check checks the schemas themselves instead: every $ref resolves, every
property is described in English and Russian, defaults and examples validate,
the override patches mirror the declarations they patch, the regexes of
schema/obj-conventions.json compile and match the Java ones, and the keys the
Java parsers and the converter know are the keys the schemas declare: an
object's "x-keys" names the constant of the code that lists its keys
("stock/WagonTypeParser.java#DOOR_KEYS", "tools/ir2rwat.py#RECIPE_KEYS"), read
from the source (the test SchemaKeysTest holds the Java side by reflection).

Usage:
    python -I tools/validate_pack.py run/rwat_packs/MatoiVanillaPack packs/mvp.json
    python -I tools/validate_pack.py --group run/rwat_packs/MatoiVanillaPack
    python -I tools/validate_pack.py --as wagon_type path/to/type.json
    python -I tools/validate_pack.py --self-check

Exit status: 0 no errors (warnings allowed), 1 errors, 2 bad usage.
Python 3.9+, standard library only.
"""

import argparse
import ast
import json
import math
import re
import sys
import zipfile
from pathlib import Path
from urllib.parse import urldefrag, urljoin

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_DIR = ROOT / "schema"
JAVA_ROOT = ROOT / "src/main/java/com/muzhik17/trainsmod"
SCHEMA_KINDS = ("wagon_type", "wagon_model", "rail_model", "pack_mcmeta_rwat", "recipe", "recipe_override")


# ------------------------------------------------------------------ schemas

class SchemaStore:
    """Every *.schema.json of a folder, by $id; resolves $ref across them."""

    def __init__(self, folder=SCHEMA_DIR):
        self.folder = Path(folder)
        self.by_id = {}
        self.by_name = {}
        for path in sorted(self.folder.glob("*.schema.json")):
            schema = json.loads(path.read_text(encoding="utf-8"))
            uri = schema.get("$id", path.name)
            self.by_id[uri] = schema
            self.by_name[path.name] = uri

    def root(self, name):
        """(uri, schema) of a schema file by its name ("wagon_type" or "wagon_type.schema.json")."""
        if not name.endswith(".schema.json"):
            name += ".schema.json"
        uri = self.by_name[name]
        return uri, self.by_id[uri]

    def resolve(self, base, ref):
        """(uri of the document, subschema) that `ref` names, seen from document `base`."""
        target, fragment = urldefrag(urljoin(base, ref))
        if target not in self.by_id:
            raise KeyError(f"$ref {ref!r} from {base}: no schema {target}")
        node = self.by_id[target]
        if fragment:
            if not fragment.startswith("/"):
                raise KeyError(f"$ref {ref!r}: only JSON pointer fragments are supported")
            for part in fragment[1:].split("/"):
                part = part.replace("~1", "/").replace("~0", "~")
                if isinstance(node, list):
                    node = node[int(part)]
                elif isinstance(node, dict) and part in node:
                    node = node[part]
                else:
                    raise KeyError(f"$ref {ref!r} from {base}: {fragment} not found")
        return target, node


# ---------------------------------------------------------------- validator

class Issue:
    def __init__(self, level, path, message):
        self.level = level      # "error" or "warning"
        self.path = path        # JSON path of the instance, "$.doors[2].min"
        self.message = message

    def __repr__(self):
        return f"{self.level}: {self.path}: {self.message}"


def json_type(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    return "object"


def is_type(value, name):
    actual = json_type(value)
    if name == "number":
        return actual in ("integer", "number")
    if name == "integer":
        return actual == "integer" or (actual == "number" and math.isfinite(value) and value == int(value))
    return actual == name


def equal(a, b):
    """JSON equality: 1 == 1.0, but True != 1."""
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(equal(a[k], b[k]) for k in a)
    return a == b


def show(value):
    text = json.dumps(value, ensure_ascii=False)
    return text if len(text) <= 60 else text[:57] + "..."


class Validator:

    def __init__(self, store):
        self.store = store

    def validate(self, instance, name):
        """Issues of `instance` against schema file `name` ("wagon_type")."""
        uri, schema = self.store.root(name)
        return self.check(instance, schema, uri, "$")

    def check(self, value, schema, base, path):
        if schema is True or schema == {}:
            return []
        if schema is False:
            return [Issue("error", path, "no value is allowed here")]
        issues = []
        if "$ref" in schema:
            target, sub = self.store.resolve(base, schema["$ref"])
            issues += self.check(value, sub, target, path)
        if schema.get("deprecated") is True:
            issues.append(Issue("warning", path, "deprecated form: " + first_line(schema.get("description", ""))))
        if schema.get("x-status") == "reserved":
            issues.append(Issue("warning", path, "reserved: " + schema.get("x-status-note", "parsed, not modelled")))

        if "type" in schema:
            names = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
            if not any(is_type(value, n) for n in names):
                got = "null" if value is None else f"{json_type(value)} {show(value)}"
                issues.append(Issue("error", path, f"expected {' or '.join(names)}, got {got}"))
                return issues
        if "enum" in schema and not any(equal(value, e) for e in schema["enum"]):
            issues.append(Issue("error", path, f"{show(value)} is not one of {show(schema['enum'])}"))
        if "const" in schema and not equal(value, schema["const"]):
            issues.append(Issue("error", path, f"{show(value)} must be {show(schema['const'])}"))

        if json_type(value) in ("integer", "number"):
            issues += self.number(value, schema, path)
        elif isinstance(value, str):
            issues += self.string(value, schema, path)
        elif isinstance(value, list):
            issues += self.array(value, schema, base, path)
        elif isinstance(value, dict):
            issues += self.object(value, schema, base, path)

        for sub in schema.get("allOf", []):
            issues += self.check(value, sub, base, path)
        if "anyOf" in schema:
            issues += self.alternatives(value, schema["anyOf"], base, path, exactly_one=False)
        if "oneOf" in schema:
            issues += self.alternatives(value, schema["oneOf"], base, path, exactly_one=True)
        if "not" in schema:
            if not errors(self.check(value, schema["not"], base, path)):
                issues.append(Issue("error", path, "matches a form that is not allowed: " + describe_not(schema["not"])))
        return issues

    @staticmethod
    def number(value, schema, path):
        issues = []
        if "minimum" in schema and value < schema["minimum"]:
            issues.append(Issue("error", path, f"{value} is below the minimum {schema['minimum']}"))
        if "maximum" in schema and value > schema["maximum"]:
            issues.append(Issue("error", path, f"{value} is above the maximum {schema['maximum']}"))
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            issues.append(Issue("error", path, f"{value} must be greater than {schema['exclusiveMinimum']}"))
        if "exclusiveMaximum" in schema and value >= schema["exclusiveMaximum"]:
            issues.append(Issue("error", path, f"{value} must be less than {schema['exclusiveMaximum']}"))
        return issues

    @staticmethod
    def string(value, schema, path):
        issues = []
        if "minLength" in schema and len(value) < schema["minLength"]:
            issues.append(Issue("error", path, f"{show(value)} is shorter than {schema['minLength']}"))
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            issues.append(Issue("error", path, f"{show(value)} is longer than {schema['maxLength']}"))
        if "pattern" in schema and not re.search(schema["pattern"], value):
            issues.append(Issue("error", path, f"{show(value)} doesn't match {schema['pattern']}"))
        return issues

    def array(self, value, schema, base, path):
        issues = []
        if "minItems" in schema and len(value) < schema["minItems"]:
            issues.append(Issue("error", path, f"{len(value)} item(s), at least {schema['minItems']} needed"))
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            issues.append(Issue("error", path, f"{len(value)} item(s), at most {schema['maxItems']} allowed"))
        if "items" in schema:
            for i, item in enumerate(value):
                issues += self.check(item, schema["items"], base, f"{path}[{i}]")
        return issues

    def object(self, value, schema, base, path):
        issues = []
        properties = schema.get("properties", {})
        patterns = schema.get("patternProperties", {})
        for key in schema.get("required", []):
            if key not in value:
                issues.append(Issue("error", path, f"missing required key {key!r}"))
        for key, wanted in schema.get("dependentRequired", {}).items():
            if key in value:
                for other in wanted:
                    if other not in value:
                        issues.append(Issue("error", path, f"{key!r} needs {other!r}"))
        for key, item in value.items():
            where = f"{path}.{key}" if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key) else f"{path}[{json.dumps(key)}]"
            if "propertyNames" in schema:
                for issue in self.check(key, schema["propertyNames"], base, where):
                    issue.message = "key " + issue.message
                    issues.append(issue)
            matched = [sub for pattern, sub in patterns.items() if re.search(pattern, key)]
            for sub in matched:
                issues += self.check(item, sub, base, where)
            if key in properties:
                issues += self.check(item, properties[key], base, where)
            elif not matched and "additionalProperties" in schema:
                extra = schema["additionalProperties"]
                if extra is False:
                    issues.append(Issue("error", where, f"unknown key {key!r}" + suggestion(key, properties)))
                else:
                    issues += self.check(item, extra, base, where)
        return issues

    def alternatives(self, value, branches, base, path, exactly_one):
        results = [self.check(value, branch, base, path) for branch in branches]
        passing = [r for r in results if not errors(r)]
        if exactly_one and len(passing) > 1:
            return [Issue("error", path, f"matches {len(passing)} of the oneOf forms, exactly one is allowed")]
        if passing:
            return passing[0]  # the warnings of the form that matched
        # none matched: the forms of the right JSON type say best what is wrong
        typed = [r for r, branch in zip(results, branches) if self.type_fits(value, branch, base)]
        if len(typed) == 1:
            return typed[0]
        best = min(typed or results, key=lambda r: len(errors(r)))
        names = ", ".join(self.form_name(b, base) for b in branches)
        return [Issue("error", path, f"matches none of the allowed forms ({names})")] + errors(best)

    def type_fits(self, value, schema, base):
        while "$ref" in schema and "type" not in schema:
            base, schema = self.store.resolve(base, schema["$ref"])
        if "const" in schema:
            return equal(value, schema["const"]) or json_type(value) == json_type(schema["const"])
        if "type" not in schema:
            return True
        names = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        return any(is_type(value, n) for n in names)

    def form_name(self, schema, base):
        while "$ref" in schema and "type" not in schema and "oneOf" not in schema and "anyOf" not in schema:
            base, schema = self.store.resolve(base, schema["$ref"])
        if "const" in schema:
            return json.dumps(schema["const"])
        kind = schema.get("type")
        if isinstance(kind, list):
            return " or ".join(kind)
        if kind is None and "pattern" in schema:
            return f"a match of {schema['pattern']}"
        return kind or "a composite form"


def errors(issues):
    return [i for i in issues if i.level == "error"]


def first_line(text):
    return text.split(". ")[0].rstrip(".") if text else "see the schema"


def describe_not(schema):
    if "required" in schema:
        return "all of " + ", ".join(repr(k) for k in schema["required"]) + " together"
    if "enum" in schema:
        return " or ".join(show(e) for e in schema["enum"])
    if "pattern" in schema:
        return f"a match of {schema['pattern']}"
    if "anyOf" in schema:
        return " or ".join(describe_not(s) for s in schema["anyOf"])
    return show(schema)


def suggestion(key, properties):
    """' (did you mean 'x'?)' for the closest known key, else ''."""
    best, score = None, 0.0
    for known in properties:
        s = similarity(key.lower(), known.lower())
        if s > score:
            best, score = known, s
    return f" (did you mean {best!r}?)" if best is not None and score >= 0.6 else ""


def similarity(a, b):
    """1 − edit distance / longer length."""
    if a == b:
        return 1.0
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return 1.0 - previous[-1] / max(len(a), len(b))


# ---------------------------------------------------------------- inputs

class PackFiles:
    """The files of a pack folder or zip: (relative path, bytes)."""

    def __init__(self, path):
        self.path = Path(path)
        if self.path.is_dir():
            self.names = sorted(p.relative_to(self.path).as_posix() for p in self.path.rglob("*") if p.is_file())
            self.zip = None
        else:
            self.zip = zipfile.ZipFile(self.path)
            self.names = sorted(n for n in self.zip.namelist() if not n.endswith("/"))

    def read(self, name):
        if self.zip is not None:
            return self.zip.read(name)
        return (self.path / name).read_bytes()


DECLARATIONS = [
    (re.compile(r"^data/[^/]+/wagon_types/.+\.json$"), "wagon_type"),
    (re.compile(r"^assets/[^/]+/wagon_models/.+\.json$"), "wagon_model"),
    (re.compile(r"^assets/[^/]+/rail_models/.+\.json$"), "rail_model"),
    (re.compile(r"^pack\.mcmeta$"), "pack_mcmeta_rwat"),
]


def load_json(raw, label):
    try:
        return json.loads(raw.decode("utf-8-sig") if isinstance(raw, bytes) else raw), None
    except (ValueError, UnicodeDecodeError) as problem:
        return None, Issue("error", "$", f"not valid JSON: {problem}")


class Report:
    def __init__(self):
        self.files = {}  # label → [Issue]
        self.kinds = {}  # label → schema kind

    def add(self, label, kind, issues):
        self.files[label] = issues
        self.kinds[label] = kind

    def counts(self):
        all_issues = [i for issues in self.files.values() for i in issues]
        return len(self.files), len(errors(all_issues)), len(all_issues) - len(errors(all_issues))

    def print(self, grouped, quiet):
        if grouped:
            groups = {}
            for label, issues in self.files.items():
                for issue in issues:
                    if quiet and issue.level != "error":
                        continue
                    key = (issue.level, self.kinds[label], re.sub(r"\[\d+\]", "[]", issue.path), issue.message)
                    groups.setdefault(key, []).append(label)
            for (level, kind, path, message), labels in sorted(groups.items()):
                more = f" (+{len(labels) - 3} more)" if len(labels) > 3 else ""
                print(f"{level}: [{kind}] {path}: {message} — {len(labels)} file(s): "
                      f"{', '.join(labels[:3])}{more}")
        else:
            for label, issues in self.files.items():
                for issue in issues:
                    if quiet and issue.level != "error":
                        continue
                    print(f"{label}: {issue.level}: {issue.path}: {issue.message}")
        files, errs, warns = self.counts()
        print(f"{files} file(s) checked: {errs} error(s), {warns} warning(s)")


def validate_pack(validator, path, report):
    pack = PackFiles(path)
    found = False
    for name in pack.names:
        for pattern, kind in DECLARATIONS:
            if pattern.match(name):
                found = True
                data, problem = load_json(pack.read(name), name)
                report.add(f"{path.name}/{name}", kind, [problem] if problem else validator.validate(data, kind))
    if "pack.mcmeta" not in pack.names:
        report.add(f"{path.name}/pack.mcmeta", "pack_mcmeta_rwat",
                   [Issue("error", "$", "the pack has no pack.mcmeta: the mod skips it")])
    return found


def validate_recipe(validator, path, report):
    data, problem = load_json(path.read_bytes(), str(path))
    report.add(str(path), "recipe", [problem] if problem else validator.validate(data, "recipe"))
    if isinstance(data, dict) and isinstance(data.get("overrides_dir"), str):
        folder = path.parent / data["overrides_dir"]
        for override in sorted(folder.glob("*.json")):
            o, problem = load_json(override.read_bytes(), str(override))
            report.add(str(override), "recipe_override",
                       [problem] if problem else validator.validate(o, "recipe_override"))


# ------------------------------------------------------------ self-check

def walk_schema(node, pointer=""):
    """(pointer, subschema) of every schema object in a document."""
    if isinstance(node, dict):
        yield pointer, node
        for key, value in node.items():
            if key in ("properties", "$defs", "patternProperties"):
                for name, sub in value.items():
                    yield from walk_schema(sub, f"{pointer}/{key}/{name}")
            elif key in ("items", "additionalProperties", "propertyNames", "not") and isinstance(value, dict):
                yield from walk_schema(value, f"{pointer}/{key}")
            elif key in ("anyOf", "oneOf", "allOf"):
                for i, sub in enumerate(value):
                    yield from walk_schema(sub, f"{pointer}/{key}/{i}")


def described(store, base, schema, lang_key):
    """True if a property schema carries `lang_key` itself or through the forms it refers to."""
    seen = 0
    while seen < 10:
        seen += 1
        if lang_key in schema:
            return True
        if "$ref" in schema:
            base, schema = store.resolve(base, schema["$ref"])
            continue
        branches = [b for b in schema.get("anyOf", schema.get("oneOf", [])) if b.get("type") != "null"]
        if branches:
            return all(described(store, base, b, lang_key) for b in branches)
        return False
    return False


PATCH_MIRRORS = [
    ("recipe_override", "#/$defs/type_patch", "wagon_type", "#"),
    ("recipe_override", "#/$defs/resistance_patch", "wagon_type", "#/$defs/resistance"),
    ("recipe_override", "#/$defs/traction_patch", "wagon_type", "#/$defs/traction"),
    ("recipe_override", "#/$defs/brakes_patch", "wagon_type", "#/$defs/brakes"),
    ("recipe_override", "#/$defs/cab_patch", "wagon_type", "#/$defs/cab"),
    ("recipe_override", "#/$defs/couplers_patch", "wagon_type", "#/$defs/couplers"),
    ("recipe_override", "#/$defs/door_patch", "wagon_type", "#/$defs/door"),
    ("recipe_override", "#/$defs/model_patch", "wagon_model", "#"),
    ("recipe_override", "#/$defs/sounds_patch", "wagon_model", "#/$defs/sounds"),
    ("recipe_override", "#/$defs/control_sounds_patch", "wagon_model", "#/$defs/control_sounds"),
    ("recipe_override", "#/$defs/zone", "wagon_type", "#/$defs/zone"),
    ("recipe_override", "#/$defs/door", "wagon_type", "#/$defs/door"),
    ("recipe_override", "#/$defs/seat", "wagon_type", "#/$defs/seat"),
    ("recipe", "#/$defs/rail_patch", "rail_model", "#"),
]

# the files whose objects take comments at every level: a key starting with _
COMMENTED = ("recipe", "recipe_override")
COMMENT_KEY = "^_"

# Java Pattern constants of convention/ObjectRole.java ↔ ids in schema/obj-conventions.json
JAVA_PATTERNS = {
    "CG": ("control_modifiers", "CG"), "LABEL": ("control_modifiers", "LABEL"),
    "OFFSET": ("control_modifiers", "OFFSET"), "RANGE": ("control_modifiers", "RANGE"),
    "SLIDE": ("control_modifiers", "TL"), "LCG": ("lights", "LCG"), "RGB": ("lights", "RGB"),
    "HEADLIGHT": ("lights", "HEADLIGHT"), "COUPLED": ("roles", "coupler_head"),
}


def java_string(literal):
    """The value of a Java string literal's body."""
    return literal.encode("utf-8").decode("unicode_escape")


# a Java key constant: Set<String> KEYS = PackJson.keys("a", "b") (or Set.of / List.of)
JAVA_KEY_CONSTANT = re.compile(r"\b(?:Set|List|Collection)<String>\s+(\w+)\s*=\s*"
                               r"(?:PackJson\.keys|Set\.of|List\.of)\(([^;]*?)\)\s*;", re.S)
JAVA_STRING = re.compile(r'"((?:[^"\\]|\\.)*)"')
RESERVED = "RESERVED_"


def key_constants(file):
    """{name: keys} of the key constants a code file declares — `file` as x-keys
    names it: relative to the Java code root, or tools/<name>.py. Java: the
    Set<String> / List<String> constants built from string literals; Python:
    the module-level literal tuples, lists, sets and dicts of strings (a
    dict's keys)."""
    if file.startswith("tools/"):
        tree = ast.parse((ROOT / file).read_text(encoding="utf-8"))
        found = {}
        for node in tree.body:
            if not (isinstance(node, ast.Assign) and len(node.targets) == 1
                    and isinstance(node.targets[0], ast.Name)):
                continue
            try:
                value = ast.literal_eval(node.value)
            except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
                continue
            if isinstance(value, (tuple, list, set, frozenset, dict)) and value \
                    and all(isinstance(k, str) for k in value):
                found[node.targets[0].id] = set(value)
        return found
    text = (JAVA_ROOT / file).read_text(encoding="utf-8")
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"//[^\n]*", "", text)
    return {m.group(1): {java_string(s) for s in JAVA_STRING.findall(m.group(2))}
            for m in JAVA_KEY_CONSTANT.finditer(text)}


def pack_file_schemas(store):
    """The schemas of the files a pack holds (pack-layout.json's files)."""
    layout = json.loads((store.folder / "pack-layout.json").read_text(encoding="utf-8"))
    return {f["schema"] for f in layout["files"] if f.get("schema")}


def check_key_constants(store, problem):
    """Every object naming its code's key constant in x-keys has exactly its keys,
    its reserved ones are the constant's RESERVED_ companion; every closed object
    of a pack file names one; every *KEYS constant of a named file is named
    (the Java half is SchemaKeysTest's too)."""
    pack_files = pack_file_schemas(store)
    named = {}      # code file → names the schemas give
    constants = {}  # code file → its key constants
    for uri, document in store.by_id.items():
        name = uri.rsplit("/", 1)[-1]
        for pointer, schema in walk_schema(document):
            if "properties" not in schema:
                continue
            where = f"{name}#{pointer}"
            ref = schema.get("x-keys")
            if ref is None:
                if name in pack_files and schema.get("additionalProperties") is False:
                    problem(where, "a closed object of a pack file without x-keys "
                                   "(name the constant of the parser that lists its keys)")
                continue
            file, _, constant = ref.partition("#")
            label = f"{where} ↔ {file.rsplit('/', 1)[-1]}#{constant}"
            try:
                if file not in constants:
                    constants[file] = key_constants(file)
            except (OSError, SyntaxError) as e:
                problem(where, f"x-keys {ref!r}: can't read {file}: {e}")
                constants[file] = {}
                continue
            named.setdefault(file, set()).add(constant)
            code = constants[file].get(constant)
            if code is None:
                problem(where, f"x-keys {ref!r}: {file} declares no key constant {constant}")
                continue
            ours = set(schema["properties"])
            if ours - code:
                problem(label, f"in the schema, not in the code: {sorted(ours - code)}")
            if code - ours:
                problem(label, f"in the code, not in the schema: {sorted(code - ours)}")
            reserved = {k for k, sub in schema["properties"].items() if sub.get("x-status") == "reserved"}
            companion = constants[file].get(RESERVED + constant)
            if companion is not None:
                if reserved != companion:
                    problem(label, f"x-status reserved on {sorted(reserved)}, "
                                   f"{RESERVED + constant} lists {sorted(companion)}")
            elif reserved:
                problem(label, f"{sorted(reserved)} marked reserved, but there is no {RESERVED + constant} "
                               f"to warn about them")
    for file, names in named.items():
        for constant in constants.get(file, {}):
            companion = constant.startswith(RESERVED) and constant[len(RESERVED):] in names
            if constant.endswith("KEYS") and constant not in names and not companion:
                problem(f"{file}#{constant}", "named by no x-keys of the schemas")


def self_check(store):
    problems = []
    validator = Validator(store)

    def problem(where, message):
        problems.append(f"{where}: {message}")

    # 1. documents, $refs, descriptions, closed objects
    for uri, document in store.by_id.items():
        name = uri.rsplit("/", 1)[-1]
        if document.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            problem(name, "$schema is not draft 2020-12")
        if not uri.endswith("/" + name) and uri != name:
            problem(name, f"$id {uri} doesn't end with the file name")
        for pointer, schema in walk_schema(document):
            where = f"{name}#{pointer}"
            if "$ref" in schema:
                try:
                    store.resolve(uri, schema["$ref"])
                except (KeyError, ValueError, IndexError) as e:
                    problem(where, str(e))
            if "properties" in schema and "additionalProperties" not in schema \
                    and "Open:" not in schema.get("$comment", ""):
                problem(where, "object without additionalProperties (say why in a $comment 'Open: …')")
            for prop, sub in schema.get("properties", {}).items():
                for key in ("description", "x-description-ru"):
                    if not described(store, uri, sub, key):
                        problem(f"{where}/properties/{prop}", f"no {key}")
                if "default" in sub:
                    stripped = {k: v for k, v in sub.items() if k != "default"}
                    for issue in errors(validator.check(sub["default"], stripped, uri, "default")):
                        problem(f"{where}/properties/{prop}", f"default {show(sub['default'])}: {issue.message}")
            for key in ("pattern",):
                if key in schema:
                    try:
                        re.compile(schema[key])
                    except re.error as e:
                        problem(where, f"bad pattern: {e}")
            if any(ord(c) in (0x200B, 0x200C, 0x200D, 0xFEFF) for c in json.dumps(schema)):
                problem(where, "zero-width character")
        for i, example in enumerate(document.get("examples", [])):
            for issue in validator.check(example, document, uri, f"examples[{i}]"):
                if issue.level == "error":
                    problem(name, f"example {i}: {issue.path}: {issue.message}")

    # 2. override patches mirror the declarations they patch
    for patch_file, patch_ptr, decl_file, decl_ptr in PATCH_MIRRORS:
        p_uri, _ = store.root(patch_file)
        d_uri, _ = store.root(decl_file)
        try:
            _, patch = store.resolve(p_uri, patch_ptr)
            _, decl = store.resolve(d_uri, decl_ptr)
        except KeyError as e:
            problem(f"{patch_file}{patch_ptr}", str(e))
            continue
        missing = set(decl.get("properties", {})) - set(patch.get("properties", {}))
        extra = set(patch.get("properties", {})) - set(decl.get("properties", {}))
        if missing or extra:
            problem(f"{patch_file}{patch_ptr}", f"doesn't mirror {decl_file}{decl_ptr}: "
                                                f"missing {sorted(missing)}, extra {sorted(extra)}")

    # 2b. a recipe and an override file take comments (keys starting with _) in every object
    for kind in COMMENTED:
        uri, document = store.root(kind)
        for pointer, schema in walk_schema(document):
            if schema.get("type") == "object" and COMMENT_KEY not in schema.get("patternProperties", {}):
                problem(f"{kind}.schema.json#{pointer}", f"an object without patternProperties {COMMENT_KEY!r} "
                                                         f"(comments are allowed at every level)")

    # 3. OBJ conventions: regexes compile, steps exist, kinds and patterns are the Java ones
    conventions = json.loads((store.folder / "obj-conventions.json").read_text(encoding="utf-8"))

    def regexes(node, where):
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ("regex", "regex_template") and isinstance(value, str):
                    try:
                        re.compile(value)
                    except re.error as e:
                        problem(f"obj-conventions.json {where}", f"bad regex {value!r}: {e}")
                else:
                    regexes(value, f"{where}.{key}")
        elif isinstance(node, list):
            for i, value in enumerate(node):
                regexes(value, f"{where}[{i}]")

    regexes(conventions, "$")
    role_ids = {r["id"] for r in conventions["roles"]}
    for step in conventions["parse_order"]["steps"]:
        if step not in role_ids:
            problem("obj-conventions.json parse_order", f"step {step!r} is no role")
    role_java = (JAVA_ROOT / "convention/ObjectRole.java").read_text(encoding="utf-8")
    java_kinds = re.findall(r'^\s+([A-Z_]+)\("((?:[^"\\]|\\.)*)",\s*(true|false)\)', role_java, re.M)
    ours = [(k["kind"], k["regex"], k["gauge"]) for k in conventions["control_kinds"]]
    if [k for k, _, _ in java_kinds] != [k for k, _, _ in ours]:
        problem("obj-conventions.json control_kinds",
                f"kinds or their order differ from ObjectRole.Kind: {[k for k, _, _ in java_kinds]}")
    for (kind, prefix, gauge), (_, regex, our_gauge) in zip(java_kinds, ours):
        wanted = "(?:^|_)(" + java_string(prefix) + ")_(\\d+)(?=_|$)"
        if regex != wanted:
            problem(f"obj-conventions.json control_kinds {kind}", f"regex {regex!r} isn't the Java one {wanted!r}")
        if (gauge == "true") != our_gauge:
            problem(f"obj-conventions.json control_kinds {kind}", "gauge flag differs from Java")
    sections = {(s, e.get("id")): e for s in ("control_modifiers", "lights", "roles")
                for e in conventions[s]}
    for constant, key in JAVA_PATTERNS.items():
        m = re.search(r"Pattern\s+" + constant + r'\s*=\s*Pattern\.compile\("((?:[^"\\]|\\.)*)"\)', role_java)
        ours = sections.get(key)
        if m is None or ours is None:
            problem("obj-conventions.json", f"can't compare {constant}")
            continue
        regex = ours.get("regex") or ours.get("match", {}).get("regex")
        if regex != java_string(m.group(1)):
            problem(f"obj-conventions.json {key[0]} {key[1]}",
                    f"regex {regex!r} isn't ObjectRole.{constant} {java_string(m.group(1))!r}")
    copy = re.search(r'COPY_SUFFIX\s*=\s*Pattern\.compile\("((?:[^"\\]|\\.)*)"\)', role_java)
    if copy is None or java_string(copy.group(1)) != conventions["naming"]["copy_suffix"]["regex"]:
        problem("obj-conventions.json naming.copy_suffix", "isn't ObjectRole.COPY_SUFFIX")

    # 4. schema keys = the keys the code knows: the constants x-keys names (Java parsers, converter)
    check_key_constants(store, problem)
    _, wagon_type = store.root("wagon_type")
    defaults = (JAVA_ROOT / "stock/StockDefaults.java").read_text(encoding="utf-8")
    systems = re.findall(r"^\s+([A-Z]+)\([\d.]+, [\d.]+, [\d.]+\)", defaults, re.M)
    if sorted(s.lower() for s in systems) != sorted(wagon_type["$defs"]["brakes"]["properties"]["system"]["enum"]):
        problem("wagon_type brakes.system", f"enum isn't StockDefaults.BrakeSystem {systems}")
    return problems


# ------------------------------------------------------------------ main

def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("paths", nargs="*", help="pack folders or zips, recipes, or files with --as")
    parser.add_argument("--as", dest="kind", choices=SCHEMA_KINDS, help="validate the files against this schema")
    parser.add_argument("--schema-dir", default=str(SCHEMA_DIR), help="where the schemas are (default: schema/)")
    parser.add_argument("--group", action="store_true", help="one line per distinct issue, with its files")
    parser.add_argument("--quiet", action="store_true", help="errors only")
    parser.add_argument("--self-check", action="store_true", help="check the schemas themselves")
    args = parser.parse_args()
    sys.stdout.reconfigure(errors="replace")

    store = SchemaStore(args.schema_dir)
    if args.self_check:
        problems = self_check(store)
        for line in problems:
            print(line)
        print(f"self-check: {len(problems)} problem(s)")
        if not args.paths:
            sys.exit(1 if problems else 0)
    elif not args.paths:
        parser.print_usage()
        sys.exit(2)

    validator = Validator(store)
    report = Report()
    for raw in args.paths:
        path = Path(raw)
        if not path.exists():
            print(f"{raw}: no such file or folder")
            sys.exit(2)
        if args.kind:
            data, problem = load_json(path.read_bytes(), raw)
            report.add(raw, args.kind, [problem] if problem else validator.validate(data, args.kind))
        elif path.is_dir() or path.suffix == ".zip":
            if not validate_pack(validator, path, report):
                print(f"{raw}: no RWAT declarations found")
        else:
            data, problem = load_json(path.read_bytes(), raw)
            if isinstance(data, dict) and "sources" in data:
                validate_recipe(validator, path, report)
            else:
                print(f"{raw}: not a pack or a recipe; name its schema with --as")
                sys.exit(2)
    report.print(args.group, args.quiet)
    files, errs, _ = report.counts()
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
