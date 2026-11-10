"""fixtures/golden/recipe_merge/ (golden.py): how a conversion recipe's override of a
stock type lands on what tools/ir2rwat.py derives for it — the reference; the editor's
model of recipes (editor/src/ir/recipe/merge.ts) is its port, the layers it shows
("derived" → "override" → "result") are these.

A case gives the derived layer as data, not as an IR pack: what the converter makes of
the IR definition and the OBJ is the converter's alone (the editor asks it through
Pyodide, editor.md §3.12), the merge on top of it is what both sides do.

    category   the IR category (rolling_stock/<category>/): passenger runs the floor generator
    derived    name      the IR name (en_us)
               type      what derive_type gives (physics, couplers…)
               doors     the doors the model carries (model_doors, OBJ frame)
               interior  IR's passenger area as a zone (derive_interior), or null
               model     the model declaration with every door animation and door sound
                         the IR pack has (obj, animations, liveries, handbrake, sounds):
                         only those of the doors the type ends up with stay
               lights    the model's light groups
    floor      the zones the floor generator gives for the override's "floor" options,
               or null (no floor: the options aren't valid, the generator failed)
    inline     the recipe's own "overrides".<id> (optional)
    override   the per-type file packs/<name>/<id>.json (optional; "_" keys are comments)

expected: the type and model declarations written, the lang entries of the type, and
the converter's warnings about the override (a door edit for no door, a light group the
model hasn't, a sway out of range).

The converter runs for real: Converter reads a recipe and a per-type file from a
temporary folder and converts a minimal IR zip built from the case; only what derives
from IR's geometry and definition (parse_obj, derive_type, model_doors, derive_interior,
derive_handbrake, light_groups, floorgen.generate) is stood in for by the case's data.
Rewrite the expected after a meant change:

    python -I tools/tests/test_golden_recipe_merge.py --update"""

import contextlib
import copy
import io
import json
import sys
import tempfile
import types
import unittest  # noqa: F401  (golden.main runs it)
import zipfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import golden  # noqa: E402  (puts tools/ on the path)
import floorgen  # noqa: E402
import ir2rwat  # noqa: E402

TYPE_ID = "car"
NAMESPACE = "ns"
ROOT = "stock"
IR = "assets/immersiverailroading/"
OBJ = f"{ROOT}/car/car.obj"  # where the model lands: the derived model's "obj"
MODEL_ORDER = ("obj", "animations", "liveries", "handbrake", "sounds")
SOUND_ORDER = ("idle", "horn", "bell", "wheels", "clack", "doors", "controls")


def ir_file(location):
    """A location in the converted pack (stock/<rest>) → (the IR reference, its zip entry):
    sounds/… from IR's sounds/, anything else from its models/ (Source.destination)."""
    if not location.startswith(ROOT + "/"):
        raise ValueError(f"{location}: a derived location starts with {ROOT}/")
    rest = location[len(ROOT) + 1:]
    folder = "" if rest.startswith("sounds/") else "models/"
    return f"immersiverailroading:{folder}{rest}", f"{IR}{folder}{rest}"


def in_order(keys, order, what):
    if [k for k in order if k in keys] != list(keys) or set(keys) - set(order):
        raise ValueError(f"{what}: keys {list(keys)}, the converter writes them in the order {order}")


def ir_pack(category, derived, path):
    """The minimal IR zip whose conversion copies the derived model's files: the definition,
    the OBJ (read by the stand-in parse_obj), animations, sounds and livery folders."""
    model = derived["model"]
    in_order(model, MODEL_ORDER, "derived.model")
    if model.get("obj") != OBJ:
        raise ValueError(f"derived.model.obj is {OBJ}")
    files = {f"{IR}models/car/car.obj": b"o BODY\n"}
    sounds = dict(model.get("sounds", {}))
    in_order(sounds, SOUND_ORDER, "derived.model.sounds")
    door_sounds = sounds.pop("doors", {})

    def ref(location):
        reference, entry = ir_file(location)
        files[entry] = b""
        return reference

    animations = []
    for group, location in model.get("animations", {}).items():
        animation = {"control_group": group, "animatrix": ref(location)}
        if group in door_sounds:
            animation["sound"] = {"start": ref(door_sounds[group])}
        animations.append(animation)
    if set(door_sounds) - set(model.get("animations", {})):
        raise ValueError("a door sound comes with its door's animation (IR keeps it there)")
    ir_sounds = {}
    for key, value in sounds.items():
        if key == "controls":
            ir_sounds[key] = {k: {kind: ref(v) for kind, v in c.items()} for k, c in value.items()}
        elif isinstance(value, str):
            ir_sounds[key] = ref(value)
        else:
            ir_sounds[key] = {part: ref(v) for part, v in value.items()}
    liveries = model.get("liveries", {})
    for livery, folder in liveries.items():
        if ir2rwat.sanitize_id(livery) != livery:
            raise ValueError(f"livery {livery}: a derived livery id is as the converter makes it")
        files[f"{IR}models/car/{folder}/skin.png"] = b""
    definition = {"name": derived["name"], "model": "immersiverailroading:models/car/car.obj",
                  "animations": animations, "tex_variants": liveries, "sounds": ir_sounds}
    files[f"{IR}rolling_stock/{category}/{TYPE_ID}.json"] = json.dumps(definition).encode("utf-8")
    with zipfile.ZipFile(path, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)


def stand_ins(given):
    """What the converter derives from IR's geometry and definition, from the case."""
    derived = given["derived"]

    def generate(raw, config, doors, ir_floor):
        if given["floor"] is None:
            raise ValueError("no floor in this case")
        return types.SimpleNamespace(interior=copy.deepcopy(given["floor"]), levels=[])

    return [
        mock.patch.object(ir2rwat, "parse_obj", lambda raw: ([], [], (-1.0, 1.0), {})),
        mock.patch.object(ir2rwat, "derive_type", lambda *a: copy.deepcopy(derived["type"])),
        mock.patch.object(ir2rwat, "model_doors", lambda *a: copy.deepcopy(derived["doors"])),
        mock.patch.object(ir2rwat, "derive_interior", lambda *a: copy.deepcopy(derived["interior"])),
        mock.patch.object(ir2rwat, "derive_handbrake", lambda *a: list(derived["model"].get("handbrake", []))),
        mock.patch.object(ir2rwat, "light_groups", lambda *a: {group: {} for group in derived["lights"]}),
        mock.patch.object(floorgen, "generate", generate),
    ]


def merge(given):
    """The converter's type, model and lang entries for the case, and its warnings about the override."""
    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        ir_pack(given["category"], given["derived"], folder / "ir.zip")
        recipe = {"namespace": NAMESPACE, "pack_dir": "Pack", "sources": [{"zip": "ir.zip", "root": ROOT}],
                  "overrides_dir": "per"}
        if "inline" in given:
            recipe["overrides"] = {TYPE_ID: given["inline"]}
        (folder / "per").mkdir()
        if "override" in given:
            (folder / "per" / f"{TYPE_ID}.json").write_text(json.dumps(given["override"]), encoding="utf-8")
        (folder / "recipe.json").write_text(json.dumps(recipe), encoding="utf-8")
        with contextlib.ExitStack() as stack:
            for patch in stand_ins(given):
                stack.enter_context(patch)
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            converter = ir2rwat.Converter(folder / "recipe.json")
            converter.convert()
    if converter.errors and not all("no generated floor" in e for e in converter.errors):
        raise ValueError(f"the conversion failed: {converter.errors}")
    written = {path: json.loads(data) for path, data in converter.generated.items()}
    suffix = f".{NAMESPACE}.{TYPE_ID}"
    return {
        "type": written[f"data/{NAMESPACE}/wagon_types/{TYPE_ID}.json"],
        "model": written[f"assets/{NAMESPACE}/wagon_models/{TYPE_ID}.json"],
        "lang": {lang: {key: text for key, text in texts.items() if suffix in key}
                 for lang, texts in converter.langs.items()},
        # the converter's words about the override; not the generator's (the case's stand-in)
        "warnings": [w for w in converter.warnings if w.startswith(f"{TYPE_ID}: ") and "no generated floor" not in w],
    }


class RecipeMergeGolden(golden.ReferenceTest):
    FOLDER = "recipe_merge"

    def compute(self, given):
        return merge(given)


if __name__ == "__main__":
    golden.main(RecipeMergeGolden)
