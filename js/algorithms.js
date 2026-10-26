// Pure point-cloud algorithms and encoders. No three.js / DOM dependency so they
// run in the main thread, in js/worker.js and under node (tests/algorithms.test.mjs).
// Positions are always flat arrays [x0,y0,z0, x1,y1,z1, ...].

export function computeBounds(pos) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = pos[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

// three.js loaders convert sRGB file colors to linear; files must get sRGB back.
export function linearToSrgbByte(c) {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

// ---------------------------------------------------------------------------
// Voxel grid downsampling: keeps, per voxel, the original point closest to the
// voxel center (all attributes stay untouched, no averaging).
export function voxelDownsample(pos, size) {
  const n = pos.length / 3;
  if (!(size > 0)) throw new Error("Voxel size must be > 0");
  if (n === 0) return new Uint32Array(0);
  const { min, max } = computeBounds(pos);
  const inv = 1 / size;
  const nx = Math.floor((max[0] - min[0]) * inv) + 1;
  const ny = Math.floor((max[1] - min[1]) * inv) + 1;
  const nz = Math.floor((max[2] - min[2]) * inv) + 1;
  if (nx * ny * nz > Number.MAX_SAFE_INTEGER) throw new Error("Voxel size too small for this cloud");

  const slotOf = new Map();
  const bestIdx = new Uint32Array(n);
  const bestD = new Float64Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const ix = Math.floor((x - min[0]) * inv);
    const iy = Math.floor((y - min[1]) * inv);
    const iz = Math.floor((z - min[2]) * inv);
    const dx = x - (min[0] + (ix + 0.5) * size);
    const dy = y - (min[1] + (iy + 0.5) * size);
    const dz = z - (min[2] + (iz + 0.5) * size);
    const d = dx * dx + dy * dy + dz * dz;
    const key = ix + nx * (iy + ny * iz);
    const s = slotOf.get(key);
    if (s === undefined) {
      slotOf.set(key, m);
      bestIdx[m] = i;
      bestD[m] = d;
      m++;
    } else if (d < bestD[s]) {
      bestIdx[s] = i;
      bestD[s] = d;
    }
  }
  return bestIdx.slice(0, m).sort();
}

// ---------------------------------------------------------------------------
// Uniform grid in CSR layout for neighbour queries.
function buildGrid(pos, cell, min) {
  const n = pos.length / 3;
  const inv = 1 / cell;
  const { max } = computeBounds(pos);
  const nx = Math.floor((max[0] - min[0]) * inv) + 1;
  const ny = Math.floor((max[1] - min[1]) * inv) + 1;
  const nz = Math.floor((max[2] - min[2]) * inv) + 1;
  const cellOfPoint = new Uint32Array(n);
  const keyToCell = new Map();
  const counts = [];
  const pc = new Int32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const ix = Math.floor((pos[i * 3] - min[0]) * inv);
    const iy = Math.floor((pos[i * 3 + 1] - min[1]) * inv);
    const iz = Math.floor((pos[i * 3 + 2] - min[2]) * inv);
    pc[i * 3] = ix; pc[i * 3 + 1] = iy; pc[i * 3 + 2] = iz;
    const key = ix + nx * (iy + ny * iz);
    let c = keyToCell.get(key);
    if (c === undefined) { c = counts.length; keyToCell.set(key, c); counts.push(0); }
    counts[c]++;
    cellOfPoint[i] = c;
  }
  const start = new Uint32Array(counts.length + 1);
  for (let c = 0; c < counts.length; c++) start[c + 1] = start[c] + counts[c];
  const fill = start.slice(0, counts.length);
  const items = new Uint32Array(n);
  for (let i = 0; i < n; i++) items[fill[cellOfPoint[i]]++] = i;
  return { nx, ny, nz, keyToCell, start, items, pc };
}

// Picks a cell size giving roughly `target` points per occupied cell, so the
// 27-cell neighbourhood usually contains >= k candidates.
function estimateCellSize(pos, target) {
  const n = pos.length / 3;
  const { min, max } = computeBounds(pos);
  const ext = [0, 1, 2].map((a) => Math.max(max[a] - min[a], 1e-6));
  let s = Math.cbrt((ext[0] * ext[1] * ext[2] * target) / n);
  for (let iter = 0; iter < 8; iter++) {
    const inv = 1 / s;
    const nx = Math.floor(ext[0] * inv) + 1, ny = Math.floor(ext[1] * inv) + 1;
    if (nx * ny * (Math.floor(ext[2] * inv) + 1) > Number.MAX_SAFE_INTEGER) { s *= 2; continue; }
    const keys = new Set();
    for (let i = 0; i < pos.length; i += 3) {
      keys.add(
        Math.floor((pos[i] - min[0]) * inv) +
          nx * (Math.floor((pos[i + 1] - min[1]) * inv) + ny * Math.floor((pos[i + 2] - min[2]) * inv))
      );
    }
    const occ = n / keys.size;
    if (occ >= target / 2 && occ <= target * 2) break;
    // assume surface-like (2D) data: occupancy grows with s^2
    s *= Math.min(4, Math.max(0.25, Math.sqrt(target / occ)));
  }
  return { cell: s, min };
}

// Statistical outlier removal (PCL-style): mean distance to k nearest
// neighbours; keep points with mean <= mu + stdMul * sigma.
// ponytail: kNN is searched only in the 27 surrounding grid cells (approximate);
// a point with no neighbour there is treated as an outlier. Use a k-d tree if
// exact kNN on very non-uniform clouds is ever needed.
export function statisticalOutlierRemoval(pos, k = 8, stdMul = 1.0) {
  const n = pos.length / 3;
  k = Math.max(1, Math.floor(k));
  if (n <= k) return Uint32Array.from({ length: n }, (_, i) => i);
  const { cell, min } = estimateCellSize(pos, k);
  const g = buildGrid(pos, cell, min);
  const meanD = new Float64Array(n);
  const best = new Float64Array(k);

  for (let i = 0; i < n; i++) {
    best.fill(Infinity);
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const cx = g.pc[i * 3], cy = g.pc[i * 3 + 1], cz = g.pc[i * 3 + 2];
    for (let dz = -1; dz <= 1; dz++) {
      const iz = cz + dz; if (iz < 0 || iz >= g.nz) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const iy = cy + dy; if (iy < 0 || iy >= g.ny) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const ix = cx + dx; if (ix < 0 || ix >= g.nx) continue;
          const c = g.keyToCell.get(ix + g.nx * (iy + g.ny * iz));
          if (c === undefined) continue;
          for (let p = g.start[c], e = g.start[c + 1]; p < e; p++) {
            const j = g.items[p];
            if (j === i) continue;
            const ax = pos[j * 3] - x, ay = pos[j * 3 + 1] - y, az = pos[j * 3 + 2] - z;
            const d2 = ax * ax + ay * ay + az * az;
            if (d2 >= best[k - 1]) continue;
            let q = k - 1;
            while (q > 0 && best[q - 1] > d2) { best[q] = best[q - 1]; q--; }
            best[q] = d2;
          }
        }
      }
    }
    let sum = 0, cnt = 0;
    for (let q = 0; q < k && best[q] !== Infinity; q++) { sum += Math.sqrt(best[q]); cnt++; }
    meanD[i] = cnt ? sum / cnt : Infinity;
  }

  let s = 0, s2 = 0, m = 0;
  for (let i = 0; i < n; i++) if (meanD[i] !== Infinity) { s += meanD[i]; s2 += meanD[i] * meanD[i]; m++; }
  if (m === 0) return new Uint32Array(0);
  const mu = s / m;
  const sigma = Math.sqrt(Math.max(0, s2 / m - mu * mu));
  const thr = mu + stdMul * sigma;
  const keep = [];
  for (let i = 0; i < n; i++) if (meanD[i] <= thr) keep.push(i);
  return Uint32Array.from(keep);
}

// ---------------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// RANSAC plane fit restricted to planes within maxTiltDeg of the +Z axis
// (ground / floor), followed by a least-squares refinement on the inliers.
// Returns { normal:[nx,ny,nz] (nz>=0), d, inliers, beside, total } with n·p + d = 0, or null.
export function fitPlaneRansac(pos, { threshold = 0.05, iterations = 500, maxTiltDeg = 20, seed = 1 } = {}) {
  const n = pos.length / 3;
  if (n < 3) return null;
  const rnd = mulberry32(seed);
  const cosMax = Math.cos((maxTiltDeg * Math.PI) / 180);
  const countInliers = (nx, ny, nz, d) => {
    let c = 0;
    for (let j = 0; j < pos.length; j += 3) if (Math.abs(nx * pos[j] + ny * pos[j + 1] + nz * pos[j + 2] + d) < threshold) c++;
    return c;
  };

  let best = null, bestCount = 0;
  for (let it = 0; it < iterations; it++) {
    const a = Math.floor(rnd() * n) * 3, b = Math.floor(rnd() * n) * 3, c = Math.floor(rnd() * n) * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;
    nx /= len; ny /= len; nz /= len;
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    if (nz < cosMax) continue;
    const d = -(nx * pos[a] + ny * pos[a + 1] + nz * pos[a + 2]);
    const cnt = countInliers(nx, ny, nz, d);
    if (cnt > bestCount) { bestCount = cnt; best = [nx, ny, nz, d]; }
  }
  if (!best) return null;

  // Least-squares refinement: smallest eigenvector of the inlier covariance,
  // found by power iteration on (trace*I - C).
  const [bx, by, bz, bd] = best;
  let cx = 0, cy = 0, cz = 0, m = 0;
  for (let j = 0; j < pos.length; j += 3) {
    if (Math.abs(bx * pos[j] + by * pos[j + 1] + bz * pos[j + 2] + bd) < threshold) {
      cx += pos[j]; cy += pos[j + 1]; cz += pos[j + 2]; m++;
    }
  }
  cx /= m; cy /= m; cz /= m;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let j = 0; j < pos.length; j += 3) {
    if (Math.abs(bx * pos[j] + by * pos[j + 1] + bz * pos[j + 2] + bd) < threshold) {
      const x = pos[j] - cx, y = pos[j + 1] - cy, z = pos[j + 2] - cz;
      xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z;
    }
  }
  const tr = xx + yy + zz;
  let v = [bx, by, bz];
  for (let it = 0; it < 100; it++) {
    const w = [
      (tr - xx) * v[0] - xy * v[1] - xz * v[2],
      -xy * v[0] + (tr - yy) * v[1] - yz * v[2],
      -xz * v[0] - yz * v[1] + (tr - zz) * v[2],
    ];
    const l = Math.hypot(w[0], w[1], w[2]);
    if (l < 1e-20) break;
    v = [w[0] / l, w[1] / l, w[2] / l];
  }
  if (v[2] < 0) v = v.map((c) => -c);
  if (v[2] < cosMax) v = [bx, by, bz]; // refinement drifted out of the tilt cone; keep RANSAC result
  const d = -(v[0] * cx + v[1] * cy + v[2] * cz);
  // A floor is far denser than the equally thick slab just above or below it; RANSAC's best
  // plane through walls or clutter is not (inliers ≈ beside), so callers can tell them apart.
  let above = 0, below = 0;
  for (let j = 0; j < pos.length; j += 3) {
    const s = v[0] * pos[j] + v[1] * pos[j + 1] + v[2] * pos[j + 2] + d;
    if (s >= threshold && s < 3 * threshold) above++;
    else if (s <= -threshold && s > -3 * threshold) below++;
  }
  return { normal: v, d, inliers: countInliers(v[0], v[1], v[2], d), beside: Math.max(above, below), total: n };
}

// Row-major 3x3 rotation taking unit vector n onto +Z (Rodrigues).
export function rotationAlignToZ(n) {
  const [x, y, z] = n;
  if (z > 1 - 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (z < -1 + 1e-12) return [1, 0, 0, 0, -1, 0, 0, 0, -1];
  // axis k = n × z = (y, -x, 0), sin = |k|, cos = z
  const s = Math.hypot(x, y), c = z;
  const kx = y / s, ky = -x / s;
  const t = 1 - c;
  return [
    c + kx * kx * t, kx * ky * t, ky * s,
    kx * ky * t, c + ky * ky * t, -kx * s,
    -ky * s, kx * s, c,
  ];
}

// ---------------------------------------------------------------------------
// pcd2pgm pipeline (github.com/LihanChen2004/pcd2pgm), after the z pass-through:

// PCL RadiusOutlierRemoval: keep a point when at least `minNeighbors` *other*
// points lie within `radius` of it. Returns kept indices.
export function radiusOutlierRemoval(pos, radius, minNeighbors) {
  const n = pos.length / 3;
  minNeighbors = Math.floor(minNeighbors);
  if (!(radius > 0) || minNeighbors <= 0) return Uint32Array.from({ length: n }, (_, i) => i);
  if (n === 0) return new Uint32Array(0);
  const { min, max } = computeBounds(pos);
  const cells = [0, 1, 2].reduce((p, a) => p * (Math.floor((max[a] - min[a]) / radius) + 1), 1);
  if (cells > Number.MAX_SAFE_INTEGER) throw new Error("Radius too small for this cloud");
  const g = buildGrid(pos, radius, min); // cell = radius: all neighbours are in the 27 surrounding cells
  const r2 = radius * radius;
  const keep = [];
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const cx = g.pc[i * 3], cy = g.pc[i * 3 + 1], cz = g.pc[i * 3 + 2];
    let found = 0;
    search: for (let dz = -1; dz <= 1; dz++) {
      const iz = cz + dz; if (iz < 0 || iz >= g.nz) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const iy = cy + dy; if (iy < 0 || iy >= g.ny) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const ix = cx + dx; if (ix < 0 || ix >= g.nx) continue;
          const c = g.keyToCell.get(ix + g.nx * (iy + g.ny * iz));
          if (c === undefined) continue;
          for (let p = g.start[c], e = g.start[c + 1]; p < e; p++) {
            const j = g.items[p];
            if (j === i) continue;
            const ax = pos[j * 3] - x, ay = pos[j * 3 + 1] - y, az = pos[j * 3 + 2] - z;
            if (ax * ax + ay * ay + az * az <= r2 && ++found >= minNeighbors) break search;
          }
        }
      }
    }
    if (found >= minNeighbors) keep.push(i);
  }
  return Uint32Array.from(keep);
}

// Occupancy grid like pcd2pgm's setMapTopicMsg: origin = min x/y of the points,
// every cell free (254) except cells containing a point (0). xy = [x0,y0,x1,y1,...].
// Row 0 of `data` is the top (max y), as map_saver writes it.
// pcd2pgm sizes the grid with ceil(), which drops points lying exactly on the max
// edge; floor()+1 keeps them.
export function pcd2pgmGrid(xy, resolution) {
  if (!(resolution > 0)) throw new Error("Resolution must be > 0");
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < xy.length; i += 2) {
    if (xy[i] < minX) minX = xy[i];
    if (xy[i] > maxX) maxX = xy[i];
    if (xy[i + 1] < minY) minY = xy[i + 1];
    if (xy[i + 1] > maxY) maxY = xy[i + 1];
  }
  if (minX === Infinity) throw new Error("No points left for the map");
  const width = Math.floor((maxX - minX) / resolution) + 1;
  const height = Math.floor((maxY - minY) / resolution) + 1;
  if (width * height > 1e8) throw new Error(`Map too large (${width}×${height}); increase the resolution`);
  const data = new Uint8Array(width * height).fill(254);
  for (let i = 0; i < xy.length; i += 2) {
    const cx = Math.floor((xy[i] - minX) / resolution);
    const cy = Math.floor((xy[i + 1] - minY) / resolution);
    data[(height - 1 - cy) * width + cx] = 0;
  }
  return { width, height, resolution, origin: [minX, minY, 0], data };
}

export function encodePGM(grid) {
  const header = new TextEncoder().encode(`P5\n# pcd_tools occupancy map\n${grid.width} ${grid.height}\n255\n`);
  const out = new Uint8Array(header.length + grid.data.length);
  out.set(header, 0);
  out.set(grid.data, header.length);
  return out;
}

export function encodeMapYaml(grid, imageName) {
  const f = (v) => String(+v.toFixed(6));
  return [
    `image: ${JSON.stringify(imageName)}`, // a JSON string is a valid YAML double-quoted scalar ("#", ": " stay literal)
    "mode: trinary",
    `resolution: ${f(grid.resolution)}`,
    `origin: [${f(grid.origin[0])}, ${f(grid.origin[1])}, 0.0]`,
    "negate: 0",
    "occupied_thresh: 0.65",
    "free_thresh: 0.196",
    "",
  ].join("\n");
}

// three's PCDLoader (r166) reads binary / binary_compressed x, y, z with getFloat32 whatever
// SIZE / TYPE say, so double or integer positions would load as silent garbage. ASCII is parsed
// as text and is fine. Returns an error message, or null when the positions are readable.
// ponytail: rejects float64 binary PCDs instead of decoding them; add an own reader to support them.
export function pcdPositionError(header) {
  const kv = {};
  for (const line of header.split(/\r?\n/)) {
    const [key, ...vals] = line.replace(/#.*/, "").trim().split(/\s+/);
    if (key) kv[key.toUpperCase()] = vals;
    if (key.toUpperCase() === "DATA") break;
  }
  if (!kv.DATA || !kv.FIELDS || kv.DATA[0].toLowerCase() === "ascii") return null;
  const bad = ["x", "y", "z"].flatMap((a) => {
    const i = kv.FIELDS.indexOf(a);
    const t = `${kv.TYPE?.[i]?.toUpperCase()}${kv.SIZE?.[i]}`;
    return i < 0 || t === "F4" ? [] : [`${a} ${t}`];
  });
  return bad.length ? `x/y/z must be 32-bit floats (TYPE F, SIZE 4) in a binary PCD, found ${bad.join(", ")}. Save it as float32 or DATA ascii` : null;
}

// ---------------------------------------------------------------------------
// A number typed into a field. "," and "." both work as the decimal separator (number inputs
// silently drop a "," in many locales, so the fields are text inputs). While typing, a value
// outside [min, max] is not a value yet ("0" on the way to "0.05"); once the field is left it
// is clamped. Returns null when the text is not (yet) a usable number.
export function parseNumberField(text, min = -Infinity, max = Infinity, final = false) {
  const s = String(text).trim().replace(",", ".");
  const v = s === "" ? NaN : Number(s);
  if (!Number.isFinite(v)) return null;
  if (v < min || v > max) return final ? Math.min(max, Math.max(min, v)) : null;
  return v;
}

// ---------------------------------------------------------------------------
// Encoders. data = { positions: Float32Array(3n), colors: Uint8Array(3n) sRGB | null,
//                    intensity: Float32Array(n) | null }
const fmt = (v) => String(+v.toPrecision(9)); // float32 round-trips with 9 significant digits

export function encodePCD({ positions, colors, intensity }, ascii = false) {
  const n = positions.length / 3;
  const fields = ["x", "y", "z"];
  if (colors) fields.push("rgb");
  if (intensity) fields.push("intensity");
  const k = fields.length;
  const header =
    "# .PCD v0.7 - Point Cloud Data file format\nVERSION 0.7\n" +
    `FIELDS ${fields.join(" ")}\nSIZE ${Array(k).fill(4).join(" ")}\n` +
    `TYPE ${Array(k).fill("F").join(" ")}\nCOUNT ${Array(k).fill(1).join(" ")}\n` +
    `WIDTH ${n}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS ${n}\nDATA ${ascii ? "ascii" : "binary"}\n`;

  // PCL convention: rgb is a float32 whose bit pattern is 0x00RRGGBB
  const packed = new Uint32Array(1);
  const asFloat = new Float32Array(packed.buffer);

  if (ascii) {
    const lines = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = `${fmt(positions[i * 3])} ${fmt(positions[i * 3 + 1])} ${fmt(positions[i * 3 + 2])}`;
      if (colors) {
        packed[0] = (colors[i * 3] << 16) | (colors[i * 3 + 1] << 8) | colors[i * 3 + 2];
        s += " " + fmt(asFloat[0]);
      }
      if (intensity) s += " " + fmt(intensity[i]);
      lines[i] = s;
    }
    return header + lines.join("\n") + "\n";
  }

  const head = new TextEncoder().encode(header);
  const stride = 4 * k;
  const buf = new ArrayBuffer(head.length + n * stride);
  new Uint8Array(buf).set(head);
  const dv = new DataView(buf, head.length);
  for (let i = 0; i < n; i++) {
    let o = i * stride;
    dv.setFloat32(o, positions[i * 3], true);
    dv.setFloat32(o + 4, positions[i * 3 + 1], true);
    dv.setFloat32(o + 8, positions[i * 3 + 2], true);
    o += 12;
    if (colors) {
      dv.setUint32(o, (colors[i * 3] << 16) | (colors[i * 3 + 1] << 8) | colors[i * 3 + 2], true);
      o += 4;
    }
    if (intensity) dv.setFloat32(o, intensity[i], true);
  }
  return buf;
}

export function encodePLY({ positions, colors, intensity }) {
  const n = positions.length / 3;
  let header = `ply\nformat binary_little_endian 1.0\ncomment pcd_tools export\nelement vertex ${n}\n` +
    "property float x\nproperty float y\nproperty float z\n";
  if (colors) header += "property uchar red\nproperty uchar green\nproperty uchar blue\n";
  if (intensity) header += "property float intensity\n";
  header += "end_header\n";
  const head = new TextEncoder().encode(header);
  const stride = 12 + (colors ? 3 : 0) + (intensity ? 4 : 0);
  const buf = new ArrayBuffer(head.length + n * stride);
  new Uint8Array(buf).set(head);
  const dv = new DataView(buf, head.length);
  for (let i = 0; i < n; i++) {
    let o = i * stride;
    dv.setFloat32(o, positions[i * 3], true);
    dv.setFloat32(o + 4, positions[i * 3 + 1], true);
    dv.setFloat32(o + 8, positions[i * 3 + 2], true);
    o += 12;
    if (colors) {
      dv.setUint8(o, colors[i * 3]); dv.setUint8(o + 1, colors[i * 3 + 1]); dv.setUint8(o + 2, colors[i * 3 + 2]);
      o += 3;
    }
    if (intensity) dv.setFloat32(o, intensity[i], true);
  }
  return buf;
}

// "x y z" or "x y z r g b" (0-255) per line; intensity is not representable.
export function encodeXYZ({ positions, colors }) {
  const n = positions.length / 3;
  const lines = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = `${fmt(positions[i * 3])} ${fmt(positions[i * 3 + 1])} ${fmt(positions[i * 3 + 2])}`;
    if (colors) s += ` ${colors[i * 3]} ${colors[i * 3 + 1]} ${colors[i * 3 + 2]}`;
    lines[i] = s;
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Lasso: project candidate points with a column-major 4x4 view-projection
// matrix and test them against a rasterized polygon mask (w*h, 1 = inside).
// Returns Uint8Array flags aligned with `candidates`.
export function selectInMask(pos, candidates, vp, mask, w, h) {
  const out = new Uint8Array(candidates.length);
  const e = vp;
  for (let c = 0; c < candidates.length; c++) {
    const i = candidates[c] * 3;
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (cw <= 0) continue; // behind the camera
    const cx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw;
    const cy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw;
    const px = Math.floor((cx * 0.5 + 0.5) * w);
    const py = Math.floor((0.5 - cy * 0.5) * h);
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    out[c] = mask[py * w + px];
  }
  return out;
}
