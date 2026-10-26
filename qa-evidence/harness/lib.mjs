// Shared QA harness for pcd2pgm_ui (Playwright, black-box through the DOM).
import { chromium, firefox, webkit } from "playwright";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const APP = process.env.APP_URL || "http://127.0.0.1:8765/";
export const FX = "/tmp/pcd2pgm-qa/fx";
export const REAL = "/home/tekes/pcd2pgm_ui/go2_mid360_new_office_route1.pcd";
export const OUT = process.env.OUT_DIR || "/tmp/pcd2pgm-qa/out";
fs.mkdirSync(OUT, { recursive: true });
export const fx = (n) => path.join(FX, n);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
export function record(id, area, title, expected, actual, status) {
  const r = { id, area, title, expected, actual: typeof actual === "string" ? actual : JSON.stringify(actual), status };
  results.push(r);
  console.log(`[${status}] ${id} ${title} :: ${r.actual.slice(0, 400)}`);
  return r;
}
export function saveResults(name) {
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(results, null, 1));
}

// Every status text the app shows is captured (messages auto-clear after 5-10 s).
const INIT = () => {
  window.__msgs = [];
  window.__errors = [];
  addEventListener("error", (e) => window.__errors.push("error: " + e.message));
  addEventListener("unhandledrejection", (e) => window.__errors.push("rejection: " + (e.reason?.message || e.reason)));
  const hook = () => {
    for (const id of ["status-msg", "welcome-status", "map-info", "pgm-empty"]) {
      const el = document.getElementById(id);
      if (!el || el.__hooked) continue;
      el.__hooked = true;
      new MutationObserver(() => el.textContent && window.__msgs.push(`${id}: ${el.textContent}`)).observe(el, { childList: true, characterData: true, subtree: true });
    }
  };
  document.addEventListener("DOMContentLoaded", hook);
};

export async function launch(kind = "chromium", { viewport = { width: 1440, height: 900 }, ...ctxOpts } = {}) {
  const bt = { chromium, firefox, webkit }[kind];
  const browser = await bt.launch({ args: kind === "chromium" ? ["--enable-unsafe-swiftshader", "--js-flags=--expose-gc", "--enable-precise-memory-info"] : [] });
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, ...ctxOpts });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const log = { console: [], requests: [], failed: [], http: [] };
  page.on("console", (m) => ["error", "warning"].includes(m.type()) && log.console.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => log.console.push("pageerror: " + e.message));
  page.on("request", (r) => log.requests.push({ url: r.url(), method: r.method(), post: r.postDataBuffer()?.length || 0 }));
  page.on("requestfailed", (r) => log.failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.status() >= 400 && log.http.push(`${r.status()} ${r.url()}`));
  page.on("dialog", (d) => d.accept());
  return { browser, ctx, page, log };
}

export async function boot(page) {
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.getElementById("color-mode") && window.__msgs, null, { timeout: 30000 });
  await sleep(300); // module script attaches its listeners after the import map resolves
}

export const msgs = (page) => page.evaluate(() => window.__msgs.slice());
export const clearMsgs = (page) => page.evaluate(() => (window.__msgs.length = 0));
export const text = (page, id) => page.evaluate((i) => document.getElementById(i)?.textContent ?? null, id);
export const isBusy = (page) => page.evaluate(() => document.body.classList.contains("busy"));
export async function idle(page, timeout = 120000) {
  await page.waitForFunction(() => !document.body.classList.contains("busy"), null, { timeout, polling: 100 });
}

// Open a file through the hidden input ("Choose file"); returns the messages it produced.
export async function open(page, file, timeout = 180000) {
  await clearMsgs(page);
  await page.setInputFiles("#file-input", file);
  await page.waitForFunction(() => window.__msgs.some((m) => /: (Opened |Opening .* failed)/.test(m)), null, { timeout, polling: 100 });
  await idle(page, timeout);
  return msgs(page);
}

// Drag & drop a file onto the window (dispatches real DataTransfer drop events).
export async function drop(page, file) {
  await clearMsgs(page);
  const buf = fs.readFileSync(file).toString("base64");
  const dt = await page.evaluateHandle(({ b64, name }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const d = new DataTransfer();
    d.items.add(new File([bin], name));
    return d;
  }, { b64: buf, name: path.basename(file) });
  await page.dispatchEvent("body", "dragover", { dataTransfer: dt });
  await page.dispatchEvent("body", "drop", { dataTransfer: dt });
  await page.waitForFunction(() => window.__msgs.some((m) => /: (Opened |Opening .* failed)/.test(m)), null, { timeout: 60000 });
  await idle(page);
  return msgs(page);
}

// Set a [data-bind] control the way a user does (value + input + change).
export async function setBind(page, bind, value, { which = 0 } = {}) {
  await page.evaluate(({ bind, value, which }) => {
    const el = document.querySelectorAll(`[data-bind="${bind}"]`)[which];
    if (el.type === "checkbox") el.checked = !!value;
    else el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, { bind, value, which });
}
export const getBind = (page, bind, which = 0) =>
  page.evaluate(({ bind, which }) => {
    const el = document.querySelectorAll(`[data-bind="${bind}"]`)[which];
    return el.type === "checkbox" ? el.checked : el.value;
  }, { bind, which });

export async function click(page, id) {
  await page.evaluate((i) => document.getElementById(i).click(), id);
}

// Wait until the live PGM preview finished and return its info line.
export async function preview(page, timeout = 120000) {
  await page.waitForFunction(() => {
    const b = document.getElementById("pgm-busy");
    return b && b.hidden && (document.getElementById("map-info").textContent || !document.getElementById("pgm-empty").hidden);
  }, null, { timeout, polling: 100 });
  await sleep(300); // the map is debounced 200 ms
  await page.waitForFunction(() => document.getElementById("pgm-busy").hidden, null, { timeout, polling: 100 });
  return { info: await text(page, "map-info"), empty: await page.evaluate(() => { const e = document.getElementById("pgm-empty"); return e.hidden ? "" : e.textContent; }) };
}

// Click "Download map", save both downloads, return parsed artifacts (or the error message).
export async function exportMap(page, dir, timeout = 120000) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await clearMsgs(page);
  const dls = [];
  const onDl = (d) => dls.push(d);
  page.on("download", onDl);
  await page.click("#map-btn");
  await page.waitForFunction(() => window.__msgs.some((m) => /status-msg: (Saved |Map export failed)/.test(m)), null, { timeout, polling: 100 });
  const status = (await msgs(page)).find((m) => /status-msg: (Saved |Map export failed)/.test(m));
  await sleep(500);
  page.off("download", onDl);
  const files = {};
  for (const d of dls) {
    const p = path.join(dir, d.suggestedFilename());
    await d.saveAs(p);
    files[d.suggestedFilename()] = p;
  }
  const pgmName = Object.keys(files).find((f) => f.endsWith(".pgm"));
  const yamlName = Object.keys(files).find((f) => f.endsWith(".yaml"));
  return { status, names: Object.keys(files), pgm: pgmName ? readPgm(files[pgmName]) : null, yaml: yamlName ? fs.readFileSync(files[yamlName], "utf8") : null, files };
}

export function readPgm(file) {
  const b = fs.readFileSync(file);
  let o = 0;
  const tok = () => {
    for (;;) {
      while (/\s/.test(String.fromCharCode(b[o]))) o++;
      if (b[o] === 35) { while (b[o] !== 10) o++; continue; }
      let s = "";
      while (!/\s/.test(String.fromCharCode(b[o]))) s += String.fromCharCode(b[o++]);
      return s;
    }
  };
  const magic = tok(), width = +tok(), height = +tok(), maxval = +tok();
  o++; // single whitespace after maxval
  const data = b.subarray(o);
  const values = [...new Set(data)].sort((a, c) => a - c);
  return { magic, width, height, maxval, payload: data.length, payloadOk: data.length === width * height, values, occupied: data.reduce((s, v) => s + (v === 0), 0), sha: crypto.createHash("sha256").update(b).digest("hex").slice(0, 16), data, file };
}

export function parseYaml(y) {
  const o = {};
  for (const line of y.split("\n")) {
    const m = /^(\w+):\s*(.*)$/.exec(line);
    if (m) o[m[1]] = m[2];
  }
  if (o.image?.startsWith('"')) o.image = JSON.parse(o.image);
  if (o.origin) o.origin = JSON.parse(o.origin.replace(/(\d)\s*,/g, "$1,"));
  return o;
}

export async function heap(page) {
  return page.evaluate(() => { window.gc?.(); return performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null; });
}

// Canvas helpers for viewport interactions.
export async function sceneBox(page) {
  return page.evaluate(() => { const r = document.querySelector("#scene canvas:not(#lasso-canvas)").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
}


// Map world -> screen in top view by hovering a grid and reading the picked point.
export async function calibrateTop(page) {
  const b = await sceneBox(page);
  const hits = [];
  for (let gy = 0.1; gy <= 0.9 && hits.length < 60; gy += 0.04) {
    for (let gx = 0.1; gx <= 0.9; gx += 0.04) {
      const sx = b.x + b.w * gx, sy = b.y + b.h * gy;
      await page.mouse.move(sx, sy);
      await sleep(30);
      const t = await text(page, "status-xyz");
      const m = /^x (-?[\d.]+)\s+y (-?[\d.]+)\s+z (-?[\d.]+)$/.exec(t || "");
      if (m) hits.push({ sx, sy, x: +m[1], y: +m[2] });
    }
  }
  if (hits.length < 4) throw new Error("calibration: too few hits " + hits.length);
  const fit = (u, v) => { const n = u.length, mu = u.reduce((a, c) => a + c) / n, mv = v.reduce((a, c) => a + c) / n; let num = 0, den = 0; for (let i = 0; i < n; i++) { num += (u[i] - mu) * (v[i] - mv); den += (u[i] - mu) ** 2; } const k = num / den; return [k, mv - k * mu]; };
  const [ax, bx] = fit(hits.map((h) => h.x), hits.map((h) => h.sx));
  const [ay, by] = fit(hits.map((h) => h.y), hits.map((h) => h.sy));
  return { toScreen: (x, y) => [ax * x + bx, ay * y + by], hits: hits.length, pxPerM: ax };
}
export const picked = async (page) => {
  const m = /^x (-?[\d.]+)\s+y (-?[\d.]+)\s+z (-?[\d.]+)$/.exec((await text(page, "status-xyz")) || "");
  return m ? [+m[1], +m[2], +m[3]] : null;
};
