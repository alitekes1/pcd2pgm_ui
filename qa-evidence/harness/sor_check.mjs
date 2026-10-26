import fs from "node:fs";
import * as alg from "/home/tekes/pcd2pgm_ui/js/algorithms.js";
const b = fs.readFileSync("/tmp/pcd2pgm-qa/fx/room_with_outliers.pcd");
const off = b.indexOf("DATA binary\n") + 12;
const pos = new Float32Array(b.buffer.slice(b.byteOffset + off, b.byteOffset + b.length));
const n = pos.length / 3, nRoom = n - 500;
const kept = alg.statisticalOutlierRemoval(pos, 8, 1.0);
const keep = new Uint8Array(n); for (const k of kept) keep[k] = 1;
let outKept = 0, roomDropped = 0;
for (let i = 0; i < n; i++) { if (i >= nRoom && keep[i]) outKept++; if (i < nRoom && !keep[i]) roomDropped++; }
console.log({ n, kept: kept.length, outliersKept: `${outKept}/500`, roomPointsDropped: roomDropped });
// brute-force PCL semantics on a subsample of outliers: mean distance to the 8 nearest neighbours
const sample = [nRoom, nRoom + 1, nRoom + 2, 0, 5000, 60000];
const md = (i) => { const d = []; for (let j = 0; j < n; j++) if (j !== i) d.push(Math.hypot(pos[i*3]-pos[j*3], pos[i*3+1]-pos[j*3+1], pos[i*3+2]-pos[j*3+2])); d.sort((a, c) => a - c); return d.slice(0, 8).reduce((a, c) => a + c) / 8; };
for (const i of sample) console.log(i >= nRoom ? "outlier" : "room   ", i, "bruteMeanD8 =", md(i).toFixed(3), "kept:", !!keep[i]);
