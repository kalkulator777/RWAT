"""Builders for the tool tests: a synthetic Immersive Railroading pack, made with
the standard library only (zipfile), and a recipe for it.

The pack is small but has what a foreign IR pack has that MVP doesn't: a model
path with capitals and a space, textures outside models/ reached through
../, a livery folder and a sound in another letter case, an unknown era, a
door named with Blender's .001 — next to a freight wagon whose files are all
valid, copied byte for byte.
"""

import contextlib
import io
import json
import sys
import zipfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

import floorgen  # noqa: E402
import ir2rwat  # noqa: E402

IR = "assets/immersiverailroading/"
COACH_DIR = IR + "models/rolling_stock/passenger/Test_Coach/"
HOPPER_DIR = IR + "models/rolling_stock/freight/hopper/"
LOCO_DIR = IR + "models/rolling_stock/locomotives/loco/"


def cuboid(lo, hi):
    """The 8 corners and 6 faces (1-based, local) of a box in IR space; the top faces up."""
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    corners = [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1),
               (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]
    faces = [(1, 2, 3, 4), (5, 8, 7, 6), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 8, 4), (4, 8, 5, 1)]
    return corners, faces


def floor_quad(x0, x1, y, z0, z1):
    """An up-facing floor in IR space."""
    return [(x0, y, z0), (x0, y, z1), (x1, y, z1), (x1, y, z0)], [(1, 2, 3, 4)]


def obj(objects, mtllib=None, material="body"):
    """OBJ text: objects = [(name, (corners, faces))]."""
    lines = [f"mtllib {mtllib}"] if mtllib else []
    base = 0
    for name, (corners, faces) in objects:
        lines.append(f"o {name}")
        lines += [f"v {x} {y} {z}" for x, y, z in corners]
        lines.append(f"usemtl {material}")
        lines += ["f " + " ".join(str(base + i) for i in face) for face in faces]
        base += len(corners)
    return ("\n".join(lines) + "\n").encode("utf-8")


# the coach's floor: OBJ y 0.9 (the engine's 0.9 + Y_LIFT); IR's passenger centre_y sits 0.1 under the latter
FLOOR_Y = 0.9
COACH_OBJ = obj([
    ("FLOOR", floor_quad(-5.0, 5.0, FLOOR_Y, -1.4, 1.4)),
    ("DOOR_1_EXTERNAL", cuboid((-1.0, FLOOR_Y, 1.35), (0.0, 3.0, 1.45))),
    ("WIDGET_2_TOGGLE_CG_DoorA", cuboid((2.95, FLOOR_Y, -0.5), (3.05, 3.0, 0.5))),
    ("DOOR_3.001", cuboid((-4.0, FLOOR_Y, -1.45), (-3.0, 3.0, -1.35))),
], mtllib="Coach Mats.mtl")
COACH_MTL = (b"newmtl body\nmap_Kd ../../../../textures/Coach/Body.png\n"
             b"newmtl glass\r\nmap_Kd Glass.PNG\r\n")
HOPPER_OBJ = obj([("BODY", cuboid((-4.0, 0.5, -1.4), (4.0, 2.5, 1.4)))], mtllib="hopper.mtl")
HOPPER_MTL = b"newmtl body\nmap_Kd hopper.png\n"
LOCO_OBJ = obj([("BODY", cuboid((-7.0, 0.5, -1.5), (7.0, 3.5, 1.5)))], mtllib="loco.mtl")
LOCO_MTL = b"newmtl body\nmap_Kd loco.png\n"
RAIL_OBJ = obj([("RAIL_LEFT", cuboid((-0.5, 0.0, -0.8), (0.5, 0.2, -0.7))),
                ("RAIL_RIGHT", cuboid((-0.5, 0.0, 0.7), (0.5, 0.2, 0.8)))])


def definition(**fields):
    return json.dumps(fields, indent=2).encode("utf-8")


def coach_json(**extra):
    fields = {
        "name": "Test Coach",
        # another letter case than the zip's entry, and a space: found anyway, renamed when copied
        "model": "immersiverailroading:models/rolling_stock/passenger/test_coach/Test Coach.obj",
        "properties": {"weight_kg": 30000, "max_speed_kmh": 100},
        "trucks": {"front": 3.0, "rear": -3.0},
        "couplers": {"front_offset": 0.0, "rear_offset": 0.0},
        "passenger": {"center_x": 0.0, "center_y": FLOOR_Y + floorgen.Y_LIFT - ir2rwat.IR_FLOOR_OFFSET,
                      "length": 4.5, "width": 2.6},
        "tex_variants": {"Red Line": "L_Red"},
        "animations": [{"control_group": "DoorA",
                        "animatrix": "immersiverailroading:models/rolling_stock/passenger/test_coach/anim/DoorA.anim"}],
        "sounds": {"idle": "immersiverailroading:sounds/Coach/Hum.ogg"},
        "era": "steam",
    }
    fields.update(extra)
    return definition(**fields)


def pack_files(prefix=""):
    """{zip entry: bytes} of the synthetic IR pack (prefix: a folder it is zipped in)."""
    files = {
        "pack.mcmeta": b'{"pack": {"pack_format": 3, "description": "test"}}',
        "LICENSE.txt": b"CC0\n",
        IR + "rolling_stock/stock.json": b'{"passenger": ["test_coach"]}',
        # a hand-edited definition: a BOM, comments, a trailing comma — and a string that looks like them
        IR + "rolling_stock/passenger/test_coach.json": b"\xef\xbb\xbf// the test coach\n" + coach_json(),
        COACH_DIR + "Test Coach.obj": COACH_OBJ,
        COACH_DIR + "Coach Mats.mtl": COACH_MTL,
        COACH_DIR + "Glass.PNG": b"glass-png",
        COACH_DIR + "L_Red/Body.png": b"red-body-png",
        COACH_DIR + "anim/DoorA.anim": b"O WIDGET_2_TOGGLE_CG_DoorA\n",
        IR + "textures/Coach/Body.png": b"body-png",
        IR + "sounds/Coach/Hum.ogg": b"hum-ogg",
        IR + "rolling_stock/freight/hopper.json": (
            b"{\n  \"name\": \"Hopper [ 15-1443 ] car, // not a comment\",  // a comment\n"
            b"  \"model\": \"immersiverailroading:models/rolling_stock/freight/hopper/hopper.obj\",\n"
            b"  /* a block\n     comment */\n"
            b"  \"properties\": {\"weight_kg\": 20000,},\n"
            b"  \"trucks\": {\"front\": 2.5, \"rear\": -2.5},\n"
            b"  \"tex_variants\": {\"Green\": \"l_green\"},\n}\n"),
        HOPPER_DIR + "hopper.obj": HOPPER_OBJ,
        HOPPER_DIR + "hopper.mtl": HOPPER_MTL,
        HOPPER_DIR + "hopper.png": b"hopper-png",
        HOPPER_DIR + "l_green/hopper.png": b"green-hopper-png",
        IR + "rolling_stock/locomotives/loco.json": definition(
            name="Loco", model="immersiverailroading:models/rolling_stock/locomotives/loco/loco.obj",
            properties={"weight_kg": 80000, "horsepower": 1000, "max_speed_kmh": 100},
            trucks={"front": 4.0, "rear": -4.0}, era="diesel",
            sounds={"idle": "immersiverailroading:sounds/loco/idle.ogg"}),
        LOCO_DIR + "loco.obj": LOCO_OBJ,
        LOCO_DIR + "loco.mtl": LOCO_MTL,
        LOCO_DIR + "loco.png": b"loco-png",
        IR + "sounds/loco/idle.ogg": b"idle-ogg",
        IR + "track/track.json": b'{"track": ["rail_a"]}',
        IR + "track/rail_a.json": definition(name="Rail A", models={">0": "immersiverailroading:models/track/rail_a/rail_a.obj"}),
        IR + "models/track/rail_a/rail_a.obj": RAIL_OBJ,
    }
    return {prefix + name: data for name, data in files.items()}


def broken_files():
    """Definitions that each break one type in a different way."""
    return {
        IR + "rolling_stock/freight/bad_json.json": b'{"name": "Bad", "model": ',
        IR + "rolling_stock/freight/no_model.json": definition(
            name="No model", model="immersiverailroading:models/rolling_stock/freight/nothing/nothing.obj"),
        IR + "rolling_stock/freight/no_model_key.json": definition(name="No model key"),
        # an AttributeError deep in the converter: a run used to die on it
        IR + "rolling_stock/freight/bad_trucks.json": definition(
            name="Bad trucks", model="immersiverailroading:models/rolling_stock/freight/hopper/hopper.obj",
            trucks="oops"),
        # an IndexError while reading the OBJ: a run used to die on it too
        IR + "rolling_stock/freight/bad_obj.json": definition(
            name="Bad OBJ", model="immersiverailroading:models/rolling_stock/freight/bad_obj/bad_obj.obj"),
        IR + "models/rolling_stock/freight/bad_obj/bad_obj.obj": b"o X\nv 0 0 0\nv 1 0 0\nf 1 2 99\n",
        # two definitions that convert to one id, and a type with two liveries that do
        IR + "rolling_stock/freight/Twin Car.json": definition(
            name="Twin 1", model="immersiverailroading:models/rolling_stock/freight/hopper/hopper.obj"),
        IR + "rolling_stock/tank/twin_car.json": definition(
            name="Twin 2", model="immersiverailroading:models/rolling_stock/freight/hopper/hopper.obj"),
        IR + "rolling_stock/freight/livery_twins.json": definition(
            name="Livery twins", model="immersiverailroading:models/rolling_stock/freight/hopper/hopper.obj",
            tex_variants={"Red": "l_green", "red": "l_green"}),
        # two textures that land on one path
        IR + "rolling_stock/freight/clash.json": definition(
            name="Clash", model="immersiverailroading:models/rolling_stock/freight/clash/clash.obj"),
        IR + "models/rolling_stock/freight/clash/clash.obj": obj(
            [("BODY", cuboid((-1, 0, -1), (1, 1, 1)))], mtllib="clash.mtl"),
        IR + "models/rolling_stock/freight/clash/clash.mtl": b"newmtl a\nmap_Kd A B.png\nnewmtl b\nmap_Kd a_b.png\n",
        IR + "models/rolling_stock/freight/clash/A B.png": b"one",
        IR + "models/rolling_stock/freight/clash/a_b.png": b"two",
    }


def zip_slip_files():
    """Entries that would land outside the pack, and a livery folder that climbs out."""
    return {
        "../evil.txt": b"evil",
        "/abs_evil.txt": b"evil",
        IR + "models/rolling_stock/freight/hopper/l_x/../../../../../../../../evil2.png": b"evil",
        IR + "rolling_stock/freight/climber.json": definition(
            name="Climber", model="immersiverailroading:models/rolling_stock/freight/hopper/hopper.obj",
            tex_variants={"Out": "../../../../../../../../../tmp"}),
    }


def write_zip(path, files):
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return path


def write_recipe(folder, zips, **extra):
    """packs-style recipe in folder: sources = [(zip name, root)]."""
    recipe = {
        "name": "Test Pack",
        "pack_dir": "TestPack",
        "namespace": "tp",
        "description": "test",
        "license": "CC0",
        "out": "out",
        "id_strip_prefix": "",
        "sources": [{"zip": z, "root": root, "label": z} for z, root in zips],
        "copy_root_files": ["LICENSE.txt"],
    }
    recipe.update(extra)
    path = Path(folder) / "recipe.json"
    path.write_text(json.dumps(recipe, indent=2), encoding="utf-8")
    return path


def quiet(function, *args, **kwargs):
    """Call function with stdout and stderr captured: (result, stdout, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        result = function(*args, **kwargs)
    return result, out.getvalue(), err.getvalue()


def convert(recipe, *args):
    """ir2rwat's command line in-process: (exit status, stdout, stderr)."""
    return quiet(ir2rwat.main, [str(recipe), *map(str, args)])
