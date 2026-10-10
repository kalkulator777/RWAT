#!/usr/bin/env python3
"""floorgen — the walkable floor of an IR model, from its triangles (SPEC §9.8).

ir2rwat calls this for every passenger car (and for a locomotive whose
per-type file opts in) that has no hand-made "interior": the result is a list
of axis-aligned floor boxes, the format the engine reads (stock.FloorRegion).
How it goes, in RWAT model space (+Z forward, X across, Y up):

 1. Floor level: the big up-facing surface inside the body (platzkart 1.811,
    69 m2), the one nearest IR's passenger area (center_y + 0.1) — or the
    level the per-type file names.
 2. A grid of 1/16 block cells. A cell is FLOOR if an up-facing triangle at
    the level covers its centre.
 3. A cell is an OBSTACLE if any triangle crosses the player's body slab
    (level + 0.3 … level + 1.8) over it — every cell the triangle's footprint
    touches (conservative: bunks, partitions, walls, closed door leaves).
    HIDE objects are skipped: IR draws them only when a control group shows
    them (a closed-state mesh, never a wall); "ignore" skips more by name.
 4. CLEARANCE (default 0.1): the player may lean into a wall by that much,
    else the platzkart aisle (0.53 wide, the player 0.6) is impassable. An
    obstacle gives up that depth to the free cells next to it, but never the
    last cell of a run: a thin wall stays a wall (the engine reads a gap of
    any width as a wall, so one cell is enough).
 5. add / remove boxes of the per-type file are applied.
 6. REACHABLE only: the engine's own rule (FloorRegion: a centre fits where
    a 0.6 × 0.6 square lies inside the union) is run on the boxes; what is
    kept is what a rider can reach from an external or connecting door,
    through inner doors (open-door bridges as RiderWalk makes them). Closets
    with no door, and floor under the frame outside the walls, fall away.
    With no such door in the model the largest piece is kept.
 7. The free cells are tiled into maximal rectangles (the better of rows and
    columns); box min y = the level, max y = level + 2.5. Coordinates are
    multiples of 1/16, written with 4 decimals (3 would round 0.0625).

Per-type exceptions — generator input, a top-level "floor" key in
packs/<recipe>/<id>.json (next to "name", "lights"; NOT inside "type"). All
members optional; "floor": {} on a locomotive turns the generator on for it
(a walkable cab also needs cab.seat, which stays manual); a "type.interior"
of the same file wins over the generated one:

    "floor": {
      "clearance": 0.1,              how far a body may lean into a wall
      "level": 1.81,                 floor height (a number) or [heights] for
                                     steps; default: found (locomotives: required)
      "add":    [{"min": [x, y, z], "max": [x, y, z]}],   free cells (x, z; y picks
                                     the level if there are several), before
                                     the reachability step
      "remove": [{"min": [x, y, z], "max": [x, y, z]}],   blocked cells (x, z)
      "ignore": ["<object name or regex>"],               objects not an obstacle
      "slab":   [0.3, 1.8],          the body above the floor (default)
      "cell":   0.0625,              grid (default 1/16)
      "step_down": 0.15              a surface this far below the level is floor too
    }

Command line, one type at a time (map of floor / obstacles / where a centre
fits / doors; --compare against the type's hand "interior"):

    python -I tools/floorgen.py packs/mvp.json amendorf --ascii
    python -I tools/floorgen.py packs/mvp.json amendorf --png SCRATCH/am.png --compare

Python 3.9+, standard library only.
"""

import argparse
import bisect
import io
import json
import math
import re
import struct
import sys
import zlib
from pathlib import Path

CELL = 1.0 / 16.0
# the engine's figures (kinematics.RiderWalk): the half-width of a rider, how far
# inside a door's edges a centre must be, the reach of an open inner door's
# bridge, how far from the floor's end a hull door may sit
HALF_WIDTH = 0.3
DOOR_SPAN_INSET = 0.1
BRIDGE_REACH = 0.6
DOOR_WALL_SLACK = 0.4
SPAN_STEP = 0.05
ZONE_HEIGHT = 2.5
EPS = 1.0e-9
# a surface this close to level is the floor; up-facing = normal.y at least this
LEVEL_TOLERANCE = 0.04
# a step this far below the level is still floor (the vestibule sills of the DR1a, 0.13)
STEP_DOWN = 0.15
UP_FACING = 0.95
MIN_LEVEL_AREA = 1.0
OPTIONS = {"clearance", "level", "add", "remove", "ignore", "slab", "cell", "step_down"}


# ----------------------------------------------------------------- the model

def read_triangles(raw, y_lift):
    """([names], [(name index, 9 floats)]) of an OBJ in RWAT model space
    (rx, ry, rz = z, y + y_lift, -x as ir2rwat maps IR's frame); polygons are
    fanned into triangles."""
    positions = []
    names = []
    current = -1
    triangles = []
    for line in io.TextIOWrapper(io.BytesIO(raw), encoding="utf-8", errors="replace"):
        if line.startswith("v "):
            p = line.split()
            positions.append((float(p[3]), float(p[2]) + y_lift, -float(p[1])))
        elif line.startswith(("o ", "g ")):
            name = line[2:].strip()
            if name in names:
                current = names.index(name)
            else:
                names.append(name)
                current = len(names) - 1
        elif line.startswith("f "):
            corners = []
            for token in line.split()[1:]:
                index = int(token.split("/")[0])
                corners.append(positions[index - 1 if index > 0 else len(positions) + index])
            for i in range(1, len(corners) - 1):
                a, b, c = corners[0], corners[i], corners[i + 1]
                triangles.append((current, a + b + c))
    return names, triangles


def normal(t):
    """The triangle's normal (twice-area long): (nx, ny, nz)."""
    ux, uy, uz = t[3] - t[0], t[4] - t[1], t[5] - t[2]
    vx, vy, vz = t[6] - t[0], t[7] - t[1], t[8] - t[2]
    return uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx


def find_levels(triangles, merge=0.02):
    """Up-facing surfaces by height: [(y, area, (min x, min z, max x, max z))],
    heights within `merge` of each other made one level (area-weighted mean)."""
    acc = {}
    for _, t in triangles:
        nx, ny, nz = normal(t)
        length = math.sqrt(nx * nx + ny * ny + nz * nz)
        if length < 1e-12 or ny / length < UP_FACING:
            continue
        slot = acc.setdefault(round((t[1] + t[4] + t[7]) / 3.0, 2), [0.0, 0.0, [math.inf, math.inf, -math.inf, -math.inf]])
        area = length / 2.0
        slot[0] += area
        slot[1] += area * (t[1] + t[4] + t[7]) / 3.0
        box = slot[2]
        for i in (0, 3, 6):
            box[0], box[1] = min(box[0], t[i]), min(box[1], t[i + 2])
            box[2], box[3] = max(box[2], t[i]), max(box[3], t[i + 2])
    levels = []
    for key in sorted(acc):
        area, weighted, box = acc[key]
        if levels and key - levels[-1][3] <= merge:
            last = levels[-1]
            last[0] += area
            last[1] += weighted
            last[2] = [min(last[2][0], box[0]), min(last[2][1], box[1]), max(last[2][2], box[2]), max(last[2][3], box[3])]
            last[3] = key
        else:
            levels.append([area, weighted, box, key])
    return [(w / a, a, tuple(b)) for a, w, b, _ in levels]


# -------------------------------------------------------------- configuration

class FloorConfig:
    """The per-type "floor" object (see the module docstring)."""

    def __init__(self, options=None):
        options = dict(options or {})
        unknown = set(options) - OPTIONS
        if unknown:
            raise ValueError(f"\"floor\": unknown key(s) {sorted(unknown)}; known: {sorted(OPTIONS)}")
        self.clearance = float(options.get("clearance", 0.1))
        level = options.get("level")
        self.levels = None if level is None else [float(v) for v in (level if isinstance(level, list) else [level])]
        self.add = [self.box(b, "add") for b in options.get("add", [])]
        self.remove = [self.box(b, "remove") for b in options.get("remove", [])]
        self.ignore = [re.compile(p) for p in options.get("ignore", [])]
        slab = options.get("slab", [0.3, 1.8])
        self.slab = (float(slab[0]), float(slab[1]))
        self.cell = float(options.get("cell", CELL))
        self.step_down = float(options.get("step_down", STEP_DOWN))

    @staticmethod
    def box(b, what):
        if not (isinstance(b, dict) and len(b.get("min", [])) == 3 and len(b.get("max", [])) == 3):
            raise ValueError(f"\"floor\".{what}: each entry is {{\"min\": [x, y, z], \"max\": [x, y, z]}}")
        return {"min": [float(v) for v in b["min"]], "max": [float(v) for v in b["max"]]}


# ---------------------------------------------------------- the engine's rule

class Door:
    """A type's door as the engine reads it (WagonType.Door)."""

    def __init__(self, d):
        self.id = d.get("id", "?")
        self.min = list(d["min"])
        self.max = list(d["max"])
        self.inner = bool(d.get("inner"))
        self.fixed = bool(d.get("fixed"))
        self.connecting = bool(d.get("connecting"))

    @property
    def axis(self):
        return 0 if self.max[0] - self.min[0] <= self.max[2] - self.min[2] else 2

    @property
    def outward(self):
        a = self.axis
        return 1 if self.min[a] + self.max[a] >= 0.0 else -1

    @property
    def inner_face(self):
        a = self.axis
        return self.min[a] if self.outward > 0 else self.max[a]

    @property
    def span(self):
        a = 2 if self.axis == 0 else 0
        return self.min[a], self.max[a]

    def faces(self, wall):
        """RiderWalk.facesDoor: a floor whose centres reach `wall` ends at this door."""
        out = self.outward
        gap = out * (self.inner_face - (wall + out * HALF_WIDTH))
        return -DOOR_WALL_SLACK <= gap <= DOOR_WALL_SLACK

    def bridge(self):
        """(min x, min z, max x, max z) where a centre may be in this door open (inner)."""
        lo, hi = self.span[0] + DOOR_SPAN_INSET, self.span[1] - DOOR_SPAN_INSET
        if self.axis == 0:
            return self.min[0] - BRIDGE_REACH, lo, self.max[0] + BRIDGE_REACH, hi
        return lo, self.min[2] - BRIDGE_REACH, hi, self.max[2] + BRIDGE_REACH


def _unique(values):
    out = []
    for v in sorted(values):
        if not out or v - out[-1] > EPS:
            out.append(v)
    return out


def _merge(spans):
    out = []
    for a, b in sorted(spans):
        if out and a <= out[-1][1] + EPS:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def _shrink(spans, m):
    out = []
    for a, b in spans:
        a, b = a + m, b - m
        if b >= a - 2 * EPS:
            if b < a:
                a = b = (a + b) * 0.5
            out.append((a, b))
    return out


def _intersect(a, b):
    out = []
    i = j = 0
    while i < len(a) and j < len(b):
        lo, hi = max(a[i][0], b[j][0]), min(a[i][1], b[j][1])
        if hi >= lo - EPS:
            out.append((lo, max(lo, hi)))
        if a[i][1] < b[j][1]:
            i += 1
        else:
            j += 1
    return out


class Region:
    """Where a rider's centre fits on a union of boxes (a port of
    stock.FloorRegion): pieces (minX, minZ, maxX, maxZ), closed boxes in Z order."""

    def __init__(self, boxes, margin=HALF_WIDTH):
        """boxes: [(min x, min z, max x, max z)]."""
        self.margin = margin
        self.strip_z = _unique([b[1] for b in boxes] + [b[3] for b in boxes])
        self.strip_x = []
        for k in range(len(self.strip_z) - 1):
            lo, hi = self.strip_z[k], self.strip_z[k + 1]
            self.strip_x.append(_merge([(b[0], b[2]) for b in boxes
                                        if b[1] <= lo + EPS and b[3] >= hi - EPS and b[2] >= b[0]]))
        self.shrunk = [_shrink(s, margin) for s in self.strip_x]
        self.pieces = self.build()
        self.max_z = [p[3] for p in self.pieces]

    def build(self):
        z = self.strip_z
        if len(z) < 2:
            return []
        m = self.margin
        lo, hi = z[0] + m, z[-1] - m
        if hi < lo - EPS:
            return []
        cuts = []
        for v in z:
            cuts += [v - m, v + m]
        cuts += [lo, max(lo, hi)]
        breaks = [v for v in _unique(cuts) if lo - EPS <= v <= max(lo, hi) + EPS]
        out = []
        for i, v in enumerate(breaks):
            for a, b in self.slice(v):
                out.append((a, v, b, v))
            if i + 1 < len(breaks) and breaks[i + 1] - v > EPS:
                for a, b in self.slice((v + breaks[i + 1]) * 0.5):
                    out.append((a, v, b, breaks[i + 1]))
        return out

    def slice(self, z):
        lo, hi = z - self.margin, z + self.margin
        if lo < self.strip_z[0] - EPS or hi > self.strip_z[-1] + EPS:
            return []
        k0 = max(0, bisect.bisect_right(self.strip_z, lo + EPS) - 1)
        fit = None
        k = k0
        while k < len(self.strip_x) and self.strip_z[k] < hi - EPS:
            if self.strip_z[k + 1] > lo + EPS:
                fit = self.shrunk[k] if fit is None else _intersect(fit, self.shrunk[k])
                if not fit:
                    break
            k += 1
        return fit or []

    def fits(self, x, z):
        i = bisect.bisect_left(self.max_z, z - EPS)
        while i < len(self.pieces):
            p = self.pieces[i]
            if p[1] > z + EPS:
                break
            if p[0] - EPS <= x <= p[2] + EPS:
                return True
            i += 1
        return False

    def reach(self, x, z, axis, direction):
        """FloorRegion.reach: how far a centre at (x, z) can slide along an axis (NaN: not on the floor)."""
        if not self.fits(x, z):
            return math.nan
        at = x if axis == 0 else z
        grew = True
        while grew:
            grew = False
            for p in self.pieces:
                on_line = (p[1] - EPS <= z <= p[3] + EPS) if axis == 0 else (p[0] - EPS <= x <= p[2] + EPS)
                lo, hi = (p[0], p[2]) if axis == 0 else (p[1], p[3])
                if not on_line or at < lo - EPS or at > hi + EPS:
                    continue
                end = hi if direction > 0 else lo
                if direction * (end - at) > EPS:
                    at = end
                    grew = True
        return at

    def area(self):
        return sum((p[2] - p[0]) * (p[3] - p[1]) for p in self.pieces)

    def components(self, doors=()):
        """Piece index → component number, pieces that touch (and those an open
        inner door bridges) one component. Returns (labels, count)."""
        parent = list(range(len(self.pieces)))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        def union(a, b):
            parent[find(a)] = find(b)

        pcs = self.pieces
        for i, a in enumerate(pcs):
            for j in range(i + 1, len(pcs)):
                b = pcs[j]
                if b[1] > a[3] + EPS:
                    break
                if min(a[2], b[2]) >= max(a[0], b[0]) - EPS and min(a[3], b[3]) >= max(a[1], b[1]) - EPS:
                    union(i, j)
        for door in doors:
            if door.inner:
                bx = door.bridge()
                first = -1
                for i, p in enumerate(pcs):
                    if min(p[2], bx[2]) >= max(p[0], bx[0]) - EPS and min(p[3], bx[3]) >= max(p[1], bx[1]) - EPS:
                        if first < 0:
                            first = i
                        else:
                            union(first, i)
        roots = {}
        labels = []
        for i in range(len(pcs)):
            labels.append(roots.setdefault(find(i), len(roots)))
        return labels, len(roots)

    def door_seeds(self, door):
        """Indices of the pieces from which a rider can walk out through a hull or
        gangway door (FloorCheck.walkableThrough): a player fits in front of it,
        inside its span, with the floor ending at its inner face."""
        side = door.axis == 0
        out = door.outward
        lo, hi = door.span[0] + DOOR_SPAN_INSET, door.span[1] - DOOR_SPAN_INSET
        seeds = []
        for i, p in enumerate(self.pieces):
            p_lo, p_hi = max(lo, p[1] if side else p[0]), min(hi, p[3] if side else p[2])
            if p_hi < p_lo:
                continue
            across = (p[2] if out > 0 else p[0]) if side else (p[3] if out > 0 else p[1])
            along = p_lo
            while True:
                wall = self.reach(across, along, 0, out) if side else self.reach(along, across, 2, out)
                if not math.isnan(wall) and door.faces(wall):
                    seeds.append(i)
                    break
                if along >= p_hi:
                    break
                along = min(p_hi, along + SPAN_STEP)
        return seeds


def overlap_area(a, b):
    """Area of the intersection of two regions' pieces (each region's pieces are disjoint)."""
    total = 0.0
    for p in a.pieces:
        i = bisect.bisect_left(b.max_z, p[1] - EPS)
        while i < len(b.pieces):
            q = b.pieces[i]
            if q[1] >= p[3] - EPS:
                break
            w = min(p[2], q[2]) - max(p[0], q[0])
            d = min(p[3], q[3]) - max(p[1], q[1])
            if w > 0 and d > 0:
                total += w * d
            i += 1
    return total


# ----------------------------------------------------------------- the grid

class Grid:
    """Cells of `size` blocks, column-major: mask[ix][iz]; origin in cell units."""

    def __init__(self, size, bounds):
        self.size = size
        self.ix0 = int(math.floor(bounds[0] / size)) - 2
        self.iz0 = int(math.floor(bounds[1] / size)) - 2
        self.nx = int(math.ceil(bounds[2] / size)) + 2 - self.ix0
        self.nz = int(math.ceil(bounds[3] / size)) + 2 - self.iz0

    def empty(self):
        return [bytearray(self.nz) for _ in range(self.nx)]

    def x(self, ix):
        return (self.ix0 + ix) * self.size

    def z(self, iz):
        return (self.iz0 + iz) * self.size

    def span(self, a, b):
        """Cell indices a point range [a, b] (blocks) covers: touching a cell's
        far edge doesn't count, a range sitting on an edge belongs to the cell above."""
        eps = 1.0e-5
        lo = int(math.floor((a + eps) / self.size))
        hi = int(math.floor((b - eps) / self.size))
        return lo, max(lo, hi)


def clip_poly(poly, axis, bound, keep_greater):
    """Sutherland–Hodgman against one axis-aligned half-plane."""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        p_in = (p[axis] >= bound) if keep_greater else (p[axis] <= bound)
        q_in = (q[axis] >= bound) if keep_greater else (q[axis] <= bound)
        if p_in:
            out.append(p)
        if p_in != q_in:
            t = (bound - p[axis]) / (q[axis] - p[axis])
            out.append(tuple(p[k] + t * (q[k] - p[k]) for k in range(len(p))))
    return out


def mark_polygon(grid, mask, pts):
    """Mark every cell the footprint polygon [(x, z)] touches."""
    ix_lo, ix_hi = grid.span(min(p[0] for p in pts), max(p[0] for p in pts))
    single = ix_lo == ix_hi
    for ix in range(max(ix_lo, grid.ix0), min(ix_hi, grid.ix0 + grid.nx - 1) + 1):
        if single:
            strip = pts
        else:
            x0 = ix * grid.size
            strip = clip_poly(clip_poly(pts, 0, x0, True), 0, x0 + grid.size, False)
            if not strip:
                continue
        iz_lo, iz_hi = grid.span(min(p[1] for p in strip), max(p[1] for p in strip))
        iz_lo, iz_hi = max(iz_lo, grid.iz0), min(iz_hi, grid.iz0 + grid.nz - 1)
        if iz_hi >= iz_lo:
            a = iz_lo - grid.iz0
            b = iz_hi - grid.iz0 + 1
            mask[ix - grid.ix0][a:b] = b"\x01" * (b - a)


def mark_floor_triangle(grid, mask, t):
    """Mark the cells whose centre lies inside the triangle's footprint."""
    pts = [(t[0], t[2]), (t[3], t[5]), (t[6], t[8])]
    s = grid.size
    for ix in range(grid.nx):
        xc = (grid.ix0 + ix + 0.5) * s
        zs = []
        for i in range(3):
            (x0, z0), (x1, z1) = pts[i], pts[(i + 1) % 3]
            if (x0 <= xc <= x1 or x1 <= xc <= x0) and x0 != x1:
                zs.append(z0 + (xc - x0) / (x1 - x0) * (z1 - z0))
        if len(zs) < 2:
            continue
        lo = int(math.ceil(min(zs) / s - 0.5 - 1e-9))
        hi = int(math.floor(max(zs) / s - 0.5 + 1e-9))
        lo, hi = max(lo, grid.iz0), min(hi, grid.iz0 + grid.nz - 1)
        if hi >= lo:
            mask[ix][lo - grid.iz0:hi - grid.iz0 + 1] = b"\x01" * (hi - lo + 1)


def slab_footprint(t, lo, hi):
    """The triangle's part between heights lo and hi, as a footprint [(x, z)], or None."""
    ys = (t[1], t[4], t[7])
    if max(ys) < lo or min(ys) > hi:
        return None
    poly = [(t[0], t[1], t[2]), (t[3], t[4], t[5]), (t[6], t[7], t[8])]
    if min(ys) < lo:
        poly = clip_poly(poly, 1, lo, True)
    if max(ys) > hi and poly:
        poly = clip_poly(poly, 1, hi, False)
    return [(p[0], p[2]) for p in poly] if poly else None


def free_cells(grid, floor, obstacle, depth):
    """FLOOR and not OBSTACLE, plus the clearance: an obstacle run (along X and
    along Z) gives `depth` cells to a free cell on either end, but keeps at
    least one cell — a thin wall stays a wall. (A diagonal wall's staircase has
    runs of two and keeps both: a slanted aisle gets no clearance.)"""
    nx, nz = grid.nx, grid.nz
    free = [bytearray(nz) for _ in range(nx)]
    for ix in range(nx):
        f, o = floor[ix], obstacle[ix]
        free[ix][:] = bytes(1 if f[iz] and not o[iz] else 0 for iz in range(nz))
    freed = [bytearray(nz) for _ in range(nx)]

    def runs(line_o, line_free, n):
        i = 0
        while i < n:
            if not line_o[i]:
                i += 1
                continue
            j = i
            while j < n and line_o[j]:
                j += 1
            yield i, j, (i > 0 and line_free[i - 1]), (j < n and line_free[j])
            i = j

    def give(start, end, left, right):
        length = end - start
        pl = depth if left else 0
        pr = depth if right else 0
        if pl + pr > length - 1:
            both = (length - 1) // 2
            pl = both if left else 0
            pr = both if right else 0
            if left and not right:
                pl = min(depth, length - 1)
            if right and not left:
                pr = min(depth, length - 1)
        return start, start + pl, end - pr, end

    if depth > 0:
        for ix in range(nx):
            for start, end, left, right in runs(obstacle[ix], free[ix], nz):
                a, b, c, d = give(start, end, left, right)
                freed[ix][a:b] = b"" * (b - a)
                freed[ix][c:d] = b"" * (d - c)
        for iz in range(nz):
            row_o = bytes(obstacle[ix][iz] for ix in range(nx))
            row_f = bytes(free[ix][iz] for ix in range(nx))
            for start, end, left, right in runs(row_o, row_f, nx):
                a, b, c, d = give(start, end, left, right)
                for ix in list(range(a, b)) + list(range(c, d)):
                    freed[ix][iz] = 1
    out = [bytearray(nz) for _ in range(nx)]
    for ix in range(nx):
        out[ix][:] = bytes(1 if free[ix][iz] or (freed[ix][iz] and floor[ix][iz]) else 0 for iz in range(nz))
    return out


DOOR_GAP_REACH = 0.7


def reach_doors(grid, free, obstacle, doors):
    """A hull door the floor stops short of (the DR1a's vestibule: the floor
    ends 0.47 from the door, steps down to it): the free cells are carried
    out to the door's inner face along its span, where nothing is in the way
    — the engine lets a rider out only where the floor ends within 0.4 of it."""
    s = grid.size
    limit = int(DOOR_GAP_REACH / s)
    for door in doors:
        if door.inner:
            continue
        side = door.axis == 0
        out = door.outward
        lo, hi = door.span[0] + DOOR_SPAN_INSET, door.span[1] - DOOR_SPAN_INSET
        a0, a1 = grid.span(lo, hi)
        across = int(math.floor(door.inner_face / s + 1e-6)) if out > 0 else int(math.ceil(door.inner_face / s - 1e-6))
        for along in range(a0, a1 + 1):
            step = -out
            cells = []   # from the face inwards
            at = across - 1 if out > 0 else across
            found = False
            for _ in range(limit):
                ix, iz = (at - grid.ix0, along - grid.iz0) if side else (along - grid.ix0, at - grid.iz0)
                if not (0 <= ix < grid.nx and 0 <= iz < grid.nz) or obstacle[ix][iz]:
                    break
                if free[ix][iz]:
                    found = True
                    break
                cells.append((ix, iz))
                at += step
            if found:
                for ix, iz in cells:
                    free[ix][iz] = 1


def tile(mask):
    """Maximal rectangles of the set cells: [(ix0, iz0, ix1, iz1)] with
    exclusive ends. Runs are taken along Z in each column and merged across
    columns when equal; the better of that and the transpose is kept."""
    best = None
    for transpose in (False, True):
        lines = mask
        if transpose:
            lines = [bytearray(mask[ix][iz] for ix in range(len(mask))) for iz in range(len(mask[0]))]
        boxes = []
        open_runs = {}
        for i, line in enumerate(lines):
            runs = set()
            j = 0
            n = len(line)
            while j < n:
                if line[j]:
                    k = j
                    while k < n and line[k]:
                        k += 1
                    runs.add((j, k))
                    j = k
                else:
                    j += 1
            for run in list(open_runs):
                if run not in runs:
                    boxes.append((open_runs.pop(run), run[0], i, run[1]))
            for run in runs:
                open_runs.setdefault(run, i)
        for run, start in open_runs.items():
            boxes.append((start, run[0], len(lines), run[1]))
        if transpose:   # (line0, a, line1, b) in (iz, ix) order
            boxes = [(a, l0, b, l1) for l0, a, l1, b in boxes]
        if best is None or len(boxes) < len(best):
            best = boxes
    return sorted(best, key=lambda b: (b[1], b[0]))


# ------------------------------------------------------------------ generate

class Floor:
    """What generate() found: the boxes and everything the maps are drawn from."""

    def __init__(self):
        self.interior = []      # [{"min": [x, y, z], "max": [x, y, z]}]
        self.levels = []        # floor heights used
        self.notes = []         # things worth telling the author
        self.grid = None
        self.floor = {}         # level → mask
        self.obstacle = {}
        self.free = {}          # after clearance, add, remove
        self.kept = {}          # the reachable boxes' cells
        self.region = None
        self.dropped_area = 0.0


def pick_levels(levels, config, ir_floor, y_range):
    """The floor heights to generate for."""
    if config.levels is not None:
        picked = []
        for want in config.levels:
            near = [lv for lv in levels if abs(lv[0] - want) <= 0.05]
            if not near:
                raise ValueError(f"no up-facing surface near level {want} "
                                 f"(levels: {[(round(l[0], 3), round(l[1], 1)) for l in levels]})")
            picked.append(want)
        return picked
    big = [lv for lv in levels if lv[1] >= MIN_LEVEL_AREA]
    if ir_floor is not None:
        near = [lv for lv in big if abs(lv[0] - ir_floor) <= 0.15]
        if near:
            return [round(max(near, key=lambda lv: lv[1])[0], 3)]
    low = [lv for lv in big if lv[0] <= y_range[0] + 0.6 * (y_range[1] - y_range[0])]
    if not low:
        raise ValueError("no floor level found: name one with \"level\"")
    return [round(max(low, key=lambda lv: lv[1])[0], 3)]


def generate(raw, config, doors=(), ir_floor=None, y_lift=0.40625 + 0.03):
    """The walkable floor of the OBJ `raw` (see the module docstring) as a Floor.
    doors: the type's doors as dicts (hull/gangway ones seed the reachability,
    inner ones join what they bridge)."""
    names, triangles = read_triangles(raw, y_lift)
    skip = {i for i, n in enumerate(names) if "HIDE" in n or any(p.search(n) for p in config.ignore)}
    active = [t for t in triangles if t[0] not in skip]
    ys = [v for _, t in active for v in (t[1], t[4], t[7])]
    if not ys:
        raise ValueError("model has no visible triangles")
    levels = pick_levels(find_levels(active), config, ir_floor, (min(ys), max(ys)))
    result = Floor()
    result.levels = levels
    door_list = [Door(d) for d in doors]

    # the grid: the extent of the floor-level surfaces
    bounds = [math.inf, math.inf, -math.inf, -math.inf]
    floor_tris = {}
    for level in levels:
        mine = []
        for _, t in active:
            nx, ny, nz = normal(t)
            length = math.sqrt(nx * nx + ny * ny + nz * nz)
            if length < 1e-12 or ny / length < UP_FACING:
                continue
            if all(-config.step_down <= t[i] - level <= LEVEL_TOLERANCE for i in (1, 4, 7)):
                mine.append(t)
                for i in (0, 3, 6):
                    bounds[0], bounds[2] = min(bounds[0], t[i]), max(bounds[2], t[i])
                    bounds[1], bounds[3] = min(bounds[1], t[i + 2]), max(bounds[3], t[i + 2])
        floor_tris[level] = mine
    if not math.isfinite(bounds[0]):
        raise ValueError("no floor surface at the level")
    grid = Grid(config.cell, bounds)
    result.grid = grid
    depth = int(config.clearance / config.cell + 0.5)
    taken = None
    for level in sorted(levels, reverse=True):
        floor = grid.empty()
        for t in floor_tris[level]:
            mark_floor_triangle(grid, floor, t)
        obstacle = grid.empty()
        lo, hi = level + config.slab[0], level + config.slab[1]
        for _, t in active:
            footprint = slab_footprint(t, lo, hi)
            if footprint is not None:
                mark_polygon(grid, obstacle, footprint)
        if taken is not None:   # a higher level wins where both exist
            for ix in range(grid.nx):
                floor[ix][:] = bytes(0 if taken[ix][iz] else floor[ix][iz] for iz in range(grid.nz))
        free = free_cells(grid, floor, obstacle, depth)
        for box in config.add:
            if len(levels) > 1 and min(levels, key=lambda v: abs(v - box["min"][1])) != level:
                continue
            for ix in range(max(0, grid.span(box["min"][0], box["max"][0])[0] - grid.ix0),
                            min(grid.nx, grid.span(box["min"][0], box["max"][0])[1] - grid.ix0 + 1)):
                a = max(0, grid.span(box["min"][2], box["max"][2])[0] - grid.iz0)
                b = min(grid.nz, grid.span(box["min"][2], box["max"][2])[1] - grid.iz0 + 1)
                if b > a:
                    free[ix][a:b] = b"\x01" * (b - a)
        for box in config.remove:
            for ix in range(max(0, grid.span(box["min"][0], box["max"][0])[0] - grid.ix0),
                            min(grid.nx, grid.span(box["min"][0], box["max"][0])[1] - grid.ix0 + 1)):
                a = max(0, grid.span(box["min"][2], box["max"][2])[0] - grid.iz0)
                b = min(grid.nz, grid.span(box["min"][2], box["max"][2])[1] - grid.iz0 + 1)
                if b > a:
                    free[ix][a:b] = bytes(b - a)
        reach_doors(grid, free, obstacle, door_list)
        result.floor[level] = floor
        result.obstacle[level] = obstacle
        result.free[level] = free
        taken = [bytearray(1 if (taken and taken[ix][iz]) or floor[ix][iz] else 0 for iz in range(grid.nz))
                 for ix in range(grid.nx)]

    # reachable: the engine's rule on the boxes of every level together
    def to_boxes(masks):
        out = []
        for level in sorted(levels):
            for ix0, iz0, ix1, iz1 in tile(masks[level]):
                out.append((level, grid.x(ix0), grid.z(iz0), grid.x(ix1), grid.z(iz1)))
        return out

    boxes = to_boxes(result.free)
    region = Region([b[1:] for b in boxes])
    labels, count = region.components(door_list)
    seeds = set()
    for door in door_list:
        if not door.inner:
            seeds.update(region.door_seeds(door))
    if not region.pieces:
        raise ValueError("a player fits nowhere on the generated floor")
    if seeds:
        keep = {labels[i] for i in seeds}
    else:
        area = {}
        for i, p in enumerate(region.pieces):
            area[labels[i]] = area.get(labels[i], 0.0) + (p[2] - p[0]) * (p[3] - p[1])
        keep = {max(area, key=area.get)}
        result.notes.append("no external or gangway door leads to the floor: kept the largest piece")
    result.dropped_area = region.area()
    s = grid.size
    kept = {level: grid.empty() for level in levels}
    for i, p in enumerate(region.pieces):
        if labels[i] not in keep:
            continue
        ix_lo = int(math.floor((p[0] - HALF_WIDTH) / s + 1e-6))
        ix_hi = int(math.ceil((p[2] + HALF_WIDTH) / s - 1e-6))
        iz_lo = int(math.floor((p[1] - HALF_WIDTH) / s + 1e-6))
        iz_hi = int(math.ceil((p[3] + HALF_WIDTH) / s - 1e-6))
        for level in levels:
            for ix in range(max(ix_lo, grid.ix0), min(ix_hi, grid.ix0 + grid.nx)):
                a, b = max(iz_lo, grid.iz0) - grid.iz0, min(iz_hi, grid.iz0 + grid.nz) - grid.iz0
                if b > a:
                    kept[level][ix - grid.ix0][a:b] = b"\x01" * (b - a)
    for level in levels:
        for ix in range(grid.nx):
            kept[level][ix][:] = bytes(kept[level][ix][iz] & result.free[level][ix][iz] for iz in range(grid.nz))
    result.kept = kept
    final = to_boxes(kept)
    # a tile no body fits in (FloorCheck: "holds no place a player fits") is
    # swapped for the body-sized boxes (a centre piece grown by the half-width)
    # that cover its cells: same union, every box a place to stand
    kept_region = Region([b[1:] for b in final])
    stand = [p for i, p in enumerate(region.pieces) if labels[i] in keep]
    fixed, seen = [], set()
    for level, x0, z0, x1, z1 in final:
        if any(min(p[2], x1) >= max(p[0], x0) - EPS and min(p[3], z1) >= max(p[1], z0) - EPS
               for p in kept_region.pieces):
            fixed.append((level, x0, z0, x1, z1))
            continue
        for ix in range(int(round((x0 - grid.ix0 * s) / s)), int(round((x1 - grid.ix0 * s) / s))):
            for iz in range(int(round((z0 - grid.iz0 * s) / s)), int(round((z1 - grid.iz0 * s) / s))):
                cx, cz = (ix + grid.ix0 + 0.5) * s, (iz + grid.iz0 + 0.5) * s
                for p in stand:
                    if p[0] - HALF_WIDTH <= cx <= p[2] + HALF_WIDTH and p[1] - HALF_WIDTH <= cz <= p[3] + HALF_WIDTH:
                        box = (level, round((p[0] - HALF_WIDTH) / s) * s, round((p[1] - HALF_WIDTH) / s) * s,
                               round((p[2] + HALF_WIDTH) / s) * s, round((p[3] + HALF_WIDTH) / s) * s)
                        if box not in seen:
                            seen.add(box)
                            fixed.append(box)
                        break
    final = fixed
    result.region = Region([b[1:] for b in final])
    result.dropped_area -= result.region.area()
    for level, x0, z0, x1, z1 in final:
        result.interior.append({"min": [round(x0, 4), level, round(z0, 4)],
                                "max": [round(x1, 4), round(level + ZONE_HEIGHT, 4), round(z1, 4)]})
    return result


# ------------------------------------------------------------------- reports

def boxes_of(interior):
    """[(min x, min z, max x, max z)] of an "interior" (a box or a list of boxes)."""
    zones = interior if isinstance(interior, list) else [interior]
    return [(z["min"][0], z["min"][2], z["max"][0], z["max"][2]) for z in zones]


def component_report(region, doors, name):
    labels, count = region.components(doors)
    area = [0.0] * count
    for i, p in enumerate(region.pieces):
        area[labels[i]] += (p[2] - p[0]) * (p[3] - p[1])
    reached = {}
    for door in doors:
        if door.inner:
            continue
        for i in region.door_seeds(door):
            reached.setdefault(labels[i], set()).add(door.id)
    lines = [f"{name}: {count} connected part(s) of the centre region"]
    for c in sorted(range(count), key=lambda c: -area[c]):
        lines.append(f"    part {c}: {area[c]:7.3f} m2  doors {sorted(reached.get(c, []))}")
    return labels, count, area, lines


def compare(generated, hand, doors):
    """Lines comparing two regions: areas, difference, parts and doors."""
    both = overlap_area(generated, hand)
    a, h = generated.area(), hand.area()
    lines = [f"centre region (a body fits, margin {HALF_WIDTH}):",
             f"    generated {a:8.3f} m2    hand {h:8.3f} m2    both {both:8.3f} m2",
             f"    only generated {a - both:7.3f} m2    only hand {h - both:7.3f} m2"
             f"    symmetric difference {a + h - 2 * both:7.3f} m2 = {100 * (a + h - 2 * both) / max(h, 1e-9):.1f}% of hand"]
    gl, gn, ga, gt = component_report(generated, doors, "generated")
    hl, hn, ha, ht = component_report(hand, doors, "hand")
    lines += gt + ht
    lines.append("hand part ∩ generated part (m2):")
    for i in range(hn):
        row = []
        for j in range(gn):
            part_h = Region.__new__(Region)
            part_h.pieces = [p for k, p in enumerate(hand.pieces) if hl[k] == i]
            part_g = Region.__new__(Region)
            part_g.pieces = [p for k, p in enumerate(generated.pieces) if gl[k] == j]
            part_h.max_z = [p[3] for p in part_h.pieces]
            part_g.max_z = [p[3] for p in part_g.pieces]
            value = overlap_area(part_g, part_h)
            if value > 0.005:
                row.append(f"gen {j}: {value:.2f}")
        lines.append(f"    hand {i} ({ha[i]:.2f}): " + ", ".join(row))
    hull = [d for d in doors if not d.inner]
    lines.append("hull / gangway doors a rider can walk out through:")
    for door in hull:
        lines.append(f"    {door.id:10} generated {bool(generated.door_seeds(door))!s:5}  hand {bool(hand.door_seeds(door))!s:5}")
    return lines


# ---------------------------------------------------------------- the drawing

def door_cells(grid, door):
    ix0, ix1 = grid.span(door.min[0], door.max[0])
    iz0, iz1 = grid.span(door.min[2], door.max[2])
    return ix0 - grid.ix0, ix1 - grid.ix0, iz0 - grid.iz0, iz1 - grid.iz0


def cell_class(result, level, ix, iz):
    """What a cell is, for the maps: '#' obstacle, '.' floor a rider can't use,
    ',' free but dropped, '+' kept floor, 'o' a centre fits at the cell's centre,
    ' ' no floor."""
    grid = result.grid
    x, z = (grid.ix0 + ix + 0.5) * grid.size, (grid.iz0 + iz + 0.5) * grid.size
    if result.kept[level][ix][iz]:
        return "o" if result.region.fits(x, z) else "+"
    if result.free[level][ix][iz]:
        return ","
    if result.obstacle[level][ix][iz] and result.floor[level][ix][iz]:
        return "#"
    if result.floor[level][ix][iz]:
        return "."
    return " "


def window_rows(grid, window):
    """Cell rows (Z) inside the --z window (blocks), all by default."""
    if window is None:
        return 0, grid.nz
    return (max(0, int(math.floor(window[0] / grid.size)) - grid.iz0),
            min(grid.nz, int(math.ceil(window[1] / grid.size)) - grid.iz0))


def ascii_map(result, doors, step=1, window=None):
    grid = result.grid
    level = max(result.levels)
    rows = []
    first, last = window_rows(grid, window)
    for iz in range(first, last, step):
        row = []
        for ix in range(0, grid.nx, 1):
            row.append(cell_class(result, level, ix, iz))
        rows.append(row)
    for door in doors:
        ix0, ix1, iz0, iz1 = door_cells(grid, door)
        mark = "i" if door.inner else "G" if door.connecting else "D"
        for iz in range(max(iz0, first), min(iz1, last - 1) + 1):
            if (iz - first) % step:
                continue
            for ix in range(max(ix0, 0), min(ix1, grid.nx - 1) + 1):
                rows[(iz - first) // step][ix] = mark
    out = [f"X from {grid.x(0):.3f} to {grid.x(grid.nx):.3f} (columns), Z down from {grid.z(0):.3f}, "
           f"{grid.size * step:.4f} per row; level {level}",
           "legend: o centre fits here  + kept floor  , free but dropped (unreachable)  # obstacle on floor"
           "  . floor, not free  D hull door  G gangway  i inner door"]
    for iz, row in enumerate(rows):
        out.append(f"{grid.z(first + iz * step):8.3f} " + "".join(row))
    return "\n".join(out)


def write_png(path, width, height, pixel):
    """RGB PNG from pixel(x, y) → (r, g, b), zlib + struct only."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw += bytes(pixel(x, y))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) \
        + chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b"")
    Path(path).write_bytes(png)


def png_map(path, result, doors, hand=None, px=3, window=None):
    """Top-down map: Z runs left to right, X top to bottom."""
    grid = result.grid
    level = max(result.levels)
    colours = {" ": (24, 24, 24), ".": (80, 80, 80), "#": (150, 100, 60), ",": (110, 130, 110),
               "+": (150, 205, 150), "o": (40, 200, 60)}
    door_colour = {"D": (255, 140, 0), "G": (230, 60, 230), "i": (255, 230, 0)}
    over = {}
    for door in doors:
        ix0, ix1, iz0, iz1 = door_cells(grid, door)
        mark = "i" if door.inner else "G" if door.connecting else "D"
        for iz in range(max(iz0, 0), min(iz1, grid.nz - 1) + 1):
            for ix in range(max(ix0, 0), min(ix1, grid.nx - 1) + 1):
                over[(ix, iz)] = mark
    seat_hand = hand

    first, last = window_rows(grid, window)

    def pixel(x, y):
        iz, ix = x // px + first, y // px
        if (ix, iz) in over:
            return door_colour[over[(ix, iz)]]
        c = cell_class(result, level, ix, iz)
        if seat_hand is not None:
            xc, zc = (grid.ix0 + ix + 0.5) * grid.size, (grid.iz0 + iz + 0.5) * grid.size
            mine, theirs = c == "o", seat_hand.fits(xc, zc)
            if theirs and not mine:
                return (255, 50, 50)
            if mine and not theirs:
                return (50, 110, 255)
        return colours[c]

    write_png(path, (last - first) * px, grid.nx * px, pixel)


# ----------------------------------------------------------------------- CLI

def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate and look at one stock type's walkable floor.")
    parser.add_argument("recipe", help="pack recipe, e.g. packs/mvp.json")
    parser.add_argument("type", help="stock type id, e.g. amendorf")
    parser.add_argument("--ascii", action="store_true", help="print a text map")
    parser.add_argument("--step", type=int, default=1, help="--ascii: cells per row along Z")
    parser.add_argument("--png", help="write a top-down map here (keep it out of the repository)")
    parser.add_argument("--px", type=int, default=3, help="--png: pixels per cell")
    parser.add_argument("--z", type=float, nargs=2, metavar=("FROM", "TO"), help="--ascii/--png: only this Z window")
    parser.add_argument("--compare", action="store_true", help="compare with the type's hand \"interior\"")
    parser.add_argument("--clearance", type=float, help="override the clearance")
    parser.add_argument("--level", type=float, action="append", help="override the level")
    parser.add_argument("--slab", type=float, nargs=2, help="override the body slab (from, to above the floor)")
    parser.add_argument("--json", action="store_true", help="print the generated interior as JSON")
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(errors="replace")

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import ir2rwat
    converter = ir2rwat.Converter(args.recipe)
    plan = converter.plan(args.type, force_floor=True,
                          floor_override={k: v for k, v in (("clearance", args.clearance), ("level", args.level),
                                                            ("slab", args.slab)) if v is not None})
    floor = plan["floor"]
    doors = [Door(d) for d in plan["doors"]]
    print(f"{args.type}: level(s) {floor.levels}, {len(floor.interior)} box(es), "
          f"{sum(boxes_area(b) for b in boxes_of(floor.interior)):.3f} m2 of floor, "
          f"centre region {floor.region.area():.3f} m2, "
          f"{floor.dropped_area:.3f} m2 of centre region dropped as unreachable")
    for note in floor.notes:
        print("  note:", note)
    hand_zone = plan["hand_interior"]
    hand = Region(boxes_of(hand_zone)) if hand_zone is not None else None
    if args.compare:
        if hand is None:
            print("no hand \"interior\" in the type's file to compare with")
        else:
            print("\n".join(compare(floor.region, hand, doors)))
    if args.json:
        print(json.dumps(floor.interior))
    if args.ascii:
        print(ascii_map(floor, doors, args.step, args.z))
    if args.png:
        png_map(args.png, floor, doors, hand if args.compare else None, args.px, args.z)
        print("wrote", args.png)


def boxes_area(b):
    return (b[2] - b[0]) * (b[3] - b[1])


if __name__ == "__main__":
    main()
