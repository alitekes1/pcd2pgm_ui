// Re-check of QA2-03/04/05/06/07 after the fixes.
import * as L from "./lib.mjs";
import path from "node:path";
import fs from "node:fs";
const kind = process.argv[2] || "chromium";
const only = process.argv[3]; // optional: run one section
const tag = (id) => (kind === "chromium" ? id : `${id}-${kind}`);
const run = (s) => !only || only === s;
fs.mkdirSync(path.join(L.OUT, kind, "names"), { recursive: true });

if (run("C")) {
  const { browser, page } = await L.launch(kind);
  try {
    await L.boot(page);
    await L.open(page, L.fx("room10_binary.pcd"));
    const shot = async () => (await page.locator("#scene canvas").first().screenshot()).toString("base64");
    // OrbitControls calls preventDefault on the arrow keys it pans with; read it after dispatch.
    await page.evaluate(() => { window.__prevented = []; addEventListener("keydown", (e) => setTimeout(() => window.__prevented.push(e.defaultPrevented)), true); });
    for (const [sel, key] of [['input[type=range][data-bind="crop.xmax"]', "ArrowLeft"], ['input[type=range][data-bind="rot.yaw"]', "ArrowRight"], ['input.num-input[data-bind="ops.mapResolution"]', "ArrowLeft"], ["#color-mode", "ArrowDown"]]) {
      await page.focus(sel); await L.sleep(800);
      const a = await shot();
      const v0 = await page.$eval(sel, (e) => e.value);
      await page.evaluate(() => (window.__prevented.length = 0));
      await page.keyboard.press(key); await L.sleep(800);
      const b = await shot();
      const v1 = await page.$eval(sel, (e) => e.value);
      const prevented = await page.evaluate(() => window.__prevented.slice());
      const isRange = sel.includes("range");
      L.record(tag(`C-05[${sel}]`), "C", "Odaklı alanda ok tuşu", "Kamera tuşu almaz (defaultPrevented yok); slider değeri değişir, diğerlerinde görünüm sabit", { prevented, viewSame: a === b, value: [v0, v1] }, !prevented.includes(true) && (isRange ? v0 !== v1 : a === b) ? "PASS" : "FAIL");
    }
    await page.keyboard.press("Escape");
    // Regression: with nothing focused, arrows still pan the camera.
    await page.evaluate(() => document.activeElement?.blur());
    await L.sleep(800);
    const a = await shot();
    await page.keyboard.press("ArrowLeft"); await L.sleep(800);
    const b = await shot();
    L.record(tag("C-05-pan"), "C", "Odak yokken ok tuşu kamerayı kaydırır", "Görünüm değişir", { viewChanged: a !== b }, a !== b ? "PASS" : "FAIL");
  } finally { await browser.close(); }
}

if (run("B")) {
  const { browser, page } = await L.launch(kind);
  const dialogs = [];
  page.removeAllListeners("dialog");
  let answer = true;
  page.on("dialog", (d) => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss(); });
  try {
    await L.boot(page);
    for (const f of [L.fx("tilted_room.pcd"), L.fx("flat_room.pcd"), L.fx("two_floors.pcd"), L.fx("ramp_only.pcd"), L.REAL, L.fx("walls_only.pcd"), L.fx("no_floor_noise.pcd")]) {
      for (answer of [false, true]) {
        await L.open(page, f);
        dialogs.length = 0;
        await L.clearMsgs(page);
        await L.click(page, "align-btn"); await L.idle(page);
        const ms = await L.msgs(page);
        L.record(tag(`B-04[${path.basename(f)}][${answer ? "accept" : "dismiss"}]`), "B", "Zemin hizalama", "Zemin varsa onay sorulmaz; yoksa sorulur ve iptal edilebilir", { dialog: dialogs[0] || null, last: ms.at(-1) }, "REVIEW");
      }
    }
  } finally { await browser.close(); }
}

if (run("G")) {
  const w = await L.launch(kind);
  try {
    await w.page.route(/worker\.js/, (r) => r.abort());
    await L.boot(w.page); await L.open(w.page, L.fx("room10_binary.pcd"));
    await w.page.evaluate(() => document.getElementById("map-view-btn").click());
    await L.clearMsgs(w.page);
    await L.click(w.page, "sor-btn"); await L.sleep(3000);
    const st = await w.page.evaluate(() => ({ busy: document.body.classList.contains("busy"), pgmBusy: !document.getElementById("pgm-busy").hidden, pgmEmpty: document.getElementById("pgm-empty").textContent, anyEnabled: [...document.querySelectorAll("#panel button")].some((b) => !b.disabled) }));
    const ms = await L.msgs(w.page);
    await L.clearMsgs(w.page); await L.click(w.page, "voxel-btn"); await L.sleep(1000);
    const second = (await L.msgs(w.page)).filter((m) => m.startsWith("status-msg"));
    L.record(tag("G-05"), "G", "Web Worker yüklenemezse", "Anlamlı hata, UI kilitlenmez", { st, msgs: ms, second }, !st.busy && !st.pgmBusy && st.anyEnabled && /worker failed/i.test(ms.join(" ")) && /worker failed/i.test(second.join(" ")) ? "PASS" : "FAIL");
  } finally { await w.browser.close(); }
  if (kind === "chromium") {
    const { chromium } = await import("playwright");
    const nb = await chromium.launch({ args: ["--disable-webgl", "--disable-3d-apis", "--disable-gpu"] });
    const np = await nb.newPage();
    await np.goto(L.APP); await L.sleep(2500);
    await np.screenshot({ path: path.join(L.OUT, kind, "G-06-nowebgl.png") });
    const v = await np.evaluate(() => ({ text: document.getElementById("welcome-status").textContent, error: document.getElementById("welcome-status").classList.contains("error") }));
    L.record(tag("G-06"), "G", "WebGL devre dışı", "Görünür 'WebGL gerekli' mesajı", v, /webgl/i.test(v.text) && v.error ? "PASS" : "FAIL");
    await nb.close();
  }
}

if (run("A")) {
  const { browser, page } = await L.launch(kind);
  try {
    await L.boot(page);
    for (const f of ["ölçüm şğı İç Ğ.pcd", "with spaces in name.pcd", "evil<img src=x onerror=window.__xss=3>.pcd", "cloud # cropped: yes.pcd", "a.b.c.final.pcd"]) {
      await L.open(page, L.fx(f));
      const e = await L.exportMap(page, path.join(L.OUT, kind, "names"));
      const y = e.yaml ? L.parseYaml(e.yaml) : {};
      const pgmName = e.names.find((n) => n.endsWith(".pgm"));
      L.record(tag(`A-05[${f}]`), "A", "İndirme adı", "YAML image = kaydedilen PGM adı", { saved: e.names, yamlImage: y.image }, y.image === pgmName && fs.existsSync(e.files[pgmName] || "/nonexistent") ? "PASS" : "FAIL");
    }
  } finally { await browser.close(); }
}
L.saveResults(`fix3-${kind}-${only || "all"}`);
