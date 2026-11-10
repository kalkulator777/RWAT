"""rwat_bridge — the pack editor's glue to the pack tools in Pyodide (docs/proposals/editor.md §3.12).

The editor runs tools/ir2rwat.py and tools/floorgen.py as they are in the repository
(R9: no port); this module only calls them and turns what they give into JSON. No rule
of the converter lives here — a change to how a pack is converted or a floor generated
is a change to the tools, and the editor sees it as it is.

The worker (editor/src/ir/python.ts) writes this file, ir2rwat.py and floorgen.py to
/rwat/tools/ of Pyodide's file system, puts the folder on sys.path and calls `call`
with a function's name and its arguments as JSON. Bytes travel as files of Pyodide's
file system (the worker writes the input and reads the output), never through JSON.
Every answer is JSON text: {"ok": true, "value": ...} or {"ok": false, "error":
{"kind": "python", "type", "message", "text", "traceback"}} — a Python exception as a structure, its
`text` as the converter words it for an author (ir2rwat.describe), its traceback for
debugging.

One state is kept between calls: the Converter `derive` made, for `floor_for` and
`model_files`, until the next `derive` or `close`.
"""

import contextlib
import gc
import json
import os
import traceback

import floorgen
import ir2rwat

# how ir2rwat.main starts the line that says why it refused
REFUSAL_PREFIX = "ir2rwat: error: "


class Lines:
    """A text stream that keeps what is written to it line by line and hands each
    finished line to `listener` (a JavaScript function, or None) as it is written."""

    def __init__(self, listener=None):
        self.lines = []
        self.partial = ""
        self.listener = listener

    def write(self, text):
        self.partial += text
        *done, self.partial = self.partial.split("\n")
        for line in done:
            self.lines.append(line)
            if self.listener is not None:
                self.listener(line)
        return len(text)

    def flush(self):
        pass

    def finish(self):
        if self.partial:
            self.write("\n")
        return self.lines


def read(path):
    with open(path, "rb") as file:
        return file.read()


def convert(recipe, out, as_zip, log=None):
    """`python tools/ir2rwat.py <recipe> --out <out> [--zip]`, run by ir2rwat.main itself,
    so the exit status and what is written are the command line's. What it printed comes
    back as lines (and goes to `log` as it is printed); the warnings, errors, stock and
    rail styles from the Converter main made (seen by a subclass that only notes it)."""
    made = []
    original = ir2rwat.Converter

    class Noted(original):
        def __init__(self, *args, **kwargs):
            made.append(self)
            super().__init__(*args, **kwargs)

    printed, said = Lines(log), Lines()
    argv = [recipe, "--out", out] + (["--zip"] if as_zip else [])
    ir2rwat.Converter = Noted
    try:
        with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(said):
            status = ir2rwat.main(argv)
    finally:
        ir2rwat.Converter = original
        for converter in made:
            for source in getattr(converter, "sources", []):
                source.zip.close()
    converter = made[0] if made else None
    refusal = "\n".join(said.finish()) or None
    if refusal is not None and refusal.startswith(REFUSAL_PREFIX):
        refusal = refusal[len(REFUSAL_PREFIX):]
    report = {
        "exit": status,
        "refusal": refusal,
        "warnings": list(getattr(converter, "warnings", [])),
        "errors": list(getattr(converter, "errors", [])),
        "stock": [{"id": i, "source": label, "category": category, "name": name, "liveries": liveries}
                  for i, label, category, name, liveries in getattr(converter, "stock", [])],
        "rails": [{"id": i, "source": label, "name": name} for i, label, name in getattr(converter, "rails", [])],
        "log": printed.finish(),
        "pack": sorted(os.listdir(out)) if os.path.isdir(out) else [],
    }
    del converter, made
    gc.collect()
    return report


def model_doors(obj, animated):
    """The doors a model carries, as the pack writes them (OBJ frame): ir2rwat.parse_obj
    and ir2rwat.model_doors. `animated`: the control groups an animation moves, any case."""
    _, _, _, boxes = ir2rwat.parse_obj(read(obj))
    return ir2rwat.model_doors(boxes, {group.lower() for group in animated})


def suggest_floor(obj, options, doors):
    """floorgen.generate on a model with the per-type "floor" options and the type's doors,
    without IR's passenger area (a pack of one's own has none): the level is options.level,
    or, without one, the generator's own pick. Everything in the OBJ frame."""
    floor = floorgen.generate(read(obj), floorgen.FloorConfig(options), doors)
    return {
        "interior": floor.interior,
        "levels": [floorgen.y_to_obj(level) for level in floor.levels],
        "notes": floor.notes,
        "region_area": floor.region.area(),
        "dropped_area": floor.dropped_area,
    }


def rewrite_references(raw, keyword, moved, out):
    """ir2rwat.rewrite_references on the file `raw`, written to `out`; False (nothing
    written) if nothing moves."""
    data = ir2rwat.rewrite_references(read(raw), keyword, moved)
    if data is None:
        return False
    with open(out, "wb") as file:
        file.write(data)
    return True


def resource_parts(parts):
    """ir2rwat.resource_part of each path part: how the converter renames a part a resource path can't hold."""
    return [ir2rwat.resource_part(part) for part in parts]


def relink(links):
    """ir2rwat.relink of each [folder, written, destination]: None where the path as written still
    leads to the destination, else the path that does."""
    return [ir2rwat.relink(folder, written, destination) for folder, written, destination in links]


class NoRecipe(Exception):
    """floor_for before derive (or after close, or in a worker started anew)."""


# the Converter derive made, kept for floor_for until the next derive or close
SESSION = {}


def close():
    """Forgets the recipe derive opened, its source zips closed."""
    converter = SESSION.pop("converter", None)
    for source in getattr(converter, "sources", []):
        source.zip.close()
    gc.collect()
    return None


def derive(recipe, log=None):
    """The derived layer of every stock type the recipe converts (Converter.derived),
    before any override: a Converter of the recipe with its overrides left out converts
    in memory (nothing written), so the ids are the ones the conversion writes; then
    each type's layer. What it printed goes to `log`; the warnings and errors are the
    conversion's. The Converter stays for floor_for until the next derive or close."""
    close()
    printed = Lines(log)
    with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(printed):
        converter = ir2rwat.Converter(recipe)
        SESSION["converter"] = converter
        converter.overrides, converter.override_origin = {}, {}
        converter.convert()
        warnings, errors = list(converter.warnings), list(converter.errors)
        derived, failed = {}, {}
        for type_id, *_ in converter.stock:
            try:
                derived[type_id] = converter.derived(type_id)
            except Exception as problem:  # the conversion took another source's definition of the id
                failed[type_id] = ir2rwat.describe(problem)
        del converter.warnings[len(warnings):], converter.errors[len(errors):]
    return {"derived": derived, "failed": failed, "warnings": warnings, "errors": errors, "log": printed.finish()}


def floor_for(type_id, override):
    """The floor the converter generates for a type of the recipe derive opened, with
    `override` as its per-type override (the inline one and the file layered): plan
    with it in place — the generator's options, the doors it ends up with, IR's
    passenger area — and taken out again. The zones, or None where the converter
    writes none (the generator doesn't run for the type, or refuses the options:
    `problem` says why, as the converter does)."""
    converter = SESSION.get("converter")
    if converter is None:
        raise NoRecipe("no recipe derived: derive it first")
    warnings, errors = len(converter.warnings), len(converter.errors)
    converter.overrides[type_id] = ir2rwat.without_comments(override or {})
    try:
        with contextlib.redirect_stdout(Lines()):
            plan = converter.plan(type_id)
    finally:
        del converter.overrides[type_id]
        del converter.warnings[warnings:], converter.errors[errors:]
    floor = plan["floor"]
    return {
        "interior": None if floor is None else floor.interior,
        "levels": [] if floor is None else [floorgen.y_to_obj(level) for level in floor.levels],
        "notes": [] if floor is None else floor.notes,
        "problem": plan["floor_problem"],
    }


def model_files(type_id, out):
    """The files of a type's model as the conversion copies them — the OBJ, its MTLs and
    their textures, the liveries, the door animations, the sounds — found by the
    converter itself (Converter.derived: Source.find in any case, parse_mtl, the
    livery folders), for the editor to read out of the source zip. Each: its path in
    the pack, the index of its source in the recipe's "sources", the zip's own entry
    name, and, where the converter rewrites a path in it (a renamed texture or MTL),
    the name of a file in `out` holding the bytes it writes instead. Sorted by path."""
    converter = SESSION.get("converter")
    if converter is None:
        raise NoRecipe("no recipe derived: derive it first")
    files, warnings, errors = converter.files, len(converter.warnings), len(converter.errors)
    converter.files = {}
    try:
        with contextlib.redirect_stdout(Lines()):
            converter.derived(type_id)
        copied = converter.files
    finally:
        converter.files = files
        del converter.warnings[warnings:], converter.errors[errors:]
    os.makedirs(out, exist_ok=True)
    listed = []
    for number, (path, asset) in enumerate(sorted(copied.items())):
        data = None
        if asset.data is not None:
            data = str(number)
            with open(os.path.join(out, data), "wb") as file:
                file.write(asset.data)
        listed.append({"path": path, "source": converter.sources.index(asset.source),
                       "entry": asset.source.entries[asset.name], "data": data})
    return listed


FUNCTIONS = {
    "convert": convert,
    "derive": derive,
    "floor_for": floor_for,
    "model_files": model_files,
    "close": close,
    "model_doors": model_doors,
    "suggest_floor": suggest_floor,
    "rewrite_references": rewrite_references,
    "resource_parts": resource_parts,
    "relink": relink,
}


def failure(problem):
    return {
        "kind": "python",
        "type": type(problem).__name__,
        "message": str(problem),
        "text": ir2rwat.describe(problem),
        "traceback": traceback.format_exc(),
    }


def call(name, arguments, log=None):
    """FUNCTIONS[name](**arguments), arguments and answer JSON text; `log` goes to convert and derive."""
    try:
        kwargs = json.loads(arguments)
        if name in ("convert", "derive"):
            kwargs["log"] = log
        value = FUNCTIONS[name](**kwargs)
        return json.dumps({"ok": True, "value": value}, ensure_ascii=False, allow_nan=False)
    except (Exception, SystemExit) as problem:  # every failure goes back as a structure, none kills the worker
        return json.dumps({"ok": False, "error": failure(problem)}, ensure_ascii=False)
