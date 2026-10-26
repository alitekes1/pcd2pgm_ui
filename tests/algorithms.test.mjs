// Run: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import * as alg from "../js/algorithms.js";

const rng = (() => { let s = 42; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); })();

test("voxelDownsample keeps one point per voxel, nearest to center", () => {
  const pos = new Float32Array([0.01, 0.01, 0.01, 0.05, 0.05, 0.05, 0.02, 0.02, 0.02, 1.05, 0, 0]);
  const kept = Array.from(alg.voxelDownsample(pos, 0.1));
  assert.deepEqual(kept, [1, 3]);
});

test("SOR matches brute-force kNN SOR and drops isolated outliers", () => {
  const pts = [];
  for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) pts.push(i * 0.05, j * 0.05, rng() * 0.002);
  const P = new Float32Array(pts), n = P.length / 3, k = 8;
  const md = [];
  for (let i = 0; i < n; i++) {
    const d = [];
    for (let j = 0; j < n; j++) if (j !== i) d.push(Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]));
    d.sort((a, b) => a - b);
    md.push(d.slice(0, k).reduce((a, b) => a + b) / k);
  }
  const mu = md.reduce((a, b) => a + b) / n;
  const sd = Math.sqrt(md.reduce((a, b) => a + (b - mu) ** 2, 0) / n);
  const exact = md.flatMap((v, i) => (v <= mu + sd ? [i] : []));
  assert.deepEqual(Array.from(alg.statisticalOutlierRemoval(P, k, 1.0)), exact);

  const withOutliers = new Float32Array([...pts, 10, 10, 10, -5, 3, 2]); // indices n, n+1
  const kept = Array.from(alg.statisticalOutlierRemoval(withOutliers, k, 1.0));
  assert.deepEqual(kept, exact);
});

test("RANSAC finds a tilted floor despite a wall; alignment maps normal to +Z", () => {
  const pts = [];
  const tilt = 0.1; // floor z = 0.1*x + 0.5
  for (let i = 0; i < 3000; i++) { const x = rng() * 10, y = rng() * 10; pts.push(x, y, tilt * x + 0.5 + (rng() - 0.5) * 0.01); }
  for (let i = 0; i < 2000; i++) pts.push(0, rng() * 10, rng() * 3); // wall x = 0 (vertical, must be ignored)
  const r = alg.fitPlaneRansac(new Float32Array(pts), { threshold: 0.03, iterations: 300, maxTiltDeg: 20 });
  const expected = [-tilt, 0, 1].map((v) => v / Math.hypot(tilt, 1));
  for (let a = 0; a < 3; a++) assert.ok(Math.abs(r.normal[a] - expected[a]) < 0.01, `normal ${r.normal}`);
  assert.ok(r.inliers >= 2900, `inliers ${r.inliers}`);
  const R = alg.rotationAlignToZ(r.normal);
  const n = r.normal;
  const rz = [0, 1, 2].map((row) => R[row * 3] * n[0] + R[row * 3 + 1] * n[1] + R[row * 3 + 2] * n[2]);
  assert.ok(Math.abs(rz[0]) < 1e-9 && Math.abs(rz[1]) < 1e-9 && Math.abs(rz[2] - 1) < 1e-9);
  const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
  assert.ok(Math.abs(det - 1) < 1e-9);
  assert.ok(r.inliers > 5 * r.beside, `floor stands out: inliers ${r.inliers}, beside ${r.beside}`);
});

test("RANSAC on walls without a floor: best plane is no denser than the slabs beside it", () => {
  const pts = [];
  for (let i = 0; i < 4000; i++) { const t = rng() * 10, z = rng() * 3; pts.push(...(i % 2 ? [t, 0, z] : [0, t, z])); }
  const r = alg.fitPlaneRansac(new Float32Array(pts), { threshold: 0.05, iterations: 300, maxTiltDeg: 20 });
  assert.ok(r.inliers < 2 * r.beside, `inliers ${r.inliers}, beside ${r.beside}`);
});

test("radiusOutlierRemoval matches brute force (PCL: >= k other points within r)", () => {
  const pts = [];
  for (let i = 0; i < 400; i++) pts.push(rng() * 2, rng() * 2, rng() * 0.5);
  pts.push(10, 10, 10); // isolated
  const P = new Float32Array(pts), n = P.length / 3, r = 0.2, k = 3;
  const exact = [];
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let j = 0; j < n; j++) if (j !== i && Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]) <= r) c++;
    if (c >= k) exact.push(i);
  }
  assert.ok(exact.length > 100 && !exact.includes(n - 1));
  assert.deepEqual(Array.from(alg.radiusOutlierRemoval(P, r, k)), exact);
  assert.equal(alg.radiusOutlierRemoval(P, r, 0).length, n);
});

test("pcd2pgmGrid: origin at min x/y, free everywhere except hit cells, top row = max y", () => {
  const g = alg.pcd2pgmGrid(new Float32Array([1, 2, 1.95, 2, 1, 2.45]), 0.1);
  assert.deepEqual([g.width, g.height], [10, 5]);
  assert.deepEqual(g.origin, [1, 2, 0]);
  assert.equal(g.data[(g.height - 1) * g.width + 0], 0); // (1, 2) bottom-left
  assert.equal(g.data[(g.height - 1) * g.width + 9], 0); // (1.95, 2) on the max-x edge is kept
  assert.equal(g.data[0], 0); // (1, 2.45) top-left
  assert.equal(g.data.filter((v) => v === 254).length, 50 - 3);
  assert.ok(alg.encodeMapYaml(g, "m.pgm").includes("mode: trinary"));
  const pgm = alg.encodePGM(g);
  assert.equal(pgm.length - g.data.length, new TextDecoder().decode(pgm).indexOf("255\n") + 4);
});

test("encodeMapYaml quotes the image name so YAML-special file names survive", () => {
  const g = { resolution: 0.05, origin: [1, 2, 0] };
  for (const name of ["m.pgm", "cloud # cropped: yes_map.pgm", ' a "b" \\ ü.pgm']) {
    const line = alg.encodeMapYaml(g, name).split("\n")[0];
    assert.ok(line.startsWith('image: "'), line);
    assert.equal(JSON.parse(line.slice("image: ".length)), name); // JSON strings are YAML double-quoted scalars
  }
});

test("pcdPositionError rejects binary x/y/z that PCDLoader would misread as float32", () => {
  const head = (data, size = "4 4 4", type = "F F F") =>
    `# .PCD v0.7\nVERSION 0.7\nFIELDS x y z\nSIZE ${size}\nTYPE ${type}\nCOUNT 1 1 1\nWIDTH 1\nHEIGHT 1\nPOINTS 1\nDATA ${data}\n`;
  assert.equal(alg.pcdPositionError(head("binary")), null);
  assert.equal(alg.pcdPositionError(head("binary_compressed")), null);
  assert.equal(alg.pcdPositionError(head("ascii", "8 8 8")), null); // text is parsed as text
  assert.match(alg.pcdPositionError(head("binary", "8 8 8")), /x\/y\/z.*F8/);
  assert.match(alg.pcdPositionError(head("binary_compressed", "4 4 4", "F F I")), /z.*I4/);
});

test("parseNumberField accepts , and . and only clamps once the field is left", () => {
  const p = alg.parseNumberField;
  assert.equal(p("0,05", 0.01, 1), 0.05);
  assert.equal(p(" 0.07 ", 0.01, 1), 0.07);
  assert.equal(p("1e-1", 0.01, 1), 0.1);
  assert.equal(p("-1,5"), -1.5);
  for (const half of ["", "-", "0,", "abc", "0.05abc", "Infinity"]) assert.equal(p(half, 0.01, 1), null, half);
  assert.equal(p("0", 0.01, 1), null); // "0" on the way to "0.05": not applied yet
  assert.equal(p("5", 0.01, 1), null);
  assert.equal(p("0", 0.01, 1, true), 0.01); // field left: clamped
  assert.equal(p("5", 0.01, 1, true), 1);
  assert.equal(p("abc", 0.01, 1, true), null); // invalid text never becomes a value
});

test("stepNumber moves one step on the step grid, like a number input's spinner", () => {
  const s = alg.stepNumber;
  assert.equal(s(0.05, 0.01, 1), 0.06);
  assert.equal(s(0.05, 0.01, -1), 0.04);
  assert.equal(s(0.123, 0.01, 1), 0.13); // off-grid value snaps to the grid
  assert.equal(s(0.123, 0.01, -1), 0.11);
  assert.equal(s(0.1, 0.1, 1), 0.2); // no 0.30000000000000004
  assert.equal(s(-19.96, 0.1, 1), -19.9);
  assert.equal(s(0.01, 0.01, -1, 0.01, 1), 0.01); // clamped to min / max
  assert.equal(s(1, 0.01, 1, 0.01, 1), 1);
  assert.equal(s(179, 1, 1, -180, 180), 180);
});

test("selectInMask projects with identity view-projection", () => {
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const mask = new Uint8Array(4 * 4); mask[0] = 1; // top-left pixel
  const pos = new Float32Array([-0.9, 0.9, 0, 0.9, -0.9, 0]);
  assert.deepEqual(Array.from(alg.selectInMask(pos, [0, 1], I, mask, 4, 4)), [1, 0]);
});

test("encodePCD binary layout and PCL-style packed rgb", () => {
  const data = { positions: new Float32Array([1, 2, 3]), colors: new Uint8Array([255, 128, 1]), intensity: new Float32Array([7]) };
  const buf = alg.encodePCD(data);
  const text = new TextDecoder().decode(buf);
  assert.ok(text.includes("FIELDS x y z rgb intensity") && text.includes("DATA binary\n"));
  const off = text.indexOf("DATA binary\n") + "DATA binary\n".length;
  const dv = new DataView(buf, off);
  assert.equal(dv.getFloat32(8, true), 3);
  assert.equal(dv.getUint32(12, true), (255 << 16) | (128 << 8) | 1);
  assert.equal(dv.getFloat32(16, true), 7);
  assert.equal(alg.linearToSrgbByte(1), 255);
  assert.equal(alg.linearToSrgbByte(0.21586), 128);
});
