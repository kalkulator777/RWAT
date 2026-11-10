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


FUNCTIONS = {
    "convert": convert,
    "model_doors": model_doors,
    "suggest_floor": suggest_floor,
    "rewrite_references": rewrite_references,
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
    """FUNCTIONS[name](**arguments), arguments and answer JSON text; `log` goes to convert."""
    try:
        kwargs = json.loads(arguments)
        if name == "convert":
            kwargs["log"] = log
        value = FUNCTIONS[name](**kwargs)
        return json.dumps({"ok": True, "value": value}, ensure_ascii=False, allow_nan=False)
    except (Exception, SystemExit) as problem:  # every failure goes back as a structure, none kills the worker
        return json.dumps({"ok": False, "error": failure(problem)}, ensure_ascii=False)
