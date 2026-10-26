// Section A: file loading and parsing.
import fs from "node:fs";
import path from "node:path";
import * as L from "./lib.mjs";
const { record, fx, OUT } = L;
const kind = process.argv[2] || "chromium";
const tag = (id) => (kind === "chromium" ? id : `${id}-${kind}`);
const last = (ms) => ms.filter((m) => /status-msg|welcome-status/.test(m)).pop() || "";
const state = (page) => page.evaluate(() => {
  const v = (b, i = 0) => document.querySelectorAll(`[data-bind="${b}"]`)[i]?.value;
  return {
    name: document.getElementById("file-name").textContent, info: document.getElementById("file-info").textContent,
    x: [v("crop.xmin"), v("crop.xmax", 1)], y: [v("crop.ymin"), v("crop.ymax", 1)], z: [v("band.min"), v("band.max", 1)],
    modes: [...document.querySelectorAll("#color-mode option")].map((o) => o.value),
    undo: document.getElementById("tb-undo").disabled, redo: document.getElementById("tb-redo").disabled,
    pgm: !document.getElementById("pgm-pane").hidden, mode: document.querySelector("#toolbar .active")?.id,
  };
});

const { browser, page, log } = await L.launch(kind);
try {
  await L.boot(page);
  // ---------- A-01 valid formats (count, attributes, coordinate ranges) ----------
  const valid = [
    ["small_ascii.pcd", 1000, [], [0, 3]], ["room10_binary.pcd", 116689, [], [0, 10]], ["room_compressed.pcd", 116689, ["intensity"], [0, 10]],
    ["room_rgb_intensity_reordered.pcd", 116689, ["rgb", "intensity"], [0, 10]], ["room_ascii_intensity.pcd", 11669, ["intensity"], [0, 10]],
    ["room_ascii_rgb.ply", 23338, ["rgb"], [0, 10]], ["room_ascii_plain.ply", 23338, [], [0, 10]], ["room_binle_rgb.ply", 23338, ["rgb"], [0, 10]],
    ["room_binle_plain.ply", 23338, [], [0, 10]], ["room_binbe_plain.ply", 23338, [], [0, 10]], ["room_space.xyz", 5835, [], [0, 10]],
    ["room_tab.xyz", 5835, [], [0, 10]], ["room_crlf.xyz", 5835, [], [0, 10]], ["UPPER.PCD", 2, [], [0, 1]], ["bom.pcd", 2, [], [0, 1]],
    ["crlf.pcd", 2, [], [0, 1]], ["long_line.pcd", 2, [], [0, 1]], ["huge_header.pcd", 2, [], [0, 1]], [L.REAL, 399429, ["intensity"], [-32.09, 17.34]],
  ];
  for (const [f, n, attrs, xr] of valid) {
    const ms = await L.open(page, f.startsWith("/") ? f : fx(f));
    const s = await state(page);
    const okCount = last(ms).includes(`: ${n.toLocaleString("en-US")} points`);
    const okAttrs = attrs.every((a) => s.modes.includes(a)) && (attrs.includes("rgb") || !s.modes.includes("rgb"));
    const okRange = Math.abs(+s.x[0] - xr[0]) < 0.02 && Math.abs(+s.x[1] - xr[1]) < 0.02;
    record(tag(`A-01[${path.basename(f)}]`), "A", `Geçerli dosya: ${path.basename(f)}`, `${n} nokta, alanlar ${attrs.join("+") || "yok"}, X aralığı ${xr}`, { msg: last(ms), info: s.info, x: s.x, z: s.z, modes: s.modes }, okCount && okAttrs && okRange ? "PASS" : "FAIL");
  }
  // ---------- A-02 broken / unsupported inputs ----------
  const broken = [
    "empty.pcd", "zero_points.pcd", "header_no_data_ascii.pcd", "header_no_data_binary.pcd", "points_more_than_data.pcd", "points_less_than_data.pcd",
    "truncated_binary.pcd", "points_mismatch_ascii.pcd", "nan_inf.pcd", "all_nan.pcd", "image_renamed.pcd", "text_renamed.pcd", "no_xyz_fields.pcd",
    "empty.xyz", "empty.ply", "garbage.ply", "room_comma.xyz", "cloud.las", "cloud.e57", "cloud.zip", "noext", "int_xyz_binary.pcd", "f64_binary.pcd",
  ];
  await L.open(page, fx("small_ascii.pcd"));
  for (const f of broken) {
    const before = await state(page);
    const ms = await L.open(page, fx(f));
    const s = await state(page);
    const m = last(ms);
    const failed = /failed:/.test(m);
    const kept = failed ? s.name === before.name : null;
    record(tag(`A-02[${f}]`), "A", `Bozuk/desteklenmeyen: ${f}`, "Anlamlı hata ve önceki bulut korunur, ya da açıkça raporlanan kısmi yükleme", { msg: m, keptPrevious: kept, nowOpen: s.name, info: s.info, x: s.x, y: s.y, z: s.z, errors: await page.evaluate(() => window.__errors.slice()) }, "REVIEW");
    if (!failed) await L.open(page, fx("small_ascii.pcd"));
  }
  // ---------- A-03 second file resets state ----------
  await L.open(page, fx("room10_binary.pcd"));
  await L.setBind(page, "crop.xmin", 3);
  await L.setBind(page, "band.min", 0.5);
  await L.setBind(page, "tf.x", 0.5);
  await L.click(page, "tf-btn");
  await L.click(page, "map-view-btn");
  await L.preview(page);
  await page.keyboard.press("m");
  const mid = await state(page);
  await L.open(page, fx("small_ascii.pcd"));
  const after = await state(page);
  const ex = await L.exportMap(page, path.join(OUT, kind, "second"));
  const reset = after.x[0] === "0" && +after.x[1] <= 3.01 && after.undo && after.redo && !after.pgm && after.mode === "tb-orbit";
  record(tag("A-03"), "A", "Aynı oturumda ikinci dosya", "Crop/Z/undo/PGM görünümü/araç modu sıfırlanır; ikinci dosyanın indirmesi kendi varsayılan Z'sini kullanır", { before: mid, after, export: ex.status }, reset && /Z 0\.1 … 1\.5/.test(ex.status || "") ? "PASS" : "FAIL");
  record(tag("A-03b"), "A", "İkinci dosyada kalıcı ayarlar", "Kullanıcı ayarları (manuel transform alanı, radius vb.) sıfırlanır mı?", { tfX: await L.getBind(page, "ops.radius") && await L.getBind(page, "tf.x"), radius: await L.getBind(page, "ops.radius") }, "REVIEW");

  // ---------- A-04 large files: time, responsiveness, heap ----------
  for (const f of ["medium_500k.pcd", "large_3m.pcd"]) {
    await L.open(page, fx("small_ascii.pcd"));
    const h0 = await L.heap(page);
    await page.evaluate(() => { window.__gaps = []; let t = performance.now(); const tick = () => { const n = performance.now(); window.__gaps.push(n - t); t = n; window.__raf = requestAnimationFrame(tick); }; window.__raf = requestAnimationFrame(tick); });
    const t0 = Date.now();
    await page.setInputFiles("#file-input", fx(f));
    await L.sleep(60);
    const busyShown = await page.evaluate(() => ({ busy: document.body.classList.contains("busy"), msg: document.getElementById("status-msg").textContent }));
    await page.waitForFunction(() => window.__msgs.some((m) => /Opened large|Opened medium/.test(m)), null, { timeout: 180000 });
    await L.idle(page);
    const ms = Date.now() - t0;
    const gaps = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return Math.round(Math.max(...window.__gaps)); });
    const h1 = await L.heap(page);
    await L.click(page, "map-view-btn");
    const t1 = Date.now();
    const pv = await L.preview(page, 300000);
    record(tag(`A-04[${f}]`), "A", `Büyük dosya: ${f}`, "Çökme yok, yükleme göstergesi var, süre/bellek kayıtlı", { loadMs: ms, longestFrameGapMs: gaps, busyShown, heapMb: [h0, h1], previewMs: Date.now() - t1, preview: pv.info }, /cells/.test(pv.info) ? "PASS" : "FAIL");
    await L.click(page, "map-view-btn");
  }
  // ---------- A-05 file names ----------
  for (const f of ["ölçüm şğı İç Ğ.pcd", "with spaces in name.pcd", "L".repeat(200) + ".pcd", "evil<img src=x onerror=window.__xss=3>.pcd", "cloud # cropped: yes.pcd", "a.b.c.final.pcd", ".hidden.pcd"]) {
    const ms = await L.open(page, fx(f));
    const s = await state(page);
    const e = await L.exportMap(page, path.join(OUT, kind, "names"));
    const y = e.yaml ? L.parseYaml(e.yaml) : {};
    const pgmName = e.names.find((n) => n.endsWith(".pgm"));
    const xss = await page.evaluate(() => [window.__xss, !!document.querySelector("img[src=x]")]);
    const panelOverflow = await page.evaluate(() => { const p = document.getElementById("panel"); return p.scrollWidth > p.clientWidth + 1; });
    record(tag(`A-05[${f.length > 40 ? f.slice(0, 20) + "…(" + f.length + ")" : f}]`), "A", "Dosya adı varyantı", "Ad doğru gösterilir, XSS yok, panel taşmaz, YAML image = kaydedilen PGM adı", { shown: s.name.length > 60 ? s.name.slice(0, 30) + "…" : s.name, saved: e.names, yamlImage: y.image, xss, panelOverflow, msg: last(ms) }, s.name === f && !xss[0] && !xss[1] && !panelOverflow && y.image === pgmName && fs.existsSync(e.files[pgmName] || "/nonexistent") ? "PASS" : "FAIL");
  }
  // ---------- A-06 drag & drop ----------
  const dms = await L.drop(page, fx("room_binle_rgb.ply"));
  record(tag("A-06a"), "A", "Sürükle-bırak ile yükleme", "Dosya açılır", last(dms), /Opened room_binle_rgb\.ply: 23,338/.test(last(dms)) ? "PASS" : "FAIL");
  const dtMulti = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(["0 0 0\n1 1 1\n"], "first.xyz")); d.items.add(new File(["0 0 0\n"], "second.xyz")); return d; });
  await L.clearMsgs(page);
  await page.dispatchEvent("body", "drop", { dataTransfer: dtMulti });
  await L.sleep(800); await L.idle(page);
  record(tag("A-06b"), "A", "İki dosyayı birlikte bırakma", "Biri açılır ve kullanıcı bilgilendirilir ya da açık hata", { msgs: await L.msgs(page), name: (await state(page)).name }, "REVIEW");
  const dtText = await page.evaluateHandle(() => { const d = new DataTransfer(); d.setData("text/plain", "hello"); return d; });
  await L.clearMsgs(page);
  await page.dispatchEvent("body", "drop", { dataTransfer: dtText });
  await L.sleep(500);
  record(tag("A-06c"), "A", "Dosya olmayan (metin) bırakma", "Sessizce yok sayılır, çökme yok", { msgs: await L.msgs(page), errors: await page.evaluate(() => window.__errors.slice()), name: (await state(page)).name }, (await page.evaluate(() => window.__errors.length)) === 0 ? "PASS" : "FAIL");
  record(tag("A-console"), "A", "A boyunca yakalanmamış hata/404", "pageerror/unhandledrejection/4xx yok", { pageErrors: log.console.filter((c) => /pageerror/.test(c)), winErrors: await page.evaluate(() => window.__errors.slice()), http: log.http }, log.console.some((c) => /pageerror/.test(c)) || log.http.length ? "FAIL" : "PASS");
} catch (e) {
  record(tag("A-abort"), "A", "Harness", "-", e.stack, "ERROR");
} finally {
  L.saveResults(`A-${kind}`);
  await browser.close();
}
