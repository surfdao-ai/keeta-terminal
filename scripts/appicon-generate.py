#!/usr/bin/env python3
"""
Regenerate the KTerminal app icons (no network, stdlib only).

Design: dark slate (#09090B) square with a gradient, a stylized "K" mark
(purple -> indigo) and a small up-chart tick — matches the app's dark UI
+ purple/indigo palette.

Writes:
  public/icon.svg
  public/icon-192.png, public/apple-touch-icon.png (180), public/icon-512.png,
  public/icon-maskable-512.png
"""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')

BG_TOP = (27, 18, 48)      # #1b1230
BG_BOT = (9, 9, 11)        # #09090B
K_TOP = (192, 132, 252)    # #c084fc
K_BOT = (99, 102, 241)     # #6366f1
TICK = (99, 102, 241)      # #6366f1

# K mark rects in 512-space: (x, y, w, h) — axis-aligned so rasterizing is trivial.
STEM = (52, 56, 34, 270)
UPPER_ARM = (86, 96, 175, 44)    # top-right arm
MID_ARM = (86, 216, 200, 44)     # middle arm from the stem out
TICK = (378, 176, 54, 120)       # small up-chart tick, top right
RECTS = [TICK, MID_ARM, UPPER_ARM, STEM]


def to_hex(c):
    return '#' + ''.join(f'{v:02x}' for v in c)


def grad(y, top, bot, size):
    t = min(1.0, y / size)
    return tuple(a + (b - a) * t for a, b in zip(top, bot))


def build_canvas(size):
    def icol(c):
        return tuple(int(v) for v in c)
    px = [[icol(grad(y, BG_TOP, BG_BOT, size)) for _ in range(size)] for y in range(size)]
    for r in RECTS:
        s = size / 512.0
        for y in range(int(r[1] * s), min(int((r[1] + r[3]) * s), size)):
            col = icol(grad(y, K_TOP, K_BOT, size))
            for x in range(int(r[0] * s), min(int((r[0] + r[2]) * s), size)):
                px[y][x] = col
    return px


def write_png(path, px, size):
    # RGBA rows (type 6) — some build-time image checks (sharp) require it.
    rows = []
    for y in range(size):
        rows.append(b'\x00' + b''.join(bytes((*c, 255)) for c in px[y]))
    raw = b''.join(rows)

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)

    out = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    if path:
        with open(path, 'wb') as f:
            f.write(out)
    return out


def write_ico(path, sizes=(16, 32, 48)):
    """A small multi-size favicon: modern ICOs embed PNG blobs per size."""
    entries = []
    blobs = []
    for size in sizes:
        blobs.append(write_png(None, build_canvas(size), size))
    n = len(sizes)
    header = struct.pack('<HHH', 0, 1, n)
    offset = 6 + n * 16
    body = b''
    for i, size in enumerate(sizes):
        w = h = 0 if size == 256 else size
        body += struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, len(blobs[i]), offset)
        offset += len(blobs[i])
    out = header + body + b''.join(blobs)
    with open(path, 'wb') as f:
        f.write(out)
    return len(out)


def svg():
    def r(x, y, w, h):
        return f'  <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{min(w, h) // 3}" fill="url(#k)"/>'

    body = '\n'.join(r(*r_) for r_ in RECTS)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="{to_hex(BG_TOP)}"/>
      <stop offset="100%" stop-color="{to_hex(BG_BOT)}"/>
    </linearGradient>
    <linearGradient id="k" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{to_hex(K_TOP)}"/>
      <stop offset="100%" stop-color="{to_hex(K_BOT)}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
{body}
</svg>
"""


def main():
    os.makedirs(PUBLIC, exist_ok=True)
    with open(os.path.join(PUBLIC, 'icon.svg'), 'w') as f:
        f.write(svg())
    for name, size in (('icon-192.png', 192), ('apple-touch-icon.png', 180),
                       ('icon-512.png', 512), ('icon-maskable-512.png', 512)):
        write_png(os.path.join(PUBLIC, name), build_canvas(size), size)
        print('wrote', name)
    n = write_ico(os.path.join(ROOT, 'src', 'app', 'favicon.ico'))
    print('wrote src/app/favicon.ico', n, 'bytes')
    print('done')


if __name__ == '__main__':
    main()
