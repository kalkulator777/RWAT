#!/usr/bin/env python3
"""objinfo — measure a stock model for its RWAT declaration (SPEC §9.6).

Prints what a pack author needs to write a wagon's walkable floor, doors and
driver's chair, in the RWAT model frame the type JSON uses (+Z forward, +Y up,
X across; the railhead at y 0.406):

    python tools/objinfo.py amendorf                  objects and their boxes
    python tools/objinfo.py amendorf --controls       grouped by IR control (DOOR_5, WIDGET_3, …)
    python tools/objinfo.py amendorf --grep "DOOR|SEAT"
    python tools/objinfo.py chme3 --floors --z -6 -3  floor heights in a window of the plan
    python tools/objinfo.py amendorf --doors          the doors ir2rwat derives (JSON)
    python tools/objinfo.py er2h --lights             light groups: lamps, headlights, switches

The model is a type id of a generated pack (default run/rwat_packs/
MatoiVanillaPack, see --pack) or a path to an .obj file.

--floors lists the up-facing horizontal surfaces by height, with their area
and plan extent — a floor shows up as a big area at one height (a vestibule
floor a step lower, a cab deck higher). Narrow it with --x/--z.

Python 3.9+, standard library only.
"""

import argparse
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ir2rwat  # noqa: E402  (shares the IR → RWAT frame and the door rules)

CONTROL_KEY = re.compile(
    r"(?:^|_)((?:DOOR|WIDGET|WINDOW|SEAT|THROTTLE|REVERSER|TRAIN_BRAKE|INDEPENDENT_BRAKE|IND_BRAKE"
    r"|GAUGE_[A-Z_]+?|HEADLIGHT|FULLBRIGHT|INTERIOR|BOGEY_FRONT|BOGEY_REAR|COUPLER_ENGAGED_[A-Z]+"
    r"|COUPLED_[A-Z]+)_\d+)(?=_|$)")


def find_obj(model, pack):
    path = Path(model)
    if path.suffix == ".obj" and path.exists():
        return path
    for declaration in sorted(Path(pack).glob(f"assets/*/wagon_models/{model}.json")):
        obj = json.loads(declaration.read_text(encoding="utf-8"))["obj"]
        namespace = declaration.parent.parent.name
        return Path(pack) / "assets" / namespace / obj
    sys.exit(f"no model '{model}': not an .obj path, nor a type in {pack}")


def floors(raw, x_range, z_range, min_area):
    """Print the up-facing horizontal surface area by height inside the plan window."""
    for y, area, box, objects in ir2rwat.floor_levels(raw, x_range, z_range, min_area):
        shown = ", ".join(objects[:3]) + (f" … +{len(objects) - 3}" if len(objects) > 3 else "")
        print(f"  y {y:7.3f}  area {area:7.2f}  x {box[0]:7.3f}..{box[2]:7.3f}"
              f"  z {box[1]:8.3f}..{box[3]:8.3f}  {shown}")


def fmt(box):
    return (f"[{box[0]:7.3f}, {box[1]:7.3f}, {box[2]:8.3f}] .. [{box[3]:7.3f}, {box[4]:7.3f}, {box[5]:8.3f}]"
            f"  size {box[3] - box[0]:6.3f} x {box[4] - box[1]:6.3f} x {box[5] - box[2]:6.3f}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                     formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    parser.add_argument("model", help="type id in the pack, or a path to an .obj")
    parser.add_argument("--pack", default="run/rwat_packs/MatoiVanillaPack", help="generated pack folder")
    parser.add_argument("--grep", help="only objects whose name matches this regex")
    parser.add_argument("--controls", action="store_true", help="group objects by IR control key")
    parser.add_argument("--floors", action="store_true", help="floor heights (up-facing surfaces)")
    parser.add_argument("--doors", action="store_true", help="the doors ir2rwat derives, as JSON")
    parser.add_argument("--lights", action="store_true", help="the model's light groups (SPEC §8), as JSON")
    parser.add_argument("--x", nargs=2, type=float, default=[-math.inf, math.inf], metavar=("MIN", "MAX"))
    parser.add_argument("--z", nargs=2, type=float, default=[-math.inf, math.inf], metavar=("MIN", "MAX"))
    parser.add_argument("--min-area", type=float, default=0.25, help="--floors: hide smaller levels")
    args = parser.parse_args()
    sys.stdout.reconfigure(errors="replace")

    obj = find_obj(args.model, args.pack)
    raw = obj.read_bytes()
    print(f"{obj}")
    if args.floors:
        floors(raw, args.x, args.z, args.min_area)
        return
    _, _, _, boxes = ir2rwat.parse_obj(raw)
    if args.doors:
        print(json.dumps(ir2rwat.derive_doors(boxes), indent=2))
        return
    if args.lights:
        print(json.dumps(ir2rwat.light_groups(boxes), indent=2, ensure_ascii=False))
        return
    pattern = re.compile(args.grep) if args.grep else None
    if args.controls:
        groups = {}
        for name, box in boxes.items():
            key = CONTROL_KEY.search(name)
            if key is None or (pattern and not pattern.search(name)):
                continue
            group = groups.setdefault(key.group(1), {"box": list(box), "names": []})
            group["names"].append(name)
            for i in range(3):
                group["box"][i] = min(group["box"][i], box[i])
                group["box"][i + 3] = max(group["box"][i + 3], box[i + 3])
        for key in sorted(groups):
            print(f"{key:22} {fmt(groups[key]['box'])}")
            for name in groups[key]["names"]:
                print(f"    {name}")
        return
    for name, box in boxes.items():
        if pattern is None or pattern.search(name):
            print(f"{name[:60]:60} {fmt(box)}")


if __name__ == "__main__":
    main()
