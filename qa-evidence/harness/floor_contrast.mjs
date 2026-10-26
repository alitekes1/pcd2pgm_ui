// Measure floor discriminators for detectGround outside the browser.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const alg = await import(pathToFileURL("/home/tekes/pcd2pgm_ui/js/algorithms.js"));
function readPcd(f) {
  const buf = fs.readFileSync(f);
  const hEnd = buf.indexOf("DATA ") ; const nl = buf.indexOf("\n", hEnd);
  const h = buf.slice(0, nl).toString();
  const get = (k) => (h.match(new RegExp(`^${k} (.*)$`, "m")) || [])[1]?.trim().split(/\s+/);
  const fields = get("FIELDS"), size = get("SIZE").map(Number), count = (get("COUNT") || fields.map(() => "1")).map(Number), type = get("TYPE");
  const n = +get("POINTS")[0], data = get("DATA")[0];
  const off = []; let s = 0; fields.forEach((_, i) => { off.push(s); s += size[i] * count[i]; });
  const ix = ["x", "y", "z"].map((k) => fields.indexOf(k));
  const out = new Float32Array(n * 3);
  if (data === "ascii") {
    const lines = buf.slice(nl + 1).toString().trim().split(/\r?\n/);
    lines.slice(0, n).forEach((l, i) => { const t = l.trim().split(/\s+/); for (let k = 0; k < 3; k++) out[i * 3 + k] = +t[ix[k]]; });
  } else {
    const dv = new DataView(buf.buffer, buf.byteOffset + nl + 1);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = dv.getFloat32(i * s + off[ix[k]], true);
  }
  return out;
}
for (const f of process.argv.slice(2)) {
  const p = readPcd(f);
  const z = []; for (let i = 2; i < p.length; i += 3) if (Number.isFinite(p[i])) z.push(p[i]);
  const cut = z.slice().sort((a, b) => a - b)[Math.floor(z.length * 0.3)];
  const low = []; for (let i = 0; i < p.length; i += 3) if (p[i + 2] <= cut && Number.isFinite(p[i + 2])) low.push(p[i], p[i + 1], p[i + 2]);
  const L = new Float32Array(low);
  const thr = 0.05, r = alg.fitPlaneRansac(L, { threshold: thr, iterations: 500, maxTiltDeg: 20 });
  let above = 0, below = 0;
  const [a, b, c] = r.normal;
  for (let j = 0; j < L.length; j += 3) { const s = a * L[j] + b * L[j + 1] + c * L[j + 2] + r.d; if (s >= thr && s < 3 * thr) above++; if (s <= -thr && s > -3 * thr) below++; }
  console.log(f.split("/").pop().padEnd(40), "share", (r.inliers / r.total).toFixed(3), "above", above, "below", below, "inl", r.inliers, "contrast", (r.inliers / Math.max(1, Math.max(above, below))).toFixed(2), "tilt", (Math.acos(Math.min(1, r.normal[2])) * 180 / Math.PI).toFixed(2));
}
