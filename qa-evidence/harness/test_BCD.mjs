// Sections B (floor), C (crop), D (cleanup, lasso, undo/redo).
import path from "node:path";
import * as L from "./lib.mjs";
const { record, fx, OUT } = L;
const kind = process.argv[2] || "chromium";
const only = process.argv[3]; // optional section filter: B, C or D
const tag = (id) => (kind === "chromium" ? id : `${id}-${kind}`);
const st = (page) => page.evaluate(() => {
  const v = (b, i = 0) => +document.querySelectorAll(`[data-bind="${b}"]`)[i]?.value;
  return { info: document.getElementById("file-info").textContent, x: [v("crop.xmin"), v("crop.xmax", 1)], y: [v("crop.ymin"), v("crop.ymax", 1)], z: [v("band.min"), v("band.max", 1)], aligned: !document.getElementById("align-state").hidden, undo: document.getElementById("tb-undo").disabled, redo: document.getElementById("tb-redo").disabled, stats: document.getElementById("status-stats").textContent, bar: document.getElementById("action-bar").hidden ? "" : document.getElementById("action-bar").textContent, lassoVisible: !document.getElementById("lasso-canvas").hidden };
});
const lastMsg = async (page, re = /status-msg/) => (await L.msgs(page)).filter((m) => re.test(m)).pop() || "";
const count = (s) => +(/([\d,]+) points/.exec(s.info)?.[1].replace(/,/g, "") ?? NaN);

// Map screen <-> world in top view by hovering a grid and reading the picked point.
async function calibrateTop(page) {
  const b = await L.sceneBox(page);
  const hits = [];
  for (let gy = 0.15; gy <= 0.85 && hits.length < 40; gy += 0.05) {
    for (let gx = 0.15; gx <= 0.85; gx += 0.05) {
      const sx = b.x + b.w * gx, sy = b.y + b.h * gy;
      await page.mouse.move(sx, sy);
      await L.sleep(40);
      const t = await L.text(page, "status-xyz");
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
async function lasso(page, pts) {
  await page.mouse.move(...pts[0]);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...p, { steps: 4 });
  await page.mouse.up();
  await L.sleep(100);
}
const rectPoly = (T, x0, y0, x1, y1) => [T(x0, y0), T(x1, y0), T(x1, y1), T(x0, y1), T(x0, y0 + 0.01)];

const { browser, page, log } = await L.launch(kind);
try {
  await L.boot(page);
  if (!only || only === "B") {
    // ---------- B floor alignment ----------
    for (const [f, label] of [["tilted_room.pcd", "Eğik zemin (roll 12°, pitch 8°, z=-1.7)"], ["flat_room.pcd", "Zaten düz zemin"]]) {
      await L.open(page, fx(f));
      const before = await st(page);
      await L.click(page, "align-btn"); await L.idle(page);
      const m1 = await lastMsg(page); const s1 = await st(page);
      await L.click(page, "align-btn"); await L.idle(page);
      const m2 = await lastMsg(page); const s2 = await st(page);
      for (let i = 0; i < 3; i++) { await L.click(page, "align-btn"); await L.idle(page); }
      const s5 = await st(page);
      const ok = Math.abs(s1.z[0]) <= 0.02 && Math.abs(s1.z[1] - 2.5) <= 0.03 && /tilted 0\.0\d°/.test(m2) && Math.abs(s5.z[0] - s1.z[0]) <= 0.01 && Math.abs(s5.z[1] - s1.z[1]) <= 0.01;
      record(tag(`B-01[${f}]`), "B", label, "Zemin z≈0, tavan/duvar üstü z≈2.5; 2. hizalama ≈0°, 5 kez sonra drift yok", { before: before.z, first: m1, afterZ: s1.z, second: m2, after5: s5.z }, ok ? "PASS" : "FAIL");
    }
    await L.open(page, fx("tilted_room.pcd")); await L.click(page, "align-btn"); await L.idle(page);
    const d1 = await lastMsg(page), z1 = (await st(page)).z;
    await L.open(page, fx("tilted_room.pcd")); await L.click(page, "align-btn"); await L.idle(page);
    const d2 = await lastMsg(page), z2 = (await st(page)).z;
    record(tag("B-02"), "B", "Determinizm: aynı dosya, aynı sonuç", "Mesaj ve Z aralığı birebir aynı", { d1, d2, z1, z2 }, d1 === d2 && JSON.stringify(z1) === JSON.stringify(z2) ? "PASS" : "FAIL");
    await page.keyboard.press("Control+z"); await L.sleep(200);
    const u = await st(page);
    record(tag("B-03"), "B", "Hizalamayı geri alma (Ctrl+Z)", "Z aralığı eğik haldeki değere döner, 'Floor is at z = 0' gizlenir", { z: u.z, aligned: u.aligned, msg: await lastMsg(page) }, !u.aligned && u.z[0] < -2 ? "PASS" : "FAIL");
    for (const [f, label] of [["walls_only.pcd", "Zeminsiz (yalnız duvar)"], ["two_floors.pcd", "İki katlı bina"], ["ramp_only.pcd", "Yalnız rampa (8.5°)"], ["no_floor_noise.pcd", "Rastgele hacim (zemin yok)"], [L.REAL, "Gerçek PCD"]]) {
      await L.open(page, f.startsWith("/") ? f : fx(f));
      await L.click(page, "align-btn"); await L.idle(page);
      const m = await lastMsg(page); const s = await st(page);
      await L.click(page, "align-btn"); await L.idle(page);
      record(tag(`B-04[${path.basename(f)}]`), "B", label, "Anlamlı sonuç veya açık hata; ikinci hizalama ≈0°", { msg: m, z: s.z, second: await lastMsg(page) }, "REVIEW");
    }
  }
  if (!only || only === "C") {
    // ---------- C crop ----------
    await L.open(page, fx("room10_binary.pcd"));
    await L.setBind(page, "crop.xmax", 5); await L.setBind(page, "crop.xmin", 8);
    const c1 = await st(page);
    record(tag("C-01"), "C", "X min > X max yazma", "Diğer uç itilir (min=max=8), hata yok", c1.x, c1.x[0] === 8 && c1.x[1] === 8 ? "PASS" : "FAIL");
    await L.click(page, "map-view-btn");
    const pv = await L.preview(page);
    record(tag("C-02"), "C", "min = max (8 = 8)", "Tek kolon harita ya da anlamlı mesaj", pv, pv.info ? "PASS" : "FAIL");
    await L.setBind(page, "crop.xmin", 4.4); await L.setBind(page, "crop.xmax", 4.6); await L.setBind(page, "crop.ymin", 4.4); await L.setBind(page, "crop.ymax", 4.6);
    await L.sleep(400);
    const c3 = await st(page); const pv3 = await L.preview(page);
    await page.screenshot({ path: path.join(OUT, kind, "C-03-empty.png") });
    record(tag("C-03"), "C", "Kırpma sonrası 0 nokta", "Boş görünüm + 'No points' mesajı; istatistikte 0 gösterilir", { stats: c3.stats, pgm: pv3.empty }, /No points/.test(pv3.empty) ? "PASS" : "FAIL");
    await L.click(page, "crop-reset");
    await L.preview(page);
    // rapid slider drag: 200 input events on the X-min range without waiting
    const errs0 = (await page.evaluate(() => window.__errors.length));
    await page.evaluate(() => { const el = document.querySelectorAll('[data-bind="crop.xmin"]')[1]; for (let i = 0; i < 200; i++) { el.value = String((i % 50) / 10); el.dispatchEvent(new Event("input", { bubbles: true })); } el.value = "2"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
    const fast = await L.preview(page);
    await L.click(page, "crop-reset"); await L.preview(page);
    await L.setBind(page, "crop.xmin", 2, { which: 1 });
    const calm = await L.preview(page);
    record(tag("C-04"), "C", "Çok hızlı slider sürükleme (200 olay)", "Son değer uygulanır, önizleme sakin hesapla aynı, hata yok", { fast: fast.info, calm: calm.info, newErrors: (await page.evaluate(() => window.__errors.length)) - errs0 }, fast.info === calm.info ? "PASS" : "FAIL");
    // keyboard on a focused field must not move the camera
    await L.click(page, "crop-reset"); await L.click(page, "map-view-btn"); await L.sleep(300);
    const canvasShot = async () => (await page.locator("#scene canvas").first().screenshot()).toString("base64");
    const sel = '[data-bind="ops.voxel"]';
    await page.evaluate((s) => document.querySelector(s).closest("details").open = true, sel);
    await page.focus(sel); await L.sleep(300);
    const a = await canvasShot();
    const v0 = await page.$eval(sel, (e) => e.value);
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowUp");
    await L.sleep(600);
    const b = await canvasShot();
    const v1 = await page.$eval(sel, (e) => e.value);
    record(tag("C-05"), "C", "Odaklı sayı alanında ok tuşları kamerayı kaydırmamalı", "Alan değeri değişir, 3D görünüm sabit kalır", { voxel: [v0, v1], viewChanged: a !== b }, v0 !== v1 && a === b ? "PASS" : "FAIL");
    const rsel = '[data-bind="crop.xmin"]';
    await page.focus(`${rsel}[type=range]`); await L.sleep(200);
    const ra = await canvasShot(); const rv0 = (await st(page)).x[0];
    await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft"); await L.sleep(600);
    const rb = await canvasShot(); const rv1 = (await st(page)).x[0];
    record(tag("C-05b"), "C", "Odaklı slider'da ok tuşu", "Yalnızca slider değeri değişir (crop sınırında değer zaten min'de olabilir)", { xmin: [rv0, rv1], viewChanged: ra !== rb }, ra === rb || rv0 !== rv1 ? "REVIEW" : "REVIEW");
    // context menu: set Z max / Z min / crop around a picked point (top view so a point is under the cursor)
    await L.open(page, fx("room10_binary.pcd"));
    await page.keyboard.press("t"); await L.sleep(300);
    const T = await calibrateTop(page);
    const [sx, sy] = T.toScreen(4.5, 6.0); // box wall
    await page.mouse.move(sx, sy); await L.sleep(80);
    const hovered = await L.text(page, "status-xyz");
    await page.mouse.click(sx, sy, { button: "right" }); await L.sleep(200);
    const items = await page.$$eval("#context-menu button", (bs) => bs.map((b) => b.textContent));
    const hz = +/z (-?[\d.]+)/.exec(items[0] || "")?.[1];
    await page.click("#context-menu button:has-text('Set Z max')"); await L.sleep(150);
    const afterMax = await st(page);
    await page.mouse.click(sx, sy, { button: "right" }); await L.sleep(150);
    await page.click("#context-menu button:has-text('Crop X/Y around here')"); await L.sleep(150);
    const afterCrop = await st(page);
    const hx = +/x (-?[\d.]+)/.exec(items[0])[1], hy = +/y (-?[\d.]+)/.exec(items[0])[1];
    const size = Math.round(Math.hypot(10, 10, 2.5) * 0.15 * 100) / 100;
    const cropOk = Math.abs(afterCrop.x[0] - (hx - size)) < 0.011 && Math.abs(afterCrop.y[1] - (hy + size)) < 0.011;
    record(tag("C-06"), "C", "Sağ tık: Z max / crop XY around point", "Z max = noktanın z'si; XY crop = nokta ± diag·0.15", { hovered, menuHeader: items[0], zmax: afterMax.z[1], crop: [afterCrop.x, afterCrop.y], size }, Math.abs(afterMax.z[1] - hz) < 0.011 && cropOk ? "PASS" : "FAIL");
    await page.mouse.move(sx, sy); await page.mouse.down({ button: "right" }); await page.mouse.move(sx + 60, sy + 40, { steps: 5 }); await page.mouse.up({ button: "right" }); await L.sleep(150);
    record(tag("C-07"), "C", "Sağ tuşla sürükledikten sonra menü", "Menü açılmamalı (yardım metni: 'Right-click (without dragging)')", { menuOpen: !(await page.$eval("#context-menu", (e) => e.hidden)) }, (await page.$eval("#context-menu", (e) => e.hidden)) ? "PASS" : "FAIL");
    await page.keyboard.press("Escape");
    const b2 = await L.sceneBox(page);
    await page.mouse.click(b2.x + b2.w - 3, b2.y + b2.h - 3, { button: "right" }); await L.sleep(150);
    const mr = await page.$eval("#context-menu", (e) => { const r = e.getBoundingClientRect(); return { hidden: e.hidden, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight }; });
    await page.mouse.click(b2.x + 50, b2.y + 50); await L.sleep(100);
    const closed = await page.$eval("#context-menu", (e) => e.hidden);
    record(tag("C-08"), "C", "Ekran kenarında menü konumu ve dışarı tıklayınca kapanma", "Menü pencere içinde kalır, dış tıklamada kapanır", { ...mr, closedOnOutsideClick: closed }, !mr.hidden && mr.right <= mr.vw && mr.bottom <= mr.vh && closed ? "PASS" : "FAIL");
  }
  if (!only || only === "D") {
    // ---------- D cleanup ----------
    await L.open(page, fx("room_with_outliers.pcd"));
    const n0 = count(await st(page));
    await L.click(page, "sor-btn"); await L.idle(page);
    const bar = (await st(page)).bar;
    await page.keyboard.press("Escape"); await L.sleep(100);
    const afterEsc = await st(page);
    await L.click(page, "sor-btn"); await L.idle(page);
    await page.click("#action-bar button:has-text('Remove')"); await L.sleep(300);
    const s = await st(page);
    record(tag("D-01"), "D", "Gürültü bulma: Esc iptal, Remove uygular, aykırı noktalar gider", "Esc ile değişiklik yok; Remove sonrası X aralığı odaya (0–10) döner", { n0, bar, afterEscCount: count(afterEsc), after: s.info, x: s.x, z: s.z }, count(afterEsc) === n0 && s.x[0] >= -0.05 && s.x[1] <= 10.05 ? "PASS" : "FAIL");
    for (const [b, v] of [["ops.sorK", 0], ["ops.sorK", -5], ["ops.sorK", 1000], ["ops.sorK", 2.5], ["ops.sorStd", 0], ["ops.sorStd", -1], ["ops.sorStd", 99], ["ops.voxel", 0], ["ops.voxel", -1], ["ops.voxel", 50]]) {
      await L.open(page, fx("room_with_outliers.pcd"));
      await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
      await page.fill(`[data-bind="${b}"]`, String(v)); await page.press(`[data-bind="${b}"]`, "Tab"); await L.sleep(100);
      const shown = await L.getBind(page, b);
      await L.clearMsgs(page);
      const t0 = Date.now();
      await L.click(page, b === "ops.voxel" ? "voxel-btn" : "sor-btn"); await L.idle(page);
      record(tag(`D-02[${b}=${v}]`), "D", `${b} = ${v}`, "Değer kenetlenir, işlem anlamlı sonuç/mesaj verir, çökme yok", { shown, ms: Date.now() - t0, msg: await lastMsg(page), bar: (await st(page)).bar.slice(0, 90), errors: await page.evaluate(() => window.__errors.slice()) }, (await page.evaluate(() => window.__errors.length)) ? "FAIL" : "PASS");
      await page.keyboard.press("Escape");
    }
    // ---------- lasso ----------
    await L.open(page, fx("lasso_scene.pcd"));
    const nL = count(await st(page));
    await page.keyboard.press("t"); await L.sleep(300);
    const T = await calibrateTop(page);
    await page.keyboard.press("l");
    await lasso(page, rectPoly(T.toScreen, 3.9, 1.9, 5.1, 3.1));
    const ready = (await st(page)).bar;
    await page.keyboard.press("Escape"); await L.sleep(100);
    const esc = await st(page);
    await lasso(page, rectPoly(T.toScreen, 3.9, 1.9, 5.1, 3.1));
    await page.keyboard.press("Delete"); await L.sleep(300);
    const del = await st(page); const delMsg = await lastMsg(page);
    const removed = nL - count(del);
    record(tag("D-03"), "D", "Lasso: Esc iptal, Del seçimi siler (üst görünüm)", "Esc'te değişiklik yok; Del ön kutuyu (4000) ve altındaki zemini siler, arka kutu kalır", { ready, escCount: count(esc), removed, delMsg, calibrationHits: T.hits }, count(esc) === nL && removed >= 4000 && removed < 4800 ? "PASS" : "FAIL");
    record(tag("D-03b"), "D", "Lasso arkada kalan noktaları da seçiyor mu?", "Belgelenmeli: üst görünümde kutunun altındaki zemin de silinir", { removedBeyondBox: removed - 4000, approxFloorUnderBox: Math.round(1.44 * 200) }, "REVIEW");
    await page.keyboard.press("Control+z"); await L.sleep(200);
    await page.keyboard.press("l"); await page.keyboard.press("l");
    await lasso(page, rectPoly(T.toScreen, 3.9, 6.9, 5.1, 8.1));
    await page.keyboard.press("Enter"); await L.sleep(300);
    const keep = await st(page);
    record(tag("D-04"), "D", "Lasso Enter = yalnız seçimi tut", "Kalan ≈ arka kutu (4000) + altındaki zemin", { kept: count(keep), msg: await lastMsg(page) }, count(keep) >= 4000 && count(keep) < 4800 ? "PASS" : "FAIL");
    await page.keyboard.press("Control+z"); await L.sleep(200);
    // degenerate lassos
    await page.keyboard.press("l"); await page.keyboard.press("l");
    const [cx, cy] = T.toScreen(4.5, 2.5);
    await page.mouse.click(cx, cy); await L.sleep(100);
    const single = await st(page);
    await lasso(page, [[cx, cy], [cx + 2, cy + 1], [cx + 1, cy + 2]]);
    const tiny = await st(page);
    await page.keyboard.press("Delete"); await L.sleep(200);
    const tinyDel = await lastMsg(page);
    const [ax, ay] = T.toScreen(3.9, 1.9), [bx, by] = T.toScreen(5.1, 3.1);
    await lasso(page, [[ax, ay], [bx, by], [bx, ay], [ax, by], [ax, ay]]); // bow-tie
    await page.keyboard.press("Delete"); await L.sleep(300);
    const bow = await lastMsg(page);
    await page.keyboard.press("Control+z"); await L.sleep(200);
    record(tag("D-05"), "D", "Tek tık / çok küçük / kendini kesen lasso", "Tek tık seçim oluşturmaz; küçük lasso az nokta seçer; papyon iki üçgeni seçer; çökme yok", { singleBar: single.bar.slice(0, 60), tinyBar: tiny.bar.slice(0, 40), tinyDel, bow, errors: await page.evaluate(() => window.__errors.slice()) }, (await page.evaluate(() => window.__errors.length)) ? "FAIL" : "REVIEW");
    // drag the lasso out of the canvas and release over the panel
    await page.keyboard.press("l"); await page.keyboard.press("l");
    const panel = await page.evaluate(() => { const r = document.getElementById("panel").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(cx, cy); await page.mouse.down();
    await page.mouse.move(cx + 80, cy + 10, { steps: 5 }); await page.mouse.move(cx + 80, cy + 80, { steps: 5 });
    await page.mouse.move(panel.x, panel.y, { steps: 10 }); await page.mouse.up(); await L.sleep(200);
    const outside = await st(page);
    await page.mouse.move(cx, cy, { steps: 5 }); await L.sleep(200);
    const back = await st(page);
    record(tag("D-06"), "D", "Lasso ekran dışına taşınıp panel üzerinde bırakılırsa", "Seçim tamamlanır (Selection ready) ya da iptal edilir; takılı kalmaz", { afterRelease: { bar: outside.bar.slice(0, 50), lassoVisible: outside.lassoVisible }, afterReturn: { bar: back.bar.slice(0, 50), lassoVisible: back.lassoVisible } }, /Selection ready/.test(outside.bar) || (!outside.lassoVisible && !/Selection/.test(outside.bar)) ? "PASS" : "FAIL");
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    // perspective lasso: front box occludes back box?
    await page.keyboard.press("t"); await L.sleep(200);
    // lasso performance on the 3 M cloud
    await L.open(page, fx("large_3m.pcd"));
    await page.keyboard.press("t"); await L.sleep(300);
    const TL = await calibrateTop(page);
    await page.keyboard.press("l");
    await lasso(page, rectPoly(TL.toScreen, 1, 1, 6, 6));
    const tl0 = Date.now();
    await page.keyboard.press("Delete");
    await page.waitForFunction(() => window.__msgs.some((m) => /Selection deleted/.test(m)), null, { timeout: 120000 });
    record(tag("D-07"), "D", "3 M noktada lasso silme süresi", "Makul sürede biter", { ms: Date.now() - tl0, msg: await lastMsg(page) }, "PASS");
    // ---------- undo / redo across tools ----------
    await L.open(page, fx("tilted_room.pcd"));
    const ops = [];
    const doOp = async (name, fn) => { await fn(); await L.idle(page); await L.sleep(150); ops.push([name, count(await st(page)), (await st(page)).z.join("..")]); };
    await doOp("align", () => L.click(page, "align-btn"));
    await doOp("downsample", async () => { await L.setBind(page, "ops.voxel", 0.05); await L.click(page, "voxel-btn"); });
    await doOp("noise", async () => { await L.click(page, "sor-btn"); await L.idle(page); await page.click("#action-bar button:has-text('Remove')").catch(() => {}); });
    for (let i = 0; i < 4; i++) await doOp(`transform${i}`, async () => { await L.setBind(page, "tf.z", 0.1); await L.click(page, "tf-btn"); });
    await doOp("lasso", async () => { await page.keyboard.press("t"); await L.sleep(200); const t = await calibrateTop(page); await page.keyboard.press("l"); await lasso(page, rectPoly(t.toScreen, 4, 6, 5, 7)); await page.keyboard.press("Delete"); await page.keyboard.press("t"); });
    for (let i = 0; i < 4; i++) await doOp(`downsample${i}`, async () => { await L.setBind(page, "ops.voxel", 0.06 + i * 0.02); await L.click(page, "voxel-btn"); });
    const after11 = await st(page);
    const seen = [];
    for (let i = 0; i < 11; i++) { await page.keyboard.press("Control+z"); await L.sleep(120); seen.push(count(await st(page))); }
    const undoMsg = await lastMsg(page);
    const oldest = await st(page);
    // the 10th undo must land on the state after op #1 (align), the 11th must be refused
    const expectAfter10 = ops[0][1];
    record(tag("D-08"), "D", "Karma 11 işlem sonrası 10 adım undo, 11. ret", "10. undo ilk işlemin (align) sonrasına döner; 11. 'Nothing to undo'; undo kapanır", { ops, undoCounts: seen, undoMsg, undoDisabled: oldest.undo }, seen[9] === expectAfter10 && seen[10] === expectAfter10 && /Nothing to/.test(undoMsg) && oldest.undo ? "PASS" : "FAIL");
    record(tag("D-08b"), "D", "Hata metni: 'Nothing to undone'", "Dilbilgisi doğru mesaj ('Nothing to undo')", undoMsg, /Nothing to undo\b/.test(undoMsg) ? "PASS" : "FAIL");
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Control+Shift+z"); await L.sleep(120); }
    const r3 = count(await st(page));
    await doOp("new-after-redo", async () => { await L.setBind(page, "tf.z", 0.1); await L.click(page, "tf-btn"); });
    const afterNew = await st(page);
    await page.keyboard.press("Control+Shift+z"); await L.sleep(150);
    record(tag("D-09"), "D", "Redo zinciri yeni işlemden sonra temizlenir", "3 redo sonrası yeni işlem → redo devre dışı, Ctrl+Shift+Z etkisiz", { afterRedo3: r3, expected: ops[3][1], redoDisabled: afterNew.redo, msg: await lastMsg(page) }, r3 === ops[3][1] && afterNew.redo ? "PASS" : "FAIL");
    await L.setBind(page, "crop.xmin", 3);
    const cz = (await st(page)).x[0];
    await page.keyboard.press("Control+z"); await L.sleep(150);
    record(tag("D-10"), "D", "Crop undo geçmişine giriyor mu?", "test.md karma undo'da crop'u bekliyor; uygulamada crop canlı ayar", { cropBefore: cz, cropAfterUndo: (await st(page)).x[0] }, "REVIEW");
    // ---------- race: undo while a worker job is running ----------
    await L.open(page, fx("large_3m.pcd"));
    await L.setBind(page, "ops.voxel", 0.05); await L.click(page, "voxel-btn"); await L.idle(page, 180000);
    const nA = count(await st(page));
    await L.setBind(page, "ops.voxel", 0.3);
    await L.clearMsgs(page);
    await L.click(page, "voxel-btn");
    await L.sleep(30);
    const busyNow = await L.isBusy(page);
    await page.keyboard.press("Control+z"); await L.sleep(80);
    const duringUndo = count(await st(page));
    await L.idle(page, 180000); await L.sleep(300);
    const final = await st(page);
    const m = await L.msgs(page);
    const nOrig = 3_000_000;
    record(tag("D-11"), "D", "Downsample çalışırken Ctrl+Z", "İşlem sürerken undo engellenir ya da sonuç atılır; bulut tutarlı kalır (X 0–10, Z 0–2.5)", { busyNow, countAfterFirstDownsample: nA, countRightAfterUndo: duringUndo, final: { info: final.info, x: final.x, y: final.y, z: final.z }, msgs: m.filter((x) => /status-msg/.test(x)) }, "REVIEW");
  }
  record(tag("BCD-console"), "BCD", "B/C/D boyunca yakalanmamış hata", "pageerror/unhandledrejection yok", { winErrors: await page.evaluate(() => window.__errors.slice()), pageErrors: log.console.filter((c) => /pageerror/.test(c)) }, (await page.evaluate(() => window.__errors.length)) || log.console.some((c) => /pageerror/.test(c)) ? "FAIL" : "PASS");
} catch (e) {
  record(tag("BCD-abort"), "BCD", "Harness", "-", e.stack, "ERROR");
  await page.screenshot({ path: path.join(OUT, kind, "BCD-abort.png") }).catch(() => {});
} finally {
  L.saveResults(`BCD-${kind}${only ? "-" + only : ""}`);
  await browser.close();
}
