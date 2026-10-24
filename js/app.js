import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PCDLoader } from "three/addons/loaders/PCDLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { XYZLoader } from "three/addons/loaders/XYZLoader.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import * as alg from "./algorithms.js";

const $ = (id) => document.getElementById(id);
const UNDO_LIMIT = 10;
const MAX_RANSAC_SAMPLE = 200000;
const fmtN = (n) => n.toLocaleString("en-US");

// ---------------------------------------------------------------------------
// Colormaps (sRGB stops). One texture per map for the shader, same stops for the legend.
const COLORMAPS = {
  turbo: ["#30123b", "#4662d7", "#36aaf9", "#1ae4b6", "#72fe5e", "#c8ef34", "#faba39", "#f66b19", "#ca2a04", "#7a0403"],
  viridis: ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"],
  inferno: ["#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d13d", "#fcffa4"],
  grayscale: ["#202020", "#ffffff"],
};
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

const colormapTextures = {};
function colormapTexture(name) {
  if (colormapTextures[name]) return colormapTextures[name];
  const stops = COLORMAPS[name].map(hexRgb);
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (stops.length - 1);
    const a = Math.min(Math.floor(t), stops.length - 2), f = t - a;
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round((stops[a][c] * (1 - f) + stops[a + 1][c] * f) * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 256, 1);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return (colormapTextures[name] = tex);
}

// ---------------------------------------------------------------------------
// Shaders. Filtering happens in the vertex shader (points moved outside clip space).
// Output is written as sRGB directly: vertex colors (linear, from the loaders) are
// converted, colormap colors are already sRGB.
const vtxShader = `
  attribute vec3 color;
  attribute float intensity;
  uniform float size;
  uniform vec3 boxMin;
  uniform vec3 boxMax;
  uniform vec3 boxOn;
  uniform bool zInvert;
  uniform int colorMode;
  uniform float scalarMin;
  uniform float scalarMax;
  varying vec3 vColor;
  varying float vScalar;

  void main() {
    vec3 p = position;
    bvec3 lo = lessThan(p, boxMin);
    bvec3 hi = greaterThan(p, boxMax);
    bool zOut = lo.z || hi.z;
    if ((boxOn.x > 0.5 && (lo.x || hi.x)) || (boxOn.y > 0.5 && (lo.y || hi.y)) || (boxOn.z > 0.5 && zOut != zInvert)) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    vColor = color;
    float s = colorMode == 2 ? intensity : p.z;
    vScalar = clamp((s - scalarMin) / max(scalarMax - scalarMin, 1e-9), 0.0, 1.0);
    gl_PointSize = size;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragShader = `
  uniform int colorMode;
  uniform bool hasRgb;
  uniform sampler2D cmap;
  varying vec3 vColor;
  varying float vScalar;

  vec3 linearToSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }

  void main() {
    vec3 c = (colorMode == 0 && hasRgb) ? linearToSrgb(clamp(vColor, 0.0, 1.0)) : texture2D(cmap, vec2(vScalar, 0.5)).rgb;
    gl_FragColor = vec4(c, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// State. One cloud at a time. `state.matrix` maps original file coordinates to the
// view frame (identity until the floor is aligned). Exports go back to the file frame.
const state = {
  cloud: null, // { name, points, hasColor, hasIntensity }
  matrix: new THREE.Matrix4(),
  aligned: false,
  bounds: null, // view frame { min:[], max:[] }
  undo: [],
  redo: [],
  mode: "none", // none | measure | lasso
  busy: false,
  home: null,
  pending: null, // processing preview waiting for Apply/Cancel: { keep, label, text, applyLabel }
  mapView: false, // PCD | PGM side by side
  geomVersion: 0,
};
const band = { min: 0.1, max: 1.5 }; // pcd2pgm thre_z_min / thre_z_max (view-frame z)
const crop = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 }; // crop box X/Y (Z is `band`), always applied
const view = { pointSize: 1.0, colorMode: "height", colormap: "turbo", rangeMin: 0, rangeMax: 1, topView: false };
const ops = { voxel: 0.05, sorK: 8, sorStd: 1.0, groundThreshold: 0.05, groundTilt: 20, mapResolution: 0.05, invert: false, radius: 0.1, minNeighbors: 10, cloudFormat: "pcd" };
const tf = { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 }; // pcd2pgm odom_to_lidar_odom
const model = { band, crop, view, ops, tf };

const uniforms = {
  size: { value: 1 },
  boxMin: { value: new THREE.Vector3() },
  boxMax: { value: new THREE.Vector3() },
  boxOn: { value: new THREE.Vector3() },
  zInvert: { value: false },
  colorMode: { value: 1 },
  scalarMin: { value: 0 },
  scalarMax: { value: 1 },
  cmap: { value: colormapTexture("turbo") },
};

// ---------------------------------------------------------------------------
// Scene
const sceneEl = $("scene");
const vpSize = () => [Math.max(1, sceneEl.clientWidth), Math.max(1, sceneEl.clientHeight)];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
sceneEl.prepend(renderer.domElement);
const dom = renderer.domElement;

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = "label-layer";
sceneEl.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d10);
const perspCam = new THREE.PerspectiveCamera(30, 1, 0.01, 300);
perspCam.up.set(0, 0, 1); // Z-up, like RViz2
perspCam.position.set(0, -50, 30);
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
let camera = perspCam;

const axesHelper = new THREE.AxesHelper(1); // red X, green Y, blue Z
scene.add(axesHelper);

const controls = new OrbitControls(perspCam, dom);
// Left = orbit, middle = pan, wheel = zoom (toward cursor). Right button opens the
// context menu. Shift+left also pans (handled in the pointer layer below).
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.6;
controls.panSpeed = 0.8;
controls.zoomToCursor = true;
controls.screenSpacePanning = true;
controls.keyPanSpeed = 20;
controls.listenToKeyEvents(window);
controls.addEventListener("change", kick);
controls.addEventListener("start", kick);
dom.addEventListener("wheel", kick, { passive: true });

function makeMarker(color, size) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false }));
  m.renderOrder = 10;
  m.frustumCulled = false;
  m.visible = false;
  scene.add(m);
  return m;
}
const hoverMarker = makeMarker(0xffff00, 8);
const selectMarker = makeMarker(0xff3030, 12);
function placeMarker(marker, v) {
  marker.geometry.attributes.position.setXYZ(0, v.x, v.y, v.z);
  marker.geometry.attributes.position.needsUpdate = true;
  marker.visible = true;
}

// Wireframe showing the obstacle band (and the area limit, if any).
const bandBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.6 })
);
bandBox.visible = false;
scene.add(bandBox);

// Red overlay for points a pending operation would remove.
const previewPoints = new THREE.Points(
  new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ color: 0xff3b3b, size: 3, sizeAttenuation: false, depthTest: false })
);
previewPoints.renderOrder = 9;
previewPoints.visible = false;
scene.add(previewPoints);

// PGM view: points in the Z range that the radius filter drops.
const droppedPoints = new THREE.Points(
  new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ color: 0xff3b3b, size: 3, sizeAttenuation: false, depthTest: false })
);
droppedPoints.renderOrder = 8;
droppedPoints.visible = false;
scene.add(droppedPoints);

const measureGroup = new THREE.Group();
scene.add(measureGroup);
const measurePts = [];
let measureText = "";

// A short rAF loop keeps OrbitControls damping moving, then parks itself.
let animating = false;
function animate() {
  if (controls.update()) requestAnimationFrame(animate);
  else animating = false;
  render();
}
function kick() {
  if (!animating) {
    animating = true;
    requestAnimationFrame(animate);
  }
}
function render() {
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Worker (voxel, SOR, RANSAC, radius filter). The query defeats stale browser caches.
const worker = new Worker(new URL(`./worker.js?v=${Date.now()}`, import.meta.url), { type: "module" });
const jobs = new Map();
let jobSeq = 0;
worker.onmessage = ({ data }) => {
  const job = jobs.get(data.id);
  jobs.delete(data.id);
  if (data.error) job.reject(new Error(data.error));
  else job.resolve(data.result);
};
worker.onerror = (e) => {
  for (const job of jobs.values()) job.reject(new Error(e.message || "Worker error"));
  jobs.clear();
};
function runJob(op, args, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++jobSeq;
    jobs.set(id, { resolve, reject });
    worker.postMessage({ id, op, args }, transfer);
  });
}

// ---------------------------------------------------------------------------
// Helpers
const geom = () => state.cloud.points.geometry;
const positions = () => geom().attributes.position.array;

const passesXY = (x, y) => x >= crop.xmin && x <= crop.xmax && y >= crop.ymin && y <= crop.ymax;
// Z works like pcd2pgm's pass-through (PCL setNegative = flag_pass_through).
const zPass = (z) => (z >= band.min && z <= band.max) !== ops.invert;
// "Shown" points = inside the crop box. What you see is what the cleanup tools
// act on and what goes into the map.
const passes = (x, y, z) => passesXY(x, y) && zPass(z);

function visibleIndices(test = passes) {
  const p = positions();
  const out = new Uint32Array(p.length / 3);
  let m = 0;
  for (let i = 0, n = p.length / 3; i < n; i++) if (test(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])) out[m++] = i;
  return out.subarray(0, m);
}

function gatherPositions(pos, idx) {
  const out = new Float32Array(idx.length * 3);
  for (let i = 0; i < idx.length; i++) {
    out[i * 3] = pos[idx[i] * 3];
    out[i * 3 + 1] = pos[idx[i] * 3 + 1];
    out[i * 3 + 2] = pos[idx[i] * 3 + 2];
  }
  return out;
}

function indicesWhere(flags, value = 1) {
  let m = 0;
  for (let i = 0; i < flags.length; i++) if (flags[i] === value) m++;
  const out = new Uint32Array(m);
  for (let i = 0, j = 0; i < flags.length; i++) if (flags[i] === value) out[j++] = i;
  return out;
}

function subsetGeometry(g, idx) {
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const s = attr.itemSize, src = attr.array, dst = new src.constructor(idx.length * s);
    for (let i = 0; i < idx.length; i++) for (let k = 0; k < s; k++) dst[i * s + k] = src[idx[i] * s + k];
    out.setAttribute(name, new THREE.BufferAttribute(dst, s));
  }
  return out;
}

const baseName = () => (state.cloud ? state.cloud.name.replace(/\.[^.]+$/, "") : "pointcloud");

function download(content, name, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

let statusTimer;
function status(msg, { error = false, sticky = false } = {}) {
  const el = $("status-msg");
  el.textContent = msg;
  el.classList.toggle("error", error);
  el.classList.toggle("working", sticky);
  clearTimeout(statusTimer);
  if (!sticky) statusTimer = setTimeout(() => (el.textContent = ""), error ? 10000 : 5000);
  if (error) console.error(msg);
  // The status bar is hidden on the welcome screen.
  $("welcome-status").textContent = state.cloud ? "" : msg;
  $("welcome-status").classList.toggle("error", error);
  $("welcome-status").classList.toggle("working", !state.cloud && sticky);
}

async function busy(label, fn) {
  if (state.busy) return status("Please wait, another operation is still running…");
  state.busy = true;
  document.querySelectorAll("#panel button").forEach((b) => (b.disabled = true));
  document.body.classList.add("busy");
  status(`${label}…`, { sticky: true });
  await new Promise((r) => setTimeout(r, 20)); // let the status paint before heavy main-thread work
  try {
    await fn();
  } catch (e) {
    status(`${label} failed: ${e.message}`, { error: true });
  } finally {
    state.busy = false;
    document.querySelectorAll("#panel button").forEach((b) => (b.disabled = false));
    document.body.classList.remove("busy");
    if ($("status-msg").classList.contains("working")) status("");
  }
}

// ---------------------------------------------------------------------------
// Loading
const pcdLoader = new PCDLoader();
const plyLoader = new PLYLoader();
plyLoader.setCustomPropertyNameMapping({ intensity: ["intensity"] });
const xyzLoader = new XYZLoader();

async function parseFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const parse = {
    pcd: async () => pcdLoader.parse(await file.arrayBuffer()).geometry,
    ply: async () => plyLoader.parse(await file.arrayBuffer()),
    xyz: async () => xyzLoader.parse(await file.text()),
  }[ext === "txt" ? "xyz" : ext];
  if (!parse) throw new Error(`unsupported file type ".${ext}" (use .pcd, .ply or .xyz)`);
  try {
    return await parse();
  } catch (e) {
    console.error(e);
    throw new Error(`this is not a valid .${ext === "txt" ? "xyz" : ext} file`);
  }
}

// Keep only point attributes we use and drop NaN/Inf points (organized clouds contain them).
function normalizeGeometry(src) {
  const pos = src.getAttribute("position");
  if (!pos || pos.count === 0) throw new Error("file contains no points");
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos.array, 3));
  const color = src.getAttribute("color");
  if (color && color.itemSize === 3) g.setAttribute("color", new THREE.BufferAttribute(color.array, 3));
  const intensity = src.getAttribute("intensity");
  // PLYLoader's custom mapping yields an all-NaN attribute when the file has no intensity property
  if (intensity && intensity.itemSize === 1 && intensity.array.every(Number.isFinite)) {
    g.setAttribute("intensity", new THREE.BufferAttribute(intensity.array, 1));
  }
  const p = pos.array, n = pos.count;
  const ok = new Uint8Array(n);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    ok[i] = Number.isFinite(p[i * 3]) && Number.isFinite(p[i * 3 + 1]) && Number.isFinite(p[i * 3 + 2]) ? 1 : 0;
    bad += 1 - ok[i];
  }
  if (bad === n) throw new Error("file contains only NaN points");
  return { geometry: bad ? subsetGeometry(g, indicesWhere(ok)) : g, dropped: bad };
}

function openFile(file) {
  if (!file) return;
  return busy(`Opening ${file.name}`, async () => {
    try {
      const { geometry, dropped } = normalizeGeometry(await parseFile(file));
      closeCloud();
      setCloud(file.name, geometry);
      status(`Opened ${file.name}: ${fmtN(geometry.attributes.position.count)} points${dropped ? ` (${fmtN(dropped)} invalid points skipped)` : ""}`);
    } finally {
      $("file-input").value = "";
    }
  });
}

function setCloud(name, geometry) {
  const hasColor = !!geometry.getAttribute("color");
  const hasIntensity = !!geometry.getAttribute("intensity");
  const material = new THREE.ShaderMaterial({
    vertexShader: vtxShader,
    fragmentShader: fragShader,
    uniforms: { ...uniforms, hasRgb: { value: hasColor } },
  });
  state.cloud = { name, points: new THREE.Points(geometry, material), hasColor, hasIntensity };
  scene.add(state.cloud.points);
  state.matrix.identity();
  state.aligned = false;
  state.undo = [];
  state.redo = [];

  const modes = [["height", "Height"]];
  if (hasColor) modes.unshift(["rgb", "File colors (RGB)"]);
  if (hasIntensity) modes.push(["intensity", "Intensity"]);
  $("color-mode").replaceChildren(...modes.map(([v, t]) => new Option(t, v)));
  view.colorMode = hasColor ? "rgb" : "height";

  computeBounds();
  resetCrop();
  fitView();
  autoColorRange();
  updateChrome();
  onGeometryChanged();
}

function closeCloud() {
  if (!state.cloud) return;
  cancelPending();
  setMode("none");
  clearMeasure();
  scene.remove(state.cloud.points);
  for (const s of [...state.undo, ...state.redo]) s.geometry.dispose();
  state.cloud.points.geometry.dispose();
  state.cloud.points.material.dispose();
  state.cloud = null;
  state.bounds = null;
  state.undo = [];
  state.redo = [];
  hoverMarker.visible = selectMarker.visible = bandBox.visible = false;
  if (view.topView) setTopView(false);
  if (state.mapView) setMapView(false);
  filtered = grid = null;
  updateChrome();
  render();
}

function updateChrome() {
  const has = !!state.cloud;
  axesHelper.visible = has;
  $("welcome").hidden = has;
  $("panel").hidden = !has;
  $("toolbar").hidden = !has;
  $("statusbar").hidden = !has;
  if (!has) {
    $("legend").hidden = true;
    return;
  }
  const c = state.cloud;
  $("file-name").textContent = c.name;
  $("file-name").title = c.name;
  $("align-state").hidden = !state.aligned;
  $("align-btn").textContent = state.aligned ? "Re-align to floor" : "Align to floor";
  $("file-info").textContent = [`${fmtN(geom().attributes.position.count)} points`, c.hasColor && "RGB", c.hasIntensity && "intensity"].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// Edits with undo / redo. A snapshot is the geometry + frame before an edit.
function swapGeometry(g) {
  state.cloud.points.geometry.dispose(); // frees GPU buffers only; CPU arrays stay usable for undo
  state.cloud.points.geometry = g;
}
const snapshot = () => ({ geometry: geom(), matrix: state.matrix.clone(), aligned: state.aligned });

function commit(geometry, label, frame = null) {
  cancelPending();
  state.undo.push(snapshot());
  if (state.undo.length > UNDO_LIMIT) state.undo.shift();
  for (const s of state.redo) s.geometry.dispose();
  state.redo = [];
  swapGeometry(geometry);
  if (frame) {
    state.matrix.copy(frame.matrix);
    state.aligned = frame.aligned;
    onFrameChanged();
  }
  onGeometryChanged();
  status(label);
}

function step(from, to, word) {
  cancelPending();
  const s = from.pop();
  if (!s) return status(`Nothing to ${word.toLowerCase()}`);
  to.push(snapshot());
  const moved = !s.matrix.equals(state.matrix);
  swapGeometry(s.geometry);
  state.matrix.copy(s.matrix);
  state.aligned = s.aligned;
  if (moved) onFrameChanged();
  onGeometryChanged();
  status(`${word} (${state.undo.length} undo / ${state.redo.length} redo steps)`);
}
const undo = () => step(state.undo, state.redo, "Undone");
const redo = () => step(state.redo, state.undo, "Redone");

// Heights mean something else after (un)aligning: start the band and colors over.
function onFrameChanged() {
  clearMeasure();
  pgmView.fitted = false; // the map moved: fit it (and the synced 3D top view) again
  computeBounds();
  resetCropXY(); // needs the new bounds
  resetBand();
  autoColorRange();
}

// keep[i] = 1 keeps point i.
function keepWhere(keep, label) {
  const idx = indicesWhere(keep);
  const removed = keep.length - idx.length;
  if (!removed) return status(`${label}: nothing to remove`);
  if (!idx.length) return status(`${label}: that would remove every point`, { error: true });
  commit(subsetGeometry(geom(), idx), `${label}: ${fmtN(removed)} points removed, ${fmtN(idx.length)} left`);
}

// ---------------------------------------------------------------------------
// Pending preview (noise): show the points to remove in red, wait for Apply/Cancel.
function showPending(keep, label, text, applyLabel) {
  const del = indicesWhere(keep, 0);
  previewPoints.geometry.dispose();
  previewPoints.geometry = new THREE.BufferGeometry();
  previewPoints.geometry.setAttribute("position", new THREE.BufferAttribute(gatherPositions(positions(), del), 3));
  previewPoints.material.size = view.pointSize + 1;
  previewPoints.visible = true;
  state.pending = { keep, label, text, applyLabel };
  setMode("none");
  updateDropped();
  updateActionBar();
  render();
}
function cancelPending() {
  if (!state.pending) return;
  state.pending = null;
  previewPoints.visible = false;
  updateDropped();
  updateActionBar();
  render();
}
function applyPending() {
  const p = state.pending;
  if (p) keepWhere(p.keep, p.label);
}

// ---------------------------------------------------------------------------
// Step 1: floor alignment
async function detectGround() {
  const vis = visibleIndices(passesXY); // the floor may be hidden by the band, use the whole area
  if (!vis.length) throw new Error("no points in the area");
  const stride = Math.max(1, Math.ceil(vis.length / MAX_RANSAC_SAMPLE));
  const p = positions();
  const sample = new Float32Array(Math.ceil(vis.length / stride) * 3);
  for (let i = 0, o = 0; i < vis.length; i += stride, o += 3) {
    sample[o] = p[vis[i] * 3]; sample[o + 1] = p[vis[i] * 3 + 1]; sample[o + 2] = p[vis[i] * 3 + 2];
  }
  // Indoors the ceiling or a table can be a bigger horizontal plane than the floor:
  // search only the lowest 30 % of the points.
  // ponytail: assumes the cloud is roughly upright; use the manual transform first for a strongly tilted lidar frame.
  const cut = quantiles(sample, 3, 2)(0.3);
  let m = 0;
  for (let o = 0; o < sample.length; o += 3) {
    if (sample[o + 2] <= cut) { sample[m++] = sample[o]; sample[m++] = sample[o + 1]; sample[m++] = sample[o + 2]; }
  }
  const low = sample.slice(0, m);
  const res = await runJob("fitPlaneRansac", [low, { threshold: ops.groundThreshold, iterations: 500, maxTiltDeg: ops.groundTilt }], [low.buffer]);
  if (!res) throw new Error("no floor found. Try a larger tolerance or max tilt in Settings");
  res.tiltDeg = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, res.normal[2])));
  return res;
}

const alignFloor = () =>
  busy("Finding the floor", async () => {
    const res = await detectGround();
    const R = alg.rotationAlignToZ(res.normal);
    const m = new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1);
    m.premultiply(new THREE.Matrix4().makeTranslation(0, 0, res.d)); // floor plane -> z = 0
    const g = geom().clone();
    g.applyMatrix4(m);
    commit(g, `Floor aligned (it was tilted ${res.tiltDeg.toFixed(2)}°, ${((100 * res.inliers) / res.total).toFixed(0)}% of the lowest points on it). Floor is now z = 0`, {
      matrix: m.multiply(state.matrix),
      aligned: true,
    });
  });

// pcd2pgm applyTransform(): T = translate(x,y,z) * Rx(roll) * Ry(pitch) * Rz(yaw); cloud *= T^-1
function applyManualTransform() {
  const T = new THREE.Matrix4().makeTranslation(tf.x, tf.y, tf.z)
    .multiply(new THREE.Matrix4().makeRotationX(tf.roll))
    .multiply(new THREE.Matrix4().makeRotationY(tf.pitch))
    .multiply(new THREE.Matrix4().makeRotationZ(tf.yaw));
  if (T.equals(new THREE.Matrix4())) return status("Transform is all zeros, nothing to apply");
  const m = T.invert();
  const g = geom().clone();
  g.applyMatrix4(m);
  const v = [tf.x, tf.y, tf.z, tf.roll, tf.pitch, tf.yaw].map((n) => +n.toFixed(4)).join(", ");
  commit(g, `Transform [${v}] applied (inverse, like pcd2pgm)`, { matrix: m.multiply(state.matrix), aligned: false });
}

// ---------------------------------------------------------------------------
// Step 2: cleanup (acts on shown points only; hidden points are left untouched)
async function workerKeep(op, args) {
  const vis = visibleIndices();
  if (!vis.length) throw new Error("no points shown");
  const sub = gatherPositions(positions(), vis);
  const kept = await runJob(op, [sub, ...args], [sub.buffer]);
  const keep = new Uint8Array(positions().length / 3).fill(1);
  for (const v of vis) keep[v] = 0;
  for (const k of kept) keep[vis[k]] = 1;
  return { keep, removed: vis.length - kept.length, of: vis.length };
}

const findNoise = () =>
  busy("Looking for noise", async () => {
    const { keep, removed, of } = await workerKeep("statisticalOutlierRemoval", [ops.sorK, ops.sorStd]);
    if (!removed) return status("No noise found with these settings");
    showPending(keep, "Noise removed", `${fmtN(removed)} noise points found (${((100 * removed) / of).toFixed(1)}%), shown in red.`, "Remove them");
  });

const downsample = () =>
  busy("Downsampling", async () => {
    const { keep } = await workerKeep("voxelDownsample", [ops.voxel]);
    keepWhere(keep, `Downsampled to ${ops.voxel} m`);
  });

// ---------------------------------------------------------------------------
// Step 3: PCD -> PGM, the pcd2pgm pipeline. Runs live while the PGM view is open.
// The radius filter result is cached, so changing only the resolution is instant.
let filtered = null; // { key, xy, inRange, kept, dropped: Float32Array positions }
let grid = null;
let mapSeq = 0, mapTimer;
const mapKey = () => [state.geomVersion, band.min, band.max, ops.invert, ops.radius, ops.minNeighbors, crop.xmin, crop.xmax, crop.ymin, crop.ymax].join();

async function computeMap() {
  const key = mapKey();
  if (!filtered || filtered.key !== key) {
    const idx = visibleIndices();
    if (!idx.length) throw new Error("No points inside the crop box. Adjust X / Y / Z in Crop");
    const sub = gatherPositions(positions(), idx);
    const kept = await runJob("radiusOutlierRemoval", [sub, ops.radius, ops.minNeighbors], [sub.buffer]);
    if (mapKey() !== key) return null; // cloud or parameters changed while the worker ran
    const p = positions();
    const used = new Uint8Array(idx.length);
    const xy = new Float64Array(kept.length * 2);
    kept.forEach((k, o) => {
      used[k] = 1;
      xy[o * 2] = p[idx[k] * 3];
      xy[o * 2 + 1] = p[idx[k] * 3 + 1];
    });
    const dropped = gatherPositions(p, idx.filter((_, k) => !used[k]));
    filtered = { key, xy, inRange: idx.length, kept: kept.length, dropped };
    if (!kept.length) throw new Error("The radius filter removed every point. Lower min neighbours or raise the radius");
  }
  if (!filtered.kept) throw new Error("The radius filter removed every point. Lower min neighbours or raise the radius");
  return alg.pcd2pgmGrid(filtered.xy, ops.mapResolution);
}

function scheduleMap() {
  filtered = filtered && filtered.key === mapKey() ? filtered : null;
  if (!state.mapView) return updateMapInfo();
  $("pgm-busy").hidden = false;
  clearTimeout(mapTimer);
  mapTimer = setTimeout(updateMap, 200);
}

async function updateMap() {
  if (!state.cloud || !state.mapView) return;
  const seq = ++mapSeq;
  let error = null, g = null;
  try {
    g = await computeMap();
  } catch (e) {
    error = e.message;
  }
  if (seq !== mapSeq || (!g && !error)) return; // a newer update is on its way
  $("pgm-busy").hidden = true;
  grid = g;
  $("pgm-empty").hidden = !error;
  $("pgm-empty").textContent = error || "";
  if (grid) {
    pgmImg.width = grid.width;
    pgmImg.height = grid.height;
    const ctx = pgmImg.getContext("2d");
    const img = ctx.createImageData(grid.width, grid.height);
    for (let i = 0; i < grid.data.length; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = grid.data[i];
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    if (!pgmView.fitted) fitPgm();
  }
  updateDropped();
  updateMapInfo(error);
  drawPgm();
}

function updateMapInfo(error = null) {
  const el = $("map-info");
  if (!state.mapView) el.textContent = "Click “Show PGM” to see the map next to the cloud, updating live.";
  else if (error) el.textContent = error;
  else if (grid && filtered) {
    el.textContent =
      `${fmtN(filtered.inRange)} points in the crop box → ${fmtN(filtered.kept)} after radius filter → ` +
      `${grid.width} × ${grid.height} cells (${(grid.width * grid.resolution).toFixed(1)} × ${(grid.height * grid.resolution).toFixed(1)} m), ` +
      `origin (${grid.origin[0].toFixed(2)}, ${grid.origin[1].toFixed(2)})`;
  }
}

function updateDropped() {
  const d = state.mapView && filtered && !state.pending ? filtered.dropped : null;
  droppedPoints.visible = !!(d && d.length);
  if (!droppedPoints.visible) return render();
  if (droppedPoints.geometry.attributes.position?.array !== d) {
    droppedPoints.geometry.dispose();
    droppedPoints.geometry = new THREE.BufferGeometry();
    droppedPoints.geometry.setAttribute("position", new THREE.BufferAttribute(d, 3));
  }
  droppedPoints.material.size = view.pointSize + 1;
  render();
}

// Top view framing the whole cloud, so the PCD pane lines up with the PGM pane.
function fitTopView() {
  const b = state.bounds;
  controls.target.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  setTopView(true);
  const [w, h] = vpSize();
  const half = 0.55 * Math.max(b.max[1] - b.min[1], ((b.max[0] - b.min[0]) * h) / w);
  Object.assign(orthoCam, { left: (-half * w) / h, right: (half * w) / h, top: half, bottom: -half, zoom: 1 });
  orthoCam.updateProjectionMatrix();
  controls.update();
  render();
}

let topBeforeMap = false;
function setMapView(on) {
  if (on === state.mapView) return;
  state.mapView = on;
  $("pgm-pane").hidden = !on;
  if (on) {
    topBeforeMap = view.topView;
    fitTopView(); // layout already reflects the opened pane
    if (zIsFull() && !ops.invert) {
      defaultZ();
      onCropChanged();
      status(`Z set to ${band.min} … ${band.max} m (pcd2pgm default). Adjust it in Crop`);
    }
  } else if (!topBeforeMap) setTopView(false);
  $("pane-tag-pcd").hidden = !on;
  $("map-view-btn").textContent = on ? "Hide PGM" : "Show PGM";
    if (on) pgmView.fitted = false;
  updateToolbar();
  syncUniforms();
  scheduleMap();
  updateDropped();
}

// ---------------------------------------------------------------------------
// PGM pane: the map drawn in world coordinates (center cx/cy, k px per metre),
// so it stays in place when the resolution changes. Wheel = zoom, drag = pan.
const pgmCanvas = $("pgm-canvas");
const pgmImg = document.createElement("canvas");
const pgmView = { cx: 0, cy: 0, k: 1, fitted: false };
let pgmCursor = null; // world point under the mouse (either pane)

const pgmSize = () => [pgmCanvas.clientWidth || 1, pgmCanvas.clientHeight || 1];
const toScreen = (x, y) => {
  const [w, h] = pgmSize();
  return [(x - pgmView.cx) * pgmView.k + w / 2, h / 2 - (y - pgmView.cy) * pgmView.k];
};
const toWorld = (sx, sy) => {
  const [w, h] = pgmSize();
  return [pgmView.cx + (sx - w / 2) / pgmView.k, pgmView.cy - (sy - h / 2) / pgmView.k];
};

function syncTopFromPgm() {
  if (!state.mapView || !view.topView || !grid) return;
  const [w, h] = vpSize(), k = pgmView.k;
  controls.target.set(pgmView.cx, pgmView.cy, controls.target.z);
  orthoCam.position.set(pgmView.cx, pgmView.cy, orthoCam.position.z);
  Object.assign(orthoCam, { left: -w / 2 / k, right: w / 2 / k, top: h / 2 / k, bottom: -h / 2 / k, zoom: 1 });
  orthoCam.lookAt(controls.target);
  orthoCam.updateProjectionMatrix();
  controls.update();
  render();
}

function fitPgm() {
  if (!grid) return;
  const [w, h] = pgmSize();
  const gw = grid.width * grid.resolution, gh = grid.height * grid.resolution;
  pgmView.cx = grid.origin[0] + gw / 2;
  pgmView.cy = grid.origin[1] + gh / 2;
  pgmView.k = 0.95 * Math.min(w / gw, h / gh);
  pgmView.fitted = true;
  drawPgm();
  syncTopFromPgm();
}

function drawPgm() {
  if (!state.mapView) return;
  const [w, h] = pgmSize(), dpr = window.devicePixelRatio || 1;
  if (pgmCanvas.width !== Math.round(w * dpr) || pgmCanvas.height !== Math.round(h * dpr)) {
    pgmCanvas.width = Math.round(w * dpr);
    pgmCanvas.height = Math.round(h * dpr);
  }
  const ctx = pgmCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#3a3f47";
  ctx.fillRect(0, 0, w, h);
  if (!grid) return;
  const [x0, y0] = toScreen(grid.origin[0], grid.origin[1] + grid.height * grid.resolution);
  const sw = grid.width * grid.resolution * pgmView.k, sh = grid.height * grid.resolution * pgmView.k;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pgmImg, x0, y0, sw, sh);
  ctx.strokeStyle = "#6b7280";
  ctx.strokeRect(x0 - 0.5, y0 - 0.5, sw + 1, sh + 1);
  // map frame origin (0, 0): red = +x, green = +y
  const [ax, ay] = toScreen(0, 0), L = 24;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ef4444"; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + L, ay); ctx.stroke();
  ctx.strokeStyle = "#22c55e"; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - L); ctx.stroke();
  if (pgmCursor) {
    const [cx, cy] = toScreen(pgmCursor.x, pgmCursor.y);
    ctx.strokeStyle = "#facc15";
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
}

function cellAt(x, y) {
  if (!grid) return null;
  const i = Math.floor((x - grid.origin[0]) / grid.resolution), j = Math.floor((y - grid.origin[1]) / grid.resolution);
  if (i < 0 || j < 0 || i >= grid.width || j >= grid.height) return null;
  return { i, j, occupied: grid.data[(grid.height - 1 - j) * grid.width + i] === 0 };
}

let pgmDrag = null;
pgmCanvas.addEventListener("pointerdown", (e) => {
  pgmDrag = { x: e.clientX, y: e.clientY };
  pgmCanvas.setPointerCapture(e.pointerId);
});
pgmCanvas.addEventListener("pointermove", (e) => {
  if (pgmDrag) {
    pgmView.cx -= (e.clientX - pgmDrag.x) / pgmView.k;
    pgmView.cy += (e.clientY - pgmDrag.y) / pgmView.k;
    pgmDrag = { x: e.clientX, y: e.clientY };
    syncTopFromPgm();
  }
  const r = pgmCanvas.getBoundingClientRect();
  const [x, y] = toWorld(e.clientX - r.left, e.clientY - r.top);
  pgmCursor = { x, y };
  const c = cellAt(x, y);
  $("status-xyz").textContent = `x ${x.toFixed(2)}  y ${y.toFixed(2)}` + (c ? `  cell (${c.i}, ${c.j}) ${c.occupied ? "occupied" : "free"}` : "");
  // mirror the cursor in the 3D view
  placeMarker(hoverMarker, new THREE.Vector3(x, y, (band.min + band.max) / 2));
  render();
  drawPgm();
});
pgmCanvas.addEventListener("pointerup", () => (pgmDrag = null));
pgmCanvas.addEventListener("pointerleave", () => {
  pgmCursor = null;
  hoverMarker.visible = false;
  render();
  drawPgm();
});
pgmCanvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = pgmCanvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const [x, y] = toWorld(sx, sy);
  const [w, h] = pgmSize();
  pgmView.k = Math.min(Math.max(pgmView.k * Math.exp(-e.deltaY * 0.0015), 1e-3), 1e5);
  pgmView.cx = x - (sx - w / 2) / pgmView.k;
  pgmView.cy = y + (sy - h / 2) / pgmView.k;
  drawPgm();
  syncTopFromPgm();
}, { passive: false });
pgmCanvas.addEventListener("dblclick", fitPgm);
$("pgm-fit").addEventListener("click", fitPgm);
$("pgm-close").addEventListener("click", () => setMapView(false));
new ResizeObserver(() => (pgmView.fitted ? drawPgm() : fitPgm())).observe(pgmCanvas);

// ---------------------------------------------------------------------------
// Step 4: export. The map is in the current (view) frame like pcd2pgm's output;
// the cloud goes back to the original file coordinates.
async function exportMap() {
  try {
    const g = await computeMap();
    if (!g) throw new Error("the cloud changed, try again");
    const name = `${baseName()}_map`;
    download(alg.encodePGM(g), `${name}.pgm`, "image/x-portable-graymap");
    download(alg.encodeMapYaml(g, `${name}.pgm`), `${name}.yaml`, "text/yaml");
    status(`Saved ${name}.pgm and ${name}.yaml (${g.width} × ${g.height} @ ${ops.mapResolution} m)`);
  } catch (e) {
    status(`Map export failed: ${e.message}`, { error: true });
  }
}

function exportCloud() {
  const idx = visibleIndices();
  if (!idx.length) return status("No points shown, nothing to export", { error: true });
  const g = geom(), c = state.cloud;
  const p = g.attributes.position.array;
  const col = c.hasColor ? g.attributes.color.array : null;
  const inten = c.hasIntensity ? g.attributes.intensity.array : null;
  const data = {
    positions: new Float32Array(idx.length * 3),
    colors: col ? new Uint8Array(idx.length * 3) : null,
    intensity: inten ? new Float32Array(idx.length) : null,
  };
  const m = state.matrix.clone().invert().elements;
  idx.forEach((i, o) => {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    data.positions[o * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    data.positions[o * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    data.positions[o * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    if (col) for (let k = 0; k < 3; k++) data.colors[o * 3 + k] = alg.linearToSrgbByte(col[i * 3 + k]);
    if (inten) data.intensity[o] = inten[i];
  });
  const ply = ops.cloudFormat === "ply";
  const name = `${baseName()}_clean.${ply ? "ply" : "pcd"}`;
  download(ply ? alg.encodePLY(data) : alg.encodePCD(data), name);
  status(`Saved ${name} (${fmtN(idx.length)} points)`);
}

// ---------------------------------------------------------------------------
// View
function syncUniforms() {
  if (!state.bounds) return;
  uniforms.boxMin.value.set(crop.xmin, crop.ymin, band.min);
  uniforms.boxMax.value.set(crop.xmax, crop.ymax, band.max);
  uniforms.boxOn.value.set(1, 1, 1);
  uniforms.zInvert.value = ops.invert;
  uniforms.size.value = view.pointSize;
  uniforms.colorMode.value = { rgb: 0, height: 1, intensity: 2 }[view.colorMode];
  uniforms.scalarMin.value = view.rangeMin;
  uniforms.scalarMax.value = view.rangeMax;
  uniforms.cmap.value = colormapTexture(view.colormap);
  previewPoints.material.size = droppedPoints.material.size = view.pointSize + 1;
  updateBandBox();
  updateLegend();
  scheduleStats();
  render();
}

// Quantile function over a ~50k sample of one component of a strided array.
function quantiles(arr, stride, off) {
  const n = arr.length / stride, stepN = Math.max(1, Math.floor(n / 50000));
  const sample = [];
  for (let i = 0; i < n; i += stepN) sample.push(arr[i * stride + off]);
  sample.sort((a, b) => a - b);
  return (p) => sample[Math.min(sample.length - 1, Math.floor(p * sample.length))];
}

// 1st–99th percentile of height or intensity, so a few outliers don't flatten the colormap.
function autoColorRange() {
  if (!state.cloud) return;
  const q = view.colorMode === "intensity" ? quantiles(geom().attributes.intensity.array, 1, 0) : quantiles(positions(), 3, 2);
  [view.rangeMin, view.rangeMax] = [q(0.01), q(0.99)];
  if (view.rangeMax <= view.rangeMin) view.rangeMax = view.rangeMin + 1e-3;
  syncUniforms();
}

function updateBandBox() {
  const b = state.bounds;
  const lo = [crop.xmin, crop.ymin, band.min];
  const hi = [crop.xmax, crop.ymax, band.max];
  for (let i = 0; i < 3; i++) {
    bandBox.scale.setComponent(i, Math.max(hi[i] - lo[i], 1e-6));
    bandBox.position.setComponent(i, (lo[i] + hi[i]) / 2);
  }
  bandBox.visible = isCropped(); // the box only shows while something is cut away
}

function updateLegend() {
  const el = $("legend");
  el.hidden = !state.cloud || view.colorMode === "rgb";
  if (el.hidden) return;
  $("legend-title").textContent = view.colorMode === "intensity" ? "Intensity" : state.aligned ? "Height above floor (m)" : "Height z (m)";
  $("legend-bar").style.background = `linear-gradient(to right, ${COLORMAPS[view.colormap].join(", ")})`;
  $("legend-min").textContent = view.rangeMin.toFixed(2);
  $("legend-max").textContent = view.rangeMax.toFixed(2);
}

let statsTimer;
function scheduleStats() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(updateStats, 120);
}
function updateStats() {
  if (!state.cloud) return;
  const total = positions().length / 3;
  const shown = isCropped() ? visibleIndices().length : total;
  const b = state.bounds, f = (i) => (b.max[i] - b.min[i]).toFixed(1);
  $("status-stats").textContent =
    `${fmtN(total)} points` + (shown !== total ? ` · ${fmtN(shown)} shown` : "") + ` · ${f(0)} × ${f(1)} × ${f(2)} m`;
}

function computeBounds() {
  const g = geom();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  state.bounds = { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}

const diag = () => (state.bounds ? Math.hypot(...[0, 1, 2].map((i) => state.bounds.max[i] - state.bounds.min[i])) || 1 : 50);
const round2 = (v) => Math.round(v * 100) / 100;

// Bounds rounded outward to cm, so a "full" crop never cuts an edge point.
const floor2 = (v) => Math.floor(v * 100) / 100;
const ceil2 = (v) => Math.ceil(v * 100) / 100;
const zIsFull = () => band.min <= state.bounds.min[2] && band.max >= state.bounds.max[2];
const xyIsFull = () => crop.xmin <= state.bounds.min[0] && crop.xmax >= state.bounds.max[0] && crop.ymin <= state.bounds.min[1] && crop.ymax >= state.bounds.max[1];
const isCropped = () => !!state.bounds && (ops.invert || !zIsFull() || !xyIsFull());

// pcd2pgm's default Z range (0.1 .. 1.5 m above the floor). Before alignment the
// floor is guessed as the 1st percentile of z (the lowest point is often an outlier).
function defaultZ() {
  const [zmin, zmax] = [state.bounds.min[2], state.bounds.max[2]];
  const floor = state.aligned ? 0 : quantiles(positions(), 3, 2)(0.01);
  band.min = round2(Math.min(floor + 0.1, zmax));
  band.max = round2(Math.min(floor + 1.5, zmax));
  if (band.max <= band.min) [band.min, band.max] = [floor2(zmin), ceil2(zmax)];
}

// Z after load / alignment: everything in 3D, pcd2pgm's default in the PGM view.
function resetBand() {
  if (state.mapView) defaultZ();
  else [band.min, band.max] = [floor2(state.bounds.min[2]), ceil2(state.bounds.max[2])];
  onCropChanged();
}

function resetCropXY() {
  const b = state.bounds;
  Object.assign(crop, { xmin: floor2(b.min[0]), xmax: ceil2(b.max[0]), ymin: floor2(b.min[1]), ymax: ceil2(b.max[1]) });
}

function resetCrop() {
  resetCropXY();
  [band.min, band.max] = [floor2(state.bounds.min[2]), ceil2(state.bounds.max[2])];
  ops.invert = false;
  onCropChanged();
}

function onCropChanged() {
  updateRanges();
  refreshInputs();
  syncUniforms();
  scheduleMap();
}

function fitView() {
  const b = state.bounds;
  const d = diag();
  const center = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  perspCam.near = d * 1e-4;
  perspCam.far = d * 20;
  perspCam.position.copy(center).add(new THREE.Vector3(0, -d * 1.0, d * 0.9));
  perspCam.updateProjectionMatrix();
  controls.target.copy(center);
  controls.minDistance = d * 1e-4;
  controls.maxDistance = d * 10;
  axesHelper.scale.setScalar(d * 0.05);
  state.home = { position: perspCam.position.clone(), target: center.clone() };
  controls.update();
  if (view.topView) setTopView(true);
  render();
}

function resetView() {
  if (!state.home) return;
  perspCam.position.copy(state.home.position);
  controls.target.copy(state.home.target);
  controls.update();
  if (view.topView) setTopView(true);
  render();
}

// Move the orbit pivot onto a point and dolly in a bit, keeping the viewing direction.
function focusOn(v) {
  const dir = camera.position.clone().sub(controls.target);
  const dist = Math.min(dir.length(), diag() * 0.4);
  controls.target.copy(v);
  if (camera === perspCam) perspCam.position.copy(v).add(dir.setLength(dist));
  else {
    orthoCam.position.set(v.x, v.y, orthoCam.position.z);
    orthoCam.updateProjectionMatrix();
  }
  controls.update();
  render();
}

// Orthographic plan view: what the 2D map will look like.
function setTopView(on) {
  view.topView = on;
  const target = controls.target;
  if (on) {
    const [w, h] = vpSize();
    const d = camera.position.distanceTo(target);
    const half = camera === perspCam ? d * Math.tan(THREE.MathUtils.degToRad(perspCam.fov / 2)) : orthoCam.top / orthoCam.zoom;
    Object.assign(orthoCam, { left: (-half * w) / h, right: (half * w) / h, top: half, bottom: -half, zoom: 1, near: 0.001, far: diag() * 10 });
    const top = (state.bounds ? state.bounds.max[2] : 0) + diag();
    orthoCam.position.set(target.x, target.y, Math.max(top, target.z + 1));
    orthoCam.up.set(0, 1, 0);
    orthoCam.lookAt(target);
    orthoCam.updateProjectionMatrix();
    camera = orthoCam;
  } else {
    camera = perspCam;
  }
  controls.object = camera;
  controls.enableRotate = !on;
  controls.update();
  updateToolbar();
  render();
}

// ---------------------------------------------------------------------------
// Measurement
function clearMeasure() {
  measurePts.length = 0;
  drawMeasure();
}
function addMeasurePoint(v) {
  if (measurePts.length >= 3) measurePts.length = 0;
  measurePts.push(v.clone());
  drawMeasure();
}
function addLabel(text, pos) {
  const div = document.createElement("div");
  div.className = "measure-label";
  div.textContent = text;
  const o = new CSS2DObject(div);
  o.position.copy(pos);
  measureGroup.add(o);
}
function drawMeasure() {
  for (const ch of [...measureGroup.children]) {
    measureGroup.remove(ch);
    ch.geometry?.dispose();
    ch.material?.dispose();
  }
  measureText = "";
  if (measurePts.length) {
    const g = new THREE.BufferGeometry().setFromPoints(measurePts);
    const mat = { color: 0x00e5ff, depthTest: false };
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ ...mat, size: 10, sizeAttenuation: false }));
    const line = new THREE.Line(g.clone(), new THREE.LineBasicMaterial(mat));
    for (const o of [pts, line]) { o.renderOrder = 11; o.frustumCulled = false; measureGroup.add(o); }
    const parts = [];
    for (let i = 1; i < measurePts.length; i++) {
      const a = measurePts[i - 1], b = measurePts[i];
      const d = a.distanceTo(b);
      addLabel(`${d.toFixed(3)} m`, a.clone().lerp(b, 0.5));
      parts.push(`${d.toFixed(3)} m (height diff ${(b.z - a.z).toFixed(3)} m)`);
    }
    if (measurePts.length === 3) {
      const [a, b, c] = measurePts;
      const ang = THREE.MathUtils.radToDeg(a.clone().sub(b).angleTo(c.clone().sub(b)));
      addLabel(`∠ ${ang.toFixed(1)}°`, b);
      parts.push(`angle ${ang.toFixed(1)}°`);
    }
    measureText = parts.length ? parts.join(" · ") : "Click a second point.";
  }
  updateActionBar();
  updateToolbar();
  render();
}

// ---------------------------------------------------------------------------
// Lasso (coordinates are relative to the viewport)
const lassoCanvas = $("lasso-canvas");
const lctx = lassoCanvas.getContext("2d");
let lassoPath = null; // being drawn
let lassoPoly = null; // finished, waiting for an action
function drawLasso() {
  lctx.clearRect(0, 0, lassoCanvas.width, lassoCanvas.height);
  const pts = lassoPoly || lassoPath;
  lassoCanvas.hidden = !pts || pts.length < 2;
  if (lassoCanvas.hidden) return;
  lctx.beginPath();
  pts.forEach(([x, y], i) => (i ? lctx.lineTo(x, y) : lctx.moveTo(x, y)));
  if (lassoPoly) {
    lctx.closePath();
    lctx.fillStyle = "rgba(255,200,0,0.15)";
    lctx.fill();
  }
  lctx.strokeStyle = "#ffc800";
  lctx.lineWidth = 2;
  lctx.setLineDash([6, 4]);
  lctx.stroke();
}
function cancelLasso() {
  lassoPath = lassoPoly = null;
  drawLasso();
  updateActionBar();
}
function finishLasso() {
  if (!lassoPath || lassoPath.length < 3) return cancelLasso();
  lassoPoly = lassoPath;
  lassoPath = null;
  drawLasso();
  updateActionBar();
}
function applyLasso(keepInside) {
  if (!lassoPoly) return;
  const [w, h] = vpSize();
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const c = off.getContext("2d");
  c.beginPath();
  lassoPoly.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.fill();
  const img = c.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = img[i * 4 + 3] > 127 ? 1 : 0;
  camera.updateMatrixWorld();
  const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
  lassoPath = lassoPoly = null;
  drawLasso();
  // Acts on shown points only.
  const vis = visibleIndices();
  const inside = alg.selectInMask(positions(), vis, vp, mask, w, h);
  const keep = new Uint8Array(positions().length / 3).fill(1);
  for (let k = 0; k < vis.length; k++) if (inside[k] !== (keepInside ? 1 : 0)) keep[vis[k]] = 0;
  keepWhere(keep, keepInside ? "Kept the selection" : "Selection deleted");
  updateActionBar();
}

function setMode(mode) {
  if (mode !== "none") cancelPending();
  state.mode = mode;
  // In lasso mode left-drag draws the selection; middle-drag pan and wheel zoom still navigate.
  controls.mouseButtons.LEFT = mode === "lasso" ? null : THREE.MOUSE.ROTATE;
  dom.style.cursor = mode === "none" ? "" : "crosshair";
  if (mode !== "lasso") { lassoPath = lassoPoly = null; drawLasso(); }
  if (mode !== "measure" && measurePts.length) clearMeasure();
  updateToolbar();
  updateActionBar();
}
const toggleMode = (m) => setMode(state.mode === m ? "none" : m);

// ---------------------------------------------------------------------------
// Floating action bar: one place for the current tool's instructions and buttons.
function updateActionBar() {
  const bar = $("action-bar");
  let text = "", buttons = [];
  if (state.pending) {
    text = state.pending.text;
    buttons = [[state.pending.applyLabel, applyPending, true], ["Cancel", cancelPending]];
  } else if (state.mode === "lasso" && lassoPoly) {
    text = "Selection ready.";
    buttons = [["Delete selection  Del", () => applyLasso(false), true], ["Keep only selection  Enter", () => applyLasso(true)], ["Cancel  Esc", cancelLasso]];
  } else if (state.mode === "lasso") {
    text = "Lasso: drag around the points to remove. Wheel and middle-drag still move the camera.";
    buttons = [["Done", () => setMode("none")]];
  } else if (state.mode === "measure") {
    text = measureText || "Measure: click points. 2 points = distance, 3 points = angle.";
    buttons = measurePts.length ? [["Clear", clearMeasure], ["Done", () => setMode("none")]] : [["Done", () => setMode("none")]];
  }
  bar.hidden = !text;
  if (!text) return bar.replaceChildren();
  const span = document.createElement("span");
  span.textContent = text;
  bar.replaceChildren(
    span,
    ...buttons.map(([label, act, primary]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = primary ? "btn primary" : "btn";
      b.textContent = label;
      b.addEventListener("click", act);
      return b;
    })
  );
}

// ---------------------------------------------------------------------------
// Picking (respects the filters and returns the actual point, not the ray point)
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pick(e) {
  const rect = dom.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  // Pick radius ~6 px on screen (at the orbit target distance), independent of cloud density.
  const worldPerPx = camera.isOrthographicCamera
    ? (camera.top - camera.bottom) / camera.zoom / rect.height
    : (2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / rect.height;
  raycaster.params.Points.threshold = Math.max(6, view.pointSize) * worldPerPx;
  for (const hit of raycaster.intersectObject(state.cloud.points, false)) {
    const v = new THREE.Vector3().fromBufferAttribute(geom().attributes.position, hit.index);
    if (passes(v.x, v.y, v.z)) return v;
  }
  return null;
}

const fmtXYZ = (v) => `x ${v.x.toFixed(2)}  y ${v.y.toFixed(2)}  z ${v.z.toFixed(2)}`;
let hoverEvent = null;
function doHover() {
  const e = hoverEvent;
  hoverEvent = null;
  if (!state.cloud) return;
  const v = pick(e);
  if (v) placeMarker(hoverMarker, v);
  else hoverMarker.visible = false;
  if (state.mode === "none") dom.style.cursor = v ? "pointer" : "";
  $("status-xyz").textContent = v ? fmtXYZ(v) : "";
  pgmCursor = v;
  drawPgm();
  render();
}

// ---------------------------------------------------------------------------
// Pointer handling. Camera motion is OrbitControls; this layer distinguishes clicks
// from drags and drives the lasso. Shift+left pans (RViz2 convention).
let drag = null;
const local = (e) => {
  const r = dom.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
dom.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: false };
  if (e.button === 0 && state.mode === "lasso") {
    lassoPoly = null;
    lassoPath = [local(e)];
    updateActionBar();
  } else if (e.button === 0 && e.shiftKey && state.mode === "none") {
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  }
});

dom.addEventListener("pointermove", (e) => {
  if (drag && e.buttons) {
    if (Math.abs(e.clientX - drag.x) > 4 || Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
    if (lassoPath) {
      lassoPath.push(local(e));
      drawLasso();
    }
    return;
  }
  if (!hoverEvent) requestAnimationFrame(doHover);
  hoverEvent = e;
});

dom.addEventListener("pointerup", () => {
  if (!drag) return;
  if (lassoPath) finishLasso();
  if (state.mode !== "lasso") controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; // undo Shift+left pan remap
});

dom.addEventListener("click", (e) => {
  if (e.button !== 0 || drag?.moved || state.mode === "lasso" || !state.cloud) return;
  const v = pick(e);
  if (state.mode === "measure") {
    if (v) addMeasurePoint(v);
    return;
  }
  if (v) {
    placeMarker(selectMarker, v);
    status(`Point: ${fmtXYZ(v)}`);
  } else selectMarker.visible = false;
  render();
});

dom.addEventListener("dblclick", (e) => {
  if (state.mode !== "none" || !state.cloud) return;
  const v = pick(e);
  if (v) focusOn(v);
  else resetView();
});

// ---------------------------------------------------------------------------
// Toolbar
const TOOLBAR = {
  "tb-orbit": () => { cancelPending(); setMode("none"); },
  "tb-measure": () => toggleMode("measure"),
  "tb-lasso": () => toggleMode("lasso"),
  "tb-top": () => setTopView(!view.topView),
  "tb-reset": resetView,
  "tb-map": () => setMapView(!state.mapView),
  "tb-undo": undo,
  "tb-redo": redo,
  "tb-help": () => $("help-dialog").showModal(),
};
for (const [id, act] of Object.entries(TOOLBAR)) $(id).addEventListener("click", act);
function updateToolbar() {
  $("tb-orbit").classList.toggle("active", state.mode === "none");
  $("tb-measure").classList.toggle("active", state.mode === "measure");
  $("tb-lasso").classList.toggle("active", state.mode === "lasso");
  $("lasso-btn").classList.toggle("active", state.mode === "lasso");
  $("tb-top").classList.toggle("active", view.topView);
  $("tb-map").classList.toggle("active", state.mapView);
  $("tb-undo").disabled = state.undo.length === 0;
  $("tb-redo").disabled = state.redo.length === 0;
}

// ---------------------------------------------------------------------------
// Right-click context menu
const menuEl = $("context-menu");
function hideMenu() {
  menuEl.hidden = true;
  menuEl.replaceChildren();
}
function showMenu(x, y, items) {
  menuEl.replaceChildren(
    ...items.map((it) => {
      if (it.sep) {
        const s = document.createElement("div");
        s.className = "menu-sep";
        return s;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "menu-item";
      b.setAttribute("role", "menuitem");
      b.textContent = it.label;
      b.disabled = !!it.disabled;
      b.addEventListener("click", () => { hideMenu(); it.act(); });
      return b;
    })
  );
  menuEl.hidden = false;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.min(x, window.innerWidth - r.width - 4) + "px";
  menuEl.style.top = Math.min(y, window.innerHeight - r.height - 4) + "px";
  menuEl.querySelector("button:not(:disabled)")?.focus();
}

function setModel(group, values) {
  Object.assign(model[group], values);
  onModelChange(group, Object.keys(values)[0]);
  refreshInputs();
}

dom.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (!state.cloud) return;
  const v = pick(e);
  const items = [];
  if (v) {
    const size = round2(diag() * 0.15);
    items.push(
      { label: `📍 ${fmtXYZ(v)}`, disabled: true },
      { label: "🎯 Focus here", act: () => focusOn(v) },
      { label: "⤒ Set Z max to this height", act: () => setModel("band", { max: round2(v.z) }) },
      { label: "⤓ Set Z min to this height", act: () => setModel("band", { min: round2(v.z) }) },
      { label: "✂ Crop X/Y around here", act: () => setModel("crop", { xmin: round2(v.x - size), xmax: round2(v.x + size), ymin: round2(v.y - size), ymax: round2(v.y + size) }) },
      { sep: true }
    );
  }
  if (isCropped()) items.push({ label: "✂ Reset crop", act: resetCrop });
  items.push(
    { label: state.mode === "measure" ? "📏 Stop measuring" : "📏 Measure", act: () => toggleMode("measure") },
    { label: state.mode === "lasso" ? "⬚ Stop lasso" : "⬚ Lasso", act: () => toggleMode("lasso") },
    { sep: true },
    { label: view.topView ? "⬇ 3D view" : "⬇ Top view", act: () => setTopView(!view.topView) },
    { label: "⌂ Reset view", act: resetView },
    { label: "↶ Undo", disabled: state.undo.length === 0, act: undo }
  );
  showMenu(e.clientX, e.clientY, items);
});
window.addEventListener("pointerdown", (e) => { if (!menuEl.hidden && !menuEl.contains(e.target)) hideMenu(); }, true);
window.addEventListener("blur", hideMenu);
dom.addEventListener("wheel", hideMenu, { passive: true });

// ---------------------------------------------------------------------------
// Panel: inputs with data-bind="group.key" are two-way bound to the model objects.
const boundInputs = [...document.querySelectorAll("[data-bind]")];
const bindTarget = (el) => {
  const [g, k] = el.dataset.bind.split(".");
  return [model[g], k, g];
};

function refreshInputs(except = null) {
  for (const el of boundInputs) {
    if (el === except || (el === document.activeElement && el.type === "number")) continue;
    const [obj, k] = bindTarget(el);
    if (el.type === "checkbox") el.checked = obj[k];
    else if (typeof obj[k] === "number") el.value = +obj[k].toFixed(3);
    else el.value = obj[k];
  }
  updateDualFills();
}

// Two-thumb sliders (.dual-track holds a min and a max range input).
function updateDualFills() {
  for (const t of document.querySelectorAll(".dual-track")) {
    const [lo, hi] = t.querySelectorAll("input");
    const span = +lo.max - +lo.min || 1;
    const pct = (v) => Math.min(100, Math.max(0, ((v - +lo.min) / span) * 100));
    t.style.setProperty("--lo", pct(+lo.value) + "%");
    t.style.setProperty("--hi", pct(+hi.value) + "%");
    lo.style.zIndex = pct(+lo.value) > 50 ? 3 : 1; // overlapping at the right end: min must stay draggable
  }
}

function updateRanges() {
  const b = state.bounds;
  for (const el of boundInputs) {
    if (el.dataset.axis === undefined) continue;
    const i = +el.dataset.axis;
    el.min = floor2(b.min[i]);
    el.max = ceil2(b.max[i]);
    el.step = Math.max(0.01, round2((b.max[i] - b.min[i]) / 500));
  }
}

function onModelChange(group, key) {
  if (group === "band" && band.min > band.max) {
    if (key === "min") band.max = band.min;
    else band.min = band.max;
  }
  if (group === "crop") {
    for (const [lo, hi] of [["xmin", "xmax"], ["ymin", "ymax"]]) {
      if (crop[lo] > crop[hi]) {
        if (key === lo) crop[hi] = crop[lo];
        else crop[lo] = crop[hi];
      }
    }
  }
  updateDualFills();
  if (group === "view" && key === "colorMode") autoColorRange();
  else syncUniforms();
  if (group === "band" || group === "crop" || ["invert", "radius", "minNeighbors", "mapResolution"].includes(key)) scheduleMap();
}

for (const el of boundInputs) {
  el.addEventListener(el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input", () => {
    if (!state.cloud) return;
    const [obj, k, g] = bindTarget(el);
    let v;
    if (el.type === "checkbox") v = el.checked;
    else if (el.type === "number" || el.type === "range") {
      v = parseFloat(el.value);
      if (!Number.isFinite(v)) return; // half-typed value, wait for more input
      if (el.min !== "" && el.type === "number" && g === "ops") v = Math.max(+el.min, v);
      if (el.max !== "" && el.type === "number" && g === "ops") v = Math.min(+el.max, v);
    } else v = el.value;
    obj[k] = v;
    onModelChange(g, k);
    refreshInputs(el);
  });
  // Show the clamped / normalized value once the user leaves a number field.
  if (el.type === "number") el.addEventListener("change", () => refreshInputs());
}

$("align-btn").addEventListener("click", alignFloor);
$("sor-btn").addEventListener("click", findNoise);
$("lasso-btn").addEventListener("click", () => toggleMode("lasso"));
$("voxel-btn").addEventListener("click", downsample);
$("map-btn").addEventListener("click", exportMap);
$("map-view-btn").addEventListener("click", () => setMapView(!state.mapView));
$("tf-btn").addEventListener("click", applyManualTransform);
$("crop-reset").addEventListener("click", () => state.cloud && resetCrop());
$("cloud-btn").addEventListener("click", exportCloud);
$("close-btn").addEventListener("click", () => {
  if (state.undo.length && !confirm("Close this file? Unsaved edits will be lost.")) return;
  closeCloud();
});
$("file-input").addEventListener("change", (e) => openFile(e.target.files[0]));

// After every geometry change (load, edit, undo).
function onGeometryChanged() {
  state.geomVersion++;
  computeBounds();
  updateRanges();
  updateChrome();
  hoverMarker.visible = selectMarker.visible = false;
  updateToolbar();
  syncUniforms();
  scheduleMap();
}

// ---------------------------------------------------------------------------
// Reload / close tab (Ctrl+R, F5, ✕) with a cloud open: the browser asks first,
// because the edits, crop and map settings would be lost. Browsers show their own
// generic text; a custom message is not allowed.
window.addEventListener("beforeunload", (e) => {
  if (!state.cloud) return;
  e.preventDefault();
  e.returnValue = ""; // still required by some browsers
});

// ---------------------------------------------------------------------------
// Drag & drop
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("dragging");
});
window.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) document.body.classList.remove("dragging");
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("dragging");
  const files = e.dataTransfer.files;
  if (files.length > 1) status("Only one file can be open at a time; opening the first one");
  openFile(files[0]);
});

// ---------------------------------------------------------------------------
// Keyboard
window.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, select, textarea, dialog")) return;
  if (!state.cloud) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    return redo();
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "m") toggleMode("measure");
  else if (k === "l") toggleMode("lasso");
  else if (k === "t") setTopView(!view.topView);
  else if (k === "p") setMapView(!state.mapView);
  else if (e.key === "?") $("help-dialog").showModal();
  else if (e.key === "Delete" && lassoPoly) applyLasso(false);
  else if (e.key === "Enter" && lassoPoly && !e.target.closest?.("button")) applyLasso(true);
  else if (e.key === "Escape") {
    hideMenu();
    if (state.pending) cancelPending();
    else if (lassoPoly || lassoPath) cancelLasso();
    else setMode("none");
  }
});

// ---------------------------------------------------------------------------
function resize() {
  const [w, h] = vpSize();
  perspCam.aspect = w / h;
  perspCam.updateProjectionMatrix();
  orthoCam.left = (-orthoCam.top * w) / h;
  orthoCam.right = (orthoCam.top * w) / h;
  orthoCam.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  lassoCanvas.width = w;
  lassoCanvas.height = h;
  drawLasso();
  syncTopFromPgm();
  render();
}
new ResizeObserver(resize).observe(sceneEl);
resize();
updateChrome();
