#!/usr/bin/env python3
"""Generate the browser-extension PNG icons with the standard library only.

Why this exists: the Muse GitHub connector's snapshot-push route
accepts UTF-8 text files only, so extension/icons/*.png cannot be
pushed that way. Both GitHub workflows run this script before
packaging the extension, so a checkout without PNG files still
produces a complete extension package.

Usage:
    python3 tools/generate-icons.py [--out extension/icons]

Output: icon16.png, icon48.png, icon128.png — a dark-blue rounded
square with a white down-arrow. The image is deliberately simple and
deterministic: the same script always produces the same bytes.

The PNG encoder is written here (struct + zlib, no Pillow) so the
script has no third-party dependency and runs on any Python 3.12+
runner, including windows-latest.
"""

import argparse
import struct
import sys
import zlib
from pathlib import Path


def _chunk(kind: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(kind)
    crc = zlib.crc32(data, crc)
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc & 0xFFFFFFFF)


def _pixel(x: int, y: int, size: int) -> tuple[int, int, int, int]:
    """Return an RGBA pixel for the icon at (x, y)."""
    # Rounded-square mask: transparent outside the rounded corners.
    r = size // 6
    cx = min(max(x, r), size - 1 - r)
    cy = min(max(y, r), size - 1 - r)
    if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
        return (0, 0, 0, 0)
    # Vertical gradient: deep blue at the top, brighter blue at bottom.
    t = y / max(size - 1, 1)
    bg = (
        int(23 + (37 - 23) * t),
        int(58 + (99 - 58) * t),
        int(150 + (235 - 150) * t),
        255,
    )
    # White down-arrow: shaft + head, centred, scaled to size.
    cx0 = size / 2
    shaft_w = max(1, size // 8)
    shaft_top = size * 0.22
    shaft_bot = size * 0.62
    head_top = size * 0.45
    head_bot = size * 0.80
    head_half = size * 0.30
    in_shaft = abs(x + 0.5 - cx0) <= shaft_w / 2 and shaft_top <= y < shaft_bot
    # Head: width shrinks linearly from head_half at head_top to 0 at head_bot.
    if head_top <= y < head_bot:
        half = head_half * (head_bot - y) / (head_bot - head_top)
        in_head = abs(x + 0.5 - cx0) <= half
    else:
        in_head = False
    if in_shaft or in_head:
        return (255, 255, 255, 255)
    return bg


def write_png(path: Path, size: int) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type: none, per row
        for x in range(size):
            raw.extend(_pixel(x, y, size))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), level=9))
        + _chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="extension/icons",
                        help="directory to write the icons into")
    args = parser.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        target = out / f"icon{size}.png"
        write_png(target, size)
        print(f"wrote {target} ({target.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
