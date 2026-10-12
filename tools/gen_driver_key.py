#!/usr/bin/env python3
"""Draw the driver's key item texture (SPEC §9.2), 16x16 pixel art.

    python -I tools/gen_driver_key.py [--preview <png>]

Standard library only. The picture is the grid below, one character a
pixel; writes assets/railswheelsandtrains/textures/item/driver_key.png
(and, with --preview, the same scaled up 16 times to look at).
"""

import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src/main/resources/assets/railswheelsandtrains/textures/item/driver_key.png"

# a steel key with a red bow, upright like vanilla's trial key: the bow on top, the bit down right
PALETTE = {
    ".": None,
    "o": (38, 34, 40),     # outline
    "H": (238, 240, 236),  # steel, lit
    "M": (176, 180, 188),  # steel
    "S": (104, 108, 120),  # steel, shaded
    "r": (232, 92, 72),    # bow, lit
    "R": (184, 44, 36),    # bow
    "d": (112, 22, 24),    # bow, shaded
}

GRID = [
    ".....oooooo.....",
    "....orrrRRRo....",
    "...orrRooRRdo...",
    "...orRo..oRdo...",
    "...oRRo..oddo...",
    "...oRRdoodddo...",
    "....oRdddddo....",
    ".....oooooo.....",
    "......oHMSo.....",
    "......oHSo......",
    "......oHSoo.....",
    "......oHSMSo....",
    "......oHSoo.....",
    "......oHSMSo....",
    "......oHSSSo....",
    ".......ooooo....",
]


def png(width, height, rows):
    """A truecolour-with-alpha PNG from rows of (r, g, b, a) tuples."""
    raw = b"".join(b"\0" + bytes(c for px in row for c in px) for row in rows)

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def pixels(scale=1):
    rows = []
    for line in GRID:
        if len(line) != 16:
            sys.exit(f"grid row is {len(line)} wide: {line!r}")
        row = []
        for ch in line:
            colour = PALETTE[ch]
            px = (0, 0, 0, 0) if colour is None else colour + (255,)
            row.extend([px] * scale)
        rows.extend([row] * scale)
    return rows


def main(argv):
    if len(GRID) != 16:
        sys.exit(f"grid is {len(GRID)} rows")
    OUT.write_bytes(png(16, 16, pixels()))
    print("wrote", OUT.relative_to(ROOT))
    if len(argv) == 2 and argv[0] == "--preview":
        Path(argv[1]).write_bytes(png(256, 256, pixels(16)))
        print("preview", argv[1])


if __name__ == "__main__":
    main(sys.argv[1:])
