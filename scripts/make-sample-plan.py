"""Generates the sample architectural plans in data/samples/ (requires `pip install ezdxf`).

    python scripts/make-sample-plan.py

office-floor.dxf  — 18 m x 11 m office, double-line walls, door/window blocks, room labels, dimensions (mm).
plain-flat.dxf    — small flat drawn in metres on a single layer "0" with no block names (worst case for detection).
"""
import math
import os

import ezdxf

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "samples")
os.makedirs(OUT, exist_ok=True)


def office():
    doc = ezdxf.new("R2018", setup=True)
    doc.header["$INSUNITS"] = 4
    for name, color in [("A-WALL", 7), ("A-DOOR", 3), ("A-GLAZ", 5), ("A-FURN", 8), ("A-ROOM-TEXT", 2), ("A-DIMS", 1)]:
        doc.layers.add(name, color=color)
    msp = doc.modelspace()

    d = doc.blocks.new("DOOR900")
    d.add_line((0, 0), (0, 900), dxfattribs={"layer": "0"})
    d.add_arc((0, 0), 900, 0, 90, dxfattribs={"layer": "0"})
    w = doc.blocks.new("WIN1200")
    for y in (-100, 0, 100):
        w.add_line((0, y), (1200, y), dxfattribs={"layer": "0"})
    w.add_line((0, -100), (0, 100), dxfattribs={"layer": "0"})
    w.add_line((1200, -100), (1200, 100), dxfattribs={"layer": "0"})

    def wall(p, q, t, gaps=()):
        (x1, y1), (x2, y2) = p, q
        horizontal = abs(y1 - y2) < 1e-6
        a, b = (x1, x2) if horizontal else (y1, y2)
        cuts = sorted([(g0, g1) for g0, g1 in gaps])
        pieces, cur = [], a
        for g0, g1 in cuts:
            pieces.append((cur, g0))
            cur = g1
        pieces.append((cur, b))
        for s, e in pieces:
            if e - s < 1:
                continue
            for off in (-t / 2, t / 2):
                if horizontal:
                    msp.add_line((s, y1 + off), (e, y1 + off), dxfattribs={"layer": "A-WALL"})
                else:
                    msp.add_line((x1 + off, s), (x1 + off, e), dxfattribs={"layer": "A-WALL"})
            if horizontal:
                msp.add_line((s, y1 - t / 2), (s, y1 + t / 2), dxfattribs={"layer": "A-WALL"})
                msp.add_line((e, y1 - t / 2), (e, y1 + t / 2), dxfattribs={"layer": "A-WALL"})
            else:
                msp.add_line((x1 - t / 2, s), (x1 + t / 2, s), dxfattribs={"layer": "A-WALL"})
                msp.add_line((x1 - t / 2, e), (x1 + t / 2, e), dxfattribs={"layer": "A-WALL"})

    def door(x, y, rot, flip=1, mirror=1):
        msp.add_blockref("DOOR900", (x, y), dxfattribs={"layer": "A-DOOR", "rotation": rot, "xscale": mirror, "yscale": flip})

    def window(x, y, rot):
        msp.add_blockref("WIN1200", (x, y), dxfattribs={"layer": "A-GLAZ", "rotation": rot})

    EXT, INT = 250, 100
    # exterior (gaps for windows / the entrance)
    wall((0, 0), (18000, 0), EXT, [(1500, 2700), (15500, 16400)])
    wall((0, 11000), (18000, 11000), EXT, [(2000, 3200), (5000, 6200), (10500, 11700), (15000, 16200)])
    wall((0, 0), (0, 11000), EXT, [(7500, 8700)])
    wall((18000, 0), (18000, 11000), EXT, [(8000, 9200)])
    # corridor walls (y = 4000 and 6000) with door gaps
    wall((0, 6000), (18000, 6000), INT, [(1500, 2400), (10000, 10900), (15000, 15900)])
    wall((0, 4000), (18000, 4000), INT, [(1000, 1900), (5500, 6400), (8000, 8900), (11000, 11900), (15000, 15900)])
    # partitions
    for x in (9000, 13500):
        wall((x, 6000), (x, 11000), INT)
    for x in (5000, 7500, 10500, 14000):
        wall((x, 0), (x, 4000), INT)

    # doors: hinge at the first jamb; flip=-1 swings to the other side
    door(1500, 6000, 0, 1)        # open office (opens up, into the office)
    door(10000, 6000, 0, 1)       # meeting room
    door(15000, 6000, 0, 1)       # manager office
    door(1000, 4000, 0, -1)       # kitchen (opens down, into the kitchen)
    door(5500, 4000, 0, -1)       # WC
    door(8000, 4000, 0, -1)       # storage
    door(11000, 4000, 0, -1)      # server room
    door(15000, 4000, 0, -1)      # reception
    door(15500, 0, 0, 1)          # main entrance (opens inwards)
    # windows
    for x in (2000, 5000, 10500, 15000):
        window(x, 11000, 0)
    window(1500, 0, 0)
    window(0, 7500, 90)
    window(18000, 8000, 90)

    labels = [
        ("OPEN OFFICE", 4500, 8500), ("MEETING ROOM", 11250, 8500), ("MANAGER", 15750, 8500), ("CORRIDOR", 9000, 5000),
        ("KITCHEN", 2500, 2000), ("WC", 6250, 2000), ("STORAGE", 9000, 2000), ("SERVER ROOM", 12250, 2000), ("RECEPTION", 16000, 2000),
    ]
    for text, x, y in labels:
        msp.add_text(text, height=250, dxfattribs={"layer": "A-ROOM-TEXT", "insert": (x - len(text) * 90, y)})
    # desks
    for i in range(3):
        for j in range(2):
            x, y = 1200 + i * 2600, 7000 + j * 2200
            msp.add_lwpolyline([(x, y), (x + 1600, y), (x + 1600, y + 800), (x, y + 800)], close=True, dxfattribs={"layer": "A-FURN"})
    # dimensions
    msp.add_aligned_dim(p1=(0, -1500), p2=(18000, -1500), distance=0, dxfattribs={"layer": "A-DIMS"}).render()
    msp.add_aligned_dim(p1=(-1500, 0), p2=(-1500, 11000), distance=0, dxfattribs={"layer": "A-DIMS"}).render()
    doc.saveas(os.path.join(OUT, "office-floor.dxf"))


def plain():
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 0
    msp = doc.modelspace()
    # 9 m x 6 m flat, single-line walls on layer 0, openings are simple gaps
    def line(a, b):
        msp.add_line(a, b)
    line((0, 0), (9, 0)); line((9, 0), (9, 6)); line((9, 6), (0, 6)); line((0, 6), (0, 0))
    line((4, 0), (4, 2.2)); line((4, 3.1), (4, 6))      # living / bedroom partition with a 0.9 m opening
    line((0, 3), (4, 3)); line((4, 3), (9, 3))          # splits north / south
    doc.saveas(os.path.join(OUT, "plain-flat.dxf"))


office()
plain()
print("written to", os.path.abspath(OUT))
