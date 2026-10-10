#!/usr/bin/env python3
"""Generate the track bed's blockstates and block models (SPEC §2.2).

Every bed material (rail.BedMaterial) is a block of its own with 8 heights
(the `layers` property, 2px each). The materials are read from
BedMaterial.java, so adding one there and running this script is all it takes:

    python -I tools/gen_track_bed.py

A material's texture is the vanilla block of the same name
(`minecraft:block/<id>`); TEXTURES overrides that. The invisible bed (no look
block) gets a model without faces — it never draws (RenderShape.INVISIBLE),
but its blockstate must resolve. Gravel keeps the old block name `track_bed`.

Writes (and replaces):
  assets/railswheelsandtrains/blockstates/track_bed*.json
  assets/railswheelsandtrains/models/block/track_bed/*.json
  assets/railswheelsandtrains/models/item/track_bed.json
and warns about bed blocks missing from the lang files.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "src/main/resources/assets/railswheelsandtrains"
ENUM = ROOT / "src/main/java/com/muzhik17/trainsmod/rail/BedMaterial.java"
NS = "railswheelsandtrains"
LAYERS = range(1, 9)
TEXTURES = {}  # material id → texture, where it isn't minecraft:block/<id>

CONSTANT = re.compile(r'^\s+[A-Z_]+\("([a-z0-9_]+)",\s*(Blocks\.[A-Z0-9_]+|null)', re.M)


def materials():
    """[(id, visible)] in enum order."""
    found = [(m[1], m[2] != "null") for m in CONSTANT.finditer(ENUM.read_text(encoding="utf-8"))]
    if not found or found[0][0] != "gravel":
        sys.exit(f"couldn't read the materials from {ENUM} (gravel must come first)")
    return found


def block_name(material):
    return "track_bed" if material == "gravel" else f"track_bed_{material}"


def dump(data):
    """2-space JSON with number arrays on one line, like the hand-written models."""
    text = json.dumps(data, indent=2, ensure_ascii=False)
    text = re.sub(r"\[\s+([-\d.,\s]+?)\s+\]",
                  lambda m: "[" + ", ".join(v.strip() for v in m[1].split(",")) + "]", text)
    return text + "\n"


def base_model(layers):
    """A bed `layers` eighths high, every face in #all; the template the materials retexture."""
    faces = {"down": {"texture": "#all", "cullface": "down"},
             "up": {"texture": "#all", "cullface": "up"} if layers == 8 else {"texture": "#all"}}
    for side in ("north", "south", "west", "east"):
        faces[side] = {"texture": "#all", "cullface": side}
    return {"parent": "minecraft:block/block",
            "textures": {"particle": "#all"},
            "elements": [{"from": [0, 0, 0], "to": [16, 2 * layers, 16], "faces": faces}]}


def main():
    found = materials()
    models = ASSETS / "models/block/track_bed"
    blockstates = ASSETS / "blockstates"
    for old in list(models.glob("*.json")) + list(blockstates.glob("track_bed*.json")):
        old.unlink()
    models.mkdir(parents=True, exist_ok=True)

    files = {}
    for layers in LAYERS:
        files[models / f"base_{layers}.json"] = base_model(layers)
    for material, visible in found:
        if visible:
            texture = TEXTURES.get(material, f"minecraft:block/{material}")
            variants = {}
            for layers in LAYERS:
                files[models / f"{material}_{layers}.json"] = {
                    "parent": f"{NS}:block/track_bed/base_{layers}",
                    "textures": {"all": texture}}
                variants[f"layers={layers}"] = {"model": f"{NS}:block/track_bed/{material}_{layers}"}
        else:
            files[models / f"{material}.json"] = {"textures": {"particle": "minecraft:item/barrier"}}
            variants = {f"layers={layers}": {"model": f"{NS}:block/track_bed/{material}"} for layers in LAYERS}
        files[blockstates / f"{block_name(material)}.json"] = {"variants": variants}
    files[ASSETS / "models/item/track_bed.json"] = {"parent": f"{NS}:block/track_bed/gravel_1"}

    for path, data in files.items():
        path.write_text(dump(data), encoding="utf-8")
    print(f"{len(found)} bed materials, {len(files)} files written")

    for lang in sorted((ASSETS / "lang").glob("*.json")):
        keys = json.loads(lang.read_text(encoding="utf-8"))
        missing = [block_name(m) for m, _ in found if f"block.{NS}.{block_name(m)}" not in keys]
        if missing:
            print(f"warning: {lang.name} has no name for {', '.join(missing)}")


if __name__ == "__main__":
    main()
