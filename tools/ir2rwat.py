#!/usr/bin/env python3
"""ir2rwat — convert Immersive Railroading content packs into an RWAT content pack.

SPEC §6.8. Reads the IR pack zips named by a recipe (packs/<name>.json) and
writes one RWAT pack: a plain Minecraft pack that is both a resource pack and
a data pack (SPEC §6.1). IR assets (OBJ, MTL, textures, liveries, .anim) are
copied byte for byte — the RWAT model convention IS the IR one (SPEC §5.2) —
only the declarations are generated:

    data/<ns>/wagon_types/<id>.json     physics, from IR "properties"/"trucks"
    assets/<ns>/wagon_models/<id>.json  model, liveries, door animations
    assets/<ns>/rail_models/<id>.json   rail styles, from IR track/ definitions (SPEC §6.10)
    assets/<ns>/lang/<lang>.json        display names (wagon.<ns>.<id>, rail.<ns>.<id>,
                                        light.<ns>.<id>.<group>)

IR carries none of RWAT's physics figures beyond mass, power, tractive effort
and speed, so the rest is derived by heuristics (see derive_type); a recipe's
"overrides" deep-merge over the generated declarations ("null" removes a field).
Overrides may also live one file per type in the recipe's "overrides_dir"
(packs/mvp/<id>.json), merged over the inline ones — so several people (or
agents) can tune different types without touching the same file.

Walkable cars come from the IR conventions too (SPEC §9.6): a passenger car's
floor is the IR "passenger" area, its doors are the model's DOOR_<n> objects —
EXTERNAL (a way in and out), CONNECTING (an end door onto the gangway to the
next car), else inner (between floor zones); the two leaves of one doorway
make one door. A recipe's own "interior"/"doors" replace them; "doors": []
turns the derived doors off.

Names: a per-type override file may carry "name" ({"ru_ru": "..."}) and
"lights" ({"<group>": {"en_us": "...", "ru_ru": "..."}}) — the stock's display
name and its light groups' names in the driver's light menu (SPEC §8), written
to the pack's lang files.

Several sources: the first one wins, later ones only add ids the earlier ones
lack. Each source lands under its own root folder, so shared textures of
different pack versions (common/…) never overwrite each other.

Usage:  python tools/ir2rwat.py packs/mvp.json [--out DIR] [--zip] [--geometry DIR]

--geometry DIR also writes, per stock type, <DIR>/<id>.json: the numbers a
floor is measured from — every object's bounding box, the floor levels (up-
facing surface area by height), IR's passenger area and the floor and doors
derived from them, how each door's leaf moves, the IR animations and the
light groups. No model data, so it can live in the repository and be worked
from where the IR packs are not (tests/RecipeFloorTest, SPEC §9.6).

Python 3.9+, standard library only.
"""

import argparse
import io
import json
import math
import posixpath
import re
import shutil
import sys
import zipfile
from pathlib import Path

IR_ROOT = "assets/immersiverailroading/"
IR_MODELS = IR_ROOT + "models/"
IR_STOCK = IR_ROOT + "rolling_stock/"
IR_TRACK = IR_ROOT + "track/"
PACK_FORMAT_RESOURCES = 34  # Minecraft 1.21.1 resource packs
PACK_FORMAT_DATA = 48       # Minecraft 1.21.1 data packs
MARKER = "RWAT_CONVERSION.txt"
VALID_PATH = re.compile(r"^[a-z0-9_.\-/]+$")

HP_TO_KW = 0.745699872
LBF_TO_KN = 0.00444822162

# IR model space -> RWAT model space (IrStockModel.toModelSpace): x = IR z,
# y = IR y + lift onto the railhead, z = -IR x (IR's front is -X, RWAT's +Z)
Y_LIFT = 0.40625 + 0.03
# IR "passenger.center_y" sits this far under the floor a RWAT rider walks
# (measured on the ChME3 and the platzkart: 2.2 -> 2.311, 1.71 -> 1.81)
IR_FLOOR_OFFSET = 0.1
# headroom of a derived floor zone (only the floor height and the plan matter)
ZONE_HEIGHT = 2.5
DOOR_KEY = re.compile(r"(?:^|_)DOOR_(\d+)(?=_|$)")
CONTROL_GROUP = re.compile(r"_CG_([^_]+)")
LIGHT_GROUP = re.compile(r"_LCG_([^_]+)")
SWITCH_KEY = re.compile(r"(?:^|_)((?:WIDGET|WINDOW)_\d+)(?=_|$)")
HEADLIGHT = re.compile(r"(?:^|_)HEADLIGHT_\d+(?=_|$)")
LABEL = re.compile(r"_LABEL_([^_]+)")
# Blender's suffix on a duplicated object: DOOR_3_INTERIOR_LCG_IL.001 lights with IL
COPY_SUFFIX = re.compile(r"\.\d{3}$")
# IR flags a careless name puts where a control group goes (DOOR_7_EXTERNAL_CG_NOINTERACT)
FLAG_WORDS = {"NOINTERACT", "NOTOUCH", "TOGGLE", "PRESS", "INVERT", "HIDE", "GLOBAL",
              "EXTERNAL", "INTERIOR", "CONNECTING", "INTERNAL", "FULLBRIGHT"}
# a DOOR_<n> smaller than this is a marker or a handle, no doorway (2TE116's DOOR_2_CONNECTING)
MIN_DOOR_HEIGHT = 1.2
MIN_DOOR_SPAN = 0.3
# the leaves of one doorway touch along the wall (ER2: two sliding leaves meet in the middle)
LEAF_GAP = 0.05


# --------------------------------------------------------------------- input

def lenient_json(raw):
    """IR packs are hand-edited: tolerate a BOM, // comments and trailing commas."""
    text = raw.decode("utf-8-sig")
    text = re.sub(r"(?m)^\s*//.*$", "", text)
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    return json.loads(text)


class Source:
    """One IR pack zip and the root folder its assets land under."""

    def __init__(self, path, root, label):
        self.path = path
        self.root = root
        self.label = label
        self.zip = zipfile.ZipFile(path)
        self.names = set(self.zip.namelist())

    def read(self, name):
        return self.zip.read(name)

    def exists(self, name):
        return name in self.names

    def files_under(self, folder):
        prefix = folder.rstrip("/") + "/"
        return sorted(n for n in self.names if n.startswith(prefix) and not n.endswith("/"))

    def destination(self, zip_path, namespace):
        """assets/immersiverailroading/models/<rest> → assets/<ns>/<root>/<rest>."""
        if not zip_path.startswith(IR_MODELS):
            raise ValueError(f"{zip_path} is outside {IR_MODELS}")
        return f"assets/{namespace}/{self.root}/{zip_path[len(IR_MODELS):]}"


def ir_location_to_zip(location):
    """immersiverailroading:models/x/y.obj → assets/immersiverailroading/models/x/y.obj."""
    namespace, _, path = location.partition(":")
    if not path:
        namespace, path = "immersiverailroading", location
    return f"assets/{namespace}/{path}"


def parse_obj(raw):
    """mtllib references, object names, the travel-axis extent of the visible
    model, and every object's bounding box in RWAT model space
    ({name: [min_x, min_y, min_z, max_x, max_y, max_z]})."""
    libraries, objects = [], []
    positions = []
    boxes = {}
    box = None
    min_x, max_x = math.inf, -math.inf
    visible = True
    for line in io.TextIOWrapper(io.BytesIO(raw), encoding="utf-8", errors="replace"):
        if line.startswith("v "):
            parts = line.split()
            positions.append((float(parts[1]), float(parts[2]), float(parts[3])))
        elif line.startswith(("o ", "g ")):
            name = line[2:].strip()
            objects.append(name)
            visible = "HIDE" not in name
            box = boxes.setdefault(name, [math.inf] * 3 + [-math.inf] * 3)
        elif line.startswith("f "):
            for token in line.split()[1:]:
                index = int(token.split("/")[0])
                x, y, z = positions[index - 1 if index > 0 else len(positions) + index]
                if visible:
                    min_x, max_x = min(min_x, x), max(max_x, x)
                if box is not None:
                    rx, ry, rz = z, y + Y_LIFT, -x
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
    """Up-facing horizontal surfaces of a model by height (RWAT model space):
    [(y, area, [min_x, min_z, max_x, max_z], [objects])], only faces whose
    centre lies in the plan window, levels of at least min_area. A floor is a
    big area at one height; a vestibule a step lower, a cab deck higher."""
    positions = []
    name = None
    levels = {}
    for line in io.TextIOWrapper(io.BytesIO(raw), encoding="utf-8", errors="replace"):
        if line.startswith("v "):
            parts = line.split()
            x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
            positions.append((z, y + Y_LIFT, -x))
        elif line.startswith(("o ", "g ")):
            name = line[2:].strip()
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


def parse_mtl(raw):
    maps = {}
    material = None
    for line in raw.decode("utf-8", errors="replace").splitlines():
        line = line.strip()
        if line.startswith("newmtl "):
            material = line[len("newmtl "):].strip()
        elif line.startswith("map_Kd ") and material is not None:
            maps[material] = line[len("map_Kd "):].strip().replace("\\", "/")
    return maps


def join(folder, relative):
    return posixpath.normpath(posixpath.join(folder, relative.replace("\\", "/")))


# ------------------------------------------------------------------ heuristics

def r(value, digits=1):
    return round(value, digits)


def derive_type(category, ir, extent):
    """RWAT physics declaration (SPEC §5.1) from an IR stock definition."""
    props = ir.get("properties", {})
    trucks = ir.get("trucks", {})
    mass_t = props.get("weight_kg", 20000) / 1000.0
    powered = category == "locomotives" and "horsepower" in props
    passenger = category == "passenger"
    declaration = {
        "length": r(extent[1] - extent[0], 3),
        "bogies": [trucks.get("front", 0.0), trucks.get("rear", 0.0)],
        "mass_t": r(mass_t, 2),
        "max_speed_kmh": props.get("max_speed_kmh", 120.0 if passenger else 100.0),
        # Davis a + b·v + c·v²: rolling terms per tonne, aero per car (heads see more air)
        "resistance": {"a": r(20.0 * mass_t), "b": r(0.9 * mass_t, 2), "c": 12.0 if powered else 9.0},
    }
    train_kn = mass_t * (1.3 if powered else 2.0)
    brakes = {"train_kn": r(train_kn), "parking_kn": r(0.2 * train_kn)}
    if powered:
        declaration["traction"] = {
            "power_kw": r(props["horsepower"] * HP_TO_KW),
            "max_tractive_effort_kn": r(props.get("tractive_effort_lbf", 0.0) * LBF_TO_KN),
        }
        declaration["cab"] = {}
        brakes["independent_kn"] = r(0.56 * train_kn)
    declaration["brakes"] = brakes
    return declaration


def derive_interior(category, ir):
    """A passenger car's walkable floor (SPEC §9.6): IR's "passenger" area —
    centre_x along the car, length = HALF the length, width = the full width,
    centre_y just under the floor — as one RWAT floor zone; None otherwise
    (locomotive cabs need a driver's chair as well: hand-made)."""
    area = ir.get("passenger")
    if category != "passenger" or not isinstance(area, dict):
        return None
    half_length = area.get("length", 0.0)
    width = area.get("width", 0.0)
    if half_length <= 0.0 or width <= 0.0:
        return None
    centre_z = -area.get("center_x", 0.0)
    floor = area.get("center_y", 0.0) + IR_FLOOR_OFFSET
    return {"min": [r(-width / 2, 3), r(floor, 3), r(centre_z - half_length, 3)],
            "max": [r(width / 2, 3), r(floor + ZONE_HEIGHT, 3), r(centre_z + half_length, 3)]}


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


def door_groups(boxes):
    """{n: {"box": merged box, "names": [objects]}} for every DOOR_<n>."""
    groups = {}
    for name, box in boxes.items():
        key = DOOR_KEY.search(name)
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
    group's bounding box, id = its control group (CG_<name>, so the IR
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
    """The objects an IR .anim moves (its "O <name>" lines)."""
    text = raw.decode("utf-8", errors="replace")
    return [line[2:].strip() for line in text.splitlines() if line.startswith("O ")]


def deep_merge(base, override):
    """override onto base; a None value deletes the key."""
    merged = dict(base)
    for key, value in override.items():
        if value is None:
            merged.pop(key, None)
        elif isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def sanitize_id(name):
    return re.sub(r"[^a-z0-9_.\-]", "_", name.lower())


# ------------------------------------------------------------------- convert

class Converter:

    def __init__(self, recipe_path, geometry=None):
        self.geometry = geometry  # folder for the per-type geometry digests, or None
        self.recipe_path = Path(recipe_path).resolve()
        self.recipe = json.loads(self.recipe_path.read_text(encoding="utf-8"))
        base = self.recipe_path.parent
        self.namespace = self.recipe["namespace"]
        self.strip = self.recipe.get("id_strip_prefix", "")
        self.exclude = set(self.recipe.get("exclude", []))
        self.overrides = dict(self.recipe.get("overrides", {}))
        if "overrides_dir" in self.recipe:
            for path in sorted((base / self.recipe["overrides_dir"]).glob("*.json")):
                per_type = json.loads(path.read_text(encoding="utf-8"))
                self.overrides[path.stem] = deep_merge(self.overrides.get(path.stem, {}), per_type)
        self.rail_exclude = set(self.recipe.get("rail_exclude", []))
        self.rail_overrides = self.recipe.get("rail_overrides", {})
        self.sources = [Source(base / s["zip"], s["root"], s.get("label", s["zip"]))
                        for s in self.recipe["sources"]]
        self.files = {}      # destination path → (source, zip path)
        self.generated = {}  # destination path → bytes
        self.langs = {"en_us": {}}  # language → key → text
        self.stock = []      # (id, source label, category, name)
        self.rails = []      # (id, source label, name)
        self.warnings = []

    def warn(self, message):
        self.warnings.append(message)
        print("  WARNING:", message)

    def copy(self, source, zip_path):
        destination = source.destination(zip_path, self.namespace)
        if not VALID_PATH.match(destination):
            raise ValueError(f"{zip_path}: not a valid resource path in Minecraft ({destination})")
        self.files.setdefault(destination, (source, zip_path))
        return destination

    def model_location(self, destination):
        """assets/<ns>/<path> → <path> (the declaring pack's namespace is implied)."""
        prefix = f"assets/{self.namespace}/"
        return destination[len(prefix):]

    def convert(self):
        seen = set()
        for source in self.sources:
            print(f"Source {source.label} ({source.path.name}) -> {source.root}/")
            for entry in sorted(source.names):
                if not (entry.startswith(IR_STOCK) and entry.endswith(".json")):
                    continue
                rest = entry[len(IR_STOCK):]
                if "/" not in rest:
                    continue  # rolling_stock/stock.json: the category index
                category, file_name = rest.split("/", 1)
                stem = file_name[:-len(".json")]
                type_id = sanitize_id(stem[len(self.strip):] if stem.startswith(self.strip) else stem)
                if type_id in seen or type_id in self.exclude:
                    continue
                try:
                    self.convert_stock(source, category, entry, type_id)
                    seen.add(type_id)
                except (ValueError, KeyError, json.JSONDecodeError) as problem:
                    self.warn(f"{entry}: skipped — {problem}")
        seen_rails = set()
        for source in self.sources:
            for entry in sorted(source.names):
                if not (entry.startswith(IR_TRACK) and entry.endswith(".json")):
                    continue
                stem = entry[len(IR_TRACK):-len(".json")]
                if "/" in stem or stem == "track":
                    continue  # track/track.json: the index
                rail_id = sanitize_id(stem[len(self.strip):] if stem.startswith(self.strip) else stem)
                if rail_id in seen_rails or rail_id in self.rail_exclude:
                    continue
                try:
                    self.convert_track(source, entry, rail_id)
                    seen_rails.add(rail_id)
                except (ValueError, KeyError, json.JSONDecodeError) as problem:
                    self.warn(f"{entry}: skipped — {problem}")

    def copy_model(self, source, obj_zip, label):
        """Copy an OBJ with its MTLs and their textures; returns (destination, objects, extent, boxes)."""
        if not source.exists(obj_zip):
            raise ValueError(f"model {obj_zip} not in the pack")
        libraries, objects, extent, boxes = parse_obj(source.read(obj_zip))
        if not math.isfinite(extent[0]):
            raise ValueError("model has no visible geometry")
        obj_folder = posixpath.dirname(obj_zip)
        obj_destination = self.copy(source, obj_zip)
        for library in libraries:
            mtl_zip = join(obj_folder, library)
            if not source.exists(mtl_zip):
                self.warn(f"{label}: material library {mtl_zip} missing")
                continue
            self.copy(source, mtl_zip)
            for material, texture in parse_mtl(source.read(mtl_zip)).items():
                texture_zip = join(obj_folder, texture)
                if source.exists(texture_zip):
                    self.copy(source, texture_zip)
                else:
                    self.warn(f"{label}: material {material} texture {texture_zip} missing")
        return obj_destination, objects, extent, boxes

    def convert_track(self, source, entry, rail_id):
        """An IR track type → an RWAT rail style: the tile OBJ as is, swept by the renderer."""
        ir = lenient_json(source.read(entry))
        models = ir.get("models", {})
        if not models:
            raise ValueError("no models")
        # IR keys models by gauge condition (">0.2"); RWAT has one gauge: take the first
        obj_zip = ir_location_to_zip(next(iter(models.values())))
        obj_destination, objects, extent, _ = self.copy_model(source, obj_zip, rail_id)
        if not any(o.upper().startswith("RAIL_") for o in objects):
            raise ValueError("no RAIL_* objects, not a track tile")
        model_json = deep_merge({"obj": self.model_location(obj_destination)},
                                self.rail_overrides.get(rail_id, {}))
        self.generated[f"assets/{self.namespace}/rail_models/{rail_id}.json"] = dump(model_json)
        name = ir.get("name", rail_id)
        self.langs["en_us"][f"rail.{self.namespace}.{rail_id}"] = name
        self.rails.append((rail_id, source.label, name))
        print(f"  rail {self.namespace}:{rail_id:23} tile {model_json.get('tile_length', 1.0):5.3f}  {name}")

    def convert_stock(self, source, category, entry, type_id):
        ir = lenient_json(source.read(entry))
        obj_zip = ir_location_to_zip(ir["model"])
        obj_destination, objects, extent, boxes = self.copy_model(source, obj_zip, type_id)
        obj_folder = posixpath.dirname(obj_zip)

        overrides = self.overrides.get(type_id, {})
        type_json = deep_merge(derive_type(category, ir, extent), overrides.get("type", {}))
        # walkable cars from the IR conventions (SPEC §9.6), unless the recipe says otherwise
        if "interior" not in type_json:
            interior = derive_interior(category, ir)
            if interior is not None:
                type_json["interior"] = interior
        if "doors" not in type_json and "interior" in type_json:
            doors = derive_doors(boxes)
            if doors:
                type_json["doors"] = doors
        door_ids = {door["id"].lower() for door in type_json.get("doors", [])}

        liveries = {}
        for livery, folder in ir.get("tex_variants", {}).items():
            files = source.files_under(join(obj_folder, folder))
            if not files:
                self.warn(f"{type_id}: livery {livery} folder {folder} is empty or missing")
                continue
            for file_zip in files:
                self.copy(source, file_zip)
            liveries[sanitize_id(livery)] = folder

        animations = {}
        ir_animations = {}  # every IR animation: control group → the objects it moves
        for animation in ir.get("animations", []):
            group = animation.get("control_group", "")
            anim_zip = ir_location_to_zip(animation["animatrix"])
            if source.exists(anim_zip):
                ir_animations[group] = [o for o in anim_objects(source.read(anim_zip)) if o in boxes]
            if group.lower() not in door_ids:
                continue  # only doors the type declares are driven (SPEC §6.3)
            if source.exists(anim_zip):
                animations[group.lower()] = self.model_location(self.copy(source, anim_zip))
            else:
                self.warn(f"{type_id}: animation {anim_zip} missing")

        model_json = {"obj": self.model_location(obj_destination)}
        if animations:
            model_json["animations"] = animations
        if liveries:
            model_json["liveries"] = liveries
        model_json = deep_merge(model_json, overrides.get("model", {}))

        if self.geometry is not None:
            self.write_geometry(source, obj_zip, type_id, category, ir, extent, boxes, ir_animations)
        self.generated[f"data/{self.namespace}/wagon_types/{type_id}.json"] = dump(type_json)
        self.generated[f"assets/{self.namespace}/wagon_models/{type_id}.json"] = dump(model_json)
        name = ir.get("name", type_id)
        self.langs["en_us"][f"wagon.{self.namespace}.{type_id}"] = name
        self.add_names(type_id, overrides, boxes)
        self.stock.append((type_id, source.label, category, name, len(liveries)))
        walk = ""
        if "interior" in type_json:
            doors = type_json.get("doors", [])
            walk = (f"  walk: {len(doors)} door(s)"
                    f" ({sum(1 for d in doors if d.get('connecting'))} gangway)")
        print(f"  {self.namespace}:{type_id:28} {category:11} {type_json['length']:7.3f} m "
              f"{type_json['mass_t']:7.1f} t  liveries={len(liveries):2}  {name}{walk}")

    def add_names(self, type_id, overrides, boxes):
        """A per-type file's "name" and "lights" → the pack's lang files (SPEC §8, §9.6)."""
        for lang, text in overrides.get("name", {}).items():
            self.langs.setdefault(lang, {})[f"wagon.{self.namespace}.{type_id}"] = text
        groups = light_groups(boxes)
        for group, names in overrides.get("lights", {}).items():
            if group not in groups:
                self.warn(f"{type_id}: \"lights\" names {group}, which isn't a light group of the model"
                          f" ({', '.join(groups) or 'it has none'})")
            for lang, text in names.items():
                self.langs.setdefault(lang, {})[f"light.{self.namespace}.{type_id}.{group}"] = text

    def write_geometry(self, source, obj_zip, type_id, category, ir, extent, boxes, ir_animations):
        """<geometry>/<id>.json: the numbers a floor is measured from (see --geometry)."""
        interior = derive_interior(category, ir)
        digest = {
            "_about": "RWAT model space (+Z forward, Y up, X across; railhead y 0.406). Generated by "
                      "tools/ir2rwat.py --geometry from the IR pack; numbers only. SPEC 9.6.",
            "id": f"{self.namespace}:{type_id}",
            "category": category,
            "length": r(extent[1] - extent[0], 3),
            "ir_passenger": ir.get("passenger"),
            "derived": {"interior": interior, "doors": derive_doors(boxes) if interior else []},
            "doors_in_model": derive_doors(boxes),
            "door_motion": door_motion(boxes, {g.lower() for g in ir_animations}),
            "animations": dict(sorted(ir_animations.items())),
            "lights": light_groups(boxes),
            "floor_levels": [{"y": y, "area": a, "plan_min_x_z": box[:2], "plan_max_x_z": box[2:],
                              "objects": objects[:6]}
                             for y, a, box, objects in floor_levels(source.read(obj_zip))],
            "objects": {name: [r(v, 3) for v in box] for name, box in sorted(boxes.items())},
        }
        write_file(self.geometry / f"{type_id}.json", dump(digest))

    def write(self, out_dir, as_zip):
        pack_name = self.recipe["pack_dir"]
        first = self.sources[0]
        self.generated["pack.mcmeta"] = dump({
            "pack": {
                "pack_format": PACK_FORMAT_RESOURCES,
                "supported_formats": [PACK_FORMAT_RESOURCES, PACK_FORMAT_DATA],
                "description": self.recipe.get("description", pack_name),
            },
            "rwat": {
                "name": self.recipe.get("name", pack_name),
                "namespace": self.namespace,
                "converted_from": [s.path.name for s in self.sources],
                "license": self.recipe.get("license", "see the pack's own license"),
            },
        })
        for lang, entries in sorted(self.langs.items()):
            self.generated[f"assets/{self.namespace}/lang/{lang}.json"] = dump(dict(sorted(entries.items())))
        self.generated[MARKER] = self.notice().encode("utf-8")
        for extra in self.recipe.get("copy_root_files", []):
            if first.exists(extra):
                self.generated[extra] = first.read(extra)

        out_dir.mkdir(parents=True, exist_ok=True)
        if as_zip:
            target = out_dir / f"{pack_name}.zip"
            with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
                for path, data in sorted(self.generated.items()):
                    archive.writestr(path, data)
                for path, (source, zip_path) in sorted(self.files.items()):
                    archive.writestr(path, source.read(zip_path))
        else:
            target = out_dir / pack_name
            if target.exists():
                if any(target.iterdir()) and not (target / MARKER).exists():
                    sys.exit(f"{target} exists and wasn't written by ir2rwat — refusing to replace it")
                shutil.rmtree(target)
            for path, data in self.generated.items():
                write_file(target / path, data)
            for path, (source, zip_path) in self.files.items():
                write_file(target / path, source.read(zip_path))
        return target

    def notice(self):
        lines = [
            f"{self.recipe.get('name', self.recipe['pack_dir'])} — converted for Rails, Wheels & Trains (RWAT)",
            "",
            "Converted by tools/ir2rwat.py from the Immersive Railroading pack(s):",
        ]
        lines += [f"  - {s.path.name} ({s.label}) → assets/{self.namespace}/{s.root}/" for s in self.sources]
        lines += [
            "",
            "The models, textures, liveries and animations are the original files, copied",
            "unchanged; only the RWAT declarations (wagon_types/, wagon_models/,",
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
        return "\n".join(lines) + "\n"


def dump(value):
    text = json.dumps(value, indent=2, ensure_ascii=False)
    # keep short scalar arrays ([x, y, z], [front, rear]) on one line for hand editing
    text = re.sub(r"\[\s+([^\[\]{}]*?)\s+\]",
                  lambda m: "[" + ", ".join(p.strip() for p in m.group(1).split(",")) + "]", text)
    return (text + "\n").encode("utf-8")


def write_file(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("recipe", help="pack recipe, e.g. packs/mvp.json")
    parser.add_argument("--out", help="output folder (default: the recipe's \"out\", relative to it)")
    parser.add_argument("--zip", action="store_true", help="write <pack>.zip instead of a folder")
    parser.add_argument("--geometry", help="also write per-type geometry digests to this folder")
    args = parser.parse_args()
    # a Windows console isn't UTF-8: never die on a pack's non-ASCII name
    sys.stdout.reconfigure(errors="replace")

    converter = Converter(args.recipe, Path(args.geometry).resolve() if args.geometry else None)
    converter.convert()
    out = Path(args.out) if args.out else converter.recipe_path.parent / converter.recipe["out"]
    target = converter.write(out.resolve(), args.zip)
    print(f"\n{len(converter.stock)} stock type(s), {len(converter.rails)} rail style(s), "
          f"{len(converter.files)} asset file(s) -> {target}")
    if converter.warnings:
        print(f"{len(converter.warnings)} warning(s), see above")


if __name__ == "__main__":
    main()
