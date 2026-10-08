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
    assets/<ns>/lang/en_us.json         display names (wagon.<ns>.<id>, rail.<ns>.<id>)

IR carries none of RWAT's physics figures beyond mass, power, tractive effort
and speed, so the rest is derived by heuristics (see derive_type); a recipe's
"overrides" deep-merge over the generated declarations ("null" removes a field).

Several sources: the first one wins, later ones only add ids the earlier ones
lack. Each source lands under its own root folder, so shared textures of
different pack versions (common/…) never overwrite each other.

Usage:  python tools/ir2rwat.py packs/mvp.json [--out DIR] [--zip]

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
    """mtllib references, object names, and the travel-axis extent of the visible model."""
    libraries, objects = [], []
    positions = []
    min_x, max_x = math.inf, -math.inf
    visible = True
    for line in io.TextIOWrapper(io.BytesIO(raw), encoding="utf-8", errors="replace"):
        if line.startswith("v "):
            parts = line.split()
            positions.append(float(parts[1]))
        elif line.startswith(("o ", "g ")):
            name = line[2:].strip()
            objects.append(name)
            visible = "HIDE" not in name
        elif line.startswith("f ") and visible:
            for token in line.split()[1:]:
                index = int(token.split("/")[0])
                x = positions[index - 1 if index > 0 else len(positions) + index]
                min_x, max_x = min(min_x, x), max(max_x, x)
        elif line.startswith("mtllib "):
            libraries.append(line[len("mtllib "):].strip())
    return libraries, objects, (min_x, max_x)


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

    def __init__(self, recipe_path):
        self.recipe_path = Path(recipe_path).resolve()
        self.recipe = json.loads(self.recipe_path.read_text(encoding="utf-8"))
        base = self.recipe_path.parent
        self.namespace = self.recipe["namespace"]
        self.strip = self.recipe.get("id_strip_prefix", "")
        self.exclude = set(self.recipe.get("exclude", []))
        self.overrides = self.recipe.get("overrides", {})
        self.rail_exclude = set(self.recipe.get("rail_exclude", []))
        self.rail_overrides = self.recipe.get("rail_overrides", {})
        self.sources = [Source(base / s["zip"], s["root"], s.get("label", s["zip"]))
                        for s in self.recipe["sources"]]
        self.files = {}      # destination path → (source, zip path)
        self.generated = {}  # destination path → bytes
        self.lang = {}
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
        """Copy an OBJ with its MTLs and their textures; returns (destination, objects, extent)."""
        if not source.exists(obj_zip):
            raise ValueError(f"model {obj_zip} not in the pack")
        libraries, objects, extent = parse_obj(source.read(obj_zip))
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
        return obj_destination, objects, extent

    def convert_track(self, source, entry, rail_id):
        """An IR track type → an RWAT rail style: the tile OBJ as is, swept by the renderer."""
        ir = lenient_json(source.read(entry))
        models = ir.get("models", {})
        if not models:
            raise ValueError("no models")
        # IR keys models by gauge condition (">0.2"); RWAT has one gauge: take the first
        obj_zip = ir_location_to_zip(next(iter(models.values())))
        obj_destination, objects, extent = self.copy_model(source, obj_zip, rail_id)
        if not any(o.upper().startswith("RAIL_") for o in objects):
            raise ValueError("no RAIL_* objects, not a track tile")
        model_json = deep_merge({"obj": self.model_location(obj_destination)},
                                self.rail_overrides.get(rail_id, {}))
        self.generated[f"assets/{self.namespace}/rail_models/{rail_id}.json"] = dump(model_json)
        name = ir.get("name", rail_id)
        self.lang[f"rail.{self.namespace}.{rail_id}"] = name
        self.rails.append((rail_id, source.label, name))
        print(f"  rail {self.namespace}:{rail_id:23} tile {model_json.get('tile_length', 1.0):5.3f}  {name}")

    def convert_stock(self, source, category, entry, type_id):
        ir = lenient_json(source.read(entry))
        obj_zip = ir_location_to_zip(ir["model"])
        obj_destination, objects, extent = self.copy_model(source, obj_zip, type_id)
        obj_folder = posixpath.dirname(obj_zip)

        overrides = self.overrides.get(type_id, {})
        type_json = deep_merge(derive_type(category, ir, extent), overrides.get("type", {}))
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
        for animation in ir.get("animations", []):
            group = animation.get("control_group", "").lower()
            if group not in door_ids:
                continue  # only doors the type declares are driven (SPEC §6.3)
            anim_zip = ir_location_to_zip(animation["animatrix"])
            if source.exists(anim_zip):
                animations[group] = self.model_location(self.copy(source, anim_zip))
            else:
                self.warn(f"{type_id}: animation {anim_zip} missing")

        model_json = {"obj": self.model_location(obj_destination)}
        if animations:
            model_json["animations"] = animations
        if liveries:
            model_json["liveries"] = liveries
        model_json = deep_merge(model_json, overrides.get("model", {}))

        self.generated[f"data/{self.namespace}/wagon_types/{type_id}.json"] = dump(type_json)
        self.generated[f"assets/{self.namespace}/wagon_models/{type_id}.json"] = dump(model_json)
        name = ir.get("name", type_id)
        self.lang[f"wagon.{self.namespace}.{type_id}"] = name
        self.stock.append((type_id, source.label, category, name, len(liveries)))
        print(f"  {self.namespace}:{type_id:28} {category:11} {type_json['length']:7.3f} m "
              f"{type_json['mass_t']:7.1f} t  liveries={len(liveries):2}  {name}")

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
        self.generated[f"assets/{self.namespace}/lang/en_us.json"] = dump(dict(sorted(self.lang.items())))
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
    args = parser.parse_args()
    # a Windows console isn't UTF-8: never die on a pack's non-ASCII name
    sys.stdout.reconfigure(errors="replace")

    converter = Converter(args.recipe)
    converter.convert()
    out = Path(args.out) if args.out else converter.recipe_path.parent / converter.recipe["out"]
    target = converter.write(out.resolve(), args.zip)
    print(f"\n{len(converter.stock)} stock type(s), {len(converter.rails)} rail style(s), "
          f"{len(converter.files)} asset file(s) -> {target}")
    if converter.warnings:
        print(f"{len(converter.warnings)} warning(s), see above")


if __name__ == "__main__":
    main()
