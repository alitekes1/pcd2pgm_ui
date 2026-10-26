"""Synthetic fixtures for the pcd2pgm_ui QA campaign (test.md "Ön hazırlık")."""
import os, struct, zlib
import numpy as np

OUT = "/tmp/pcd2pgm-qa/fx"
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)


def room(size=10.0, h=2.5, wall_step=0.02, z_step=0.05, floor_step=0.1, box=True, floor=True):
    """Closed room [0,size]^2 with zero-thickness walls, optional floor grid and a 1 m box at x4-5, y6-7."""
    pts = []
    t = np.arange(0, size + 1e-9, wall_step)
    zs = np.arange(0, h + 1e-9, z_step)
    T, Z = np.meshgrid(t, zs)
    T, Z = T.ravel(), Z.ravel()
    for x, y in ((T, 0 * T), (T, 0 * T + size), (0 * T, T), (0 * T + size, T)):
        pts.append(np.c_[x, y, Z])
    if floor:
        f = np.arange(0, size + 1e-9, floor_step)
        X, Y = np.meshgrid(f, f)
        pts.append(np.c_[X.ravel(), Y.ravel(), np.zeros(X.size)])
    if box:  # box walls x 4..5, y 6..7, z 0..1
        b = np.arange(0, 1 + 1e-9, wall_step)
        bz = np.arange(0, 1 + 1e-9, z_step)
        B, BZ = np.meshgrid(b, bz)
        B, BZ = B.ravel(), BZ.ravel()
        for x, y in ((4 + B, 6 + 0 * B), (4 + B, 7 + 0 * B), (4 + 0 * B, 6 + B), (5 + 0 * B, 6 + B)):
            pts.append(np.c_[x, y, BZ])
    return np.vstack(pts).astype(np.float64)


def header(fields, sizes, types, counts, n, data):
    return (
        "# .PCD v0.7 - Point Cloud Data file format\nVERSION 0.7\n"
        f"FIELDS {' '.join(fields)}\nSIZE {' '.join(map(str, sizes))}\nTYPE {' '.join(types)}\n"
        f"COUNT {' '.join(map(str, counts))}\nWIDTH {n}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\n"
        f"POINTS {n}\nDATA {data}\n"
    )


def write_pcd(name, xyz, mode="binary", extra=None, order=None, header_override=None, f64=False):
    """extra: dict field -> (np array, size, type). order: list of field names."""
    cols = {"x": xyz[:, 0], "y": xyz[:, 1], "z": xyz[:, 2]}
    meta = {k: (8 if f64 else 4, "F") for k in "xyz"}
    for k, (arr, size, typ) in (extra or {}).items():
        cols[k], meta[k] = arr, (size, typ)
    order = order or list(cols)
    n = len(xyz)
    dt = {("F", 4): "<f4", ("F", 8): "<f8", ("U", 4): "<u4", ("U", 1): "u1", ("I", 4): "<i4"}
    h = header_override or header(order, [meta[k][0] for k in order], [meta[k][1] for k in order], [1] * len(order), n, mode)
    path = os.path.join(OUT, name)
    with open(path, "wb") as f:
        f.write(h.encode())
        if mode == "ascii":
            for i in range(n):
                f.write((" ".join(repr(float(cols[k][i])) if meta[k][1] == "F" else str(int(cols[k][i])) for k in order) + "\n").encode())
        else:
            rec = np.zeros(n, dtype=[(k, dt[(meta[k][1], meta[k][0])]) for k in order])
            for k in order:
                rec[k] = cols[k]
            if mode == "binary":
                f.write(rec.tobytes())
            else:  # binary_compressed: SoA layout, LZF literal-run encoding (valid LZF)
                soa = b"".join(rec[k].tobytes() for k in order)
                comp = bytearray()
                for i in range(0, len(soa), 32):
                    chunk = soa[i:i + 32]
                    comp.append(len(chunk) - 1)
                    comp += chunk
                f.write(struct.pack("<II", len(comp), len(soa)))
                f.write(bytes(comp))
    return path


def pack_rgb(r, g, b):
    return ((r.astype(np.uint32) << 16) | (g.astype(np.uint32) << 8) | b.astype(np.uint32)).view(np.float32)


def write_ply(name, xyz, fmt="ascii", rgb=None):
    n = len(xyz)
    props = ["property float x", "property float y", "property float z"]
    if rgb is not None:
        props += ["property uchar red", "property uchar green", "property uchar blue"]
    h = f"ply\nformat {fmt} 1.0\ncomment synthetic QA fixture\nelement vertex {n}\n" + "\n".join(props) + "\nend_header\n"
    path = os.path.join(OUT, name)
    with open(path, "wb") as f:
        f.write(h.encode())
        if fmt == "ascii":
            for i in range(n):
                row = f"{xyz[i,0]:.6f} {xyz[i,1]:.6f} {xyz[i,2]:.6f}"
                if rgb is not None:
                    row += f" {rgb[i,0]} {rgb[i,1]} {rgb[i,2]}"
                f.write((row + "\n").encode())
        else:
            e = "<" if fmt == "binary_little_endian" else ">"
            fields = [("x", e + "f4"), ("y", e + "f4"), ("z", e + "f4")] + ([("r", "u1"), ("g", "u1"), ("b", "u1")] if rgb is not None else [])
            rec = np.zeros(n, dtype=fields)
            rec["x"], rec["y"], rec["z"] = xyz.T
            if rgb is not None:
                rec["r"], rec["g"], rec["b"] = rgb.T
            f.write(rec.tobytes())
    return path


def write_xyz(name, xyz, sep=" ", line_end="\n"):
    path = os.path.join(OUT, name)
    with open(path, "w", newline="") as f:
        for p in xyz:
            f.write(sep.join(f"{v:.6f}" for v in p) + line_end)
    return path


def rot(rx, ry, rz):
    cx, sx, cy, sy, cz, sz = np.cos(rx), np.sin(rx), np.cos(ry), np.sin(ry), np.cos(rz), np.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


R = room()
print("room points", len(R))
write_pcd("room10_binary.pcd", R)
write_pcd("room_offset.pcd", R + np.array([12.5, -7.25, 0]))

# Small ASCII ~1000 points: floor + wall + box
small = np.vstack([
    np.c_[rng.uniform(0, 3, 500), rng.uniform(0, 3, 500), np.zeros(500)],
    np.c_[rng.uniform(0, 3, 300), np.full(300, 3.0), rng.uniform(0, 2, 300)],
    np.c_[rng.uniform(1, 1.5, 200), rng.uniform(1, 1.5, 200), rng.uniform(0, 0.5, 200)],
])
write_pcd("small_ascii.pcd", small, mode="ascii")

# Medium ~500K, large ~3M (room densified)
med = R[rng.integers(0, len(R), 500_000)] + rng.normal(0, 0.003, (500_000, 3))
write_pcd("medium_500k.pcd", med)
big = R[rng.integers(0, len(R), 3_000_000)] + rng.normal(0, 0.003, (3_000_000, 3))
write_pcd("large_3m.pcd", big)

# intensity + rgb, different field order, binary and compressed
n = len(R)
inten = rng.uniform(0, 255, n).astype(np.float32)
rgbc = rng.integers(0, 256, (n, 3))
extra = {"intensity": (inten, 4, "F"), "rgb": (pack_rgb(rgbc[:, 0], rgbc[:, 1], rgbc[:, 2]), 4, "F")}
write_pcd("room_rgb_intensity_reordered.pcd", R, extra=extra, order=["intensity", "rgb", "z", "y", "x"])
write_pcd("room_compressed.pcd", R, mode="binary_compressed", extra={"intensity": (inten, 4, "F")})
write_pcd("room_ascii_intensity.pcd", R[::10], mode="ascii", extra={"intensity": (inten[::10], 4, "F")})

# PLY variants
s = R[::5]
cs = rng.integers(0, 256, (len(s), 3))
write_ply("room_ascii_rgb.ply", s, "ascii", cs)
write_ply("room_ascii_plain.ply", s, "ascii")
write_ply("room_binle_rgb.ply", s, "binary_little_endian", cs)
write_ply("room_binle_plain.ply", s, "binary_little_endian")
write_ply("room_binbe_plain.ply", s, "binary_big_endian")

# XYZ variants
x = R[::20]
write_xyz("room_space.xyz", x, " ")
write_xyz("room_comma.xyz", x, ",")
write_xyz("room_tab.xyz", x, "\t")
write_xyz("room_crlf.xyz", x, " ", "\r\n")

# Tilted floor at z=-1.7: rotate 12° roll, 8° pitch, 30° yaw then translate
Rt = rot(np.radians(12), np.radians(8), np.radians(30))
tilted = R @ Rt.T + np.array([3.0, -2.0, -1.7])
write_pcd("tilted_room.pcd", tilted)
np.save(os.path.join(OUT, "tilted_R.npy"), Rt)

# Large coordinates and mm scale
write_pcd("utm_1e5.pcd", R + np.array([100000.0, 100000.0, 0]))
write_pcd("utm_1e6.pcd", R + np.array([500000.0, 4500000.0, 0]))
write_pcd("room_millimetres.pcd", R * 1000.0)
write_pcd("tiny_mm_object.pcd", R * 0.001)  # 1 cm room

# Floor-alignment scenes
walls_only = room(floor=False, box=False)
write_pcd("walls_only.pcd", walls_only)
two_floors = np.vstack([R, R + np.array([0, 0, 3.0])])
write_pcd("two_floors.pcd", two_floors)
rx = np.arange(0, 10, 0.05)
RX, RY = np.meshgrid(rx, np.arange(0, 3, 0.05))
ramp = np.c_[RX.ravel(), RY.ravel(), 0.15 * RX.ravel()]  # 8.5° ramp only
write_pcd("ramp_only.pcd", ramp)
flat = R.copy()
write_pcd("flat_room.pcd", flat)
aerial = np.c_[rng.uniform(0, 50, 200000), rng.uniform(0, 50, 200000), rng.uniform(0, 30, 200000)]  # no dominant floor
write_pcd("no_floor_noise.pcd", aerial)

# Measurement fixture: two dense blobs exactly 5.000 m apart (x=0 and x=5) on a floor
blob = rng.normal(0, 0.002, (3000, 3))
meas = np.vstack([blob + [0, 0, 0.5], blob + [5, 0, 0.5], np.c_[rng.uniform(-1, 6, 20000), rng.uniform(-1, 1, 20000), np.zeros(20000)]])
write_pcd("measure_5m.pcd", meas)

# Huge-area cloud (km scale): 2 x 2 km
km = np.c_[rng.uniform(0, 2000, 400000), rng.uniform(0, 2000, 400000), rng.uniform(0.2, 1.2, 400000)]
write_pcd("km_scale.pcd", km)
km_big = np.c_[rng.uniform(0, 10000, 200000), rng.uniform(0, 10000, 200000), rng.uniform(0.2, 1.2, 200000)]
write_pcd("10km_scale.pcd", km_big)

# Lasso fixture: two boxes at different depths aligned along view, plus floor
front = np.c_[rng.uniform(4, 5, 4000), rng.uniform(2, 3, 4000), rng.uniform(0, 1, 4000)]
back = np.c_[rng.uniform(4, 5, 4000), rng.uniform(7, 8, 4000), rng.uniform(0, 1, 4000)]
fl = np.c_[rng.uniform(0, 10, 20000), rng.uniform(0, 10, 20000), np.zeros(20000)]
write_pcd("lasso_scene.pcd", np.vstack([front, back, fl]))

# Noise fixture: dense room + isolated outliers far away
noise = np.vstack([R, rng.uniform(-20, 30, (500, 3))])
write_pcd("room_with_outliers.pcd", noise)

# ---------------- broken inputs ----------------
def raw(name, data):
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(data if isinstance(data, bytes) else data.encode())

raw("empty.pcd", b"")
raw("zero_points.pcd", header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 0, "ascii"))
raw("header_no_data_ascii.pcd", header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 10, "ascii"))
raw("header_no_data_binary.pcd", header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 10, "binary"))
pts100 = R[:100].astype("<f4")
raw("points_more_than_data.pcd", header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 200, "binary").encode() + pts100.tobytes())
raw("points_less_than_data.pcd", header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 50, "binary").encode() + pts100.tobytes())
raw("truncated_binary.pcd", header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 100, "binary").encode() + pts100.tobytes()[:-7])
raw("points_mismatch_ascii.pcd", header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 5, "ascii") + "0 0 0\n1 1 1\n")
raw("nan_inf.pcd", header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 6, "ascii") + "0 0 0\nnan 1 1\n1 inf 1\n-inf 2 2\n2 2 2\n3 3 nan\n")
raw("all_nan.pcd", header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 2, "ascii") + "nan nan nan\nnan 1 1\n")
png = b"\x89PNG\r\n\x1a\n" + zlib.compress(b"x" * 1000)
raw("image_renamed.pcd", png)
raw("text_renamed.pcd", "hello world\nthis is not a point cloud\n")
raw("long_line.pcd", header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 2, "ascii").replace("VERSION", "# " + "A" * 2_000_000 + "\nVERSION") + "0 0 0\n1 1 1\n")
raw("bom.pcd", b"\xef\xbb\xbf" + header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 2, "ascii").encode() + b"0 0 0\n1 1 1\n")
raw("crlf.pcd", (header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 2, "ascii") + "0 0 0\n1 1 1\n").replace("\n", "\r\n"))
raw("no_xyz_fields.pcd", header(["a", "b"], [4, 4], ["F", "F"], [1, 1], 2, "ascii") + "0 0\n1 1\n")
raw("empty.xyz", b"")
raw("empty.ply", b"")
raw("garbage.ply", "ply\nformat ascii 1.0\nelement vertex 5\nproperty float x\nend_header\n1\n2\n")
raw("cloud.las", b"LASF" + b"\0" * 300)
raw("cloud.e57", b"ASTM-E57" + b"\0" * 300)
raw("cloud.zip", b"PK\x03\x04" + b"\0" * 300)
raw("noext", header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 2, "ascii") + "0 0 0\n1 1 1\n")
raw("UPPER.PCD", header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 2, "ascii") + "0 0 0\n1 1 1\n")
raw("int_xyz_binary.pcd", header(list("xyz"), [4] * 3, ["I"] * 3, [1] * 3, 2, "binary").encode() + np.array([[0, 0, 0], [1, 2, 3]], "<i4").tobytes())
raw("f64_binary.pcd", header(list("xyz"), [8] * 3, ["F"] * 3, [1] * 3, 2, "binary").encode() + np.array([[0, 0, 0], [1, 2, 3]], "<f8").tobytes())

# ---------------- security / hostile ----------------
xss = "<img src=x onerror=window.__xss=1><script>window.__xss=2</script>"
raw("xss_header.pcd", header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 2, "ascii").replace("# .PCD", "# " + xss + "\n# .PCD") + "0 0 0\n1 1 1\n")
raw("xss_field.pcd", header(["x", "y", "z", xss.replace(" ", "_")], [4] * 4, ["F"] * 4, [1] * 4, 2, "ascii") + "0 0 0 1\n1 1 1 2\n")
raw("proto_fields.pcd", header(["x", "y", "z", "__proto__", "constructor"], [4] * 5, ["F"] * 5, [1] * 5, 2, "ascii") + "0 0 0 1 1\n1 1 1 2 2\n")
raw("xss_comment.ply", "ply\nformat ascii 1.0\ncomment " + xss + "\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 1 1\n")
raw("huge_header.pcd", ("# filler comment line\n" * 200_000) + header(list("xyz"), [4] * 3, ["F"] * 3, [1] * 3, 2, "ascii") + "0 0 0\n1 1 1\n")

# file name variants (content = small ascii)
small_txt = open(os.path.join(OUT, "small_ascii.pcd"), "rb").read()
for nm in ["ölçüm şğı İç Ğ.pcd", "with spaces in name.pcd", ("L" * 200) + ".pcd", 'evil<img src=x onerror=window.__xss=3>.pcd', "cloud # cropped: yes.pcd", "a.b.c.final.pcd", ".hidden.pcd"]:
    raw(nm, small_txt)
print("fixtures:", len(os.listdir(OUT)))
