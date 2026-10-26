"""Compare app PGM/YAML with (a) what Nav2 map_server loaded and (b) the reference pcd2pgm grid."""
import json, sys
import numpy as np
import yaml

Q = "/tmp/pcd2pgm-qa"
C = f"{Q}/out/chromium"
R = f"{Q}/out/ros"


def read_pgm(p):
    b = open(p, "rb").read()
    toks, o = [], 0
    while len(toks) < 4:
        while b[o:o + 1].isspace():
            o += 1
        if b[o:o + 1] == b"#":
            o = b.index(b"\n", o) + 1
            continue
        s = o
        while not b[o:o + 1].isspace():
            o += 1
        toks.append(b[s:o])
    o += 1
    w, h = int(toks[1]), int(toks[2])
    return np.frombuffer(b[o:], np.uint8).reshape(h, w)


def app(label, d, name):
    img = read_pgm(f"{C}/{d}/{name}.pgm")
    y = yaml.safe_load(open(f"{C}/{d}/{name}.yaml"))  # a real YAML parser (also checks the quoted image)
    occ = np.flipud(img == 0)  # row 0 = lowest y, like OccupancyGrid
    return img, y, occ


out = {}
for label, d, name in [("offset", "offset", "room_offset_map"), ("room10", "room10", "room10_binary_map"), ("real", "real", "go2_mid360_new_office_route1_map")]:
    img, y, occ = app(label, d, name)
    n = np.load(f"{R}/{label}-nav2.npz")
    nav = n["data"]
    out[f"nav2-{label}"] = {
        "yaml_parsed": {k: y[k] for k in ("image", "resolution", "origin", "negate", "occupied_thresh", "free_thresh", "mode")},
        "nav2_origin": [round(float(n["ox"]), 6), round(float(n["oy"]), 6)],
        "dims_equal": nav.shape == occ.shape,
        "occupied_equal": bool(nav.shape == occ.shape and np.array_equal(nav == 100, occ)),
        "free_equal": bool(nav.shape == occ.shape and np.array_equal(nav == 0, ~occ)),
        "unknown_cells": int((nav == -1).sum()),
    }

# Reference pcd2pgm: same filtering, grid sizing is ceil() and points on the max edge are dropped.
for label, d, name in [("room10", "room10", "room10_binary_map"), ("real", "real", "go2_mid360_new_office_route1_map")]:
    img, y, occ = app(label, d, name)
    r = np.load(f"{R}/{label}-ref.npz")
    ref = r["data"] == 100
    h, w = ref.shape
    ov = occ[:h, :w]
    saved = read_pgm(f"{R}/{label}-ref-saved.pgm")
    ry = yaml.safe_load(open(f"{R}/{label}-ref-saved.yaml"))
    extra_cols = occ[:, w:].sum() if occ.shape[1] > w else 0
    extra_rows = occ[h:, :].sum() if occ.shape[0] > h else 0
    out[f"ref-{label}"] = {
        "app_dims": [occ.shape[1], occ.shape[0]], "ref_dims": [w, h],
        "app_origin": y["origin"][:2], "ref_origin": [round(float(r["ox"]), 6), round(float(r["oy"]), 6)],
        "app_occupied": int(occ.sum()), "ref_occupied": int(ref.sum()),
        "overlap_identical": bool(np.array_equal(ov, ref)),
        "overlap_diff_cells": int((ov != ref).sum()),
        "app_extra_occupied_in_extra_col_row": int(extra_cols + extra_rows),
        "ref_saved_vs_app_pgm_identical": bool(saved.shape == img.shape and np.array_equal(saved, img)),
        "ref_saved_yaml": {k: ry[k] for k in ("origin", "free_thresh", "occupied_thresh")},
    }
print(json.dumps(out, indent=1, default=str))
