#!/usr/bin/env python3
"""ir2rwat — convert Immersive Railroading content packs into an RWAT content pack.

SPEC §6.8. Reads the IR pack zips named by a recipe (packs/<name>.json) and
writes one RWAT pack: a plain Minecraft pack that is both a resource pack and
a data pack (SPEC §6.1). IR assets (OBJ, MTL, textures, liveries, .anim) are
copied byte for byte — the RWAT model convention IS the IR one (SPEC §5.2) —
only the declarations are generated (the one exception: paths Minecraft
can't take, see "Foreign IR packs" below):

    data/<ns>/wagon_types/<id>.json     physics, from IR "properties"/"trucks"
    assets/<ns>/wagon_models/<id>.json  model, liveries, door animations, sounds
    assets/<ns>/rail_models/<id>.json   rail styles, from IR track/ definitions (SPEC §6.10)
    assets/<ns>/lang/<lang>.json        display names (wagon.<ns>.<id>, rail.<ns>.<id>,
                                        light.<ns>.<id>.<group>)
    pack.mcmeta                         Minecraft's "pack" and RWAT's "rwat" block, format 1:
                                        the recipe's name, version, authors, license
    RWAT_CONVERSION.txt                 how it was converted: the namespace, the source packs,
                                        the stock, every file renamed (and the mark that
                                        ir2rwat wrote the pack: it replaces no other folder)

IR carries none of RWAT's physics figures beyond mass, power, tractive effort
and speed, and the converter writes only those (see derive_type): the rest is
the engine's defaults, the same a hand-written pack gets (SPEC §6.4). A
recipe's "overrides" deep-merge over the generated declarations ("null"
removes a field).
Overrides may also live one file per type in the recipe's "overrides_dir"
(packs/mvp/<id>.json), merged over the inline ones — so several people (or
agents) can tune different types without touching the same file. A null in
either layer survives the layering and removes the field from what is
generated.

Walkable cars come from the IR conventions too (SPEC §9.6): a passenger car's
floor is the IR "passenger" area, its doors are the model's DOOR_<n> objects —
EXTERNAL (a way in and out), CONNECTING (an end door onto the gangway to the
next car), else inner (between floor zones); the two leaves of one doorway
make one door. A recipe's own "interior"/"doors" replace them; "doors": []
turns the derived doors off. "doors" as an object edits them by id instead
({"<id>": {...}} edits or adds one door, {"<id>": null} removes it). Object
names are read as the engine reads them: without Blender's copy suffix
(DOOR_3.001 is DOOR_3).

Frames (roadmap R6): every coordinate the converter writes or reads — the
generated floor zones and doors, the per-type file's "interior", "doors",
"cab" chairs and "floor" options, the --geometry digests — is in the OBJ
frame, as Blender shows the model: X along the car, the front towards -X, Y
as in the model, +Z the left side. The heuristics work in the engine's model
frame (parse_obj, tools/floorgen.py; stock.ObjFrame: x = z_obj,
y = y_obj + floorgen.Y_LIFT, z = -x_obj) and round there, then translate at
the edges, so a derived box is the engine's to the last digit.

Names: a per-type override file may carry "name" ({"ru_ru": "..."}) and
"lights" ({"<group>": {"en_us": "...", "ru_ru": "..."}}) — the stock's display
name and its light groups' names in the driver's light menu (SPEC §8), written
to the pack's lang files.

Sway: a per-type file's "sway" (a number from 0 to 3) goes to the model
declaration — how hard that car's body rocks, on top of the player's own
setting (SPEC §10.2).

Comments: a key that starts with _ ("_comment", "_why") is a note to the
reader at any depth of the recipe and the per-type files. It is dropped as
the file is read: never warned about, never merged into a declaration.

Sounds (SPEC §10): IR's "sounds" (idle, horn, bell, wheels, clack, controls)
and the door animations' sounds go to the model declaration's "sounds", the
files copied byte for byte under <root>/sounds/. A recipe's "sound_defaults"
fill in what IR leaves to its own built-in sounds: "wheels" by category and
"clack" for every type. The engine's pitch and volume range comes from IR's
"era" (a diesel revs with the throttle, an electric's hum barely changes); an
era the converter doesn't know is a warning, and that engine sound keeps the
mod's own default range.

Several sources: the first one wins, later ones only add ids the earlier ones
lack. Each source lands under its own root folder, so shared textures of
different pack versions (common/…) never overwrite each other.

Foreign IR packs. Definitions are looked for where IR keeps them,
assets/immersiverailroading/rolling_stock/<category>/<id>.json and
assets/immersiverailroading/track/<id>.json; a pack zipped together with its
folder (MyPack/assets/…) is read from inside that folder, and macOS's
__MACOSX/ is ignored. Every file is found in any letter case, as IR finds it
on Windows. Where the files land: models/<rest> → assets/<ns>/<root>/<rest>,
any other folder of IR's namespace — sounds/, textures/, … —
→ assets/<ns>/<root>/<folder>/<rest>. Minecraft takes only a-z 0-9 _ . - / in
a resource path: a file whose path has anything else (capitals, spaces) is
renamed as it is copied — lower case, any other character an underscore —
and the paths that lead to it are rewritten: an OBJ's "mtllib" lines, an
MTL's "map_Kd" lines, the generated declarations (model, liveries,
animations, sounds). So is a path that the new layout breaks (an OBJ in
models/ reaching through ../ into textures/). That is the ONLY case an asset
isn't copied byte for byte: just those lines change, and RWAT_CONVERSION.txt
lists every file renamed or rewritten. Two files that would land on one path
are an error.

Warnings, errors, refusals. A warning (a missing sound or texture, an
unknown era, a control or light group named longer than the engine takes —
MAX_GROUP_LENGTH, which it drops as the model loads — an unknown key in the
recipe — at its top, in a source, in "sound_defaults" — or in a per-type
file, a per-type file or an exclude for an id the packs don't have, an
"overrides_dir" that isn't a folder) changes nothing else. An error refuses one stock type or rail style
and the rest is converted: an unreadable definition, a missing model, two IR
files (or two liveries of one type) converting to one id, two files landing
on one path — and a per-type "floor" that isn't valid (that type is written
with IR's passenger area instead). A refusal stops the run before anything
is written: a bad recipe or per-type file, a missing source zip, no stock
converted at all, a target folder or zip that ir2rwat didn't write, --geometry
pointed at the per-type files or at any file that isn't a digest. The pack is
assembled next to its target and swapped in only when it is complete, so a
refused or failed run leaves the old pack as it was. Exit status: 0 — written,
1 — written, with errors (what they name is missing or not as asked), 2 —
refused, nothing written.

Usage:  python tools/ir2rwat.py packs/mvp.json [--out DIR] [--zip] [--geometry DIR]

--zip writes <pack>.zip instead of a folder, the same bytes on every run
(sorted entries, fixed entry times and permissions).

--geometry DIR also writes, per stock type, <DIR>/<id>.json: the numbers a
floor is measured from — every object's bounding box, the floor levels (up-
facing surface area by height), IR's passenger area and the floor and doors
derived from them, how each door's leaf moves, the IR animations and the
light groups, all in the OBJ frame. No model data, so it can live in the
repository and be worked from where the IR packs are not
(tests/RecipeFloorTest, SPEC §9.6).

Python 3.9+, standard library only.
"""

import argparse
import difflib
import io
import json
import math
import os
import posixpath
import re
import shutil
import sys
import tempfile
import zipfile
from collections import namedtuple
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # python -I leaves the script's folder out
import floorgen  # noqa: E402

IR_NAMESPACE = "immersiverailroading"
IR_ROOT = f"assets/{IR_NAMESPACE}/"
IR_MODELS = IR_ROOT + "models/"
IR_STOCK = IR_ROOT + "rolling_stock/"
IR_TRACK = IR_ROOT + "track/"
PACK_FORMAT_RESOURCES = 34  # Minecraft 1.21.1 resource packs
PACK_FORMAT_DATA = 48       # Minecraft 1.21.1 data packs
RWAT_FORMAT = 1             # the RWAT pack format the converter writes (pack.mcmeta "rwat"."format")
MARKER = "RWAT_CONVERSION.txt"
VALID_PATH = re.compile(r"^[a-z0-9_.\-/]+$")
# a character Minecraft doesn't take in a resource path (ResourceLocation): copied as _
NOT_IN_PATH = re.compile(r"[^a-z0-9_.\-]")
NAMESPACE = re.compile(r"^[a-z0-9_.\-]+$")
# every entry of a --zip pack carries this time (the earliest a zip can say): the same bytes every run
ZIP_TIME = (1980, 1, 1, 0, 0, 0)
# folders under assets/<ns>/ the converter writes itself: no source root may be one
GENERATED_FOLDERS = ("lang", "rail_models", "wagon_models")
RECIPE_KEYS = ("authors", "copy_root_files", "description", "exclude", "id_strip_prefix", "license", "name",
               "namespace", "out", "overrides", "overrides_dir", "pack_dir", "rail_exclude", "rail_overrides",
               "sound_defaults", "sources", "version")
SOURCE_KEYS = ("label", "root", "zip")
SOUND_DEFAULTS_KEYS = ("clack", "wheels")
OVERRIDE_KEYS = ("floor", "lights", "model", "name", "sway", "type")

HP_TO_KW = 0.745699872
LBF_TO_KN = 0.00444822162
G_KN_PER_TONNE = 9.81  # weight of a tonne, kN

# The OBJ frame (IR's model space, the pack's markup) -> the engine's model frame
# (stock.ObjFrame, IrStockModel.toModelSpace): x = IR z, y = IR y + floorgen.Y_LIFT,
# z = -IR x (IR's front is -X, RWAT's +Z). The heuristics below work in the
# model frame; the pack, the per-type files and the digests are in the OBJ frame.
# IR "passenger.center_y" sits this far under the floor a RWAT rider walks, in the
# model frame (measured on the ChME3 and the platzkart: 2.2 -> 2.311, 1.71 -> 1.81)
IR_FLOOR_OFFSET = 0.1
# headroom of a derived floor zone (only the floor height and the plan matter)
ZONE_HEIGHT = 2.5
DOOR_KEY = re.compile(r"(?:^|_)DOOR_(\d+)(?=_|$)")
CONTROL_GROUP = re.compile(r"_CG_([^_]+)")
LIGHT_GROUP = re.compile(r"_LCG_([^_]+)")
SWITCH_KEY = re.compile(r"(?:^|_)((?:WIDGET|WINDOW)_\d+)(?=_|$)")
HEADLIGHT = re.compile(r"(?:^|_)HEADLIGHT_\d+(?=_|$)")
LABEL = re.compile(r"_LABEL_([^_]+)")
WIDGET_KEY = re.compile(r"(?:^|_)WIDGET_(\d+)(?=_|$)")
# Blender's suffix on a duplicated object: DOOR_3_INTERIOR_LCG_IL.001 lights with IL
COPY_SUFFIX = re.compile(r"\.\d{3}$")
# IR flags a careless name puts where a control group goes (DOOR_7_EXTERNAL_CG_NOINTERACT)
FLAG_WORDS = {"NOINTERACT", "NOTOUCH", "TOGGLE", "PRESS", "INVERT", "HIDE", "GLOBAL",
              "EXTERNAL", "INTERIOR", "CONNECTING", "INTERNAL", "FULLBRIGHT"}
# The longest control or light group name the engine sends and keeps: GroupName.MAX_LENGTH, in
# UTF-16 code units as Java counts them. A longer group is dropped as the model loads.
MAX_GROUP_LENGTH = 32
# The control kinds whose group travels to the server: what GroupName.worksGroup lets through (not a
# gauge, a handle lever, the handbrake wheel or a door leaf).
GROUP_KINDS = re.compile(r"(?:^|_)(?:WIDGET|WINDOW|BELL_CONTROL|WHISTLE_CONTROL|HORN_CONTROL|ENGINE_START"
                         r"|THROTTLE_BRAKE)_\d+(?=_|$)")
# a DOOR_<n> smaller than this is a marker or a handle, no doorway (2TE116's DOOR_2_CONNECTING)
MIN_DOOR_HEIGHT = 1.2
MIN_DOOR_SPAN = 0.3
# a WIDGET_<n> door leaf is thin like a door: its thinner horizontal side is at most this
MAX_WIDGET_THICKNESS = 0.35
# the leaves of one doorway touch along the wall (ER2: two sliding leaves meet in the middle)
LEAF_GAP = 0.05
# an engine's ("idle") pitch and volume from rest to full throttle, by IR era (SPEC §10)
ENGINE_RANGES = {
    "diesel": {"pitch": [1.0, 1.5], "volume": [0.55, 1.0]},
    "electric": {"pitch": [1.0, 1.12], "volume": [0.45, 0.9]},
}
# IR's control sounds RWAT plays (SPEC §10): a notch ("move"), a valve opening ("engage")
CONTROL_SOUNDS = ("move", "engage")


class ConversionError(Exception):
    """A refusal: the run stops before anything is written (exit status 2)."""


class AssetCollision(Exception):
    """Two files would land on one path in the pack: the type copying the second is refused."""


# a file of the pack that comes from a source zip: data = its rewritten bytes (None: as it is)
Asset = namedtuple("Asset", "source name data renamed")
# an IR definition found in a source, and the id it converts to
Candidate = namedtuple("Candidate", "source entry category id")


# --------------------------------------------------------------------- input

def lenient_json(raw):
    """IR packs are hand-edited: tolerate a BOM, // and /* */ comments and
    trailing commas — outside strings only, a string's text is never touched.
    What is dropped becomes spaces, so an error's line and column are the
    file's own."""
    text = raw.decode("utf-8-sig")
    out = list(text)
    i, n = 0, len(text)
    comma = -1  # the last comma with nothing but blanks and comments after it
    while i < n:
        c = text[i]
        if c == '"':
            i += 1
            while i < n and text[i] != '"':
                i += 2 if text[i] == "\\" else 1
            i += 1
            comma = -1
        elif text.startswith("//", i):
            end = text.find("\n", i)
            end = n if end < 0 else end
            out[i:end] = " " * (end - i)
            i = end
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = n if end < 0 else end + 2
            out[i:end] = [ch if ch in "\r\n" else " " for ch in text[i:end]]
            i = end
        elif c == ",":
            comma = i
            i += 1
        elif c in "}]":
            if comma >= 0:
                out[comma] = " "
            comma = -1
            i += 1
        else:
            if not c.isspace():
                comma = -1
            i += 1
    return json.loads("".join(out))


def describe(problem):
    """An exception as a pack author reads it."""
    if isinstance(problem, json.JSONDecodeError):
        return f"invalid JSON: {problem.msg} at line {problem.lineno}, column {problem.colno}"
    if isinstance(problem, KeyError):
        return f"no {problem.args[0]!r} in it" if problem.args else "a key is missing"
    if isinstance(problem, (ValueError, AssetCollision, ConversionError)):
        return str(problem)
    if isinstance(problem, OSError):
        return f"{problem.strerror or problem} ({problem.filename})" if problem.filename else str(problem)
    return f"{type(problem).__name__}: {problem}"


def safe_relative(path):
    """A path inside a folder ("." and empty parts dropped), or None if it is
    absolute or climbs out ("..") — never read from a zip, never written."""
    if path.startswith("/") or re.match(r"^[A-Za-z]:", path):
        return None
    parts = [part for part in path.split("/") if part not in ("", ".")]
    if not parts or ".." in parts:
        return None
    return "/".join(parts)


def resource_part(part):
    """One part of a path as Minecraft takes it: lower case, a-z 0-9 _ . - only."""
    return NOT_IN_PATH.sub("_", part.lower())


def pack_wrapper(names):
    """The folder an IR pack was zipped in ("MyPack/"), "" if its assets/ is at the top."""
    wrappers = set()
    for name in names:
        low = name.lower()
        if low.startswith(IR_ROOT):
            return ""
        at = low.find("/" + IR_ROOT)
        if at >= 0:
            wrappers.add(name[:at + 1])
    if not wrappers:
        return ""
    shortest = min(wrappers, key=len)
    if all(wrapper.startswith(shortest) for wrapper in wrappers):
        return shortest
    raise ConversionError(f"several IR packs in one zip ({', '.join(sorted(wrappers))}): give each its own zip")


class Source:
    """One IR pack zip and the root folder its assets land under. Entries are
    found by their IR path in any letter case (as IR finds them on Windows),
    a pack zipped inside a folder is read from that folder, and an entry with
    an absolute path or a ".." is never read (`unsafe`)."""

    def __init__(self, path, root, label):
        self.path = path
        self.root = root
        self.label = label
        self.zip = zipfile.ZipFile(path)
        self.unsafe = []
        entries = {}  # the IR path → the zip's own entry name
        for info in self.zip.infolist():
            name = info.filename.replace("\\", "/")  # some Windows zippers write backslashes
            if name.endswith("/") or name.lower().startswith("__macosx/"):
                continue
            clean = safe_relative(name)
            if clean is None:
                self.unsafe.append(info.filename)
            else:
                entries.setdefault(clean, info.filename)
        self.wrapper = pack_wrapper(entries)
        if self.wrapper:
            entries = {name[len(self.wrapper):]: entry for name, entry in entries.items()
                       if name.startswith(self.wrapper)}
        self.entries = entries
        self.names = sorted(entries)
        self.folded = {}  # lower case → the names that are it
        for name in self.names:
            self.folded.setdefault(name.lower(), []).append(name)

    def find(self, name):
        """The entry an IR path names, in any letter case, or None. ValueError
        if several entries differ only in case and none is exactly it."""
        clean = safe_relative(name.replace("\\", "/"))
        if clean is None:
            return None
        if clean in self.entries:
            return clean
        same = self.folded.get(clean.lower(), [])
        if len(same) > 1:
            raise ValueError(f"{name} could be any of {', '.join(same)} (they differ only in case)")
        return same[0] if same else None

    def exists(self, name):
        return self.find(name) is not None

    def read(self, name):
        found = self.find(name)
        if found is None:
            raise ValueError(f"{name} is not in {self.path.name}")
        return self.zip.read(self.entries[found])

    def files_under(self, folder):
        clean = safe_relative(folder.replace("\\", "/"))
        if clean is None:
            return []
        prefix = clean.lower() + "/"
        return [name for name in self.names if name.lower().startswith(prefix)]

    def destination(self, name, namespace, rename=True):
        """Where a file (or folder) of the zip lands in the pack:
        assets/immersiverailroading/models/<rest> → assets/<ns>/<root>/<rest>,
        any other assets/immersiverailroading/<folder>/<rest> (sounds/,
        textures/, …) → assets/<ns>/<root>/<folder>/<rest>; every part made
        a valid resource path (rename=False: as the zip spells it)."""
        parts = name.split("/")
        if len(parts) < 3 or parts[0].lower() != "assets" or parts[1].lower() != IR_NAMESPACE:
            raise ValueError(f"{name} is outside {IR_ROOT}")
        rest = parts[3:] if parts[2].lower() == "models" and len(parts) > 3 else parts[2:]
        return "/".join(["assets", namespace, self.root] + [resource_part(p) if rename else p for p in rest])


def ir_location_to_zip(location):
    """immersiverailroading:models/x/y.obj → assets/immersiverailroading/models/x/y.obj."""
    if not isinstance(location, str):
        raise ValueError(f"{location!r} is not a resource location")
    namespace, _, path = location.partition(":")
    if not path:
        namespace, path = IR_NAMESPACE, location
    return f"assets/{namespace}/{path}"


def parse_obj(raw):
    """mtllib references, object names (floorgen.object_name_of: the rest of the
    o/g line, as the engine reads it), the travel-axis extent of the visible
    model, and every object's bounding box in the engine's model frame
    ({name: [min_x, min_y, min_z, max_x, max_y, max_z]}; floorgen.flat_box_to_obj
    gives it in the OBJ frame)."""
    libraries, objects = [], []
    positions = []
    boxes = {}
    box = None
    min_x, max_x = math.inf, -math.inf
    visible = True
    for line in io.TextIOWrapper(io.BytesIO(raw), encoding="utf-8", errors="replace"):
        name = floorgen.object_name_of(line)
        if line.startswith("v "):
            parts = line.split()
            positions.append((float(parts[1]), float(parts[2]), float(parts[3])))
        elif name is not None:
            objects.append(name)
            visible = "HIDE" not in name
            box = boxes.setdefault(name, [math.inf] * 3 + [-math.inf] * 3)
        elif line.startswith("f "):
            if box is None:  # faces before any o/g line: the engine's default object
                objects.append(floorgen.DEFAULT_OBJECT)
                box = boxes.setdefault(floorgen.DEFAULT_OBJECT, [math.inf] * 3 + [-math.inf] * 3)
            for token in line.split()[1:]:
                index = int(token.split("/")[0])
                x, y, z = positions[index - 1 if index > 0 else len(positions) + index]
                if visible:
                    min_x, max_x = min(min_x, x), max(max_x, x)
                if box is not None:
                    rx, ry, rz = z, y + floorgen.Y_LIFT, -x
                    if rx < box[0]: box[0] = rx
                    if ry < box[1]: box[1] = ry
                    if rz < box[2]: box[2] = rz
                    if rx > box[3]: box[3] = rx
                    if ry > box[4]: box[4] = ry
                    if rz > box[5]: box[5] = rz
        elif line.startswith("mtllib "):
            libraries.append(line[len("mtllib "):].strip())
    boxes = {name: b for name, b in boxes.items() if math.isfinite(b[0])}
    return libraries, objects, (min_x, max_x), boxes


def floor_levels(raw, x_range=(-math.inf, math.inf), z_range=(-math.inf, math.inf), min_area=0.25):
    """Up-facing horizontal surfaces of a model by height, in the OBJ frame (the
    model's own coordinates, as the pack's markup is written):
    [(y, area, [min_x, min_z, max_x, max_z], [objects])], only faces whose
    centre lies in the plan window, levels of at least min_area. A floor is a
    big area at one height; a vestibule a step lower, a cab deck higher."""
    positions = []
    name = floorgen.DEFAULT_OBJECT
    levels = {}
    for line in io.TextIOWrapper(io.BytesIO(raw), encoding="utf-8", errors="replace"):
        named = floorgen.object_name_of(line)
        if line.startswith("v "):
            parts = line.split()
            positions.append((float(parts[1]), float(parts[2]), float(parts[3])))
        elif named is not None:
            name = named
        elif line.startswith("f "):
            corners = []
            for token in line.split()[1:]:
                index = int(token.split("/")[0])
                corners.append(positions[index - 1 if index > 0 else len(positions) + index])
            if len(corners) < 3:
                continue
            nx = ny = nz = 0.0  # Newell: the polygon normal, its length twice the area
            for i, (x0, y0, z0) in enumerate(corners):
                x1, y1, z1 = corners[(i + 1) % len(corners)]
                nx += (y0 - y1) * (z0 + z1)
                ny += (z0 - z1) * (x0 + x1)
                nz += (x0 - x1) * (y0 + y1)
            length = math.sqrt(nx * nx + ny * ny + nz * nz)
            if length < 1e-9 or ny / length < 0.95:
                continue  # not facing up
            cx = sum(c[0] for c in corners) / len(corners)
            cz = sum(c[2] for c in corners) / len(corners)
            if not (x_range[0] <= cx <= x_range[1] and z_range[0] <= cz <= z_range[1]):
                continue
            y = round(sum(c[1] for c in corners) / len(corners), 2)
            level = levels.setdefault(y, [0.0, [math.inf, math.inf, -math.inf, -math.inf], set()])
            level[0] += length / 2.0
            box = level[1]
            for x, _, z in corners:
                box[0], box[1] = min(box[0], x), min(box[1], z)
                box[2], box[3] = max(box[2], x), max(box[3], z)
            level[2].add(name)
    return [(y, r(a, 2), [r(v, 3) for v in box], sorted(objects))
            for y, (a, box, objects) in sorted(levels.items()) if a >= min_area]


def material_name(line, keyword):
    """The material a "newmtl" or "usemtl" line names: everything after the keyword
    and the whitespace behind it, stripped, the spaces inside kept ("usemtl Dark
    Wood" is "Dark Wood"); None if the line isn't a `keyword` line or names
    nothing. Blender reads and writes both keywords so, and the mod does the
    same (MtlParser.materialName, which also reads the OBJ's usemtl): the OBJ and
    the MTL must call a material by one name, or it finds no texture. The converter
    reads only the MTL's names (the OBJ's are for the engine), but the rule is one."""
    parts = line.strip().split(None, 1)
    if len(parts) < 2 or parts[0] != keyword:
        return None
    return parts[1].strip() or None


def parse_mtl(raw):
    """Material → its map_Kd path as the file writes it (relative to the OBJ's folder, SPEC §6.3)."""
    maps = {}
    material = None
    for line in raw.decode("utf-8", errors="replace").splitlines():
        line = line.strip()
        named = material_name(line, "newmtl")
        if named is not None:
            material = named
        elif line.startswith("map_Kd ") and material is not None:
            maps[material] = line[len("map_Kd "):].strip()
    return maps


def join(folder, relative):
    return posixpath.normpath(posixpath.join(folder, relative.replace("\\", "/")))


def relink(folder, written, destination):
    """None if the path `written` (as a model file has it, relative to
    `folder` in the pack) already leads to `destination`; else the path that does."""
    if posixpath.normpath(posixpath.join(folder, written.replace("\\", "/"))) == destination:
        return None
    return posixpath.relpath(destination, folder)


def rewrite_references(raw, keyword, moved):
    """`raw` with the path of every "<keyword> <path>" line that `moved` maps
    (the path as written → the new one) replaced, every other byte as it was;
    None if nothing moves."""
    if not moved:
        return None
    key = keyword.encode("ascii") + b" "
    out = []
    for line in raw.splitlines(keepends=True):
        body = line.rstrip(b"\r\n")
        stripped = body.strip()
        if stripped.startswith(key):
            written = stripped[len(key):].decode("utf-8", errors="replace").strip()
            if written in moved:
                indent = body[:len(body) - len(body.lstrip())]
                line = indent + key + moved[written].encode("utf-8") + line[len(body):]
        out.append(line)
    return b"".join(out)


# ------------------------------------------------------------------ heuristics

def r(value, digits=1):
    return round(value, digits)


def derive_couplers(ir, length, boxes):
    """Where the couplers engage (SPEC §6.12), relative to the RWAT frame ends
    (±length/2), + outward — or None if the IR definition doesn't say. IR
    measures its couplers.front_offset/rear_offset from the bounds of the whole
    model, hidden objects included (a hose hanging off the VL80's rear end);
    the RWAT length is the visible extent, so the coupler point is found in
    IR's terms and re-expressed against the RWAT frame end."""
    couplers = ir.get("couplers")
    if not isinstance(couplers, dict) or not boxes:
        return None
    front_bound = max(box[5] for box in boxes.values())
    rear_bound = -min(box[2] for box in boxes.values())
    half = length / 2.0
    return {"front": r(front_bound + couplers.get("front_offset", 0.0) - half, 3),
            "rear": r(rear_bound + couplers.get("rear_offset", 0.0) - half, 3)}


def derive_type(category, ir, extent, boxes):
    """RWAT physics declaration (SPEC §5.1) from an IR stock definition — only
    what IR actually knows: mass, design speed, power, tractive effort, and
    from its category the brake system. Everything else (running resistance,
    brake forces and timing, handbrake, adhesion) is left to the engine's
    defaults (SPEC §6.4, stock.StockDefaults), so a converted pack plays on
    the same physics as one written by hand. A recipe override can still set
    any field."""
    props = ir.get("properties", {})
    trucks = ir.get("trucks", {})
    mass_t = props.get("weight_kg", 20000) / 1000.0
    powered = category == "locomotives" and "horsepower" in props
    length = r(extent[1] - extent[0], 3)
    declaration = {
        "length": length,
        "bogies": [trucks.get("front", 0.0), trucks.get("rear", 0.0)],
        "mass_t": r(mass_t, 2),
    }
    if "max_speed_kmh" in props:  # no design speed: the wagon limits nothing
        declaration["max_speed_kmh"] = props["max_speed_kmh"]
    if powered:
        mass_kn = mass_t * G_KN_PER_TONNE
        declaration["traction"] = {
            "power_kw": r(props["horsepower"] * HP_TO_KW),
            # IR without a starting effort: what the wheels can grip at a standstill
            "max_tractive_effort_kn": r(props["tractive_effort_lbf"] * LBF_TO_KN
                                        if "tractive_effort_lbf" in props else 0.33 * mass_kn),
        }
        declaration["cab"] = {}
    declaration["brakes"] = {"system": "freight" if category in ("freight", "tank") else "passenger"}
    couplers = derive_couplers(ir, length, boxes)
    if couplers is not None:
        declaration["couplers"] = couplers
    return declaration


HANDBRAKE_LABEL = re.compile(r"_LABEL_hand\^?brake(?:_|$)", re.IGNORECASE)
CONTROL_KEY = re.compile(r"(?:^|_)(WIDGET_\d+)(?=_|$)")


def derive_handbrake(objects):
    """The model's handbrake wheels (SPEC §5.3, §6.3): IR has no handbrake
    control, MVP marks the wheel as a WIDGET labelled "Hand Brake" — its
    control key ("WIDGET_5") goes to the model declaration's "handbrake",
    and the mod turns the wagon's handbrake with it."""
    keys = set()
    for raw in objects:
        name = object_name(raw)
        if HANDBRAKE_LABEL.search(name):
            key = CONTROL_KEY.search(name)
            if key:
                keys.add(key.group(1))
    return sorted(keys)


def derive_interior(category, ir):
    """A passenger car's walkable floor (SPEC §9.6): IR's "passenger" area —
    centre_x along the car, length = HALF the length, width = the full width,
    centre_y just under the floor — as one RWAT floor zone, in the OBJ frame
    (worked out in the model frame, rounded there); None otherwise (locomotive
    cabs need a driver's chair as well: hand-made)."""
    area = ir.get("passenger")
    if category != "passenger" or not isinstance(area, dict):
        return None
    half_length = area.get("length", 0.0)
    width = area.get("width", 0.0)
    if half_length <= 0.0 or width <= 0.0:
        return None
    centre_z = -area.get("center_x", 0.0)
    floor = area.get("center_y", 0.0) + IR_FLOOR_OFFSET
    return floorgen.box_to_obj({"min": [r(-width / 2, 3), r(floor, 3), r(centre_z - half_length, 3)],
                                "max": [r(width / 2, 3), r(floor + ZONE_HEIGHT, 3), r(centre_z + half_length, 3)]})


def object_name(name):
    """An object name as the convention reads it: without Blender's .001."""
    return COPY_SUFFIX.sub("", name)


def control_group(names):
    """The CG_<name> of a set of objects, or None (a flag word isn't a group)."""
    for name in names:
        m = CONTROL_GROUP.search(object_name(name))
        if m and m.group(1) not in FLAG_WORDS:
            return m.group(1)
    return None


def utf16_length(text):
    """Java's String.length(): UTF-16 code units, two for a character beyond the BMP."""
    return len(text.encode("utf-16-le")) // 2


def groups_too_long(names):
    """The group names the engine drops as the model loads (GroupName.tooLong), each once, in the
    order the objects come: a switch's _CG_<name> (a control kind in GROUP_KINDS) and a light's
    _LCG_<name> longer than MAX_GROUP_LENGTH. Read as the engine reads an object: without the copy
    suffix. One simplification: an object that also matches an earlier control kind (a gauge, a
    handle lever) is taken for a switch here, as no model names one so."""
    found = {}
    for raw in names:
        name = object_name(raw)
        cg, lcg = CONTROL_GROUP.search(name), LIGHT_GROUP.search(name)
        if cg and GROUP_KINDS.search(name) and utf16_length(cg.group(1)) > MAX_GROUP_LENGTH:
            found[cg.group(1)] = None
        if lcg and utf16_length(lcg.group(1)) > MAX_GROUP_LENGTH:
            found[lcg.group(1)] = None
    return list(found)


def door_groups(boxes):
    """{n: {"box": merged box, "names": [objects]}} for every DOOR_<n> (DOOR_<n>.001 too)."""
    groups = {}
    for name, box in boxes.items():
        key = DOOR_KEY.search(object_name(name))
        if key is None:
            continue
        group = groups.setdefault(int(key.group(1)), {"box": list(box), "names": []})
        group["names"].append(name)
        merged = group["box"]
        for i in range(3):
            merged[i] = min(merged[i], box[i])
            merged[i + 3] = max(merged[i + 3], box[i + 3])
    return groups


def door_axis(box):
    """The wall normal of a door box as RWAT reads it: 0 = X (side), 2 = Z (end)."""
    return 0 if box[3] - box[0] <= box[5] - box[2] else 2


def one_doorway(a, b):
    """True if two leaves are the two halves of one doorway: same kind and
    group, in the same wall, meeting along it."""
    if a["kind"] != b["kind"] or a["group"] != b["group"]:
        return False
    axis = door_axis(a["box"])
    if axis != door_axis(b["box"]):
        return False
    span = 2 if axis == 0 else 0
    ba, bb = a["box"], b["box"]
    same_wall = min(ba[axis + 3], bb[axis + 3]) >= max(ba[axis], bb[axis])
    meet = min(ba[span + 3], bb[span + 3]) >= max(ba[span], bb[span]) - LEAF_GAP
    level = min(ba[4], bb[4]) >= max(ba[1], bb[1])
    return same_wall and meet and level


def derive_doors(boxes):
    """The model's doors (SPEC §9.6): every DOOR_<n> object group as a RWAT
    door — EXTERNAL a way in and out, CONNECTING an end door onto the gangway,
    anything else (IR's INTERNAL) a door between floor zones ("inner") — the
    group's bounding box (in the model frame, as `boxes`; model_doors gives
    them to the pack), id = its control group (CG_<name>, so the IR
    animation of that group swings it), else door_<n>. The leaves of one
    doorway (ER2's sliding pairs, one CG) make one door; markers and handles
    too small for a doorway are left out. Doorways on one control group get
    it as their "group": they open together, as in IR (one animation may
    swing them all). In DOOR_<n> order, so a model's doors keep their
    indices (the open state in saves is keyed by them)."""
    groups = door_groups(boxes)
    leaves = []
    for number in sorted(groups):
        names = groups[number]["names"]
        tokens = {token for name in names for token in object_name(name).split("_")}
        kind = "connecting" if "CONNECTING" in tokens else "external" if "EXTERNAL" in tokens else "inner"
        box = groups[number]["box"]
        span = box[5] - box[2] if door_axis(box) == 0 else box[3] - box[0]
        if box[4] - box[1] < MIN_DOOR_HEIGHT or span < MIN_DOOR_SPAN:
            continue
        leaves.append({"number": number, "kind": kind, "group": control_group(names), "box": list(box)})
    doorways = []
    for leaf in leaves:
        home = next((d for d in doorways if any(one_doorway(leaf, other) for other in d)), None)
        if home is None:
            doorways.append([leaf])
        else:
            home.append(leaf)
    shared = {}  # control group → how many doorways it works
    for doorway in doorways:
        if doorway[0]["group"] is not None:
            shared[doorway[0]["group"]] = shared.get(doorway[0]["group"], 0) + 1
    doors, ids = [], set()
    for doorway in doorways:
        first = doorway[0]
        box = list(first["box"])
        for leaf in doorway[1:]:
            for i in range(3):
                box[i] = min(box[i], leaf["box"][i])
                box[i + 3] = max(box[i + 3], leaf["box"][i + 3])
        door_id = first["group"] or f"door_{first['number']}"
        if door_id.lower() in ids:
            door_id = f"{door_id}_{first['number']}"  # IR opens doors of one group together
        ids.add(door_id.lower())
        door = {"id": door_id, "min": [r(v, 3) for v in box[:3]], "max": [r(v, 3) for v in box[3:]]}
        if first["kind"] == "connecting":
            door["connecting"] = True
        elif first["kind"] == "inner":
            door["inner"] = True
        if shared.get(first["group"], 0) > 1:
            door["group"] = first["group"]  # IR works a control group's doors together
        doors.append(door)
    return doors


def widget_doors(boxes, animated):
    """Inner doors that are control widgets (SPEC §9.8): a WIDGET_<n> of door
    size and thin like a leaf, flagged TOGGLE, whose control group CG_<name>
    has an IR animation (`animated`, lower-case group names) — the platzkart's
    DoorTambur, DoorToilet and DoorKupe; in the model frame, as derive_doors.
    The door is the box of everything
    named WIDGET_<n> (handles included, as DOOR_<n>'s is), id = the group,
    "inner": true. In WIDGET_<n> order. A leaf that is HIDE-flagged or on a
    group with no animation (the ChME3's cable, a light switch) is no door."""
    groups = {}
    for name, box in boxes.items():
        key = WIDGET_KEY.search(object_name(name))
        if key is None:
            continue
        group = groups.setdefault(int(key.group(1)), {"box": list(box), "names": []})
        group["names"].append(name)
        for i in range(3):
            group["box"][i] = min(group["box"][i], box[i])
            group["box"][i + 3] = max(group["box"][i + 3], box[i + 3])
    doors = []
    for number in sorted(groups):
        names = [object_name(n) for n in groups[number]["names"]]
        leaf = [n for n in names if "TOGGLE" in n.split("_") and "HIDE" not in n.split("_")]
        group = control_group(leaf)
        if group is None or group.lower() not in animated:
            continue
        box = groups[number]["box"]
        thin = min(box[3] - box[0], box[5] - box[2])
        span = max(box[3] - box[0], box[5] - box[2])
        if box[4] - box[1] < MIN_DOOR_HEIGHT or thin > MAX_WIDGET_THICKNESS or span < MIN_DOOR_SPAN:
            continue
        doors.append({"id": group, "min": [r(v, 3) for v in box[:3]], "max": [r(v, 3) for v in box[3:]],
                      "inner": True})
    return doors


def model_doors(boxes, animated):
    """Every door the model carries, as the pack writes it (OBJ frame): its
    DOOR_<n> doorways, then its WIDGET doors (an id the DOOR_<n> doors already
    use is left to them). Found in the model frame of `boxes` (parse_obj) and
    rounded there, so the boxes are the engine's to the last digit."""
    doors = derive_doors(boxes)
    taken = {d["id"].lower() for d in doors}
    for door in widget_doors(boxes, animated):
        if door["id"].lower() not in taken:
            doors.append(door)
            taken.add(door["id"].lower())
    return [floorgen.box_to_obj(door) for door in doors]


def animated_groups(source, ir):
    """The control groups (lower case) of an IR definition's animations whose .anim the source has."""
    return {a.get("control_group", "").lower() for a in ir.get("animations", [])
            if source.exists(ir_location_to_zip(a["animatrix"]))}


def edit_doors(doors, edits, warn):
    """A per-type "doors" object over the derived doors (SPEC §9.8): each key
    is a door id (any case) — an object edits that door (deep-merged, so
    "inner": null drops a flag) or adds it at the end, null removes it. The
    others stay as derived, in their order; a list in the per-type file
    replaces the derived doors instead."""
    out = [dict(door) for door in doors]
    for door_id, edit in edits.items():
        if edit is not None and not isinstance(edit, dict):
            raise ValueError(f"\"doors\".{door_id} must be an object or null, not {edit!r}")
        at = next((i for i, door in enumerate(out) if door["id"].lower() == door_id.lower()), None)
        if edit is None:
            if at is None:
                warn(f"\"doors\" removes {door_id}, which isn't a derived door")
            else:
                out.pop(at)
        elif at is None:
            out.append(deep_merge({"id": door_id}, edit))
        else:
            out[at] = deep_merge(out[at], edit)
    return out


def door_motion(boxes, animations):
    """How each DOOR_<n>'s leaf moves in RWAT (SPEC §9.5): "anim" (an IR
    .anim of its control group — only if the type declares a door of that
    id), "rot" / "slide" (DOOR_<n>_ROT_<deg> / TL_<f>_<axis>: moved by name,
    with the door whose box holds it), or "none" (drawn shut whatever its
    door's state)."""
    motion = {}
    groups = door_groups(boxes)
    for number in sorted(groups):
        names = [object_name(n) for n in groups[number]["names"]]
        group = control_group(names)
        if group is not None and group.lower() in animations:
            how = "anim"
        elif any(f"DOOR_{number}_ROT" in n for n in names):
            how = "rot"
        elif any(re.search(r"TL_[^_]*_[XYZ]", n) for n in names):
            how = "slide"
        else:
            how = "none"
        motion[f"DOOR_{number}"] = {"group": group, "moves": how}
    return motion


def light_groups(boxes):
    """The model's light groups (SPEC §8), from the object names: the objects
    that glow (FULLBRIGHT), its headlights, how many inside parts it lights
    (INTERIOR) and the cab switches that work it (CG_<group>, with labels)."""
    labels = {}
    for raw in boxes:
        name = object_name(raw)
        key, label = SWITCH_KEY.search(name), LABEL.search(name)
        if key and label and label.group(1).strip("^"):
            labels[key.group(1)] = label.group(1).replace("^", " ")
    lights = {}
    for raw in sorted(boxes):
        name = object_name(raw)
        lcg = LIGHT_GROUP.search(name)
        if lcg is None:
            continue
        group = lights.setdefault(lcg.group(1), {"glowing": [], "headlights": [], "inside_parts": 0,
                                                 "switches": []})
        tokens = name.split("_")
        if HEADLIGHT.search(name):
            group["headlights"].append(raw)
        elif "FULLBRIGHT" in tokens:
            group["glowing"].append(raw)
        if "INTERIOR" in tokens:
            group["inside_parts"] += 1
    for raw in sorted(boxes):
        # a lamp that is a switch's own glowing part lights with that switch's group
        # (the ChME3's tail lamps: WIDGET_17_HIDE_INVERT_FULLBRIGHT_CG_FEL)
        name = object_name(raw)
        key, cg = SWITCH_KEY.search(name), CONTROL_GROUP.search(name)
        if key and cg and "FULLBRIGHT" in name.split("_") and not LIGHT_GROUP.search(name):
            group = lights.setdefault(cg.group(1), {"glowing": [], "headlights": [], "inside_parts": 0,
                                                    "switches": []})
            group["glowing"].append(raw)
    for raw in sorted(boxes):
        name = object_name(raw)
        key, cg = SWITCH_KEY.search(name), CONTROL_GROUP.search(name)
        if key and cg and cg.group(1) in lights:
            switch = {"control": key.group(1), "label": labels.get(key.group(1))}
            if switch not in lights[cg.group(1)]["switches"]:
                lights[cg.group(1)]["switches"].append(switch)
    return dict(sorted(lights.items()))


def anim_objects(raw):
    """The objects an IR .anim moves (its "O <name>" lines), each once, in order: read as
    the engine reads them (IrAnim.parse: the line stripped of blanks, the name the rest after
    "O ", stripped too; an object named again goes on with the same track)."""
    text = raw.decode("utf-8", errors="replace")
    names = []
    for line in text.splitlines():
        line = line.strip(floorgen.BLANKS)
        if line.startswith("O "):
            name = line[2:].strip(floorgen.BLANKS)
            if name not in names:
                names.append(name)
    return names


def deep_merge(base, override):
    """override onto base; a None value deletes the key. An object base
    doesn't have is taken as it is, Nones and all (a "doors" object still
    needs its {"<id>": null} when edit_doors reads it)."""
    merged = dict(base)
    for key, value in override.items():
        if value is None:
            merged.pop(key, None)
        elif isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def layer(base, top):
    """One override over another (the per-type file over the recipe's own):
    objects merge, anything else in top wins — a None too, so it still
    removes the field from what the converter generates."""
    merged = dict(base)
    for key, value in top.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = layer(merged[key], value)
        else:
            merged[key] = value
    return merged


def sanitize_id(name):
    return re.sub(r"[^a-z0-9_.\-]", "_", name.lower())


# ------------------------------------------------------------------- recipe

def without_comments(value):
    """value with every key that starts with _ dropped, at any depth: in the
    recipe and the per-type files such a key ("_comment", "_why") is a note
    to the reader, never read and never written to the pack."""
    if isinstance(value, dict):
        return {key: without_comments(item) for key, item in value.items() if not key.startswith("_")}
    if isinstance(value, list):
        return [without_comments(item) for item in value]
    return value


def read_json_file(path, what):
    """A JSON object from a file of the author's (recipe, per-type file), its
    comment keys dropped (without_comments); a refusal if it isn't one."""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError as problem:
        raise ConversionError(f"cannot read {what} {path}: {problem.strerror or problem}")
    except UnicodeDecodeError as problem:
        raise ConversionError(f"{path}: not UTF-8 text ({problem.reason})")
    try:
        value = json.loads(text)
    except json.JSONDecodeError as problem:
        raise ConversionError(f"{path}: not valid JSON — {problem.msg} at line {problem.lineno}, "
                              f"column {problem.colno}")
    if not isinstance(value, dict):
        raise ConversionError(f"{path}: {what} must be a JSON object")
    return without_comments(value)


def check_recipe(recipe, name):
    """Refuse a recipe the converter can't follow, naming the field."""
    for key in ("namespace", "pack_dir", "sources"):
        if key not in recipe:
            raise ConversionError(f"{name}: no \"{key}\"")
    if not isinstance(recipe["namespace"], str) or not NAMESPACE.match(recipe["namespace"]):
        raise ConversionError(f"{name}: \"namespace\" must be a Minecraft namespace (a-z 0-9 _ . -), "
                              f"not {recipe['namespace']!r}")
    pack_dir = recipe["pack_dir"]
    if not isinstance(pack_dir, str) or pack_dir in ("", ".", "..") or re.search(r"[/\\:]", pack_dir):
        raise ConversionError(f"{name}: \"pack_dir\" must be a folder name, not {pack_dir!r}")
    kinds = {str: "a string", list: "a list", dict: "an object"}
    fields = {"authors": list, "copy_root_files": list, "description": str, "exclude": list,
              "id_strip_prefix": str, "license": str, "name": str, "out": str, "overrides": dict,
              "overrides_dir": str, "rail_exclude": list, "rail_overrides": dict, "sound_defaults": dict,
              "sources": list, "version": str}
    for key, kind in fields.items():
        if key in recipe and not isinstance(recipe[key], kind):
            raise ConversionError(f"{name}: \"{key}\" must be {kinds[kind]}")
    for key in ("authors", "copy_root_files", "exclude", "rail_exclude"):
        for item in recipe.get(key, []):
            if not isinstance(item, str):
                raise ConversionError(f"{name}: \"{key}\" must list strings, not {item!r}")
    for key in ("overrides", "rail_overrides"):
        for item, value in recipe.get(key, {}).items():
            if not isinstance(value, dict):
                raise ConversionError(f"{name}: \"{key}\".{item} must be an object")
    for extra in recipe.get("copy_root_files", []):
        if safe_relative(extra) != extra or extra in ("pack.mcmeta", MARKER) or extra.split("/")[0] in ("assets", "data"):
            raise ConversionError(f"{name}: \"copy_root_files\" can't name {extra!r}: a file at the pack's top, "
                                  f"not pack.mcmeta, {MARKER}, assets/ or data/")
    if not recipe["sources"]:
        raise ConversionError(f"{name}: \"sources\" is empty")
    roots = {}
    for index, spec in enumerate(recipe["sources"]):
        where = f"{name}: sources[{index}]"
        if not isinstance(spec, dict):
            raise ConversionError(f"{where} must be an object")
        for key in ("zip", "root"):
            if not isinstance(spec.get(key), str) or not spec[key]:
                raise ConversionError(f"{where} needs \"{key}\" (a string)")
        if "label" in spec and not isinstance(spec["label"], str):
            raise ConversionError(f"{where}.label must be a string")
        root = spec["root"]
        if safe_relative(root) != root or not VALID_PATH.match(root) or root.split("/")[0] in GENERATED_FOLDERS:
            raise ConversionError(f"{where}.root must be a folder path of a-z 0-9 _ . - (not "
                                  f"{', '.join(GENERATED_FOLDERS)}), not {root!r}")
        if root in roots:
            raise ConversionError(f"{where}.root {root!r} is sources[{roots[root]}]'s too: each source needs "
                                  f"its own, or their files overwrite each other")
        roots[root] = index


def open_source(base, index, spec, name):
    path = base / spec["zip"]
    try:
        return Source(path, spec["root"], spec.get("label", spec["zip"]))
    except FileNotFoundError:
        raise ConversionError(f"{name}: sources[{index}].zip: no file {path}")
    except (zipfile.BadZipFile, OSError) as problem:
        raise ConversionError(f"{name}: sources[{index}].zip {path}: not a readable zip ({problem})")


def closest(word, known):
    match = difflib.get_close_matches(word, list(known), n=1)
    return f" — did you mean \"{match[0]}\"?" if match else ""


def is_digest(path):
    """True if the file is a geometry digest (--geometry may overwrite it)."""
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return isinstance(value, dict) and "tools/ir2rwat.py --geometry" in str(value.get("_about", ""))


def same_folder(a, b):
    try:
        return a.resolve() == b.resolve() or (a.exists() and b.exists() and os.path.samefile(a, b))
    except OSError:
        return False


# ------------------------------------------------------------------- convert

class Converter:

    def __init__(self, recipe_path, geometry=None):
        self.geometry = geometry  # folder for the per-type geometry digests, or None
        self.recipe_path = Path(recipe_path).resolve()
        self.warnings = []
        self.errors = []
        name = self.recipe_path.name
        self.recipe = read_json_file(self.recipe_path, "the recipe")
        check_recipe(self.recipe, name)
        self.check_keys(self.recipe, RECIPE_KEYS, name)
        base = self.recipe_path.parent
        self.namespace = self.recipe["namespace"]
        self.strip = self.recipe.get("id_strip_prefix", "")
        self.exclude = set(self.recipe.get("exclude", []))
        self.overrides = {}
        self.override_origin = {}  # type id → where its override was written (for messages)
        for type_id, inline in self.recipe.get("overrides", {}).items():
            self.check_override(inline, f"{name}: \"overrides\".{type_id}")
            self.overrides[type_id] = inline
            self.override_origin[type_id] = f"{name}: \"overrides\".{type_id}"
        self.overrides_path = None
        if "overrides_dir" in self.recipe:
            folder = base / self.recipe["overrides_dir"]
            if folder.is_dir():
                self.overrides_path = folder.resolve()
                for path in sorted(folder.glob("*.json")):
                    per_type = read_json_file(path, "the per-type file")
                    self.check_override(per_type, str(path))
                    self.overrides[path.stem] = layer(self.overrides.get(path.stem, {}), per_type)
                    self.override_origin[path.stem] = str(path)
            else:
                self.warn(f"{name}: \"overrides_dir\" {self.recipe['overrides_dir']!r} ({folder.resolve()}) "
                          f"is not a folder: no per-type files read")
        self.rail_exclude = set(self.recipe.get("rail_exclude", []))
        self.rail_overrides = self.recipe.get("rail_overrides", {})
        self.sources = []
        self.check_keys(self.recipe.get("sound_defaults", {}), SOUND_DEFAULTS_KEYS, f"{name}: \"sound_defaults\"")
        for index, spec in enumerate(self.recipe["sources"]):
            self.check_keys(spec, SOURCE_KEYS, f"{name}: sources[{index}]")
            self.sources.append(open_source(base, index, spec, name))
        for source in self.sources:
            if source.unsafe:
                self.warn(f"{source.path.name}: {len(source.unsafe)} entr{'y' if len(source.unsafe) == 1 else 'ies'}"
                          f" with an absolute path or a \"..\" never read: {', '.join(source.unsafe[:3])}"
                          f"{' …' if len(source.unsafe) > 3 else ''}")
            if source.wrapper:
                print(f"{source.path.name}: the IR pack sits in {source.wrapper}, read from there")
        self.files = {}      # destination path → Asset
        self.generated = {}  # destination path → bytes
        self.digests = {}    # type id → its geometry digest (bytes), written after the pack
        self.langs = {"en_us": {}}  # language → key → text
        self.stock = []      # (id, source label, category, name)
        self.rails = []      # (id, source label, name)
        self.found_stock = 0  # IR stock definitions in the sources

    def warn(self, message):
        self.warnings.append(message)
        print("  WARNING:", message)

    def error(self, message):
        self.errors.append(message)
        print("  ERROR:", message)

    def check_keys(self, value, known, where):
        for key in value:
            if key not in known:
                hint = closest(key, known) or f" (known: {', '.join(known)})"
                self.warn(f"{where}: unknown key \"{key}\", ignored{hint}")

    def check_override(self, value, where):
        """A per-type override (file or inline): a refusal if its shape is wrong, warnings for unknown keys."""
        if not isinstance(value, dict):
            raise ConversionError(f"{where} must be a JSON object")
        self.check_keys(value, OVERRIDE_KEYS, where)
        for key in ("type", "model", "name", "lights"):
            if value.get(key) is not None and not isinstance(value[key], dict):
                raise ConversionError(f"{where}: \"{key}\" must be an object")
        floor = value.get("floor")
        if not (floor is None or floor is False or isinstance(floor, dict)):
            raise ConversionError(f"{where}: \"floor\" must be an object or false")

    def copy(self, source, name, data=None):
        """Put a file of a source zip in the pack (data: its rewritten bytes, None: as it is);
        returns its path in the pack."""
        destination = source.destination(name, self.namespace)
        renamed = destination != source.destination(name, self.namespace, rename=False)
        asset = self.files.get(destination)
        if asset is None:
            self.files[destination] = Asset(source, name, data, renamed)
        elif asset.source is not source or asset.name != name:
            raise AssetCollision(f"{asset.name} and {name} would both be {destination} in the pack")
        elif asset.data != data:
            raise AssetCollision(f"{name} is shared by models in different folders, and its paths would "
                                 f"have to be rewritten differently for each")
        return destination

    def model_location(self, destination):
        """assets/<ns>/<path> → <path> (the declaring pack's namespace is implied)."""
        prefix = f"assets/{self.namespace}/"
        return destination[len(prefix):]

    def id_of(self, stem):
        """The RWAT id of an IR definition's file name: the recipe's prefix off, then sanitize_id."""
        if self.strip and stem.lower().startswith(self.strip.lower()):
            stem = stem[len(self.strip):]
        return sanitize_id(stem)

    def stock_candidates(self):
        """Every IR stock definition in the sources (rolling_stock/<category>/<id>.json), in conversion order."""
        found = []
        for source in self.sources:
            for entry in source.names:
                low = entry.lower()
                if not (low.startswith(IR_STOCK) and low.endswith(".json")):
                    continue
                rest = entry[len(IR_STOCK):]
                if "/" not in rest:
                    continue  # rolling_stock/stock.json: the category index
                category, file_name = rest.split("/", 1)
                found.append(Candidate(source, entry, category.lower(), self.id_of(file_name[:-len(".json")])))
        return found

    def rail_candidates(self):
        """Every IR track definition in the sources (track/<id>.json), in conversion order."""
        found = []
        for source in self.sources:
            for entry in source.names:
                low = entry.lower()
                if not (low.startswith(IR_TRACK) and low.endswith(".json")):
                    continue
                stem = entry[len(IR_TRACK):-len(".json")]
                if "/" in stem or stem.lower() == "track":
                    continue  # track/track.json: the index
                found.append(Candidate(source, entry, None, self.id_of(stem)))
        return found

    def refused(self, candidate, candidates):
        """True (and an error, once) if the candidate can't be converted for its id:
        empty, or shared with another definition of the same source."""
        if not candidate.id:
            self.error(f"{candidate.entry}: skipped — its id is empty")
            return True
        twins = [c.entry for c in candidates if c.source is candidate.source and c.id == candidate.id]
        if len(twins) > 1:
            if twins[0] == candidate.entry:
                self.error(f"{', '.join(twins)}: skipped — they all convert to the id '{candidate.id}' "
                           f"(lower case, other characters _)")
            return True
        return False

    def attempt(self, entry, work):
        """Run one type's or rail style's conversion; on any failure take back what
        it added, report it and go on with the others."""
        saved = (dict(self.files), dict(self.generated), {lang: dict(t) for lang, t in self.langs.items()},
                 dict(self.digests))
        try:
            work()
            return True
        except Exception as problem:  # one broken type never stops the run
            self.files, self.generated, self.langs, self.digests = saved
            self.error(f"{entry}: skipped — {describe(problem)}")
            return False

    def check_ids(self, stock, rails):
        """Warn about recipe entries for ids the packs don't have (a typo loses hand-made data)."""
        stock_ids = {c.id for c in stock}
        rail_ids = {c.id for c in rails}
        for type_id in sorted(self.overrides):
            if type_id not in stock_ids:
                self.warn(f"{self.override_origin[type_id]}: no stock type '{type_id}' in the packs, "
                          f"not used{closest(type_id, stock_ids)}")
        for type_id in sorted(self.exclude - stock_ids):
            self.warn(f"\"exclude\": no stock type '{type_id}' in the packs{closest(type_id, stock_ids)}")
        for rail_id in sorted(self.rail_exclude - rail_ids):
            self.warn(f"\"rail_exclude\": no track '{rail_id}' in the packs{closest(rail_id, rail_ids)}")
        for rail_id in sorted(set(self.rail_overrides) - rail_ids):
            self.warn(f"\"rail_overrides\": no track '{rail_id}' in the packs, not used{closest(rail_id, rail_ids)}")

    def convert(self):
        stock = self.stock_candidates()
        rails = self.rail_candidates()
        self.found_stock = len(stock)
        self.check_ids(stock, rails)
        seen = set()
        for source in self.sources:
            print(f"Source {source.label} ({source.path.name}) -> {source.root}/")
            for c in stock:
                if c.source is not source or c.id in seen or c.id in self.exclude or self.refused(c, stock):
                    continue
                if self.attempt(c.entry, lambda: self.convert_stock(c.source, c.category, c.entry, c.id)):
                    seen.add(c.id)
        seen_rails = set()
        for c in rails:
            if c.id in seen_rails or c.id in self.rail_exclude or self.refused(c, rails):
                continue
            if self.attempt(c.entry, lambda: self.convert_track(c.source, c.entry, c.id)):
                seen_rails.add(c.id)

    def copy_model(self, source, obj_zip, label):
        """Copy an OBJ with its MTLs and their textures — the paths in them
        rewritten only where a renamed file or the new layout breaks one;
        returns (its entry, destination, objects, extent, boxes)."""
        obj_name = source.find(obj_zip)
        if obj_name is None:
            raise ValueError(f"model {obj_zip} not in the pack")
        raw = source.read(obj_name)
        libraries, objects, extent, boxes = parse_obj(raw)
        if not math.isfinite(extent[0]):
            raise ValueError("model has no visible geometry")
        obj_folder = posixpath.dirname(obj_name)
        obj_destination = source.destination(obj_name, self.namespace)
        here = posixpath.dirname(obj_destination)  # the engine reads both kinds of path from the OBJ's folder
        libraries_moved = {}
        for library in libraries:
            mtl_name = source.find(join(obj_folder, library))
            if mtl_name is None:
                self.warn(f"{label}: material library {join(obj_folder, library)} missing")
                continue
            mtl_raw = source.read(mtl_name)
            textures_moved = {}
            for material, texture in parse_mtl(mtl_raw).items():
                texture_name = source.find(join(obj_folder, texture))
                if texture_name is None:
                    self.warn(f"{label}: material {material} texture {join(obj_folder, texture)} missing")
                    continue
                moved = relink(here, texture, self.copy(source, texture_name))
                if moved is not None:
                    textures_moved[texture] = moved
            mtl_destination = self.copy(source, mtl_name, rewrite_references(mtl_raw, "map_Kd", textures_moved))
            moved = relink(here, library, mtl_destination)
            if moved is not None:
                libraries_moved[library] = moved
        self.copy(source, obj_name, rewrite_references(raw, "mtllib", libraries_moved))
        return obj_name, obj_destination, objects, extent, boxes

    def convert_track(self, source, entry, rail_id):
        """An IR track type → an RWAT rail style: the tile OBJ as is, swept by the renderer."""
        ir = lenient_json(source.read(entry))
        models = ir.get("models", {})
        if not isinstance(models, dict) or not models:
            raise ValueError("no models")
        # IR keys models by gauge condition (">0.2"); RWAT has one gauge: take the first
        obj_zip = ir_location_to_zip(next(iter(models.values())))
        _, obj_destination, objects, extent, _ = self.copy_model(source, obj_zip, rail_id)
        if not any(o.upper().startswith("RAIL_") for o in objects):
            raise ValueError("no RAIL_* objects, not a track tile")
        model_json = deep_merge({"obj": self.model_location(obj_destination)},
                                self.rail_overrides.get(rail_id, {}))
        self.generated[f"assets/{self.namespace}/rail_models/{rail_id}.json"] = dump(model_json)
        name = ir.get("name", rail_id)
        self.langs["en_us"][f"rail.{self.namespace}.{rail_id}"] = name
        self.rails.append((rail_id, source.label, name))
        print(f"  rail {self.namespace}:{rail_id:23} tile {model_json.get('tile_length', 1.0):5.3f}  {name}")

    def find_stock(self, type_id):
        """(source, category, zip entry) of a stock type, by the id it converts to."""
        candidates = self.stock_candidates()
        for c in candidates:
            if c.id == type_id:
                twins = [o.entry for o in candidates if o.source is c.source and o.id == type_id]
                if len(twins) > 1:
                    raise ValueError(f"'{type_id}' is ambiguous: {', '.join(twins)} all convert to it")
                return c.source, c.category, c.entry
        raise ValueError(f"no stock type '{type_id}' in the recipe's packs"
                         f"{closest(type_id, {c.id for c in candidates})}")

    def plan(self, type_id, force_floor=False, floor_override=None):
        """What the converter would write for a type, without copying anything
        (tools/floorgen.py looks at it): see prepare."""
        source, category, entry = self.find_stock(type_id)
        return self.prepare(source, category, entry, type_id, force_floor, floor_override)

    def door_plan(self, source, ir, boxes, type_json, type_id):
        """(the doors the model carries, the doors the type gets) — DOOR_<n>
        and WIDGET doors, then the per-type file's "doors": a list replaces
        them, an object edits them by id (and is taken out of type_json).
        All in the OBJ frame, as the pack and the per-type file are. The one
        place both the converter and tools/objinfo.py --doors read the doors
        from."""
        in_model = model_doors(boxes, animated_groups(source, ir))
        edits = type_json.pop("doors") if isinstance(type_json.get("doors"), dict) else None
        if isinstance(type_json.get("doors"), list):
            doors = type_json["doors"]
        else:
            doors = edit_doors(in_model, edits or {}, lambda m: self.warn(f"{type_id}: {m}"))
        return in_model, doors

    def derived(self, type_id):
        """What the converter derives for a stock type before any override — the layer
        an override lands on (editor/src/ir/recipe/merge.ts `Derived`, golden
        recipe_merge): the IR category and name, the type from IR's definition
        (derive_type), the doors the model carries (model_doors), IR's passenger area
        (derive_interior), the model declaration with every door animation and door
        sound of the definition (model_declaration; convert_stock keeps those of the
        doors the type ends up with), the model's light groups. Its files are copied as
        convert_stock copies them."""
        source, category, entry = self.find_stock(type_id)
        ir = lenient_json(source.read(entry))
        obj_name, obj_destination, _, extent, boxes = self.copy_model(source, ir_location_to_zip(ir["model"]), type_id)
        model, _, _ = self.model_declaration(source, category, ir, obj_name, obj_destination, boxes, None, type_id)
        return {"category": category, "name": ir.get("name", type_id), "type": derive_type(category, ir, extent, boxes),
                "doors": model_doors(boxes, animated_groups(source, ir)), "interior": derive_interior(category, ir),
                "model": model, "lights": list(light_groups(boxes))}

    def doors_of(self, type_id):
        """(the doors the model carries, the doors the type gets) of a stock type, as the converter derives them."""
        source, _, entry = self.find_stock(type_id)
        ir = lenient_json(source.read(entry))
        _, _, _, boxes = parse_obj(source.read(ir_location_to_zip(ir["model"])))
        type_json = deep_merge({}, self.overrides.get(type_id, {}).get("type") or {})
        return self.door_plan(source, ir, boxes, type_json, type_id)

    def prepare(self, source, category, entry, type_id, force_floor=False, floor_override=None, parsed=None):
        """The type declaration with its walkable floor and doors (SPEC §9.6,
        §9.8): physics from IR, then the per-type file's "type" over it; the
        floor generated by tools/floorgen.py for a passenger car (and a
        locomotive whose per-type file has a "floor" key) unless the file's
        own "type.interior" replaces it; the doors the model carries (DOOR_<n>
        and WIDGET doors) edited by the file's "doors" — a list replaces them.
        Returns a dict (type_json, doors = the doors the floor was made for,
        floor = floorgen.Floor or None, floor_problem = why there is none,
        hand_interior = the file's own, ...); every zone, door and chair in
        it is in the OBJ frame, as the pack is (boxes: the model frame)."""
        ir = lenient_json(source.read(entry))
        obj_zip = ir_location_to_zip(ir["model"])
        if parsed is None:
            _, _, extent, boxes = parse_obj(source.read(obj_zip))
        else:
            extent, boxes = parsed
        overrides = self.overrides.get(type_id, {})
        type_json = deep_merge(derive_type(category, ir, extent, boxes), overrides.get("type") or {})
        in_model, doors = self.door_plan(source, ir, boxes, type_json, type_id)
        hand_interior = type_json.get("interior")

        floor_options = overrides.get("floor")
        generated, floor_problem = None, None
        if floor_options is False:
            floor_problem = "\"floor\": false in its per-type file"
        elif force_floor or floor_options is not None or category == "passenger":
            options = dict(floor_options or {})
            options.update(floor_override or {})
            area = ir.get("passenger")
            ir_floor = (area.get("center_y", 0.0) + IR_FLOOR_OFFSET - floorgen.Y_LIFT  # OBJ y
                        if isinstance(area, dict) and category == "passenger" else None)
            try:
                config = floorgen.FloorConfig(options)
            except floorgen.FloorConfigError as problem:
                floor_problem = str(problem)
                self.error(f"{type_id}: no generated floor — {problem} (the per-type file's \"floor\" isn't "
                           f"valid: the floor is IR's passenger area instead)")
            else:
                try:
                    generated = floorgen.generate(source.read(obj_zip), config, doors, ir_floor)
                except Exception as problem:  # a model the generator can't read keeps the IR floor
                    floor_problem = describe(problem)
                    self.warn(f"{type_id}: no generated floor — {floor_problem}")
        else:
            floor_problem = "the generator runs for passenger cars and types whose per-type file has \"floor\""
        # walkable cars from the IR conventions (SPEC §9.6, §9.8), unless the file's own says otherwise
        derived = generated.interior if generated is not None else derive_interior(category, ir)
        if "interior" not in type_json and derived is not None:
            type_json["interior"] = derived
        if "doors" not in type_json and "interior" in type_json and doors:
            type_json["doors"] = doors
        return {"ir": ir, "obj_zip": obj_zip, "extent": extent, "boxes": boxes, "overrides": overrides,
                "type_json": type_json, "doors": doors, "doors_in_model": in_model, "floor": generated,
                "floor_problem": floor_problem, "derived_interior": derived, "hand_interior": hand_interior}

    def convert_stock(self, source, category, entry, type_id):
        ir = lenient_json(source.read(entry))
        obj_zip = ir_location_to_zip(ir["model"])
        obj_name, obj_destination, objects, extent, boxes = self.copy_model(source, obj_zip, type_id)
        for group in groups_too_long(objects):
            self.warn(f"{type_id}: control group '{group}' is longer than {MAX_GROUP_LENGTH} characters and the "
                      f"engine drops it: its switches can't be worked, its lights stay off (an LINVERT one on)")

        plan = self.prepare(source, category, entry, type_id, parsed=(extent, boxes))
        overrides, type_json = plan["overrides"], plan["type_json"]
        door_ids = {door["id"].lower() for door in type_json.get("doors", [])}

        model_json, liveries, ir_animations = self.model_declaration(source, category, ir, obj_name, obj_destination,
                                                                     boxes, door_ids, type_id)
        sway = overrides.get("sway")
        if sway is not None:  # the body's rocking, on top of the client setting (SPEC §10.2)
            if isinstance(sway, (int, float)) and not isinstance(sway, bool) and 0 <= sway <= 3:
                model_json["sway"] = sway
            else:
                self.warn(f"{type_id}: \"sway\" must be a number from 0 to 3, left out")
        model_json = deep_merge(model_json, overrides.get("model") or {})

        if self.geometry is not None:
            self.write_geometry(source, plan, type_id, category, ir_animations)
        self.generated[f"data/{self.namespace}/wagon_types/{type_id}.json"] = dump(type_json)
        self.generated[f"assets/{self.namespace}/wagon_models/{type_id}.json"] = dump(model_json)
        name = ir.get("name", type_id)
        self.langs["en_us"][f"wagon.{self.namespace}.{type_id}"] = name
        self.add_names(type_id, overrides, boxes)
        self.stock.append((type_id, source.label, category, name, len(liveries)))
        walk = ""
        if "interior" in type_json:
            doors = type_json.get("doors", [])
            zones = type_json["interior"]
            walk = (f"  walk: {len(zones) if isinstance(zones, list) else 1} zone(s), {len(doors)} door(s)"
                    f" ({sum(1 for d in doors if d.get('connecting'))} gangway)")
        print(f"  {self.namespace}:{type_id:28} {category:11} {type_json['length']:7.3f} m "
              f"{type_json['mass_t']:7.1f} t  liveries={len(liveries):2}  {name}{walk}")

    def model_declaration(self, source, category, ir, obj_name, obj_destination, boxes, door_ids, type_id):
        """(the model declaration before the per-type file's "sway" and "model", its
        liveries, every IR animation: control group → the objects it moves) of a stock
        type whose model is copied (copy_model): the OBJ, the door animations and door
        sounds of `door_ids` (lower case; None: of every animation the definition has),
        the liveries, the handbrake, the sounds — their files copied."""
        obj_folder = posixpath.dirname(obj_name)
        here = posixpath.dirname(obj_destination)
        liveries = {}
        livery_names = {}  # livery id → the IR name it came from
        for livery, folder in ir.get("tex_variants", {}).items():
            livery_id = sanitize_id(livery)
            if livery_id in livery_names:
                raise ValueError(f"liveries {livery_names[livery_id]!r} and {livery!r} both convert to the id "
                                 f"'{livery_id}'")
            livery_names[livery_id] = livery
            files = source.files_under(join(obj_folder, folder))
            if not files:
                self.warn(f"{type_id}: livery {livery} folder {folder} is empty or missing")
                continue
            for file_zip in files:
                self.copy(source, file_zip)
            moved = relink(here, folder, source.destination(join(obj_folder, folder), self.namespace))
            liveries[livery_id] = folder if moved is None else moved

        animations = {}
        ir_animations = {}  # every IR animation: control group → the objects it moves
        for animation in ir.get("animations", []):
            group = animation.get("control_group", "")
            anim_zip = ir_location_to_zip(animation["animatrix"])
            anim_name = source.find(anim_zip)
            if anim_name is not None:
                ir_animations[group] = [o for o in anim_objects(source.read(anim_name)) if o in boxes]
            if door_ids is not None and group.lower() not in door_ids:
                continue  # only doors the type declares are driven (SPEC §6.3)
            if anim_name is not None:
                animations[group.lower()] = self.model_location(self.copy(source, anim_name))
            else:
                self.warn(f"{type_id}: animation {anim_zip} missing")

        model_json = {"obj": self.model_location(obj_destination)}
        if animations:
            model_json["animations"] = animations
        if liveries:
            model_json["liveries"] = liveries
        handbrake = derive_handbrake(boxes)
        if handbrake:
            model_json["handbrake"] = handbrake
        sounds = self.convert_sounds(source, category, ir, door_ids, type_id)
        if sounds:
            model_json["sounds"] = sounds
        return model_json, liveries, ir_animations

    def copy_sound(self, source, ref, type_id):
        """An IR sound reference ("sounds/x.ogg", "immersiverailroading:sounds/x.ogg") →
        the copied file's path in the pack, or None (warned) if it isn't there."""
        try:
            sound_zip = ir_location_to_zip(ref)
        except ValueError as problem:
            self.warn(f"{type_id}: sound skipped — {problem}")
            return None
        sound_name = source.find(sound_zip)
        if sound_name is None:
            self.warn(f"{type_id}: sound {sound_zip} missing")
            return None
        try:
            return self.model_location(self.copy(source, sound_name))
        except ValueError as problem:
            self.warn(f"{type_id}: sound skipped — {problem}")
            return None

    def convert_sounds(self, source, category, ir, door_ids, type_id):
        """The model declaration's "sounds" (SPEC §10) from IR's, the door
        animations' and the recipe's "sound_defaults"."""
        ir_sounds = ir.get("sounds", {})
        defaults = self.recipe.get("sound_defaults", {})
        sounds = {}

        def loop(value, extra=None):
            if isinstance(value, str):
                main = self.copy_sound(source, value, type_id)
                if main is None:
                    return None
                return dict({"main": main}, **extra) if extra else main
            parts = {}
            for key in ("start", "main", "stop"):
                if value.get(key):
                    copied = self.copy_sound(source, value[key], type_id)
                    if copied is not None:
                        parts[key] = copied
            if "main" not in parts:
                return None
            return dict(parts, **extra) if extra else parts

        era = ir.get("era")
        engine = ENGINE_RANGES.get(str(era).lower()) if era is not None else None
        if era is not None and engine is None and ir_sounds.get("idle"):
            self.warn(f"{type_id}: IR era {era!r} isn't one the converter knows ({', '.join(ENGINE_RANGES)}): "
                      f"its engine sound keeps the mod's default pitch and volume range")
        for key in ("idle", "horn", "bell"):
            if ir_sounds.get(key):
                converted = loop(ir_sounds[key], engine if key == "idle" else None)
                if converted is not None:
                    sounds[key] = converted
        wheels = ir_sounds.get("wheels") or defaults.get("wheels", {}).get(category)
        if wheels:
            converted = loop(wheels)
            if converted is not None:
                sounds["wheels"] = converted
        clack = ir_sounds.get("clack") or defaults.get("clack")
        if clack:
            converted = self.copy_sound(source, clack, type_id)
            if converted is not None:
                sounds["clack"] = converted

        doors = {}
        for animation in ir.get("animations", []):
            group = animation.get("control_group", "").lower()
            start = (animation.get("sound") or {}).get("start")
            if (door_ids is None or group in door_ids) and start:
                converted = self.copy_sound(source, start, type_id)
                if converted is not None:
                    doors[group] = converted
        if doors:
            sounds["doors"] = dict(sorted(doors.items()))

        controls = {}
        for key, control in sorted(ir_sounds.get("controls", {}).items()):
            converted = {}
            for kind in CONTROL_SOUNDS:
                if isinstance(control, dict) and control.get(kind):
                    copied = self.copy_sound(source, control[kind], type_id)
                    if copied is not None:
                        converted[kind] = copied
            if converted:
                controls[key] = converted
        if controls:
            sounds["controls"] = controls
        return sounds

    def add_names(self, type_id, overrides, boxes):
        """A per-type file's "name" and "lights" → the pack's lang files (SPEC §8, §9.6)."""
        for lang, text in (overrides.get("name") or {}).items():
            self.langs.setdefault(lang, {})[f"wagon.{self.namespace}.{type_id}"] = text
        groups = light_groups(boxes)
        for group, names in (overrides.get("lights") or {}).items():
            if group not in groups:
                self.warn(f"{type_id}: \"lights\" names {group}, which isn't a light group of the model"
                          f" ({', '.join(groups) or 'it has none'})")
            for lang, text in names.items():
                self.langs.setdefault(lang, {})[f"light.{self.namespace}.{type_id}.{group}"] = text

    def write_geometry(self, source, plan, type_id, category, ir_animations):
        """<geometry>/<id>.json: the numbers a floor is measured from (see --geometry), in the OBJ
        frame as the pack's markup is; kept until the pack is written."""
        ir, obj_zip, extent, boxes = plan["ir"], plan["obj_zip"], plan["extent"], plan["boxes"]
        interior = plan["derived_interior"]
        floor = plan["floor"]
        digest = {
            "_about": "OBJ frame, as the pack's markup (x along the car, the front towards -x; y up as in "
                      "the model; z across, +z the left side). Generated by tools/ir2rwat.py --geometry "
                      "from the IR pack; numbers only. SPEC 9.6, roadmap R6.",
            "id": f"{self.namespace}:{type_id}",
            "category": category,
            "length": r(extent[1] - extent[0], 3),
            "ir_passenger": ir.get("passenger"),
            "derived": {"interior": interior, "doors": plan["doors_in_model"] if interior else []},
            "doors_in_model": plan["doors_in_model"],
            "door_motion": door_motion(boxes, {g.lower() for g in ir_animations}),
            "animations": dict(sorted(ir_animations.items())),
            "lights": light_groups(boxes),
            "floor_levels": [{"y": y, "area": a, "plan_min_x_z": box[:2], "plan_max_x_z": box[2:],
                              "objects": objects[:6]}
                             for y, a, box, objects in floor_levels(source.read(obj_zip))],
            "objects": {name: [r(v, 3) for v in floorgen.flat_box_to_obj(box)] for name, box in sorted(boxes.items())},
        }
        if floor is not None:
            digest["derived"]["floor"] = {"levels": [floorgen.y_to_obj(level) for level in floor.levels],
                                          "zones": len(floor.interior),
                                          "centre_area": r(floor.region.area(), 2)}
        self.digests[type_id] = dump(digest)

    # -------------------------------------------------------------- writing

    def nothing_converted(self):
        if not self.found_stock:
            zips = ", ".join(s.path.name for s in self.sources)
            return (f"no rolling stock in {zips}: no {IR_STOCK}<category>/<id>.json in any of them — "
                    f"nothing written, the old pack (if any) is as it was")
        return (f"no rolling stock converted ({self.found_stock} definition(s) found: every one excluded or "
                f"skipped, see above) — nothing written, the old pack (if any) is as it was")

    def check_geometry(self):
        """Refuse a --geometry folder whose files aren't digests: the per-type files, a recipe, anything."""
        if self.geometry is None:
            return
        if self.overrides_path is not None and same_folder(self.geometry, self.overrides_path):
            raise ConversionError(f"--geometry {self.geometry} is the recipe's \"overrides_dir\": the digests "
                                  f"would overwrite the per-type files")
        for type_id in sorted(self.digests):
            path = self.geometry / f"{type_id}.json"
            if path.exists() and not is_digest(path):
                raise ConversionError(f"--geometry: {path} exists and isn't a geometry digest — refusing to "
                                      f"overwrite it")

    def rwat_block(self):
        """pack.mcmeta's "rwat" block, format 1 (schema/pack_mcmeta_rwat.schema.json): the format,
        the pack's name, the recipe's "version" and "authors" if it has them, the license. How
        the pack was converted (namespace, sources) is in RWAT_CONVERSION.txt, not here."""
        block = {"format": RWAT_FORMAT, "name": self.recipe.get("name", self.recipe["pack_dir"])}
        if self.recipe.get("version") is not None:
            block["version"] = self.recipe.get("version")
        if self.recipe.get("authors") is not None:
            block["authors"] = self.recipe.get("authors")
        block["license"] = self.recipe.get("license", "see the pack's own license")
        return block

    def finish(self):
        """The generated files every pack has: pack.mcmeta, lang files, the notice, the recipe's root files."""
        pack_name = self.recipe["pack_dir"]
        first = self.sources[0]
        self.generated["pack.mcmeta"] = dump({
            "pack": {
                "pack_format": PACK_FORMAT_RESOURCES,
                "supported_formats": [PACK_FORMAT_RESOURCES, PACK_FORMAT_DATA],
                "description": self.recipe.get("description", pack_name),
            },
            "rwat": self.rwat_block(),
        })
        for lang, entries in sorted(self.langs.items()):
            self.generated[f"assets/{self.namespace}/lang/{lang}.json"] = dump(dict(sorted(entries.items())))
        self.generated[MARKER] = self.notice().encode("utf-8")
        for extra in self.recipe.get("copy_root_files", []):
            found = first.find(extra)
            if found is None:
                self.warn(f"\"copy_root_files\": {extra} is not in {first.path.name}")
            else:
                self.generated[extra] = first.read(found)

    def contents(self):
        """[(path, read)] of everything the pack holds, pack.mcmeta last (a folder
        without it, left by a run killed halfway, is no pack to Minecraft)."""
        twice = sorted(set(self.generated) & set(self.files))
        if twice:
            raise ConversionError(f"{twice[0]} would be both generated and copied from an IR pack")
        out = []
        for path in sorted(set(self.generated) | set(self.files), key=lambda p: (p == "pack.mcmeta", p)):
            if safe_relative(path) != path:
                raise ConversionError(f"refusing to write {path!r}: not a path inside the pack")
            if path in self.generated:
                out.append((path, lambda data=self.generated[path]: data))
            else:
                asset = self.files[path]
                out.append((path, lambda a=asset: a.data if a.data is not None else a.source.read(a.name)))
        return out

    def write(self, out_dir, as_zip):
        """Write the pack (and the geometry digests); returns the pack's path.
        Everything is checked first — a refusal writes nothing — and the pack
        is assembled next to its target and swapped in whole."""
        if not self.stock:
            raise ConversionError(self.nothing_converted())
        pack_name = self.recipe["pack_dir"]
        target = out_dir / (f"{pack_name}.zip" if as_zip else pack_name)
        check_target(target, as_zip)
        self.check_geometry()
        self.finish()
        contents = self.contents()
        out_dir.mkdir(parents=True, exist_ok=True)
        if as_zip:
            write_zip(target, contents)
        else:
            write_folder(target, contents)
        if self.geometry is not None:
            for type_id, data in sorted(self.digests.items()):
                write_file(self.geometry / f"{type_id}.json", data)
        return target

    def notice(self):
        """RWAT_CONVERSION.txt: how the pack was made — the namespace, the source packs and where
        each landed, what was generated, what is in it, what was renamed — and the marker that
        ir2rwat wrote the folder (check_target)."""
        moved = sorted((path, asset) for path, asset in self.files.items()
                       if asset.renamed or asset.data is not None)
        lines = [
            f"{self.recipe.get('name', self.recipe['pack_dir'])} — converted for Rails, Wheels & Trains (RWAT)",
            "",
            f"Namespace: {self.namespace} (the stock and the rail styles are {self.namespace}:<id>).",
            f"RWAT pack format: {RWAT_FORMAT}.",
            "",
            "Converted by tools/ir2rwat.py from the Immersive Railroading pack(s):",
        ]
        lines += [f"  - {s.path.name} ({s.label}) → assets/{self.namespace}/{s.root}/" for s in self.sources]
        lines += [
            "",
            "The models, textures, liveries and animations are the original files, copied",
            "unchanged; only the RWAT declarations (wagon_types/, wagon_models/,"
            if not moved else
            "unchanged except as listed at the end; only the RWAT declarations (wagon_types/, wagon_models/,",
            "rail_models/), the lang file and pack.mcmeta were generated. The original",
            "license, credits and readme are included as they were. All rights to the",
            "content stay with its authors.",
            "",
            f"Rolling stock ({len(self.stock)}):",
        ]
        lines += [f"  {self.namespace}:{i:28} {c:11} {n}   [{label}, {liv} liveries]"
                  for i, label, c, n, liv in sorted(self.stock)]
        lines += ["", f"Rail styles ({len(self.rails)}):"]
        lines += [f"  {self.namespace}:{i:28} {n}   [{label}]" for i, label, n in sorted(self.rails)]
        if moved:
            lines += [
                "",
                f"Renamed or rewritten ({len(moved)}): Minecraft takes only a-z 0-9 _ . - / in a resource",
                "path, so these files got such names, and in the models and material libraries",
                "the paths that lead to them (mtllib, map_Kd lines) were rewritten; nothing",
                "else in any file changed:",
            ]
            lines += [f"  [{asset.source.label}] {asset.name} → {path}"
                      + (" (paths in it rewritten)" if asset.data is not None else "")
                      for path, asset in moved]
        return "\n".join(lines) + "\n"


def check_target(target, as_zip):
    """Refuse to replace what ir2rwat didn't write (no RWAT_CONVERSION.txt in it)."""
    if not target.exists():
        return
    if as_zip:
        if not target.is_file() or not zipfile.is_zipfile(target):
            raise ConversionError(f"{target} exists and isn't a zip written by ir2rwat — refusing to replace it")
        with zipfile.ZipFile(target) as old:
            if MARKER not in old.namelist():
                raise ConversionError(f"{target} exists and wasn't written by ir2rwat (no {MARKER} in it) — "
                                      f"refusing to replace it")
    else:
        if not target.is_dir():
            raise ConversionError(f"{target} exists and isn't a folder — refusing to replace it")
        if any(target.iterdir()) and not (target / MARKER).is_file():
            raise ConversionError(f"{target} exists and wasn't written by ir2rwat (no {MARKER} in it) — "
                                  f"refusing to replace it")


def usual_mode(mode):
    """mode as the user's umask leaves it — what mkdir and open give (mkdtemp and mkstemp give 0700, 0600)."""
    mask = os.umask(0)
    os.umask(mask)
    return mode & ~mask


def write_folder(target, contents):
    """Assemble the pack in a temporary folder next to target, then swap it in:
    until the swap, the old pack is untouched."""
    temp = Path(tempfile.mkdtemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent))
    try:
        for path, read in contents:
            write_file(temp / path, read())
        os.chmod(temp, usual_mode(0o777))
        if target.exists():
            old = temp.with_suffix(".old")
            os.replace(target, old)
            try:
                os.replace(temp, target)
            except BaseException:
                os.replace(old, target)
                raise
            shutil.rmtree(old, ignore_errors=True)
        else:
            os.replace(temp, target)
    except BaseException:
        shutil.rmtree(temp, ignore_errors=True)
        raise


def write_zip(target, contents):
    """The pack as one zip, the same bytes on every run: entries sorted, every
    one with the same time, permissions and system; assembled under a
    temporary name next to target, then swapped in."""
    handle, temp = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
    os.close(handle)
    try:
        with zipfile.ZipFile(temp, "w", zipfile.ZIP_DEFLATED) as archive:
            for path, read in sorted(contents, key=lambda entry: entry[0]):
                info = zipfile.ZipInfo(path, date_time=ZIP_TIME)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3  # Unix, whatever system writes it
                info.external_attr = 0o644 << 16
                archive.writestr(info, read())
        os.chmod(temp, usual_mode(0o666))
        os.replace(temp, target)
    except BaseException:
        if os.path.exists(temp):
            os.remove(temp)
        raise


def dump(value):
    """JSON as the pack's files are written: two-space indents, an array of
    scalars ([x, y, z], [front, rear]) on one line for hand editing. Built
    item by item — a string's text is never touched."""
    return (encode(value, 0) + "\n").encode("utf-8")


def encode(value, depth):
    inner = "  " * (depth + 1)
    if isinstance(value, dict):
        if not value:
            return "{}"
        items = [inner + json.dumps(key if isinstance(key, str) else json.dumps(key), ensure_ascii=False)
                 + ": " + encode(item, depth + 1) for key, item in value.items()]
        return "{\n" + ",\n".join(items) + "\n" + "  " * depth + "}"
    if isinstance(value, (list, tuple)):
        if not value:
            return "[]"
        if not any(isinstance(item, (dict, list, tuple)) for item in value):
            return "[" + ", ".join(encode(item, depth) for item in value) + "]"
        return "[\n" + ",\n".join(inner + encode(item, depth + 1) for item in value) + "\n" + "  " * depth + "]"
    return json.dumps(value, ensure_ascii=False)


def write_file(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("recipe", help="pack recipe, e.g. packs/mvp.json")
    parser.add_argument("--out", help="output folder (default: the recipe's \"out\", relative to it)")
    parser.add_argument("--zip", action="store_true", help="write <pack>.zip instead of a folder")
    parser.add_argument("--geometry", help="also write per-type geometry digests to this folder")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")  # a Windows console isn't UTF-8: never die on a non-ASCII name

    try:
        converter = Converter(args.recipe, Path(args.geometry).resolve() if args.geometry else None)
        if args.out:
            out = Path(args.out)
        elif "out" in converter.recipe:
            out = converter.recipe_path.parent / converter.recipe["out"]
        else:
            raise ConversionError(f"{converter.recipe_path.name}: no \"out\" — name the output folder with --out")
        # what can be refused before the conversion is refused before it (write() checks again)
        check_target(out.resolve() / (converter.recipe["pack_dir"] + (".zip" if args.zip else "")), args.zip)
        converter.check_geometry()
        converter.convert()
        target = converter.write(out.resolve(), args.zip)
    except (ConversionError, OSError) as problem:
        print(f"ir2rwat: error: {describe(problem)}", file=sys.stderr)
        return 2
    print(f"\n{len(converter.stock)} stock type(s), {len(converter.rails)} rail style(s), "
          f"{len(converter.files)} asset file(s) -> {target}")
    if converter.warnings:
        print(f"{len(converter.warnings)} warning(s), see above")
    if converter.errors:
        print(f"{len(converter.errors)} error(s), see above: what they name is not in the pack, or not as asked")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
