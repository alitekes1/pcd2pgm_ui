"""Merge all result files, drop superseded harness results, apply reviewed verdicts, count."""
import json, glob, os, re, collections

OUT = "/tmp/pcd2pgm-qa/out"
def br(fname):
    for b in ("firefox", "webkit"):
        if b in fname:
            return b
    return "chromium"

rows = []
for f in sorted(glob.glob(f"{OUT}/*.json")):
    name = os.path.basename(f)
    if name.startswith("LIVE"):
        continue
    for r in json.load(open(f)):
        r["browser"] = br(name)
        r["src"] = name
        r["base"] = re.sub(r"-(firefox|webkit)$", "", r["id"])
        rows.append(r)

drop = [
    # superseded by targeted re-tests
    lambda r: r["src"].startswith("F-") and r["base"] in ("F-01c", "F-09b"),
    lambda r: r["src"].startswith("BCD") and r["base"] in ("C-05", "C-05b", "C-07", "D-01", "D-11"),
    lambda r: r["src"].startswith("Ckeys-") and r["base"] == "C-07",
    lambda r: r["src"].startswith("Drace-") and r["base"].startswith("D-11[") and "align" not in r["base"],
    lambda r: r["base"].startswith("BCD-abort") or r["base"].startswith("F-abort") or r["base"].startswith("EGHI-abort"),
]
rows = [r for r in rows if not any(d(r) for d in drop)]

verdict = {  # base id -> final status after review (applies to every browser unless noted)
    "F-console": "PASS",          # only the app's own console.error of user-facing messages
    "F-09e": "PASS",
    "B-01[tilted_room.pcd]": "PASS",  # 14.30° vs 14.37° true, residual 0.12°, no drift
    "B-04[two_floors.pcd]": "PASS", "B-04[ramp_only.pcd]": "PASS", "B-04[go2_mid360_new_office_route1.pcd]": "PASS",
    "B-04[walls_only.pcd]": "FAIL", "B-04[no_floor_noise.pcd]": "FAIL",
    "D-03b": "PASS", "D-05": "PASS", "D-10": "FAIL", "D-11[align+undo]": "PASS",
    "E-02b": "PASS", "E-07b": "PASS", "H-03a": "PASS", "H-04": "PASS",
    "G-02": "PASS", "G-07b": "NA", "A-03b": "PASS", "A-06b": "FAIL", "I-04": "FAIL",
}
a02_fail = {"A-02[points_mismatch_ascii.pcd]", "A-02[room_comma.xyz]"}
for r in rows:
    b = r["base"]
    if b in verdict:
        r["final"] = verdict[b]
    elif b.startswith("A-02["):
        r["final"] = "FAIL" if b in a02_fail else "PASS"
    elif b == "D-11[Downsample]":
        r["final"] = "FAIL" if r["browser"] == "chromium" else "PASS"  # chromium: result applied after undo (2,610,360)
    elif r["status"] == "REVIEW":
        r["final"] = "?"
    else:
        r["final"] = r["status"]

c = collections.Counter(r["final"] for r in rows)
print("TOTAL", len(rows), dict(c))
for b in ("chromium", "firefox", "webkit"):
    cb = collections.Counter(r["final"] for r in rows if r["browser"] == b)
    print(b, sum(cb.values()), dict(cb))
for area in "ABCDEFGHI":
    ca = collections.Counter(r["final"] for r in rows if r["area"].startswith(area) or (r["area"] in ("BCD", "EGHI") and False))
    print(area, dict(ca))
print("UNRESOLVED", [(r["id"], r["src"]) for r in rows if r["final"] == "?"])
print("FAILS")
for r in rows:
    if r["final"] == "FAIL":
        print(" ", r["browser"], r["id"])
json.dump(rows, open(f"{OUT}/merged.json", "w"), ensure_ascii=False, indent=1)
